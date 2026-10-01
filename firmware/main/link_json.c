#include "link_json.h"

#include "ble_nus.h"
#include "cJSON.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "http_ingest.h"
#include "led_rgb.h"
#include "nvs_cfg.h"
#include "pack.h"
#include "ring_log.h"
#include "rtc_ds3231.h"
#include "sdkconfig.h"
#include "usb_cdc.h"
#include "util.h"
#include "wifi_sta.h"
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *TAG = "json";
#define JSON_LINE_MAX 1536

typedef struct {
    tmp_link_t link;
    char line[JSON_LINE_MAX];
} cmd_msg_t;

typedef struct {
    char buf[JSON_LINE_MAX];
    size_t len;
} line_acc_t;

static QueueHandle_t s_q;
static line_acc_t s_acc[2];
static volatile bool s_usb_up;
static volatile bool s_ble_up;
static bool s_local_drain;

static void refresh_link_led(void)
{
    led_rgb_set(LED_FLAG_USB, s_usb_up);
    led_rgb_set(LED_FLAG_BLE, s_ble_up);
}

static void send_text(tmp_link_t link, const char *txt)
{
    if (!txt) {
        return;
    }
    size_t n = strlen(txt);
    char *line = malloc(n + 2);
    if (!line) {
        return;
    }
    memcpy(line, txt, n);
    line[n] = '\n';
    line[n + 1] = 0;
    if (link == TMP_LINK_USB || link == TMP_LINK_ALL) {
        if (usb_cdc_is_connected() || s_usb_up) {
            (void)usb_cdc_send(line, n + 1);
        }
    }
    if (link == TMP_LINK_BLE || link == TMP_LINK_ALL) {
        if (ble_nus_is_connected() || s_ble_up) {
            (void)ble_nus_send(line, n + 1);
        }
    }
    free(line);
}

static void send_obj(tmp_link_t link, cJSON *obj)
{
    if (!obj) {
        return;
    }
    char *txt = cJSON_PrintUnformatted(obj);
    cJSON_Delete(obj);
    send_text(link, txt);
    cJSON_free(txt);
}

static void add_wifi_fields(cJSON *o)
{
    tmp_wifi_info_t info;
    wifi_sta_copy_info(&info);
    cJSON_AddStringToObject(o, "ssid", info.ssid);
    cJSON_AddStringToObject(o, "ip", info.ip);
    cJSON_AddStringToObject(o, "gateway", info.gateway);
    cJSON_AddStringToObject(o, "netmask", info.netmask);
    cJSON_AddStringToObject(o, "dns", info.dns);
    cJSON_AddNumberToObject(o, "rssi", info.rssi);
    cJSON_AddBoolToObject(o, "internet", info.internet);
    cJSON_AddBoolToObject(o, "wifiConnecting", info.connecting);
}

static cJSON *status_obj(void)
{
    tmp_cfg_t cfg;
    nvs_cfg_get(&cfg);
    int64_t rtc = 0;
    (void)rtc_ds3231_get_unix(&rtc);

    cJSON *o = cJSON_CreateObject();
    char id[TMP_DEVICE_ID_LEN];
    tmp_device_id(id);
    cJSON_AddStringToObject(o, "type", "status");
    cJSON_AddStringToObject(o, "deviceId", id);
    cJSON_AddStringToObject(o, "wifiState", wifi_sta_state_str());
    add_wifi_fields(o);
    cJSON_AddNumberToObject(o, "unackedCount", ring_log_unacked());
    cJSON_AddNumberToObject(o, "rtcUnix", (double)rtc);
    cJSON_AddNumberToObject(o, "configRev", cfg.config_rev);
    cJSON_AddBoolToObject(o, "claimed", nvs_cfg_is_claimed());
    return o;
}

static cJSON *hello_obj(void)
{
    tmp_cfg_t cfg;
    nvs_cfg_get(&cfg);
    char id[TMP_DEVICE_ID_LEN];
    tmp_device_id(id);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", "hello");
    cJSON_AddStringToObject(o, "deviceId", id);
    cJSON_AddStringToObject(o, "wifiState", wifi_sta_state_str());
    add_wifi_fields(o);
    cJSON_AddNumberToObject(o, "unackedCount", ring_log_unacked());
    cJSON_AddBoolToObject(o, "claimed", nvs_cfg_is_claimed());
    cJSON_AddStringToObject(o, "name", cfg.name);
    cJSON_AddNumberToObject(o, "configRev", cfg.config_rev);
    return o;
}

void link_json_send_hello(tmp_link_t link)
{
    send_obj(link, hello_obj());
}

void link_json_broadcast_status(void)
{
    send_obj(TMP_LINK_ALL, status_obj());
}

static cJSON *snapshot_json(const tmp_snapshot_t *snap, const uint8_t packed[TMP_RECORD_SIZE])
{
    cJSON *s = cJSON_CreateObject();
    if (!s || !snap) {
        cJSON_Delete(s);
        return NULL;
    }
    int64_t unix_s = tmp_snapshot_unix(snap);
    if (unix_s < 0) {
        unix_s = (int64_t)time(NULL);
        if (unix_s < 0) {
            unix_s = 0;
        }
    }
    char iso[TMP_ISO_LEN];
    tmp_iso_from_unix(iso, unix_s);
    cJSON_AddStringToObject(s, "ts", iso);
    cJSON *adc = cJSON_AddArrayToObject(s, "adc");
    for (int c = 0; c < TMP_CHANNEL_COUNT; c++) {
        cJSON_AddItemToArray(adc, cJSON_CreateNumber(snap->adc[c]));
    }
    char b64[32];
    tmp_b64_encode(b64, sizeof(b64), packed, TMP_RECORD_SIZE);
    cJSON_AddStringToObject(s, "packed", b64);
    return s;
}

static void release_local_drain(void)
{
    if (s_local_drain) {
        s_local_drain = false;
        ring_log_unlock_flush();
    }
}

static void handle_drain(tmp_link_t link, cJSON *req)
{
    const char *st = wifi_sta_state_str();
    if (strcmp(st, "ingesting") == 0) {
        release_local_drain();
        send_obj(link, status_obj());
        return;
    }
    /* One flusher at a time. Released after this batch so Wi-Fi ingest can
     * take over once the station is up. Also released on ingesting or disconnect. */
    if (!s_local_drain) {
        if (!ring_log_lock_flush(0)) {
            send_obj(link, status_obj());
            return;
        }
        s_local_drain = true;
    }
    uint32_t limit = CONFIG_TEMPMON_DRAIN_DEFAULT_LIMIT;
    cJSON *lim = cJSON_GetObjectItemCaseSensitive(req, "limit");
    if (cJSON_IsNumber(lim) && lim->valuedouble > 0) {
        limit = (uint32_t)lim->valuedouble;
        if (limit > 128) {
            limit = 128;
        }
    }
    tmp_snapshot_t *snaps = calloc(limit, sizeof(*snaps));
    uint8_t (*packed)[TMP_RECORD_SIZE] = calloc(limit, TMP_RECORD_SIZE);
    uint32_t n = 0;
    if (snaps && packed) {
        (void)ring_log_read_unacked(0, limit, snaps, packed, &n);
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", "samples");
    cJSON *arr = cJSON_AddArrayToObject(o, "snapshots");
    for (uint32_t i = 0; i < n && snaps && packed; i++) {
        cJSON_AddItemToArray(arr, snapshot_json(&snaps[i], packed[i]));
    }
    free(snaps);
    free(packed);
    send_obj(link, o);
    release_local_drain();
}

static int64_t ts_from_json(cJSON *ts)
{
    if (cJSON_IsNumber(ts)) {
        return (int64_t)ts->valuedouble;
    }
    if (cJSON_IsString(ts) && ts->valuestring) {
        return tmp_parse_ts_str(ts->valuestring);
    }
    return -1;
}

static void handle_flush_ack(tmp_link_t link, cJSON *req)
{
    int64_t unix_s = ts_from_json(cJSON_GetObjectItemCaseSensitive(req, "ts"));
    if (unix_s >= 0) {
        (void)ring_log_ack_until(unix_s);
    }
    send_obj(link, status_obj());
}

static void handle_set_config(tmp_link_t link, cJSON *req)
{
    (void)nvs_cfg_apply_json(req);
    cJSON *pending = cJSON_GetObjectItemCaseSensitive(req, "pendingUnixTime");
    if (cJSON_IsNumber(pending) && pending->valuedouble > 0) {
        (void)rtc_ds3231_set_unix((int64_t)pending->valuedouble);
    }
    send_obj(link, status_obj());
}

static void handle_set_time(tmp_link_t link, cJSON *req)
{
    cJSON *u = cJSON_GetObjectItemCaseSensitive(req, "unixTime");
    int64_t unix_s = ts_from_json(u);
    if (unix_s > 0) {
        (void)rtc_ds3231_set_unix(unix_s);
    }
    send_obj(link, status_obj());
}

static void handle_claim(tmp_link_t link, cJSON *req)
{
    cJSON *token = cJSON_GetObjectItemCaseSensitive(req, "token");
    cJSON *api = cJSON_GetObjectItemCaseSensitive(req, "apiBaseUrl");
    cJSON *ssid = cJSON_GetObjectItemCaseSensitive(req, "wifiSsid");
    if (!ssid) {
        ssid = cJSON_GetObjectItemCaseSensitive(req, "ssid");
    }
    cJSON *pass = cJSON_GetObjectItemCaseSensitive(req, "wifiPass");
    if (!pass) {
        pass = cJSON_GetObjectItemCaseSensitive(req, "password");
    }
    if (!cJSON_IsString(token) || !token->valuestring || !token->valuestring[0] ||
        !cJSON_IsString(api) || !api->valuestring || !api->valuestring[0]) {
        send_obj(link, status_obj());
        return;
    }
    const char *s = (cJSON_IsString(ssid) && ssid->valuestring) ? ssid->valuestring : NULL;
    const char *p = (cJSON_IsString(pass) && pass->valuestring) ? pass->valuestring : NULL;
    (void)nvs_cfg_set_claim(token->valuestring, api->valuestring, s, p);
    (void)wifi_sta_apply();
    http_ingest_kick();
    send_obj(link, hello_obj());
    send_obj(link, status_obj());
}

static void handle_set_wifi(tmp_link_t link, cJSON *req)
{
    cJSON *ssid = cJSON_GetObjectItemCaseSensitive(req, "ssid");
    cJSON *pass = cJSON_GetObjectItemCaseSensitive(req, "password");
    if (!cJSON_IsString(ssid) || !ssid->valuestring) {
        send_obj(link, status_obj());
        return;
    }
    const char *p = (cJSON_IsString(pass) && pass->valuestring) ? pass->valuestring : "";
    (void)nvs_cfg_set_wifi(ssid->valuestring, p);
    (void)wifi_sta_apply();
    send_obj(link, status_obj());
}

static void handle_scan_wifi(tmp_link_t link)
{
    wifi_sta_ap_t aps[WIFI_STA_AP_MAX];
    uint16_t n = WIFI_STA_AP_MAX;
    (void)wifi_sta_scan(aps, &n);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", "wifi_scan");
    cJSON *arr = cJSON_AddArrayToObject(o, "networks");
    for (uint16_t i = 0; i < n; i++) {
        cJSON *ap = cJSON_CreateObject();
        cJSON_AddStringToObject(ap, "ssid", aps[i].ssid);
        cJSON_AddNumberToObject(ap, "rssi", aps[i].rssi);
        cJSON_AddStringToObject(ap, "auth", aps[i].auth);
        cJSON_AddItemToArray(arr, ap);
    }
    send_obj(link, o);
}

static void handle_wipe_log(tmp_link_t link)
{
    release_local_drain();
    (void)ring_log_lock_flush(portMAX_DELAY);
    (void)ring_log_wipe();
    ring_log_unlock_flush();
    send_obj(link, status_obj());
}

static void handle_factory_reset(tmp_link_t link)
{
    send_obj(link, status_obj());
    release_local_drain();
    (void)ring_log_lock_flush(portMAX_DELAY);
    (void)ring_log_wipe();
    ring_log_unlock_flush();
    (void)nvs_cfg_clear_claim_and_wifi();
    vTaskDelay(pdMS_TO_TICKS(200));
    esp_restart();
}

static void handle_line(tmp_link_t link, const char *line)
{
    while (*line == ' ' || *line == '\t') {
        line++;
    }
    if (line[0] == 0) {
        return;
    }
    cJSON *req = cJSON_Parse(line);
    if (!req) {
        ESP_LOGW(TAG, "bad json");
        return;
    }
    cJSON *type = cJSON_GetObjectItemCaseSensitive(req, "type");
    if (!cJSON_IsString(type) || !type->valuestring) {
        cJSON_Delete(req);
        return;
    }
    const char *t = type->valuestring;
    ESP_LOGI(TAG, "cmd %s", t);
    if (strcmp(t, "drain") == 0) {
        handle_drain(link, req);
    } else if (strcmp(t, "flush_ack") == 0) {
        handle_flush_ack(link, req);
    } else if (strcmp(t, "set_config") == 0) {
        handle_set_config(link, req);
    } else if (strcmp(t, "set_time") == 0) {
        handle_set_time(link, req);
    } else if (strcmp(t, "claim") == 0) {
        handle_claim(link, req);
    } else if (strcmp(t, "set_wifi") == 0) {
        handle_set_wifi(link, req);
    } else if (strcmp(t, "scan_wifi") == 0) {
        handle_scan_wifi(link);
    } else if (strcmp(t, "wipe_log") == 0) {
        handle_wipe_log(link);
    } else if (strcmp(t, "factory_reset") == 0) {
        handle_factory_reset(link);
    } else if (strcmp(t, "get_status") == 0 || strcmp(t, "hello") == 0) {
        send_obj(link, hello_obj());
        send_obj(link, status_obj());
    } else {
        ESP_LOGW(TAG, "unknown type %s", t);
        send_obj(link, status_obj());
    }
    cJSON_Delete(req);
}

static void cmd_task(void *arg)
{
    (void)arg;
    cmd_msg_t msg;
    for (;;) {
        if (xQueueReceive(s_q, &msg, portMAX_DELAY) == pdTRUE) {
            handle_line(msg.link, msg.line);
        }
    }
}

static void enqueue_line(tmp_link_t link, const char *line)
{
    cmd_msg_t msg = {.link = link};
    strncpy(msg.line, line, sizeof(msg.line) - 1);
    if (xQueueSend(s_q, &msg, pdMS_TO_TICKS(200)) != pdTRUE) {
        ESP_LOGW(TAG, "cmd queue full");
    }
}

static void acc_flush_line(tmp_link_t link, line_acc_t *acc)
{
    while (acc->len > 0 && (acc->buf[acc->len - 1] == '\n' || acc->buf[acc->len - 1] == '\r' ||
                            acc->buf[acc->len - 1] == ' ')) {
        acc->buf[--acc->len] = 0;
    }
    if (acc->len > 0) {
        enqueue_line(link, acc->buf);
    }
    acc->len = 0;
    acc->buf[0] = 0;
}

void link_json_feed(tmp_link_t link, const uint8_t *data, size_t len)
{
    if (link > TMP_LINK_BLE || !data || len == 0 || !s_q) {
        return;
    }
    line_acc_t *acc = &s_acc[link];
    for (size_t i = 0; i < len; i++) {
        char c = (char)data[i];
        if (c == '\n' || c == '\r') {
            if (acc->len > 0) {
                acc->buf[acc->len] = 0;
                acc_flush_line(link, acc);
            }
            continue;
        }
        if (acc->len + 1 < sizeof(acc->buf)) {
            acc->buf[acc->len++] = c;
        } else {
            acc->len = 0;
        }
    }
    /* Complete JSON object in one BLE write without newline. */
    if (acc->len > 2 && acc->buf[0] == '{' && acc->buf[acc->len - 1] == '}') {
        acc->buf[acc->len] = 0;
        cJSON *probe = cJSON_Parse(acc->buf);
        if (probe) {
            cJSON_Delete(probe);
            acc_flush_line(link, acc);
        }
    }
}

void link_json_on_connect(tmp_link_t link, bool connected)
{
    if (link == TMP_LINK_USB) {
        s_usb_up = connected;
        s_acc[TMP_LINK_USB].len = 0;
    } else if (link == TMP_LINK_BLE) {
        s_ble_up = connected;
        s_acc[TMP_LINK_BLE].len = 0;
    }
    refresh_link_led();
    if (connected) {
        link_json_send_hello(link);
    } else if (!s_usb_up && !s_ble_up) {
        release_local_drain();
    }
}

esp_err_t link_json_init(void)
{
    s_q = xQueueCreate(8, sizeof(cmd_msg_t));
    if (!s_q) {
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(cmd_task, "link_json", 8192, NULL, 5, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "JSON protocol ready");
    return ESP_OK;
}
