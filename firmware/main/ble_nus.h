#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BLE_NUS_RX_MAX 256

typedef void (*ble_nus_rx_cb_t)(const uint8_t *data, size_t len);
typedef void (*ble_nus_conn_cb_t)(bool connected);

esp_err_t ble_nus_init(void);
void ble_nus_set_rx_cb(ble_nus_rx_cb_t cb);
void ble_nus_set_conn_cb(ble_nus_conn_cb_t cb);
esp_err_t ble_nus_send(const char *data, size_t len);
bool ble_nus_is_connected(void);
const char *ble_nus_get_name(void);

#ifdef __cplusplus
}
#endif
