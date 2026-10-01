# Hardware (ESP32-S3-DevKitC-1 N16R8)

Eight **103** NTCs (10 kΩ @ 25 °C) plus a DS3231M. Ignore the module’s 24C32, SQW, and 32K pins.

```
3.3V -- 10k 1% --+-- ADCx -- 100nF to GND
                 |
               NTC 103
                 |
                GND
```

## Pinout

| Function | GPIO | Notes |
|----------|------|-------|
| NTC 0–7 | **1, 2, 4, 5, 6, 7, 8, 9** | ADC1 only (Wi‑Fi). Skip GPIO3 (strap). |
| I2C SDA | **21** | DS3231M `0x68` |
| I2C SCL | **47** | |
| WS2812 | **48** | Onboard RGB on this N16R8 / v1.0 |
| USB D−/D+ | 19 / 20 | Native USB: JSON for Web Serial. **Not** IDF console. |
| UART0 TX/RX | 43 / 44 | CP2102: `idf.py flash/monitor` and logs |
| Leave unused | 0, 35–37, 38 | BOOT, OPI PSRAM, LED alt (v1.1) |

## BOM (per device)

| Qty | Part |
|-----|------|
| 1 | ESP32-S3-DevKitC-1 **N16R8** |
| 1 | DS3231M module (I2C) |
| 8 | NTC 103 (10 kΩ @ 25 °C, typically B3950) |
| 8 | 10 kΩ 1% metal film |
| 8 | 100 nF (ADC pin to GND) |

Shared: 3.3 V and GND. Do **not** excite the dividers from 5 V.

## USB-C connectors

The DevKit has two USB-C ports. They must stay on different jobs:

| Port | Use |
|------|-----|
| Native USB (J3 / GPIO19-20) | Chromium Web Serial JSON bridge |
| UART USB (CP2102) | Flash and serial logs |

Default probe math: `R25=10000`, `B=3950`, 12-bit ADC, 11 dB attenuation, 64-sample average.
