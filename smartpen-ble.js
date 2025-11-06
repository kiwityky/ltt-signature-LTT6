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

// --- Dùng PenID do người dùng nhập ---
let penId = localStorage.getItem("penId") || "";
const statusText = document.getElementById("pen-id-status");
const connectBtn = document.getElementById("connect-pen-btn");
const penInput = document.getElementById("pen-id-input");

const updatePenConnectionMessage = (text) => {
  if (statusText) statusText.textContent = text;
};

let updateLegacyStatus = () => {};

if (penInput && penId) penInput.value = penId;

// Hàm lưu và kết nối bút
function connectPen() {
  const newPen = penInput?.value?.trim();
  if (!newPen) {
    alert("Vui lòng nhập Pen ID hợp lệ (ví dụ: LTT_6001)");
    return;
  }
  penId = newPen;
  localStorage.setItem("penId", penId);
  updatePenConnectionMessage(`✅ Đã kết nối với bút ${penId}`);
  startRealtimeListener(penId);
}

// Khi bấm “Kết nối”
connectBtn?.addEventListener("click", connectPen);

// Nếu có sẵn penId trước đó thì tự động kết nối
if (penId) {
  updatePenConnectionMessage(`🔄 Đang kết nối với ${penId}...`);
  startRealtimeListener(penId);
}

// --- Hàm lắng nghe Realtime Database ---
function startRealtimeListener(penId) {
  const studyRef = ref(rtdb, `pens/${penId}/StudyData`);
  onValue(studyRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      updatePenConnectionMessage("Chưa có dữ liệu từ bút thông minh.");
      updateLegacyStatus("Chưa có dữ liệu từ bút thông minh.");
      if (!modernDashboardActive) {
        todayEl.textContent = "--";
        totalEl.textContent = "--";
        lastSyncEl.textContent = "--";
      }
      return;
    }

    const entries = Object.entries(data);
    entries.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const latest = entries[entries.length - 1][1];

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    let todaySeconds = 0;
    let totalSeconds = 0;

    entries.forEach(([, item]) => {
      const seconds = Number(item.ActiveTimeSeconds ?? item.activeTimeSeconds ?? 0) || 0;
      totalSeconds += seconds;
      const rawTimestamp = item.Timestamp ?? item.timestamp;
      const tsNumber = typeof rawTimestamp === "number" ? rawTimestamp : Number(rawTimestamp);
      const entryDate = Number.isFinite(tsNumber) ? new Date(tsNumber) : null;
      if (entryDate && entryDate >= todayStart) {
        todaySeconds += seconds;
      }
    });

    const statusMessage = `🔄 Bút ${penId}: Roll=${latest.roll?.toFixed?.(1) ?? "-"}°, Pitch=${latest.pitch?.toFixed?.(1) ?? "-"}`;
    updatePenConnectionMessage(statusMessage);
    updateLegacyStatus(statusMessage);
    if (!modernDashboardActive) {
      todayEl.textContent = `${todaySeconds} giây`;
      totalEl.textContent = `${totalSeconds} giây`;
      const latestTs = latest?.Timestamp ? Number(latest.Timestamp) : Date.now();
      lastSyncEl.textContent = vnTime.format(new Date(latestTs));
    }
  });
}


// --- Tần suất ghi Firestore (nếu BLE kết nối) ---
const FIREBASE_WRITE_INTERVAL_MS = 1000;
let lastSent = 0;

// --- DOM elements ---
// Hiển thị giờ chuẩn Việt Nam (UTC+7)
const vnTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false
});

const todayEl = document.getElementById("smart-pen-today");
const totalEl = document.getElementById("smart-pen-total");
const lastSyncEl = document.getElementById("smart-pen-last-sync");
const statusEl = document.getElementById("smart-pen-status");
const refreshBtn = document.getElementById("smart-pen-refresh");

const modernDashboardActive = Boolean(document.getElementById("smart-pen-status-text"));

if (!modernDashboardActive) {
  // =======================
  // 🔹 HÀM TRỢ GIÚP HIỂN THỊ
  // =======================
  updateLegacyStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
    updatePenConnectionMessage(text);
  };
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

      updateLegacyStatus("🔗 Đang kết nối Bluetooth...");
      const server = await device.gatt.connect();

      device.addEventListener("gattserverdisconnected", () => {
        updateLegacyStatus("⚠️ Mất kết nối BLE. Nhấn 'Kết nối Bluetooth' để nối lại.");
      });

      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

      await characteristic.startNotifications();
      updateLegacyStatus("✅ BLE đã kết nối, đang nhận dữ liệu...");

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
      updateLegacyStatus("❌ Lỗi BLE: " + err.message);
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
      updateLegacyStatus("Chưa có dữ liệu từ bút thông minh.");
      todayEl.textContent = "--";
      totalEl.textContent = "--";
      lastSyncEl.textContent = "--";
      return;
    }

    const entries = Object.entries(data);
    entries.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const latest = entries[entries.length - 1][1];

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    let todaySeconds = 0;
    let totalSeconds = 0;

    entries.forEach(([, item]) => {
      const seconds = Number(item.ActiveTimeSeconds ?? item.activeTimeSeconds ?? 0) || 0;
      totalSeconds += seconds;
      const rawTimestamp = item.Timestamp ?? item.timestamp;
      const tsNumber = typeof rawTimestamp === "number" ? rawTimestamp : Number(rawTimestamp);
      const entryDate = Number.isFinite(tsNumber) ? new Date(tsNumber) : null;
      if (entryDate && entryDate >= todayStart) {
        todaySeconds += seconds;
      }
    });

    updateLegacyStatus(
      `🔄 Đang đồng bộ... Roll=${latest.roll?.toFixed?.(2) ?? "-"}°, Pitch=${latest.pitch?.toFixed?.(2) ?? "-"}°`
    );
    todayEl.textContent = `${todaySeconds} giây`;
    totalEl.textContent = `${totalSeconds} giây`;
    lastSyncEl.textContent = new Date().toLocaleTimeString("vi-VN");
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

      updateLegacyStatus(`🔁 Làm mới: Roll=${latest.roll?.toFixed?.(2)}, Pitch=${latest.pitch?.toFixed?.(2)}`);
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
}

