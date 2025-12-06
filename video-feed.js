import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import {
    serverTimestamp,
    setDoc,
    getDoc,
    updateDoc,
    doc,
    arrayUnion,
    arrayRemove,
    increment,
    deleteDoc,
    addDoc,
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { formatUserId, getYoutubeId, isYoutubeUrl, MUTE_ICON_PATH, UNMUTE_ICON_PATH, PLAY_ICON_PATH, PAUSE_ICON_PATH, closeModal, firebaseConfig, LIKE_ICON_PATH, SHARE_ICON_PATH } from './config.js';

let videoDependencies = null;
let currentActiveMediaElement = null;
let feedContainerRef = null;
let fullscreenChangeRegistered = false;
let lastVisibleDoc = null;
let isLoadingPage = false;
let hasMoreVideos = true;
let cachedPosts = [];
let loadMoreBtnRef = null;
let sentinelRef = null;
let sentinelObserver = null;
let videoObserver = null;
const intersectionRatioMap = new Map();

const PAGE_SIZE = 10;

const getVideosCollection = (db) => collection(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'videos');

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

const ensureLoadMoreControls = (DOM) => {
    if (!DOM?.videoFeedContainer) return;

    if (!loadMoreBtnRef) {
        const wrapper = document.createElement('div');
        wrapper.className = 'text-center py-6';

        const btn = document.createElement('button');
        btn.className = 'btn-primary px-6 py-3';
        btn.textContent = 'Tải thêm';
        btn.addEventListener('click', () => loadMoreVideos(DOM));

        wrapper.appendChild(btn);
        loadMoreBtnRef = btn;
        DOM.videoFeedContainer.appendChild(wrapper);
    }

    if (!sentinelRef) {
        sentinelRef = document.createElement('div');
        sentinelRef.className = 'feed-end-sentinel h-6 w-full';
        DOM.videoFeedContainer.appendChild(sentinelRef);
    }
};

const setupSentinelObserver = (DOM) => {
    if (!sentinelRef) return;
    if (sentinelObserver) sentinelObserver.disconnect();

    sentinelObserver = new IntersectionObserver(
        (entries) => {
            const shouldLoad = entries.some((entry) => entry.isIntersecting);
            if (shouldLoad) loadMoreVideos(DOM);
        },
        { root: null, threshold: 0.1 }
    );

    sentinelObserver.observe(sentinelRef);
};

const setLoadMoreButtonState = (text, disabled = false) => {
    if (!loadMoreBtnRef) return;
    loadMoreBtnRef.textContent = text;
    loadMoreBtnRef.disabled = disabled;
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

const handlePostSubmit = async (e, userId, db, storage, DOM) => {
    e.preventDefault();
    if (!userId) {
        DOM.postMessageEl.textContent = "Lỗi: Vui lòng đăng nhập.";
        return;
    }

    const title = DOM.postTitleEl.value.trim();
    const description = DOM.postDescriptionEl.value.trim();
    const selectedSource = document.querySelector('input[name="video_source"]:checked')?.value;
    let finalVideoUrl = null;
    let isFile = false;

    if (!selectedSource) {
        DOM.postMessageEl.textContent = "Lỗi: Vui lòng chọn nguồn video.";
        return;
    }

    try {
        if (selectedSource === 'upload') {
            const file = DOM.postFileEl.files[0];
            if (!file || !file.type.startsWith('video/')) {
                DOM.postMessageEl.textContent = "Lỗi: Vui lòng chọn một file video hợp lệ.";
                return;
            }
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

            const fileRef = storageRef(storage, `videos/${userId}/${Date.now()}_${file.name}`);
            const uploadTask = uploadBytesResumable(fileRef, file);

            finalVideoUrl = await new Promise((resolve, reject) => {
                uploadTask.on(
                    'state_changed',
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
            userId,
            title,
            description,
            videoUrl: finalVideoUrl,
            timestamp: serverTimestamp(),
            username: `User_${formatUserId(userId)}`,
            isYoutube: !isFile,
            likes: [],
            shareCount: 0,
            createdAt: serverTimestamp()
        };

        const videosCol = getVideosCollection(db);
        await addDoc(videosCol, newPost);

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
        setTimeout(() => (DOM.postMessageEl.textContent = ''), 3000);
    } catch (error) {
        console.error("Lỗi đăng bài:", error);
        DOM.postMessageEl.textContent = `Lỗi: ${error.message}`;
    } finally {
        DOM.uploadBtn.disabled = false;
        DOM.uploadSpinner.classList.add('hidden');
        DOM.uploadProgressContainer.classList.add('hidden');
    }
};

const toggleMute = (element) => {
    let isMuted = false;
    const iconImage = element.closest('.video-snap-item')?.querySelector('.volume-icon');

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
        mediaElement.play().catch((e) => console.log("Play failed:", e));
        if (playPauseIcon) playPauseIcon.classList.add('hidden');
    } else {
        mediaElement.pause();
        if (playPauseIcon) {
            playPauseIcon.src = PLAY_ICON_PATH;
            playPauseIcon.classList.remove('hidden');
        }
    }

    currentActiveMediaElement = mediaElement;
};
window.togglePlayPause = togglePlayPause;

const lazyLoadMedia = (postElement) => {
    const mediaElement = postElement.querySelector('.media-element');
    if (!mediaElement) return;

    if (!mediaElement.dataset.loaded && mediaElement.dataset.src) {
        mediaElement.src = mediaElement.dataset.src;
        mediaElement.dataset.loaded = 'true';
        if (mediaElement.tagName === 'VIDEO') {
            mediaElement.load();
        }
    }
};

const pauseMediaElement = (mediaElement, playPauseIcon) => {
    if (!mediaElement) return;
    if (mediaElement.tagName === 'VIDEO') {
        mediaElement.pause();
        if (playPauseIcon) {
            playPauseIcon.src = PLAY_ICON_PATH;
            playPauseIcon.classList.remove('hidden');
        }
    }
};

const activateMediaElement = (postElement) => {
    if (!postElement) return;
    const mediaElement = postElement.querySelector('.media-element');
    const playPauseIcon = postElement.querySelector('.play-pause-icon');
    const iconImage = postElement.querySelector('.volume-icon');
    if (!mediaElement) return;

    if (currentActiveMediaElement && currentActiveMediaElement !== mediaElement) {
        const prevIcon = currentActiveMediaElement.closest('.video-snap-item')?.querySelector('.play-pause-icon');
        pauseMediaElement(currentActiveMediaElement, prevIcon);
    }

    if (mediaElement.tagName === 'VIDEO') {
        mediaElement.muted = true;
        mediaElement.play().catch(() => {});
        if (playPauseIcon) playPauseIcon.classList.add('hidden');
        if (iconImage) iconImage.src = MUTE_ICON_PATH;
    }

    currentActiveMediaElement = mediaElement;
};

const updateActiveMediaPlayback = () => {
    let bestEntry = null;
    let bestRatio = 0;

    intersectionRatioMap.forEach((ratio, element) => {
        if (ratio > bestRatio) {
            bestRatio = ratio;
            bestEntry = element;
        }
    });

    if (bestEntry && bestRatio > 0.35) {
        activateMediaElement(bestEntry);
    } else if (currentActiveMediaElement) {
        const playPauseIcon = currentActiveMediaElement.closest('.video-snap-item')?.querySelector('.play-pause-icon');
        pauseMediaElement(currentActiveMediaElement, playPauseIcon);
        currentActiveMediaElement = null;
    }
};

const handleVideoScrolling = (DOM) => {
    if (videoObserver) videoObserver.disconnect();
    intersectionRatioMap.clear();

    videoObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                const postElement = entry.target;
                const mediaElement = postElement.querySelector('.media-element');
                const playPauseIcon = postElement.querySelector('.play-pause-icon');
                if (!mediaElement) return;

                if (entry.isIntersecting) {
                    lazyLoadMedia(postElement);
                    intersectionRatioMap.set(postElement, entry.intersectionRatio);
                } else {
                    intersectionRatioMap.set(postElement, 0);
                    pauseMediaElement(mediaElement, playPauseIcon);
                }
            });

            updateActiveMediaPlayback();
        },
        { root: null, threshold: [0.35, 0.6, 0.85] }
    );

    DOM.videoFeedContainer.querySelectorAll('.video-snap-item').forEach((item) => videoObserver.observe(item));
};

const renderVideoFeed = (posts, DOM, isAppend = false) => {
    ensureFullscreenListeners(DOM);
    updateFullscreenVisualState();

    if (!isAppend) {
        DOM.videoFeedContainer.innerHTML = '';
        intersectionRatioMap.clear();
        if (videoObserver) videoObserver.disconnect();
        videoObserver = null;
        currentActiveMediaElement = null;
    }

    if (!posts.length && !isAppend) {
        DOM.videoFeedContainer.appendChild(DOM.loadingFeedEl);
        DOM.loadingFeedEl.classList.remove('hidden');
        DOM.loadingFeedEl.textContent = 'Chưa có video nào. Hãy là người đầu tiên đăng bài!';
        return;
    }

    DOM.loadingFeedEl.classList.add('hidden');

    posts.forEach((post) => {
        const postElement = document.createElement('div');
        postElement.className = 'video-snap-item relative';
        postElement.setAttribute('data-id', post.id);

        let mediaHtml = '';
        let playPauseOverlayHtml = '';

        if (post.isYoutube) {
            const videoId = getYoutubeId(post.videoUrl);
            if (!videoId) return;
            const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&loop=1&playlist=${videoId}`;
            mediaHtml = `<iframe class="video-display media-element" data-src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media;" allowfullscreen></iframe>`;
        } else {
            mediaHtml = `<video class="video-display media-element" data-src="${post.videoUrl}" loop muted playsinline preload="none" style="object-fit: contain; pointer-events: none;"></video>`;
            playPauseOverlayHtml = `
                <div onclick="togglePlayPause(this.closest('.video-snap-item'))" class="absolute inset-0 z-5 cursor-pointer"></div>
                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-black bg-opacity-0 p-4 rounded-full pointer-events-none">
                    <img class="play-pause-icon h-10 w-10 text-white hidden" src="${PAUSE_ICON_PATH}" alt="Play/Pause">
                </div>
            `;
        }

        const currentUserId = videoDependencies?.getUserId?.();
        const likesArray = Array.isArray(post.likes) ? post.likes : [];
        const likedByMe = currentUserId && likesArray.includes(currentUserId);
        const likeCountText = likesArray.length ? String(likesArray.length) : '';
        const shareCountText = post.shareCount ? String(post.shareCount) : '';

        postElement.innerHTML = `
            ${mediaHtml}
            ${playPauseOverlayHtml}
            <div class="absolute left-0 right-0 px-4 z-10 video-info-wrapper">
                <div class="video-info-panel">
                    <h4 class="video-info-title">${post.title || ''}</h4>
                    <p class="video-info-description">${post.description || ''}</p>
                    <p class="video-info-meta">@${post.username || formatUserId(post.userId || '')} · Nguồn: ${post.isYoutube ? 'YouTube' : 'Upload'}</p>
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

        const likeBtnEl = postElement.querySelector('.like-btn');
        const shareBtnEl = postElement.querySelector('.share-btn');
        if (likeBtnEl) likeBtnEl.addEventListener('click', (event) => { event.stopPropagation(); handleLike(post.id); });
        if (shareBtnEl) shareBtnEl.addEventListener('click', (event) => { event.stopPropagation(); handleShare(post.id, post.videoUrl); });

        const fullscreenBtn = postElement.querySelector('.fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                togglePostFullscreen(postElement);
            });
        }

        const currentUserId2 = videoDependencies?.getUserId?.();
        if (currentUserId2) {
            const userRef = doc(videoDependencies.db, 'users', currentUserId2);
            getDoc(userRef).then((snap) => {
                const role = snap.exists() ? snap.data().role : '';
                if (role === 'admin') {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'ctrl-btn bg-red-500 hover:bg-red-600 text-white';
                    deleteBtn.innerHTML = '🗑️';
                    deleteBtn.title = 'Xóa video';
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        deleteVideo(post.id, post.videoUrl, post.isYoutube);
                    });
                    postElement.querySelector('.video-controls')?.appendChild(deleteBtn);
                }
            });
        }
    });

    ensureLoadMoreControls(DOM);
    DOM.videoFeedContainer.prepend(DOM.loadingFeedEl);
    handleVideoScrolling(DOM);
    setupSentinelObserver(DOM);
    updateFullscreenVisualState();
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
            likeBtn?.classList.remove('liked');
            const cur = parseInt(likeCountEl?.textContent || '0', 10);
            if (likeCountEl) likeCountEl.textContent = cur > 1 ? cur - 1 : '';
        } else {
            await updateDoc(postRef, { likes: arrayUnion(userId) });
            likeBtn?.classList.add('liked');
            const cur = parseInt(likeCountEl?.textContent || '0', 10);
            if (likeCountEl) likeCountEl.textContent = Number.isNaN(cur) ? '1' : String(cur + 1);
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

    const postRef = doc(deps.db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'videos', videoId);
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
                const fileRef = storageRef(deps.storage, path);
                await deleteObject(fileRef);
            }
        } catch (error) {
            console.error('Không thể xóa file video trong storage:', error);
        }
    }

    alert("Đã xóa video thành công!");
};
window.deleteVideo = deleteVideo;

const fetchVideosPage = async (db, afterDoc = null) => {
    const videosCol = getVideosCollection(db);
    const constraints = afterDoc
        ? [orderBy('timestamp', 'desc'), startAfter(afterDoc), limit(PAGE_SIZE)]
        : [orderBy('timestamp', 'desc'), limit(PAGE_SIZE)];

    const videosQuery = query(videosCol, ...constraints);
    const snapshot = await getDocs(videosQuery);
    const posts = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    const lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;

    return { posts, lastDoc };
};

const resetFeedState = () => {
    lastVisibleDoc = null;
    cachedPosts = [];
    hasMoreVideos = true;
    isLoadingPage = false;
    intersectionRatioMap.clear();
    if (videoObserver) videoObserver.disconnect();
    videoObserver = null;
    if (sentinelObserver) sentinelObserver.disconnect();
    if (loadMoreBtnRef) {
        loadMoreBtnRef.disabled = false;
        loadMoreBtnRef.textContent = 'Tải thêm';
    }
    sentinelObserver = null;
    loadMoreBtnRef = null;
    sentinelRef = null;
};

export const loadPosts = async (db, DOM, dependencies = null) => {
    if (dependencies) {
        videoDependencies = dependencies;
    }
    if (!db || !DOM?.videoFeedContainer) return () => {};

    resetFeedState();

    DOM.loadingFeedEl.classList.remove('hidden');
    DOM.loadingFeedEl.textContent = 'Đang tải video...';

    isLoadingPage = true;
    try {
        const { posts, lastDoc } = await fetchVideosPage(db, null);
        cachedPosts = posts;
        lastVisibleDoc = lastDoc;
        hasMoreVideos = posts.length === PAGE_SIZE;

        renderVideoFeed(posts, DOM, false);
        setLoadMoreButtonState(hasMoreVideos ? 'Tải thêm' : 'Đã hết video', !hasMoreVideos);
    } catch (error) {
        console.error('Không thể tải video:', error);
        DOM.loadingFeedEl.textContent = 'Không thể tải danh sách video.';
        DOM.loadingFeedEl.classList.remove('hidden');
    } finally {
        isLoadingPage = false;
    }

    return () => {};
};

export const loadMoreVideos = async (DOM) => {
    const deps = videoDependencies;
    if (!deps?.db || !DOM?.videoFeedContainer) return;
    if (isLoadingPage || !hasMoreVideos) return;

    isLoadingPage = true;
    setLoadMoreButtonState('Đang tải...', true);

    try {
        const { posts, lastDoc } = await fetchVideosPage(deps.db, lastVisibleDoc);
        if (!posts.length) {
            hasMoreVideos = false;
            setLoadMoreButtonState('Đã hết video', true);
            if (sentinelObserver) sentinelObserver.disconnect();
            return;
        }

        cachedPosts = [...cachedPosts, ...posts];
        lastVisibleDoc = lastDoc;
        hasMoreVideos = posts.length === PAGE_SIZE;

        renderVideoFeed(posts, DOM, true);
        setLoadMoreButtonState(hasMoreVideos ? 'Tải thêm' : 'Đã hết video', !hasMoreVideos);
        if (!hasMoreVideos && sentinelObserver) sentinelObserver.disconnect();
    } catch (error) {
        console.error('Không thể tải thêm video:', error);
        setLoadMoreButtonState('Tải thêm', false);
    } finally {
        isLoadingPage = false;
    }
};

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
        handlePostSubmit(e, userId, dependencies.db, dependencies.storage, DOM);
    });
};
