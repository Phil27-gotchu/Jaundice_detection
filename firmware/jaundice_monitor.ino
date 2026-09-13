/*
 * IoT Jaundice / Liver Screening Probe
 * TCS3200 + SSD1306 OLED → local dashboard on your PC
 *
 * Board: ESP8266 NodeMCU
 *
 * Behavior:
 *   - Power on  → wait for button (OLED: "Press button")
 *   - Button    → measure for 5 seconds
 *   - After 5s  → show final reading on OLED, sensor idle
 *
 * 8-pin TCS3200 wiring:
 *   VCC→3V3, GND→GND, S0→D0, S1→D1, S2→D2, S3→D3, OUT→D5, OE→D8
 *   Button: D7 → button → GND
 *
 * Note: white LEDs on 8-pin modules are wired to VCC — they stay on
 * with power. That cannot be turned off in software.
 */

#include <Wire.h>
#include <math.h>
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
// WIFI + LOCAL SERVER
// =====================================================
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

const char* SERVER_URL = "http://YOUR_PC_IP:3000";
const char* API_KEY    = "jaundice-demo-key-change-me";
const char* DEVICE_ID  = "esp32-probe-1";

// =====================================================
// OLED DISPLAY (I2C)
// =====================================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

#define OLED_SDA D4
#define OLED_SCL D6
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  -1
);

// =====================================================
// TCS3200 (8-pin) + BUTTON
// =====================================================
#define S0_PIN  D0
#define S1_PIN  D1
#define S2_PIN  D2
#define S3_PIN  D3
#define OUT_PIN D5
#define OE_PIN  D8   // OE here (D8 is LOW at boot = safe for ESP8266)

// Button on D7 (NOT D8 — D8 is always LOW from boot pulldown)
#define BTN_PIN D7

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
  digitalWrite(OE_PIN, HIGH);  // disable output (OE active-LOW)
  digitalWrite(S0_PIN, LOW);
  digitalWrite(S1_PIN, LOW);
}

void sensorOn() {
  digitalWrite(S0_PIN, HIGH);  // 20% scaling
  digitalWrite(S1_PIN, LOW);
  digitalWrite(OE_PIN, LOW);   // enable output
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
  display.print("R: ");
  display.println(lastR);
  display.print("G: ");
  display.println(lastG);
  display.print("B: ");
  display.println(lastB);
  display.print("B/G: ");
  display.println(lastBG, 3);
  display.print("B/R: ");
  display.println(lastBR, 3);
  display.print("OD: ");
  display.println(lastOD, 3);
  display.display();
}

void setup() {
  Serial.begin(9600);

  pinMode(S0_PIN, OUTPUT);
  pinMode(S1_PIN, OUTPUT);
  pinMode(S2_PIN, OUTPUT);
  pinMode(S3_PIN, OUTPUT);
  pinMode(OUT_PIN, INPUT);
  pinMode(OE_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);

  sensorOff();

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
    display.println("Local OLED only");
    Serial.println("WiFi failed — OLED-only mode");
  }
  display.display();
  delay(1200);

  showPressPrompt();
  Serial.println("Ready — press button on D7 to measure");
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

  Serial.print("R: ");
  Serial.print(lastR);
  Serial.print("  G: ");
  Serial.print(lastG);
  Serial.print("  B: ");
  Serial.print(lastB);
  Serial.print("  | B/G: ");
  Serial.print(lastBG, 4);
  Serial.print("  B/R: ");
  Serial.print(lastBR, 4);
  Serial.print("  OD_diff: ");
  Serial.println(lastOD, 4);
}

bool postReading(
  unsigned long redFreq,
  unsigned long greenFreq,
  unsigned long blueFreq,
  float bgRatio,
  float brRatio,
  float odDiff
) {
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

  Serial.print("Local POST ");
  Serial.print(code);
  Serial.print(" ");
  Serial.println(resp);

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

  Serial.print("Heartbeat ");
  Serial.print(code);
  Serial.print(" ");
  Serial.println(resp);

  lastBeatMs = millis();
  return code >= 200 && code < 300;
}

void waitForButtonRelease() {
  // Don't start another run until finger is off the button
  unsigned long start = millis();
  while (digitalRead(BTN_PIN) == LOW) {
    delay(20);
    if (millis() - start > 10000UL) break; // safety
  }
  delay(250); // debounce release
  lastBtnState = HIGH;
}

void loop() {
  // Idle: watch for a new press
  if (!sensorGlowing) {
    bool btnState = digitalRead(BTN_PIN);

    if (lastBtnState == HIGH && btnState == LOW) {
      delay(50); // debounce press
      if (digitalRead(BTN_PIN) == LOW) {
        sensorGlowing = true;
        glowUntilMs = millis() + GLOW_MS;
        sensorOn();
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

  // Measuring window
  takeOneReading();

  if (millis() >= glowUntilMs) {
    takeOneReading();
    sensorOff();
    sensorGlowing = false;
    showReadingOnDisplay();
    Serial.println("Done — reading held on OLED");

    bool ok = postReading(lastR, lastG, lastB, lastBG, lastBR, lastOD);
    if (!ok) Serial.println("Local sync failed");
    else Serial.println("Local sync OK");

    // Re-arm for the NEXT press (this was missing / stuck before)
    waitForButtonRelease();
    Serial.println("Ready for next button press");
  }
}
