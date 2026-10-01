#include "ring_log.h"

#include "esp_check.h"
#include "esp_log.h"
#include "esp_littlefs.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "ring";
#define RING_PATH "/lfs/ring.bin"
#define RING_MAGIC 0x544D5031u /* TMP1 */
#define NVS_NS "tmp"
#define NVS_HEAD "rhead"
#define NVS_COUNT "rcount"

typedef struct {
    uint32_t magic;
    uint32_t head;
    uint32_t count;
    uint32_t max_slots;
} ring_hdr_t;

static SemaphoreHandle_t s_lock;
static SemaphoreHandle_t s_flush;
static FILE *s_file;
static ring_hdr_t s_hdr;
static uint32_t s_writes_since_nvs;

static void nvs_save_cursor(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) {
        return;
    }
    (void)nvs_set_u32(h, NVS_HEAD, s_hdr.head);
    (void)nvs_set_u32(h, NVS_COUNT, s_hdr.count);
    (void)nvs_commit(h);
    nvs_close(h);
    s_writes_since_nvs = 0;
}

static void nvs_load_cursor(uint32_t *head, uint32_t *count)
{
    *head = 0;
    *count = 0;
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) {
        return;
    }
    (void)nvs_get_u32(h, NVS_HEAD, head);
    (void)nvs_get_u32(h, NVS_COUNT, count);
    nvs_close(h);
}

static long slot_off(uint32_t slot)
{
    return (long)sizeof(ring_hdr_t) + (long)slot * TMP_RECORD_SIZE;
}

static esp_err_t write_header(void)
{
    if (!s_file) {
        return ESP_ERR_INVALID_STATE;
    }
    if (fseek(s_file, 0, SEEK_SET) != 0) {
        return ESP_FAIL;
    }
    if (fwrite(&s_hdr, 1, sizeof(s_hdr), s_file) != sizeof(s_hdr)) {
        return ESP_FAIL;
    }
    fflush(s_file);
    return ESP_OK;
}

static esp_err_t read_header(void)
{
    if (fseek(s_file, 0, SEEK_SET) != 0) {
        return ESP_FAIL;
    }
    ring_hdr_t hdr = {0};
    if (fread(&hdr, 1, sizeof(hdr), s_file) != sizeof(hdr)) {
        return ESP_FAIL;
    }
    if (hdr.magic != RING_MAGIC || hdr.max_slots == 0 ||
        hdr.max_slots > (uint32_t)CONFIG_TEMPMON_RING_MAX_RECORDS ||
        hdr.count > hdr.max_slots || hdr.head >= hdr.max_slots) {
        return ESP_ERR_INVALID_STATE;
    }
    s_hdr = hdr;
    return ESP_OK;
}

static void reset_hdr(void)
{
    memset(&s_hdr, 0, sizeof(s_hdr));
    s_hdr.magic = RING_MAGIC;
    s_hdr.max_slots = CONFIG_TEMPMON_RING_MAX_RECORDS;
}

esp_err_t ring_log_init(void)
{
    s_lock = xSemaphoreCreateMutex();
    ESP_RETURN_ON_FALSE(s_lock, ESP_ERR_NO_MEM, TAG, "mutex");
    s_flush = xSemaphoreCreateMutex();
    ESP_RETURN_ON_FALSE(s_flush, ESP_ERR_NO_MEM, TAG, "flush");

    esp_vfs_littlefs_conf_t conf = {
        .base_path = "/lfs",
        .partition_label = "storage",
        .format_if_mount_failed = true,
        .dont_mount = false,
    };
    ESP_RETURN_ON_ERROR(esp_vfs_littlefs_register(&conf), TAG, "littlefs");

    size_t total = 0, used = 0;
    if (esp_littlefs_info("storage", &total, &used) == ESP_OK) {
        ESP_LOGI(TAG, "littlefs total=%u used=%u", (unsigned)total, (unsigned)used);
    }

    s_file = fopen(RING_PATH, "r+b");
    if (!s_file) {
        s_file = fopen(RING_PATH, "w+b");
    }
    ESP_RETURN_ON_FALSE(s_file, ESP_FAIL, TAG, "open ring");
    setvbuf(s_file, NULL, _IOFBF, 512);

    if (read_header() != ESP_OK) {
        uint32_t head = 0, count = 0;
        nvs_load_cursor(&head, &count);
        reset_hdr();
        if (count <= s_hdr.max_slots && head < s_hdr.max_slots) {
            s_hdr.head = head;
            s_hdr.count = count;
        }
        ESP_RETURN_ON_ERROR(write_header(), TAG, "hdr");
        nvs_save_cursor();
        ESP_LOGW(TAG, "ring header reset head=%u count=%u max=%u",
                 (unsigned)s_hdr.head, (unsigned)s_hdr.count, (unsigned)s_hdr.max_slots);
    } else {
        ESP_LOGI(TAG, "ring head=%u count=%u max=%u",
                 (unsigned)s_hdr.head, (unsigned)s_hdr.count, (unsigned)s_hdr.max_slots);
    }
    return ESP_OK;
}

esp_err_t ring_log_append(const uint8_t rec[TMP_RECORD_SIZE])
{
    ESP_RETURN_ON_FALSE(rec, ESP_ERR_INVALID_ARG, TAG, "rec");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (!s_file) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    /* Never overwrite unacked records. Space frees only after an ingest ACK. */
    if (s_hdr.count >= s_hdr.max_slots) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_NO_MEM;
    }
    uint32_t slot = s_hdr.head;
    if (fseek(s_file, slot_off(slot), SEEK_SET) != 0 ||
        fwrite(rec, 1, TMP_RECORD_SIZE, s_file) != TMP_RECORD_SIZE) {
        xSemaphoreGive(s_lock);
        return ESP_FAIL;
    }
    s_hdr.head = (s_hdr.head + 1) % s_hdr.max_slots;
    s_hdr.count++;
    esp_err_t err = write_header();
    if (++s_writes_since_nvs >= 64) {
        nvs_save_cursor();
    }
    xSemaphoreGive(s_lock);
    return err;
}

uint32_t ring_log_unacked(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    uint32_t n = s_hdr.count;
    xSemaphoreGive(s_lock);
    return n;
}

static uint32_t oldest_slot_locked(void)
{
    return (s_hdr.head + s_hdr.max_slots - s_hdr.count) % s_hdr.max_slots;
}

esp_err_t ring_log_read_unacked(uint32_t offset, uint32_t max, tmp_snapshot_t *snaps,
                                uint8_t packed[][TMP_RECORD_SIZE], uint32_t *out_count)
{
    ESP_RETURN_ON_FALSE(out_count, ESP_ERR_INVALID_ARG, TAG, "out");
    *out_count = 0;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (!s_file || offset >= s_hdr.count || max == 0) {
        xSemaphoreGive(s_lock);
        return ESP_OK;
    }
    uint32_t n = s_hdr.count - offset;
    if (n > max) {
        n = max;
    }
    uint32_t start = (oldest_slot_locked() + offset) % s_hdr.max_slots;
    for (uint32_t i = 0; i < n; i++) {
        uint32_t slot = (start + i) % s_hdr.max_slots;
        uint8_t rec[TMP_RECORD_SIZE];
        if (fseek(s_file, slot_off(slot), SEEK_SET) != 0 ||
            fread(rec, 1, TMP_RECORD_SIZE, s_file) != TMP_RECORD_SIZE) {
            break;
        }
        tmp_snapshot_t snap;
        if (!tmp_unpack(&snap, rec)) {
            continue;
        }
        if (snaps) {
            snaps[*out_count] = snap;
        }
        if (packed) {
            memcpy(packed[*out_count], rec, TMP_RECORD_SIZE);
        }
        (*out_count)++;
    }
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t ring_log_ack_until(int64_t unix_s)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (!s_file || s_hdr.count == 0) {
        xSemaphoreGive(s_lock);
        return ESP_OK;
    }
    uint32_t drop = 0;
    uint32_t start = oldest_slot_locked();
    for (uint32_t i = 0; i < s_hdr.count; i++) {
        uint32_t slot = (start + i) % s_hdr.max_slots;
        uint8_t rec[TMP_RECORD_SIZE];
        if (fseek(s_file, slot_off(slot), SEEK_SET) != 0 ||
            fread(rec, 1, TMP_RECORD_SIZE, s_file) != TMP_RECORD_SIZE) {
            break;
        }
        tmp_snapshot_t snap;
        if (!tmp_unpack(&snap, rec)) {
            drop++;
            continue;
        }
        int64_t ts = tmp_snapshot_unix(&snap);
        if (ts >= 0 && ts <= unix_s) {
            drop++;
        } else {
            break;
        }
    }
    if (drop > 0) {
        if (drop > s_hdr.count) {
            drop = s_hdr.count;
        }
        s_hdr.count -= drop;
        (void)write_header();
        nvs_save_cursor();
    }
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t ring_log_wipe(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_file) {
        fclose(s_file);
        s_file = NULL;
    }
    remove(RING_PATH);
    s_file = fopen(RING_PATH, "w+b");
    if (!s_file) {
        xSemaphoreGive(s_lock);
        return ESP_FAIL;
    }
    setvbuf(s_file, NULL, _IOFBF, 512);
    reset_hdr();
    esp_err_t err = write_header();
    nvs_save_cursor();
    xSemaphoreGive(s_lock);
    return err;
}

bool ring_log_lock_flush(TickType_t wait)
{
    return s_flush && xSemaphoreTake(s_flush, wait) == pdTRUE;
}

void ring_log_unlock_flush(void)
{
    if (s_flush) {
        xSemaphoreGive(s_flush);
    }
}
