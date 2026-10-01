# Temperature monitor

ESP32-S3 DevKitC-1 (8× NTC 103 + DS3231M), a NestJS/Postgres API, and a Next.js dashboard. One operator, many devices. Samples buffer on flash while offline and flush over Wi‑Fi or a USB/BLE browser bridge. Alerts go out over Telegram and Twilio SMS.

## Layout

| Path | What |
|------|------|
| [`firmware/`](firmware/) | ESP-IDF `esp32s3` app, 17-byte LittleFS ring, native USB JSON + BLE NUS |
| [`apps/api/`](apps/api/) | NestJS, Prisma, Postgres, JWT cookie, Excel export, alerts |
| [`apps/web/`](apps/web/) | Next.js operator dashboard (Chromium for USB/BLE) |
| [`deploy/docker-compose.yml`](deploy/docker-compose.yml) | `postgres` + `api` + `web` |
| [`docs/hardware.md`](docs/hardware.md) | Pinout, divider, BOM |
| [`docs/protocol.md`](docs/protocol.md) | Packed record + local JSON + HTTPS ingest |

## Hardware

See [docs/hardware.md](docs/hardware.md). Short version:

- NTC 0–7 on GPIO **1, 2, 4, 5, 6, 7, 8, 9** (ADC1)
- DS3231M I2C on **SDA 21 / SCL 47**
- Native USB (GPIO 19/20): Web Serial JSON — **not** the IDF console
- CP2102 UART USB (GPIO 43/44): `idf.py flash/monitor`

## Run the stack

```bash
cp .env.example .env
# set OWNER_EMAIL, OWNER_PASSWORD, JWT_SECRET; optional TWILIO_* and TELEGRAM_BOT_TOKEN

docker compose -f deploy/docker-compose.yml up --build
```

Web: http://localhost:3000 — API: http://localhost:4000/v1

Local without Docker (Postgres must already be up):

```bash
npm install
cd apps/api && npx prisma migrate deploy && npm run dev   # uses repo-root .env
cd apps/web && npm run dev
```

## Firmware

```bash
cd firmware
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor   # CP2102 UART port
```

Host-side pack tests (no IDF):

```bash
make -C firmware/host_test
```

Claim a board from the dashboard with **Connect USB** (native USB-C) or **Connect Bluetooth** (`TMP-XXXX`). The page writes `apiBaseUrl` + device token so one firmware image works on LAN and in production.

On Linux, install `deploy/70-tempmon-usb.rules` so Chrome can open the native USB port:

```bash
sudo cp deploy/70-tempmon-usb.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
```

## Defaults

- Channel interval 10 s (minimum 1 s). Ring period is `min(enabled intervals)`.
- 17 bytes/snapshot × 86400 = **1.47 MB/day** at 1 Hz; N16R8 LittleFS holds several days.
- Disabled channels stored as ADC `0xFFE`. Server computes °C at ingest from the cal then in force.
- Each stored reading is the mean of the middle 50 % of 64 ADC samples (`TEMPMON_ADC_TRIM_PCT`), so a Wi-Fi TX burst that dips the rail for a few reads is discarded rather than averaged in.
- Wi-Fi ingest posts the ring on its own 5 s period (`TEMPMON_INGEST_PERIOD_MS`), not once per sample, to keep the radio quiet between readings.
