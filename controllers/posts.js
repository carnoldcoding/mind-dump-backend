const { getDB } = require('../config/db');

async function getAllPosts(req, res) {
  try {
    const { type, slug, title } = req.query;
    const db = getDB();
    let filter = {}

    if(type) filter.type = type;
    if(slug) filter.slug = slug;
    if(title) filter.title = title;


    const posts = await db.collection('Mind Data').find(filter).toArray();
    res.status(200).json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getAllPosts,
};
