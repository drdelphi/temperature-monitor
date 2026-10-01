#pragma once

#include "esp_err.h"
#include "pack.h"
#include "freertos/FreeRTOS.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t ring_log_init(void);
esp_err_t ring_log_append(const uint8_t rec[TMP_RECORD_SIZE]); /* ESP_ERR_NO_MEM if full of unacked records */
uint32_t ring_log_unacked(void);

/* offset 0 is the oldest unacked record. packed may be NULL. */
esp_err_t ring_log_read_unacked(uint32_t offset, uint32_t max, tmp_snapshot_t *snaps,
                                uint8_t packed[][TMP_RECORD_SIZE], uint32_t *out_count);

/* Inclusive: drop records whose RTC timestamp is <= unix_s. */
esp_err_t ring_log_ack_until(int64_t unix_s);
esp_err_t ring_log_wipe(void);

/* Serialize HTTPS ingest vs local USB/BLE drain. */
bool ring_log_lock_flush(TickType_t wait);
void ring_log_unlock_flush(void);

#ifdef __cplusplus
}
#endif
