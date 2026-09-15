# Jaundice Monitor

Low-cost RGB reflectance probe plus a live dashboard on your PC. An ESP (NodeMCU / ESP32) takes a TCS3200 colour reading, posts it to a local Node server, and the page at **http://localhost:3000** shows the latest values, a trend chart, and a readings table.

This is a **screening aid only — not a clinical diagnosis.**

## What you need

- [Node.js](https://nodejs.org/) (v18 or newer is fine)
- Optional: ESP8266 NodeMCU (or ESP32), TCS3200 colour sensor, SSD1306 OLED, push button
- ESP and PC on the **same Wi‑Fi** if you use the hardware

No `npm install` is required for the local dashboard.

## Project layout

| Path | Role |
|------|------|
| `server/index.js` | Local server: dashboard HTML + ingest API |
| `server/seed.js` | Posts fake readings (no ESP needed) |
| `cloudflare/public/` | Dashboard HTML and CSS |
| `shared/dashboard.js` | Builds the HTML page and SVG chart |
| `firmware/jaundice_monitor.ino` | ESP probe firmware |
| `cloudflare/` | Cloudflare Worker (parked for later) |

## Run the dashboard

From the project folder:

```bash
node server/index.js
```

Open **http://localhost:3000**

The server prints a LAN address such as `http://192.168.x.x:3000`. Use that for the ESP, not `localhost`.

### Fake data (no ESP)

In a second terminal, from the same folder:

```bash
node server/seed.js
```

Reload the dashboard. You should see metrics, a trend chart, and a table.

### Status messages

| Status | Meaning |
|--------|---------|
| Waiting for device | Server is up; no probe data yet |
| Device online | Probe posted a reading or heartbeat in the last 30 seconds |
| Device offline | Probe was seen, but not recently |
| API unreachable | The browser page cannot reach the Node server (server stopped, or the file was opened as `file://` instead of `http://localhost:3000`) |

Light / Dark colour mode is in the top-right of the page and is remembered in the browser.

**Export CSV** downloads all stored readings. **Refresh** pulls the latest data without a full page reload. The page also polls every 2 seconds.

Readings live in memory only. Restarting the server clears them.

## Point the ESP at your PC

1. Start the server and copy the printed **ESP URL** (your PC’s LAN IP, port 3000).
2. In `firmware/jaundice_monitor.ino` set:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://192.168.x.x:3000";  // not localhost
const char* API_KEY    = "jaundice-demo-key-change-me";
```

`API_KEY` must match the server (default `jaundice-demo-key-change-me`).

3. Flash the board. Keep the ESP on the same Wi‑Fi as the PC.

### Probe behaviour

- Power on → OLED: “Press button”
- Button → measure for 5 seconds
- After 5 seconds → final reading on the OLED; values are posted to `/api/readings`
- Heartbeats go to `/api/heartbeat` so the dashboard can show **Device online** between measurements

### TCS3200 wiring (8-pin, NodeMCU)

| Sensor | Board |
|--------|--------|
| VCC | 3V3 |
| GND | GND |
| S0 | D0 |
| S1 | D1 |
| S2 | D2 |
| S3 | D3 |
| OUT | D5 |
| OE | D8 |
| Button | D7 → button → GND |
| OLED SDA | D4 |
| OLED SCL | D6 |

White LEDs on typical 8-pin TCS3200 modules are tied to VCC and stay on with power.

## API

Default key: `jaundice-demo-key-change-me` (header `X-API-Key` where noted). Override with `API_KEY`. Port defaults to `3000` (`PORT`).

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/readings` | `X-API-Key` |
| `POST` | `/api/heartbeat` | `X-API-Key` |
| `GET` | `/api/readings?limit=80` | none |
| `GET` | `/api/export.csv` | none |
| `POST` | `/api/clear` | `X-API-Key` |
| `GET` | `/api/health` | none |

Example reading body:

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

## Cloudflare

`cloudflare/` still has Worker code if you want to host the dashboard later. The local path is `node server/index.js`.
