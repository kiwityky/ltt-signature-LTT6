# 🌻 LTT Signature — Nền tảng Video Học Tập Dạng Shorts

**LTT Signature** là một ứng dụng web học tập tương tác dành cho học sinh, lấy cảm hứng từ nền tảng TikTok, kết hợp giữa **học qua video ngắn**, **trò chơi mini**, và **trợ lý AI học tập**.
Ứng dụng được phát triển bởi nhóm học sinh Trường **THCS Lý Thánh Tông**, sử dụng **Firebase**, **TailwindCSS**, và **Google Gemini API**.

---

## 🚀 Tính năng chính

### 🎬 1. Học qua video ngắn (Shorts)
- Người dùng có thể **đăng tải video học tập**, **xem**, **like**, **chia sẻ** và **xóa video** (nếu là admin).  
- Hỗ trợ cả **upload trực tiếp** và **video từ YouTube (URL/shorts)**.  
- Tự động **tải luồng video dạng cuộn dọc**, tối ưu cho học tập trên điện thoại.

### 🔐 2. Xác thực người dùng (Firebase Auth)
- Hỗ trợ **đăng ký**, **đăng nhập**, **đăng xuất** bằng email & mật khẩu.  
- Bảo mật dữ liệu người dùng và hỗ trợ lưu trữ hồ sơ cá nhân trên Firestore.

### 👤 3. Hồ sơ người dùng (Profile Modal)
- Xem và chỉnh sửa thông tin cá nhân: tên, ngày sinh, lớp, trường học.  
- Đổi mật khẩu, đổi ảnh đại diện.  
- Thông tin được đồng bộ hóa trên Firebase Cloud Firestore.

### 🧠 4. Trợ lý AI — Gemini Chatbox
- Tích hợp **Google Gemini API** làm trợ lý học tập mini.  
- Trò chuyện, đặt câu hỏi, nhận gợi ý học tập ngay trong ứng dụng.

### 🎮 5. Mini Game “Phi Âm” (Rhythm Tiles)
- Trò chơi phản xạ âm nhạc giúp giải trí sau giờ học.  
- Có **bảng xếp hạng cục bộ (Leaderboard)**, **lưu điểm cao nhất**, **đổi tên người chơi**.  
- Hoạt động mượt mà trên cả máy tính và điện thoại.

### 🏅 6. Game Center & Điểm thưởng
- Mỗi người dùng có **hệ thống tính điểm học tập**:
  - +1 điểm khi sử dụng app ≤ 45 phút/ngày.  
  - +1 điểm cho mỗi video đăng hợp lệ.  
  - -1 điểm cho mỗi video bị xóa hoặc vượt thời gian giới hạn.  
- Có **bảng vinh danh người dùng theo điểm số**.

---

## 🧩 Kiến trúc hệ thống

```
📂 LTT Signature/
├── index.html          # Trang chính: video feed, AI chatbox, profile, leaderboard
├── game.html           # Mini game "Phi Âm"
├── style.css           # Giao diện tổng thể
├── config.js           # Cấu hình Firebase, Gemini API, và hàm DOM
├── auth.js             # Xử lý đăng nhập/đăng ký Firebase
├── main.js             # Logic chính, kết nối các module
├── video-feed.js       # Hiển thị, upload, và thao tác video
├── assets/             # Hình ảnh, nhạc, video mẫu
├── svg/                # Biểu tượng SVG dùng trong app
└── README.md           # (Tệp này)
```

---

## ⚙️ Công nghệ sử dụng

| Thành phần | Mô tả |
|-------------|-------|
| **Frontend** | HTML5, CSS3 (TailwindCSS), JavaScript (ES Module) |
| **Backend (Serverless)** | Firebase Authentication, Firestore Database, Firebase Storage |
| **AI Assistant** | Google Gemini API |
| **Mini Game** | Thuần JavaScript + LocalStorage |
| **Hosting gợi ý** | Firebase Hosting hoặc GitHub Pages |

---

## 🔧 Cài đặt và chạy dự án

### 1. Clone dự án
```bash
git clone https://github.com/<your-username>/LTTSignature.git
cd LTTSignature
```

### 2. Cập nhật khóa API
Mở file `config.js` và thay thế bằng thông tin của bạn:
```js
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_KEY",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "xxxxx",
  appId: "xxxxx",
};
export const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";
```

### 3. Chạy thử
Chỉ cần mở file `index.html` bằng trình duyệt (khuyên dùng: Chrome).  
Hoặc dùng VSCode + Live Server extension để test cục bộ.

### 4. Triển khai
- **GitHub Pages**: commit & push toàn bộ code, bật Pages trong Settings → Pages → Branch: main → /root.  
- **Firebase Hosting**:  
```bash
firebase init hosting
firebase deploy
```

---

## 💡 Gợi ý phát triển tương lai
- Thêm tính năng bình luận video.  
- Cho phép tải video trực tiếp từ ứng dụng di động.  
- Cải thiện thuật toán gợi ý video học tập bằng AI.  
- Mở rộng hệ thống “Nhiệm vụ hằng ngày” trong Game Center.

---

## 👥 Nhóm thực hiện
**Dự án:** *LTT Signature — Ứng dụng học tập video ngắn cho học sinh THCS Lý Thánh Tông*
**Trường:** THCS Lý Thánh Tông, TP. Hồ Chí Minh  
**Hướng dẫn:** Phòng Thí Nghiệm STEM – Lý Thánh Tông Lab  
**Nhóm phát triển:** LTT5  

---

## 📄 Giấy phép
Dự án được phát hành cho mục đích **nghiên cứu và giáo dục phi thương mại**.  
Mọi quyền khác thuộc về nhóm phát triển LTT5.
