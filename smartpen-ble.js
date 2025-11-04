// smartpen-ble.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

// Tránh khởi tạo app Firebase trùng lặp (vì main.js cũng initialize)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db  = getFirestore(app);

// UUID BLE (trùng với code ESP32 bạn đã nạp)
const SERVICE_UUID        = "12345678-1234-5678-1234-56789abcdef0";
const CHARACTERISTIC_UUID = "abcdefab-1234-5678-1234-56789abcdef1";

// Thay UID người dùng thật nếu bạn có. Mặc định khớp với main.js: 'UserID_12345'
const USER_ID = "UserID_12345";

// Throttle ghi Firebase để tránh spam (mặc định: ghi ~ mỗi 1000ms)
const FIREBASE_WRITE_INTERVAL_MS = 1000;
let lastSent = 0;

// Cập nhật nhanh label trạng thái trong modal
function setStatus(text) {
  const el = document.getElementById("smart-pen-status");
  if (el) el.textContent = text;
}

// Hiển thị số đo tức thời trên dòng trạng thái (cũng ok)
function setLiveValues(roll, pitch) {
  const el = document.getElementById("smart-pen-status");
  if (el) el.textContent = `Đã kết nối · Roll=${roll.toFixed(2)}° · Pitch=${pitch.toFixed(2)}°`;
}

async function connectSmartPen() {
  try {
    // B1. Chọn thiết bị BLE có namePrefix như ESP32 đã phát
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "LTT_Signature_Pen" }],
      optionalServices: [SERVICE_UUID],
    });

    setStatus("Đang kết nối thiết bị...");
    const server = await device.gatt.connect();

    // Tự động cập nhật trạng thái khi rớt kết nối
    device.addEventListener("gattserverdisconnected", () => {
      setStatus("Mất kết nối Bluetooth. Nhấn 'Kết nối Bluetooth' để nối lại.");
    });

    // B2. Lấy service/characteristic
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    // B3. Subscribe notify
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", async (event) => {
      const text = new TextDecoder().decode(event.target.value);
      const [r, p] = text.split(",").map(parseFloat);
      if (!Number.isFinite(r) || !Number.isFinite(p)) return;

      // Hiển thị tức thời
      setLiveValues(r, p);
      // Ghi Firestore mỗi ~1s
      const now = Date.now();
      if (now - lastSent >= FIREBASE_WRITE_INTERVAL_MS) {
        lastSent = now;
        const docId = String(now);
        await setDoc(
          doc(db, "Users", USER_ID, "StudyData", docId),
          {
            roll: r,
            pitch: p,
            ActiveTimeSeconds: 1,   // để main.js tổng hợp thời gian hiển thị:contentReference[oaicite:8]{index=8}
            Timestamp: serverTimestamp(),
          }
        );
      }
    });

    setStatus("Đã kết nối. Đang nhận dữ liệu thời gian thực...");
  } catch (err) {
    console.error(err);
    setStatus("Không thể kết nối Bluetooth: " + err.message);
    alert("❌ Lỗi kết nối Bluetooth: " + err.message);
  }
}

// Gắn nút trong modal Bút Thông Minh
document.getElementById("connect-smartpen-btn")?.addEventListener("click", connectSmartPen);
