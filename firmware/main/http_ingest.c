#include "http_ingest.h"

#include "cJSON.h"
#include "esp_check.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "link_json.h"
#include "nvs_cfg.h"
#include "pack.h"
#include "ring_log.h"
#include "rtc_ds3231.h"
#include "sdkconfig.h"
#include "util.h"
#include "wifi_sta.h"
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "http";

static volatile bool s_last_ok;
static volatile bool s_busy;
static volatile bool s_kick;

bool http_ingest_last_ok(void)
{
    return s_last_ok;
}

bool http_ingest_busy(void)
{
    return s_busy;
}

void http_ingest_kick(void)
{
    s_kick = true;
}

static void join_url(char *out, size_t n, const char *base, const char *path)
{
    size_t bl = strlen(base);
    while (bl > 0 && base[bl - 1] == '/') {
        bl--;
    }
    if (path[0] == '/') {
        path++;
    }
    snprintf(out, n, "%.*s/%s", (int)bl, base, path);
}

static bool url_is_https(const char *url)
{
    return strncmp(url, "https://", 8) == 0;
}

typedef struct {
    char *buf;
    size_t len;
    size_t cap;
} resp_buf_t;

static esp_err_t http_event(esp_http_client_event_t *evt)
{
    resp_buf_t *rb = evt->user_data;
    if (evt->event_id != HTTP_EVENT_ON_DATA || !rb || !evt->data || evt->data_len <= 0) {
        return ESP_OK;
    }
    size_t need = rb->len + (size_t)evt->data_len + 1;
    if (need > rb->cap) {
        size_t cap = rb->cap ? rb->cap * 2 : 512;
        while (cap < need) {
            cap *= 2;
        }
        if (cap > 16384) {
            cap = 16384;
        }
        if (need > cap) {
            return ESP_OK;
        }
        char *nbuf = realloc(rb->buf, cap);
        if (!nbuf) {
            return ESP_OK;
        }
        rb->buf = nbuf;
        rb->cap = cap;
    }
    memcpy(rb->buf + rb->len, evt->data, (size_t)evt->data_len);
    rb->len += (size_t)evt->data_len;
    rb->buf[rb->len] = 0;
    return ESP_OK;
}

static int http_do(const char *url, esp_http_client_method_t method, const char *token,
                   const char *body, char **resp_out, int *status_out)
{
    if (resp_out) {
        *resp_out = NULL;
    }
    resp_buf_t rb = {0};
    bool tls = url_is_https(url);
    esp_http_client_config_t cfg = {
        .url = url,
        .method = method,
        .timeout_ms = 20000,
        .crt_bundle_attach = tls ? esp_crt_bundle_attach : NULL,
        .event_handler = http_event,
        .user_data = &rb,
        .keep_alive_enable = false,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return -1;
    }
    if (token && token[0]) {
        char auth[220];
        snprintf(auth, sizeof(auth), "Bearer %s", token);
        esp_http_client_set_header(client, "Authorization", auth);
    }
    if (body) {
        esp_http_client_set_header(client, "Content-Type", "application/json");
        esp_http_client_set_post_field(client, body, (int)strlen(body));
    }
    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    if (status_out) {
        *status_out = status;
    }
    if (err != ESP_OK) {
        free(rb.buf);
        return -1;
    }
    if (resp_out) {
        *resp_out = rb.buf;
    } else {
        free(rb.buf);
    }
    return status;
}

static void apply_pending_time(cJSON *root)
{
    cJSON *pending = cJSON_GetObjectItemCaseSensitive(root, "pendingUnixTime");
    if (cJSON_IsNumber(pending) && pending->valuedouble > 0) {
        (void)rtc_ds3231_set_unix((int64_t)pending->valuedouble);
        ESP_LOGI(TAG, "applied pendingUnixTime");
    }
}

static bool reconcile_config(const tmp_cfg_t *cfg)
{
    char id[TMP_DEVICE_ID_LEN];
    tmp_device_id(id);
    char path[80];
    snprintf(path, sizeof(path), "devices/%s/config", id);
    char url[256];
    join_url(url, sizeof(url), cfg->api_base, path);

    char *resp = NULL;
    int status = http_do(url, HTTP_METHOD_GET, cfg->token, NULL, &resp, NULL);
    if (status < 200 || status >= 300 || !resp) {
        ESP_LOGW(TAG, "GET config status=%d", status);
        free(resp);
        return false;
    }
    cJSON *root = cJSON_Parse(resp);
    free(resp);
    if (!root) {
        return false;
    }
    apply_pending_time(root);
    cJSON *rev = cJSON_GetObjectItemCaseSensitive(root, "configRev");
    if (!cJSON_IsNumber(rev) || (uint32_t)rev->valuedouble != cfg->config_rev) {
        (void)nvs_cfg_apply_json(root);
    }
    cJSON_Delete(root);
    return true;
}

static char *build_ingest_body(tmp_snapshot_t *snaps, uint8_t packed[][TMP_RECORD_SIZE], uint32_t n)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *arr = cJSON_AddArrayToObject(root, "snapshots");
    if (!root || !arr) {
        cJSON_Delete(root);
        return NULL;
    }
    for (uint32_t i = 0; i < n; i++) {
        cJSON *o = cJSON_CreateObject();
        char iso[TMP_ISO_LEN];
        int64_t unix_s = tmp_snapshot_unix(&snaps[i]);
        tmp_iso_from_unix(iso, unix_s);
        cJSON_AddStringToObject(o, "ts", iso);
        cJSON *adc = cJSON_AddArrayToObject(o, "adc");
        for (int c = 0; c < TMP_CHANNEL_COUNT; c++) {
            cJSON_AddItemToArray(adc, cJSON_CreateNumber(snaps[i].adc[c]));
        }
        char b64[32];
        tmp_b64_encode(b64, sizeof(b64), packed[i], TMP_RECORD_SIZE);
        cJSON_AddStringToObject(o, "packed", b64);
        cJSON_AddItemToArray(arr, o);
    }
    char *txt = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return txt;
}

static bool ingest_once(const tmp_cfg_t *cfg)
{
    const uint32_t limit = CONFIG_TEMPMON_DRAIN_DEFAULT_LIMIT;
    tmp_snapshot_t *snaps = calloc(limit, sizeof(*snaps));
    uint8_t (*packed)[TMP_RECORD_SIZE] = calloc(limit, TMP_RECORD_SIZE);
    if (!snaps || !packed) {
        free(snaps);
        free(packed);
        return false;
    }
    uint32_t n = 0;
    (void)ring_log_read_unacked(0, limit, snaps, packed, &n);
    if (n == 0) {
        free(snaps);
        free(packed);
        return true;
    }
    char *body = build_ingest_body(snaps, packed, n);
    free(snaps);
    free(packed);
    if (!body) {
        return false;
    }

    char url[256];
    join_url(url, sizeof(url), cfg->api_base, "ingest");
    char *resp = NULL;
    int status = 0;
    int rc = http_do(url, HTTP_METHOD_POST, cfg->token, body, &resp, &status);
    cJSON_free(body);
    if (rc < 200 || rc >= 300) {
        ESP_LOGW(TAG, "POST ingest status=%d", status);
        free(resp);
        return false;
    }
    int64_t ack = -1;
    if (resp) {
        cJSON *root = cJSON_Parse(resp);
        if (root) {
            cJSON *acked = cJSON_GetObjectItemCaseSensitive(root, "ackedTs");
            if (cJSON_IsString(acked) && acked->valuestring) {
                ack = tmp_parse_ts_str(acked->valuestring);
            } else if (cJSON_IsNumber(acked) && acked->valuedouble > 0) {
                ack = (int64_t)acked->valuedouble;
            }
            cJSON_Delete(root);
        }
        free(resp);
    }
    if (ack < 0) {
        ESP_LOGW(TAG, "POST ingest missing ackedTs; keeping flash records");
        return false;
    }
    (void)ring_log_ack_until(ack);
    return true;
}

static void ingest_task(void *arg)
{
    (void)arg;
    TickType_t last_cfg = 0;
    TickType_t last_ingest = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(500));
        TickType_t now = xTaskGetTickCount();
        bool due = s_kick;
        s_kick = false;
        if ((now - last_ingest) >= pdMS_TO_TICKS(CONFIG_TEMPMON_INGEST_PERIOD_MS)) {
            due = true;
        }

        bool sta = wifi_sta_is_up();
        bool claimed = nvs_cfg_is_claimed();
        if (!claimed || !sta) {
            if (!sta) {
                s_last_ok = false;
            }
            continue;
        }

        if (due) {
            tmp_cfg_t cfg;
            nvs_cfg_get(&cfg);
            s_busy = true;

            if (last_cfg == 0 || (now - last_cfg) >= pdMS_TO_TICKS(CONFIG_TEMPMON_CONFIG_PERIOD_MS) ||
                (!s_last_ok && ring_log_unacked() == 0)) {
                (void)reconcile_config(&cfg);
                last_cfg = now;
                nvs_cfg_get(&cfg);
            }

            if (ring_log_lock_flush(pdMS_TO_TICKS(50))) {
                bool prev_ok = s_last_ok;
                /* Empty ring is not a successful ingest. Config GET can succeed
                 * while POST /ingest never runs, which used to freeze wifiState
                 * at ingesting and stop the USB drain with nothing in Postgres. */
                if (ring_log_unacked() > 0) {
                    bool ok = true;
                    int batches = 0;
                    while (batches < 8 && ring_log_unacked() > 0) {
                        if (!ingest_once(&cfg)) {
                            ok = false;
                            break;
                        }
                        batches++;
                        /* Each batch is a fresh TLS handshake plus a synchronous
                         * flash header write and NVS commit (ring_log_ack_until).
                         * Draining a large backlog over a slow/lossy uplink can
                         * chain eight of these back to back with no yield point,
                         * which starves the idle task long enough to trip the
                         * Task Watchdog and reboot the board. Yield between
                         * batches so the scheduler always gets a slice. */
                        vTaskDelay(1);
                    }
                    s_last_ok = ok;
                }
                ring_log_unlock_flush();
                if (s_last_ok != prev_ok) {
                    link_json_broadcast_status();
                }
            }
            s_busy = false;
            last_ingest = now;
        }
    }
}

esp_err_t http_ingest_init(void)
{
    s_last_ok = false;
    ESP_RETURN_ON_FALSE(xTaskCreate(ingest_task, "http_ingest", 8192, NULL, 4, NULL) == pdPASS,
                        ESP_ERR_NO_MEM, TAG, "task");
    return ESP_OK;
}
