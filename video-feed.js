import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import {
    ref as dbRef,
    push,
    set,
    get,
    query as dbQuery,
    orderByKey,
    startAt,
    limitToFirst,
    limitToLast
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { formatUserId, getYoutubeId, isYoutubeUrl, MUTE_ICON_PATH, UNMUTE_ICON_PATH, PLAY_ICON_PATH, PAUSE_ICON_PATH, closeModal } from './config.js';
import { serverTimestamp, setDoc, getDoc, updateDoc, doc, arrayUnion, arrayRemove, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig, LIKE_ICON_PATH, SHARE_ICON_PATH } from './config.js';

// Biến giữ dependencies để render có thể truy cập db & getUserId
let videoDependencies = null;

let currentActiveMediaElement = null; // Biến trạng thái để theo dõi media đang phát

let feedContainerRef = null;
let fullscreenChangeRegistered = false;

const getFullscreenElement = () =>
    document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;

const isElementInFullscreen = (element) => {
    if (!element) return false;
    const fullscreenElement = getFullscreenElement();
    if (!fullscreenElement) return false;
    return fullscreenElement === element || element.contains(fullscreenElement);
};

const exitFeedFullscreen = () => {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    if (document.msExitFullscreen) return document.msExitFullscreen();
    return Promise.resolve();
};

const updateFullscreenVisualState = () => {
    if (!feedContainerRef) return;
    const fullscreenElement = getFullscreenElement();
    const isActive = Boolean(fullscreenElement);

    document.body.classList.toggle('feed-fullscreen-active', isActive);

    const postItems = feedContainerRef.querySelectorAll('.video-snap-item');
    postItems.forEach((post) => {
        const isPostFullscreen = isElementInFullscreen(post);
        post.classList.toggle('is-fullscreen', isPostFullscreen);
        post.dataset.fullscreen = isPostFullscreen ? 'true' : 'false';

        const fullscreenBtn = post.querySelector('.fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.dataset.state = isPostFullscreen ? 'on' : 'off';
            const label = isPostFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình';
            fullscreenBtn.setAttribute('aria-label', label);
            fullscreenBtn.setAttribute('title', label);
        }

        const fullscreenIcon = post.querySelector('.fullscreen-icon');
        if (fullscreenIcon) {
            fullscreenIcon.textContent = isPostFullscreen ? '🗗' : '⛶';
        }
    });
};

const ensureFullscreenListeners = (DOM) => {
    if (!DOM?.videoFeedContainer) return;
    feedContainerRef = DOM.videoFeedContainer;
    if (fullscreenChangeRegistered) return;

    const handleChange = () => {
        updateFullscreenVisualState();
    };

    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach((evt) => {
        document.addEventListener(evt, handleChange);
    });

    document.addEventListener('fullscreenerror', () => {
        setTimeout(updateFullscreenVisualState, 0);
    });

    fullscreenChangeRegistered = true;
};

const togglePostFullscreen = (postElement) => {
    if (!postElement) return;

    if (isElementInFullscreen(postElement)) {
        const exitResult = exitFeedFullscreen();
        if (exitResult && typeof exitResult.then === 'function') {
            exitResult.finally(() => updateFullscreenVisualState());
        } else {
            setTimeout(updateFullscreenVisualState, 60);
        }
        return;
    }

    const requestTarget = postElement;
    const request =
        requestTarget.requestFullscreen ||
        requestTarget.webkitRequestFullscreen ||
        requestTarget.msRequestFullscreen;

    if (typeof request !== 'function') return;

    const maybePromise = request.call(requestTarget);

    const afterEnter = () => {
        updateFullscreenVisualState();
    };

    if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(afterEnter).catch(() => updateFullscreenVisualState());
    } else {
        setTimeout(afterEnter, 60);
    }
};

// --- LOGIC XỬ LÝ POST VIDEO ---

const handlePostSubmit = async (e, userId, db, storage, DOM, getVideosDbRef) => {
    e.preventDefault();
    if (!userId) {
        DOM.postMessageEl.textContent = "Lỗi: Vui lòng đăng nhập.";
        return;
    }

    const title = DOM.postTitleEl.value.trim();
    const description = DOM.postDescriptionEl.value.trim();
    const selectedSource = document.querySelector('input[name="video_source"]:checked').value;
    let finalVideoUrl = null;
    let isFile = false;

    try {
        if (selectedSource === 'upload') {
            const file = DOM.postFileEl.files[0];
            if (!file || !file.type.startsWith('video/')) {
                DOM.postMessageEl.textContent = "Lỗi: Vui lòng chọn một file video hợp lệ.";
                return;
            }
            // Giới hạn dung lượng video 200MB
const MAX_SIZE_MB = 200;
if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    DOM.postMessageEl.textContent = `Lỗi: Dung lượng video vượt quá ${MAX_SIZE_MB}MB.`;
    return;
}

            isFile = true;

            DOM.uploadBtn.disabled = true;
            DOM.uploadSpinner.classList.remove('hidden');
            DOM.uploadProgressContainer.classList.remove('hidden');
            DOM.postMessageEl.textContent = "Đang tải lên...";
            DOM.uploadProgressEl.style.width = '0%';

            const storageRef = ref(storage, `videos/${userId}/${Date.now()}_${file.name}`);
            const uploadTask = uploadBytesResumable(storageRef, file);

            finalVideoUrl = await new Promise((resolve, reject) => {
                uploadTask.on('state_changed',
                    (snapshot) => {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        DOM.uploadProgressEl.style.width = progress + '%';
                        DOM.postMessageEl.textContent = `Đang tải lên: ${Math.round(progress)}%`;
                    },
                    (error) => reject(new Error(`Tải lên thất bại: ${error.message}`)),
                    async () => resolve(await getDownloadURL(uploadTask.snapshot.ref))
                );
            });

        } else if (selectedSource === 'youtube') {
            const url = DOM.postUrlEl.value.trim();
            if (!isYoutubeUrl(url)) {
                DOM.postMessageEl.textContent = "Lỗi: URL phải là một video YouTube hợp lệ.";
                return;
            }
            finalVideoUrl = url;
        }

        const newPost = {
            userId: userId,
            title: title,
            description: description,
            videoUrl: finalVideoUrl,
            timestamp: serverTimestamp(),
            username: `User_${formatUserId(userId)}`,
            isYoutube: !isFile,
            likes: [],
            shareCount: 0
        };

        const videoRef = getVideosDbRef();
        const newVideoRef = push(videoRef);
        await set(newVideoRef, {
            ...newPost,
            createdAt: Date.now(),
            id: newVideoRef.key
        });

        try {
            const userRef = doc(db, 'users', userId);
            const historyEntry = {
                date: serverTimestamp(),
                change: +1,
                reason: 'Đăng video hợp lệ'
            };

            await setDoc(
                userRef,
                {
                    videosCount: increment(1),
                    videoPoints: increment(1),
                    scoreHistory: arrayUnion(historyEntry)
                },
                { merge: true }
            );
        } catch (err) {
            console.error('Lỗi khi cập nhật điểm cho user:', err);
        }

        DOM.postMessageEl.textContent = "Đăng video thành công!";
        closeModal('post-modal');
        DOM.postForm.reset();
        DOM.postFileEl.value = '';
        DOM.postUrlEl.value = '';
        setTimeout(() => DOM.postMessageEl.textContent = '', 3000);

    } catch (error) {
        console.error("Lỗi đăng bài:", error);
        DOM.postMessageEl.textContent = `Lỗi: ${error.message}`;
    } finally {
        DOM.uploadBtn.disabled = false;
        DOM.uploadSpinner.classList.add('hidden');
        DOM.uploadProgressContainer.classList.add('hidden');
    }
};

// --- LOGIC PLAY/PAUSE/MUTE ---

const toggleMute = (element) => {
    let isMuted = false;
    const iconImage = element.closest('.video-snap-item').querySelector('.volume-icon');

    if (element.tagName === 'VIDEO') {
        element.muted = !element.muted;
        isMuted = element.muted;
    } else if (element.tagName === 'IFRAME') {
        const currentSrc = element.src;
        if (currentSrc.includes('mute=1')) {
            element.src = currentSrc.replace('mute=1', 'mute=0');
            isMuted = false;
        } else if (currentSrc.includes('mute=0')) {
            element.src = currentSrc.replace('mute=0', 'mute=1');
            isMuted = true;
        } else {
            const separator = currentSrc.includes('?') ? '&' : '?';
            element.src = currentSrc + `${separator}mute=0`;
            isMuted = false;
        }
    }

    if (iconImage) {
        iconImage.src = isMuted ? MUTE_ICON_PATH : UNMUTE_ICON_PATH;
        iconImage.classList.remove('text-white');
        iconImage.classList.add('text-black');
    }
};
window.toggleMute = toggleMute;

const togglePlayPause = (mediaContainer) => {
    const mediaElement = mediaContainer.querySelector('.media-element');
    const playPauseIcon = mediaContainer.querySelector('.play-pause-icon');

    if (!mediaElement || mediaElement.tagName !== 'VIDEO') return;

    if (mediaElement.paused) {
        mediaElement.play().catch(e => console.log("Play failed:", e));
        playPauseIcon.classList.add('hidden');
    } else {
        mediaElement.pause();
        playPauseIcon.src = PLAY_ICON_PATH;
        playPauseIcon.classList.remove('hidden');
    }

    currentActiveMediaElement = mediaElement;
};
window.togglePlayPause = togglePlayPause;

// --- HIỂN THỊ VIDEO ---

const renderVideoFeed = (posts, DOM) => {
    ensureFullscreenListeners(DOM);
    updateFullscreenVisualState();

    DOM.videoFeedContainer.innerHTML = '';
    if (posts.length === 0) {
        DOM.videoFeedContainer.appendChild(DOM.loadingFeedEl);
        DOM.loadingFeedEl.classList.remove('hidden');
        DOM.loadingFeedEl.textContent = 'Chưa có video nào. Hãy là người đầu tiên đăng bài!';
        return;
    }

    posts.forEach(post => {
        const postElement = document.createElement('div');
        postElement.className = 'video-snap-item relative';
        postElement.setAttribute('data-id', post.id);

        // Media hiển thị
        let mediaHtml = '';
        let playPauseOverlayHtml = '';

        if (post.isYoutube) {
            const videoId = getYoutubeId(post.videoUrl);
            if (!videoId) return;
            const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&loop=1&playlist=${videoId}`;
            mediaHtml = `<iframe class="video-display media-element" src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media;" allowfullscreen></iframe>`;
        } else {
            mediaHtml = `<video class="video-display media-element" src="${post.videoUrl}" loop muted playsinline style="object-fit: contain; pointer-events: none;"></video>`;
            playPauseOverlayHtml = `
                <div onclick="togglePlayPause(this.closest('.video-snap-item'))" class="absolute inset-0 z-5 cursor-pointer"></div>
                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-black bg-opacity-0 p-4 rounded-full pointer-events-none">
                    <img class="play-pause-icon h-10 w-10 text-white hidden" src="${PAUSE_ICON_PATH}" alt="Play/Pause">
                </div>
            `;
        }

        const currentUserId = videoDependencies?.getUserId?.();
        const likedByMe = Array.isArray(post.likes) && currentUserId && post.likes.includes(currentUserId);
        const likeCountText = post.likes?.length ? String(post.likes.length) : '';
        const shareCountText = post.shareCount ? String(post.shareCount) : '';

        postElement.innerHTML = `
            ${mediaHtml}
            ${playPauseOverlayHtml}
            <div class="absolute left-0 right-0 px-4 z-10 video-info-wrapper">
                <div class="video-info-panel">
                    <h4 class="video-info-title">${post.title}</h4>
                    <p class="video-info-description">${post.description}</p>
                    <p class="video-info-meta">@${post.username || formatUserId(post.userId)} · Nguồn: ${post.isYoutube ? 'YouTube' : 'Upload'}</p>
                </div>
            </div>
            <div class="video-controls">
                <button onclick="toggleMute(this.closest('.video-snap-item').querySelector('.media-element'))" class="ctrl-btn volume-btn">
                    <img class="volume-icon h-6 w-6 text-black" src="${MUTE_ICON_PATH}">
                </button>
                <button class="like-btn ctrl-btn ${likedByMe ? 'liked' : ''}">
                    <img class="like-icon h-6 w-6" src="${LIKE_ICON_PATH}">
                </button>
                <p class="like-count">${likeCountText}</p>
                <button class="share-btn ctrl-btn">
                    <img class="share-icon h-6 w-6" src="${SHARE_ICON_PATH}">
                </button>
                <p class="share-count">${shareCountText}</p>
                <button class="ctrl-btn fullscreen-btn" type="button" aria-label="Xem toàn màn hình" title="Xem toàn màn hình" data-state="off">
                    <span class="fullscreen-icon" aria-hidden="true">⛶</span>
                </button>
            </div>
        `;

        DOM.videoFeedContainer.appendChild(postElement);

        // Sự kiện Like & Share
        const likeBtnEl = postElement.querySelector('.like-btn');
        const shareBtnEl = postElement.querySelector('.share-btn');
        if (likeBtnEl) likeBtnEl.addEventListener('click', e => { e.stopPropagation(); handleLike(post.id); });
        if (shareBtnEl) shareBtnEl.addEventListener('click', e => { e.stopPropagation(); handleShare(post.id, post.videoUrl); });

        const fullscreenBtn = postElement.querySelector('.fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                togglePostFullscreen(postElement);
            });
        }

        // ✅ Thêm nút xóa (chỉ admin)
        const currentUserId2 = videoDependencies?.getUserId?.();
        if (currentUserId2) {
            const userRef = doc(videoDependencies.db, 'users', currentUserId2);
            getDoc(userRef).then(snap => {
                const role = snap.exists() ? snap.data().role : '';
                if (role === 'admin') {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'ctrl-btn bg-red-500 hover:bg-red-600 text-white';
                    deleteBtn.innerHTML = '🗑️';
                    deleteBtn.title = 'Xóa video';
                    deleteBtn.addEventListener('click', e => {
                        e.stopPropagation();
                        deleteVideo(post.id, post.videoUrl, post.isYoutube);
                    });
                    postElement.querySelector('.video-controls').appendChild(deleteBtn);
                }
            });
        }
    });

    DOM.videoFeedContainer.prepend(DOM.loadingFeedEl);
    handleVideoScrolling(DOM);
    updateFullscreenVisualState();
};

const handleVideoScrolling = (DOM) => {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const mediaElement = entry.target.querySelector('.media-element');
            const playPauseIcon = entry.target.querySelector('.play-pause-icon');
            if (!mediaElement) return;
            const iconImage = entry.target.querySelector('.volume-icon');

            if (entry.isIntersecting) {
                if (mediaElement !== currentActiveMediaElement) {
                    if (currentActiveMediaElement) {
                        if (currentActiveMediaElement.tagName === 'VIDEO') {
                            currentActiveMediaElement.pause();
                            const oldIcon = currentActiveMediaElement.closest('.video-snap-item')?.querySelector('.play-pause-icon');
                            if (oldIcon) oldIcon.src = PLAY_ICON_PATH;
                        }
                    }

                    if (mediaElement.tagName === 'VIDEO') {
                        mediaElement.muted = true;
                        mediaElement.play().catch(() => {});
                        if (playPauseIcon) playPauseIcon.classList.add('hidden');
                    }
                    currentActiveMediaElement = mediaElement;
                    if (iconImage) iconImage.src = MUTE_ICON_PATH;
                }
            } else {
                if (mediaElement.tagName === 'VIDEO') mediaElement.pause();
            }
        });
    }, { root: DOM.videoFeedContainer, threshold: 0.8 });

    DOM.videoFeedContainer.querySelectorAll('.video-snap-item').forEach(item => observer.observe(item));
};

const handleLike = async (postId) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) return alert("Vui lòng đăng nhập.");

    const postRef = doc(deps.db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'videos', postId);
    const postEl = document.querySelector(`[data-id='${postId}']`);
    const likeBtn = postEl?.querySelector('.like-btn');
    const likeCountEl = postEl?.querySelector('.like-count');
    const liked = likeBtn?.classList.contains('liked');

    try {
        if (liked) {
            await updateDoc(postRef, { likes: arrayRemove(userId) });
            likeBtn.classList.remove('liked');
            const cur = parseInt(likeCountEl.textContent || '0');
            likeCountEl.textContent = cur > 1 ? cur - 1 : '';
        } else {
            await updateDoc(postRef, { likes: arrayUnion(userId) });
            likeBtn.classList.add('liked');
            const cur = parseInt(likeCountEl.textContent || '0');
            likeCountEl.textContent = isNaN(cur) ? '1' : (cur + 1);
        }
    } catch (err) {
        console.error(err);
    }
};

const handleShare = async (postId, videoUrl) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) return alert("Vui lòng đăng nhập.");

    const postRef = doc(deps.db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'videos', postId);
    const snapshot = await getDoc(postRef);
    const data = snapshot.exists() ? snapshot.data() : {};
    const sharedBy = Array.isArray(data.sharedBy) ? data.sharedBy : [];

    if (sharedBy.includes(userId)) return alert("Bạn đã chia sẻ video này rồi.");

    await updateDoc(postRef, { sharedBy: [...sharedBy, userId], shareCount: increment(1) });
    await navigator.clipboard.writeText(videoUrl);
    alert("Đã sao chép liên kết video!");
};

const deleteVideo = async (videoId, videoUrl, isYoutube) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) return alert("Vui lòng đăng nhập.");

    const userRef = doc(deps.db, 'users', userId);
    const snap = await getDoc(userRef);
    const role = snap.exists() ? snap.data().role : '';
    if (role !== 'admin') return alert("Chỉ admin mới được quyền xóa video!");
    if (!confirm("Bạn có chắc chắn muốn xóa video này không?")) return;

    const postRef = doc(deps.db, `artifacts/${firebaseConfig.projectId}/public/data/videos`, videoId);
    const postSnap = await getDoc(postRef);
    const uploaderId = postSnap.exists() ? postSnap.data().userId : null;

    await deleteDoc(postRef);

    if (uploaderId) {
        try {
            const uploaderRef = doc(deps.db, 'users', uploaderId);
            const uploaderSnap = await getDoc(uploaderRef);
            const uploaderData = uploaderSnap.exists() ? uploaderSnap.data() : {};

            const currentVideos = typeof uploaderData.videosCount === 'number' ? uploaderData.videosCount : 0;
            const currentLost = typeof uploaderData.lostVideos === 'number' ? uploaderData.lostVideos : 0;
            const currentVideoPoints = typeof uploaderData.videoPoints === 'number' ? uploaderData.videoPoints : 0;

            const historyEntry = {
                date: serverTimestamp(),
                change: -1,
                reason: 'Video bị xóa hoặc vi phạm'
            };

            await setDoc(
                uploaderRef,
                {
                    videosCount: Math.max(0, currentVideos - 1),
                    lostVideos: currentLost + 1,
                    videoPoints: currentVideoPoints - 1,
                    scoreHistory: arrayUnion(historyEntry)
                },
                { merge: true }
            );
        } catch (error) {
            console.error('Lỗi khi trừ điểm cho người đăng:', error);
        }
    }

    if (!isYoutube && videoUrl && videoUrl.includes('/o/')) {
        try {
            const encodedPath = videoUrl.split('/o/')[1]?.split('?')[0];
            if (encodedPath) {
                const path = decodeURIComponent(encodedPath);
                const fileRef = ref(deps.storage, path);
                await deleteObject(fileRef);
            }
        } catch (error) {
            console.error('Không thể xóa file video trong storage:', error);
        }
    }

    alert("Đã xóa video thành công!");
};
window.deleteVideo = deleteVideo;

const FEED_PAGE_SIZE = 10;
const PLACEHOLDER_COUNT = 4;

const createSkeletonCard = () => {
    const skeleton = document.createElement('article');
    skeleton.className = 'video-snap-item video-card skeleton-card snap-start animate-pulse';
    skeleton.innerHTML = `
        <div class="video-wrapper skeleton-media"></div>
        <div class="p-4 space-y-3">
            <div class="h-4 bg-gray-200 rounded w-2/3"></div>
            <div class="h-3 bg-gray-200 rounded w-1/2"></div>
            <div class="h-3 bg-gray-200 rounded w-full"></div>
        </div>
    `;
    return skeleton;
};

const renderVideoCard = (video) => {
    const card = document.createElement('article');
    card.className = 'video-snap-item video-card snap-start';
    card.dataset.key = video.id;

    const mediaWrapper = document.createElement('div');
    mediaWrapper.className = 'video-wrapper';

    if (video.isYoutube && video.videoUrl) {
        const youtubeId = getYoutubeId(video.videoUrl);
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube.com/embed/${youtubeId}?rel=0&playsinline=1`;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.loading = 'lazy';
        mediaWrapper.appendChild(iframe);
    } else {
        const videoEl = document.createElement('video');
        videoEl.src = video.videoUrl;
        videoEl.controls = true;
        videoEl.loop = true;
        videoEl.preload = 'metadata';
        videoEl.playsInline = true;
        videoEl.className = 'w-full h-full object-cover rounded-xl';
        mediaWrapper.appendChild(videoEl);
    }

    const content = document.createElement('div');
    content.className = 'p-4 space-y-2';
    content.innerHTML = `
        <h3 class="text-lg font-semibold text-gray-900">${video.title || 'Video không tiêu đề'}</h3>
        <p class="text-sm text-gray-600">${video.description || ''}</p>
        <p class="text-xs text-gray-500">Đăng bởi ${video.username || 'Ẩn danh'}</p>
    `;

    card.append(mediaWrapper, content);
    return card;
};

export const loadPage = async (realtimeDb, limit = FEED_PAGE_SIZE, startKey = null, useTail = false) => {
    const baseRef = dbRef(realtimeDb, '/videos');
    const pageLimit = limit + (startKey ? 1 : 0);
    const constraints = [orderByKey()];

    if (startKey) {
        constraints.push(startAt(startKey));
    }

    constraints.push(useTail ? limitToLast(pageLimit) : limitToFirst(pageLimit));

    const snapshot = await get(dbQuery(baseRef, ...constraints));
    const rawData = snapshot.exists() ? snapshot.val() : {};
    let entries = Object.entries(rawData).sort((a, b) => a[0].localeCompare(b[0]));

    if (startKey) {
        entries = entries.filter(([key]) => key !== startKey);
    }

    const hasMore = entries.length > limit;
    const sliced = entries.slice(0, limit);
    const items = sliced.map(([id, value]) => ({ id, ...value }));
    const nextKey = items.length ? items[items.length - 1].id : null;

    return { items, hasMore, nextKey };
};

class VideoFeed {
    constructor({ realtimeDb, container, loadingEl, pageSize = FEED_PAGE_SIZE }) {
        this.realtimeDb = realtimeDb;
        this.container = container;
        this.loadingEl = loadingEl;
        this.pageSize = pageSize;
        this.lastKey = null;
        this.hasMore = true;
        this.isLoading = false;
        this.loadedKeys = new Set();
        this.sentinel = document.createElement('div');
        this.sentinel.className = 'feed-sentinel h-1 w-full';
        this.observer = null;
    }

    init() {
        this.renderSkeletons(PLACEHOLDER_COUNT);
        this.attachInfiniteScroll();
        this.attachScrollFallback();
        this.loadNextPage();
    }

    renderSkeletons(count) {
        if (!this.container) return;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            fragment.appendChild(createSkeletonCard());
        }
        this.container.appendChild(fragment);
    }

    clearSkeletons() {
        this.container.querySelectorAll('.skeleton-card').forEach((node) => node.remove());
    }

    appendVideos(videos) {
        const fragment = document.createDocumentFragment();
        videos.forEach((video) => {
            if (this.loadedKeys.has(video.id)) return;
            this.loadedKeys.add(video.id);
            fragment.appendChild(renderVideoCard(video));
        });
        this.container.append(fragment);
    }

    async loadNextPage() {
        if (this.isLoading || !this.hasMore || !this.realtimeDb) return;
        this.isLoading = true;
        this.loadingEl?.classList.remove('hidden');
        this.loadingEl.textContent = 'Đang tải video...';

        try {
            const { items, hasMore, nextKey } = await loadPage(this.realtimeDb, this.pageSize, this.lastKey);
            this.clearSkeletons();
            this.appendVideos(items);
            this.lastKey = nextKey;
            this.hasMore = hasMore;
            if (!hasMore) {
                this.sentinel?.remove();
            }
        } catch (error) {
            console.error('Không thể tải danh sách video:', error);
            this.loadingEl.textContent = 'Không thể tải danh sách video. Vui lòng thử lại.';
        } finally {
            this.isLoading = false;
            this.loadingEl?.classList.add('hidden');
        }
    }

    attachInfiniteScroll() {
        if (!('IntersectionObserver' in window) || !this.container) return;

        this.container.appendChild(this.sentinel);
        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        this.loadNextPage();
                    }
                });
            },
            {
                root: null,
                rootMargin: '0px 0px -20% 0px',
                threshold: 0
            }
        );

        this.observer.observe(this.sentinel);
    }

    attachScrollFallback() {
        const target = this.container || window;
        target.addEventListener(
            'scroll',
            () => {
                const el = this.container || document.documentElement;
                const scrollTop = el.scrollTop || document.documentElement.scrollTop;
                const scrollHeight = el.scrollHeight || document.documentElement.scrollHeight;
                const clientHeight = el.clientHeight || window.innerHeight;
                const ratio = scrollHeight > 0 ? (scrollTop + clientHeight) / scrollHeight : 0;
                if (ratio >= 0.8) {
                    this.loadNextPage();
                }
            },
            { passive: true }
        );
    }

    disconnect() {
        if (this.observer && this.sentinel) {
            this.observer.unobserve(this.sentinel);
        }
    }
}

let activeFeedInstance = null;

export const initializeVideoFeed = (realtimeDb, DOM, options = {}) => {
    if (!DOM?.videoFeedContainer) return null;
    if (activeFeedInstance) {
        activeFeedInstance.disconnect();
    }

    activeFeedInstance = new VideoFeed({
        realtimeDb,
        container: DOM.videoFeedContainer,
        loadingEl: DOM.loadingFeedEl,
        pageSize: options.pageSize || FEED_PAGE_SIZE
    });

    activeFeedInstance.init();
    return activeFeedInstance;
};

export const loadPosts = (realtimeDb, DOM) => initializeVideoFeed(realtimeDb, DOM);

export const setupVideoListeners = (DOM, dependencies) => {
    videoDependencies = dependencies;

    DOM.sourceUploadRadio.addEventListener('change', () => {
        DOM.postFileEl.classList.remove('hidden');
        DOM.postUrlEl.classList.add('hidden');
    });

    DOM.sourceYoutubeRadio.addEventListener('change', () => {
        DOM.postFileEl.classList.add('hidden');
        DOM.postUrlEl.classList.remove('hidden');
    });

    DOM.postForm.addEventListener('submit', (e) => {
        const userId = dependencies.getUserId();
        handlePostSubmit(
            e,
            userId,
            dependencies.db,
            dependencies.storage,
            DOM,
            dependencies.getVideosDbRef
        );
    });
};
