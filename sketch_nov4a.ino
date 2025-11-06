#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <MPU6050.h>
#include <ArduinoJson.h>
#include "time.h"

MPU6050 mpu;
WiFiClientSecure client;
// ======================
// 🌏 CẤU HÌNH NTP (ĐỒNG BỘ GIỜ THỰC)
// ======================
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 7 * 3600;  // GMT+7 cho Việt Nam
const int daylightOffset_sec = 0;

// ======================
// 🔧 CẤU HÌNH FIREBASE
// ======================
const char* API_KEY = "AIzaSyAB77Kezrrrd_MacPEDFPrcl2hPrnTGFk0";
const char* DATABASE_URL = "https://ltt5-e25a0-default-rtdb.asia-southeast1.firebasedatabase.app";
String penId = "LTT_6001";  // Mã riêng của cây bút này (mỗi bút 1 mã khác nhau)
String userPath = "/pens/" + penId + "/StudyData.json";

// ======================
// 🔧 BIẾN TOÀN CỤC
// ======================
String idToken = "";
String refreshToken = "";
unsigned long lastTokenTime = 0;
const unsigned long TOKEN_LIFETIME = 50UL * 60UL * 1000UL; // 50 phút

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 1000; // 1s

float prevRoll = 0, prevPitch = 0;
float roll = 0, pitch = 0;

// ======================
// 🔧 NGƯỠNG CHUYỂN ĐỘNG (ĐÃ TINH CHỈNH)
// ======================
const float START_THRESHOLD = 8.0;     // cần nghiêng rõ hơn
const float STOP_THRESHOLD  = 1.0;     // dao động nhỏ hơn thì coi là yên tĩnh
const int   STABLE_COUNT_NEEDED = 25;  // ~5s yên tĩnh (delay=200ms)
const int   MOTION_COUNT_NEEDED = 5;   // cần >=5 chu kỳ dao động
const unsigned long MAX_RECORD_MS = 15000; // tự dừng sau 15 giây
const unsigned long RESTART_DELAY_MS = 5000; // nghỉ 5s sau khi dừng

// ======================
bool getToken();
bool refreshIdToken();
void sendData(float roll, float pitch);
void readMPU();
void calibrateGyro();

// ======================
// 🚀 SETUP
// ======================
void setup() {
  Serial.begin(115200);
  delay(500);

  // 🌐 CẤU HÌNH WI-FI QUA PORTAL
  WiFiManager wm;
  wm.setConfigPortalBlocking(true);
  wm.setConfigPortalTimeout(180);
  bool connected = wm.autoConnect("LTT_Signature_Setup", "12345678");
  if (!connected) {
    Serial.println("❌ Không thể kết nối WiFi. Vui lòng cấu hình lại!");
    return;
  }

  Serial.print("✅ Đã kết nối WiFi: ");
  Serial.println(WiFi.localIP());
  client.setInsecure();
configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

Serial.print("⏳ Đang đồng bộ NTP...");
struct tm timeinfo;
if (!getLocalTime(&timeinfo)) {
  Serial.println("❌ Lỗi NTP!");
} else {
  Serial.println("✅ Giờ NTP đã đồng bộ!");
  Serial.printf("🕒 Giờ hiện tại: %02d:%02d:%02d\n",
                timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
}

  // 🔹 CẢM BIẾN MPU6050
  Wire.begin(8, 9); // SDA=8, SCL=9 (ESP32-C3 Mini)
  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println("❌ Không tìm thấy MPU6050!");
    while (true);
  }
  calibrateGyro();

  // 🔹 TOKEN FIREBASE
  if (getToken()) Serial.println("✅ Token ban đầu OK!");
  else Serial.println("❌ Lỗi lấy token!");
}

// ======================
// 🔁 LOOP CHÍNH
// ======================
void loop() {
  if (millis() - lastTokenTime > TOKEN_LIFETIME) refreshIdToken();

  readMPU();

  // ==== LỌC NHIỄU ====
  const float ALPHA = 0.85;  // làm mượt mạnh hơn
  static float smoothRoll = 0, smoothPitch = 0;
  smoothRoll = ALPHA * smoothRoll + (1 - ALPHA) * roll;
  smoothPitch = ALPHA * smoothPitch + (1 - ALPHA) * pitch;

  float deltaRoll = fabs(smoothRoll - prevRoll);
  float deltaPitch = fabs(smoothPitch - prevPitch);

  static bool isMoving = false;
  static int stableCount = 0;
  static int motionCount = 0;
  static unsigned long moveStart = 0;
  static unsigned long lastStopTime = 0;

  // ==== LOGIC PHÁT HIỆN ====
  if (!isMoving) {
    // chờ 5 giây sau khi dừng mới cho phép phát hiện lại
    if (millis() - lastStopTime < RESTART_DELAY_MS) {
      motionCount = 0;
    } else {
      if (deltaRoll > START_THRESHOLD || deltaPitch > START_THRESHOLD) {
        motionCount++;
        if (motionCount >= MOTION_COUNT_NEEDED) {
          isMoving = true;
          moveStart = millis();
          stableCount = 0;
          Serial.println("✏️ Bắt đầu ghi dữ liệu...");
        }
      } else {
        motionCount = 0;
      }
    }
  } else {
    if (deltaRoll < STOP_THRESHOLD && deltaPitch < STOP_THRESHOLD) {
      stableCount++;
    } else {
      stableCount = 0;
    }

    if (stableCount >= STABLE_COUNT_NEEDED || millis() - moveStart > MAX_RECORD_MS) {
      isMoving = false;
      motionCount = 0;
      lastStopTime = millis();
      Serial.println("💤 Đã dừng ghi (ổn định đủ lâu).");
    }
  }

  // ==== GỬI DỮ LIỆU ====
  if (isMoving) {
    unsigned long now = millis();
    if (now - lastSend >= SEND_INTERVAL) {
      lastSend = now;
      sendData(roll, pitch);
    }
  }

  prevRoll = smoothRoll;
  prevPitch = smoothPitch;
  delay(200);
}

// ======================
// 🔹 ĐỌC MPU6050
// ======================
void readMPU() {
  int16_t ax, ay, az, gx, gy, gz;
  static unsigned long timer = micros();
  unsigned long now = micros();
  float dt = (now - timer) / 1000000.0;
  timer = now;

  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
  float accel_x = ax / 4096.0;
  float accel_y = ay / 4096.0;
  float accel_z = az / 4096.0;

  float accel_roll = atan2(accel_y, accel_z) * 180 / PI;
  float accel_pitch = atan2(-accel_x, sqrt(accel_y * accel_y + accel_z * accel_z)) * 180 / PI;

  roll = 0.98 * (roll + gx * dt / 131.0) + 0.02 * accel_roll;
  pitch = 0.98 * (pitch + gy * dt / 131.0) + 0.02 * accel_pitch;
}

void calibrateGyro() {
  Serial.println("⚙️ Hiệu chuẩn MPU...");
  long sumX = 0, sumY = 0;
  int16_t ax, ay, az, gx, gy, gz;
  for (int i = 0; i < 500; i++) {
    mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
    sumX += gx;
    sumY += gy;
    delay(5);
  }
  Serial.printf("📏 Bias gx=%ld gy=%ld\n", sumX / 500, sumY / 500);
}

// ======================
// 🔹 TOKEN FIREBASE
// ======================
bool getToken() {
  Serial.println("🔹 Đăng ký Anonymous...");
  if (!client.connect("identitytoolkit.googleapis.com", 443)) return false;

  String url = "/v1/accounts:signUp?key=" + String(API_KEY);
  String payload = "{\"returnSecureToken\":true}";

  client.println("POST " + url + " HTTP/1.1");
  client.println("Host: identitytoolkit.googleapis.com");
  client.println("Content-Type: application/json");
  client.print("Content-Length: "); client.println(payload.length());
  client.println();
  client.print(payload);

  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r") break;
  }
  String body = client.readString();
  client.stop();

  int start = body.indexOf('{');
  if (start > 0) body = body.substring(start);

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, body)) return false;

  idToken = doc["idToken"].as<String>();
  refreshToken = doc["refreshToken"].as<String>();
  lastTokenTime = millis();

  Serial.println("✅ Token OK (" + String(idToken.length()) + " ký tự)");
  return true;
}

bool refreshIdToken() {
  if (refreshToken == "") return getToken();
  Serial.println("🔄 Làm mới token...");
  if (!client.connect("securetoken.googleapis.com", 443)) return false;

  String url = "/v1/token?key=" + String(API_KEY);
  String payload = "grant_type=refresh_token&refresh_token=" + refreshToken;

  client.println("POST " + url + " HTTP/1.1");
  client.println("Host: securetoken.googleapis.com");
  client.println("Content-Type: application/x-www-form-urlencoded");
  client.print("Content-Length: "); client.println(payload.length());
  client.println();
  client.print(payload);

  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r") break;
  }
  String body = client.readString();
  client.stop();

  int start = body.indexOf('{');
  if (start > 0) body = body.substring(start);

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, body)) return false;

  idToken = doc["id_token"].as<String>();
  refreshToken = doc["refresh_token"].as<String>();
  lastTokenTime = millis();

  Serial.println("✅ Token mới OK!");
  return true;
}

// ======================
// 🔹 GỬI DỮ LIỆU FIREBASE REST
// ======================
void sendData(float roll, float pitch) {
  if (idToken == "") {
    Serial.println("❌ Chưa có token");
    return;
  }

  if (!client.connect("ltt5-e25a0-default-rtdb.asia-southeast1.firebasedatabase.app", 443)) {
    Serial.println("❌ Không kết nối được Firebase");
    return;
  }

  String url = userPath + "?auth=" + idToken;
  time_t now;
struct tm timeinfo;
if (!getLocalTime(&timeinfo)) {
  now = millis() / 1000; // fallback nếu NTP lỗi
} else {
  time(&now); // epoch seconds (UTC+7 nhờ configTime)
}

String data = "{\"roll\":" + String(roll, 2) +
              ",\"pitch\":" + String(pitch, 2) +
              ",\"Timestamp\":" + String((unsigned long)now * 1000UL) + "}";


  client.println("POST " + url + " HTTP/1.1");
  client.println("Host: ltt5-e25a0-default-rtdb.asia-southeast1.firebasedatabase.app");
  client.println("Content-Type: application/json");
  client.print("Content-Length: "); client.println(data.length());
  client.println();
  client.print(data);

  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r") break;
  }
  String response = client.readString();
  client.stop();

  Serial.print("📤 Gửi Firebase: ");
  Serial.println(data);
  Serial.println("📥 Phản hồi:");
  Serial.println(response);
}
