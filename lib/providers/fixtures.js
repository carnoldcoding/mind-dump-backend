// Trimmed recordings of real provider responses — the fields the normalisers
// read, and enough of the surrounding shape to be representative. Trimmed
// rather than complete because a full RAWG game record is several hundred
// lines of things nothing here looks at.

// RAWG's per-game endpoint: carries developers and the long description.
const rawgGame = {
  id: 9767,
  name: 'Nioh',
  released: '2017-02-07',
  background_image: 'https://media.rawg.io/media/games/nioh.jpg',
  description_raw: 'A masocore action RPG set in feudal Japan.',
  genres: [{ id: 4, name: 'Action' }, { id: 5, name: 'RPG' }],
  developers: [{ id: 1, name: 'Team Ninja' }],
  platforms: [{ platform: { id: 187, name: 'PlayStation 5' } }],
};

// RAWG's search endpoint: the same game, thinner. No developers, no
// description — this is what a candidate list actually contains.
const rawgSearchResult = {
  id: 58753,
  name: 'Nioh 2',
  released: '2020-03-13',
  background_image: 'https://media.rawg.io/media/games/nioh2.jpg',
  genres: [{ id: 4, name: 'Action' }],
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

module.exports = { rawgGame, rawgSearchResult, tmdbFilm, openLibraryWork };
