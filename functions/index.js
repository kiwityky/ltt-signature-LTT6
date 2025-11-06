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
