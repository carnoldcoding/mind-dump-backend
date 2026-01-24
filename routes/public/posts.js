const express = require('express');
const router = express.Router();

// Controller functions
const {
  getAllPosts,
  addPost,
  removePost,
  updatePost,
  getAllGenres,
  getAllCreators
} = require('../../controllers/posts');

// GET /api/posts — get all public posts
router.get('/', getAllPosts);  
router.get('/get_genres', getAllGenres);
router.get('/get_creators', getAllCreators);

// POST
router.post('/add_post', addPost);
router.post('/remove_post', removePost);
router.post('/update_post', updatePost);

module.exports = router;