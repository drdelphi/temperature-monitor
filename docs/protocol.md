# Wire protocol

Newline-delimited JSON on **native USB** (USB Serial/JTAG, GPIO19/20) and **BLE Nordic UART Service**. Same messages on both. Logs stay on UART0 / CP2102 (GPIO43/44).

Device identity is the Wi‑Fi STA MAC as 12 uppercase hex digits (`AABBCCDDEEFF`). BLE name is `TMP-` + last 4 hex.

## Packed snapshot (17 bytes)

Little-endian bit packing. Flash stores this only — no °C on the device.

### Time (bytes 0–4, 40 bits; 33 used)

| Bits | Field | Encoding |
|------|-------|----------|
| 0–6 | year | `year - 2000` (2000–2127) |
| 7–10 | month | 1–12 |
| 11–15 | day | 1–31 |
| 16–20 | hour | 0–23 |
| 21–26 | minute | 0–59 |
| 27–32 | second | 0–59 |
| 33–39 | spare | 0 |

### ADC (bytes 5–16, 96 bits)

Channel `i` occupies bits `[i*12, i*12+11]` of the 12-byte payload (bit 0 of byte 5 is the LSB of channel 0). Each value is a 12-bit ADC count 0–4095.

Disabled channels are stored as **0xFFE** (4094). 0 and 4095 remain valid readings.

## `wifiState`

| Value | Meaning |
|-------|---------|
| `ingesting` | STA associated **and** last HTTPS ingest succeeded |
| `failed` | STA up (or attempting) but last ingest failed |
| `down` | Credentials set, not associated |
| `unset` | No SSID stored |

The browser **drains the ring only when `wifiState !== "ingesting"`**. Two drainers are not allowed. When the station has internet, the browser pauses drain so HTTPS ingest can become healthy. The device releases the local flush lock on GOT_IP and after each drain batch so Wi-Fi can take over. Wi-Fi / internet has priority over USB and Bluetooth (same as the status LED).

## Durability

Every snapshot is appended to the LittleFS ring **before** any upload. Unacked records are never overwritten; if the ring is full, append fails until an ACK frees space.

The device erases stored records **only** after an ingest ACK with `ackedTs` (inclusive: drop RTC timestamps `<= ackedTs`):

- **Internet:** device `POST {apiBaseUrl}/ingest` → `{ "ack": true, "ackedTs": "<ISO>", "inserted": n }` → drop flash up to `ackedTs`.
- **USB / Bluetooth (no healthy Wi-Fi ingest):** the web app periodically sends `drain`, POSTs the `samples` batch to `/ingest`, then forwards `{ "type": "flush_ack", "ts": "<ackedTs>" }`.

If the HTTP status is not 2xx or `ackedTs` is missing, flash is left unchanged.

Live dashboard points come from **`ws://…/v1/stream`** after the API has saved rows. USB/BLE is a transport for stored batches, not a live display feed.

## ESP32 → host

```json
{"type":"hello","deviceId":"AABBCCDDEEFF","wifiState":"unset","unackedCount":12,"claimed":false,"name":"Probe box","configRev":1,"ssid":"","ip":"","gateway":"","netmask":"","dns":"","rssi":0,"internet":false,"wifiConnecting":false}
{"type":"samples","snapshots":[{"ts":"2026-10-01T10:00:05Z","adc":[2048,2048,2048,2048,2048,2048,2048,2048],"packed":"<base64 17 bytes>"}]}
{"type":"status","deviceId":"AABBCCDDEEFF","wifiState":"ingesting","unackedCount":0,"rssi":-51,"rtcUnix":1730000000,"configRev":3,"claimed":true,"ssid":"lab","ip":"192.168.1.42","gateway":"192.168.1.1","netmask":"255.255.255.0","dns":"192.168.1.1","internet":true,"wifiConnecting":false}
{"type":"wifi_scan","networks":[{"ssid":"lab","rssi":-51,"auth":"wpa2"}]}
```

`samples.snapshots` may omit `packed` (JSON-only) or omit `adc`/`ts` (packed-only). Receivers accept either.

`hello` / `status` Wi-Fi fields: `ssid`, `ip`, `gateway`, `netmask`, `dns`, `rssi`, `internet`, `wifiConnecting`. Empty strings when unset. `internet` is HTTP 204 or last HTTPS ingest success.

## Host → ESP32

```json
{"type":"drain","limit":32}
{"type":"flush_ack","ts":"2026-10-01T10:00:05Z"}
{"type":"set_config","configRev":3,"channels":[{"index":0,"name":"Freezer","enabled":true,"intervalSec":10,"offset":0,"gain":1,"bValue":3950}]}
{"type":"set_time","unixTime":1730000000}
{"type":"claim","token":"<device bearer>","apiBaseUrl":"https://example/v1"}
{"type":"set_wifi","ssid":"lab","password":"secret"}
{"type":"scan_wifi"}
{"type":"wipe_log"}
{"type":"factory_reset"}
{"type":"get_status"}
```

`flush_ack.ts` is inclusive: delete packed records with RTC timestamp `<= ts`.

`claim.apiBaseUrl` is the API origin **including** `/v1` or origin only — firmware treats a URL without a path as `{origin}/v1`. Wi-Fi is **not** part of claim; use `set_wifi` from the Wi-Fi menu. Empty `ssid` clears stored credentials. `scan_wifi` replies with `wifi_scan` (up to 16 unique SSIDs).

## HTTPS (claimed device)

`Authorization: Bearer <device_token>`

- `POST {apiBaseUrl}/ingest` body `{ "snapshots": [ ... ] }` → `{ "ack": true, "ackedTs": "<ISO>", "inserted": n }` (ACK only after the rows are in Postgres; `ackedTs` is the newest snapshot timestamp in that saved batch)
- `GET {apiBaseUrl}/devices/{deviceId}/config` → `{ configRev, pendingUnixTime, channels: [...] }`

Operator browser ingest uses the session cookie and **must** include `deviceId`.

## Probe math (server, at ingest)

Divider: `3.3V -- 10k -- ADC -- NTC -- GND`.

```
rOhm = 10000 * adc / (4095 - adc)
tempK = 1 / (1/298.15 + ln(rOhm/10000)/bValue)
tempC = gain * (tempK - 273.15) + offset
```

Skip `adc == 0xFFE`. Skip `adc <= 0` or `adc >= 4095` for R/T (store row with null temp if needed — v1 drops those rows).
