// Deep module for R2 + Mongo media storage. audio.js and images.js are both
// adapters over the same upload/list/remove sequence — this owns it once,
// parameterized by kind, instead of each controller reimplementing it.
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');
const s3 = require('../config/s3');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const R2_BUCKET = process.env.R2_BUCKET_NAME;

const KINDS = {
  audio: { collection: 'Audio Data', prefix: 'audio' },
  image: { collection: 'Image Data', prefix: 'images' },
  // Cover art copied from a metadata provider. Its own prefix and collection
  // so it never shows up in a Review's screenshots, and its own kind because
  // it arrives before the Review exists — there is no post_id to file it under.
  cover: { collection: 'Cover Data', prefix: 'covers' },
};

function kindConfig(kind) {
  const config = KINDS[kind];
  if (!config) throw new Error(`Unknown media kind: ${kind}`);
  return config;
}

async function upload(kind, file, meta) {
  const { collection, prefix } = kindConfig(kind);
  const key = `${prefix}/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  const db = getDB();
  const doc = { ...meta, url: `${R2_PUBLIC_URL}/${key}`, key, uploadedAt: new Date() };
  const result = await db.collection(collection).insertOne(doc);

  return { id: result.insertedId, ...doc };
}

async function list(kind, filter) {
  const { collection } = kindConfig(kind);
  return getDB().collection(collection).find(filter).toArray();
}

async function remove(kind, id) {
  const { collection } = kindConfig(kind);
  const db = getDB();

  const doc = await db.collection(collection).findOne({ _id: new ObjectId(id) });
  if (!doc) return null;

  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.key }));
  await db.collection(collection).deleteOne({ _id: new ObjectId(id) });

  return doc;
}

module.exports = { upload, list, remove };
