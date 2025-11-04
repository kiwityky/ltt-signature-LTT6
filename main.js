// main.js — phiên bản hoàn chỉnh hiển thị ngày rõ ràng cho lịch sử điểm

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
  getAuth, 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

import { firebaseConfig, getDOMElements, GEMINI_API_KEY, GEMINI_API_URL, closeModal } from './config.js';
import { setupAuthListeners, getUserId } from './auth.js';
import { loadPosts, setupVideoListeners } from './video-feed.js';

const DOM = getDOMElements();

let app, db, auth, storage;

const layoutRoot = document.documentElement;
const headerEl = document.querySelector('.app-header');
const bottomNavEl = document.getElementById('bottom-nav');

const recalcViewportHeights = () => {
  if (!layoutRoot) return;
  const headerRect = headerEl?.getBoundingClientRect();
  const headerHeight = headerRect ? headerRect.height : 0;
  let footerHeight = 0;
  if (bottomNavEl) {
    const navComputed = window.getComputedStyle(bottomNavEl);
    if (navComputed.display !== 'none') {
      const navRect = bottomNavEl.getBoundingClientRect();
      footerHeight = Math.max(0, window.innerHeight - navRect.top);
    }
  }
  const availableHeight = Math.max(window.innerHeight - headerHeight - footerHeight, 320);
  layoutRoot.style.setProperty('--header-height', `${Math.round(headerHeight)}px`);
  layoutRoot.style.setProperty('--footer-height', `${Math.round(footerHeight)}px`);
  layoutRoot.style.setProperty('--available-feed-height', `${availableHeight}px`);
};

if (typeof ResizeObserver === 'function') {
  const layoutObserver = new ResizeObserver(() => recalcViewportHeights());
  if (headerEl) layoutObserver.observe(headerEl);
  if (bottomNavEl) layoutObserver.observe(bottomNavEl);
}

['resize', 'orientationchange'].forEach((eventName) => {
  window.addEventListener(eventName, recalcViewportHeights, { passive: true });
});

window.addEventListener('load', () => {
  recalcViewportHeights();
  setTimeout(recalcViewportHeights, 200);
});

recalcViewportHeights();

const SMART_PEN_COLLECTION_PATH = 'Users/UserID_12345/StudyData';
let smartPenQueryRef = null;
let smartPenUnsubscribe = null;
let smartPenStatusTimeout = null;

const registerOverlayDismiss = (id) => {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal(id);
    }
  });
};

['post-modal', 'profile-modal', 'game-center-modal', 'smart-pen-modal'].forEach(registerOverlayDismiss);

const toggleSmartPenRefreshLoading = (isLoading) => {
  if (!DOM.smartPenRefreshBtn) return;
  DOM.smartPenRefreshBtn.disabled = Boolean(isLoading);
  DOM.smartPenRefreshBtn.dataset.loading = isLoading ? 'true' : 'false';
  DOM.smartPenRefreshBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
};

const setSmartPenStatus = (message, revertTo = null, delay = 3200) => {
  if (!DOM.smartPenStatusEl) return;
  DOM.smartPenStatusEl.textContent = message;
  if (smartPenStatusTimeout) {
    clearTimeout(smartPenStatusTimeout);
    smartPenStatusTimeout = null;
  }
  if (revertTo) {
    smartPenStatusTimeout = setTimeout(() => {
      DOM.smartPenStatusEl.textContent = revertTo;
    }, delay);
  }
};

const parseTimestamp = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total === 0) return '0 phút';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!hours && secs && parts.length < 1) parts.push(`${secs}s`);
  return parts.join(' ');
};

const formatRelativeTime = (date) => {
  if (!date) return '--';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return date.toLocaleString('vi-VN');
  if (diff < 60 * 1000) return 'Vừa xong';
  if (diff < 60 * 60 * 1000) {
    const mins = Math.round(diff / (60 * 1000));
    return `${mins} phút trước`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.round(diff / (60 * 60 * 1000));
    return `${hours} giờ trước`;
  }
  return date.toLocaleString('vi-VN');
};

const formatTimelineTimestamp = (date) => {
  if (!date) return 'Không rõ thời gian';
  const time = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return `${time} · ${day}`;
};

const buildSmartPenEntries = (docs) => {
  if (!Array.isArray(docs)) return [];
  return docs
    .map((docSnap) => {
      const data = typeof docSnap.data === 'function' ? docSnap.data() : {};
      const seconds = Number(data.ActiveTimeSeconds ?? data.activeTimeSeconds ?? 0);
      const timestamp = parseTimestamp(data.Timestamp ?? data.timestamp);
      return {
        id: docSnap.id,
        seconds: Number.isFinite(seconds) ? seconds : 0,
        timestamp
      };
    })
    .filter((entry) => entry.seconds >= 0)
    .sort((a, b) => {
      const timeA = a.timestamp ? a.timestamp.getTime() : 0;
      const timeB = b.timestamp ? b.timestamp.getTime() : 0;
      return timeB - timeA;
    });
};

const updateSmartPenView = (entries) => {
  if (!DOM.smartPenTodayEl || !DOM.smartPenTimelineEl) return false;

  if (!entries.length) {
    DOM.smartPenTodayEl.textContent = '--';
    DOM.smartPenTotalEl.textContent = '--';
    DOM.smartPenLastSyncEl.textContent = '--';
    DOM.smartPenTimelineEl.innerHTML = '';
    DOM.smartPenEmptyEl?.classList.remove('hidden');
    return false;
  }

  DOM.smartPenEmptyEl?.classList.add('hidden');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let todaySeconds = 0;
  let totalSeconds = 0;
  let latestTimestamp = null;

  entries.forEach((entry, index) => {
    totalSeconds += entry.seconds;
    if (entry.timestamp && entry.timestamp >= todayStart) {
      todaySeconds += entry.seconds;
    }
    if (index === 0 && entry.timestamp) {
      latestTimestamp = entry.timestamp;
    }
  });

  DOM.smartPenTodayEl.textContent = formatDuration(todaySeconds);
  DOM.smartPenTotalEl.textContent = formatDuration(totalSeconds);
  DOM.smartPenLastSyncEl.textContent = formatRelativeTime(latestTimestamp);

  DOM.smartPenTimelineEl.innerHTML = '';
  entries.slice(0, 6).forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'smart-pen-timeline__item';
    item.innerHTML = `
      <span class="smart-pen-timeline__time">${formatTimelineTimestamp(entry.timestamp)}</span>
      <span class="smart-pen-timeline__duration">${formatDuration(entry.seconds)}</span>
    `;
    DOM.smartPenTimelineEl.appendChild(item);
  });
  return true;
};

const initializeSmartPenListener = () => {
  if (!db || !DOM.smartPenTimelineEl) return;
  if (smartPenUnsubscribe) return;

  const colRef = collection(db, SMART_PEN_COLLECTION_PATH);
  smartPenQueryRef = query(colRef, orderBy('Timestamp', 'desc'), limit(50));
  setSmartPenStatus('Đang đồng bộ dữ liệu thời gian thực...');

  smartPenUnsubscribe = onSnapshot(
    smartPenQueryRef,
    (snapshot) => {
      const entries = buildSmartPenEntries(snapshot.docs);
      const hasEntries = updateSmartPenView(entries);
      setSmartPenStatus(hasEntries ? 'Đồng bộ thời gian thực' : 'Chưa có dữ liệu từ bút.');
    },
    (error) => {
      console.error('Lỗi đồng bộ dữ liệu bút thông minh:', error);
      setSmartPenStatus('Không thể lấy dữ liệu từ Firebase.');
    }
  );
};

const refreshSmartPenOnce = async () => {
  if (!smartPenQueryRef) {
    initializeSmartPenListener();
    return;
  }

  toggleSmartPenRefreshLoading(true);
  setSmartPenStatus('Đang làm mới dữ liệu...', null);

  try {
    const snapshot = await getDocs(smartPenQueryRef);
    const entries = buildSmartPenEntries(snapshot.docs);
    const hasEntries = updateSmartPenView(entries);
    setSmartPenStatus('Đã làm mới thủ công', hasEntries ? 'Đồng bộ thời gian thực' : 'Chưa có dữ liệu từ bút.');
  } catch (error) {
    console.error('Lỗi làm mới dữ liệu bút thông minh:', error);
    setSmartPenStatus('Không thể làm mới dữ liệu.');
  } finally {
    toggleSmartPenRefreshLoading(false);
  }
};

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);

  DOM.authStatusEl.textContent = "Đang tải...";

  const getPostsCollectionRef = () => collection(db, `artifacts/${firebaseConfig.projectId}/public/data/videos`);
  setupAuthListeners(auth, DOM, (userId) => loadPosts(db, DOM, getPostsCollectionRef));
  setupVideoListeners(DOM, { db, storage, getPostsCollectionRef, getUserId });
  initializeSmartPenListener();
  if (DOM.smartPenRefreshBtn) {
    toggleSmartPenRefreshLoading(false);
    DOM.smartPenRefreshBtn.addEventListener('click', refreshSmartPenOnce);
  }
  window.addEventListener('beforeunload', () => {
    if (typeof smartPenUnsubscribe === 'function') {
      smartPenUnsubscribe();
      smartPenUnsubscribe = null;
    }
  });
// =============================== NÚT THÊM VIDEO ===============================
const openPostBtn = document.getElementById('open-post-modal-btn');
const postModal = document.getElementById('post-modal');

if (openPostBtn && postModal) {
  openPostBtn.addEventListener('click', () => {
    const user = auth.currentUser;
    if (!user) {
      alert("Vui lòng đăng nhập trước khi đăng video.");
      return;
    }
    postModal.classList.remove('hidden');
    postModal.classList.add('flex');
  });
}

  // ========================= PROFILE =========================
  const profileBtn = document.getElementById('open-profile-btn');
  const profileModal = document.getElementById('profile-modal');
  const profileForm = document.getElementById('profile-form');
  const avatarUpload = document.getElementById('avatar-upload');
  const avatarImg = document.getElementById('profile-avatar');

  function showProfileMessage(text, isSuccess = true) {
    let toast = document.getElementById('center-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'center-toast';
      toast.className = `
        fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
        px-6 py-3 rounded-xl text-white text-lg font-semibold 
        shadow-2xl z-[9999] transition-opacity duration-500
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.backgroundColor = isSuccess ? '#16a34a' : '#dc2626';
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  if (profileBtn) {
    profileBtn.addEventListener('click', async () => {
      const user = auth.currentUser;
      if (!user) return alert("Vui lòng đăng nhập trước.");
      profileModal?.classList.remove('hidden');
      profileModal?.classList.add('flex');

      try {
        const refUser = doc(db, 'users', user.uid);
        const snap = await getDoc(refUser);
        const nameEl = document.getElementById('profile-name');
        const emailEl = document.getElementById('profile-email');
        const nameInput = document.getElementById('profile-name-input');
        const emailInput = document.getElementById('profile-email-input');

        if (snap.exists()) {
          const data = snap.data();
          nameEl.textContent = data.name || user.email || "";
          emailEl.textContent = data.email || user.email || "";
          nameInput.value = data.name || "";
          emailInput.value = data.email || user.email || "";
          document.getElementById('profile-dob').value = data.dob || '';
          document.getElementById('profile-gender').value = data.gender || '';
          document.getElementById('profile-school').value = data.school || '';
          document.getElementById('profile-class').value = data.class || '';
          avatarImg.src = data.photoUrl || "https://cdn-icons-png.flaticon.com/512/3135/3135715.png";
        } else {
          nameEl.textContent = user.email || "Chưa có thông tin";
          emailEl.textContent = user.email || "";
          avatarImg.src = "https://cdn-icons-png.flaticon.com/512/3135/3135715.png";
        }
      } catch (err) {
        console.error("Lỗi tải profile:", err);
        showProfileMessage("Không thể tải hồ sơ.", false);
      }
    });
  }

  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);

      const name = document.getElementById('profile-name-input').value.trim();
      const email = document.getElementById('profile-email-input').value.trim();
      const dob = document.getElementById('profile-dob').value.trim();
      const gender = document.getElementById('profile-gender').value;
      const school = document.getElementById('profile-school').value.trim();
      const className = document.getElementById('profile-class').value.trim();

      try {
        await setDoc(doc(db, 'users', user.uid), {
          name, email, dob, gender, school, class: className
        }, { merge: true });
        showProfileMessage("Đã lưu thông tin thành công!");
        document.getElementById('profile-name').textContent = name;
        document.getElementById('profile-email').textContent = email;
      } catch (err) {
        console.error("Lỗi lưu profile:", err);
        showProfileMessage("Không thể lưu. Thử lại.", false);
      }
    });
  }

  const changePassBtn = document.getElementById('change-password-btn');
  if (changePassBtn) {
    changePassBtn.addEventListener('click', async () => {
      const newPassEl = document.getElementById('profile-new-password');
      const newPass = newPassEl.value.trim();
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);
      if (newPass.length < 6) return showProfileMessage("Mật khẩu phải từ 6 ký tự.", false);

      try {
        const oldPass = prompt("Nhập lại mật khẩu hiện tại để xác nhận:");
        if (!oldPass) throw new Error("Chưa nhập mật khẩu hiện tại.");
        const credential = EmailAuthProvider.credential(user.email, oldPass);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPass);
        newPassEl.value = '';
        showProfileMessage("Đã đổi mật khẩu thành công!");
      } catch (err) {
        console.error("Lỗi đổi mật khẩu:", err);
        showProfileMessage("Không thể đổi mật khẩu.", false);
      }
    });
  }

  if (avatarUpload) {
    avatarUpload.addEventListener('change', async (e) => {
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const storageRef = ref(storage, `avatars/${user.uid}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        avatarImg.src = url;
        await setDoc(doc(db, 'users', user.uid), { photoUrl: url }, { merge: true });
        showProfileMessage("Đã cập nhật ảnh đại diện!");
      } catch (err) {
        console.error("Lỗi upload avatar:", err);
        showProfileMessage("Không thể tải ảnh.", false);
      }
    });
  }

} catch (error) {
  console.error("Lỗi khởi tạo ứng dụng:", error);
}

// =============================== GAME CENTER ===============================
const gameBtn = document.getElementById('open-game-btn');
if (gameBtn) {
  gameBtn.addEventListener('click', async () => {
    const modal = document.getElementById('game-center-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    await loadUserLeaderboard();
  });
}

// Hàm tính điểm
function calculateDailyScore(data) {
  const usageMinutes = data.usageMinutesToday || 0;
  const videoPoints = data.videoPoints || 0;
  let score = data.baseScore || 0;
  if (usageMinutes <= 45) score += 1; else score -= 1;
  score += videoPoints;
  return score;
}

// Hàm format ngày chuẩn
function formatHistoryDate(d) {
  if (!d) return 'Không rõ ngày';
  if (typeof d.toDate === 'function') return d.toDate().toLocaleString('vi-VN');
  if (d.seconds) return new Date(d.seconds * 1000).toLocaleString('vi-VN');
  if (typeof d === 'string') return d;
  try { return String(d); } catch { return 'Không rõ ngày'; }
}

// Ghi lịch sử điểm mới
async function addScoreHistory(userId, change, reason = '') {
  if (!userId) return;
  const userRef = doc(db, 'users', userId);
  try {
    await updateDoc(userRef, {
      scoreHistory: arrayUnion({
        date: serverTimestamp(),
        change,
        reason
      })
    });
  } catch (err) {
    console.error("Lỗi addScoreHistory:", err);
  }
}

// Bảng xếp hạng người dùng
async function loadUserLeaderboard() {
  const listEl = document.getElementById('user-leaderboard');
  listEl.innerHTML = `<li class="text-center text-gray-500 py-2">Đang tính điểm...</li>`;
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    const leaderboard = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const score = calculateDailyScore(data);
      leaderboard.push({
        name: data.name || 'Người dùng ẩn danh',
        score,
        history: data.scoreHistory || []
      });
    });
    leaderboard.sort((a, b) => b.score - a.score);
    listEl.innerHTML = '';
    leaderboard.forEach((u, i) => {
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center py-2 px-2 hover:bg-gray-100 rounded cursor-pointer';
      li.innerHTML = `<span class="font-semibold">${i + 1}. ${u.name}</span>
                      <span class="text-blue-600 font-bold">${u.score} điểm</span>`;
      //li.addEventListener('click', () => showScoreHistory(u));
      listEl.appendChild(li);
    });
  } catch (err) {
    console.error("Lỗi BXH:", err);
  }
}

// Hiển thị lịch sử điểm
function showScoreHistory(user) {
  const history = user.history || [];
  const details = history.length
    ? history.map(h => {
        const date = formatHistoryDate(h?.date);
        const change = (typeof h?.change === 'number' ? (h.change > 0 ? '+' : '') + h.change : '0');
        const reason = h?.reason || 'Không rõ lý do';
        return `<li>${date}: ${change} (${reason})</li>`;
      }).join('')
    : '<li>Chưa có lịch sử điểm.</li>';

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white text-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
      <button onclick="this.parentElement.parentElement.remove()" 
              class="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-2xl font-bold">&times;</button>
      <h3 class="text-xl font-bold mb-3 text-center text-blue-700">📊 Lịch sử điểm của ${user.name}</h3>
      <ul class="list-disc pl-5 text-gray-700 space-y-1">${details}</ul>
    </div>
  `;
  document.body.appendChild(modal);
}

// =============================== CHATBOX GEMINI ===============================
const logoEl = document.getElementById('sunflower-btn');
const chatbox = document.getElementById('ai-chatbox');
const aiInput = document.getElementById('ai-input');
const aiSend = document.getElementById('ai-send');
const aiMessages = document.getElementById('ai-messages');
const aiClose = document.getElementById('close-ai-chat');

if (logoEl) logoEl.addEventListener('click', () => chatbox.classList.toggle('hidden'));
if (aiClose) aiClose.addEventListener('click', () => chatbox.classList.add('hidden'));

if (aiSend) {
  aiSend.addEventListener('click', async () => {
    const question = aiInput.value.trim();
    if (!question) return;
    appendMessage('user', question);
    aiInput.value = '';
    appendMessage('bot', 'Đang xử lý...');
    try {
      const response = await fetch(GEMINI_API_URL + GEMINI_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: question }] }] })
      });
      const data = await response.json();
      const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Xin lỗi, tôi chưa có câu trả lời cho điều đó.";
      updateLastBotMessage(answer);
    } catch (err) {
      console.error(err);
      updateLastBotMessage("Lỗi khi gọi API Gemini.");
    }
  });
}

function appendMessage(sender, text) {
  const msg = document.createElement('div');
  msg.className = sender === 'user'
    ? 'bg-sky-100 text-gray-800 self-end p-2 rounded-lg max-w-[85%] ml-auto'
    : 'bg-gray-200 text-gray-900 p-2 rounded-lg max-w-[85%]';
  msg.textContent = text;
  aiMessages.appendChild(msg);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function updateLastBotMessage(newText) {
  const last = aiMessages.querySelector('.bg-gray-200:last-child');
  if (last) last.textContent = newText;
}
// =============================== TÌM KIẾM VIDEO ===============================
const searchBtn = document.getElementById('search-btn');
const searchBox = document.getElementById('search-box');
const searchInput = document.getElementById('search-input');
const searchSubmit = document.getElementById('search-submit');
const smartPenNavBtn = document.getElementById('smart-pen-nav-btn');
const smartPenModal = document.getElementById('smart-pen-modal');

// Khi bấm vào nút tìm kiếm — ẩn/hiện khung
if (searchBtn && searchBox) {
  searchBtn.addEventListener('click', () => {
    const isHidden = searchBox.classList.toggle('hidden');
    const expanded = !isHidden;
    searchBtn.setAttribute('aria-expanded', expanded.toString());
    if (expanded) {
      searchInput.focus();
    }
  });
}

if (searchBox) {
  document.addEventListener('click', (event) => {
    if (searchBox.classList.contains('hidden')) return;
    const target = event.target;
    if ((searchBtn && (searchBtn === target || searchBtn.contains(target))) || searchBox.contains(target)) {
      return;
    }
    searchBox.classList.add('hidden');
    if (searchBtn) {
      searchBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || searchBox.classList.contains('hidden')) return;
    searchBox.classList.add('hidden');
    if (searchBtn) {
      searchBtn.setAttribute('aria-expanded', 'false');
      searchBtn.focus();
    }
  });
}

// Khi bấm nút TÌM
if (searchSubmit) {
  searchSubmit.addEventListener('click', () => {
    const keyword = searchInput.value.trim().toLowerCase();
    if (!keyword) return;

    const videos = document.querySelectorAll('.video-snap-item');
    let found = false;
    videos.forEach(video => {
      const title = video.querySelector('h4')?.textContent.toLowerCase() || '';
      const desc = video.querySelector('p')?.textContent.toLowerCase() || '';
      if (title.includes(keyword) || desc.includes(keyword)) {
        video.scrollIntoView({ behavior: 'smooth', block: 'center' });
        video.classList.add('ring', 'ring-4', 'ring-blue-400');
        setTimeout(() => video.classList.remove('ring', 'ring-4', 'ring-blue-400'), 2000);
        found = true;
      }
    });

    if (!found) alert('Không tìm thấy video nào phù hợp.');
  });
}

if (smartPenNavBtn) {
  smartPenNavBtn.setAttribute('aria-expanded', 'false');
}

if (smartPenNavBtn && smartPenModal) {
  smartPenNavBtn.addEventListener('click', () => {
    smartPenModal.classList.remove('hidden');
    smartPenModal.classList.add('flex');
    smartPenNavBtn.setAttribute('aria-expanded', 'true');
  });
}
