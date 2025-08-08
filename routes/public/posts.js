const express = require('express');
const router = express.Router();

// Controller functions
const {
  getAllPosts,
} = require('../../controllers/posts');

// GET /api/posts — get all public posts
router.get('/', getAllPosts);

module.exports = router;
