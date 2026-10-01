#pragma once

#include "esp_err.h"
#include "pack.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t adc_ntc_init(void);
esp_err_t adc_ntc_read_all(uint16_t out[TMP_CHANNEL_COUNT]);

#ifdef __cplusplus
}
#endif
