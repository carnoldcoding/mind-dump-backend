// Books, from Open Library. The only one of the three needing no credentials.

const { toIsoDate, firstOf, cleanText } = require('./shape');

const ENDPOINT = 'https://openlibrary.org/search.json';
const COVER_BASE = 'https://covers.openlibrary.org/b/id';

/**
 * Maps one Open Library work onto the fields a Review carries.
 *
 * Open Library usually knows only a year of first publication, so a book's
 * release date is often a bare year. That is deliberate — see toIsoDate.
 */
function normalise(work) {
  if (!work || typeof work !== 'object') return null;

  return {
    // Work keys look like "/works/OL27448W"; the leading path is noise.
    sourceId: work.key ? String(work.key).replace(/^\/works\//, '') : null,
    title: cleanText(work.title),
    release_date: toIsoDate(work.first_publish_year),
    // A book's creator is its author.
    creator: firstOf(work.author_name),
    // Open Library subjects are long and unranked; the first few are the only
    // ones that read as genres.
    genres: (work.subject || []).slice(0, 3).filter(Boolean),
    // Deliberately none. The nearest thing Open Library offers is
    // `first_sentence`, which is an arbitrary edition's opening line and comes
    // back in whatever language that edition was — a live search for The
    // Hobbit returns the German one. A description you have to delete is worse
    // than a description you have to write.
    description: null,
    image: work.cover_i ? `${COVER_BASE}/${work.cover_i}-L.jpg` : null,
  };
}

async function search(query, { fetchImpl = fetch } = {}) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '8');
  // Open Library's default response omits subjects and first sentences
  // entirely; without naming the fields, genres and description come back
  // empty on every result. Verified against the live endpoint.
  url.searchParams.set(
    'fields',
    'key,title,first_publish_year,author_name,cover_i,subject',
  );

  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Open Library search failed (${res.status})`);

  const body = await res.json();
  return (body.docs || []).map(normalise).filter(Boolean);
}

module.exports = { search, normalise };
