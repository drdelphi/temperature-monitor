#pragma once

#include "esp_err.h"
#include "pack.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t rtc_ds3231_init(void);
esp_err_t rtc_ds3231_read(tmp_snapshot_t *out);
esp_err_t rtc_ds3231_write(const tmp_snapshot_t *in);
esp_err_t rtc_ds3231_get_unix(int64_t *out);
esp_err_t rtc_ds3231_set_unix(int64_t unix_s);
bool rtc_ds3231_present(void);

#ifdef __cplusplus
}
#endif
