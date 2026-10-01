#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <time.h>

#define TMP_RECORD_SIZE 17
#define TMP_CHANNEL_COUNT 8
#define TMP_ADC_DISABLED 0xFFE
#define TMP_ADC_FULL_SCALE 4095
#define TMP_VCC_MV 3300
#define TMP_R25_OHM 10000.0
#define TMP_T25_K 298.15
#define TMP_DEFAULT_OFFSET 0.f
#define TMP_DEFAULT_GAIN 1.f
#define TMP_DEFAULT_B_VALUE 3950.f

typedef struct {
    int year;   /* 2000–2127 */
    int month;  /* 1–12 */
    int day;    /* 1–31 */
    int hour;   /* 0–23 */
    int minute; /* 0–59 */
    int second; /* 0–59 */
    uint16_t adc[TMP_CHANNEL_COUNT];
} tmp_snapshot_t;

void tmp_pack(uint8_t out[TMP_RECORD_SIZE], const tmp_snapshot_t *in);
bool tmp_unpack(tmp_snapshot_t *out, const uint8_t in[TMP_RECORD_SIZE]);

/* RTC calendar → unix seconds (UTC). Returns -1 on invalid. */
int64_t tmp_snapshot_unix(const tmp_snapshot_t *in);
void tmp_snapshot_from_unix(tmp_snapshot_t *out, int64_t unix_s);

double tmp_adc_to_ohm(uint16_t adc);
double tmp_ohm_to_c(double r_ohm, double b_value);
double tmp_adc_to_c(uint16_t adc, double b_value, double gain, double offset);
/* Millivolts on the 3.3 V divider → 12-bit counts the server formula expects. */
uint16_t tmp_mv_to_adc(int mv);
bool tmp_adc_is_disabled(uint16_t adc);
bool tmp_adc_is_measurable(uint16_t adc);
