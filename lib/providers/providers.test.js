// Only the pure halves are tested. The fetch halves are one call each with
// nothing a test would catch, and covering them would mean mocking HTTP for no
// return — the same division the Body migration uses, where the planner is
// pure and the script that runs it is left alone.
//
// Fixtures are trimmed recordings of real responses, committed alongside. A
// suite that called three third-party APIs would fail whenever someone else
// had an outage.

const rawg = require('./rawg');
const tmdb = require('./tmdb');
const openLibrary = require('./openLibrary');
const { providerFor, supportedTypes, coverHosts } = require('./index');
const { toIsoDate } = require('./shape');
const fixtures = require('./fixtures');

describe('RAWG (games)', () => {
  it('maps a game onto the fields a Review carries', () => {
    expect(rawg.normalise(fixtures.rawgGame)).toEqual({
      sourceId: '9767',
      title: 'Nioh',
      release_date: '2017-02-07',
      creator: 'Team Ninja',
      genres: ['Action', 'RPG'],
      platforms: ['PlayStation 5'],
      description: 'A masocore action RPG set in feudal Japan.',
      image: 'https://media.rawg.io/media/games/nioh.jpg',
    });
  });

  // A game's creator is its developer — the field the other two providers
  // spell entirely differently.
  it('reads the developer as the creator', () => {
    expect(rawg.normalise(fixtures.rawgGame).creator).toBe('Team Ninja');
  });

  it('survives a search result that carries no developer or description', () => {
    const candidate = rawg.normalise(fixtures.rawgSearchResult);

    expect(candidate.title).toBe('Nioh 2');
    expect(candidate.creator).toBeNull();
    expect(candidate.description).toBeNull();
    expect(candidate.image).toBe('https://media.rawg.io/media/games/nioh2.jpg');
  });

  // The detail record is what a captured game actually gets written from,
  // and it is the only shape carrying developers and platforms.
  it('reads platforms off a full record', () => {
    expect(rawg.normalise(fixtures.rawgGame).platforms).toEqual(['PlayStation 5']);
  });

  it('has no platforms on a thin search result', () => {
    expect(rawg.normalise(fixtures.rawgSearchResult).platforms).toEqual([]);
  });

  it('reads nothing at all as nothing', () => {
    expect(rawg.normalise(null)).toBeNull();
    expect(rawg.normalise('a string')).toBeNull();
  });
});

describe('TMDB (cinema)', () => {
  it('maps a film onto the fields a Review carries', () => {
    const candidate = tmdb.normalise(fixtures.tmdbFilm);

    expect(candidate.title).toBe('Inception');
    expect(candidate.release_date).toBe('2010-07-15');
    expect(candidate.description).toContain('dream');
    expect(candidate.sourceId).toBe('27205');
  });

  // TMDB returns a path, not a URL; the host and size are ours to pick.
  it('builds a full poster URL from the path', () => {
    expect(tmdb.normalise(fixtures.tmdbFilm).image)
      .toBe('https://image.tmdb.org/t/p/w500/inception.jpg');
  });

  it('has no image when TMDB has no poster', () => {
    expect(tmdb.normalise({ ...fixtures.tmdbFilm, poster_path: null }).image).toBeNull();
  });

  // Search returns genre ids and no credits, so both are absent rather than
  // filled with a number or a guess. This is why a chosen film is fetched
  // again rather than written straight from its search result.
  it('leaves the creator and genres out when search did not carry them', () => {
    const candidate = tmdb.normalise(fixtures.tmdbFilm);

    expect(candidate.creator).toBeNull();
    expect(candidate.genres).toEqual([]);
  });

  // A film's creator is its director, which lives in the crew among everyone
  // else who worked on it.
  it('finds the director in the crew of a full record', () => {
    expect(tmdb.normalise(fixtures.tmdbFilmDetails).creator).toBe('Christopher Nolan');
  });

  it('reads genre names off a full record', () => {
    expect(tmdb.normalise(fixtures.tmdbFilmDetails).genres)
      .toEqual(['Action', 'Science Fiction']);
  });

  it('has no creator when the crew has no director', () => {
    const noDirector = {
      ...fixtures.tmdbFilmDetails,
      credits: { crew: [{ job: 'Producer', name: 'Emma Thomas' }] },
    };

    expect(tmdb.normalise(noDirector).creator).toBeNull();
  });
});

describe('Open Library (books)', () => {
  it('maps a work onto the fields a Review carries', () => {
    const candidate = openLibrary.normalise(fixtures.openLibraryWork);

    expect(candidate.title).toBe('The Hobbit');
    expect(candidate.creator).toBe('J.R.R. Tolkien');
    expect(candidate.sourceId).toBe('OL27448W');
  });

  // Open Library usually knows only the year, and padding it to January 1st
  // would invent precision the source does not have.
  it('keeps a year-only publication date as a year', () => {
    expect(openLibrary.normalise(fixtures.openLibraryWork).release_date).toBe('1937');
  });

  it('builds a cover URL from the cover id', () => {
    expect(openLibrary.normalise(fixtures.openLibraryWork).image)
      .toBe('https://covers.openlibrary.org/b/id/8231856-L.jpg');
  });

  it('has no image when the work has no cover', () => {
    expect(openLibrary.normalise({ ...fixtures.openLibraryWork, cover_i: undefined }).image)
      .toBeNull();
  });

  it('takes only the first few subjects as genres', () => {
    expect(openLibrary.normalise(fixtures.openLibraryWork).genres).toHaveLength(3);
  });

  // Open Library's nearest thing to a description is an arbitrary edition's
  // opening line, in whatever language that edition was.
  it('carries no description rather than one in the wrong language', () => {
    expect(openLibrary.normalise(fixtures.openLibraryWork).description).toBeNull();
  });
});

describe('a candidate with nothing in it', () => {
  // Every provider must survive a sparse record: absent fields, never
  // undefined keys or thrown errors.
  it.each([
    ['rawg', rawg],
    ['tmdb', tmdb],
    ['openLibrary', openLibrary],
  ])('%s normalises an almost-empty record without throwing', (_name, provider) => {
    const candidate = provider.normalise({});

    expect(candidate.title).toBeNull();
    expect(candidate.release_date).toBeNull();
    expect(candidate.creator).toBeNull();
    expect(candidate.genres).toEqual([]);
    expect(candidate.image).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('passes a canonical date through', () => {
    expect(toIsoDate('2017-02-07')).toBe('2017-02-07');
  });

  it('keeps a bare year as a year', () => {
    expect(toIsoDate(1937)).toBe('1937');
  });

  it('reduces a full timestamp to its date', () => {
    expect(toIsoDate('2017-02-07T00:00:00.000Z')).toBe('2017-02-07');
  });

  it('reads nothing as nothing', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('   ')).toBeNull();
  });

  it('refuses text that is not a date', () => {
    expect(toIsoDate('sometime in the eighties')).toBeNull();
  });
});

describe('choosing a provider', () => {
  it('answers for every Category a Review can be', () => {
    expect(supportedTypes().sort()).toEqual(['book', 'cinema', 'game']);
    expect(providerFor('game')).toBe(rawg);
    expect(providerFor('cinema')).toBe(tmdb);
    expect(providerFor('book')).toBe(openLibrary);
  });

  // A clear absence rather than a silent fall-through to whichever provider
  // happened to be first.
  it('has no provider for a type it does not know', () => {
    expect(providerFor('journal')).toBeNull();
    expect(providerFor(undefined)).toBeNull();
  });

  // The cover copier fetches a URL the caller supplies, so the set of hosts it
  // will fetch from has to come from the providers themselves rather than be
  // maintained beside them and drift.
  it('collects a cover host from every provider', () => {
    expect(coverHosts().sort()).toEqual([
      'covers.openlibrary.org',
      'image.tmdb.org',
      'media.rawg.io',
    ]);
  });

  it('offers a second lookup only where search comes back thin', () => {
    expect(typeof providerFor('game').details).toBe('function');
    expect(typeof providerFor('cinema').details).toBe('function');
    // Open Library's search already returns everything a Review wants.
    expect(providerFor('book').details).toBeNull();
  });
});
