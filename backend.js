/*
# Backend for Microblogging System

## Requirements:
- Express.js
- MongoDB
- Mongoose
- dotenv
- body-parser

## Steps to modify existing files:
1. Ensure MongoDB is running and accessible.
2. Modify `.env` file to include DB_CONNECTION_STRING.
3. Update routes corresponding to new feature
*/

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// MongoDB connection
mongoose.connect(process.env.DB_CONNECTION_STRING, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

const postSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    likedBy: { type: [String], default: [] },
    attachment: { type: String, default: null },
    replies: { type: Array, default: [] }
});

const Post = mongoose.model('Post', postSchema);

// API Endpoints

// GET all posts
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET single post by ID
app.get('/api/posts/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        res.json(post);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST create new post
app.post('/api/posts', async (req, res) => {
    try {
        const newPost = new Post({
            userId: req.body.userId,
            title: req.body.title,
            content: req.body.content,
            attachment: req.body.attachment || null
        });
        const savedPost = await newPost.save();
        res.status(201).json(savedPost);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// PUT update post
app.put('/api/posts/:id', async (req, res) => {
    try {
        const post = await Post.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!post) return res.status(404).json({ error: 'Post not found' });
        res.json(post);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// DELETE post
app.delete('/api/posts/:id', async (req, res) => {
    try {
        const post = await Post.findByIdAndDelete(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        res.json({ message: 'Post deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST add like to post
app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        
        const userId = req.body.userId;
        if (!post.likedBy.includes(userId)) {
            post.likedBy.push(userId);
            await post.save();
        }
        res.json(post);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST remove like from post
app.post('/api/posts/:id/unlike', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        
        const userId = req.body.userId;
        post.likedBy = post.likedBy.filter(id => id !== userId);
        await post.save();
        res.json(post);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST add reply to post
app.post('/api/posts/:id/reply', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        
        const reply = {
            userId: req.body.userId,
            text: req.body.text,
            createdAt: new Date()
        };
        post.replies.push(reply);
        await post.save();
        res.status(201).json(post);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
