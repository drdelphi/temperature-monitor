#pragma once

#include "esp_err.h"
#include "pack.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    TMP_LINK_USB = 0,
    TMP_LINK_BLE,
    TMP_LINK_ALL,
} tmp_link_t;

esp_err_t link_json_init(void);
void link_json_feed(tmp_link_t link, const uint8_t *data, size_t len);
void link_json_on_connect(tmp_link_t link, bool connected);
void link_json_broadcast_status(void);
void link_json_send_hello(tmp_link_t link);

#ifdef __cplusplus
}
#endif
