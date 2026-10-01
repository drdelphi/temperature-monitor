#include "../main/adc_filter.h"

#include <stdio.h>

static int failures;

static void expect_eq_u(const char *name, unsigned got, unsigned want)
{
    if (got != want) {
        fprintf(stderr, "FAIL %s: got %u want %u\n", name, got, want);
        failures++;
    }
}

/* 64 reads sitting on 1950 counts, four of them knocked off by a TX burst. */
static void fill_burst(uint16_t *v, int n, uint16_t level, int spikes, uint16_t spike)
{
    for (int i = 0; i < n; i++) {
        v[i] = level;
    }
    for (int i = 0; i < spikes; i++) {
        v[i * 7 % n] = spike;
    }
}

int main(void)
{
    uint16_t v[64];

    fill_burst(v, 64, 1950, 0, 0);
    expect_eq_u("steady signal survives", tmp_trimmed_mean(v, 64, 25), 1950);

    fill_burst(v, 64, 1950, 4, 3000);
    expect_eq_u("4 high spikes dropped", tmp_trimmed_mean(v, 64, 25), 1950);

    fill_burst(v, 64, 1950, 4, 900);
    expect_eq_u("4 low spikes dropped", tmp_trimmed_mean(v, 64, 25), 1950);

    /* 25% off each end survives up to 16 outliers; the plain mean does not. */
    fill_burst(v, 64, 1950, 16, 3000);
    expect_eq_u("16 spikes still dropped", tmp_trimmed_mean(v, 64, 25), 1950);
    fill_burst(v, 64, 1950, 16, 3000);
    expect_eq_u("plain mean drags", tmp_trimmed_mean(v, 64, 0), 2213);

    /* Trimming must not bias a genuine ramp: 0..63 averages to 31.5 either way. */
    for (int i = 0; i < 64; i++) {
        v[i] = (uint16_t)i;
    }
    expect_eq_u("ramp unbiased", tmp_trimmed_mean(v, 64, 25), 32);

    uint16_t one[1] = {4095};
    expect_eq_u("single sample", tmp_trimmed_mean(one, 1, 25), 4095);
    expect_eq_u("empty is zero", tmp_trimmed_mean(one, 0, 25), 0);

    /* Out-of-range trim clamps instead of discarding everything. */
    fill_burst(v, 64, 1950, 4, 3000);
    expect_eq_u("trim clamped", tmp_trimmed_mean(v, 64, 100), 1950);

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    puts("ok");
    return 0;
}
