#include "rtc_ds3231.h"

#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_idf_version.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include "sys/time.h"
#include <string.h>
#include <time.h>

static const char *TAG = "rtc";

static i2c_master_bus_handle_t s_bus;
static i2c_master_dev_handle_t s_dev;
static bool s_present;

static uint8_t to_bcd(uint8_t v)
{
    return (uint8_t)(((v / 10) << 4) | (v % 10));
}

static uint8_t from_bcd(uint8_t v)
{
    return (uint8_t)(((v >> 4) * 10) + (v & 0x0F));
}

static void apply_settimeofday(int64_t unix_s)
{
    struct timeval tv = {
        .tv_sec = (time_t)unix_s,
        .tv_usec = 0,
    };
    settimeofday(&tv, NULL);
}

esp_err_t rtc_ds3231_init(void)
{
    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = CONFIG_TEMPMON_I2C_SDA_GPIO,
        .scl_io_num = CONFIG_TEMPMON_I2C_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags = {
            .enable_internal_pullup = true,
        },
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &s_bus), TAG, "bus");

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = CONFIG_TEMPMON_DS3231_ADDR,
        .scl_speed_hz = CONFIG_TEMPMON_I2C_FREQ_HZ,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(s_bus, &dev_cfg, &s_dev), TAG, "dev");

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 2, 0)
    esp_err_t err = i2c_master_probe(s_bus, CONFIG_TEMPMON_DS3231_ADDR, 200);
#else
    uint8_t reg = 0, b = 0;
    esp_err_t err = i2c_master_transmit_receive(s_dev, &reg, 1, &b, 1, 200);
#endif
    s_present = (err == ESP_OK);
    if (!s_present) {
        ESP_LOGW(TAG, "DS3231M not found at 0x%02X (SDA=%d SCL=%d)",
                 CONFIG_TEMPMON_DS3231_ADDR,
                 CONFIG_TEMPMON_I2C_SDA_GPIO, CONFIG_TEMPMON_I2C_SCL_GPIO);
        return ESP_OK;
    }
    ESP_LOGI(TAG, "DS3231M ready");
    return ESP_OK;
}

bool rtc_ds3231_present(void)
{
    return s_present;
}

esp_err_t rtc_ds3231_read(tmp_snapshot_t *out)
{
    if (!out) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(out, 0, sizeof(*out));
    if (!s_dev || !s_present) {
        return ESP_ERR_NOT_FOUND;
    }
    uint8_t reg = 0;
    uint8_t buf[7] = {0};
    esp_err_t err = i2c_master_transmit_receive(s_dev, &reg, 1, buf, sizeof(buf), 200);
    if (err != ESP_OK) {
        s_present = false;
        return err;
    }
    out->second = from_bcd(buf[0] & 0x7F);
    out->minute = from_bcd(buf[1] & 0x7F);
    out->hour = from_bcd(buf[2] & 0x3F);
    out->day = from_bcd(buf[4] & 0x3F);
    uint8_t month = from_bcd(buf[5] & 0x1F);
    int year = from_bcd(buf[6]);
    if (buf[5] & 0x80) {
        out->year = 2100 + year;
    } else {
        out->year = 2000 + year;
    }
    out->month = month;
    return ESP_OK;
}

esp_err_t rtc_ds3231_write(const tmp_snapshot_t *in)
{
    if (!in) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_dev) {
        return ESP_ERR_INVALID_STATE;
    }
    uint8_t century = 0;
    int y = in->year;
    if (y >= 2100) {
        century = 0x80;
        y -= 2100;
    } else {
        y -= 2000;
    }
    if (y < 0) {
        y = 0;
    }
    if (y > 99) {
        y = 99;
    }
    uint8_t buf[8] = {
        0x00,
        to_bcd((uint8_t)in->second),
        to_bcd((uint8_t)in->minute),
        to_bcd((uint8_t)in->hour),
        to_bcd(1),
        to_bcd((uint8_t)in->day),
        (uint8_t)(to_bcd((uint8_t)in->month) | century),
        to_bcd((uint8_t)y),
    };
    esp_err_t err = i2c_master_transmit(s_dev, buf, sizeof(buf), 200);
    if (err == ESP_OK) {
        s_present = true;
    }
    return err;
}

esp_err_t rtc_ds3231_get_unix(int64_t *out)
{
    if (!out) {
        return ESP_ERR_INVALID_ARG;
    }
    tmp_snapshot_t snap = {0};
    esp_err_t err = rtc_ds3231_read(&snap);
    if (err == ESP_OK) {
        *out = tmp_snapshot_unix(&snap);
        return (*out >= 0) ? ESP_OK : ESP_ERR_INVALID_RESPONSE;
    }
    time_t now = time(NULL);
    if (now > 0) {
        *out = (int64_t)now;
        return ESP_OK;
    }
    return err;
}

esp_err_t rtc_ds3231_set_unix(int64_t unix_s)
{
    tmp_snapshot_t snap = {0};
    tmp_snapshot_from_unix(&snap, unix_s);
    apply_settimeofday(unix_s);
    esp_err_t err = rtc_ds3231_write(&snap);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "DS3231 write failed (%s); system time still set", esp_err_to_name(err));
    }
    return ESP_OK;
}
