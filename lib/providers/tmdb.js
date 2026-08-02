// Cinema, from TMDB.

const { toIsoDate, cleanText } = require('./shape');

const ENDPOINT = 'https://api.themoviedb.org/3/search/movie';
// TMDB returns poster paths, not URLs; the host and a size are ours to choose.
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

/**
 * Maps one TMDB film onto the fields a Review carries.
 *
 * Two things TMDB's search does not return: the director, which needs a
 * credits call, and genre names, which come back as ids needing a separate
 * genre list. Both are left absent rather than half-filled — a Review with no
 * creator is honest, and a Review with a numeric genre is not.
 */
function normalise(film) {
  if (!film || typeof film !== 'object') return null;

  return {
    sourceId: film.id != null ? String(film.id) : null,
    title: cleanText(film.title) || cleanText(film.name),
    release_date: toIsoDate(film.release_date),
    // Present only when a caller has already resolved credits.
    creator: cleanText(film.director),
    genres: (film.genres || []).map(g => g && g.name).filter(Boolean),
    description: cleanText(film.overview),
    image: film.poster_path ? `${POSTER_BASE}${film.poster_path}` : null,
  };
}

async function search(query, { apiKey = process.env.TMDB_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');

  const url = new URL(ENDPOINT);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);

  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);

  const body = await res.json();
  return (body.results || []).slice(0, 8).map(normalise).filter(Boolean);
}

module.exports = { search, normalise };
