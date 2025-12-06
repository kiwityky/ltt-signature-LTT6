/**
 * 🌻 LTT Signature Cloud Function - CommonJS version
 * Đồng bộ Realtime Database → Firestore
 */
const { onValueCreated } = require("firebase-functions/v2/database");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// Khởi tạo admin SDK
initializeApp();
const db = getFirestore();

/**
 * Trigger khi ESP32 gửi dữ liệu vào Realtime DB
 * Tự động sao chép sang Firestore: Users/{penId}/StudyData/{entryId}
 */
exports.syncPenData = onValueCreated(
  {
    ref: "/pens/{penId}/StudyData/{entryId}",
    region: "asia-southeast1" // vùng RTDB của bạn
  },
  async (event) => {

  const penId = event.params.penId;
  const entryId = event.params.entryId;
  const data = event.data?.val();

  logger.info(`📩 Đồng bộ từ pens/${penId}/StudyData/${entryId}`);

  if (!data) {
    logger.warn("⚠️ Không có dữ liệu để đồng bộ!");
    return;
  }

  try {
    const destRef = db.doc(`Users/${penId}/StudyData/${entryId}`);
    await destRef.set(data, { merge: true });
    logger.info(`✅ Ghi Firestore thành công: Users/${penId}/StudyData/${entryId}`);
  } catch (err) {
    logger.error("❌ Lỗi ghi Firestore:", err);
  }
});
// index.js — Cloud Function proxy cho Gemini API

// index.js — Cloud Function proxy cho Gemini API

const functions = require("firebase-functions");

// DANH SÁCH ORIGIN ĐƯỢC PHÉP
// LƯU Ý: origin chỉ đến domain, KHÔNG có path /ltt-signature-LTT6/
const allowedOrigins = [
  "https://kiwityky.github.io",
  "http://localhost:5500",    // nếu Anh test local
];

// HÀM PROXY
exports.geminiProxy = functions.https.onRequest(async (req, res) => {
  const origin = req.headers.origin;

  // Thiết lập CORS cho những origin hợp lệ
  if (allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
  }

  // Xử lý preflight OPTIONS
  if (req.method === "OPTIONS") {
    // Nếu origin không hợp lệ thì vẫn trả 204 nhưng browser sẽ không cho request tiếp
    return res.status(204).send("");
  }

  // Chặn luôn request nếu origin không được phép
  if (!allowedOrigins.includes(origin)) {
    console.log("Blocked origin:", origin);
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY env");
    return res.status(500).json({ error: "Missing Gemini API key" });
  }

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      apiKey;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("Gemini proxy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
