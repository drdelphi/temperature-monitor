#define _POSIX_C_SOURCE 200809L
#include "pack.h"

#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

static void put_bits(uint8_t *buf, size_t buf_bytes, unsigned bit_off, unsigned width, uint32_t value)
{
    uint32_t mask = width >= 32 ? 0xFFFFFFFFu : ((1u << width) - 1u);
    value &= mask;
    while (width > 0) {
        unsigned byte = bit_off / 8;
        unsigned shift = bit_off % 8;
        unsigned space = 8 - shift;
        unsigned take = width < space ? width : space;
        if (byte >= buf_bytes) {
            return;
        }
        uint8_t m = (uint8_t)(((1u << take) - 1u) << shift);
        buf[byte] = (uint8_t)((buf[byte] & ~m) | ((value << shift) & m));
        value >>= take;
        bit_off += take;
        width -= take;
    }
}

static uint32_t get_bits(const uint8_t *buf, size_t buf_bytes, unsigned bit_off, unsigned width)
{
    uint32_t value = 0;
    unsigned shift = 0;
    while (width > 0) {
        unsigned byte = bit_off / 8;
        unsigned bshift = bit_off % 8;
        unsigned space = 8 - bshift;
        unsigned take = width < space ? width : space;
        if (byte >= buf_bytes) {
            break;
        }
        uint32_t chunk = (buf[byte] >> bshift) & ((1u << take) - 1u);
        value |= chunk << shift;
        shift += take;
        bit_off += take;
        width -= take;
    }
    return value;
}

void tmp_pack(uint8_t out[TMP_RECORD_SIZE], const tmp_snapshot_t *in)
{
    memset(out, 0, TMP_RECORD_SIZE);
    put_bits(out, 5, 0, 7, (uint32_t)(in->year - 2000));
    put_bits(out, 5, 7, 4, (uint32_t)in->month);
    put_bits(out, 5, 11, 5, (uint32_t)in->day);
    put_bits(out, 5, 16, 5, (uint32_t)in->hour);
    put_bits(out, 5, 21, 6, (uint32_t)in->minute);
    put_bits(out, 5, 27, 6, (uint32_t)in->second);
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        put_bits(out + 5, 12, (unsigned)(i * 12), 12, in->adc[i] & 0xFFF);
    }
}

bool tmp_unpack(tmp_snapshot_t *out, const uint8_t in[TMP_RECORD_SIZE])
{
    if (!out || !in) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    out->year = (int)get_bits(in, 5, 0, 7) + 2000;
    out->month = (int)get_bits(in, 5, 7, 4);
    out->day = (int)get_bits(in, 5, 11, 5);
    out->hour = (int)get_bits(in, 5, 16, 5);
    out->minute = (int)get_bits(in, 5, 21, 6);
    out->second = (int)get_bits(in, 5, 27, 6);
    for (int i = 0; i < TMP_CHANNEL_COUNT; i++) {
        out->adc[i] = (uint16_t)get_bits(in + 5, 12, (unsigned)(i * 12), 12);
    }
    if (out->month < 1 || out->month > 12 || out->day < 1 || out->day > 31) {
        return false;
    }
    if (out->hour > 23 || out->minute > 59 || out->second > 59) {
        return false;
    }
    return true;
}

static int days_from_civil(int y, unsigned m, unsigned d)
{
    y -= m <= 2;
    const int era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = (unsigned)(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + (int)doe - 719468;
}

int64_t tmp_snapshot_unix(const tmp_snapshot_t *in)
{
    if (!in || in->month < 1 || in->month > 12 || in->day < 1 || in->day > 31) {
        return -1;
    }
    int64_t days = days_from_civil(in->year, (unsigned)in->month, (unsigned)in->day);
    return days * 86400LL + in->hour * 3600LL + in->minute * 60LL + in->second;
}

void tmp_snapshot_from_unix(tmp_snapshot_t *out, int64_t unix_s)
{
    time_t t = (time_t)unix_s;
    struct tm tm;
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    out->year = tm.tm_year + 1900;
    out->month = tm.tm_mon + 1;
    out->day = tm.tm_mday;
    out->hour = tm.tm_hour;
    out->minute = tm.tm_min;
    out->second = tm.tm_sec;
}

bool tmp_adc_is_disabled(uint16_t adc)
{
    return adc == TMP_ADC_DISABLED;
}

bool tmp_adc_is_measurable(uint16_t adc)
{
    return adc > 0 && adc < TMP_ADC_FULL_SCALE && adc != TMP_ADC_DISABLED;
}

uint16_t tmp_mv_to_adc(int mv)
{
    if (mv <= 0) {
        return 0;
    }
    int64_t counts = ((int64_t)mv * TMP_ADC_FULL_SCALE + (TMP_VCC_MV / 2)) / TMP_VCC_MV;
    if (counts >= TMP_ADC_FULL_SCALE) {
        return (uint16_t)TMP_ADC_FULL_SCALE;
    }
    uint16_t adc = (uint16_t)counts;
    if (adc == TMP_ADC_DISABLED) {
        return (uint16_t)(TMP_ADC_DISABLED - 1);
    }
    return adc;
}

double tmp_adc_to_ohm(uint16_t adc)
{
    if (adc == 0 || adc >= TMP_ADC_FULL_SCALE) {
        return NAN;
    }
    return TMP_R25_OHM * (double)adc / (double)(TMP_ADC_FULL_SCALE - adc);
}

double tmp_ohm_to_c(double r_ohm, double b_value)
{
    if (!(r_ohm > 0) || !(b_value > 0)) {
        return NAN;
    }
    double inv = (1.0 / TMP_T25_K) + (log(r_ohm / TMP_R25_OHM) / b_value);
    return (1.0 / inv) - 273.15;
}

double tmp_adc_to_c(uint16_t adc, double b_value, double gain, double offset)
{
    double r = tmp_adc_to_ohm(adc);
    double t = tmp_ohm_to_c(r, b_value);
    return gain * t + offset;
}
