// Looking a Review up before it exists.
//
// Three endpoints, kept apart deliberately: searching costs nothing and
// happens on every keystroke; fetching a full record costs one call and
// happens for the one candidate chosen; storing a cover costs a fetch and a
// write and happens once.

const { providerFor, supportedTypes, coverHosts } = require('../lib/providers');
const mediaStore = require('../lib/mediaStore');
const { REQUEST_TIMEOUT_MS } = require('../lib/providers/shape');

// A cover is an image. Anything much larger than this is not one, and is not
// worth copying onto our own storage.
const MAX_COVER_BYTES = 10 * 1024 * 1024;

function unknownType(res, type) {
  return res.status(400).json({
    message: `Unknown type: ${JSON.stringify(type)}. Expected one of ${supportedTypes().join(', ')}`,
  });
}

async function searchMetadata(req, res) {
  const { type, q } = req.query;

  const provider = providerFor(type);
  if (!provider) return unknownType(res, type);

  if (!q || !String(q).trim()) {
    return res.status(400).json({ message: 'A query is required' });
  }

  try {
    const results = await provider.search(String(q).trim());
    return res.status(200).json({ results });
  } catch (error) {
    // A failed lookup and an empty one are different facts, and the caller has
    // to tell them apart: reporting "no matches" for a provider outage would
    // answer "is this already in there?" wrongly.
    console.error('Metadata search error:', error);
    return res.status(502).json({ message: 'Lookup failed' });
  }
}

/**
 * The full record for one candidate.
 *
 * RAWG's and TMDB's search results are thin — no developers, no platforms, no
 * director, no genre names — so without this a captured Review would arrive
 * missing most of what the lookup exists to supply.
 */
async function metadataDetails(req, res) {
  const { type, id } = req.query;

  const provider = providerFor(type);
  if (!provider) return unknownType(res, type);

  if (!id || !String(id).trim()) {
    return res.status(400).json({ message: 'An id is required' });
  }

  // Open Library's search already returns everything; there is nothing more
  // to ask it for, and saying so is better than a call that adds nothing.
  if (!provider.details) {
    return res.status(200).json({ result: null });
  }

  try {
    return res.status(200).json({ result: await provider.details(String(id).trim()) });
  } catch (error) {
    console.error('Metadata details error:', error);
    return res.status(502).json({ message: 'Lookup failed' });
  }
}

/**
 * Copies a provider's cover onto our own storage and hands back our URL.
 *
 * Separate from search so browsing candidates stores nothing, and so a caller
 * whose copy fails can still write the Review it just chose.
 */
async function storeCover(req, res) {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ message: 'A cover url is required' });
  }

  if (!isAllowedCover(url)) {
    return res.status(400).json({ message: 'That is not a cover host we fetch from' });
  }

  let image;
  try {
    image = await fetchCover(url);
  } catch (error) {
    console.error('Cover fetch error:', error);
    return res.status(502).json({ message: 'Could not fetch that cover' });
  }

  try {
    const stored = await mediaStore.upload('cover', {
      // The shape mediaStore already takes from multer, synthesised here
      // because this file came off the wire rather than off a form.
      originalname: coverFilename(url, image.contentType),
      buffer: image.buffer,
      mimetype: image.contentType,
    }, { type: 'cover', source: url });

    return res.status(200).json({ url: stored.url });
  } catch (error) {
    // Our storage failing is our problem, not the provider's — saying 502
    // here would blame them for our outage.
    console.error('Cover store error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * Covers only ever come from the three hosts our providers point at, so this
 * fetches from those and nothing else.
 *
 * Without it, anything that can reach this endpoint can make the *server*
 * fetch a URL of its choosing — the database on loopback, a cloud metadata
 * address, another host on the tailnet. Being gated to the tailnet limits who
 * can ask; it does nothing about what the server would then go and do.
 */
function isAllowedCover(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && coverHosts().includes(url.hostname);
  } catch {
    return false;
  }
}

async function fetchCover(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`cover fetch failed (${response.status})`);

  // A redirect can land somewhere the original host check never saw.
  if (!isAllowedCover(response.url)) {
    throw new Error(`cover redirected off-host to ${response.url}`);
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) {
    throw new Error(`cover is not an image (${contentType || 'no content-type'})`);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) {
    throw new Error(`cover is too large (${declared} bytes)`);
  }

  return { buffer: await readCapped(response), contentType };
}

/**
 * Reads the body with a running total, so an oversized or undeclared response
 * is abandoned mid-stream. Checking the length after buffering the whole thing
 * would mean the allocation had already happened, which is the part worth
 * avoiding.
 */
async function readCapped(response) {
  const chunks = [];
  let total = 0;

  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_COVER_BYTES) throw new Error('cover is too large');
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/** A filename derived from the remote path's last segment, plus an extension. */
function coverFilename(url, contentType) {
  const extension = (contentType.split('/')[1] || 'jpg');
  let stem = 'cover';
  try {
    stem = new URL(url).pathname.split('/').filter(Boolean).pop() || 'cover';
  } catch { /* keep the default */ }

  return stem.includes('.') ? stem : `${stem}.${extension}`;
}

// isAllowedCover is exported for its own tests: it is the whole of the
// server-side request forgery defence, and worth asserting on directly.
module.exports = { searchMetadata, metadataDetails, storeCover, isAllowedCover };
