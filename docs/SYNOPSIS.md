# SYNOPSIS

## Project Title

**An IoT-Based Framework for Non-Invasive Adult Jaundice Monitoring Using Multi-Wavelength Skin Reflectance and Melanin-Corrected Optical Features**

---

## 1. Introduction

Jaundice in adults is a clinical sign of elevated bilirubin in blood and tissue, most often linked to hepatocellular injury, biliary obstruction, or hemolysis. The laboratory gold standard remains total serum bilirubin (TSB) from a venous blood sample. That method is accurate but invasive, requires phlebotomy and lab turnaround, and is poorly suited to repeated bedside or outpatient screening.

Commercial transcutaneous bilirubinometers (TcB) reduce the need for blood draws by measuring skin optical reflectance at selected wavelengths. Those devices are expensive, clinic-bound, and still show residual error related to melanin and skin optics. This project builds a low-cost IoT probe that uses the same optical principle—bilirubin absorbs strongly near blue (~450–460 nm) and less in green/red—and streams melanin-corrected features to a local monitoring dashboard.

---

## 2. Problem Statement

Existing non-invasive bilirubin estimation systems either (a) are priced beyond routine outpatient use, (b) report single-point readings without a simple digital log for follow-up, or (c) feed raw RGB intensities into models without explicit melanin-normalized features. Raw blue intensity confounds bilirubin with baseline pigmentation because melanin absorbs across the visible band. A portable ESP8266-based reflectance probe with ratio/optical-density features, button-triggered measurement, OLED readout, and CSV-capable local dashboard addresses that gap for adult screening contexts (liver / biliary / hemolytic concern), as a **screening aid**, not a diagnostic replacement for TSB.

---

## 3. Objectives

1. Design and assemble a reflectance probe using a TCS3200 color sensor, NodeMCU (ESP8266), SSD1306 OLED, and a push-button trigger.
2. Capture sequential R, G, and B channel frequencies under controlled filter selection on the TCS3200.
3. Compute melanin-reducing features on-device: **B/G**, **B/R**, and optical density difference **OD = log(G+1) − log(B+1)**.
4. Trigger measurement only on button press; run a fixed 5-second acquisition window; hold the last reading on the OLED.
5. Synchronize each completed reading over Wi-Fi (HTTP POST) to a local Node.js dashboard for live trends, device status, and CSV export.
6. Document the system under an **Incremental** process model suitable for hardware + IoT + data pipeline development.

---

## 4. Scope

| In scope | Out of scope |
|----------|----------------|
| Adult-oriented optical screening prototype | Neonatal clinical validation / NICU ethics pilot |
| Hardware probe + local OLED + local web dashboard | Cloud production deployment (Cloudflare deferred) |
| Melanin-corrected feature computation | Distinguishing conjugated vs unconjugated bilirubin |
| CSV export of stored readings | Regulatory clearance or clinical diagnosis claims |

---

## 5. Methodology (Incremental Model)

| Increment | Deliverable |
|-----------|-------------|
| 1 | TCS3200 + OLED circuit, firmware for R/G/B frequency readout |
| 2 | Button-gated 5 s measure window; OE control; last-value hold on display |
| 3 | Feature engineering (B/G, B/R, OD) on-device |
| 4 | Wi-Fi HTTP ingest to local Node server + live dashboard |
| 5 | CSV export and end-to-end validation of sync path |

---

## 6. System Overview

**Hardware:** NodeMCU ESP8266, TCS3200 (8-pin), 0.96″ SSD1306 I2C OLED, tactile switch (D7–GND).

**Firmware:** Arduino C++; sensor on only during measure window (S0/S1 + OE); POST JSON `{r,g,b,bgRatio,brRatio,odDiff,deviceId}` to `http://<PC-LAN-IP>:3000/api/readings`.

**Software:** Node.js local server; static dashboard (metrics, Chart.js trends, readings table); `GET /api/export.csv`.

**Optical basis:** Bilirubin preferential blue absorption; green/red used to form ratios that reduce (not eliminate) melanin bias.

---

## 7. Expected Outcome

A working portable prototype that, on each button press, acquires reflectance-derived R/G/B and melanin-corrected features for five seconds, displays the held result locally, and logs it to a localhost dashboard with CSV export—suitable for demonstration, calibration experiments, and further ML/clinical correlation work.

---

## 8. Limitations (stated clearly)

- White LEDs on typical 8-pin TCS3200 modules are hardwired to VCC and remain lit whenever the module is powered; software controls sensing enable (OE / power-down), not those LEDs.
- Device estimates optical proxies for bilirubin only; it does not replace TSB or fractionated LFTs.
- Population-specific calibration against serum bilirubin is required before clinical claims.

---

## 9. Conclusion

The project delivers a concrete IoT sensing-and-logging framework for non-invasive adult jaundice-related optical screening: multi-wavelength reflectance, melanin-corrected features, button-triggered acquisition, and a local monitoring UI with export—built and verified incrementally on ESP8266 hardware.
