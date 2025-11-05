// =======================
// 🌻 LTT Signature - BÚT THÔNG MINH
// =======================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { firebaseConfig } from "./config.js";

// --- Khởi tạo Firebase ---
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// --- UUID BLE (khớp với ESP32) ---
const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const CHARACTERISTIC_UUID = "abcdefab-1234-5678-1234-56789abcdef1";

// --- ID người dùng (trùng ESP32) ---
const USER_ID = "UserID_12345";

// --- Tần suất ghi Firestore (nếu BLE kết nối) ---
const FIREBASE_WRITE_INTERVAL_MS = 1000;
let lastSent = 0;

// --- DOM elements ---
const todayEl = document.getElementById("smart-pen-today");
const totalEl = document.getElementById("smart-pen-total");
const lastSyncEl = document.getElementById("smart-pen-last-sync");
const timelineEl = document.getElementById("smart-pen-timeline");
const statusEl = document.getElementById("smart-pen-status");
const refreshBtn = document.getElementById("smart-pen-refresh");

// =======================
// 🔹 HÀM TRỢ GIÚP HIỂN THỊ
// =======================
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}
function setLiveValues(r, p) {
  if (statusEl)
    statusEl.textContent = `Đã kết nối BLE · Roll=${r.toFixed(2)}°, Pitch=${p.toFixed(2)}°`;
}

// =======================
// 🔹 KẾT NỐI BLUETOOTH
// =======================
async function connectSmartPen() {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "LTT_Signature_Pen" }],
      optionalServices: [SERVICE_UUID],
    });

    setStatus("🔗 Đang kết nối Bluetooth...");
    const server = await device.gatt.connect();

    device.addEventListener("gattserverdisconnected", () => {
      setStatus("⚠️ Mất kết nối BLE. Nhấn 'Kết nối Bluetooth' để nối lại.");
    });

    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await characteristic.startNotifications();
    setStatus("✅ BLE đã kết nối, đang nhận dữ liệu...");

    characteristic.addEventListener("characteristicvaluechanged", async (event) => {
      const text = new TextDecoder().decode(event.target.value);
      const [r, p] = text.split(",").map(parseFloat);
      if (!Number.isFinite(r) || !Number.isFinite(p)) return;
      setLiveValues(r, p);

      // Ghi Firestore mỗi ~1s
      const now = Date.now();
      if (now - lastSent >= FIREBASE_WRITE_INTERVAL_MS) {
        lastSent = now;
        await setDoc(doc(db, "Users", USER_ID, "StudyData", String(now)), {
          roll: r,
          pitch: p,
          ActiveTimeSeconds: 1,
          Timestamp: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    console.error(err);
    setStatus("❌ Lỗi BLE: " + err.message);
    alert("Không thể kết nối Bluetooth: " + err.message);
  }
}

// Nút kết nối BLE
document
  .getElementById("connect-smartpen-btn")
  ?.addEventListener("click", connectSmartPen);

// =======================
// 🔹 HIỂN THỊ REALTIME FIREBASE
// =======================
const studyRef = ref(rtdb, `Users/${USER_ID}/StudyData`);
onValue(studyRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    setStatus("Chưa có dữ liệu từ bút thông minh.");
    todayEl.textContent = "--";
    totalEl.textContent = "--";
    lastSyncEl.textContent = "--";
    return;
  }

  const entries = Object.entries(data);
  entries.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  const latest = entries[entries.length - 1][1];

  // Cập nhật giao diện
  setStatus(
    `🔄 Đang đồng bộ... Roll=${latest.roll?.toFixed?.(2) ?? "-"}°, Pitch=${latest.pitch?.toFixed?.(2) ?? "-"}°`
  );
  todayEl.textContent = `${entries.length} giây`;
  totalEl.textContent = `${entries.length} bản ghi`;
  lastSyncEl.textContent = new Date().toLocaleTimeString("vi-VN");

  // Timeline (10 bản ghi cuối)
  timelineEl.innerHTML = "";
  entries.slice(-10).forEach(([key, item]) => {
    const div = document.createElement("div");
    div.className = "smart-pen-timeline__item";
    div.innerHTML = `
      <span class="smart-pen-timeline__time">${new Date(
        item.Timestamp || Date.now()
      ).toLocaleTimeString("vi-VN")}</span>
      <span class="smart-pen-timeline__duration">
        Roll: ${item.roll?.toFixed?.(1) ?? "?"}, Pitch: ${item.pitch?.toFixed?.(1) ?? "?"}
      </span>`;
    timelineEl.appendChild(div);
  });
});

// =======================
// 🔹 NÚT “LÀM MỚI” – LẤY DỮ LIỆU MỚI NHẤT
// =======================
refreshBtn?.addEventListener("click", async () => {
  try {
    refreshBtn.disabled = true;
    const spinner = refreshBtn.querySelector(".info-card__action-spinner");
    const label = refreshBtn.querySelector(".info-card__action-label");
    if (spinner) spinner.style.display = "inline-block";
    if (label) label.textContent = "Đang tải...";

    const studyRef = ref(rtdb, `Users/${USER_ID}/StudyData`);
    const snapshot = await get(studyRef);
    const data = snapshot.val();

    if (!data) {
      alert("⚠️ Chưa có dữ liệu mới!");
      return;
    }

    const entries = Object.entries(data);
    entries.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const latest = entries[entries.length - 1][1];

    setStatus(`🔁 Làm mới: Roll=${latest.roll?.toFixed?.(2)}, Pitch=${latest.pitch?.toFixed?.(2)}`);
    lastSyncEl.textContent = new Date().toLocaleTimeString("vi-VN");
  } catch (err) {
    console.error(err);
    alert("❌ Lỗi khi làm mới: " + err.message);
  } finally {
    const spinner = refreshBtn.querySelector(".info-card__action-spinner");
    const label = refreshBtn.querySelector(".info-card__action-label");
    if (spinner) spinner.style.display = "none";
    if (label) label.textContent = "Làm mới";
    refreshBtn.disabled = false;
  }
});
