// Trimmed recordings of real provider responses — the fields the normalisers
// read, and enough of the surrounding shape to be representative. Trimmed
// rather than complete because a full IGDB game record is several hundred
// lines of things nothing here looks at.

// IGDB asked for the detail fields: carries the companies, the platforms and
// the summary. Dates are Unix seconds; 1486425600 is 2017-02-07.
const igdbGame = {
  id: 9767,
  name: 'Nioh',
  first_release_date: 1486425600,
  cover: { id: 55, image_id: 'co1r7f' },
  summary: 'A masocore action RPG set in feudal Japan.',
  genres: [{ id: 4, name: 'Action' }, { id: 5, name: 'RPG' }],
  platforms: [{ id: 167, name: 'PlayStation 5' }],
  // Filed by role, publishers included — the normaliser has to pick.
  involved_companies: [
    { id: 1, developer: false, publisher: true, company: { id: 90, name: 'Koei Tecmo' } },
    { id: 2, developer: true, publisher: false, company: { id: 91, name: 'Team Ninja' } },
  ],
};

// IGDB asked for the search fields: the same game, thinner. No companies, no
// platforms, no summary — this is what a candidate list actually contains.
const igdbSearchResult = {
  id: 58753,
  name: 'Nioh 2',
  first_release_date: 1583971200,
  cover: { id: 56, image_id: 'co250r' },
  genres: [{ id: 4, name: 'Action' }],
};

// TMDB's /movie/{id}?append_to_response=credits: genre names, and a crew to
// find the director in.
const tmdbFilmDetails = {
  id: 27205,
  title: 'Inception',
  release_date: '2010-07-15',
  poster_path: '/inception.jpg',
  overview: 'A thief who steals corporate secrets through dream-sharing technology.',
  genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }],
  credits: {
    crew: [
      { id: 1, job: 'Producer', name: 'Emma Thomas' },
      { id: 2, job: 'Director', name: 'Christopher Nolan' },
    ],
  },
};

// TMDB's /search/movie: genre_ids rather than names, and no credits.
const tmdbFilm = {
  id: 27205,
  title: 'Inception',
  release_date: '2010-07-15',
  poster_path: '/inception.jpg',
  overview: 'A thief who steals corporate secrets through dream-sharing technology.',
  genre_ids: [28, 878, 12],
};

// Open Library's /search.json: a year rather than a date, subjects rather than
// genres, and a numeric cover id.
const openLibraryWork = {
  key: '/works/OL27448W',
  title: 'The Hobbit',
  first_publish_year: 1937,
  author_name: ['J.R.R. Tolkien'],
  cover_i: 8231856,
  subject: ['Fantasy', 'Adventure', 'Middle Earth', 'Fiction', 'Dragons'],
};

module.exports = { igdbGame, igdbSearchResult, tmdbFilm, tmdbFilmDetails, openLibraryWork };
