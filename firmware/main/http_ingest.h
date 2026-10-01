#pragma once

#include "esp_err.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t http_ingest_init(void);
bool http_ingest_last_ok(void);
bool http_ingest_busy(void);
void http_ingest_kick(void);

#ifdef __cplusplus
}
#endif
