// Games, from IGDB.
//
// Split the same three ways as the others: `search` and `details` do the I/O,
// `normalise` decides everything and touches nothing, and only the last is
// worth testing without a network.
//
// IGDB is a POST API with a query language in the body rather than a GET with
// parameters, and its credentials are Twitch's — see twitchAuth.js. Both are
// shape, not vocabulary: what comes back is still mapped onto a Review's
// fields here and nowhere else.

const { toIsoDate, firstOf, cleanText, timeout } = require('./shape');
const { appAccessToken, forgetToken } = require('./twitchAuth');

const ENDPOINT = 'https://api.igdb.com/v4/games';

// IGDB returns an image_id, not a URL; the host and a size are ours to choose.
// cover_big is 227x320 — the largest of the cover-shaped sizes, the rest being
// screenshot and logo aspect ratios that would letterbox a cover.
const COVER_BASE = 'https://images.igdb.com/igdb/image/upload/t_cover_big';

/** Where IGDB's covers live. The cover copier will accept no other host. */
const COVER_HOSTS = ['images.igdb.com'];

// What a candidate list needs to tell two games apart: the name, when it came
// out, the box art, and roughly what it is.
const SEARCH_FIELDS = 'name, first_release_date, cover.image_id, genres.name';

// Everything a captured Review is written from. Developers and platforms are
// the fields worth the second call.
const DETAIL_FIELDS = `${SEARCH_FIELDS}, platforms.name, summary, ` +
  'involved_companies.developer, involved_companies.company.name';

/**
 * Maps one IGDB game onto the fields a Review carries.
 *
 * Works for both shapes this module asks for: a search result, which carries
 * no developer, no platforms and no summary, and a detail record, which does.
 * Whatever is absent stays absent rather than being guessed at.
 */
function normalise(game) {
  if (!game || typeof game !== 'object') return null;

  return {
    sourceId: game.id != null ? String(game.id) : null,
    title: cleanText(game.name),
    release_date: releaseDate(game.first_release_date),
    // A game's creator is its developer. IGDB files companies by role rather
    // than in a `developers` list, so the publishers have to be dropped first.
    creator: developerOf(game),
    genres: (game.genres || []).map(g => g && g.name).filter(Boolean),
    // Named directly, not wrapped in another object the way genres' siblings
    // sometimes are — `platforms.name` expands to objects carrying `name`.
    platforms: (game.platforms || []).map(p => p && p.name).filter(Boolean),
    description: cleanText(game.summary),
    image: game.cover && game.cover.image_id
      ? `${COVER_BASE}/${game.cover.image_id}.jpg`
      : null,
  };
}

/**
 * IGDB dates are Unix timestamps in seconds.
 *
 * Its documentation says milliseconds and then gives 1538129354 as an example
 * of 28/09/2018, which is only true read as seconds — in milliseconds it is
 * three weeks into 1970. The example is the part that matches what the API
 * actually returns.
 */
function releaseDate(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;

  return toIsoDate(date.toISOString());
}

function developerOf(game) {
  const involved = game.involved_companies || [];
  return firstOf(
    involved
      .filter(entry => entry && entry.developer)
      .map(entry => entry.company && entry.company.name)
  );
}

/**
 * A string as APIcalypse will read it.
 *
 * Search terms are typed by a person and land inside a quoted string in a
 * query language, so the quote that would end that string early — and the
 * backslash that would smuggle one in — do not survive.
 */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * One APIcalypse query, with the token attached and one retry.
 *
 * The retry is for 401 alone: a token can be revoked or outlived by a rotated
 * secret before its expiry, and replaying the dead one would fail every lookup
 * until the process restarted.
 */
async function query(body, { label, retryOnUnauthorized = true } = {}) {
  const token = await appAccessToken();

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'text/plain',
    },
    body,
    signal: timeout(),
  });

  if (res.status === 401 && retryOnUnauthorized) {
    forgetToken();
    return query(body, { label, retryOnUnauthorized: false });
  }

  if (!res.ok) throw new Error(`IGDB ${label} failed (${res.status})`);

  return res.json();
}

async function search(term) {
  const body = `fields ${SEARCH_FIELDS}; search ${quote(term)}; limit 8;`;
  const results = await query(body, { label: 'search' });

  return (Array.isArray(results) ? results : []).map(normalise).filter(Boolean);
}

/**
 * The full record for one game. Search results carry no developer, no
 * platforms and no summary, so without this a captured game would arrive with
 * none of them — which is exactly what the search results being thin is
 * supposed to stop mattering.
 */
async function details(sourceId) {
  // Ids go into the query unquoted, where a stray character would be read as
  // syntax rather than as a value. Only digits are an IGDB id.
  const id = String(sourceId).trim();
  if (!/^\d+$/.test(id)) throw new Error(`IGDB lookup failed (bad id ${JSON.stringify(sourceId)})`);

  const body = `fields ${DETAIL_FIELDS}; where id = ${id}; limit 1;`;
  const results = await query(body, { label: 'lookup' });

  return Array.isArray(results) && results.length ? normalise(results[0]) : null;
}

// `quote` is exported for its test alone. It is the one impure-adjacent piece
// with a wrong answer that would not show up as a failed lookup — an escape
// that let a quote through would build a query that still ran.
module.exports = { search, details, normalise, quote, COVER_HOSTS };
