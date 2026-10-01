#include "usb_cdc.h"

#include "driver/usb_serial_jtag.h"
#include "esp_check.h"
#include "esp_idf_version.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "link_json.h"
#include <string.h>

static const char *TAG = "usb_cdc";
static volatile bool s_connected;
static bool s_hello_sent;

static bool usb_link_up(void)
{
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 1, 2)
    return usb_serial_jtag_is_connected();
#else
    return s_connected;
#endif
}

bool usb_cdc_is_connected(void)
{
    return usb_link_up();
}

esp_err_t usb_cdc_send(const char *data, size_t len)
{
    if (!data || len == 0) {
        return ESP_OK;
    }
    size_t off = 0;
    while (off < len) {
        int n = usb_serial_jtag_write_bytes(data + off, len - off, pdMS_TO_TICKS(200));
        if (n < 0) {
            return ESP_FAIL;
        }
        if (n == 0) {
            return ESP_ERR_TIMEOUT;
        }
        off += (size_t)n;
    }
    return ESP_OK;
}

static void usb_task(void *arg)
{
    (void)arg;
    uint8_t buf[128];
    for (;;) {
        bool up = usb_link_up();
        if (up && !s_hello_sent) {
            s_hello_sent = true;
            s_connected = true;
            link_json_on_connect(TMP_LINK_USB, true);
        } else if (!up && s_hello_sent) {
            s_hello_sent = false;
            s_connected = false;
            link_json_on_connect(TMP_LINK_USB, false);
        }

        int n = usb_serial_jtag_read_bytes(buf, sizeof(buf), pdMS_TO_TICKS(200));
        if (n > 0) {
            s_connected = true;
            if (!s_hello_sent) {
                s_hello_sent = true;
                link_json_on_connect(TMP_LINK_USB, true);
            }
            link_json_feed(TMP_LINK_USB, buf, (size_t)n);
        }
    }
}

esp_err_t usb_cdc_init(void)
{
    usb_serial_jtag_driver_config_t cfg = {
        .tx_buffer_size = 2048,
        .rx_buffer_size = 1024,
    };
    ESP_RETURN_ON_ERROR(usb_serial_jtag_driver_install(&cfg), TAG, "install");
    ESP_RETURN_ON_FALSE(xTaskCreate(usb_task, "usb_cdc", 4096, NULL, 5, NULL) == pdPASS,
                        ESP_ERR_NO_MEM, TAG, "task");
    ESP_LOGI(TAG, "USB Serial/JTAG JSON driver (console stays on UART0)");
    return ESP_OK;
}
