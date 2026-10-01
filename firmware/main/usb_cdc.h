#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t usb_cdc_init(void);
esp_err_t usb_cdc_send(const char *data, size_t len);
bool usb_cdc_is_connected(void);

#ifdef __cplusplus
}
#endif
