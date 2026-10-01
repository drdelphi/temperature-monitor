#pragma once

#include "esp_err.h"
#include "pack.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TMP_CFG_NAME_LEN 48
#define TMP_CFG_CH_NAME_LEN 32
#define TMP_CFG_TOKEN_LEN 192
#define TMP_CFG_API_LEN 160
#define TMP_CFG_SSID_LEN 33
#define TMP_CFG_PASS_LEN 65

typedef struct {
    char name[TMP_CFG_CH_NAME_LEN];
    bool enabled;
    uint32_t interval_sec;
    float offset;
    float gain;
    float b_value;
} tmp_ch_cfg_t;

typedef struct {
    char name[TMP_CFG_NAME_LEN];
    bool claimed;
    char token[TMP_CFG_TOKEN_LEN];
    char api_base[TMP_CFG_API_LEN];
    char wifi_ssid[TMP_CFG_SSID_LEN];
    char wifi_pass[TMP_CFG_PASS_LEN];
    uint32_t config_rev;
    tmp_ch_cfg_t ch[TMP_CHANNEL_COUNT];
} tmp_cfg_t;

esp_err_t nvs_cfg_init(void);
void nvs_cfg_defaults(tmp_cfg_t *out);
esp_err_t nvs_cfg_get(tmp_cfg_t *out);
esp_err_t nvs_cfg_save(const tmp_cfg_t *in);

bool nvs_cfg_is_claimed(void);
bool nvs_cfg_has_ssid(void);
bool nvs_cfg_any_enabled(void);
uint32_t nvs_cfg_min_interval_sec(void);
uint32_t nvs_cfg_config_rev(void);

esp_err_t nvs_cfg_set_name(const char *name);
esp_err_t nvs_cfg_set_config_rev(uint32_t rev);
esp_err_t nvs_cfg_set_channel(int index, const tmp_ch_cfg_t *ch);
esp_err_t nvs_cfg_set_wifi(const char *ssid, const char *pass);
esp_err_t nvs_cfg_set_claim(const char *token, const char *api_base,
                            const char *ssid, const char *pass);
esp_err_t nvs_cfg_clear_claim_and_wifi(void);

/* If the URL has no path, append /v1. Strips trailing slashes. */
void nvs_cfg_normalize_api_base(char *inout, size_t inout_sz);

struct cJSON;
/* Apply name, configRev, and channels[] from a set_config / GET config object. */
esp_err_t nvs_cfg_apply_json(const struct cJSON *root);

#ifdef __cplusplus
}
#endif
