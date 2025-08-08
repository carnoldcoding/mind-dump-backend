const { getDB } = require('../config/db');

async function getAllPosts(req, res) {
  try {
    const db = getDB();
    const posts = await db.collection('posts').find({ published: true }).toArray();
    res.status(200).json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getAllPosts,
};
