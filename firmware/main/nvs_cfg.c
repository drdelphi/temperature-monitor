#include "nvs_cfg.h"

#include "cJSON.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "nvs_cfg";
static const char *NVS_NS = "tmp";
static const char *NVS_KEY = "cfg";
#define CFG_MAGIC 0x43464731u
#define CFG_VERSION 1u

typedef struct {
    uint32_t magic;
    uint32_t version;
    tmp_cfg_t cfg;
} cfg_blob_t;

static SemaphoreHandle_t s_lock;
static tmp_cfg_t s_cfg;

static void strip_trailing_slashes(char *s)
{
    size_t n = strlen(s);
    while (n > 0 && s[n - 1] == '/') {
        s[--n] = 0;
    }
}

void nvs_cfg_normalize_api_base(char *inout, size_t inout_sz)
{
    if (!inout || inout_sz == 0) {
        return;
    }
    strip_trailing_slashes(inout);
    char *scheme = strstr(inout, "://");
    char *host = scheme ? scheme + 3 : inout;
    char *path = strchr(host, '/');
    if (!path) {
        size_t n = strlen(inout);
        if (n + 3 < inout_sz) {
            memcpy(inout + n, "/v1", 4);
        }
    }
}

void nvs_cfg_defaults(tmp_cfg_t *out)
{
    memset(out, 0, sizeof(*out));
    strncpy(out->name, "Probe box", sizeof(out->name) - 1);
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        snprintf(out->ch[i].name, sizeof(out->ch[i].name), "CH%d", i);
        out->ch[i].enabled = true;
        out->ch[i].interval_sec = 1;
        out->ch[i].offset = TMP_DEFAULT_OFFSET;
        out->ch[i].gain = TMP_DEFAULT_GAIN;
        out->ch[i].b_value = TMP_DEFAULT_B_VALUE;
    }
}

static void sanitize_channel(tmp_ch_cfg_t *ch)
{
    if (ch->interval_sec < 1) {
        ch->interval_sec = 1;
    }
    if (ch->interval_sec > 86400) {
        ch->interval_sec = 86400;
    }
    if (!(ch->gain > 0.f) && !(ch->gain < 0.f) && ch->gain != 0.f) {
        ch->gain = TMP_DEFAULT_GAIN;
    }
    if (ch->gain == 0.f) {
        ch->gain = TMP_DEFAULT_GAIN;
    }
    if (!(ch->b_value > 0.f)) {
        ch->b_value = TMP_DEFAULT_B_VALUE;
    }
}

static esp_err_t persist_locked(void)
{
    cfg_blob_t blob = {
        .magic = CFG_MAGIC,
        .version = CFG_VERSION,
        .cfg = s_cfg,
    };
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) {
        return err;
    }
    err = nvs_set_blob(h, NVS_KEY, &blob, sizeof(blob));
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

esp_err_t nvs_cfg_init(void)
{
    s_lock = xSemaphoreCreateMutex();
    ESP_RETURN_ON_FALSE(s_lock, ESP_ERR_NO_MEM, TAG, "mutex");
    nvs_cfg_defaults(&s_cfg);

    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
        cfg_blob_t blob = {0};
        size_t len = sizeof(blob);
        if (nvs_get_blob(h, NVS_KEY, &blob, &len) == ESP_OK &&
            blob.magic == CFG_MAGIC && blob.version == CFG_VERSION) {
            s_cfg = blob.cfg;
            for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
                sanitize_channel(&s_cfg.ch[i]);
            }
        }
        nvs_close(h);
    }
    ESP_LOGI(TAG, "claimed=%d ssid='%s' rev=%u",
             (int)s_cfg.claimed, s_cfg.wifi_ssid, (unsigned)s_cfg.config_rev);
    return ESP_OK;
}

esp_err_t nvs_cfg_get(tmp_cfg_t *out)
{
    ESP_RETURN_ON_FALSE(out, ESP_ERR_INVALID_ARG, TAG, "out");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    *out = s_cfg;
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t nvs_cfg_save(const tmp_cfg_t *in)
{
    ESP_RETURN_ON_FALSE(in, ESP_ERR_INVALID_ARG, TAG, "in");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_cfg = *in;
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        sanitize_channel(&s_cfg.ch[i]);
    }
    nvs_cfg_normalize_api_base(s_cfg.api_base, sizeof(s_cfg.api_base));
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}

bool nvs_cfg_is_claimed(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    bool v = s_cfg.claimed && s_cfg.token[0] && s_cfg.api_base[0];
    xSemaphoreGive(s_lock);
    return v;
}

bool nvs_cfg_has_ssid(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    bool v = s_cfg.wifi_ssid[0] != 0;
    xSemaphoreGive(s_lock);
    return v;
}

bool nvs_cfg_any_enabled(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    bool v = false;
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        if (s_cfg.ch[i].enabled) {
            v = true;
            break;
        }
    }
    xSemaphoreGive(s_lock);
    return v;
}

uint32_t nvs_cfg_min_interval_sec(void)
{
    uint32_t min = UINT32_MAX;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        if (s_cfg.ch[i].enabled && s_cfg.ch[i].interval_sec < min) {
            min = s_cfg.ch[i].interval_sec;
        }
    }
    xSemaphoreGive(s_lock);
    if (min == UINT32_MAX || min < 1) {
        return 1;
    }
    return min;
}

uint32_t nvs_cfg_config_rev(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    uint32_t v = s_cfg.config_rev;
    xSemaphoreGive(s_lock);
    return v;
}

esp_err_t nvs_cfg_set_name(const char *name)
{
    ESP_RETURN_ON_FALSE(name, ESP_ERR_INVALID_ARG, TAG, "name");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    memset(s_cfg.name, 0, sizeof(s_cfg.name));
    strncpy(s_cfg.name, name, sizeof(s_cfg.name) - 1);
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}

esp_err_t nvs_cfg_set_config_rev(uint32_t rev)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_cfg.config_rev = rev;
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}

esp_err_t nvs_cfg_set_channel(int index, const tmp_ch_cfg_t *ch)
{
    ESP_RETURN_ON_FALSE(index >= 0 && index < TMP_CHANNEL_COUNT, ESP_ERR_INVALID_ARG, TAG, "index");
    ESP_RETURN_ON_FALSE(ch, ESP_ERR_INVALID_ARG, TAG, "ch");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_cfg.ch[index] = *ch;
    sanitize_channel(&s_cfg.ch[index]);
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}

esp_err_t nvs_cfg_set_wifi(const char *ssid, const char *pass)
{
    ESP_RETURN_ON_FALSE(ssid, ESP_ERR_INVALID_ARG, TAG, "ssid");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    memset(s_cfg.wifi_ssid, 0, sizeof(s_cfg.wifi_ssid));
    memset(s_cfg.wifi_pass, 0, sizeof(s_cfg.wifi_pass));
    strncpy(s_cfg.wifi_ssid, ssid, sizeof(s_cfg.wifi_ssid) - 1);
    if (pass) {
        strncpy(s_cfg.wifi_pass, pass, sizeof(s_cfg.wifi_pass) - 1);
    }
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}

esp_err_t nvs_cfg_set_claim(const char *token, const char *api_base,
                            const char *ssid, const char *pass)
{
    ESP_RETURN_ON_FALSE(token && token[0], ESP_ERR_INVALID_ARG, TAG, "token");
    ESP_RETURN_ON_FALSE(api_base && api_base[0], ESP_ERR_INVALID_ARG, TAG, "api");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    memset(s_cfg.token, 0, sizeof(s_cfg.token));
    memset(s_cfg.api_base, 0, sizeof(s_cfg.api_base));
    strncpy(s_cfg.token, token, sizeof(s_cfg.token) - 1);
    strncpy(s_cfg.api_base, api_base, sizeof(s_cfg.api_base) - 1);
    nvs_cfg_normalize_api_base(s_cfg.api_base, sizeof(s_cfg.api_base));
    s_cfg.claimed = true;
    if (ssid && ssid[0]) {
        memset(s_cfg.wifi_ssid, 0, sizeof(s_cfg.wifi_ssid));
        memset(s_cfg.wifi_pass, 0, sizeof(s_cfg.wifi_pass));
        strncpy(s_cfg.wifi_ssid, ssid, sizeof(s_cfg.wifi_ssid) - 1);
        if (pass) {
            strncpy(s_cfg.wifi_pass, pass, sizeof(s_cfg.wifi_pass) - 1);
        }
    }
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}

static void apply_channel_json(tmp_ch_cfg_t *ch, const cJSON *obj)
{
    cJSON *name = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "name");
    cJSON *enabled = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "enabled");
    cJSON *interval = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "intervalSec");
    if (!interval) {
        interval = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "interval_s");
    }
    cJSON *offset = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "offset");
    cJSON *gain = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "gain");
    cJSON *bval = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "bValue");
    if (!bval) {
        bval = cJSON_GetObjectItemCaseSensitive((cJSON *)obj, "b_value");
    }
    if (cJSON_IsString(name) && name->valuestring) {
        memset(ch->name, 0, sizeof(ch->name));
        strncpy(ch->name, name->valuestring, sizeof(ch->name) - 1);
    }
    if (cJSON_IsBool(enabled) || cJSON_IsNumber(enabled)) {
        ch->enabled = cJSON_IsTrue(enabled) || (cJSON_IsNumber(enabled) && enabled->valuedouble != 0);
    }
    if (cJSON_IsNumber(interval)) {
        ch->interval_sec = (uint32_t)interval->valuedouble;
    }
    if (cJSON_IsNumber(offset)) {
        ch->offset = (float)offset->valuedouble;
    }
    if (cJSON_IsNumber(gain)) {
        ch->gain = (float)gain->valuedouble;
    }
    if (cJSON_IsNumber(bval)) {
        ch->b_value = (float)bval->valuedouble;
    }
    sanitize_channel(ch);
}

esp_err_t nvs_cfg_apply_json(const struct cJSON *root)
{
    if (!root) {
        return ESP_ERR_INVALID_ARG;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    cJSON *name = cJSON_GetObjectItemCaseSensitive((cJSON *)root, "name");
    if (cJSON_IsString(name) && name->valuestring && name->valuestring[0]) {
        memset(s_cfg.name, 0, sizeof(s_cfg.name));
        strncpy(s_cfg.name, name->valuestring, sizeof(s_cfg.name) - 1);
    }
    cJSON *rev = cJSON_GetObjectItemCaseSensitive((cJSON *)root, "configRev");
    if (cJSON_IsNumber(rev)) {
        s_cfg.config_rev = (uint32_t)rev->valuedouble;
    }
    cJSON *channels = cJSON_GetObjectItemCaseSensitive((cJSON *)root, "channels");
    if (cJSON_IsArray(channels)) {
        cJSON *chobj = NULL;
        cJSON_ArrayForEach(chobj, channels) {
            cJSON *idx = cJSON_GetObjectItemCaseSensitive(chobj, "index");
            if (!cJSON_IsNumber(idx)) {
                continue;
            }
            int i = (int)idx->valuedouble;
            if (i < 0 || i >= TMP_CHANNEL_COUNT) {
                continue;
            }
            apply_channel_json(&s_cfg.ch[i], chobj);
        }
    }
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}

esp_err_t nvs_cfg_clear_claim_and_wifi(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    char name[TMP_CFG_NAME_LEN];
    tmp_ch_cfg_t ch[TMP_CHANNEL_COUNT];
    memcpy(name, s_cfg.name, sizeof(name));
    memcpy(ch, s_cfg.ch, sizeof(ch));
    nvs_cfg_defaults(&s_cfg);
    memcpy(s_cfg.name, name, sizeof(s_cfg.name));
    memcpy(s_cfg.ch, ch, sizeof(s_cfg.ch));
    s_cfg.config_rev = 0;
    s_cfg.claimed = false;
    s_cfg.token[0] = 0;
    s_cfg.api_base[0] = 0;
    s_cfg.wifi_ssid[0] = 0;
    s_cfg.wifi_pass[0] = 0;
    esp_err_t err = persist_locked();
    xSemaphoreGive(s_lock);
    return err;
}
