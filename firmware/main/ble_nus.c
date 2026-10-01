#include "ble_nus.h"

#include "esp_bt.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "link_json.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/ble_att.h"
#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "nimble/nimble_npl.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "ble_nus";

static const ble_uuid128_t UUID_NUS_SVC =
    BLE_UUID128_INIT(0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0, 0x93, 0xf3, 0xa3, 0xb5, 0x01, 0x00, 0x40, 0x6e);
static const ble_uuid128_t UUID_NUS_RX =
    BLE_UUID128_INIT(0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0, 0x93, 0xf3, 0xa3, 0xb5, 0x02, 0x00, 0x40, 0x6e);
static const ble_uuid128_t UUID_NUS_TX =
    BLE_UUID128_INIT(0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0, 0x93, 0xf3, 0xa3, 0xb5, 0x03, 0x00, 0x40, 0x6e);

static uint16_t s_tx_handle;
static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static bool s_notify;
static uint8_t s_own_addr_type;
static char s_name[16];
static ble_nus_rx_cb_t s_rx_cb;
static ble_nus_conn_cb_t s_conn_cb;
static volatile bool s_synced;

typedef struct {
    char *data;
    size_t len;
} nus_tx_msg_t;

static QueueHandle_t s_txq;
static struct ble_npl_event s_tx_ev;

static int nus_access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt, void *arg);
static int gap_event(struct ble_gap_event *event, void *arg);
static void tx_event_cb(struct ble_npl_event *ev);

static const struct ble_gatt_svc_def s_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &UUID_NUS_SVC.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {
                .uuid = &UUID_NUS_RX.u,
                .access_cb = nus_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                .uuid = &UUID_NUS_TX.u,
                .access_cb = nus_access,
                .val_handle = &s_tx_handle,
                .flags = BLE_GATT_CHR_F_NOTIFY | BLE_GATT_CHR_F_READ,
            },
            {0},
        },
    },
    {0},
};

static int nus_access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle;
    (void)attr_handle;
    (void)arg;
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
        uint8_t buf[BLE_NUS_RX_MAX];
        if (len > sizeof(buf)) {
            ESP_LOGW(TAG, "nus rx %u exceeds %u", (unsigned)len, (unsigned)sizeof(buf));
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        int rc = ble_hs_mbuf_to_flat(ctxt->om, buf, len, &len);
        if (rc == 0 && len > 0) {
            if (s_rx_cb) {
                s_rx_cb(buf, len);
            } else {
                link_json_feed(TMP_LINK_BLE, buf, len);
            }
        }
        return 0;
    }
    return 0;
}

static int set_adv_fields(void)
{
    struct ble_hs_adv_fields fields;
    memset(&fields, 0, sizeof(fields));
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.name = (uint8_t *)s_name;
    fields.name_len = (uint8_t)strlen(s_name);
    fields.name_is_complete = 1;
    int rc = ble_gap_adv_set_fields(&fields);

    struct ble_hs_adv_fields rsp;
    memset(&rsp, 0, sizeof(rsp));
    rsp.uuids128 = &UUID_NUS_SVC;
    rsp.num_uuids128 = 1;
    rsp.uuids128_is_complete = 1;
    (void)ble_gap_adv_rsp_set_fields(&rsp);
    return rc;
}

static void advertise(void)
{
    (void)ble_gap_adv_stop();
    int rc = set_adv_fields();
    if (rc != 0) {
        ESP_LOGE(TAG, "adv fields rc=%d", rc);
        return;
    }
    struct ble_gap_adv_params adv = {
        .conn_mode = BLE_GAP_CONN_MODE_UND,
        .disc_mode = BLE_GAP_DISC_MODE_GEN,
        .itvl_min = BLE_GAP_ADV_ITVL_MS(100),
        .itvl_max = BLE_GAP_ADV_ITVL_MS(150),
    };
    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &adv, gap_event, NULL);
    if (rc != 0 && rc != BLE_HS_EALREADY) {
        ESP_LOGE(TAG, "adv start rc=%d", rc);
    } else {
        ESP_LOGI(TAG, "advertising as %s", s_name);
    }
}

static void drain_txq(void)
{
    nus_tx_msg_t msg;
    while (s_txq && xQueueReceive(s_txq, &msg, 0) == pdTRUE) {
        free(msg.data);
    }
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            s_notify = false;
            ESP_LOGI(TAG, "connected handle=%u", s_conn_handle);
            if (s_conn_cb) {
                s_conn_cb(true);
            } else {
                link_json_on_connect(TMP_LINK_BLE, true);
            }
        } else {
            ESP_LOGW(TAG, "connect failed status=%d", event->connect.status);
            advertise();
        }
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "disconnected reason=%d", event->disconnect.reason);
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        s_notify = false;
        drain_txq();
        if (s_conn_cb) {
            s_conn_cb(false);
        } else {
            link_json_on_connect(TMP_LINK_BLE, false);
        }
        advertise();
        return 0;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_tx_handle) {
            s_notify = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "TX notify %s", s_notify ? "on" : "off");
        }
        return 0;
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "MTU %u", event->mtu.value);
        return 0;
    case BLE_GAP_EVENT_ADV_COMPLETE:
        advertise();
        return 0;
    default:
        return 0;
    }
}

static void on_reset(int reason)
{
    ESP_LOGE(TAG, "nimble reset reason=%d", reason);
}

static void on_sync(void)
{
    int rc = ble_hs_util_ensure_addr(0);
    if (rc != 0) {
        ESP_LOGE(TAG, "ensure addr rc=%d", rc);
        return;
    }
    rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    if (rc != 0) {
        ESP_LOGE(TAG, "infer addr rc=%d", rc);
        return;
    }
    s_synced = true;
    advertise();
}

static void host_task(void *param)
{
    (void)param;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

void ble_nus_set_rx_cb(ble_nus_rx_cb_t cb)
{
    s_rx_cb = cb;
}

void ble_nus_set_conn_cb(ble_nus_conn_cb_t cb)
{
    s_conn_cb = cb;
}

bool ble_nus_is_connected(void)
{
    return s_conn_handle != BLE_HS_CONN_HANDLE_NONE;
}

const char *ble_nus_get_name(void)
{
    return s_name;
}

static void notify_on_host(const char *data, size_t len)
{
    uint16_t mtu = ble_att_mtu(s_conn_handle);
    size_t payload = mtu > 3 ? (size_t)(mtu - 3) : 20;
    size_t off = 0;
    while (off < len) {
        size_t n = len - off;
        if (n > payload) {
            n = payload;
        }
        struct os_mbuf *om = ble_hs_mbuf_from_flat(data + off, n);
        if (!om) {
            break;
        }
        int rc = ble_gatts_notify_custom(s_conn_handle, s_tx_handle, om);
        if (rc != 0) {
            ESP_LOGW(TAG, "notify rc=%d", rc);
            break;
        }
        off += n;
    }
}

static void tx_event_cb(struct ble_npl_event *ev)
{
    (void)ev;
    nus_tx_msg_t msg;
    while (s_txq && xQueueReceive(s_txq, &msg, 0) == pdTRUE) {
        if (s_conn_handle != BLE_HS_CONN_HANDLE_NONE && s_notify && msg.data && msg.len) {
            notify_on_host(msg.data, msg.len);
        }
        free(msg.data);
    }
}

esp_err_t ble_nus_send(const char *data, size_t len)
{
    if (!data || len == 0) {
        return ESP_OK;
    }
    for (int i = 0; i < 40 && (s_conn_handle == BLE_HS_CONN_HANDLE_NONE || !s_notify); ++i) {
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    if (s_conn_handle == BLE_HS_CONN_HANDLE_NONE || !s_notify || !s_txq) {
        return ESP_ERR_INVALID_STATE;
    }
    char *copy = malloc(len);
    if (!copy) {
        return ESP_ERR_NO_MEM;
    }
    memcpy(copy, data, len);
    nus_tx_msg_t msg = {.data = copy, .len = len};
    if (xQueueSend(s_txq, &msg, pdMS_TO_TICKS(200)) != pdTRUE) {
        free(copy);
        return ESP_ERR_NO_MEM;
    }
    ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &s_tx_ev);
    return ESP_OK;
}

esp_err_t ble_nus_init(void)
{
    char suffix[5];
    tmp_mac_suffix4(suffix);
    snprintf(s_name, sizeof(s_name), "TMP-%s", suffix);

    ESP_RETURN_ON_ERROR(nimble_port_init(), TAG, "nimble_port_init");
    ble_att_set_preferred_mtu(256);
    s_txq = xQueueCreate(4, sizeof(nus_tx_msg_t));
    ESP_RETURN_ON_FALSE(s_txq, ESP_ERR_NO_MEM, TAG, "txq");
    ble_npl_event_init(&s_tx_ev, tx_event_cb, NULL);

    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.sm_bonding = 0;
    ble_hs_cfg.sm_sc = 0;

    ble_svc_gap_init();
    ble_svc_gatt_init();
    ESP_RETURN_ON_FALSE(ble_gatts_count_cfg(s_svcs) == 0, ESP_FAIL, TAG, "count_cfg");
    ESP_RETURN_ON_FALSE(ble_gatts_add_svcs(s_svcs) == 0, ESP_FAIL, TAG, "add_svcs");
    ESP_RETURN_ON_FALSE(ble_svc_gap_device_name_set(s_name) == 0, ESP_FAIL, TAG, "gap name");

    nimble_port_freertos_init(host_task);
    ESP_LOGI(TAG, "NUS ready name=%s", s_name);
    return ESP_OK;
}
