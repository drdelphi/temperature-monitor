#include "../main/pack.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures;

static void expect_true(const char *name, int cond)
{
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", name);
        failures++;
    }
}

static void expect_eq_i(const char *name, int got, int want)
{
    if (got != want) {
        fprintf(stderr, "FAIL %s: got %d want %d\n", name, got, want);
        failures++;
    }
}

static void expect_eq_u(const char *name, unsigned got, unsigned want)
{
    if (got != want) {
        fprintf(stderr, "FAIL %s: got %u want %u\n", name, got, want);
        failures++;
    }
}

static void expect_near(const char *name, double got, double want, double eps)
{
    if (!(fabs(got - want) <= eps)) {
        fprintf(stderr, "FAIL %s: got %.6f want %.6f\n", name, got, want);
        failures++;
    }
}

int main(void)
{
    tmp_snapshot_t in = {
        .year = 2026,
        .month = 10,
        .day = 1,
        .hour = 13,
        .minute = 30,
        .second = 45,
        .adc = {0, 1, 2048, 4095, TMP_ADC_DISABLED, 12, 100, 4000},
    };
    uint8_t buf[TMP_RECORD_SIZE];
    tmp_pack(buf, &in);
    expect_eq_i("record size", TMP_RECORD_SIZE, 17);

    tmp_snapshot_t out;
    expect_true("unpack", tmp_unpack(&out, buf));
    expect_eq_i("year", out.year, 2026);
    expect_eq_i("month", out.month, 10);
    expect_eq_i("day", out.day, 1);
    expect_eq_i("hour", out.hour, 13);
    expect_eq_i("minute", out.minute, 30);
    expect_eq_i("second", out.second, 45);
    for (int i = 0; i < 8; i++) {
        char name[32];
        snprintf(name, sizeof(name), "adc[%d]", i);
        expect_eq_u(name, out.adc[i], in.adc[i]);
    }

    /* 25 °C: R = 10k, adc = 2048 (approx 2047.5) */
    expect_near("ohm 2048", tmp_adc_to_ohm(2048), 10000.0 * 2048.0 / (4095.0 - 2048.0), 0.01);
    double t = tmp_adc_to_c(2048, TMP_DEFAULT_B_VALUE, TMP_DEFAULT_GAIN, TMP_DEFAULT_OFFSET);
    expect_near("temp ~25C", t, 25.0, 0.05);
    expect_eq_u("1650mV is 25C counts", tmp_mv_to_adc(1650), 2048);
    expect_near("gain/offset", tmp_adc_to_c(2048, TMP_DEFAULT_B_VALUE, 1.1, -0.5), 1.1 * t - 0.5, 1e-6);
    expect_true("disabled", tmp_adc_is_disabled(0xFFE));
    expect_true("not measurable disabled", !tmp_adc_is_measurable(0xFFE));

    int64_t unix_s = tmp_snapshot_unix(&in);
    expect_true("unix", unix_s > 0);
    tmp_snapshot_t round = {0};
    tmp_snapshot_from_unix(&round, unix_s);
    expect_eq_i("unix year", round.year, 2026);
    expect_eq_i("unix month", round.month, 10);
    expect_eq_i("unix day", round.day, 1);
    expect_eq_i("unix hour", round.hour, 13);
    expect_eq_i("unix minute", round.minute, 30);
    expect_eq_i("unix second", round.second, 45);

    /* One day at 1 Hz is 1_468_800 bytes */
    expect_eq_i("bytes/day", 17 * 86400, 1468800);

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    puts("ok");
    return 0;
}
