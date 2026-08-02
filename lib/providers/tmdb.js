// Cinema, from TMDB.

const { toIsoDate, firstOf, cleanText, timeout } = require('./shape');

const SEARCH = 'https://api.themoviedb.org/3/search/movie';
const FILM = 'https://api.themoviedb.org/3/movie';
// TMDB returns poster paths, not URLs; the host and a size are ours to choose.
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

/** Where TMDB's posters live. The cover copier will accept no other host. */
const COVER_HOSTS = ['image.tmdb.org'];

/**
 * Maps one TMDB film onto the fields a Review carries.
 *
 * Works for both shapes: a search result, which carries genre *ids* and no
 * credits, and a per-film record fetched with credits appended, which carries
 * genre names and a crew to find the director in. A search result therefore
 * has no creator and no genres — not because they are unknowable, but because
 * that response does not contain them.
 */
function normalise(film) {
  if (!film || typeof film !== 'object') return null;

  return {
    sourceId: film.id != null ? String(film.id) : null,
    title: cleanText(film.title) || cleanText(film.name),
    release_date: toIsoDate(film.release_date),
    // A film's creator is its director, which lives in the crew.
    creator: directorOf(film),
    genres: (film.genres || []).map(g => g && g.name).filter(Boolean),
    platforms: [],
    description: cleanText(film.overview),
    image: film.poster_path ? `${POSTER_BASE}${film.poster_path}` : null,
  };
}

function directorOf(film) {
  const crew = (film.credits && film.credits.crew) || [];
  return firstOf(crew.filter(member => member && member.job === 'Director').map(m => m.name));
}

async function search(query) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');

  const url = new URL(SEARCH);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);

  const res = await fetch(url, { signal: timeout() });
  if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);

  const body = await res.json();
  return (body.results || []).slice(0, 8).map(normalise).filter(Boolean);
}

/**
 * The full record for one film, with credits appended so the director comes
 * back in the same call rather than a second one.
 */
async function details(sourceId) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');

  const url = new URL(`${FILM}/${encodeURIComponent(sourceId)}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('append_to_response', 'credits');

  const res = await fetch(url, { signal: timeout() });
  if (!res.ok) throw new Error(`TMDB lookup failed (${res.status})`);

  return normalise(await res.json());
}

module.exports = { search, details, normalise, COVER_HOSTS };
