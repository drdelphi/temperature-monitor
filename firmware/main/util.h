#pragma once

#include "esp_err.h"
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TMP_DEVICE_ID_LEN 13 /* 12 hex + NUL */
#define TMP_ISO_LEN 32

void tmp_device_id(char out[TMP_DEVICE_ID_LEN]);
void tmp_mac_suffix4(char out[5]);

size_t tmp_b64_encode(char *out, size_t out_sz, const uint8_t *in, size_t in_len);

/* ISO-8601 UTC "YYYY-MM-DDTHH:MM:SSZ". out must hold TMP_ISO_LEN. */
void tmp_iso_from_unix(char out[TMP_ISO_LEN], int64_t unix_s);

/* Accepts ISO-8601 (with optional trailing Z) or a decimal unix string. -1 on error. */
int64_t tmp_parse_ts_str(const char *s);

#ifdef __cplusplus
}
#endif
