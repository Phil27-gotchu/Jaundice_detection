/*
 * IoT Jaundice / Liver Screening Probe
 * TCS3200 + SSD1306 OLED + SD Card logging + local dashboard sync
 *
 * Board: ESP8266 NodeMCU
 *
 * Behavior:
 *   - Power on  → wait for button (OLED: "Press button")
 *   - Button    → measure for 5 seconds
 *   - After 5s  → show final reading on OLED, log to SD, sync to server, sensor idle
 *
 * Final pin map (no conflicts):
 *   TCS3200: VCC→3V3, GND→GND, S0→3V3(hardwired), S1→GND(hardwired),
 *            OE→GND(hardwired), S2→D3, S3→D4, OUT→D0
 *   OLED:    SDA→D2, SCL→D1
 *   SD card: SCK→D5, MISO→D6, MOSI→D7, CS→D8   (hardware SPI — fixed)
 *   Button:  RX (GPIO3) → button → GND
 */

#include <Wire.h>
#include <math.h>
#include <SPI.h>
#include <SD.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#if defined(ESP32)
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <WiFiClient.h>
#else
  #include <ESP8266WiFi.h>
  #include <ESP8266HTTPClient.h>
  #include <WiFiClient.h>
#endif

// =====================================================
// WIFI + LOCAL SERVER — values live in secrets.h (gitignored, see secrets.example.h)
// =====================================================
#include "secrets.h"

const char* WIFI_SSID = WIFI_SSID_VALUE;
const char* WIFI_PASS = WIFI_PASS_VALUE;

const char* SERVER_URL = SERVER_URL_VALUE;
const char* API_KEY    = API_KEY_VALUE;
const char* DEVICE_ID  = "esp32-probe-1";

// =====================================================
// OLED DISPLAY (I2C)
// =====================================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

#define OLED_SDA D2
#define OLED_SCL D1
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// =====================================================
// TCS3200 (S0/S1/OE hardwired externally — not GPIO)
// =====================================================
#define S2_PIN  D3
#define S3_PIN  D4
#define OUT_PIN D0

// Button on RX (GPIO3) — D7 and D8 are now used by the SD card
#define BTN_PIN 3

// =====================================================
// SD CARD (hardware SPI: SCK=D5, MISO=D6, MOSI=D7 — fixed, no #define needed)
// =====================================================
#define SD_CS_PIN D8
bool sdReady = false;
unsigned int readingCount = 0;

const unsigned long GLOW_MS = 5000UL;

bool sensorGlowing = false;
unsigned long glowUntilMs = 0;
bool lastBtnState = HIGH;

bool hasReading = false;
unsigned long lastR = 0;
unsigned long lastG = 0;
unsigned long lastB = 0;
float lastBG = 0;
float lastBR = 0;
float lastOD = 0;
unsigned long lastBeatMs = 0;
const unsigned long BEAT_MS = 8000UL;

void sensorOff() {
  // OE and S0/S1 are hardwired now — nothing to toggle here in software.
  // Kept as a no-op placeholder in case you revert to GPIO control later.
}

void sensorOn() {
  // Same — S0/S1/OE are fixed externally (20% scaling, output always enabled).
}

void showPressPrompt() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Jaundice Screening");
  display.println();
  display.println("Waiting...");
  display.println();
  display.println("Press button");
  display.println("to measure");
  display.display();
}

void showMeasuring() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Jaundice Screening");
  display.println();
  display.println("Measuring...");
  display.println("(5 seconds)");
  display.display();
}

void showReadingOnDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Jaundice Screening");
  display.print("R: "); display.println(lastR);
  display.print("G: "); display.println(lastG);
  display.print("B: "); display.println(lastB);
  display.print("B/G: "); display.println(lastBG, 3);
  display.print("B/R: "); display.println(lastBR, 3);
  display.print("OD: "); display.println(lastOD, 3);
  display.print("SD: "); display.println(sdReady ? "saved" : "FAILED");
  display.display();
}

// =====================================================
// SD CARD LOGGING
// =====================================================
void initSD() {
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("SD card init FAILED");
    sdReady = false;
    return;
  }
  sdReady = true;
  Serial.println("SD card init OK");

  // Write CSV header only if file doesn't exist yet
  if (!SD.exists("/readings.csv")) {
    File f = SD.open("/readings.csv", FILE_WRITE);
    if (f) {
      f.println("id,timestamp_ms,r,g,b,bg_ratio,br_ratio,od_diff");
      f.close();
      Serial.println("Created readings.csv with header");
    }
  }
}

bool logReadingToSD() {
  if (!sdReady) return false;

  File f = SD.open("/readings.csv", FILE_WRITE); // append mode
  if (!f) {
    Serial.println("Failed to open readings.csv for writing");
    return false;
  }

  readingCount++;
  f.print(readingCount);       f.print(",");
  f.print(millis());           f.print(",");
  f.print(lastR);              f.print(",");
  f.print(lastG);              f.print(",");
  f.print(lastB);              f.print(",");
  f.print(lastBG, 6);          f.print(",");
  f.print(lastBR, 6);          f.print(",");
  f.println(lastOD, 6);

  f.close();
  Serial.print("Logged reading #");
  Serial.print(readingCount);
  Serial.println(" to SD");
  return true;
}

void setup() {
  Serial.begin(9600);

  pinMode(S2_PIN, OUTPUT);
  pinMode(S3_PIN, OUTPUT);
  pinMode(OUT_PIN, INPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);

  // Start from actual pin level (avoid fake press at boot)
  delay(50);
  lastBtnState = digitalRead(BTN_PIN);

  Wire.begin(OLED_SDA, OLED_SCL);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("OLED not found!");
    while (true) { delay(1000); }
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Jaundice Screening");
  display.println();
  display.println("Init SD card...");
  display.display();

  initSD();
  delay(500);

  display.println(sdReady ? "SD OK" : "SD FAILED");
  display.display();
  delay(800);

  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Jaundice Screening");
  display.println();
  display.println("WiFi connecting...");
  display.display();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Jaundice Screening");
  display.println();
  if (WiFi.status() == WL_CONNECTED) {
    display.println("WiFi OK");
    display.println(WiFi.localIP());
    Serial.print("WiFi OK: ");
    Serial.println(WiFi.localIP());
#if defined(ESP8266)
    WiFi.setSleepMode(WIFI_NONE_SLEEP);
#endif
    bool beatOk = postHeartbeat();
    Serial.println(beatOk ? "Heartbeat OK" : "Heartbeat FAILED");
  } else {
    display.println("WiFi FAILED");
    display.println("SD + OLED only");
    Serial.println("WiFi failed — SD + OLED-only mode");
  }
  display.display();
  delay(1200);

  showPressPrompt();
  Serial.println("Ready — press button (RX pin) to measure");
}

unsigned long readColorFrequency() {
  unsigned long duration = pulseIn(OUT_PIN, LOW, 50000);
  if (duration == 0) return 0;
  return 1000000UL / duration;
}

void takeOneReading() {
  digitalWrite(S2_PIN, LOW);
  digitalWrite(S3_PIN, LOW);
  delay(100);
  lastR = readColorFrequency();

  digitalWrite(S2_PIN, HIGH);
  digitalWrite(S3_PIN, HIGH);
  delay(100);
  lastG = readColorFrequency();

  digitalWrite(S2_PIN, LOW);
  digitalWrite(S3_PIN, HIGH);
  delay(100);
  lastB = readColorFrequency();

  lastBG = (lastG > 0) ? (float)lastB / lastG : 0;
  lastBR = (lastR > 0) ? (float)lastB / lastR : 0;
  lastOD = log((float)lastG + 1.0f) - log((float)lastB + 1.0f);
  hasReading = true;

  Serial.print("R: "); Serial.print(lastR);
  Serial.print("  G: "); Serial.print(lastG);
  Serial.print("  B: "); Serial.print(lastB);
  Serial.print("  | B/G: "); Serial.print(lastBG, 4);
  Serial.print("  B/R: "); Serial.print(lastBR, 4);
  Serial.print("  OD_diff: "); Serial.println(lastOD, 4);
}

bool postReading(unsigned long redFreq, unsigned long greenFreq, unsigned long blueFreq,
                  float bgRatio, float brRatio, float odDiff) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/readings";

  if (!http.begin(client, url)) {
    Serial.println("HTTP begin failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(8000);

  String body = "{";
  body += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  body += "\"r\":" + String(redFreq) + ",";
  body += "\"g\":" + String(greenFreq) + ",";
  body += "\"b\":" + String(blueFreq) + ",";
  body += "\"bgRatio\":" + String(bgRatio, 6) + ",";
  body += "\"brRatio\":" + String(brRatio, 6) + ",";
  body += "\"odDiff\":" + String(odDiff, 6);
  body += "}";

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.print("Local POST "); Serial.print(code); Serial.print(" "); Serial.println(resp);
  return code >= 200 && code < 300;
}

bool postHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/heartbeat";

  if (!http.begin(client, url)) {
    Serial.println("Heartbeat begin failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(4000);

  String body = "{\"deviceId\":\"" + String(DEVICE_ID) + "\"}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.print("Heartbeat "); Serial.print(code); Serial.print(" "); Serial.println(resp);
  lastBeatMs = millis();
  return code >= 200 && code < 300;
}

void waitForButtonRelease() {
  unsigned long start = millis();
  while (digitalRead(BTN_PIN) == LOW) {
    delay(20);
    if (millis() - start > 10000UL) break;
  }
  delay(250);
  lastBtnState = HIGH;
}

void loop() {
  if (!sensorGlowing) {
    bool btnState = digitalRead(BTN_PIN);

    if (lastBtnState == HIGH && btnState == LOW) {
      delay(50);
      if (digitalRead(BTN_PIN) == LOW) {
        sensorGlowing = true;
        glowUntilMs = millis() + GLOW_MS;
        showMeasuring();
        Serial.println("Button pressed → measuring 5s");
      }
    }
    lastBtnState = digitalRead(BTN_PIN);
    if (millis() - lastBeatMs >= BEAT_MS) {
      postHeartbeat();
    }
    delay(20);
    return;
  }

  takeOneReading();

  if ((long)(millis() - glowUntilMs) >= 0) {  // wrap-safe after millis() overflows (~49 days)
    takeOneReading();
    sensorGlowing = false;
    showReadingOnDisplay();
    Serial.println("Done — reading held on OLED");

    bool sdOk = logReadingToSD();
    if (!sdOk) Serial.println("SD log failed");

    bool ok = postReading(lastR, lastG, lastB, lastBG, lastBR, lastOD);
    if (!ok) Serial.println("Local sync failed");
    else Serial.println("Local sync OK");

    waitForButtonRelease();
    Serial.println("Ready for next button press");
  }
}
