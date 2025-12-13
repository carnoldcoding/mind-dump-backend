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

async function addPost(req, res) {
  try {
    const db = getDB();
    const newPost = req.body;
    
    // Add timestamp
    newPost.createdAt = new Date();
    
    // Insert into database
    const result = await db.collection('Mind Data').insertOne(newPost);
    
    res.status(201).json({
      message: "Review created successfully",
      id: result.insertedId,
      post: newPost
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function updatePost(req, res) {
  try {
    const db = getDB();
    const { slug, ...updateData } = req.body;
    
    if (!slug) {
      return res.status(400).json({ message: 'Slug is required' });
    }
    
    // Update timestamp
    updateData.updatedAt = new Date();
    
    // Update the document
    const result = await db.collection('Mind Data').updateOne(
      { slug: slug },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    res.status(200).json({
      message: "Post updated successfully",
      slug: slug,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ message: 'Server error' });
  }
}


async function removePost(req, res) {
  try {
    const db = getDB();
    const { slug } = req.body;
    
    if (!slug) {
      return res.status(400).json({ message: 'Slug is required' });
    }
    
    const result = await db.collection('Mind Data').deleteOne({ slug: slug });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    res.status(200).json({
      message: "Post deleted successfully",
      slug: slug,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getAllPosts,
  addPost,
  removePost,
  updatePost
};
