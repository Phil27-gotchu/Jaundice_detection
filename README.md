# Jaundice Monitor

ESP8266 NodeMCU probe (TCS3200 + OLED + SD card) plus a live HTML/CSS dashboard on your PC.

The probe takes a 5-second reflectance reading, shows it on the OLED, appends a row to the SD card, and POSTs the same values to a local Node server. The browser at **http://localhost:3000** only talks to that server — never to the ESP directly.

Readings are stored in **SQLite** (`server/data/readings.sqlite`) so restarting Node keeps history. The dashboard supports date-range filters and a daily summary table.

This is a **screening aid only — not a clinical diagnosis.**

## How the pieces connect

```
Button press → ESP measures RGB → OLED + SD card
                              ↘
                    POST /api/readings  →  node server :3000  →  dashboard in the browser
                    POST /api/heartbeat (idle, every 8s)
```

- **ESP → PC:** Wi‑Fi HTTP to `SERVER_URL` (this PC’s LAN IP, not `localhost`).
- **Browser → PC:** `http://localhost:3000`. The page is server-rendered HTML/CSS (SVG chart). It polls every 2 seconds.

## What you need

- Node.js **v22.5+** (uses built-in `node:sqlite` — no `npm install` for the local dashboard)
- ESP8266 NodeMCU
- TCS3200 colour sensor, SSD1306 OLED (I2C), micro-SD module, push button
- ESP and PC on the **same Wi‑Fi**

Arduino libraries: **Adafruit GFX**, **Adafruit SSD1306**, **SD**, **SPI**. Board: ESP8266 NodeMCU.

## Project layout

| Path | Role |
|------|------|
| `firmware/jaundice_monitor.ino` | NodeMCU firmware: measure, OLED, SD, Wi‑Fi sync |
| `firmware/secrets.example.h` | Template for `secrets.h` (Wi‑Fi, server URL, API key — gitignored) |
| `server/index.js` | Local dashboard + API |
| `server/store.js` | SQLite persistence for readings |
| `server/data/readings.sqlite` | Created at runtime (gitignored) |
| `server/seed.js` | Fake readings across several days (no ESP) |
| `public/index.html` | Dashboard HTML |
| `public/styles.css` | Dashboard CSS (Light / Dark) |
| `shared/dashboard.js` | Fills the HTML and draws the SVG chart |

## Run the dashboard

```bash
node server/index.js
```

Open **http://localhost:3000** (not a `file://` path).

The server prints an **ESP URL** such as `http://192.168.1.11:3000`. That is what belongs in firmware `SERVER_URL`.

### Fake data (no ESP)

```bash
node server/seed.js
```

Seeds ~24 samples across 5 days (`COUNT`, `DAYS` env vars). Optional `ts` on POST lets you backdate rows for testing summaries.

### Dashboard

- Latest **OD Diff**, **B/G**, **B/R**, raw RGB
- **Date range** filter (From / To) with Today · 7 days · All shortcuts
- Trend chart (R, G, B, B/G, OD) for the selected range
- **Daily summary** (samples, avg/min/max OD, avg B/G)
- Device id, sample count, recent table
- **Light / Dark** in the top right (saved in the browser)
- **Export CSV** (respects the current date filter) / **Refresh**; auto-refresh every 2 seconds

History lives in SQLite — restarting Node keeps the table. The SD card still keeps its own `readings.csv`.

| Status | Meaning |
|--------|---------|
| Waiting for device | Server is up; nothing posted yet |
| Device online | Reading or heartbeat in the last 30 seconds |
| Device offline | Probe was seen, then went quiet |
| API unreachable | Browser cannot reach Node (server stopped, or you opened the HTML file directly) |

## Firmware

Credentials live in `firmware/secrets.h`, which is gitignored so Wi‑Fi passwords never get committed. Copy the template once and fill it in before flashing:

```bash
cp firmware/secrets.example.h firmware/secrets.h
```

```cpp
#define WIFI_SSID_VALUE  "YOUR_WIFI_SSID"
#define WIFI_PASS_VALUE  "YOUR_WIFI_PASSWORD"
#define SERVER_URL_VALUE "http://192.168.1.11:3000"  // PC LAN IP — not localhost
#define API_KEY_VALUE    "jaundice-demo-key-change-me"
```

`API_KEY_VALUE` must match the server's `API_KEY`. If this PC’s Wi‑Fi IP changes, update `SERVER_URL_VALUE` and reflash.

### Probe behaviour

1. Power on → init SD → connect Wi‑Fi → OLED “Press button”
2. Button (RX / GPIO3) → measure 5 seconds
3. Show R, G, B, B/G, B/R, OD on OLED; **SD: saved** or **FAILED**
4. Append `/readings.csv` on the SD card
5. POST `/api/readings` if Wi‑Fi is up
6. While idle, POST `/api/heartbeat` every 8 seconds

If Wi‑Fi fails, the probe still uses OLED + SD (“SD + OLED only”).

Ratios on the ESP:

- **B/G** = B / G  
- **B/R** = B / R  
- **OD** = ln(G+1) − ln(B+1)

TCS3200 S0/S1/OE are hardwired (20% scaling, output always enabled). White LEDs on typical 8-pin modules stay on with power.

### Wiring (NodeMCU)

| Part | Pin |
|------|-----|
| TCS3200 VCC | 3V3 |
| TCS3200 GND | GND |
| TCS3200 S0 | 3V3 (hardwired) |
| TCS3200 S1 | GND (hardwired) |
| TCS3200 OE | GND (hardwired) |
| TCS3200 S2 | D3 |
| TCS3200 S3 | D4 |
| TCS3200 OUT | D0 |
| OLED SDA | D2 |
| OLED SCL | D1 |
| SD SCK | D5 (hardware SPI) |
| SD MISO | D6 |
| SD MOSI | D7 |
| SD CS | D8 |
| Button | RX (GPIO3) → button → GND |

The button shares UART RX. Release it (or unplug it) while uploading over USB.

SD CSV columns: `id,timestamp_ms,r,g,b,bg_ratio,br_ratio,od_diff`

## API

Default key `jaundice-demo-key-change-me` (`X-API-Key` where noted). Override with `API_KEY`. Port `3000` (`PORT`).

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/readings` | `X-API-Key` |
| `POST` | `/api/heartbeat` | `X-API-Key` |
| `GET` | `/api/readings?limit=80&from=YYYY-MM-DD&to=YYYY-MM-DD` | none |
| `GET` | `/api/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` | none |
| `GET` | `/api/export.csv?from=…&to=…` | none |
| `POST` | `/api/clear` (deletes all readings) | `X-API-Key` |
| `GET` | `/api/health` | none |

`from` / `to` are local calendar days (inclusive). You can also pass `fromMs` / `toMs` as epoch milliseconds. Optional `ts` on POST sets the reading timestamp (seed script uses this); it must be epoch milliseconds between 2020 and now. Request bodies are capped at 64 KB and `deviceId` at 64 characters.
```json
{
  "deviceId": "esp32-probe-1",
  "r": 1100,
  "g": 900,
  "b": 650,
  "bgRatio": 0.72,
  "brRatio": 0.59,
  "odDiff": 0.32
}
```
