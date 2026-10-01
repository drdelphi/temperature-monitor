#include "adc.h"

#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_check.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include <string.h>

#include "esp_adc/adc_oneshot.h"

static const char *TAG = "adc";

#ifdef ADC_ATTEN_DB_11
#define TMP_ADC_ATTEN ADC_ATTEN_DB_11
#else
#define TMP_ADC_ATTEN ADC_ATTEN_DB_12
#endif

static const int k_gpios[TMP_CHANNEL_COUNT] = {
    CONFIG_TEMPMON_ADC_GPIO_0,
    CONFIG_TEMPMON_ADC_GPIO_1,
    CONFIG_TEMPMON_ADC_GPIO_2,
    CONFIG_TEMPMON_ADC_GPIO_3,
    CONFIG_TEMPMON_ADC_GPIO_4,
    CONFIG_TEMPMON_ADC_GPIO_5,
    CONFIG_TEMPMON_ADC_GPIO_6,
    CONFIG_TEMPMON_ADC_GPIO_7,
};

static adc_oneshot_unit_handle_t s_adc;
static adc_channel_t s_ch[TMP_CHANNEL_COUNT];
static adc_cali_handle_t s_cali[TMP_CHANNEL_COUNT];

static bool init_curve_fitting(adc_channel_t chan, adc_cali_handle_t *out)
{
    *out = NULL;
#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cfg = {
        .unit_id = ADC_UNIT_1,
        .chan = chan,
        .atten = TMP_ADC_ATTEN,
        .bitwidth = ADC_BITWIDTH_12,
    };
    if (adc_cali_create_scheme_curve_fitting(&cfg, out) == ESP_OK) {
        return true;
    }
#endif
#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    adc_cali_line_fitting_config_t line = {
        .unit_id = ADC_UNIT_1,
        .atten = TMP_ADC_ATTEN,
        .bitwidth = ADC_BITWIDTH_12,
    };
    if (adc_cali_create_scheme_line_fitting(&line, out) == ESP_OK) {
        return true;
    }
#endif
    (void)chan;
    return false;
}

static uint16_t stored_from_raw(int raw, adc_cali_handle_t cali)
{
    if (raw < 0) {
        raw = 0;
    }
    if (raw > TMP_ADC_FULL_SCALE) {
        raw = TMP_ADC_FULL_SCALE;
    }
    int mv = 0;
    if (cali && adc_cali_raw_to_voltage(cali, raw, &mv) == ESP_OK) {
        return tmp_mv_to_adc(mv);
    }
    return (uint16_t)raw;
}

esp_err_t adc_ntc_init(void)
{
    adc_oneshot_unit_init_cfg_t unit_cfg = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_RETURN_ON_ERROR(adc_oneshot_new_unit(&unit_cfg, &s_adc), TAG, "unit");

    adc_oneshot_chan_cfg_t chan_cfg = {
        .bitwidth = ADC_BITWIDTH_12,
        .atten = TMP_ADC_ATTEN,
    };

    int calibrated = 0;
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        adc_unit_t unit = ADC_UNIT_1;
        ESP_RETURN_ON_ERROR(adc_oneshot_io_to_channel(k_gpios[i], &unit, &s_ch[i]),
                            TAG, "io_to_channel gpio %d", k_gpios[i]);
        if (unit != ADC_UNIT_1) {
            ESP_LOGE(TAG, "GPIO %d is not ADC1", k_gpios[i]);
            return ESP_ERR_INVALID_ARG;
        }
        ESP_RETURN_ON_ERROR(adc_oneshot_config_channel(s_adc, s_ch[i], &chan_cfg),
                            TAG, "config ch %d", i);
        if (init_curve_fitting(s_ch[i], &s_cali[i])) {
            calibrated++;
        }
    }
    ESP_LOGI(TAG, "ADC1 12-bit 11dB avg=%d cal=%d/%d GPIOs %d %d %d %d %d %d %d %d",
             CONFIG_TEMPMON_ADC_SAMPLES, calibrated, TMP_CHANNEL_COUNT,
             k_gpios[0], k_gpios[1], k_gpios[2], k_gpios[3],
             k_gpios[4], k_gpios[5], k_gpios[6], k_gpios[7]);
    return ESP_OK;
}

esp_err_t adc_ntc_read_all(uint16_t out[TMP_CHANNEL_COUNT])
{
    if (!out || !s_adc) {
        return ESP_ERR_INVALID_STATE;
    }
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        uint32_t sum = 0;
        for (int s = 0; s < CONFIG_TEMPMON_ADC_SAMPLES; s++) {
            int raw = 0;
            esp_err_t err = adc_oneshot_read(s_adc, s_ch[i], &raw);
            if (err != ESP_OK) {
                return err;
            }
            sum += (uint32_t)raw;
        }
        int avg = (int)(sum / (uint32_t)CONFIG_TEMPMON_ADC_SAMPLES);
        out[i] = stored_from_raw(avg, s_cali[i]);
    }
    return ESP_OK;
}
