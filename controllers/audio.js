const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const s3 = require('../config/s3');

const COLLECTION = 'Audio Data';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const R2_BUCKET = process.env.R2_BUCKET_NAME;

async function uploadAudio(req, res) {
  try {
    const { post_id, title } = req.body;
    const file = req.file;

    if (!file || !title) {
      return res.status(400).json({ message: 'file and title are required' });
    }

    const key = `audio/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));

    const db = getDB();
    const doc = {
      title,
      post_id: post_id || null,
      url: `${R2_PUBLIC_URL}/${key}`,
      key,
      uploadedAt: new Date(),
    };

    const result = await db.collection(COLLECTION).insertOne(doc);
    res.status(201).json({ message: 'Audio uploaded', id: result.insertedId, ...doc });
  } catch (error) {
    console.error('Upload audio error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getAudio(req, res) {
  try {
    const { post_id } = req.query;
    const db = getDB();
    const filter = post_id ? { post_id } : {};
    const tracks = await db.collection(COLLECTION).find(filter).toArray();
    res.status(200).json(tracks);
  } catch (error) {
    console.error('Get audio error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function deleteAudio(req, res) {
  try {
    const { id } = req.params;
    const db = getDB();

    const track = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!track) return res.status(404).json({ message: 'Track not found' });

    await s3.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: track.key,
    }));

    await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ message: 'Audio deleted', deletedCount: 1 });
  } catch (error) {
    console.error('Delete audio error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { uploadAudio, getAudio, deleteAudio };
