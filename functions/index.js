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

// ❗ Quan trọng: GIỮ đúng dòng import này, KHÔNG dùng "firebase-functions/v2"
const functions = require("firebase-functions");
const cors = require("cors");

// CHỈ cho phép những domain này gọi Gemini proxy
const allowedOrigins = [
  "https://kiwityky.github.io/ltt-signature-LTT6/",        // sửa lại đúng domain hosting của Anh
  "http://localhost:5500",             // để test local bằng firebase hosting:serve
];

// Cấu hình CORS
const corsMiddleware = cors({
  origin: (origin, callback) => {
    // origin = undefined nếu gọi từ tool/curl → chặn cho an toàn
    if (!origin || !allowedOrigins.includes(origin)) {
      console.log("Blocked origin:", origin);
      return callback(new Error("Origin not allowed"), false);
    }
    return callback(null, true);
  },
});

// Hàm proxy: frontend gọi tới đây, function sẽ gọi tiếp Gemini
exports.geminiProxy = functions.https.onRequest((req, res) => {
  corsMiddleware(req, res, async () => {
    // Chỉ cho phép POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
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

      // Dùng global fetch (Node 18+). Nếu runtime chưa có fetch,
      // bước sau mình sẽ nói cách nâng động cơ Node.
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      console.error("Gemini proxy error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
});
