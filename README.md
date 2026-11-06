# Jaundice Monitor
<img width="1280" height="699" alt="image" src="https://github.com/user-attachments/assets/c04c5221-7b4e-4f01-92b4-bea33ec4399c" />
<img width="1600" height="992" alt="image" src="https://github.com/user-attachments/assets/ce9a0a8c-2497-4114-bf4c-5f169a98f273" />
<img width="1440" height="1080" alt="image" src="https://github.com/user-attachments/assets/4b1c903a-e6df-4b25-b926-5d772b62a140" />
<img width="788" height="741" alt="image" src="https://github.com/user-attachments/assets/6b0b9efa-1de5-490d-9944-4274ac1e457e" />
<img width="1058" height="1280" alt="image" src="https://github.com/user-attachments/assets/5b947f0f-013a-4d02-84e7-546c6ae7c1e2" />

<img width="1280" height="900" alt="image" src="https://github.com/user-attachments/assets/1fc377b0-2974-4c8a-aa58-45bbd6664810" />

https://github.com/user-attachments/assets/e82b3212-3eca-4484-8a4e-a6971c654823


<img width="1440" height="1080" alt="image" src="https://github.com/user-attachments/assets/13d95789-dc1d-4d0c-ab9c-9d9fb362e4d1" />
<img width="1307" height="1600" alt="image" src="https://github.com/user-attachments/assets/d6afdbfa-c68d-4e2b-a0ed-5ceebbf161f9" />

ESP8266 NodeMCU probe (TCS3200 + OLED + SD card) plus a live HTML/CSS dashboard on your PC.

The probe takes a 5-second reflectance reading, shows it on the OLED, appends a row to the SD card, and POSTs the same values to a local Node server. The browser at **http://localhost:3000** only talks to that server — never to the ESP directly.

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
- **Cloudflare:** not used. `cloudflare/` is an optional Worker if you later host the dashboard on the internet. Local run is `node server/index.js`.

## What you need

- Node.js v18+ (no `npm install` for the local dashboard)
- ESP8266 NodeMCU
- TCS3200 colour sensor, SSD1306 OLED (I2C), micro-SD module, push button
- ESP and PC on the **same Wi‑Fi**

Arduino libraries: **Adafruit GFX**, **Adafruit SSD1306**, **SD**, **SPI**. Board: ESP8266 NodeMCU.

## Project layout

| Path | Role |
|------|------|
| `firmware/jaundice_monitor.ino` | NodeMCU firmware: measure, OLED, SD, Wi‑Fi sync |
| `server/index.js` | Local dashboard + API (in-memory history) |
| `server/seed.js` | Fake readings if you have no ESP |
| `cloudflare/public/index.html` | Dashboard HTML |
| `cloudflare/public/styles.css` | Dashboard CSS (Light / Dark) |
| `shared/dashboard.js` | Fills the HTML and draws the SVG chart |
| `cloudflare/` | Unused Worker + KV code (parked) |

## Run the dashboard

```bash
node server/index.js
```

Open **http://localhost:3000** (not a `file://` path).

The server prints an **ESP URL** such as `http://10.23.4.54:3000`. That is what belongs in firmware `SERVER_URL`.

### Fake data (no ESP)

```bash
node server/seed.js
```

### Dashboard

- Latest **OD Diff**, **B/G**, **B/R**, raw RGB
- Trend chart (R, G, B, B/G, OD)
- Device id, sample count, recent table
- **Light / Dark** in the top right (saved in the browser)
- **Export CSV** / **Refresh**; auto-refresh every 2 seconds

Server-side readings are **RAM only** — restarting Node clears the table. The SD card keeps its own `readings.csv`.

| Status | Meaning |
|--------|---------|
| Waiting for device | Server is up; nothing posted yet |
| Device online | Reading or heartbeat in the last 30 seconds |
| Device offline | Probe was seen, then went quiet |
| API unreachable | Browser cannot reach Node (server stopped, or you opened the HTML file directly) |

## Firmware

Edit `firmware/jaundice_monitor.ino` before flashing:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://10.23.4.54:3000";  // PC LAN IP — not localhost
const char* API_KEY    = "jaundice-demo-key-change-me";
const char* DEVICE_ID  = "esp32-probe-1";
```

`API_KEY` must match the server. If this PC’s Wi‑Fi IP changes, update `SERVER_URL` and reflash.

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
| `GET` | `/api/readings?limit=80` | none |
| `GET` | `/api/export.csv` | none |
| `POST` | `/api/clear` | `X-API-Key` |
| `GET` | `/api/health` | none |

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

