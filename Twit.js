const users = {
	me: { id: "me", name: "You", username: "you_now", bio: "Frontend learner building mini products.", color: "#0e86d4" },
	ana: { id: "ana", name: "Ana Pham", username: "ana_ui", bio: "UI explorer. Coffee and grids.", color: "#f08a5d" },
	khan: { id: "khan", name: "Khan Tran", username: "khan_code", bio: "JS and weekend bikes.", color: "#6a7fdb" },
	linh: { id: "linh", name: "Linh Vo", username: "linh_media", bio: "Stories, clips, and quick notes.", color: "#2a9d8f" }
};

const state = {
	currentUserId: "me",
	selectedProfileId: "me",
	viewMode: "home",
	following: new Set(),
	hiddenPostIds: new Set(),
	blockedUserIds: new Set(),
	posts: [],
	replyModeByPost: new Map(),
	activeRepostPostId: null,
	activeDetailPostId: null,
	isLoadingPosts: true,
	loadError: ""
};

const refs = {
	activeProfile: document.getElementById("activeProfile"),
	goHomeBtn: document.getElementById("goHomeBtn"),
	openComposerBtn: document.getElementById("openComposerBtn"),
	closeComposerBtn: document.getElementById("closeComposerBtn"),
	composerModal: document.getElementById("composerModal"),
	repostModal: document.getElementById("repostModal"),
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
	charCount: document.getElementById("charCount"),
	composerError: document.getElementById("composerError"),
	createPostBtn: document.getElementById("createPostBtn"),
	feedFilter: document.getElementById("feedFilter"),
	feedList: document.getElementById("feedList"),
	postTemplate: document.getElementById("postTemplate")
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
	return requestJson(`/posts/${postId}/like`, {
		method: "POST",
		body: JSON.stringify({ userId: state.currentUserId })
	});
}

async function toggleCommentLike(postId, commentId) {
	return requestJson(`/posts/${postId}/comments/${commentId}/like`, {
		method: "POST",
		body: JSON.stringify({ userId: state.currentUserId })
	});
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
		? {
			type: post.attachment.type || null,
			name: post.attachment.name || "",
			url: post.attachment.url || "",
			text: post.attachment.text || "",
			originalPostId: post.attachment.originalPostId ? String(post.attachment.originalPostId) : null
		}
		: null;

	return {
		id: String(post._id || post.id),
		userId: post.userId,
		title: post.title || "Untitled post",
		content: post.content || "",
		createdAt: post.createdAt ? new Date(post.createdAt) : new Date(),
		updatedAt: post.updatedAt ? new Date(post.updatedAt) : new Date(),
		likedBy: new Set(Array.isArray(post.likedBy) ? post.likedBy : []),
		attachment,
		replies: (post.replies || []).map(mapComment)
	};
}

function syncPostFromServer(postData) {
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
		const posts = await requestJson("/posts", { method: "GET" });
		state.posts = Array.isArray(posts) ? posts.map(mapPost) : [];
		normalizeComments();
	} catch (error) {
		state.loadError = error.message;
		state.posts = [];
	} finally {
		state.isLoadingPosts = false;
		rerender();
	}
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
	if (userId === state.currentUserId) {
		return state.following.size;
	}
	return state.following.has(userId) ? 1 : 0;
}

function getFollowerIds(userId) {
	if (userId === state.currentUserId) {
		return Array.from(state.following);
	}
	return state.following.has(userId) ? [state.currentUserId] : [];
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
				unblockBtn.addEventListener("click", () => {
					state.blockedUserIds.delete(userId);
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
	try {
		const updatedPost = await requestJson(`/posts/${postId}/comments`, {
			method: "POST",
			body: JSON.stringify({
				userId: state.currentUserId,
				text: text.trim(),
				parentId
			})
		});
		syncPostFromServer(updatedPost);
		return true;
	} catch (error) {
		console.error("Failed to add comment:", error);
		return false;
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
	if (!post.attachment) {
		container.classList.add("hidden");
		return;
	}

	container.classList.remove("hidden");
	const nameNode = document.createElement("div");
	nameNode.className = "attachment-name";
	nameNode.textContent = `Attachment: ${post.attachment.name}`;
	container.appendChild(nameNode);

	if (post.attachment.type === "image") {
		const image = document.createElement("img");
		image.src = post.attachment.url;
		image.alt = post.attachment.name;
		container.appendChild(image);
		return;
	}

	if (post.attachment.type === "audio") {
		const audio = document.createElement("audio");
		audio.controls = true;
		audio.src = post.attachment.url;
		container.appendChild(audio);
		return;
	}

	if (post.attachment.type === "video") {
		const video = document.createElement("video");
		video.controls = true;
		video.src = post.attachment.url;
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
	textBlock.className = "attachment-text";
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
					if (state.blockedUserIds.has(user.id)) {
						state.blockedUserIds.delete(user.id);
					} else {
						state.blockedUserIds.add(user.id);
						state.following.delete(user.id);
					}
					rerender();
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
		avatarBtn.addEventListener("click", () => selectProfile(user.id, "profile"));

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

		if (post.userId === state.currentUserId) {
			menuFollow.classList.add("hidden");
			menuUnfollow.classList.add("hidden");
			menuBlock.classList.add("hidden");
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
			state.blockedUserIds.add(post.userId);
			state.following.delete(post.userId);
			rerender();
		});

		node.querySelector(".post-title").textContent = post.title || "Untitled";
		node.querySelector(".time").textContent = formatTime(post.createdAt);
		node.querySelector(".post-content").textContent = post.content;
		renderAttachment(node.querySelector(".post-attachment"), post);

		const commentBtn = node.querySelector(".comment-btn");
		commentBtn.addEventListener("click", () => {
			openPostDetail(post.id);
		});

		const repostBtn = node.querySelector(".repost-btn");
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
					console.error("Failed to toggle post like:", error);
				});
		});

		const inlineCommentInput = node.querySelector(".inline-comment-input");
		const inlineCommentSend = node.querySelector(".inline-comment-send");
		inlineCommentSend.addEventListener("click", () => {
			addCommentToPost(post.id, inlineCommentInput.value, null).then(sent => {
				if (!sent) {
					return;
				}
				inlineCommentInput.value = "";
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
			<button class="action-btn detail-comment-btn" type="button">Comment</button>
			<button class="action-btn detail-repost-btn" type="button">Repost</button>
			<button class="action-btn detail-like-btn ${post.likedBy.has(state.currentUserId) ? "liked" : ""}" type="button">${post.likedBy.has(state.currentUserId) ? "Liked" : "Like"} (${post.likedBy.size})</button>
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

	detailCommentSend.addEventListener("click", () => {
			addCommentToPost(post.id, detailCommentInput.value, null).then(sent => {
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

	try {
		const created = await requestJson(`/posts/${state.activeRepostPostId}/repost`, {
			method: "POST",
			body: JSON.stringify({
				userId: state.currentUserId,
				title: title || "Repost",
				content
			})
		});
		syncPostFromServer(created);
		closeRepostModal();
		state.viewMode = "home";
		refs.feedFilter.value = "all";
		rerender();
	} catch (error) {
		console.error("Failed to create repost:", error);
	}
}

function selectProfile(userId, mode = "profile") {
	state.selectedProfileId = userId;
	state.viewMode = mode;
	rerender();
}

function toggleFollow(userId) {
	if (state.following.has(userId)) {
		state.following.delete(userId);
	} else {
		state.following.add(userId);
	}
	rerender();
}

function resetComposer() {
	refs.postTitle.value = "";
	refs.postInput.value = "";
	refs.postAttachment.value = "";
	refs.attachmentName.textContent = "No file selected";
	refs.charCount.textContent = "0/500";
	clearComposerError();
}

function openComposer() {
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

async function createPost() {
	const title = refs.postTitle.value.trim();
	const content = refs.postInput.value.trim();
	if (!title && !content) {
		clearComposerError();
		return;
	}

	const selectedFile = refs.postAttachment.files[0] || null;

	async function finalizePost(attachment) {
		try {
			clearComposerError();
			const created = await requestJson("/posts", {
				method: "POST",
				body: JSON.stringify({
					userId: state.currentUserId,
					title: title || "Untitled post",
					content,
					attachment
				})
			});
			syncPostFromServer(created);
			resetComposer();
			closeComposer();
			state.viewMode = "home";
			refs.feedFilter.value = "all";
			rerender();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error || "Unknown error");
			showComposerError(`Unable to post: ${errorMessage}`);
			console.error("Failed to create post:", error);
		}
	}

	function readFileAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ""));
			reader.onerror = () => reject(new Error("Cannot read file."));
			reader.readAsDataURL(file);
		});
	}

	if (!selectedFile) {
		await finalizePost(null);
		return;
	}

	if (selectedFile.type.startsWith("audio/")) {
		try {
			await finalizePost({
				type: "audio",
				name: selectedFile.name,
				url: await readFileAsDataUrl(selectedFile)
			});
		} catch {
			await finalizePost(null);
		}
		return;
	}

	if (selectedFile.type.startsWith("image/")) {
		try {
			await finalizePost({
				type: "image",
				name: selectedFile.name,
				url: await readFileAsDataUrl(selectedFile)
			});
		} catch {
			await finalizePost(null);
		}
		return;
	}

	if (selectedFile.type.startsWith("video/")) {
		try {
			await finalizePost({
				type: "video",
				name: selectedFile.name,
				url: await readFileAsDataUrl(selectedFile)
			});
		} catch {
			await finalizePost(null);
		}
		return;
	}

	const reader = new FileReader();
	reader.onload = () => {
		finalizePost({
			type: "text",
			name: selectedFile.name,
			text: String(reader.result || "")
		});
	};
	reader.onerror = () => {
		finalizePost({
			type: "text",
			name: selectedFile.name,
			text: "Cannot read this file content."
		});
	};
	reader.readAsText(selectedFile);
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
	});

	refs.postAttachment.addEventListener("change", () => {
		const file = refs.postAttachment.files[0];
		refs.attachmentName.textContent = file ? file.name : "No file selected";
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
loadPostsFromMongo();
