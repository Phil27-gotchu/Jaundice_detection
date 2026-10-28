# PROJECT REPORT

## An IoT-Based Framework for Non-Invasive Adult Jaundice Monitoring Using Multi-Wavelength Skin Reflectance and Melanin-Corrected Optical Features

---

### Document control

| Item | Detail |
|------|--------|
| Project type | Undergraduate / final-year IoT + embedded systems project |
| Domain | Biomedical sensing, embedded IoT, optical reflectance |
| Target population (prototype) | Adults (liver / biliary / hemolytic screening context) |
| Process model | Incremental |
| Sensing hardware | TCS3200 color sensor + NodeMCU ESP8266 |
| Local UI | OLED (on-device) + Node.js dashboard (`localhost:3000`) |

---

## 1. Abstract

This report describes the design and implementation of a low-cost IoT reflectance probe for non-invasive estimation of jaundice-related optical signals in adults. The probe illuminates / senses skin-reflected light using a TCS3200 color sensor under red, green, and blue filter modes, computes melanin-reducing features (B/G, B/R, and optical density difference), and presents results on an SSD1306 OLED. Measurement is started only by a push button, runs for a fixed five-second window, then holds the last reading on the display. Each completed sample is posted over Wi-Fi to a local Node.js server that provides live metrics, trend charts, and CSV export. The work is positioned as a **screening aid** complementary to serum bilirubin testing, not as a diagnostic device.

---

## 2. Introduction

### 2.1 Clinical background

In adults, visible jaundice usually indicates elevated bilirubin from one of three mechanisms: hepatocellular damage (e.g. viral hepatitis, alcohol-related or metabolic liver disease), biliary obstruction (e.g. stones, tumors), or hemolysis. Total serum bilirubin (TSB) remains the reference measurement but requires venipuncture and laboratory processing.

Optical methods exploit the fact that bilirubin absorbs strongly in the blue region of the visible spectrum (~450–460 nm) and comparatively less in green and red. Hospital transcutaneous bilirubinometers apply that principle with calibrated dual- or multi-wavelength optics. This project implements the same principle with commodity components suitable for an academic IoT build.

### 2.2 Motivation for this build

1. **Cost:** Clinical TcB meters are expensive relative to a student/clinic screening prototype budget.
2. **Logging:** Many demos stop at Serial Monitor; this system logs to a dashboard with CSV export for later analysis.
3. **Feature design:** Raw RGB alone mixes bilirubin signal with melanin and overall reflectance; ratio and OD-difference features are computed explicitly on the device.
4. **Us workflow:** Button-triggered acquisition avoids continuous noisy streaming and gives a clear “measure → hold result” interaction.

### 2.3 Problem statement

To design, implement, and demonstrate an ESP8266-based reflectance measurement system that (i) acquires TCS3200 R/G/B frequency readings under a button-gated 5-second window, (ii) computes B/G, B/R, and OD-difference features, (iii) displays and holds results on OLED, and (iv) synchronizes samples to a local web dashboard with CSV export—for adult jaundice-related optical screening experiments.

---

## 3. Literature context and positioning

Prior work includes dedicated TcB instruments, smartphone-image bilirubin estimators, and several student/academic RGB or TCS3200 demos. Recurring limitations are: melanin interference, ambient light sensitivity, small or non-local datasets, and single-shot devices without a monitoring framework.

**This project’s concrete contribution (prototype level):**

- End-to-end **IoT logging framework** (device → HTTP API → dashboard → CSV), not only a sensor demo.
- **On-device melanin-oriented features** (B/G, B/R, OD) rather than raw blue alone.
- **Button-gated acquisition** with last-value hold, matching a practical screening interaction.
- Explicit framing for **adult** liver/biliary screening optics (same bilirubin molecule; different clinical use case than neonatal kernicterus programs).

Claims are limited to what was built: a working optical + IoT pipeline. Clinical accuracy requires paired TSB/TcB calibration, which is listed under future work.

---

## 4. Objectives

| ID | Objective | Status in build |
|----|-----------|-----------------|
| O1 | Assemble TCS3200 + OLED + NodeMCU probe | Implemented |
| O2 | Read R, G, B filter frequencies via S2/S3 selection | Implemented |
| O3 | Compute B/G, B/R, OD on firmware | Implemented |
| O4 | Button (D7) starts 5 s measure; then hold OLED values | Implemented |
| O5 | HTTP POST to local dashboard; live UI | Implemented |
| O6 | Export history as CSV | Implemented |
| O7 | Follow Incremental development with testable stages | Followed |

---

## 5. System requirements

### 5.1 Functional requirements

| ID | Requirement |
|----|-------------|
| FR1 | On power-up, system shall wait for a button press before starting a measurement cycle. |
| FR2 | On button press, system shall enable sensing for 5 seconds and acquire R/G/B samples. |
| FR3 | System shall compute bgRatio, brRatio, and odDiff from the latest R/G/B frequencies. |
| FR4 | After the window, system shall disable sensing enable lines and keep the last reading on the OLED. |
| FR5 | System shall POST the completed sample JSON to the configured local server URL. |
| FR6 | Dashboard shall show latest metrics, trends, online status, and recent rows. |
| FR7 | User shall be able to download stored readings as CSV. |

### 5.2 Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR1 | Probe powered from USB / NodeMCU 3.3 V rail for TCS3200 and OLED. |
| NFR2 | Measurement window fixed at 5 seconds for repeatable demos. |
| NFR3 | API protected by shared `X-API-Key` on POST. |
| NFR4 | Screening disclaimer on dashboard: not a clinical diagnosis. |

---

## 6. Hardware design

### 6.1 Bill of materials (as used)

| Component | Role |
|-----------|------|
| NodeMCU ESP8266 | MCU, Wi-Fi, GPIO |
| TCS3200 (8-pin module) | Color / reflectance frequency sensor |
| SSD1306 0.96″ I2C OLED | Local readout |
| Tactile push button | Measure trigger |
| Jumper wires / breadboard or soldered harness | Interconnect |

### 6.2 Pin map (matches current firmware)

**TCS3200**

| TCS3200 | NodeMCU |
|---------|---------|
| VCC | 3V3 |
| GND | GND |
| S0 | D0 |
| S1 | D1 |
| S2 | D2 |
| S3 | D3 |
| OUT | D5 |
| OE | D8 |

**OLED**

| OLED | NodeMCU |
|------|---------|
| VCC | 3V3 |
| GND | GND |
| SDA | D4 |
| SCL | D6 |

**Button:** D7 ↔ switch ↔ GND (internal pull-up enabled in firmware).

### 6.3 Sensing control

| Mode | S0 | S1 | OE | Meaning in firmware |
|------|----|----|-----|---------------------|
| Idle / off | LOW | LOW | HIGH | Chip power-down; output disabled (OE active-low) |
| Measure | HIGH | LOW | LOW | ~20% frequency scaling; output enabled |

**Important hardware note:** On common 8-pin TCS3200 boards, the white LEDs are hardwired to VCC. They remain illuminated whenever the module is powered. Firmware controls **sensing enable**, not those LEDs. Ambient light should still be blocked at the probe tip during measurement.

### 6.4 Filter selection (R / G / B)

| Channel | S2 | S3 |
|---------|----|----|
| Red | LOW | LOW |
| Green | HIGH | HIGH |
| Blue | LOW | HIGH |

Frequency on OUT is measured with `pulseIn` and converted to an approximate frequency value used as the channel intensity proxy.

---

## 7. Software design

### 7.1 Firmware architecture (`jaundice_monitor.ino`)

1. **setup:** Configure GPIOs; `sensorOff()`; connect Wi-Fi; init OLED; show “Press button to measure”.
2. **Idle loop:** Detect falling edge on D7 (debounced).
3. **Measure window (5 s):** `sensorOn()`; repeatedly sample R→G→B; update feature variables; OLED shows measuring / live values as implemented.
4. **Window end:** Final sample; `sensorOff()`; hold values on OLED; HTTP POST once; wait until button is released; re-arm for next press.

**Features computed**

\[
\frac{B}{G},\quad \frac{B}{R},\quad OD = \ln(G+1)-\ln(B+1)
\]

(Implementation uses `log` in firmware on float frequencies with +1 for stability.)

**POST body example**

```json
{
  "deviceId": "esp32-probe-1",
  "r": 1200,
  "g": 980,
  "b": 640,
  "bgRatio": 0.65,
  "brRatio": 0.53,
  "odDiff": 0.42
}
```

Header: `X-API-Key: <shared secret>`  
URL: `http://<PC-LAN-IP>:3000/api/readings`  
(`SERVER_URL` in firmware must be the PC’s LAN IP, not `localhost`.)

### 7.2 Local server and dashboard

| Path | Method | Purpose |
|------|--------|---------|
| `/` | GET | Dashboard UI |
| `/api/readings` | POST | Ingest sample (API key) |
| `/api/readings?limit=N` | GET | History for UI |
| `/api/export.csv` | GET | CSV download |
| `/api/health` | GET | Liveness |

Dashboard panels: OD Diff, B/G, B/R, raw RGB, trend chart, device metadata, recent table, Export CSV / Refresh.

### 7.3 Melanin rationale (project-specific)

Melanin reduces reflectance across visible wavelengths. Using **ratios** and **OD difference** between green and blue reduces shared pigmentation effects relative to raw blue alone. Residual bias can remain; commercial TcB devices also report skin-tone-related error. Hence features are “melanin-reducing,” not “melanin-eliminating.”

---

## 8. Process model justification

**Selected model: Incremental**

| Criterion | Project fact | Why Incremental |
|-----------|--------------|-----------------|
| Requirement stability | Scope shifted (neonate → adult; raw RGB → ratios; button workflow) | Allows revision between increments |
| Structure | Circuit → features → Wi-Fi → dashboard → CSV | Natural vertical slices |
| Deadline | Semester-style checkpoints | Each increment is demoable |
| Risk | Pin/button boot issues, Wi-Fi path, optical noise | Fix early increments before depending on them |

Waterfall was rejected because requirements were not frozen. Spiral was rejected as process-heavy for this team size. Agile ceremonies were not formally run; Incremental matches the actual build order without ceremony overhead.

---

## 9. Implementation timeline (logical increments)

1. **Sensor + OLED** — verify R/G/B frequencies on display/Serial.  
2. **Button + OE gating** — no auto-measure at boot; 5 s window; hold result; re-press works after release.  
3. **Feature math** — B/G, B/R, OD on Serial/OLED.  
4. **Wi-Fi sync** — POST to Node server; dashboard online/offline and charts.  
5. **CSV export** — download history for reports/plots.

---

## 10. Testing and observations

| Test | Expected | Observed / note |
|------|----------|-----------------|
| Power-up | OLED waiting prompt; no measure until press | After fixing button pin (not D8 for button), idle wait works |
| Button press | 5 s measuring | Works |
| After 5 s | Values held | Works |
| Second press | New 5 s cycle after release | Fixed by explicit wait-for-release re-arm |
| Wi-Fi POST | Dashboard updates | Requires correct `SERVER_URL` LAN IP and running `node server/index.js` |
| USB upload | Port present | Flaky USB (`ttyUSB0` missing / error -71) is environmental, not logic |
| LED extinguish | Software off | Not possible on 8-pin VCC-tied LED modules |

---

## 11. Results (engineering)

Deliverables produced:

1. Wired NodeMCU + TCS3200 + OLED + button probe matching the pin table above.  
2. Firmware implementing gated acquisition, features, OLED hold, and HTTP ingest.  
3. Local dashboard with live trends and CSV export.  
4. Documented optical feature rationale and adult clinical framing.

Quantitative clinical accuracy (mg/dL vs TSB) is **not** claimed in this report without a paired calibration dataset.

---

## 12. Limitations

1. **LED hardware:** Module white LEDs stay on with VCC.  
2. **Ambient light:** Probe must contact skin / be shielded.  
3. **No bilirubin fraction:** Total optical proxy only.  
4. **Calibration:** Mapping features → mg/dL needs hospital/lab paired data.  
5. **Campus Wi-Fi:** Client isolation can block ESP↔PC; hotspot or open LAN may be required.  
6. **Pseudojaundice:** Carotenemia can yellow skin without bilirubin elevation; optical skin-only methods can confuse this (scleral cross-check is clinical practice, not implemented here).

---

## 13. Future work

1. Paired collection of probe features vs TSB or clinical TcB on consenting adults (ethics-approved).  
2. Train a compact regression model on B/G, B/R, OD (+ age, if collected); compare raw RGB vs ratio features.  
3. Optional MOSFET switching of module VCC to extinguish hardwired LEDs between measurements.  
4. Light-sealed probe tip enclosure.  
5. Re-enable Cloudflare Workers deployment when moving beyond localhost demos.

---

## 14. Conclusion

The project implements a specific, working IoT reflectance pipeline for adult jaundice-related optical screening: TCS3200 multi-filter sensing on ESP8266, melanin-oriented B/G, B/R, and OD features, button-triggered five-second acquisition with OLED hold, and a local dashboard with CSV export. Development followed an Incremental model aligned with the hardware–software dependency chain. The system is suitable for demonstration and as a platform for calibrated clinical studies; it is not a substitute for laboratory bilirubin testing.

---

## Appendix A — API quick reference

```
POST /api/readings
Header: X-API-Key: jaundice-demo-key-change-me
Body: { "r", "g", "b", "bgRatio", "brRatio", "odDiff", "deviceId"? }

GET  /api/readings?limit=80
GET  /api/export.csv
GET  /api/health
```

## Appendix B — How to run the dashboard

```bash
node server/index.js
# open http://localhost:3000
# set firmware SERVER_URL to http://<this-PC-LAN-IP>:3000
```

## Appendix C — Disclaimer

This device and software are for academic demonstration and research prototyping only. They must not be used as the sole basis for medical diagnosis or treatment decisions.
