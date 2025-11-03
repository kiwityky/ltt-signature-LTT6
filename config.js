// =================================================================================================
// CẤU HÌNH FIREBASE VÀ AI
// =================================================================================================
export const firebaseConfig = {
     apiKey: "AIzaSyAB77Kezrrrd_MacPEDFPrcl2hPrnTGFk0", // Cần thay bằng key hợp lệ
    authDomain: "ltt5-e25a0.firebaseapp.com",
    projectId: "ltt5-e25a0",
    storageBucket: "ltt5-e25a0.firebasestorage.app", 
    messagingSenderId: "792522787659",
    appId: "1:792522787659:web:1e62ab3524b7ac830476ce",
    measurementId: "G-ZZN3QL0LB9"
};
export const GEMINI_API_KEY = "AIzaSyAB77Kezrrrd_MacPEDFPrcl2hPrnTGFk0"; // Cần thay bằng key hợp lệ
export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";

// ĐƯỜNG DẪN SVG
export const MUTE_ICON_PATH = 'svg/mute.svg';
export const UNMUTE_ICON_PATH = 'svg/unmute.svg';
export const PLAY_ICON_PATH = 'svg/play.svg'; 
export const PAUSE_ICON_PATH = 'svg/pause.svg'; 
export const LIKE_ICON_PATH = 'svg/like.svg';
export const SHARE_ICON_PATH = 'svg/share.svg';

// Dữ liệu hồ sơ chuyên môn của giảng viên (Dùng cho tính năng AI)
export const userExpertise = `
    Giảng viên Vật lý và Công nghệ thông tin tại Việt Nam. 
    Lĩnh vực nghiên cứu/giảng dạy: vật lý cổ điển, vật lý hạt nhân, lập trình web fullstack, lập trình nhúng, internet of things (IoT), AI. 
    Sở thích: học ngoại ngữ (tiếng Anh, tiếng Trung), đọc sách, sức khỏe.
`;

/**
 * Lấy các phần tử DOM cần thiết và xuất ra ngoài.
 * Hàm này giúp tránh bị lỗi khi các module khác cố gắng truy cập DOM trước khi nó được load.
 */
export const getDOMElements = () => ({
    // Auth & Status
    authContainer: document.getElementById('auth-container'),
    authStatusEl: document.getElementById('auth-status'),
    loginForm: document.getElementById('login-form'),
    authEmailEl: document.getElementById('auth-email'),
    authPasswordEl: document.getElementById('auth-password'),
    authMessageEl: document.getElementById('auth-message'),
    loginBtn: document.getElementById('login-btn'),
    registerBtn: document.getElementById('register-btn'),
    
    // Video Feed
    videoFeedContainer: document.getElementById('video-feed-container'),
    loadingFeedEl: document.getElementById('loading-feed'),
    openPostModalBtn: document.getElementById('open-post-modal-btn'),
    
    // Post Form
    postForm: document.getElementById('post-form'),
    postTitleEl: document.getElementById('post-title'),
    postDescriptionEl: document.getElementById('post-description'),
    postFileEl: document.getElementById('post-file'), 
    postUrlEl: document.getElementById('post-url'), 
    postMessageEl: document.getElementById('post-message'),
    uploadBtn: document.getElementById('upload-btn'),
    uploadSpinner: document.getElementById('upload-spinner'),
    uploadProgressContainer: document.getElementById('upload-progress-container'),
    uploadProgressEl: document.getElementById('upload-progress'),
    sourceUploadRadio: document.getElementById('source-upload'),
    sourceYoutubeRadio: document.getElementById('source-youtube'),

    // Smart Pen dashboard
    smartPenRefreshBtn: document.getElementById('smart-pen-refresh'),
    smartPenStatusEl: document.getElementById('smart-pen-status'),
    smartPenTodayEl: document.getElementById('smart-pen-today'),
    smartPenTotalEl: document.getElementById('smart-pen-total'),
    smartPenLastSyncEl: document.getElementById('smart-pen-last-sync'),
    smartPenTimelineEl: document.getElementById('smart-pen-timeline'),
    smartPenEmptyEl: document.getElementById('smart-pen-empty'),

    // AI Recommend
    recommendBtn: document.getElementById('recommend-btn'),
    recommendLoading: document.getElementById('recommend-loading'),
    recommendModal: document.getElementById('recommend-modal'),
    modalContent: document.getElementById('modal-content'),
    openRecommendModalBtn: document.getElementById('open-recommend-modal-btn'),
});

// Hàm tiện ích
export const formatUserId = (fullId) => fullId.substring(0, 5) + '...' + fullId.substring(fullId.length - 4);

export const getYoutubeId = (url) => {
    // Đã cập nhật để hỗ trợ URL Shorts: /shorts/
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|embed\/|shorts\/|v=)|youtu\.be\/)([^#\&\?]*).*/;
    const match = url.match(youtubeRegex);
    return match && match[1].length === 11 ? match[1] : null;
}

export const isYoutubeUrl = (url) => {
    // Đã cập nhật để gọi getYoutubeId nhằm hỗ trợ URL Shorts
    return getYoutubeId(url) !== null;
}

export const closeModal = (id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.classList.remove('grid');

    const trigger = document.querySelector(`[aria-controls='${id}']`);
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
    }
};

// Gắn vào phạm vi global để sử dụng trong thuộc tính onclick hiện có
window.closeModal = closeModal;
