const users = {
	me: { id: "me", name: "You", username: "you_now", bio: "Frontend learner building mini products.", color: "#0e86d4" },
	ana: { id: "ana", name: "Ana Pham", username: "ana_ui", bio: "UI explorer. Coffee and grids.", color: "#f08a5d" },
	khan: { id: "khan", name: "Khan Tran", username: "khan_code", bio: "JS and weekend bikes.", color: "#6a7fdb" },
	linh: { id: "linh", name: "Linh Vo", username: "linh_media", bio: "Stories, clips, and quick notes.", color: "#2a9d8f" }
};

// ====== CACHING SYSTEM ======
const CACHE_CONFIG = {
	POSTS_KEY: 'twit_posts_cache',
	POSTS_TIMESTAMP_KEY: 'twit_posts_cache_time',
	TTL: 5 * 60 * 1000 // 5 minutes in milliseconds
};

function getCachedPosts() {
	try {
		const cached = localStorage.getItem(CACHE_CONFIG.POSTS_KEY);
		const timestamp = localStorage.getItem(CACHE_CONFIG.POSTS_TIMESTAMP_KEY);
		
		if (!cached || !timestamp) {
			return null;
		}
		
		const now = Date.now();
		const cacheAge = now - parseInt(timestamp);
		
		if (cacheAge > CACHE_CONFIG.TTL) {
			// Cache expired, remove it
			clearPostsCache();
			return null;
		}
		
		console.log(`✓ Loading posts from cache (age: ${(cacheAge / 1000).toFixed(1)}s)`);
		return JSON.parse(cached);
	} catch (error) {
		console.error('Cache read error:', error);
		return null;
	}
}

function setPostsCache(posts) {
	try {
		localStorage.setItem(CACHE_CONFIG.POSTS_KEY, JSON.stringify(posts));
		localStorage.setItem(CACHE_CONFIG.POSTS_TIMESTAMP_KEY, Date.now().toString());
		console.log(`✓ Posts cached (${posts.length} items)`);
	} catch (error) {
		console.error('Cache write error:', error);
	}
}

function clearPostsCache() {
	try {
		localStorage.removeItem(CACHE_CONFIG.POSTS_KEY);
		localStorage.removeItem(CACHE_CONFIG.POSTS_TIMESTAMP_KEY);
		console.log('✓ Posts cache cleared');
	} catch (error) {
		console.error('Cache clear error:', error);
	}
}

// ====== SOCKET.IO CLIENT ======
let socket = null;

function initSocket() {
	if (socket) return; // Already connected
	
	// Connect to Socket.io
	socket = io(API_BASE.replace('/api', ''), {
		reconnection: true,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 5000,
		reconnectionAttempts: 5
	});

	socket.on('connect', () => {
		console.log('🔗 Socket connected:', socket.id);
	});

	socket.on('disconnect', () => {
		console.log('🔌 Socket disconnected');
	});

	// Real-time post updates
	socket.on('post:created', (post) => {
		console.log('📨 New post received:', post.id);
		clearPostsCache();
		const mappedPost = mapPost(post);
		state.posts.unshift(mappedPost);
		rerender();
	});

	socket.on('post:updated', (post) => {
		console.log('📨 Post updated:', post.id);
		clearPostsCache();
		const mappedPost = mapPost(post);
		const index = state.posts.findIndex(p => p.id === post.id);
		if (index >= 0) {
			state.posts[index] = mappedPost;
		}
		rerender();
	});

	socket.on('post:deleted', (data) => {
		console.log('📨 Post deleted:', data.id);
		clearPostsCache();
		state.posts = state.posts.filter(p => p.id !== data.id);
		if (state.activeDetailPostId === data.id) {
			closePostDetail();
		}
		rerender();
	});

	socket.on('comment:added', (post) => {
		console.log('📨 New comment received:', post.id);
		clearPostsCache();
		const mappedPost = mapPost(post);
		const index = state.posts.findIndex(p => p.id === post.id);
		if (index >= 0) {
			state.posts[index] = mappedPost;
		}
		rerender();
	});

	socket.on('post:liked', (post) => {
		console.log('📨 Post liked:', post.id);
		clearPostsCache();
		const mappedPost = mapPost(post);
		const index = state.posts.findIndex(p => p.id === post.id);
		if (index >= 0) {
			state.posts[index] = mappedPost;
		}
		rerender();
	});

	// Relation events: follow/unfollow/block/unblock
	socket.on('relation:follow', (data) => {
		try {
			console.log('🔁 Relation follow received', data);
			const rel = {
				id: `rel:${data.ownerId}:${data.targetId}:follow:${Date.now()}`,
				ownerId: data.ownerId,
				targetId: data.targetId,
				type: 'follow',
				createdAt: new Date()
			};
			state.relations.unshift(mapRelation(rel));
			syncRelationState();
			rerender();
		} catch (err) {
			console.error('Error handling relation:follow', err);
		}
	});

	socket.on('relation:unfollow', (data) => {
		try {
			console.log('🔁 Relation unfollow received', data);
			state.relations = state.relations.filter(r => !(r.ownerId === data.ownerId && r.targetId === data.targetId && r.type === 'follow'));
			syncRelationState();
			rerender();
		} catch (err) {
			console.error('Error handling relation:unfollow', err);
		}
	});

	socket.on('relation:block', (data) => {
		try {
			console.log('🔁 Relation block received', data);
			const rel = {
				id: `rel:${data.ownerId}:${data.targetId}:block:${Date.now()}`,
				ownerId: data.ownerId,
				targetId: data.targetId,
				type: 'block',
				createdAt: new Date()
			};
			// remove any follow by the same owner->target
			state.relations = state.relations.filter(r => !(r.ownerId === data.ownerId && r.targetId === data.targetId && r.type === 'follow'));
			state.relations.unshift(mapRelation(rel));
			syncRelationState();
			rerender();
		} catch (err) {
			console.error('Error handling relation:block', err);
		}
	});

	socket.on('relation:unblock', (data) => {
		try {
			console.log('🔁 Relation unblock received', data);
			state.relations = state.relations.filter(r => !(r.ownerId === data.ownerId && r.targetId === data.targetId && r.type === 'block'));
			syncRelationState();
			rerender();
		} catch (err) {
			console.error('Error handling relation:unblock', err);
		}
	});
}

const state = {
	currentUserId: "me",
	selectedProfileId: "me",
	viewMode: "home",
	following: new Set(),
	hiddenPostIds: new Set(),
	blockedUserIds: new Set(),
	relations: [],
	posts: [],
	replyModeByPost: new Map(),
	activeRepostPostId: null,
	activeDetailPostId: null,
	activeImageViewer: null,
	imageViewerScale: 1,
	isLoadingPosts: true,
	loadError: "",
	composerAttachments: []
};

const refs = {
	activeProfile: document.getElementById("activeProfile"),
	goHomeBtn: document.getElementById("goHomeBtn"),
	openComposerBtn: document.getElementById("openComposerBtn"),
	closeComposerBtn: document.getElementById("closeComposerBtn"),
	composerModal: document.getElementById("composerModal"),
	repostModal: document.getElementById("repostModal"),
	imageViewerModal: document.getElementById("imageViewerModal"),
	imageViewerImg: document.getElementById("imageViewerImg"),
	imageViewerTitle: document.getElementById("imageViewerTitle"),
	imageViewerCaption: document.getElementById("imageViewerCaption"),
	imageViewerCounter: document.getElementById("imageViewerCounter"),
	imageViewerNav: document.querySelector(".image-viewer-nav"),
	prevImageBtn: document.getElementById("prevImageBtn"),
	nextImageBtn: document.getElementById("nextImageBtn"),
	closeImageViewerBtn: document.getElementById("closeImageViewerBtn"),
	closeRepostBtn: document.getElementById("closeRepostBtn"),
	repostTitle: document.getElementById("repostTitle"),
	repostContent: document.getElementById("repostContent"),
	repostCharCount: document.getElementById("repostCharCount"),
	repostOriginalPreview: document.getElementById("repostOriginalPreview"),
	publishRepostBtn: document.getElementById("publishRepostBtn"),
	confirmModal: document.getElementById("confirmModal"),
	confirmMessage: document.getElementById("confirmMessage"),
	confirmCancelBtn: document.getElementById("confirmCancelBtn"),
	confirmOkBtn: document.getElementById("confirmOkBtn"),
	listModal: document.getElementById("listModal"),
	listModalTitle: document.getElementById("listModalTitle"),
	listModalBody: document.getElementById("listModalBody"),
	closeListModalBtn: document.getElementById("closeListModalBtn"),
	postDetailModal: document.getElementById("postDetailModal"),
	postDetailCard: document.getElementById("postDetailCard"),
	homeToolbar: document.getElementById("homeToolbar"),
	profileView: document.getElementById("profileView"),
	postTitle: document.getElementById("postTitle"),
	postInput: document.getElementById("postInput"),
	postAttachment: document.getElementById("postAttachment"),
	attachmentName: document.getElementById("attachmentName"),
	attachmentsList: document.getElementById("attachmentsList"),
	charCount: document.getElementById("charCount"),
	composerError: document.getElementById("composerError"),
	createPostBtn: document.getElementById("createPostBtn"),
	cancelPostBtn: document.getElementById("cancelPostBtn"),
	removeAttachmentBtn: document.getElementById("removeAttachmentBtn"),
	feedFilter: document.getElementById("feedFilter"),
	feedList: document.getElementById("feedList"),
	postTemplate: document.getElementById("postTemplate"),
	errorNotification: document.getElementById("errorNotification")
};

let commentIdSeed = 1000;
let pendingConfirmAction = null;
const API_BASE = "http://localhost:3000/api";

function getUserInfo(userId) {
	return users[userId] || {
		id: userId,
		name: "Unknown user",
		username: String(userId || "unknown"),
		bio: "Imported from database.",
		color: "#6b7280"
	};
}

function isModalOpen(modal) {
	return modal && !modal.classList.contains("hidden");
}

function openConfirmDialog(message, action) {
	pendingConfirmAction = action;
	refs.confirmMessage.textContent = message;
	refs.confirmModal.classList.remove("hidden");
	refs.confirmModal.setAttribute("aria-hidden", "false");
}

function normalizeImageItem(item) {
	if (!item) {
		return null;
	}

	if (typeof item === "string") {
		return { src: item, title: "Preview image", caption: "" };
	}

	if (item.src) {
		return {
			src: item.src,
			title: item.title || "Preview image",
			caption: item.caption || ""
		};
	}

	return null;
}

function updateImageViewer() {
	if (!state.activeImageViewer || !state.activeImageViewer.images.length) {
		return;
	}

	const current = state.activeImageViewer.images[state.activeImageViewer.index];
	refs.imageViewerTitle.textContent = current.title || state.activeImageViewer.title || "Image preview";
	refs.imageViewerCaption.textContent = current.caption || state.activeImageViewer.caption || "";
	refs.imageViewerImg.src = current.src;
	refs.imageViewerImg.alt = current.title || state.activeImageViewer.title || "Preview image";
	refs.imageViewerImg.style.transform = `scale(${state.imageViewerScale})`;
	refs.imageViewerCounter.textContent = `${state.activeImageViewer.index + 1} / ${state.activeImageViewer.images.length}`;
	const hasMultipleImages = state.activeImageViewer.images.length > 1;
	refs.imageViewerNav.classList.toggle("hidden", !hasMultipleImages);
	refs.imageViewerCounter.classList.toggle("hidden", !hasMultipleImages);
	refs.prevImageBtn.classList.toggle("hidden", !hasMultipleImages);
	refs.nextImageBtn.classList.toggle("hidden", !hasMultipleImages);
	refs.prevImageBtn.disabled = state.activeImageViewer.index === 0;
	refs.nextImageBtn.disabled = state.activeImageViewer.index >= state.activeImageViewer.images.length - 1;
	refs.imageViewerModal.classList.toggle("has-gallery", hasMultipleImages);
}

function openImageViewer(images, startIndex = 0, title = "Image preview", caption = "") {
	const normalizedImages = (Array.isArray(images) ? images : [images])
		.map(normalizeImageItem)
		.filter(Boolean);

	if (normalizedImages.length === 0) {
		return;
	}

	const safeIndex = Math.min(Math.max(Number(startIndex) || 0, 0), normalizedImages.length - 1);
	state.activeImageViewer = {
		images: normalizedImages,
		index: safeIndex,
		title,
		caption
	};
	state.imageViewerScale = 1;
	refs.imageViewerImg.style.transform = "scale(1)";
	updateImageViewer();
	refs.imageViewerModal.classList.remove("hidden");
	refs.imageViewerModal.setAttribute("aria-hidden", "false");
}

function moveImageViewer(direction) {
	if (!state.activeImageViewer || state.activeImageViewer.images.length <= 1) {
		return;
	}

	const totalImages = state.activeImageViewer.images.length;
	const nextIndex = (state.activeImageViewer.index + direction + totalImages) % totalImages;

	state.activeImageViewer.index = nextIndex;
	state.imageViewerScale = 1;
	updateImageViewer();
}

function setImageViewerScale(nextScale) {
	const scale = Math.min(4, Math.max(0.5, Number(nextScale) || 1));
	state.imageViewerScale = scale;
	refs.imageViewerImg.style.transform = `scale(${scale})`;
}

function zoomImageViewer(delta) {
	setImageViewerScale(state.imageViewerScale + delta);
}

function closeImageViewer() {
	refs.imageViewerModal.classList.add("hidden");
	refs.imageViewerModal.setAttribute("aria-hidden", "true");
	refs.imageViewerImg.src = "";
	refs.imageViewerImg.style.transform = "scale(1)";
	state.activeImageViewer = null;
	state.imageViewerScale = 1;
}

function closeConfirmDialog() {
	pendingConfirmAction = null;
	refs.confirmModal.classList.add("hidden");
	refs.confirmModal.setAttribute("aria-hidden", "true");
}

function runConfirmAction() {
	if (!pendingConfirmAction) {
		closeConfirmDialog();
		return;
	}
	const action = pendingConfirmAction;
	closeConfirmDialog();
	action();
}

function apiUrl(path) {
	return `${API_BASE}${path}`;
}

async function requestJson(path, options = {}) {
	const response = await fetch(apiUrl(path), {
		headers: {
			"Content-Type": "application/json",
			...(options.headers || {})
		},
		...options
	});
	const text = await response.text();
	let data = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = { message: text };
		}
	}
	if (!response.ok) {
		throw new Error(data?.message || `Request failed: ${response.status}`);
	}
	return data;
}

async function togglePostLike(postId) {
	const result = await requestJson(`/posts/${postId}/like`, {
		method: "POST",
		body: JSON.stringify({ userId: state.currentUserId })
	});
	clearPostsCache();
	return result;
}

async function toggleCommentLike(postId, commentId) {
	const result = await requestJson(`/posts/${postId}/comments/${commentId}/like`, {
		method: "POST",
		body: JSON.stringify({ userId: state.currentUserId })
	});
	clearPostsCache();
	return result;
}

function mapComment(comment) {
	return {
		id: String(comment._id || comment.id || commentIdSeed++),
		userId: comment.userId,
		text: comment.text,
		createdAt: comment.createdAt ? new Date(comment.createdAt) : new Date(),
		parentId: comment.parentId ? String(comment.parentId) : null,
		likedBy: comment.likedBy instanceof Set ? comment.likedBy : new Set(Array.isArray(comment.likedBy) ? comment.likedBy : [])
	};
}

function mapPost(post) {
	const attachment = post.attachment
		&& (post.attachment.type || post.attachment.name || post.attachment.url || post.attachment.text || post.attachment.originalPostId)
		? {
			type: post.attachment.type || null,
			name: post.attachment.name || "",
			url: post.attachment.url || "",
			text: post.attachment.text || "",
			originalPostId: post.attachment.originalPostId ? String(post.attachment.originalPostId) : null
		}
		: null;

	const attachments = Array.isArray(post.attachments)
		? post.attachments.map(att => ({
			type: att.type || null,
			name: att.name || "",
			url: att.url || "",
			text: att.text || ""
		}))
		: [];

	return {
		id: String(post._id || post.id),
		userId: post.userId,
		title: post.title || "Untitled post",
		content: post.content || "",
		createdAt: post.createdAt ? new Date(post.createdAt) : new Date(),
		updatedAt: post.updatedAt ? new Date(post.updatedAt) : new Date(),
		likedBy: new Set(Array.isArray(post.likedBy) ? post.likedBy : []),
		attachment,
		attachments,
		replies: (post.replies || []).map(mapComment)
	};
}

function getRepostCount(post) {
	const originalId = String(post.id);
	const base = state.posts.filter(p => p.attachment && p.attachment.originalPostId === originalId).length;
	return base + (post.optimisticRepostDelta || 0);
}

function mapRelation(relation) {
	return {
		id: String(relation.id || relation._id),
		ownerId: relation.ownerId,
		targetId: relation.targetId,
		type: relation.type,
		createdAt: relation.createdAt ? new Date(relation.createdAt) : new Date(),
		updatedAt: relation.updatedAt ? new Date(relation.updatedAt) : new Date()
	};
}

function syncRelationState() {
	state.following = new Set(
		state.relations
			.filter(relation => relation.ownerId === state.currentUserId && relation.type === "follow")
			.map(relation => relation.targetId)
	);
	state.blockedUserIds = new Set(
		state.relations
			.filter(relation => relation.ownerId === state.currentUserId && relation.type === "block")
			.map(relation => relation.targetId)
	);
	state.blockedUserIds.forEach(userId => state.following.delete(userId));
}

function syncPostFromServer(postData) {
	console.log("Syncing post from server:", postData);
	console.log("  Attachments in response:", postData.attachments ? postData.attachments.length : 0);
	if (postData.attachments && postData.attachments.length > 0) {
		postData.attachments.forEach((att, i) => {
			const size = att.url ? (att.url.length / 1024 / 1024).toFixed(2) + 'MB' : 
						(att.text ? (att.text.length / 1024).toFixed(2) + 'KB' : '0B');
			console.log(`    [${i}] ${att.type}: ${att.name} (${size})`);
		});
	}
	const mapped = mapPost(postData);
	const index = state.posts.findIndex(post => post.id === mapped.id);
	if (index >= 0) {
		state.posts[index] = mapped;
	} else {
		state.posts.unshift(mapped);
	}
	return mapped;
}

async function loadPostsFromMongo() {
	state.isLoadingPosts = true;
	state.loadError = "";
	renderPosts();
	try {
		// Check cache first
		const cachedPosts = getCachedPosts();
		if (cachedPosts) {
			state.posts = Array.isArray(cachedPosts) ? cachedPosts.map(mapPost) : [];
			console.log(`[LOAD] Loaded ${state.posts.length} posts from cache`);
			normalizeComments();
		} else {
			// Fetch from API if cache miss or expired
			const posts = await requestJson("/posts", { method: "GET" });
			state.posts = Array.isArray(posts) ? posts.map(mapPost) : [];
			
			console.log(`[LOAD] Loaded ${state.posts.length} posts from database`);
			state.posts.forEach((post, i) => {
				if (post.attachments && post.attachments.length > 0) {
					console.log(`  Post ${i} (${post.id}): ${post.attachments.length} attachment(s)`);
					post.attachments.forEach((att, j) => {
						const size = att.url ? (att.url.length / 1024 / 1024).toFixed(2) + 'MB' : 
									(att.text ? (att.text.length / 1024).toFixed(2) + 'KB' : '0B');
						console.log(`    [${j}] ${att.type}: ${att.name} (${size})`);
					});
				}
			});
			
			// Cache the posts
			setPostsCache(posts);
			normalizeComments();
		}
	} catch (error) {
		state.loadError = error.message;
		state.posts = [];
		console.error('[LOAD ERROR]', error);
	} finally {
		state.isLoadingPosts = false;
		rerender();
	}
}

async function loadRelationsFromMongo() {
	try {
		const relations = await requestJson("/relations", { method: "GET" });
		state.relations = Array.isArray(relations) ? relations.map(mapRelation) : [];
		syncRelationState();
	} catch (error) {
		console.error("Failed to load relations:", error);
		state.relations = [];
		syncRelationState();
	}
	rerender();
}

function normalizeComments() {
	state.posts.forEach(post => {
		post.replies = (post.replies || []).map(reply => ({
			id: String(reply.id || reply._id || commentIdSeed++),
			userId: reply.userId,
			text: reply.text,
			createdAt: reply.createdAt instanceof Date ? reply.createdAt : new Date(reply.createdAt),
			parentId: reply.parentId ? String(reply.parentId) : null,
			likedBy: reply.likedBy instanceof Set ? reply.likedBy : new Set(Array.isArray(reply.likedBy) ? reply.likedBy : [])
		}));
	});
}

function formatTime(date) {
	const diffMin = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));
	if (diffMin < 60) {
		return `${diffMin}m ago`;
	}
	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) {
		return `${diffHour}h ago`;
	}
	const diffDay = Math.floor(diffHour / 24);
	return `${diffDay}d ago`;
}

function countUserPosts(userId) {
	return state.posts.filter(post => post.userId === userId).length;
}

function countUserLikes(userId) {
	return state.posts.reduce((sum, post) => sum + (post.userId === userId ? post.likedBy.size : 0), 0);
}

function countFollowers(userId) {
	return state.relations.filter(relation => relation.type === "follow" && relation.targetId === userId).length;
}

function getFollowerIds(userId) {
	return state.relations
		.filter(relation => relation.type === "follow" && relation.targetId === userId)
		.map(relation => relation.ownerId);
}

function openListModal(title, userIds, options = {}) {
	refs.listModalTitle.textContent = title;
	refs.listModalBody.innerHTML = "";

	if (userIds.length === 0) {
		const empty = document.createElement("p");
		empty.className = "file-hint";
		empty.textContent = options.emptyText || "No users found.";
		refs.listModalBody.appendChild(empty);
	} else {
		userIds.forEach(userId => {
			const user = users[userId];
			if (!user) {
				return;
			}
			const row = document.createElement("div");
			row.className = "list-row";
			const showUnblock = Boolean(options.allowUnblock && state.blockedUserIds.has(userId));
			row.innerHTML = `
				<div class="list-user-meta">
					<strong>${user.name}</strong>
					<span>@${user.username}</span>
				</div>
				${showUnblock ? '<button class="btn-soft" type="button" data-unblock-user="true">Unblock</button>' : ""}
			`;

			const unblockBtn = row.querySelector("[data-unblock-user]");
			if (unblockBtn) {
				unblockBtn.addEventListener("click", async () => {
					await toggleBlock(userId);
					renderProfileView();
					openListModal(title, userIds.filter(id => id !== userId), options);
					rerender();
				});
			}

			refs.listModalBody.appendChild(row);
		});
	}

	refs.listModal.classList.remove("hidden");
	refs.listModal.setAttribute("aria-hidden", "false");
}

function closeListModal() {
	refs.listModal.classList.add("hidden");
	refs.listModal.setAttribute("aria-hidden", "true");
}

function renderMiniProfile() {
	const user = getUserInfo(state.selectedProfileId);
	const isMe = user.id === state.currentUserId;
	const isFollowing = state.following.has(user.id);
	const isBlocked = state.blockedUserIds.has(user.id);

	refs.activeProfile.innerHTML = `
		<div class="profile-head-mini">
			<button class="avatar-btn" style="background:${user.color}" type="button">${user.name[0]}</button>
			<div>
				<div><strong>${user.name}</strong></div>
				<div>@${user.username}</div>
			</div>
		</div>
		<p>${user.bio}</p>
		<div class="row"><span>Posts</span><strong>${countUserPosts(user.id)}</strong></div>
		<div class="row"><span>Followers</span><strong>${countFollowers(user.id)}</strong></div>
		${isMe ? "" : `<div class="row"><span>Following by you</span><strong>${isBlocked ? "Blocked" : (isFollowing ? "Following" : "Not following")}</strong></div>`}
		${isMe || isBlocked ? "" : `<button class="follow-btn ${isFollowing ? "following" : ""}" data-user="${user.id}" type="button">${isFollowing ? "Following" : "Follow"}</button>`}
	`;

	const miniAvatarBtn = refs.activeProfile.querySelector(".avatar-btn");
	if (miniAvatarBtn) {
		miniAvatarBtn.addEventListener("click", () => {
			window.scrollTo(0, 0);
			if (state.viewMode === "home") {
				selectProfile(state.currentUserId, "profile");
			}
		});
	}

	const followBtn = refs.activeProfile.querySelector(".follow-btn");
	if (followBtn) {
		followBtn.addEventListener("click", () => {
			toggleFollow(user.id);
		});
	}
}

function getFilteredPosts() {
	const base = state.posts.filter(post => !state.hiddenPostIds.has(post.id) && !state.blockedUserIds.has(post.userId));

	if (state.viewMode === "profile") {
		return base.filter(post => post.userId === state.selectedProfileId);
	}

	const filter = refs.feedFilter.value;
	if (filter === "following") {
		return base.filter(post => state.following.has(post.userId) || post.userId === state.currentUserId);
	}
	if (filter === "mine") {
		return base.filter(post => post.userId === state.currentUserId);
	}
	return base;
}

function buildReplyItem(reply) {
	const user = getUserInfo(reply.userId);
	const item = document.createElement("div");
	item.className = "reply-item";
	item.innerHTML = `
		<div class="meta">${user.name} · ${formatTime(reply.createdAt)}</div>
		<div>${reply.text}</div>
	`;
	return item;
}

async function addCommentToPost(postId, text, parentId = null) {
	if (!text.trim()) {
		return false;
	}
	const post = state.posts.find(item => item.id === postId);
	if (!post) {
		return false;
	}
	// Optimistic UI: add a temporary comment immediately
	const tempId = `temp:comment:${Date.now()}`;
	const tempComment = {
		id: tempId,
		userId: state.currentUserId,
		text: text.trim(),
		createdAt: new Date(),
		parentId: parentId || null,
		likedBy: new Set()
	};
	post.replies = post.replies || [];
	post.replies.push(tempComment);
	rerender();

	try {
		const updatedPost = await requestJson(`/posts/${postId}/comments`, {
			method: "POST",
			body: JSON.stringify({
				userId: state.currentUserId,
				text: text.trim(),
				parentId
			})
		});
		clearPostsCache();
		syncPostFromServer(updatedPost);
		return true;
	} catch (error) {
		console.error("Failed to add comment:", error);
		// rollback optimistic comment
		post.replies = (post.replies || []).filter(r => String(r.id) !== tempId);
		rerender();
		showErrorNotification("Unable to add comment.");
		return false;
	}
}

async function deletePost(postId) {
	try {
		await requestJson(`/posts/${postId}`, {
			method: "DELETE",
			body: JSON.stringify({ userId: state.currentUserId })
		});
		clearPostsCache();
		state.posts = state.posts.filter(post => post.id !== postId);
		state.hiddenPostIds.delete(postId);
		if (state.activeDetailPostId === postId) {
			closePostDetail();
		}
		rerender();
	} catch (error) {
		console.error("Failed to delete post:", error);
		showErrorNotification("Unable to delete this post.");
	}
}

function getCommentChildren(post, parentId) {
	return (post.replies || []).filter(reply => reply.parentId === parentId);
}

function deleteComment(postId, commentId) {
	const post = state.posts.find(item => item.id === postId);
	if (!post) {
		return;
	}
	requestJson(`/posts/${postId}/comments/${commentId}`, { method: "DELETE" })
		.then(updatedPost => {
			syncPostFromServer(updatedPost);
			rerender();
			if (state.activeDetailPostId === postId) {
				openPostDetail(postId);
			}
		})
		.catch(error => {
			console.error("Failed to delete comment:", error);
		});
}

function renderAttachment(container, post) {
	container.innerHTML = "";

	// Handle new attachments array
	if (Array.isArray(post.attachments) && post.attachments.length > 0) {
		const images = post.attachments.filter(a => a.type === "image");
		const videos = post.attachments.filter(a => a.type === "video");
		const audios = post.attachments.filter(a => a.type === "audio");
		const texts = post.attachments.filter(a => a.type === "text");

		if (images.length > 0) {
			const imageGallery = images.map(img => ({
				src: img.url,
				title: img.name,
				caption: img.name
			}));
			const grid = document.createElement("div");
			grid.className = "attachment-images-grid";
			images.forEach(img => {
				const imageIndex = images.indexOf(img);
				const img_el = document.createElement("img");
				img_el.src = img.url;
				img_el.alt = img.name;
				img_el.className = "attachment-image";
				img_el.addEventListener("click", event => {
					event.stopPropagation();
					openImageViewer(imageGallery, imageIndex, "Image preview", "Tap outside or press Esc to close");
				});
				grid.appendChild(img_el);
			});
			container.appendChild(grid);
		}

		if (videos.length > 0) {
			const video = document.createElement("video");
			video.src = videos[0].url;
			video.controls = true;
			video.className = "attachment-video";
			container.appendChild(video);
		}

		if (audios.length > 0) {
			const audio = document.createElement("audio");
			audio.src = audios[0].url;
			audio.controls = true;
			audio.className = "attachment-audio";
			container.appendChild(audio);
		}

		if (texts.length > 0) {
			const textBlock = document.createElement("div");
			textBlock.className = "attachment-text-block";
			textBlock.textContent = texts[0].text;
			container.appendChild(textBlock);
		}

		container.classList.remove("hidden");
		return;
	}

	// Handle legacy attachment (repost)
	if (!post.attachment || (!post.attachment.type && !post.attachment.name && !post.attachment.url && !post.attachment.text && !post.attachment.originalPostId)) {
		container.classList.add("hidden");
		return;
	}

	container.classList.remove("hidden");

	if (post.attachment.type === "image") {
		const image = document.createElement("img");
		image.src = post.attachment.url;
		image.alt = post.attachment.name;
		image.className = "attachment-image";
		image.addEventListener("click", event => {
			event.stopPropagation();
			openImageViewer([
				{
					src: post.attachment.url,
					title: post.attachment.name,
					caption: post.attachment.name
				}
			], 0, post.attachment.name || "Image preview", "Tap outside or press Esc to close");
		});
		container.appendChild(image);
		return;
	}

	if (post.attachment.type === "audio") {
		const audio = document.createElement("audio");
		audio.controls = true;
		audio.src = post.attachment.url;
		audio.className = "attachment-audio";
		container.appendChild(audio);
		return;
	}

	if (post.attachment.type === "video") {
		const video = document.createElement("video");
		video.controls = true;
		video.src = post.attachment.url;
		video.className = "attachment-video";
		container.appendChild(video);
		return;
	}

	if (post.attachment.type === "repost") {
		const original = state.posts.find(item => item.id === post.attachment.originalPostId);
		const repostBlock = document.createElement("div");
		repostBlock.className = "repost-preview repost-ref";
		if (!original) {
			repostBlock.textContent = "Original post is unavailable.";
			container.appendChild(repostBlock);
			return;
		}
		const author = getUserInfo(original.userId);
		repostBlock.innerHTML = `
			<div class="name">${author.name} · @${author.username}</div>
			<div class="title">${original.title || "Untitled post"}</div>
			<div class="content">${original.content || ""}</div>
		`;
		repostBlock.addEventListener("click", event => {
			event.stopPropagation();
			openPostDetail(original.id);
		});
		container.appendChild(repostBlock);
		return;
	}

	const textBlock = document.createElement("div");
	textBlock.className = "attachment-text-block";
	textBlock.textContent = post.attachment.text || "Unable to preview this text file.";
	container.appendChild(textBlock);
}

function renderProfileView() {
	if (state.viewMode !== "profile") {
		refs.profileView.classList.add("hidden");
		refs.homeToolbar.classList.remove("hidden");
		refs.goHomeBtn.classList.add("hidden");
		refs.profileView.innerHTML = "";
		return;
	}

	const user = getUserInfo(state.selectedProfileId);
	const isMe = user.id === state.currentUserId;
	const isFollowing = state.following.has(user.id);
	const isBlocked = state.blockedUserIds.has(user.id);
	refs.profileView.classList.remove("hidden");
	refs.homeToolbar.classList.add("hidden");
	refs.goHomeBtn.classList.remove("hidden");

	refs.profileView.innerHTML = `
		<div class="profile-banner"></div>
		<div class="profile-main">
			<div class="profile-top">
				<div class="big-avatar" style="background:${user.color}">${user.name[0]}</div>
				<div>
					<h2>${user.name}</h2>
					<div class="username">@${user.username}</div>
				</div>
				<div class="profile-top-right">
					${isMe || isBlocked ? "" : `<button class="follow-btn ${isFollowing ? "following" : ""}" data-profile-follow="${user.id}" type="button">${isFollowing ? "Following" : "Follow"}</button>`}
					<div class="post-menu-wrap">
						<button class="post-menu-btn profile-menu-btn" type="button" aria-label="Profile options">⋮</button>
						<div class="post-menu hidden profile-menu">
							${isMe
								? '<button data-profile-menu="blocked-list" type="button">Blocked users</button>'
								: `<button data-profile-menu="follow" type="button" ${isFollowing || isBlocked ? "disabled" : ""}>Follow</button><button data-profile-menu="unfollow" type="button" ${isFollowing ? "" : "disabled"}>Unfollow</button><button data-profile-menu="block-toggle" type="button">${isBlocked ? "Unblock user" : "Block user"}</button>`}
						</div>
					</div>
				</div>
			</div>
			<p class="bio">${user.bio}</p>
			<div class="profile-stats">
				<span><strong>${countUserPosts(user.id)}</strong> posts</span>
				<button class="stat-btn" data-open-followers="true" type="button"><strong>${countFollowers(user.id)}</strong> followers</button>
				<span><strong>${countUserLikes(user.id)}</strong> likes received</span>
			</div>
			<h3 class="profile-posts-title">Posts</h3>
		</div>
	`;

	const bigAvatar = refs.profileView.querySelector(".big-avatar");
	if (bigAvatar) {
		bigAvatar.addEventListener("click", () => {
			window.scrollTo(0, 0);
		});
	}

	const profileFollowBtn = refs.profileView.querySelector("[data-profile-follow]");
	if (profileFollowBtn) {
		profileFollowBtn.addEventListener("click", () => {
			toggleFollow(user.id);
		});
	}

	const followersBtn = refs.profileView.querySelector("[data-open-followers]");
	if (followersBtn) {
		followersBtn.addEventListener("click", () => {
			openListModal(`Followers of ${user.name}`, getFollowerIds(user.id), {
				emptyText: "No followers yet."
			});
		});
	}

	const profileMenuBtn = refs.profileView.querySelector(".profile-menu-btn");
	const profileMenu = refs.profileView.querySelector(".profile-menu");
	if (profileMenuBtn && profileMenu) {
		profileMenuBtn.addEventListener("click", event => {
			event.stopPropagation();
			profileMenu.classList.toggle("hidden");
		});

		profileMenu.querySelectorAll("[data-profile-menu]").forEach(item => {
			item.addEventListener("click", () => {
				const action = item.dataset.profileMenu;
				if (action === "blocked-list") {
					openListModal("Blocked users", Array.from(state.blockedUserIds), {
						allowUnblock: true,
						emptyText: "No blocked users."
					});
					return;
				}

				if (action === "follow") {
					if (!state.following.has(user.id) && !state.blockedUserIds.has(user.id)) {
						toggleFollow(user.id);
					}
					return;
				}

				if (action === "unfollow") {
					if (state.following.has(user.id)) {
						toggleFollow(user.id);
					}
					return;
				}

				if (action === "block-toggle") {
					toggleBlock(user.id);
				}
			});
		});
	}
}

function renderPosts() {
	if (state.isLoadingPosts) {
		refs.feedList.innerHTML = '<div class="card" style="padding:14px">Loading posts from MongoDB...</div>';
		return;
	}

	if (state.loadError) {
		refs.feedList.innerHTML = `<div class="card" style="padding:14px">Unable to load posts: ${state.loadError}</div>`;
		return;
	}

	const posts = getFilteredPosts().slice().sort((a, b) => b.createdAt - a.createdAt);
	refs.feedList.innerHTML = "";

	if (posts.length === 0) {
		refs.feedList.innerHTML = '<div class="card" style="padding:14px">No feed matched your filter.</div>';
		return;
	}

	posts.forEach(post => {
		const user = getUserInfo(post.userId);
		const node = refs.postTemplate.content.cloneNode(true);
		const article = node.querySelector(".post-item");

		const avatarBtn = node.querySelector(".avatar-btn");
		avatarBtn.textContent = user.name[0];
		avatarBtn.style.background = user.color;
		avatarBtn.addEventListener("click", () => {
			window.scrollTo(0, 0);
			selectProfile(user.id, "profile");
		});

		const nameBtn = node.querySelector(".name-btn");
		nameBtn.textContent = user.name;
		nameBtn.addEventListener("click", () => selectProfile(user.id, "profile"));

		const quickFollowBtn = node.querySelector(".quick-follow-btn");
		if (post.userId === state.currentUserId || state.blockedUserIds.has(post.userId)) {
			quickFollowBtn.classList.add("hidden");
		} else {
			const isFollowing = state.following.has(post.userId);
			quickFollowBtn.textContent = isFollowing ? "Following" : "Follow";
			quickFollowBtn.classList.toggle("following", isFollowing);
			quickFollowBtn.addEventListener("click", () => {
				toggleFollow(post.userId);
			});
		}

		const menuBtn = node.querySelector(".post-menu-btn");
		const menuBox = node.querySelector(".post-menu");
		const menuFollow = node.querySelector(".menu-follow");
		const menuUnfollow = node.querySelector(".menu-unfollow");
		const menuRepost = node.querySelector(".menu-repost");
		const menuHide = node.querySelector(".menu-hide");
		const menuBlock = node.querySelector(".menu-block");
		const menuDelete = node.querySelector(".menu-delete");

		if (post.userId === state.currentUserId) {
			menuFollow.classList.add("hidden");
			menuUnfollow.classList.add("hidden");
			menuBlock.classList.add("hidden");
		} else {
			menuDelete.classList.add("hidden");
		}

		const menuFollowing = state.following.has(post.userId);
		const menuBlocked = state.blockedUserIds.has(post.userId);
		menuFollow.disabled = menuFollowing || menuBlocked;
		menuUnfollow.disabled = !menuFollowing;

		menuBtn.addEventListener("click", event => {
			event.stopPropagation();
			menuBox.classList.toggle("hidden");
		});

		menuFollow.addEventListener("click", () => {
			if (!state.following.has(post.userId) && !state.blockedUserIds.has(post.userId)) {
				toggleFollow(post.userId);
			}
		});

		menuUnfollow.addEventListener("click", () => {
			if (state.following.has(post.userId)) {
				toggleFollow(post.userId);
			}
		});

		menuRepost.addEventListener("click", () => {
			openRepostModal(post.id);
		});

		menuHide.addEventListener("click", () => {
			state.hiddenPostIds.add(post.id);
			rerender();
		});

		menuBlock.addEventListener("click", () => {
			toggleBlock(post.userId);
		});

		menuDelete.addEventListener("click", () => {
			openConfirmDialog("Delete this post? This cannot be undone.", () => {
				deletePost(post.id);
			});
		});

		node.querySelector(".post-title").textContent = post.title || "Untitled";
		node.querySelector(".time").textContent = formatTime(post.createdAt);
		node.querySelector(".post-content").textContent = post.content;
		renderAttachment(node.querySelector(".post-attachment"), post);

		const commentBtn = node.querySelector(".comment-btn");
		// show comment count and open detail
		commentBtn.textContent = `Comment (${post.replies.length})`;
		commentBtn.addEventListener("click", () => {
			openPostDetail(post.id);
		});

		const repostBtn = node.querySelector(".repost-btn");
		repostBtn.textContent = `Repost (${getRepostCount(post)})`;
		repostBtn.addEventListener("click", () => {
			openRepostModal(post.id);
		});

		const likeBtn = node.querySelector(".like-btn");
		const liked = post.likedBy.has(state.currentUserId);
		likeBtn.textContent = `${liked ? "Liked" : "Like"} (${post.likedBy.size})`;
		likeBtn.classList.toggle("liked", liked);
		likeBtn.addEventListener("click", () => {
			togglePostLike(post.id)
				.then(updatedPost => {
					syncPostFromServer(updatedPost);
					rerender();
				})
				.catch(error => {
					const errorMsg = error instanceof Error ? error.message : String(error || "Unknown error");
					console.error("Failed to toggle post like:", errorMsg);
					showErrorNotification(`Failed to like: ${errorMsg}`);
				});
		});

		const inlineCommentInput = node.querySelector(".inline-comment-input");
		const inlineCommentSend = node.querySelector(".inline-comment-send");
		inlineCommentSend.addEventListener("click", () => {
			const text = inlineCommentInput.value;
			if (!text.trim()) return;
			inlineCommentInput.value = ""; // clear immediately for optimistic UX
			addCommentToPost(post.id, text, null).then(sent => {
				if (!sent) {
					return;
				}
				rerender();
				openPostDetail(post.id);
			});
		});
		inlineCommentInput.addEventListener("keydown", event => {
			if (event.key !== "Enter" || event.shiftKey) {
				return;
			}
			event.preventDefault();
			openConfirmDialog("Submit this comment?", () => {
				inlineCommentSend.click();
			});
		});

		article.addEventListener("click", event => {
			if (event.target.closest("button, audio, video, input, textarea")) {
				return;
			}
			openPostDetail(post.id);
		});

		refs.feedList.appendChild(node);
	});
}

function renderCommentThread(post) {
	const threadRoot = refs.postDetailCard.querySelector(".comment-thread");
	if (!threadRoot) {
		return;
	}
	threadRoot.innerHTML = "";

	function drawBranch(parentId, level) {
		const children = getCommentChildren(post, parentId);
		children.forEach(comment => {
			const commenter = getUserInfo(comment.userId);
			const row = document.createElement("div");
			row.className = `comment-item level-${Math.min(level, 4)}`;
			const liked = comment.likedBy.has(state.currentUserId);
			const canDelete = comment.userId === state.currentUserId;

			row.innerHTML = `
				<div class="comment-meta">${commenter.name} · ${formatTime(comment.createdAt)}</div>
				<div class="comment-text">${comment.text}</div>
				<div class="comment-actions">
					<button class="action-btn comment-reply-btn" type="button">Comment</button>
					<button class="action-btn comment-like-btn ${liked ? "liked" : ""}" type="button">${liked ? "Liked" : "Like"} (${comment.likedBy.size})</button>
				</div>
				<div class="detail-comment-bar hidden">
					<input class="detail-comment-input" type="text" maxlength="280" placeholder="Reply to this comment">
					<button class="detail-comment-send" type="button">Reply</button>
				</div>
				${canDelete ? '<button class="comment-delete" type="button">Delete comment</button>' : ""}
			`;

			const replyBtn = row.querySelector(".comment-reply-btn");
			const likeBtn = row.querySelector(".comment-like-btn");
			const replyBar = row.querySelector(".detail-comment-bar");
			const replyInput = row.querySelector(".detail-comment-input");
			const sendBtn = row.querySelector(".detail-comment-send");
			const deleteBtn = row.querySelector(".comment-delete");

			replyBtn.addEventListener("click", () => {
				replyBar.classList.toggle("hidden");
				replyInput.focus();
			});

			likeBtn.addEventListener("click", () => {
				toggleCommentLike(post.id, comment.id)
					.then(updatedPost => {
						if (!updatedPost) {
							return;
						}
						syncPostFromServer(updatedPost);
						rerender();
						openPostDetail(post.id);
					})
					.catch(error => {
						console.error("Failed to toggle comment like:", error);
					});
			});

			sendBtn.addEventListener("click", () => {
				addCommentToPost(post.id, replyInput.value, comment.id).then(sent => {
					if (!sent) {
						return;
					}
					rerender();
					openPostDetail(post.id);
				});
			});
			replyInput.addEventListener("keydown", event => {
				if (event.key !== "Enter" || event.shiftKey) {
					return;
				}
				event.preventDefault();
				openConfirmDialog("Submit this reply?", () => {
					sendBtn.click();
				});
			});

			if (deleteBtn) {
				deleteBtn.addEventListener("click", () => {
					deleteComment(post.id, comment.id);
					rerender();
					openPostDetail(post.id);
				});
			}

			threadRoot.appendChild(row);
			drawBranch(comment.id, level + 1);
		});
	}

	drawBranch(null, 0);
}

function openPostDetail(postId) {
	const post = state.posts.find(item => item.id === postId);
	if (!post) {
		return;
	}
	state.activeDetailPostId = postId;
	const user = getUserInfo(post.userId);

	refs.postDetailCard.innerHTML = `
		<header class="post-detail-head">
			<div class="post-detail-meta">
				<button class="avatar-btn" style="background:${user.color}" type="button">${user.name[0]}</button>
				<div>
					<div><strong>${user.name}</strong> · @${user.username}</div>
					<div class="time">${formatTime(post.createdAt)}</div>
				</div>
			</div>
			<button class="icon-btn" type="button" data-close-detail="true" aria-label="Close">x</button>
		</header>
		<h3 id="postDetailTitle" class="post-detail-title">${post.title || "Untitled post"}</h3>
		<div class="post-detail-content">${post.content || ""}</div>
		<section id="postDetailAttachment" class="post-attachment hidden"></section>
		<footer class="post-actions post-detail-actions">
			<button class="action-btn detail-comment-btn" type="button">Comment (${post.replies.length})</button>
			<button class="action-btn detail-repost-btn" type="button">Repost (${getRepostCount(post)})</button>
			<button class="action-btn detail-like-btn ${post.likedBy.has(state.currentUserId) ? "liked" : ""}" type="button">${post.likedBy.has(state.currentUserId) ? "Liked" : "Like"} (${post.likedBy.size})</button>
			${post.userId === state.currentUserId ? '<button class="action-btn detail-delete-btn" type="button">Delete post</button>' : ""}
		</footer>
		<div class="detail-comment-bar">
			<input class="detail-comment-input" type="text" maxlength="280" placeholder="Write a comment">
			<button class="detail-comment-send" type="button">Reply</button>
		</div>
		<section class="post-detail-replies ${(post.replies || []).length === 0 ? "hidden" : ""}">
			<div class="comment-thread"></div>
		</section>
	`;

	renderAttachment(refs.postDetailCard.querySelector("#postDetailAttachment"), post);
	renderCommentThread(post);

	const closeBtn = refs.postDetailCard.querySelector("[data-close-detail]");
	closeBtn.addEventListener("click", closePostDetail);

	const detailCommentBtn = refs.postDetailCard.querySelector(".detail-comment-btn");
	const detailRepostBtn = refs.postDetailCard.querySelector(".detail-repost-btn");
	const detailLikeBtn = refs.postDetailCard.querySelector(".detail-like-btn");
	const detailDeleteBtn = refs.postDetailCard.querySelector(".detail-delete-btn");
	const detailCommentInput = refs.postDetailCard.querySelector(".detail-comment-input");
	const detailCommentSend = refs.postDetailCard.querySelector(".detail-comment-send");

	detailCommentBtn.addEventListener("click", () => {
		detailCommentInput.focus();
	});

	detailRepostBtn.addEventListener("click", () => {
		closePostDetail();
		openRepostModal(post.id);
	});

	detailLikeBtn.addEventListener("click", () => {
		togglePostLike(post.id)
			.then(updatedPost => {
				syncPostFromServer(updatedPost);
				rerender();
				openPostDetail(post.id);
			})
			.catch(error => {
				console.error("Failed to toggle post like:", error);
			});
	});

	if (detailDeleteBtn) {
		detailDeleteBtn.addEventListener("click", () => {
			openConfirmDialog("Delete this post? This cannot be undone.", () => {
				deletePost(post.id);
			});
		});
	}

	detailCommentSend.addEventListener("click", () => {
		const text = detailCommentInput.value;
		if (!text.trim()) return;
		detailCommentInput.value = "";
		addCommentToPost(post.id, text, null).then(sent => {
			if (!sent) {
				return;
			}
			rerender();
			openPostDetail(post.id);
		});
	});

	detailCommentInput.addEventListener("keydown", event => {
		if (event.key !== "Enter" || event.shiftKey) {
			return;
		}
		event.preventDefault();
		openConfirmDialog("Submit this comment?", () => {
			detailCommentSend.click();
		});
	});

	refs.postDetailModal.classList.remove("hidden");
	refs.postDetailModal.setAttribute("aria-hidden", "false");
}

function closePostDetail() {
	refs.postDetailModal.classList.add("hidden");
	refs.postDetailModal.setAttribute("aria-hidden", "true");
	state.activeDetailPostId = null;
}

function openRepostModal(postId, prefill = null) {
	const post = state.posts.find(item => item.id === postId);
	if (!post) {
		return;
	}
	state.activeRepostPostId = postId;
	refs.repostTitle.value = prefill?.title || "";
	refs.repostContent.value = prefill?.content || "";
	refs.repostCharCount.textContent = `${refs.repostContent.value.length}/500`;
	const user = getUserInfo(post.userId);
	refs.repostOriginalPreview.innerHTML = `
		<div class="name">${user.name} · @${user.username}</div>
		<div class="title">${post.title || "Untitled post"}</div>
		<div class="content">${post.content || ""}</div>
	`;
	refs.repostModal.classList.remove("hidden");
	refs.repostModal.setAttribute("aria-hidden", "false");
}

function closeRepostModal() {
	refs.repostModal.classList.add("hidden");
	refs.repostModal.setAttribute("aria-hidden", "true");
	state.activeRepostPostId = null;
}

async function createRepost() {
	if (!state.activeRepostPostId) {
		return;
	}
	const title = refs.repostTitle.value.trim();
	const content = refs.repostContent.value.trim();
	if (!title && !content) {
		return;
	}
	const originalPost = state.posts.find(p => p.id === state.activeRepostPostId);
	if (originalPost) {
		originalPost.optimisticRepostDelta = (originalPost.optimisticRepostDelta || 0) + 1;
		// reflect immediately
		rerender();
	}

	closeRepostModal();
	try {
		const created = await requestJson(`/posts/${state.activeRepostPostId}/repost`, {
			method: "POST",
			body: JSON.stringify({
				userId: state.currentUserId,
				title: title || "Repost",
				content
			})
		});
		clearPostsCache();
		// server will include the new repost as a post; sync it
		syncPostFromServer(created);
		// remove optimistic delta (server count now includes new repost)
		if (originalPost) {
			originalPost.optimisticRepostDelta = Math.max(0, (originalPost.optimisticRepostDelta || 0) - 1);
		}
		state.viewMode = "home";
		refs.feedFilter.value = "all";
		rerender();
	} catch (error) {
		console.error("Failed to create repost:", error);
		if (originalPost) {
			originalPost.optimisticRepostDelta = Math.max(0, (originalPost.optimisticRepostDelta || 0) - 1);
			rerender();
		}
		const msg = error instanceof Error ? error.message : String(error || "Unknown error");
		showErrorNotification(`Unable to repost: ${msg}`);
	}
}

function selectProfile(userId, mode = "profile") {
	state.selectedProfileId = userId;
	state.viewMode = mode;
	rerender();
}

async function toggleFollow(userId) {
	if (state.blockedUserIds.has(userId)) {
		showErrorNotification("Unblock the user before following.");
		return;
	}

	try {
		await requestJson("/relations/toggle", {
			method: "POST",
			body: JSON.stringify({
				ownerId: state.currentUserId,
				targetId: userId,
				type: "follow"
			})
		});
		await loadRelationsFromMongo();
		rerender();
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error || "Unknown error");
		console.error("Failed to toggle follow:", error);
		showErrorNotification(`Unable to update follow: ${errorMessage}`);
	}
}

async function toggleBlock(userId) {
	try {
		await requestJson("/relations/toggle", {
			method: "POST",
			body: JSON.stringify({
				ownerId: state.currentUserId,
				targetId: userId,
				type: "block"
			})
		});
		await loadRelationsFromMongo();
		rerender();
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error || "Unknown error");
		console.error("Failed to toggle block:", error);
		showErrorNotification(`Unable to update block: ${errorMessage}`);
	}
}

function resetComposer() {
	refs.postTitle.value = "";
	refs.postInput.value = "";
	refs.postAttachment.value = "";
	refs.attachmentName.textContent = "No file selected";
	refs.charCount.textContent = "0/500";
	state.composerAttachments = [];
	refs.attachmentsList.innerHTML = "";
	refs.attachmentsList.classList.add("hidden");
	refs.removeAttachmentBtn.style.display = "none";
	clearComposerError();
}

function openComposer() {
	refs.postTitle.value = "";
	refs.postInput.value = "";
	refs.postAttachment.value = "";
	refs.attachmentName.textContent = "No file selected";
	refs.charCount.textContent = "0/500";
	refs.removeAttachmentBtn.style.display = "none";
	state.composerAttachments = [];
	refs.attachmentsList.innerHTML = "";
	refs.attachmentsList.classList.add("hidden");
	clearComposerError();
	refs.composerModal.classList.remove("hidden");
	refs.composerModal.setAttribute("aria-hidden", "false");
}

function closeComposer() {
	refs.composerModal.classList.add("hidden");
	refs.composerModal.setAttribute("aria-hidden", "true");
}

function clearComposerError() {
	refs.composerError.textContent = "";
	refs.composerError.classList.add("hidden");
}

function showComposerError(message) {
	refs.composerError.textContent = message;
	refs.composerError.classList.remove("hidden");
}

function showErrorNotification(message) {
	refs.errorNotification.textContent = message;
	refs.errorNotification.classList.remove("hidden");
	setTimeout(() => {
		refs.errorNotification.classList.add("hidden");
	}, 4000);
}

async function createPost() {
	const title = refs.postTitle.value.trim();
	const content = refs.postInput.value.trim();
	if (!title && !content) {
		clearComposerError();
		return;
	}

	try {
		clearComposerError();
		const payload = {
			userId: state.currentUserId,
			title: title || "Untitled post",
			content,
			attachments: state.composerAttachments.length > 0 ? state.composerAttachments : []
		};
		
		console.log("Creating post with payload:", payload);
		console.log(`Payload size: ${(JSON.stringify(payload).length / 1024 / 1024).toFixed(2)}MB`);
		
		const created = await requestJson("/posts", {
			method: "POST",
			body: JSON.stringify(payload)
		});
		
		console.log("Post created successfully:", created);
		clearPostsCache();
		syncPostFromServer(created);
		resetComposer();
		closeComposer();
		state.viewMode = "home";
		refs.feedFilter.value = "all";
		rerender();
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error || "Unknown error");
		console.error("Failed to create post:", error);
		showComposerError(`Unable to post: ${errorMessage}`);
	}
}

function renderComposerAttachments() {
	refs.attachmentsList.innerHTML = "";
	
	if (state.composerAttachments.length === 0) {
		refs.attachmentsList.classList.add("hidden");
		refs.attachmentName.textContent = "No file selected";
		return;
	}

	refs.attachmentsList.classList.remove("hidden");
	refs.attachmentName.textContent = `${state.composerAttachments.length} file(s) selected`;

	const images = state.composerAttachments.filter(a => a.type === "image");
	const videos = state.composerAttachments.filter(a => a.type === "video");
	const audios = state.composerAttachments.filter(a => a.type === "audio");
	const texts = state.composerAttachments.filter(a => a.type === "text");

	if (images.length > 0) {
		const imgGrid = document.createElement("div");
		imgGrid.className = "attachment-preview-grid";
		images.forEach(img => {
			const container = document.createElement("div");
			container.className = "attachment-preview-item";
			const preview = document.createElement("img");
			preview.src = img.url;
			preview.alt = img.name;
			container.appendChild(preview);
			imgGrid.appendChild(container);
		});
		refs.attachmentsList.appendChild(imgGrid);
	}

	if (videos.length > 0) {
		const videoContainer = document.createElement("div");
		videoContainer.className = "attachment-preview-item video-preview";
		const video = document.createElement("video");
		video.src = videos[0].url;
		video.controls = true;
		videoContainer.appendChild(video);
		refs.attachmentsList.appendChild(videoContainer);
	}

	if (audios.length > 0) {
		const audioContainer = document.createElement("div");
		audioContainer.className = "attachment-preview-item audio-preview";
		const audio = document.createElement("audio");
		audio.src = audios[0].url;
		audio.controls = true;
		audioContainer.appendChild(audio);
		refs.attachmentsList.appendChild(audioContainer);
	}

	if (texts.length > 0) {
		const textContainer = document.createElement("div");
		textContainer.className = "attachment-preview-item text-preview";
		const textBlock = document.createElement("div");
		textBlock.textContent = texts[0].text.substring(0, 200) + (texts[0].text.length > 200 ? "..." : "");
		textContainer.appendChild(textBlock);
		refs.attachmentsList.appendChild(textContainer);
	}
}

function bindEvents() {
	refs.goHomeBtn.addEventListener("click", () => {
		state.viewMode = "home";
		state.selectedProfileId = state.currentUserId;
		rerender();
	});

	refs.openComposerBtn.addEventListener("click", openComposer);
	refs.closeComposerBtn.addEventListener("click", closeComposer);
	refs.composerModal.addEventListener("click", event => {
		if (event.target.dataset.close === "true") {
			closeComposer();
		}
	});
	[refs.postTitle, refs.postInput].forEach(input => {
		input.addEventListener("keydown", event => {
			if (event.key !== "Enter" || event.shiftKey) {
				return;
			}
			event.preventDefault();
			openConfirmDialog("Publish this post?", () => {
				refs.createPostBtn.click();
			});
		});
	});

	refs.closeRepostBtn.addEventListener("click", closeRepostModal);
	refs.prevImageBtn.addEventListener("click", () => moveImageViewer(-1));
	refs.nextImageBtn.addEventListener("click", () => moveImageViewer(1));
	refs.imageViewerModal.addEventListener("wheel", event => {
		if (!isModalOpen(refs.imageViewerModal)) {
			return;
		}
		event.preventDefault();
		zoomImageViewer(event.deltaY < 0 ? 0.12 : -0.12);
	}, { passive: false });
	refs.closeImageViewerBtn.addEventListener("click", closeImageViewer);
	refs.imageViewerModal.addEventListener("click", event => {
		if (event.target.dataset.closeImageViewer === "true") {
			closeImageViewer();
		}
	});
	refs.repostModal.addEventListener("click", event => {
		if (event.target.dataset.closeRepost === "true") {
			closeRepostModal();
		}
	});
	[refs.repostTitle, refs.repostContent].forEach(input => {
		input.addEventListener("keydown", event => {
			if (event.key !== "Enter" || event.shiftKey) {
				return;
			}
			event.preventDefault();
			openConfirmDialog("Publish this repost?", () => {
				refs.publishRepostBtn.click();
			});
		});
	});
	refs.repostContent.addEventListener("input", () => {
		refs.repostCharCount.textContent = `${refs.repostContent.value.length}/500`;
	});
	refs.publishRepostBtn.addEventListener("click", createRepost);

	refs.confirmCancelBtn.addEventListener("click", closeConfirmDialog);
	refs.confirmOkBtn.addEventListener("click", runConfirmAction);
	refs.confirmModal.addEventListener("click", event => {
		if (event.target.dataset.closeConfirm === "true") {
			closeConfirmDialog();
		}
	});

	refs.closeListModalBtn.addEventListener("click", closeListModal);
	refs.listModal.addEventListener("click", event => {
		if (event.target.dataset.closeList === "true") {
			closeListModal();
		}
	});

	document.addEventListener("click", event => {
		if (event.target.closest(".post-menu-wrap")) {
			return;
		}
		document.querySelectorAll(".post-menu").forEach(menu => {
			menu.classList.add("hidden");
		});
	});

	refs.postDetailModal.addEventListener("click", event => {
		if (event.target.dataset.closePost === "true") {
			closePostDetail();
		}
	});

	refs.postInput.addEventListener("input", () => {
		refs.charCount.textContent = `${refs.postInput.value.length}/500`;
		
		// Auto-expand textarea
		refs.postInput.style.height = "auto";
		const scrollHeight = refs.postInput.scrollHeight;
		refs.postInput.style.height = scrollHeight + "px";
	});

	refs.postAttachment.addEventListener("change", async () => {
		const files = Array.from(refs.postAttachment.files);
		if (files.length === 0) {
			state.composerAttachments = [];
			refs.attachmentsList.innerHTML = "";
			refs.attachmentsList.classList.add("hidden");
			refs.attachmentName.textContent = "No file selected";
			refs.removeAttachmentBtn.style.display = "none";
			return;
		}

		// Validate and convert files to attachments
		const newAttachments = [];
		const typeCount = {};
		const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
		
		for (const file of files) {
			let type = null;
			let content = null;

			// File size validation
			if (file.size > MAX_FILE_SIZE) {
				showComposerError(`File "${file.name}" is too large (max 10MB)`);
				continue;
			}

			if (file.type.startsWith("image/")) {
				type = "image";
			} else if (file.type.startsWith("video/")) {
				type = "video";
			} else if (file.type.startsWith("audio/")) {
				type = "audio";
			} else if (file.name.endsWith(".txt")) {
				type = "text";
			}

			if (!type) {
				showComposerError(`File "${file.name}" is not supported`);
				continue;
			}

			// Count files by type
			typeCount[type] = (typeCount[type] || 0) + 1;

			// Validate constraints
			if (['video', 'audio', 'text'].includes(type) && typeCount[type] > 1) {
				showComposerError(`Only 1 ${type} file allowed`);
				continue;
			}

			// Read file
			if (type === "text") {
				const text = await new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result || ""));
					reader.onerror = () => reject(new Error("Cannot read file"));
					reader.readAsText(file);
				});
				newAttachments.push({ type, name: file.name, text });
			} else {
				const url = await new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const dataUrl = String(reader.result || "");
						console.log(`File "${file.name}" converted to data URL, size: ${(dataUrl.length / 1024 / 1024).toFixed(2)}MB`);
						resolve(dataUrl);
					};
					reader.onerror = () => reject(new Error("Cannot read file"));
					reader.readAsDataURL(file);
				});
				newAttachments.push({ type, name: file.name, url });
			}
		}

		state.composerAttachments = newAttachments;
		console.log(`Total attachments to send: ${newAttachments.length}`);
		newAttachments.forEach((att, i) => {
			const size = att.url ? (att.url.length / 1024 / 1024).toFixed(2) : (att.text ? (att.text.length / 1024).toFixed(2) : '0') + 'KB';
			console.log(`  [${i}] ${att.type}: ${att.name} (${size})`);
		});
		renderComposerAttachments();
		refs.removeAttachmentBtn.style.display = newAttachments.length > 0 ? "inline-block" : "none";
	});

	refs.removeAttachmentBtn.addEventListener("click", () => {
		refs.postAttachment.value = "";
		state.composerAttachments = [];
		refs.attachmentName.textContent = "No file selected";
		refs.attachmentsList.innerHTML = "";
		refs.attachmentsList.classList.add("hidden");
		refs.removeAttachmentBtn.style.display = "none";
	});

	refs.cancelPostBtn.addEventListener("click", () => {
		refs.postTitle.value = "";
		refs.postInput.value = "";
		refs.postAttachment.value = "";
		refs.attachmentName.textContent = "No file selected";
		refs.charCount.textContent = "0/500";
		refs.removeAttachmentBtn.style.display = "none";
		state.composerAttachments = [];
		refs.attachmentsList.innerHTML = "";
		refs.attachmentsList.classList.add("hidden");
		clearComposerError();
		closeComposer();
	});

	refs.createPostBtn.addEventListener("click", createPost);
	refs.feedFilter.addEventListener("change", renderPosts);

	document.addEventListener("keydown", event => {
		if (event.key === "Escape") {
			if (isModalOpen(refs.confirmModal)) {
				event.preventDefault();
				closeConfirmDialog();
				return;
			}
			if (isModalOpen(refs.listModal)) {
				event.preventDefault();
				closeListModal();
				return;
			}
			if (isModalOpen(refs.repostModal)) {
				event.preventDefault();
				closeRepostModal();
				return;
			}
			if (isModalOpen(refs.imageViewerModal)) {
				event.preventDefault();
				closeImageViewer();
				return;
			}
			if (isModalOpen(refs.composerModal)) {
				event.preventDefault();
				closeComposer();
				return;
			}
			if (isModalOpen(refs.postDetailModal)) {
				event.preventDefault();
				closePostDetail();
			}
			return;
		}

		if (event.key === "Enter" && isModalOpen(refs.confirmModal)) {
			event.preventDefault();
			runConfirmAction();
			return;
		}

		if (!isModalOpen(refs.imageViewerModal)) {
			return;
		}

		if (event.key === "ArrowLeft") {
			event.preventDefault();
			moveImageViewer(-1);
			return;
		}

		if (event.key === "ArrowRight") {
			event.preventDefault();
			moveImageViewer(1);
		}
	});
}

function rerender() {
	renderMiniProfile();
	renderProfileView();
	renderPosts();
}

bindEvents();
rerender();
initSocket();
loadRelationsFromMongo();
loadPostsFromMongo();
