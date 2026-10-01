export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const API_PREFIX = '/v1';
export const API_BASE = `${API_URL}${API_PREFIX}`;
export const CHANNEL_COUNT = 8;
export const DRAIN_LIMIT = 32;
/** Keep pulling new ring samples over USB/BLE while Wi-Fi ingest is down. */
export const DRAIN_POLL_MS = 1000;
export const DRAIN_RETRY_MS = 2000;
export const SAMPLE_WARN_COUNT = 100_000;

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_NAME_PREFIX = 'TMP-';
export const USB_BAUD = 115200;
export const USB_BUFFER = 8192;
/** Espressif USB Serial/JTAG on ESP32-S3 native USB (GPIO 19/20). */
export const USB_ESP_VID = 0x303a;
export const USB_ESP_PID = 0x1001;
