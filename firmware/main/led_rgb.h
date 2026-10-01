#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    LED_FLAG_USB = 1u << 0,
    LED_FLAG_BLE = 1u << 1,
    LED_FLAG_WIFI = 1u << 2,
} led_flag_t;

esp_err_t led_rgb_init(void);
void led_rgb_set(led_flag_t flag, bool enabled);

#ifdef __cplusplus
}
#endif
