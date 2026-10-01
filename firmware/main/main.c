#include "adc.h"
#include "ble_nus.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "http_ingest.h"
#include "led_rgb.h"
#include "link_json.h"
#include "nvs_cfg.h"
#include "nvs_flash.h"
#include "pack.h"
#include "ring_log.h"
#include "rtc_ds3231.h"
#include "usb_cdc.h"
#include "util.h"
#include "wifi_sta.h"
#include <string.h>
#include <time.h>

static const char *TAG = "main";

static void sampler_task(void *arg)
{
    (void)arg;
    uint32_t acc = 0;
    TickType_t next = xTaskGetTickCount();
    for (;;) {
        /* Fixed cadence. The spread ADC read and the flash write have to come
         * out of the second; a plain delay would add them to it and let the
         * sample rate sag further with every pass. */
        if (!xTaskDelayUntil(&next, pdMS_TO_TICKS(1000))) {
            next = xTaskGetTickCount();
        }
        uint32_t period = nvs_cfg_min_interval_sec();
        if (period < 1) {
            period = 1;
        }
        if (++acc < period) {
            continue;
        }
        acc = 0;
        if (!nvs_cfg_any_enabled()) {
            continue;
        }

        tmp_snapshot_t snap;
        memset(&snap, 0, sizeof(snap));
        bool rtc_ok = rtc_ds3231_read(&snap) == ESP_OK && snap.year >= 2020;
        if (!rtc_ok) {
            time_t now = time(NULL);
            /* Host set_time / SNTP. ESP32 epoch 0 is not a real clock. */
            if (now >= 1577836800) {
                tmp_snapshot_from_unix(&snap, (int64_t)now);
            } else if (snap.year < 2000 || snap.month < 1) {
                snap.year = 2000;
                snap.month = 1;
                snap.day = 1;
            }
        }

        uint16_t raw[TMP_CHANNEL_COUNT] = {0};
        if (adc_ntc_read_all(raw) != ESP_OK) {
            ESP_LOGW(TAG, "adc read failed");
            continue;
        }

        tmp_cfg_t cfg;
        nvs_cfg_get(&cfg);
        for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
            snap.adc[i] = cfg.ch[i].enabled ? raw[i] : TMP_ADC_DISABLED;
        }

        uint8_t rec[TMP_RECORD_SIZE];
        tmp_pack(rec, &snap);
        if (ring_log_append(rec) != ESP_OK) {
            ESP_LOGW(TAG, "ring append failed");
        }
        /* No ingest kick here. Posting every sample keeps the radio transmitting
         * through almost every ADC read; the ingest task's own period batches
         * the ring instead. USB/BLE drain is still the offline fallback. */
    }
}

void app_main(void)
{
    /* Do not software-restart on ESP_RST_USB/JTAG. Chrome Web Serial asserts DTR
     * on open, which reports as that reason; a second reset drops the ACM port
     * before the browser can talk JSON. After a USB flash, power-cycle once if
     * Wi-Fi RF stays down. Console stays on UART0. */

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    ESP_ERROR_CHECK(led_rgb_init());
    ESP_ERROR_CHECK(nvs_cfg_init());
    ESP_ERROR_CHECK(adc_ntc_init());
    ESP_ERROR_CHECK(rtc_ds3231_init());
    ESP_ERROR_CHECK(ring_log_init());
    ESP_ERROR_CHECK(wifi_sta_init());
    ESP_ERROR_CHECK(link_json_init());
    ESP_ERROR_CHECK(usb_cdc_init());
    ESP_ERROR_CHECK(ble_nus_init());
    ESP_ERROR_CHECK(http_ingest_init());

    ESP_ERROR_CHECK(xTaskCreate(sampler_task, "sampler", 4096, NULL, 6, NULL) == pdPASS
                        ? ESP_OK
                        : ESP_ERR_NO_MEM);

    char id[TMP_DEVICE_ID_LEN];
    tmp_device_id(id);
    ESP_LOGI(TAG, "tempmon deviceId=%s ble=%s unacked=%u", id, ble_nus_get_name(),
             (unsigned)ring_log_unacked());
}
