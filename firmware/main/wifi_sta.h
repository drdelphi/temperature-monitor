#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define WIFI_STA_AP_MAX 16

typedef struct {
    char ssid[33];
    int8_t rssi;
    char auth[12];
} wifi_sta_ap_t;

typedef struct {
    char ssid[33];
    char ip[16];
    char gateway[16];
    char netmask[16];
    char dns[16];
    int8_t rssi;
    bool internet;
    bool connecting;
} tmp_wifi_info_t;

esp_err_t wifi_sta_init(void);
esp_err_t wifi_sta_apply(void);
bool wifi_sta_is_up(void);
bool wifi_sta_is_connecting(void);
int8_t wifi_sta_rssi(void);
void wifi_sta_copy_info(tmp_wifi_info_t *out);
esp_err_t wifi_sta_scan(wifi_sta_ap_t *out, uint16_t *count);

/* Exact protocol strings: unset | down | ingesting | failed */
const char *wifi_sta_state_str(void);

#ifdef __cplusplus
}
#endif
