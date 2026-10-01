#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TMP_ADC_TRIM_PCT_MAX 49

/* Mean of the samples left after discarding trim_pct of them from each end.
 * Sorts samples in place. A Wi-Fi TX burst dips the 3V3 rail for a few reads;
 * a plain mean carries those outliers into the result, a trimmed one drops
 * them and still averages away the ordinary per-read noise. */
uint16_t tmp_trimmed_mean(uint16_t *samples, int count, int trim_pct);

#ifdef __cplusplus
}
#endif
