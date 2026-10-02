#include "wifi_sta.h"

#include "esp_check.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "http_ingest.h"
#include "led_rgb.h"
#include "nvs_cfg.h"
#include "sdkconfig.h"
#include <string.h>

static const char *TAG = "wifi";

#define BIT_GOT_IP BIT0
#define BIT_FAIL BIT1
#define BIT_STA_STARTED BIT2
#define BIT_APPLY BIT3

static EventGroupHandle_t s_events;
static esp_netif_t *s_netif;
static volatile bool s_up;
static volatile bool s_connecting;
static volatile bool s_had_ip;
static volatile bool s_hold_connect;
static volatile bool s_internet;
static volatile bool s_probe_needed;
/* Bumped by wifi_sta_apply() so an in-flight join gives up on the old credentials. */
static volatile uint32_t s_apply_gen;
static char s_ip[16];

static const char *auth_str(wifi_auth_mode_t mode)
{
    switch (mode) {
    case WIFI_AUTH_OPEN:
        return "open";
    case WIFI_AUTH_WEP:
        return "wep";
    case WIFI_AUTH_WPA_PSK:
        return "wpa";
    case WIFI_AUTH_WPA2_PSK:
    case WIFI_AUTH_WPA_WPA2_PSK:
        return "wpa2";
    case WIFI_AUTH_WPA3_PSK:
#ifdef WIFI_AUTH_WPA2_WPA3_PSK
    case WIFI_AUTH_WPA2_WPA3_PSK:
#endif
        return "wpa3";
    default:
        return "other";
    }
}

static void clear_link_state(void)
{
    s_up = false;
    s_had_ip = false;
    s_connecting = false;
    s_internet = false;
    s_probe_needed = false;
    s_ip[0] = 0;
    led_rgb_set(LED_FLAG_WIFI, false);
}

/* The driver keeps the last credentials even after the saved network is removed,
 * so wipe them too, or a stray reconnect would rejoin the old AP. */
static void forget_driver_creds(void)
{
    wifi_config_t wcfg = {0};
    wcfg.sta.threshold.authmode = WIFI_AUTH_OPEN;
    esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &wcfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "clear sta config %s", esp_err_to_name(err));
    }
}

static bool wait_for_apply(uint32_t ms)
{
    EventBits_t bits = xEventGroupWaitBits(s_events, BIT_APPLY, pdTRUE, pdFALSE, pdMS_TO_TICKS(ms));
    return (bits & BIT_APPLY) != 0;
}

bool wifi_sta_is_up(void)
{
    return s_up;
}

bool wifi_sta_is_connecting(void)
{
    return s_connecting;
}

int8_t wifi_sta_rssi(void)
{
    wifi_ap_record_t ap = {0};
    if (!s_up || esp_wifi_sta_get_ap_info(&ap) != ESP_OK) {
        return 0;
    }
    return ap.rssi;
}

const char *wifi_sta_state_str(void)
{
    if (!nvs_cfg_has_ssid()) {
        return "unset";
    }
    if (!s_up) {
        return "down";
    }
    if (http_ingest_last_ok()) {
        return "ingesting";
    }
    return "failed";
}

static void event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        xEventGroupSetBits(s_events, BIT_STA_STARTED);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *ev = data;
        ESP_LOGW(TAG, "disconnected reason=%u", ev ? (unsigned)ev->reason : 0);
        xEventGroupSetBits(s_events, BIT_FAIL);
        if (s_had_ip) {
            s_had_ip = false;
            s_up = false;
            s_ip[0] = 0;
            s_internet = false;
            led_rgb_set(LED_FLAG_WIFI, false);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ev = data;
        if (ev) {
            esp_ip4addr_ntoa(&ev->ip_info.ip, s_ip, sizeof(s_ip));
        }
        s_up = true;
        s_had_ip = true;
        s_connecting = false;
        s_probe_needed = true;
        led_rgb_set(LED_FLAG_WIFI, true);
        xEventGroupSetBits(s_events, BIT_GOT_IP);
        ESP_LOGI(TAG, "got ip %s", s_ip);
        http_ingest_kick();
    }
}

static bool probe_internet(void)
{
    if (!s_up) {
        return false;
    }
    if (http_ingest_last_ok()) {
        return true;
    }
    esp_http_client_config_t cfg = {
        .url = "http://connectivitycheck.gstatic.com/generate_204",
        .timeout_ms = 2500,
        .disable_auto_redirect = true,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return false;
    }
    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    return err == ESP_OK && (status == 204 || status == 200);
}

void wifi_sta_copy_info(tmp_wifi_info_t *out)
{
    if (!out) {
        return;
    }
    memset(out, 0, sizeof(*out));
    out->connecting = s_connecting;
    out->internet = s_up && (s_internet || http_ingest_last_ok());
    out->rssi = wifi_sta_rssi();

    tmp_cfg_t cfg;
    nvs_cfg_get(&cfg);
    if (cfg.wifi_ssid[0]) {
        strncpy(out->ssid, cfg.wifi_ssid, sizeof(out->ssid) - 1);
    }
    wifi_ap_record_t ap = {0};
    if (s_up && esp_wifi_sta_get_ap_info(&ap) == ESP_OK && ap.ssid[0]) {
        memset(out->ssid, 0, sizeof(out->ssid));
        strncpy(out->ssid, (const char *)ap.ssid, sizeof(out->ssid) - 1);
    }

    if (!s_netif || !s_up) {
        if (s_ip[0]) {
            strncpy(out->ip, s_ip, sizeof(out->ip) - 1);
        }
        return;
    }
    esp_netif_ip_info_t ip = {0};
    if (esp_netif_get_ip_info(s_netif, &ip) == ESP_OK) {
        esp_ip4addr_ntoa(&ip.ip, out->ip, sizeof(out->ip));
        esp_ip4addr_ntoa(&ip.gw, out->gateway, sizeof(out->gateway));
        esp_ip4addr_ntoa(&ip.netmask, out->netmask, sizeof(out->netmask));
    }
    esp_netif_dns_info_t dns = {0};
    if (esp_netif_get_dns_info(s_netif, ESP_NETIF_DNS_MAIN, &dns) == ESP_OK &&
        dns.ip.type == ESP_IPADDR_TYPE_V4) {
        esp_ip4addr_ntoa(&dns.ip.u_addr.ip4, out->dns, sizeof(out->dns));
    }
}

esp_err_t wifi_sta_scan(wifi_sta_ap_t *out, uint16_t *count)
{
    if (!out || !count || *count == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    uint16_t max_out = *count;
    if (max_out > WIFI_STA_AP_MAX) {
        max_out = WIFI_STA_AP_MAX;
    }
    *count = 0;
    s_hold_connect = true;
    /* Scanning fails mid-association, so let a running join bail out first. */
    for (int i = 0; i < 20 && s_connecting; i++) {
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    wifi_scan_config_t scan = {
        .ssid = NULL,
        .bssid = NULL,
        .channel = 0,
        .show_hidden = false,
        .scan_type = WIFI_SCAN_TYPE_ACTIVE,
    };
    esp_err_t err = esp_wifi_scan_start(&scan, true);
    if (err != ESP_OK) {
        s_hold_connect = false;
        return err;
    }
    uint16_t n = 24;
    wifi_ap_record_t recs[24];
    err = esp_wifi_scan_get_ap_records(&n, recs);
    s_hold_connect = false;
    if (err != ESP_OK) {
        return err;
    }
    for (uint16_t i = 0; i < n; i++) {
        if (!recs[i].ssid[0]) {
            continue;
        }
        const char *ssid = (const char *)recs[i].ssid;
        int found = -1;
        for (uint16_t k = 0; k < *count; k++) {
            if (strncmp(out[k].ssid, ssid, sizeof(out[k].ssid)) == 0) {
                found = (int)k;
                break;
            }
        }
        if (found >= 0) {
            if (recs[i].rssi > out[found].rssi) {
                out[found].rssi = recs[i].rssi;
            }
            continue;
        }
        if (*count >= max_out) {
            continue;
        }
        wifi_sta_ap_t *dst = &out[*count];
        memset(dst, 0, sizeof(*dst));
        strncpy(dst->ssid, ssid, sizeof(dst->ssid) - 1);
        dst->rssi = recs[i].rssi;
        strncpy(dst->auth, auth_str(recs[i].authmode), sizeof(dst->auth) - 1);
        (*count)++;
    }
    return ESP_OK;
}

static bool join_aborted(uint32_t gen)
{
    return s_hold_connect || s_apply_gen != gen;
}

static esp_err_t try_connect(const tmp_cfg_t *cfg, uint32_t gen)
{
    if (!cfg->wifi_ssid[0]) {
        s_connecting = false;
        return ESP_ERR_INVALID_STATE;
    }

    wifi_config_t wcfg = {0};
    strncpy((char *)wcfg.sta.ssid, cfg->wifi_ssid, sizeof(wcfg.sta.ssid) - 1);
    strncpy((char *)wcfg.sta.password, cfg->wifi_pass, sizeof(wcfg.sta.password) - 1);
    wcfg.sta.threshold.authmode = cfg->wifi_pass[0] ? WIFI_AUTH_WPA_PSK : WIFI_AUTH_OPEN;
    wcfg.sta.pmf_cfg.capable = true;
    wcfg.sta.pmf_cfg.required = false;
#ifdef WPA3_SAE_PWE_BOTH
    wcfg.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;
#endif

    s_connecting = true;
    ESP_LOGI(TAG, "connecting to '%s'", cfg->wifi_ssid);

    xEventGroupClearBits(s_events, BIT_GOT_IP | BIT_FAIL | BIT_APPLY);
    esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &wcfg);
    if (err == ESP_OK) {
        err = esp_wifi_connect();
    }
    if (err != ESP_OK) {
        s_connecting = false;
        return err;
    }

    const TickType_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(CONFIG_TEMPMON_WIFI_CONNECT_TIMEOUT_MS);
    esp_err_t result = ESP_ERR_TIMEOUT;
    for (;;) {
        if (join_aborted(gen)) {
            ESP_LOGI(TAG, "join to '%s' cancelled", cfg->wifi_ssid);
            result = ESP_ERR_INVALID_STATE;
            break;
        }
        TickType_t now = xTaskGetTickCount();
        if ((TickType_t)(deadline - now) > (TickType_t)pdMS_TO_TICKS(CONFIG_TEMPMON_WIFI_CONNECT_TIMEOUT_MS)) {
            break;
        }
        TickType_t slice = pdMS_TO_TICKS(200);
        if (slice > deadline - now) {
            slice = deadline - now;
        }
        if (slice == 0) {
            break;
        }
        EventBits_t bits =
            xEventGroupWaitBits(s_events, BIT_GOT_IP | BIT_FAIL | BIT_APPLY, pdTRUE, pdFALSE, slice);
        if (join_aborted(gen)) {
            ESP_LOGI(TAG, "join to '%s' cancelled", cfg->wifi_ssid);
            result = ESP_ERR_INVALID_STATE;
            break;
        }
        if (bits & BIT_GOT_IP) {
            return ESP_OK;
        }
        if (bits & BIT_FAIL) {
            err = esp_wifi_connect();
            if (err != ESP_OK && err != ESP_ERR_WIFI_CONN) {
                ESP_LOGW(TAG, "reconnect %s", esp_err_to_name(err));
            }
        }
    }
    (void)esp_wifi_disconnect();
    s_connecting = false;
    return result;
}

static void wifi_task(void *arg)
{
    (void)arg;
    for (;;) {
        if (s_hold_connect) {
            vTaskDelay(pdMS_TO_TICKS(200));
            continue;
        }
        /* Read the generation first: an apply racing the config read is then
         * seen as a mismatch and retried, instead of being lost. */
        uint32_t gen = s_apply_gen;
        tmp_cfg_t cfg;
        nvs_cfg_get(&cfg);
        if (!cfg.wifi_ssid[0]) {
            if (s_up || s_had_ip || s_connecting) {
                (void)esp_wifi_disconnect();
                clear_link_state();
            }
            wait_for_apply(1000);
            continue;
        }
        if (s_up) {
            if (s_probe_needed) {
                s_probe_needed = false;
                s_internet = probe_internet();
            }
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        esp_err_t err = try_connect(&cfg, gen);
        if (err == ESP_ERR_INVALID_STATE) {
            continue; /* Cancelled: re-read the config and act on it now. */
        }
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "join failed, retry in %d ms", CONFIG_TEMPMON_WIFI_RETRY_MS);
            wait_for_apply(CONFIG_TEMPMON_WIFI_RETRY_MS);
        }
    }
}

esp_err_t wifi_sta_apply(void)
{
    tmp_cfg_t cfg;
    nvs_cfg_get(&cfg);
    s_apply_gen++;
    (void)esp_wifi_disconnect();
    clear_link_state();
    if (!cfg.wifi_ssid[0]) {
        forget_driver_creds();
    }
    xEventGroupSetBits(s_events, BIT_APPLY);
    return ESP_OK;
}

esp_err_t wifi_sta_init(void)
{
    s_events = xEventGroupCreate();
    ESP_RETURN_ON_FALSE(s_events, ESP_ERR_NO_MEM, TAG, "events");

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif");
    esp_err_t loop_err = esp_event_loop_create_default();
    if (loop_err != ESP_OK && loop_err != ESP_ERR_INVALID_STATE) {
        return loop_err;
    }
    ESP_RETURN_ON_FALSE((s_netif = esp_netif_create_default_wifi_sta()) != NULL, ESP_FAIL, TAG, "sta netif");

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&cfg), TAG, "wifi init");
    ESP_RETURN_ON_ERROR(esp_wifi_set_storage(WIFI_STORAGE_RAM), TAG, "storage");
    ESP_RETURN_ON_ERROR(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL),
                        TAG, "wifi ev");
    ESP_RETURN_ON_ERROR(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL),
                        TAG, "ip ev");
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "mode");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "start");
    /* MIN_MODEM is required for Wi-Fi+BLE coexistence. */
    ESP_RETURN_ON_ERROR(esp_wifi_set_ps(WIFI_PS_MIN_MODEM), TAG, "ps");
    xEventGroupWaitBits(s_events, BIT_STA_STARTED, pdFALSE, pdTRUE, pdMS_TO_TICKS(3000));

    ESP_RETURN_ON_FALSE(xTaskCreate(wifi_task, "wifi_sta", 4096, NULL, 5, NULL) == pdPASS,
                        ESP_ERR_NO_MEM, TAG, "task");
    return ESP_OK;
}
