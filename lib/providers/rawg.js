// Games, from RAWG.
//
// Split in two on purpose, the same way the Body migration is: `search` does
// the I/O and nothing else, `normalise` decides everything and touches
// nothing. Only the second half is worth testing, and it can be tested without
// a network.

const { toIsoDate, firstOf, cleanText } = require('./shape');

const ENDPOINT = 'https://api.rawg.io/api/games';

/**
 * Maps one RAWG game onto the fields a Review carries.
 *
 * RAWG's search results are thinner than its detail records — developers and
 * the long description only come back from the per-game endpoint. Whatever is
 * absent is simply absent here rather than guessed at.
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
    description: cleanText(game.description_raw),
    image: game.background_image || null,
  };
}

async function search(query, { apiKey = process.env.RAWG_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('RAWG_API_KEY is not set');

  const url = new URL(ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('search', query);
  url.searchParams.set('page_size', '8');

  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`RAWG search failed (${res.status})`);

  const body = await res.json();
  return (body.results || []).map(normalise).filter(Boolean);
}

module.exports = { search, normalise };
