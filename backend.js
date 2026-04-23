const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.DB_CONNECTION_STRING || 'mongodb://USERNAME:PASSWORD@HOST:27017/DATABASE_NAME';

// MongoDB connection
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

const commentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    text: { type: String, required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, default: null },
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
    likedBy: [{ type: String }],
    replies: [commentSchema],
    hiddenBy: [{ type: String }],
    blockedBy: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

app.get('/api/posts', async (_req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 }).lean();
        res.json(posts);
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
        res.json(post);
    } catch (err) {
        res.status(400).json({ message: 'Invalid post id', error: err.message });
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { userId, title, content, attachment } = req.body;

        if (!userId || !content) {
            return res.status(400).json({ message: 'userId and content are required' });
        }

        const newPost = await Post.create({
            userId,
            title: title || 'Untitled post',
            content,
            attachment: attachment || null
        });

        res.status(201).json(newPost);
    } catch (err) {
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

        res.json(post);
    } catch (err) {
        res.status(400).json({ message: 'Failed to update post', error: err.message });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const deleted = await Post.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ message: 'Post not found' });
        }

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

        res.status(201).json(post);
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

        res.json(post);
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

        comment.deleteOne();
        post.updatedAt = new Date();
        await post.save();

        res.json(post);
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

        res.json(post);
    } catch (err) {
        res.status(500).json({ message: 'Failed to toggle like', error: err.message });
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

        res.status(201).json(repost);
    } catch (err) {
        res.status(500).json({ message: 'Failed to create repost', error: err.message });
    }
});

app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
