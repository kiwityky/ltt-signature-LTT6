/*
 * Smart Scoring Pen firmware for ESP32-C3 Mini.
 *
 * Hardware summary:
 *  - ESP32-C3 Mini
 *  - MPU-6050 IMU over I2C (SDA: GPIO21, SCL: GPIO22)
 *  - Green status LED on GPIO10
 *  - Red status LED on GPIO9
 *  - Sync button on GPIO1 (INPUT_PULLUP)
 *
 * Required libraries (Arduino IDE Library Manager):
 *  - WiFi (bundled with ESP32 core)
 *  - Wire (bundled)
 *  - Adafruit MPU6050 (or any library exposing getAccelerometer & getGyro)
 *  - Firebase_ESP_Client by Mobizt (for Firestore access)
 *
 * Replace placeholders such as WIFI_SSID, WIFI_PASSWORD, API_KEY, etc.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <time.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Firebase_ESP_Client.h>

// Provide the token generation process info.
#include "addons/TokenHelper.h"
// Provide the RTDB payload printing info and other helper functions.
#include "addons/RTDBHelper.h"

// -------- User Configuration ---------
#define WIFI_SSID "{Wifi_SSID}"
#define WIFI_PASSWORD "{Wifi_Password}"

#define FIREBASE_API_KEY "<API_KEY>"
#define FIREBASE_PROJECT_ID "<PROJECT_ID>"
#define FIREBASE_USER_EMAIL "<USER_EMAIL>"
#define FIREBASE_USER_PASSWORD "<USER_PASSWORD>"

static const char *kFirestoreCollectionPath = "Users/UserID_12345/StudyData";
static const char *kDeviceId = "ESP32_Pen_01";

// GPIO assignments
constexpr uint8_t PIN_LED_GREEN = 10;
constexpr uint8_t PIN_LED_RED = 9;
constexpr uint8_t PIN_SYNC_BUTTON = 1;

// IMU configuration
constexpr uint8_t PIN_I2C_SDA = 21;
constexpr uint8_t PIN_I2C_SCL = 22;

// Motion detection thresholds
constexpr float ACCEL_THRESHOLD_G = 1.2f;          // g's
constexpr float GYRO_THRESHOLD_DPS = 50.0f;        // degrees per second

// Timing configuration
constexpr uint32_t LOOP_INTERVAL_MS = 10;          // 100 Hz loop
constexpr uint32_t SYNC_INTERVAL_MS = 30UL * 60UL * 1000UL; // 30 minutes
constexpr uint32_t INACTIVITY_SLEEP_MS = 5UL * 60UL * 1000UL; // 5 minutes

// Battery monitoring (optional)
constexpr int PIN_BATTERY = A0; // adjust to actual ADC pin if used
constexpr float BATTERY_LOW_VOLTAGE = 3.3f;
constexpr float ADC_REFERENCE_VOLTAGE = 3.3f; // depends on hardware
constexpr uint16_t ADC_MAX = 4095;
constexpr float VOLTAGE_DIVIDER_RATIO = 2.0f; // set to real divider (Vbattery/Vadc)

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
Adafruit_MPU6050 mpu;

volatile bool manualSyncRequested = false;

uint64_t activeStudyTimeMs = 0;
uint64_t lastActiveMillis = 0;
uint64_t lastSyncMillis = 0;
uint64_t lastLoopMillis = 0;

// Exponential moving average filter parameters
constexpr float ACCEL_ALPHA = 0.3f; // smoothing factor
constexpr float GYRO_ALPHA = 0.3f;

float filteredAccelMagnitude = 0.0f;
float filteredGyroMagnitude = 0.0f;

bool isWriting = false;

// Forward declarations
void connectWiFi();
void initFirebase();
void initMPU();
void updateMotionState();
void handleSync();
void enterDeepSleep();
float readBatteryVoltage();
void IRAM_ATTR onSyncButtonPressed();

void setup()
{
  Serial.begin(115200);
  delay(100);

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_SYNC_BUTTON, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(PIN_SYNC_BUTTON), onSyncButtonPressed, FALLING);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  initMPU();
  initFirebase();

  lastActiveMillis = millis();
  lastSyncMillis = millis();
  lastLoopMillis = millis();
}

void loop()
{
  uint32_t now = millis();
  if (now - lastLoopMillis < LOOP_INTERVAL_MS) {
    return;
  }
  lastLoopMillis = now;

  updateMotionState();

  // Battery monitor (optional)
  float batteryVoltage = readBatteryVoltage();
  if (batteryVoltage > 0 && batteryVoltage < BATTERY_LOW_VOLTAGE) {
    digitalWrite(PIN_LED_RED, HIGH);
  } else {
    digitalWrite(PIN_LED_RED, LOW);
  }

  // Automatic sync timer
  if (now - lastSyncMillis >= SYNC_INTERVAL_MS) {
    handleSync();
  }

  // Manual sync request
  if (manualSyncRequested) {
    manualSyncRequested = false;
    handleSync();
  }

  // Inactivity deep sleep
  if (!isWriting && (now - lastActiveMillis >= INACTIVITY_SLEEP_MS)) {
    Serial.println("Inactivity timeout reached. Entering deep sleep...");
    enterDeepSleep();
  }
}

void connectWiFi()
{
  Serial.printf("Connecting to %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint8_t attempt = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
    attempt++;
    if (attempt == 60) { // 30 seconds
      Serial.println("\nWiFi connection failed. Restarting...");
      digitalWrite(PIN_LED_RED, HIGH);
      delay(2000);
      ESP.restart();
    }
  }
  Serial.println("\nWiFi connected.");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void initMPU()
{
  if (!mpu.begin()) {
    Serial.println("Failed to find MPU6050 chip. Halting.");
    digitalWrite(PIN_LED_RED, HIGH);
    while (true) {
      delay(1000);
    }
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  Serial.println("MPU6050 initialized.");
}

void initFirebase()
{
  config.api_key = FIREBASE_API_KEY;
  config.project_id = FIREBASE_PROJECT_ID;

  auth.user.email = FIREBASE_USER_EMAIL;
  auth.user.password = FIREBASE_USER_PASSWORD;

  Firebase.reconnectWiFi(true);

  config.token_status_callback = tokenStatusCallback; // from TokenHelper

  if (!Firebase.signUp(&config, &auth, "", "")) {
    Serial.printf("Sign-up error: %s\n", config.signer.signupError.message.c_str());
  }

  Firebase.begin(&config, &auth);
  Serial.println("Firebase initialized.");
}

void updateMotionState()
{
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  // Convert acceleration (m/s^2) to g and compute magnitude
  float accelMagnitude = sqrtf(a.acceleration.x * a.acceleration.x +
                               a.acceleration.y * a.acceleration.y +
                               a.acceleration.z * a.acceleration.z) / 9.80665f;

  // Gyro magnitude in degrees/s
  float gyroMagnitude = sqrtf(g.gyro.x * g.gyro.x +
                              g.gyro.y * g.gyro.y +
                              g.gyro.z * g.gyro.z) * RAD_TO_DEG;

  // Exponential moving average filter smooths noise while keeping responsiveness.
  filteredAccelMagnitude = ACCEL_ALPHA * accelMagnitude + (1.0f - ACCEL_ALPHA) * filteredAccelMagnitude;
  filteredGyroMagnitude = GYRO_ALPHA * gyroMagnitude + (1.0f - GYRO_ALPHA) * filteredGyroMagnitude;

  bool currentlyWriting = (filteredAccelMagnitude > ACCEL_THRESHOLD_G) &&
                          (filteredGyroMagnitude > GYRO_THRESHOLD_DPS);

  uint32_t now = millis();
  if (currentlyWriting) {
    if (!isWriting) {
      Serial.println("Writing detected.");
    }
    digitalWrite(PIN_LED_GREEN, HIGH);
    activeStudyTimeMs += LOOP_INTERVAL_MS;
    lastActiveMillis = now;
  } else {
    if (isWriting) {
      Serial.println("Stopped writing.");
    }
    digitalWrite(PIN_LED_GREEN, LOW);
  }

  isWriting = currentlyWriting;
}

void handleSync()
{
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Attempting reconnection...");
    digitalWrite(PIN_LED_RED, HIGH);
    connectWiFi();
  }

  Serial.println("Preparing Firestore document...");

  time_t nowTs = time(nullptr);
  String timestampStr;
  if (nowTs < 100000) {
    timestampStr = "millis_";
    timestampStr += String(millis());
  } else {
    struct tm timeInfo;
    gmtime_r(&nowTs, &timeInfo);
    char buffer[32];
    strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
    timestampStr = buffer;
  }

  FirebaseJson content;
  content.set("fields/Timestamp/stringValue", timestampStr);
  content.set("fields/ActiveTimeSeconds/integerValue", String(activeStudyTimeMs / 1000));
  content.set("fields/DeviceID/stringValue", kDeviceId);

  String documentPath = kFirestoreCollectionPath;
  documentPath += "/";
  documentPath += String((uint32_t)millis());

  String jsonPayload;
  content.toString(jsonPayload, false); // produce raw JSON string

  if (Firebase.Firestore.createDocument(&fbdo, FIREBASE_PROJECT_ID, "", documentPath.c_str(), jsonPayload.c_str())) {
    Serial.println("Data synced successfully to Firestore.");
    activeStudyTimeMs = 0;
    lastSyncMillis = millis();
    digitalWrite(PIN_LED_RED, LOW);
  } else {
    Serial.printf("Failed to sync data: %s\n", fbdo.errorReason().c_str());
    digitalWrite(PIN_LED_RED, HIGH);
  }
}

void enterDeepSleep()
{
  // Configure the sync button as wake-up source
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_SYNC_BUTTON, 0); // wake on LOW
  esp_deep_sleep_start();
}

float readBatteryVoltage()
{
  // Return negative if monitoring not configured
  if (PIN_BATTERY < 0) {
    return -1.0f;
  }

  uint16_t raw = analogRead(PIN_BATTERY);
  float voltage = (raw / (float)ADC_MAX) * ADC_REFERENCE_VOLTAGE * VOLTAGE_DIVIDER_RATIO;
  return voltage;
}

void IRAM_ATTR onSyncButtonPressed()
{
  manualSyncRequested = true;
}

/*
 * Motion Filtering Notes:
 * An exponential moving average (EMA) is applied separately to the magnitude
 * of the accelerometer and gyroscope readings. EMA reduces high-frequency noise
 * coming from natural hand tremors while preserving the underlying movement
 * trend. Only when both filtered magnitudes exceed configurable thresholds is
 * the motion considered "writing", which reliably correlates with purposeful
 * pen strokes rather than incidental movement.
 */
