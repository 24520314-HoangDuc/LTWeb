const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');

dotenv.config();

const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

// Serve frontend static files so the app is loaded over http://localhost:PORT
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.DB_CONNECTION_STRING || 'mongodb://USERNAME:PASSWORD@HOST:27017/DATABASE_NAME';

function toCommentPacket(comment) {
    return {
        id: String(comment._id),
        userId: comment.userId,
        text: comment.text,
        parentId: comment.parentId ? String(comment.parentId) : null,
        likedBy: Array.isArray(comment.likedBy) ? comment.likedBy : [],
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt || comment.createdAt
    };
}

function toAttachmentPacket(attachment) {
    if (!attachment) {
        return null;
    }

    const hasContent = attachment.type || attachment.name || attachment.url || attachment.text || attachment.originalPostId;
    if (!hasContent) {
        return null;
    }

    return {
        type: attachment.type || null,
        name: attachment.name || "",
        url: attachment.url || "",
        text: attachment.text || "",
        originalPostId: attachment.originalPostId ? String(attachment.originalPostId) : null
    };
}

function toAttachmentsPacket(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return [];
    }

    return attachments.map(att => ({
        type: att.type || null,
        name: att.name || "",
        url: att.url || "",
        text: att.text || ""
    }));
}

function toPostPacket(post) {
    return {
        id: String(post._id),
        userId: post.userId,
        title: post.title,
        content: post.content,
        attachment: toAttachmentPacket(post.attachment),
        attachments: toAttachmentsPacket(post.attachments),
        likedBy: Array.isArray(post.likedBy) ? post.likedBy : [],
        replies: Array.isArray(post.replies) ? post.replies.map(toCommentPacket) : [],
        hiddenBy: Array.isArray(post.hiddenBy) ? post.hiddenBy : [],
        blockedBy: Array.isArray(post.blockedBy) ? post.blockedBy : [],
        createdAt: post.createdAt,
        updatedAt: post.updatedAt
    };
}

function sendPost(res, post, status = 200) {
    return res.status(status).json(toPostPacket(post));
}

function toRelationPacket(relation) {
    return {
        id: String(relation._id),
        ownerId: relation.ownerId,
        targetId: relation.targetId,
        type: relation.type,
        createdAt: relation.createdAt,
        updatedAt: relation.updatedAt
    };
}

// MongoDB connection
mongoose.connect(MONGODB_URI, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    minPoolSize: 2
})
    .then(() => {
        console.log('✓ MongoDB connected successfully');
        // Setup change stream after successful connection
        try {
            const postsCollection = mongoose.connection.collection('posts');
            const changeStream = postsCollection.watch([], { fullDocument: 'updateLookup' });
            changeStream.on('change', (change) => {
                try {
                    if (change.operationType === 'insert') {
                        const doc = change.fullDocument;
                        invalidatePostsCache();
                        broadcastPostCreated(doc);
                    } else if (change.operationType === 'update' || change.operationType === 'replace') {
                        const doc = change.fullDocument;
                        invalidatePostsCache();
                        broadcastPostUpdated(doc);
                    } else if (change.operationType === 'delete') {
                        const id = change.documentKey && change.documentKey._id;
                        invalidatePostsCache();
                        if (id) broadcastPostDeleted(id);
                    }
                } catch (err) {
                    console.error('Change stream handler error:', err && err.message ? err.message : err);
                }
            });
            console.log('✓ Posts change stream established');
        } catch (err) {
            console.error('✗ Failed to establish posts change stream:', err && err.message ? err.message : err);
        }
    })
    .catch(err => console.error('✗ MongoDB connection error:', err.message));

const commentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    text: { type: String, required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    likedBy: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const postSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    title: { type: String, default: 'Untitled post' },
    content: { type: String, required: true },
    attachment: {
        type: {
            type: String,
            enum: ['image', 'audio', 'video', 'text', 'repost'],
            default: null
        },
        name: { type: String, default: '' },
        url: { type: String, default: '' },
        text: { type: String, default: '' },
        originalPostId: { type: mongoose.Schema.Types.ObjectId, default: null }
    },
    attachments: [{
        type: {
            type: String,
            enum: ['image', 'audio', 'video', 'text'],
            required: true
        },
        name: { type: String, required: true },
        url: { type: String, default: '' },
        text: { type: String, default: '' }
    }],
    likedBy: [{ type: String }],
    replies: [commentSchema],
    hiddenBy: [{ type: String }],
    blockedBy: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

const relationSchema = new mongoose.Schema({
    ownerId: { type: String, required: true },
    targetId: { type: String, required: true },
    type: { type: String, enum: ['follow', 'block'], required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

relationSchema.index({ ownerId: 1, targetId: 1, type: 1 }, { unique: true });

const Relation = mongoose.model('Relation', relationSchema);

// ====== CACHING SYSTEM ======
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache duration
const cache = {
    posts: null,
    postsTimestamp: 0,
    relations: null,
    relationsTimestamp: 0
};

function invalidatePostsCache() {
    cache.posts = null;
    cache.postsTimestamp = 0;
    console.log('✓ Posts cache invalidated');
}

function invalidateRelationsCache() {
    cache.relations = null;
    cache.relationsTimestamp = 0;
    console.log('✓ Relations cache invalidated');
}

function getCachedPosts() {
    const now = Date.now();
    if (cache.posts && (now - cache.postsTimestamp) < CACHE_TTL) {
        console.log('✓ Returning posts from cache');
        return cache.posts;
    }
    return null;
}

function getCachedRelations() {
    const now = Date.now();
    if (cache.relations && (now - cache.relationsTimestamp) < CACHE_TTL) {
        console.log('✓ Returning relations from cache');
        return cache.relations;
    }
    return null;
}

function setPostsCache(posts) {
    cache.posts = posts;
    cache.postsTimestamp = Date.now();
    console.log('✓ Posts cached');
}

function setRelationsCache(relations) {
    cache.relations = relations;
    cache.relationsTimestamp = Date.now();
    console.log('✓ Relations cached');
}

// ====== SOCKET.IO SETUP ======
io.on('connection', (socket) => {
    console.log(`✓ Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
        console.log(`✗ Client disconnected: ${socket.id}`);
    });
});

// Broadcast functions
function broadcastPostCreated(post) {
    io.emit('post:created', toPostPacket(post));
    console.log('📡 Broadcasting new post');
}

function broadcastPostUpdated(post) {
    io.emit('post:updated', toPostPacket(post));
    console.log('📡 Broadcasting post update');
}

function broadcastPostDeleted(postId) {
    io.emit('post:deleted', { id: String(postId) });
    console.log('📡 Broadcasting post deletion');
}

function broadcastCommentAdded(post) {
    io.emit('comment:added', toPostPacket(post));
    console.log('📡 Broadcasting new comment');
}

function broadcastPostLiked(post) {
    io.emit('post:liked', toPostPacket(post));
    console.log('📡 Broadcasting post like');
}

app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

app.get('/api/relations', async (_req, res) => {
    try {
        // Check cache first
        const cachedRelations = getCachedRelations();
        if (cachedRelations) {
            return res.json(cachedRelations);
        }

        const relations = await Relation.find().sort({ createdAt: -1 }).lean();
        const relationPackets = relations.map(toRelationPacket);
        setRelationsCache(relationPackets);
        res.json(relationPackets);
    } catch (err) {
        res.status(500).json({ message: 'Failed to load relations', error: err.message });
    }
});

app.post('/api/relations/toggle', async (req, res) => {
    try {
        const { ownerId, targetId, type } = req.body;

        if (!ownerId || !targetId || !type) {
            return res.status(400).json({ message: 'ownerId, targetId and type are required' });
        }

        if (ownerId === targetId) {
            return res.status(400).json({ message: 'You cannot relate to yourself' });
        }

        if (!['follow', 'block'].includes(type)) {
            return res.status(400).json({ message: 'Invalid relation type' });
        }

        if (type === 'follow') {
            const blocked = await Relation.findOne({ ownerId, targetId, type: 'block' });
            if (blocked) {
                return res.status(403).json({ message: 'Unblock the user before following' });
            }

            const existing = await Relation.findOne({ ownerId, targetId, type: 'follow' });
            if (existing) {
                await Relation.deleteOne({ _id: existing._id });
            } else {
                await Relation.create({ ownerId, targetId, type: 'follow' });
            }
        }

        if (type === 'block') {
            const existing = await Relation.findOne({ ownerId, targetId, type: 'block' });
            if (existing) {
                await Relation.deleteOne({ _id: existing._id });
            } else {
                await Relation.deleteMany({ ownerId, targetId, type: 'follow' });
                await Relation.create({ ownerId, targetId, type: 'block' });
            }
        }

        invalidateRelationsCache();
        const relations = await Relation.find().sort({ createdAt: -1 }).lean();
        const relationPackets = relations.map(toRelationPacket);
        setRelationsCache(relationPackets);
        res.json(relationPackets);
    } catch (err) {
        res.status(500).json({ message: 'Failed to toggle relation', error: err.message });
    }
});

app.get('/api/posts', async (_req, res) => {
    try {
        // Always read latest posts from DB, then update cache (cache is lower priority)
        const posts = await Post.find().sort({ createdAt: -1 }).lean();
        const postPackets = posts.map(toPostPacket);
        setPostsCache(postPackets);
        res.json(postPackets);
    } catch (err) {
        res.status(500).json({ message: 'Failed to load posts', error: err.message });
    }
});

app.get('/api/posts/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id).lean();
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
        res.json(toPostPacket(post));
    } catch (err) {
        res.status(400).json({ message: 'Invalid post id', error: err.message });
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { userId, title, content, attachment, attachments } = req.body;

        if (!userId || !content) {
            return res.status(400).json({ message: 'userId and content are required' });
        }

        console.log(`[POST] Creating post for user ${userId}`);
        console.log(`  Attachments received: ${Array.isArray(attachments) ? attachments.length : 0}`);
        
        if (Array.isArray(attachments) && attachments.length > 0) {
            attachments.forEach((att, i) => {
                const size = att.url ? (att.url.length / 1024 / 1024).toFixed(2) + 'MB' : 
                            (att.text ? (att.text.length / 1024).toFixed(2) + 'KB' : '0B');
                console.log(`    [${i}] ${att.type}: ${att.name} (${size})`);
            });
        }

        // Validate attachments based on type
        let validatedAttachments = [];
        if (Array.isArray(attachments) && attachments.length > 0) {
            const types = {};
            for (const att of attachments) {
                if (!att.type) continue;
                
                // Count by type
                types[att.type] = (types[att.type] || 0) + 1;
                
                // Validate constraints
                if (['video', 'audio', 'text'].includes(att.type) && types[att.type] > 1) {
                    return res.status(400).json({ 
                        message: `Only 1 ${att.type} file allowed, got ${types[att.type]}` 
                    });
                }
            }
            validatedAttachments = attachments;
        }

        const newPost = await Post.create({
            userId,
            title: title || 'Untitled post',
            content,
            attachment: attachment || null,
            attachments: validatedAttachments
        });

        console.log(`[POST] Post created with ID: ${newPost._id}`);
        console.log(`  Stored attachments: ${newPost.attachments ? newPost.attachments.length : 0}`);

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, newPost, 201);
    } catch (err) {
        console.error('[POST ERROR]', err.message);
        res.status(500).json({ message: 'Failed to create post', error: err.message });
    }
});

app.patch('/api/posts/:id', async (req, res) => {
    try {
        const updates = {
            ...req.body,
            updatedAt: new Date()
        };

        const post = await Post.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, post);
    } catch (err) {
        res.status(400).json({ message: 'Failed to update post', error: err.message });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        if (String(post.userId) !== String(userId)) {
            return res.status(403).json({ message: 'You can only delete your own post' });
        }

        await Post.findByIdAndDelete(req.params.id);

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        res.json({ message: 'Post deleted successfully' });
    } catch (err) {
        res.status(400).json({ message: 'Failed to delete post', error: err.message });
    }
});

app.post('/api/posts/:id/comments', async (req, res) => {
    try {
        const { userId, text, parentId = null } = req.body;

        if (!userId || !text) {
            return res.status(400).json({ message: 'userId and text are required' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        post.replies.push({ userId, text, parentId });
        post.updatedAt = new Date();
        await post.save();

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, post, 201);
    } catch (err) {
        res.status(500).json({ message: 'Failed to add comment', error: err.message });
    }
});

app.patch('/api/posts/:postId/comments/:commentId', async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ message: 'text is required' });
        }

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const comment = post.replies.id(commentId);
        if (!comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        comment.text = text;
        post.updatedAt = new Date();
        await post.save();

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, post);
    } catch (err) {
        res.status(400).json({ message: 'Failed to update comment', error: err.message });
    }
});

app.delete('/api/posts/:postId/comments/:commentId', async (req, res) => {
    try {
        const { postId, commentId } = req.params;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const comment = post.replies.id(commentId);
        if (!comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const idsToRemove = new Set([String(comment._id)]);
        let changed = true;

        while (changed) {
            changed = false;
            post.replies.forEach(reply => {
                const replyParentId = reply.parentId ? String(reply.parentId) : null;
                const replyId = String(reply._id);

                if (replyParentId && idsToRemove.has(replyParentId) && !idsToRemove.has(replyId)) {
                    idsToRemove.add(replyId);
                    changed = true;
                }
            });
        }

        post.replies = post.replies.filter(reply => !idsToRemove.has(String(reply._id)));
        post.updatedAt = new Date();
        await post.save();

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, post);
    } catch (err) {
        res.status(400).json({ message: 'Failed to delete comment', error: err.message });
    }
});

app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const likedIndex = post.likedBy.indexOf(userId);
        if (likedIndex >= 0) {
            post.likedBy.splice(likedIndex, 1);
        } else {
            post.likedBy.push(userId);
        }

        post.updatedAt = new Date();
        await post.save();

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, post);
    } catch (err) {
        res.status(500).json({ message: 'Failed to toggle like', error: err.message });
    }
});

app.post('/api/posts/:postId/comments/:commentId/like', async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const comment = post.replies.id(commentId);
        if (!comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        if (!Array.isArray(comment.likedBy)) {
            comment.likedBy = [];
        }

        const likedIndex = comment.likedBy.indexOf(userId);
        if (likedIndex >= 0) {
            comment.likedBy.splice(likedIndex, 1);
        } else {
            comment.likedBy.push(userId);
        }

        post.updatedAt = new Date();
        await post.save();

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, post);
    } catch (err) {
        res.status(500).json({ message: 'Failed to toggle comment like', error: err.message });
    }
});

app.post('/api/posts/:id/repost', async (req, res) => {
    try {
        const sourcePost = await Post.findById(req.params.id);
        if (!sourcePost) {
            return res.status(404).json({ message: 'Original post not found' });
        }

        const { userId, title, content } = req.body;
        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const repost = await Post.create({
            userId,
            title: title || 'Repost',
            content: content || '',
            attachment: {
                type: 'repost',
                name: 'Reposted post',
                originalPostId: sourcePost._id
            }
        });

        invalidatePostsCache();
        // Broadcasting is handled by MongoDB change streams to avoid duplicate events
        sendPost(res, repost, 201);
    } catch (err) {
        res.status(500).json({ message: 'Failed to create repost', error: err.message });
    }
});

app.post('/api/upload', (req, res) => {
    try {
        const { type, name, url, text } = req.body;

        if (!type || !name) {
            return res.status(400).json({ message: 'type and name are required' });
        }

        if (!['image', 'audio', 'video', 'text'].includes(type)) {
            return res.status(400).json({ message: 'Invalid file type' });
        }

        if (type === 'text' && !text) {
            return res.status(400).json({ message: 'text content is required for text files' });
        }

        if (['image', 'audio', 'video'].includes(type) && !url) {
            return res.status(400).json({ message: `url is required for ${type} files` });
        }

        const attachment = { type, name };
        if (url) attachment.url = url;
        if (text) attachment.text = text;

        res.json({ ok: true, attachment });
    } catch (err) {
        res.status(500).json({ message: 'Upload failed', error: err.message });
    }
});

app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Socket.io ready for real-time updates`);
});
