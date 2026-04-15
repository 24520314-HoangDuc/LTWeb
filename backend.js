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
3. Update routes corresponding to new features.

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
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// API endpoints
app.post('/api/posts', async (req, res) => {
    const newPost = new Post({
        userId: req.body.userId,
        content: req.body.content
    });
    await newPost.save();
    res.status(201).send(newPost);
});

app.get('/api/posts', async (req, res) => {
    const posts = await Post.find();
    res.send(posts);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
