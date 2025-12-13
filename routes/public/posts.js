const express = require('express');
const router = express.Router();

console.log('Posts routes file loaded!');

// Controller functions
const {
  getAllPosts,
  addPost,
  removePost,
  updatePost
} = require('../../controllers/posts');

// GET /api/posts — get all public posts
router.get('/', getAllPosts);  
router.post('/add_post', addPost);
router.post('/remove_post', removePost);
router.post('/update_post', updatePost);

console.log('POST /add_post route registered'); 

module.exports = router;