#include "util.h"

#include "esp_mac.h"
#include "pack.h"
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void tmp_device_id(char out[TMP_DEVICE_ID_LEN])
{
    uint8_t mac[6] = {0};
    (void)esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(out, TMP_DEVICE_ID_LEN, "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

void tmp_mac_suffix4(char out[5])
{
    uint8_t mac[6] = {0};
    (void)esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(out, 5, "%02X%02X", mac[4], mac[5]);
}

static const char k_b64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

size_t tmp_b64_encode(char *out, size_t out_sz, const uint8_t *in, size_t in_len)
{
    if (!out || out_sz == 0) {
        return 0;
    }
    size_t o = 0;
    for (size_t i = 0; i < in_len; i += 3) {
        unsigned n = (unsigned)in[i] << 16;
        if (i + 1 < in_len) {
            n |= (unsigned)in[i + 1] << 8;
        }
        if (i + 2 < in_len) {
            n |= (unsigned)in[i + 2];
        }
        if (o + 4 >= out_sz) {
            out[0] = 0;
            return 0;
        }
        out[o++] = k_b64[(n >> 18) & 63];
        out[o++] = k_b64[(n >> 12) & 63];
        out[o++] = (i + 1 < in_len) ? k_b64[(n >> 6) & 63] : '=';
        out[o++] = (i + 2 < in_len) ? k_b64[n & 63] : '=';
    }
    out[o] = 0;
    return o;
}

void tmp_iso_from_unix(char out[TMP_ISO_LEN], int64_t unix_s)
{
    tmp_snapshot_t s = {0};
    tmp_snapshot_from_unix(&s, unix_s);
    snprintf(out, TMP_ISO_LEN, "%04d-%02d-%02dT%02d:%02d:%02dZ",
             s.year, s.month, s.day, s.hour, s.minute, s.second);
}

int64_t tmp_parse_ts_str(const char *s)
{
    if (!s || !s[0]) {
        return -1;
    }
    bool digits = true;
    for (const char *p = s; *p; p++) {
        if (*p < '0' || *p > '9') {
            digits = false;
            break;
        }
    }
    if (digits) {
        return (int64_t)strtoll(s, NULL, 10);
    }
    tmp_snapshot_t snap = {0};
    int n = sscanf(s, "%d-%d-%dT%d:%d:%d",
                   &snap.year, &snap.month, &snap.day,
                   &snap.hour, &snap.minute, &snap.second);
    if (n != 6) {
        n = sscanf(s, "%d-%d-%d %d:%d:%d",
                   &snap.year, &snap.month, &snap.day,
                   &snap.hour, &snap.minute, &snap.second);
    }
    if (n != 6) {
        return -1;
    }
    return tmp_snapshot_unix(&snap);
}
