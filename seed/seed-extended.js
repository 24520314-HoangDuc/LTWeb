const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.DB_CONNECTION_STRING;
const fixturePath = path.join(__dirname, 'sample-posts-extended.json');

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
  likedBy: [{ type: String }],
  replies: [commentSchema],
  hiddenBy: [{ type: String }],
  blockedBy: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('ExtendedPost', postSchema, 'posts');

function buildDocMap(rawPosts) {
  const docMap = new Map();

  rawPosts.forEach((item, index) => {
    docMap.set(item.seedKey, new mongoose.Types.ObjectId());
    if (index === rawPosts.length - 1) {
      return;
    }
  });

  return docMap;
}

function mapRawPostToDoc(rawPost, docMap) {
  const doc = {
    userId: rawPost.userId,
    title: rawPost.title || 'Untitled post',
    content: rawPost.content,
    likedBy: rawPost.likedBy || [],
    replies: rawPost.replies || [],
    hiddenBy: [],
    blockedBy: [],
    createdAt: rawPost.createdAt ? new Date(rawPost.createdAt) : new Date(),
    updatedAt: rawPost.updatedAt ? new Date(rawPost.updatedAt) : new Date()
  };

  if (rawPost.attachment) {
    const attachment = { ...rawPost.attachment };

    if (attachment.originalSeedKey && docMap.has(attachment.originalSeedKey)) {
      attachment.originalPostId = docMap.get(attachment.originalSeedKey);
    }

    doc.attachment = attachment;
  }

  return doc;
}

async function seedDatabase() {
  try {
    await mongoose.connect(MONGODB_URI, {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      minPoolSize: 2
    });

    console.log('MongoDB connected for extended seeding');

    const rawPosts = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const docMap = buildDocMap(rawPosts);
    const docs = rawPosts.map((post) => mapRawPostToDoc(post, docMap));

    const result = await Post.insertMany(docs);

    console.log(`Inserted ${result.length} extended seed posts.`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Seeding failed:', error.message);
    process.exit(1);
  }
}

seedDatabase();
