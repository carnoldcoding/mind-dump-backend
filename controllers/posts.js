const { getDB } = require('../config/db');
const mediaStore = require('../lib/mediaStore');

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


/**
 * Which media a Review owns, as filters for mediaStore.
 *
 * Pure, and separate from the deleting for that reason: getting this wrong
 * either strands files in the bucket or takes down a cover another Review is
 * still showing, and neither is visible from the response.
 *
 * A cover reaches its Review by either of two routes. Rows written by the
 * backfill carry a post_id. Rows written by Capture carry none — the cover is
 * stored before the Review exists, so there is no id to file it under — and
 * are found instead by the URL the Review points at.
 */
function mediaFilters(review, { coverSharedWithOthers = false } = {}) {
  const postId = String(review._id);

  const cover = [{ post_id: postId }];
  // Matching on the URL is only safe while this Review is the only one
  // pointing at it. Nothing creates a shared cover today — every upload writes
  // its own object — but a hand-edited image_path could, and deleting one
  // Review must not blank another's artwork.
  if (review.image_path && !coverSharedWithOthers) cover.push({ url: review.image_path });

  return [
    ['image', { post_id: postId }],
    ['audio', { post_id: postId }],
    ['cover', cover.length === 1 ? cover[0] : { $or: cover }],
  ];
}

/**
 * Deletes a Review and the media it owns.
 *
 * The media goes first. A failure part-way then leaves the Review in place to
 * be deleted again, where the other order would drop the Review and strand
 * whatever had not been reached — files nothing in the app can see or remove.
 */
async function removePost(req, res) {
  try {
    const db = getDB();
    const { slug } = req.body;

    if (!slug) {
      return res.status(400).json({ message: 'Slug is required' });
    }

    const review = await db.collection('Mind Data').findOne({ slug: slug });

    if (!review) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const coverSharedWithOthers = review.image_path
      ? await db.collection('Mind Data').countDocuments(
          { image_path: review.image_path, _id: { $ne: review._id } }, { limit: 1 }
        ) > 0
      : false;

    const removed = {};
    for (const [kind, filter] of mediaFilters(review, { coverSharedWithOthers })) {
      removed[kind] = (await mediaStore.removeWhere(kind, filter)).length;
    }

    const result = await db.collection('Mind Data').deleteOne({ _id: review._id });

    res.status(200).json({
      message: "Post deleted successfully",
      slug: slug,
      deletedCount: result.deletedCount,
      removedMedia: removed
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getAllGenres(req, res) {
  try {
    const db = getDB();
    const { type } = req.query;

    let filter = {};
    let genreList = [];

    if(type) filter.type = type;

    const posts = await db.collection('Mind Data').find(filter).toArray();
    
    posts.forEach((post) => {
      const filteredGenres = post.genres.filter((genre) => !genreList.includes(genre));
      genreList.push(...filteredGenres);
    })

    res.status(200).json(genreList);
  } catch (error) {
    console.error('Error fetching genres:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getAllCreators(req, res) {
  try {
    const db = getDB();
    const { type } = req.query;

    let filter = {};
    let creatorList = [];

    if(type) filter.type = type;
    
    const posts = await db.collection('Mind Data').find(filter).toArray();
    
    posts.forEach((post) => {
      !creatorList.includes(post.creator) && creatorList.push(post.creator);
    })

    res.status(200).json(creatorList);
  } catch (error) {
    console.error('Error fetching creators:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getAllPosts,
  addPost,
  removePost,
  updatePost,
  getAllGenres,
  getAllCreators,
  // Exported for its test. The deleting either side of it is one call each and
  // needs a database to say anything; this is where the decisions are.
  mediaFilters
};