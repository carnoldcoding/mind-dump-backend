// Looking a Review up before it exists.
//
// Two endpoints, kept apart deliberately: searching costs nothing and happens
// on every keystroke, while storing a cover costs a fetch and a write and
// happens once, for the one candidate actually chosen.

const { providerFor, supportedTypes } = require('../lib/providers');
const mediaStore = require('../lib/mediaStore');

// A cover is an image from somewhere we do not control. Anything much larger
// than this is not a cover, and is not worth copying onto our own storage.
const MAX_COVER_BYTES = 10 * 1024 * 1024;

async function searchMetadata(req, res) {
  const { type, q } = req.query;

  const provider = providerFor(type);
  if (!provider) {
    return res.status(400).json({
      message: `Unknown type: ${JSON.stringify(type)}. Expected one of ${supportedTypes().join(', ')}`,
    });
  }

  if (!q || !String(q).trim()) {
    return res.status(400).json({ message: 'A query is required' });
  }

  try {
    const results = await provider.search(String(q).trim());
    return res.status(200).json({ results });
  } catch (error) {
    // A failed lookup and an empty one are different facts, and the caller
    // has to be able to tell them apart: reporting "no matches" for a
    // provider outage would answer "is this already in there?" wrongly.
    console.error('Metadata search error:', error);
    return res.status(502).json({ message: 'Lookup failed' });
  }
}

/**
 * Copies a provider's cover onto our own storage and hands back our URL.
 *
 * Separate from search so that browsing candidates stores nothing, and so a
 * caller whose copy fails can still write the Review it just chose.
 */
async function storeCover(req, res) {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ message: 'A cover url is required' });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`cover fetch failed (${response.status})`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`cover is not an image (${contentType || 'no content-type'})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_COVER_BYTES) {
      throw new Error(`cover is too large (${buffer.byteLength} bytes)`);
    }

    const stored = await mediaStore.upload('cover', {
      // The shape mediaStore already takes from multer, synthesised here
      // because this file came off the wire rather than off a form.
      originalname: coverFilename(url, contentType),
      buffer,
      mimetype: contentType,
    }, { source: url });

    return res.status(200).json({ url: stored.url });
  } catch (error) {
    console.error('Cover copy error:', error);
    return res.status(502).json({ message: 'Could not copy that cover' });
  }
}

/** A filename that says where it came from, without trusting the remote path. */
function coverFilename(url, contentType) {
  const extension = (contentType.split('/')[1] || 'jpg').split(';')[0];
  const stem = (() => {
    try {
      return new URL(url).pathname.split('/').filter(Boolean).pop() || 'cover';
    } catch {
      return 'cover';
    }
  })();
  return stem.includes('.') ? stem : `${stem}.${extension}`;
}

module.exports = { searchMetadata, storeCover };
