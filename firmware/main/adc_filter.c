#include "adc_filter.h"

static void sort_u16(uint16_t *v, int n)
{
    for (int i = 1; i < n; i++) {
        uint16_t key = v[i];
        int j = i - 1;
        while (j >= 0 && v[j] > key) {
            v[j + 1] = v[j];
            j--;
        }
        v[j + 1] = key;
    }
}

uint16_t tmp_trimmed_mean(uint16_t *samples, int count, int trim_pct)
{
    if (!samples || count <= 0) {
        return 0;
    }
    if (trim_pct < 0) {
        trim_pct = 0;
    }
    if (trim_pct > TMP_ADC_TRIM_PCT_MAX) {
        trim_pct = TMP_ADC_TRIM_PCT_MAX;
    }

    sort_u16(samples, count);

    /* trim_pct caps at 49, so this always keeps at least one sample. */
    int drop = (count * trim_pct) / 100;
    int kept = count - 2 * drop;

    uint32_t sum = 0;
    for (int i = drop; i < drop + kept; i++) {
        sum += samples[i];
    }
    return (uint16_t)((sum + (uint32_t)kept / 2u) / (uint32_t)kept);
}
