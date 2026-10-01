#include "led_rgb.h"

#include "driver/gpio.h"
#include "driver/rmt_encoder.h"
#include "driver/rmt_tx.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "led";
#define LED_RMT_RES_HZ 10000000
#define LED_LINK_MASK (LED_FLAG_USB | LED_FLAG_BLE | LED_FLAG_WIFI)

static rmt_channel_handle_t s_rmt;
static rmt_encoder_handle_t s_encoder;
static SemaphoreHandle_t s_lock;
static volatile uint32_t s_flags;
static volatile uint8_t s_idle_phase;

static void led_write(uint8_t r, uint8_t g, uint8_t b)
{
    uint8_t grb[3] = {g, r, b};
    rmt_transmit_config_t tx_cfg = {
        .loop_count = 0,
    };
    if (!s_lock || xSemaphoreTake(s_lock, pdMS_TO_TICKS(50)) != pdTRUE) {
        return;
    }
    if (s_rmt && s_encoder) {
        (void)rmt_transmit(s_rmt, s_encoder, grb, sizeof(grb), &tx_cfg);
        (void)rmt_tx_wait_all_done(s_rmt, pdMS_TO_TICKS(20));
        esp_rom_delay_us(300);
    }
    xSemaphoreGive(s_lock);
}

static void led_apply(void)
{
    const uint8_t br = (uint8_t)CONFIG_LED_RGB_BRIGHTNESS;
    const uint32_t flags = s_flags;
    uint8_t r = 0, g = 0, b = 0;

    /* Wi-Fi > Bluetooth > USB when more than one interface is up. */
    if (flags & LED_FLAG_WIFI) {
        g = br;
    } else if (flags & LED_FLAG_BLE) {
        b = br;
    } else if (flags & LED_FLAG_USB) {
        g = br;
        b = br;
    } else {
        switch (s_idle_phase % 6) {
        case 0:
            r = br;
            break;
        case 2:
            g = br;
            break;
        case 4:
            b = br;
            break;
        default:
            break;
        }
    }
    led_write(r, g, b);
}

static void led_task(void *arg)
{
    (void)arg;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(CONFIG_LED_RGB_BLINK_MS));
        if ((s_flags & LED_LINK_MASK) == 0) {
            s_idle_phase = (uint8_t)((s_idle_phase + 1) % 6);
            led_apply();
        }
    }
}

esp_err_t led_rgb_init(void)
{
    if (s_rmt) {
        return ESP_OK;
    }
    s_lock = xSemaphoreCreateMutex();
    ESP_RETURN_ON_FALSE(s_lock, ESP_ERR_NO_MEM, TAG, "mutex");

    rmt_tx_channel_config_t tx_cfg = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .gpio_num = (gpio_num_t)CONFIG_LED_RGB_GPIO,
        .mem_block_symbols = 64,
        .resolution_hz = LED_RMT_RES_HZ,
        .trans_queue_depth = 4,
    };
    ESP_RETURN_ON_ERROR(rmt_new_tx_channel(&tx_cfg, &s_rmt), TAG, "rmt");

    rmt_bytes_encoder_config_t enc_cfg = {
        .bit0 = {
            .level0 = 1,
            .duration0 = 4,
            .level1 = 0,
            .duration1 = 8,
        },
        .bit1 = {
            .level0 = 1,
            .duration0 = 8,
            .level1 = 0,
            .duration1 = 5,
        },
        .flags = {
            .msb_first = 1,
        },
    };
    ESP_RETURN_ON_ERROR(rmt_new_bytes_encoder(&enc_cfg, &s_encoder), TAG, "enc");
    ESP_RETURN_ON_ERROR(rmt_enable(s_rmt), TAG, "enable");
    ESP_RETURN_ON_ERROR(gpio_sleep_sel_dis((gpio_num_t)CONFIG_LED_RGB_GPIO), TAG, "sleep");

    s_flags = 0;
    s_idle_phase = 0;
    ESP_RETURN_ON_FALSE(xTaskCreate(led_task, "led_rgb", 3072, NULL, 3, NULL) == pdPASS,
                        ESP_ERR_NO_MEM, TAG, "task");
    led_apply();
    ESP_LOGI(TAG, "WS2812 GPIO %d", CONFIG_LED_RGB_GPIO);
    return ESP_OK;
}

void led_rgb_set(led_flag_t flag, bool enabled)
{
    if (enabled) {
        s_flags |= (uint32_t)flag;
    } else {
        s_flags &= ~(uint32_t)flag;
    }
    if ((s_flags & LED_LINK_MASK) == 0) {
        s_idle_phase = 0;
    }
    led_apply();
}
