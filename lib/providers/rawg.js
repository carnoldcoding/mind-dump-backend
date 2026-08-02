// Games, from RAWG.
//
// Split in three: `search` and `details` do the I/O and nothing else,
// `normalise` decides everything and touches nothing. Only the last is worth
// testing, and it can be tested without a network — the same division the Body
// migration uses, where the planner is pure and the script that runs it is not.

const { toIsoDate, firstOf, cleanText, timeout } = require('./shape');

const ENDPOINT = 'https://api.rawg.io/api/games';

/** Where RAWG's covers live. The cover copier will accept no other host. */
const COVER_HOSTS = ['media.rawg.io'];

/**
 * Maps one RAWG game onto the fields a Review carries.
 *
 * Works for both shapes RAWG returns: a search result, which is thin, and a
 * per-game record, which carries developers, platforms and the description.
 * Whatever is absent stays absent rather than being guessed at.
 */
function normalise(game) {
  if (!game || typeof game !== 'object') return null;

  return {
    sourceId: game.id != null ? String(game.id) : null,
    title: cleanText(game.name),
    release_date: toIsoDate(game.released),
    // A game's creator is its developer. One name, because a Review shows one.
    creator: firstOf((game.developers || []).map(d => d && d.name)),
    genres: (game.genres || []).map(g => g && g.name).filter(Boolean),
    platforms: (game.platforms || [])
      .map(p => p && p.platform && p.platform.name)
      .filter(Boolean),
    description: cleanText(game.description_raw),
    image: game.background_image || null,
  };
}

async function search(query) {
  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) throw new Error('RAWG_API_KEY is not set');

  const url = new URL(ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('search', query);
  url.searchParams.set('page_size', '8');

  const res = await fetch(url, { signal: timeout() });
  if (!res.ok) throw new Error(`RAWG search failed (${res.status})`);

  const body = await res.json();
  return (body.results || []).map(normalise).filter(Boolean);
}

/**
 * The full record for one game. RAWG's search results carry no developers,
 * no platforms and no description, so without this a captured game would
 * arrive with none of them — which is exactly what the search results being
 * thin is supposed to stop mattering.
 */
async function details(sourceId) {
  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) throw new Error('RAWG_API_KEY is not set');

  const url = new URL(`${ENDPOINT}/${encodeURIComponent(sourceId)}`);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url, { signal: timeout() });
  if (!res.ok) throw new Error(`RAWG lookup failed (${res.status})`);

  return normalise(await res.json());
}

module.exports = { search, details, normalise, COVER_HOSTS };
