import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { formatUserId } from './config.js'; // Chỉ dùng để format hiển thị UID

// Biến trạng thái toàn cục
let userId = null;

/**
 * Xử lý chung cho Đăng nhập và Đăng ký.
 * @param {object} auth - Firebase Auth instance
 * @param {object} DOM - Các phần tử DOM cần thiết
 * @param {boolean} isRegister - True nếu là Đăng ký, False nếu là Đăng nhập
 */
const handleAuth = async (auth, DOM, isRegister) => {
    const email = DOM.authEmailEl.value;
    const password = DOM.authPasswordEl.value;
    
    DOM.authMessageEl.textContent = ''; 
    const btn = isRegister ? DOM.registerBtn : DOM.loginBtn;
    const originalText = btn.innerHTML;
    
    if (!email || password.length < 6) {
         DOM.authMessageEl.textContent = "Lỗi: Email không hợp lệ hoặc Mật khẩu phải từ 6 ký tự.";
         return;
    }

    try {
        // Hiển thị trạng thái đang xử lý
        btn.innerHTML = `<div class="spinner mr-2 w-5 h-5 border-t-2"></div> Đang xử lý...`;
        DOM.loginBtn.disabled = true;
        DOM.registerBtn.disabled = true;

        if (isRegister) {
            await createUserWithEmailAndPassword(auth, email, password);
            DOM.authMessageEl.textContent = "Đăng ký thành công! Đang tự động đăng nhập...";
        } else {
            await signInWithEmailAndPassword(auth, email, password);
            DOM.authMessageEl.textContent = "Đăng nhập thành công!";
        }
    } catch (error) {
        let message = "Lỗi xác thực không xác định.";
        if (error.code === 'auth/email-already-in-use') {
            message = "Email đã được sử dụng. Vui lòng đăng nhập.";
        } else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            message = "Sai email hoặc mật khẩu.";
        } else if (error.code === 'auth/invalid-email') {
             message = "Định dạng email không hợp lệ.";
        } else if (error.code === 'auth/weak-password') {
             message = "Mật khẩu quá yếu, phải từ 6 ký tự trở lên.";
        } else {
             console.error("Lỗi xác thực:", error);
        }
        DOM.authMessageEl.textContent = message;

    } finally {
        btn.innerHTML = originalText;
        DOM.loginBtn.disabled = false;
        DOM.registerBtn.disabled = false;
    }
};

/**
 * Hàm xử lý Đăng xuất
 * @param {object} auth - Firebase Auth instance
 * @param {object} DOM - Các phần tử DOM cần thiết
 */
const handleLogout = async (auth, DOM) => {
    try {
        await signOut(auth);
        DOM.authMessageEl.textContent = "Bạn đã đăng xuất.";
    } catch (error) {
        console.error("Lỗi đăng xuất:", error);
        DOM.authMessageEl.textContent = "Lỗi khi đăng xuất.";
    }
}


/**
 * Thiết lập các listener cho Auth và trả về ID người dùng hiện tại
 * @param {object} auth - Firebase Auth instance
 * @param {object} DOM - Các phần tử DOM
 * @param {function} loadPostsCallback - Callback để tải video khi người dùng đăng nhập
 */
export const setupAuthListeners = (auth, DOM, loadPostsCallback) => {
    
    // Gắn sự kiện cho form Đăng nhập
    DOM.loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleAuth(auth, DOM, false); // Đăng nhập
    });

    // Gắn sự kiện cho nút Đăng ký
    DOM.registerBtn.addEventListener('click', () => {
        handleAuth(auth, DOM, true); // Đăng ký
    });
    
    // Đặt hàm Đăng xuất vào global scope để nút tạo động trong header có thể gọi
    window.handleLogout = () => handleLogout(auth, DOM);


    // Lắng nghe trạng thái xác thực
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;

            // THAY THẾ TRẠNG THÁI BẰNG NÚT ĐĂNG XUẤT
            DOM.authStatusEl.classList.add('auth-status-chip--logged-in');
            DOM.authStatusEl.innerHTML = `
                <button id="header-logout-btn"
                        onclick="handleLogout()"
                        class="logout-btn">
                    Đăng xuất
                </button>
            `;

            DOM.authContainer.classList.add('hidden');
            DOM.videoFeedContainer.style.display = 'block';
            
            // Tải video khi người dùng đã đăng nhập
            if (loadPostsCallback) {
                loadPostsCallback(userId);
            }
        } else {
            userId = null;
            DOM.authStatusEl.classList.remove('auth-status-chip--logged-in');
            DOM.authStatusEl.textContent = "Chưa đăng nhập.";
            DOM.authContainer.classList.remove('hidden');
            DOM.videoFeedContainer.style.display = 'none';
        }
    });
};

export const getUserId = () => userId;
