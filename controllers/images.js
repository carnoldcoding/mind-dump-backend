const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const s3 = require('../config/s3');

const COLLECTION = 'Image Data';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const R2_BUCKET = process.env.R2_BUCKET_NAME;

async function uploadImage(req, res) {
  try {
    const { post_id, title, type } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'file is required' });
    }

    const key = `images/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));

    const db = getDB();
    const doc = {
      title: title || null,
      type: type || null,
      post_id: post_id || null,
      url: `${R2_PUBLIC_URL}/${key}`,
      key,
      uploadedAt: new Date(),
    };

    const result = await db.collection(COLLECTION).insertOne(doc);
    res.status(201).json({ message: 'Image uploaded', id: result.insertedId, ...doc });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getImages(req, res) {
  try {
    const { post_id, type } = req.query;
    const db = getDB();
    const filter = {};
    if (post_id) filter.post_id = post_id;
    if (type) filter.type = type;
    const images = await db.collection(COLLECTION).find(filter).toArray();
    res.status(200).json(images);
  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function deleteImage(req, res) {
  try {
    const { id } = req.params;
    const db = getDB();

    const image = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!image) return res.status(404).json({ message: 'Image not found' });

    await s3.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: image.key,
    }));

    await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ message: 'Image deleted', deletedCount: 1 });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { uploadImage, getImages, deleteImage };
