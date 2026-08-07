// Only the pure halves are tested. The fetch halves are one call each with
// nothing a test would catch, and covering them would mean mocking HTTP for no
// return — the same division the Body migration uses, where the planner is
// pure and the script that runs it is left alone.
//
// Fixtures are trimmed recordings of real responses, committed alongside. A
// suite that called three third-party APIs would fail whenever someone else
// had an outage.

const igdb = require('./igdb');
const tmdb = require('./tmdb');
const openLibrary = require('./openLibrary');
const { providerFor, supportedTypes, coverHosts } = require('./index');
const { toIsoDate } = require('./shape');
const fixtures = require('./fixtures');

describe('IGDB (games)', () => {
  it('maps a game onto the fields a Review carries', () => {
    expect(igdb.normalise(fixtures.igdbGame)).toEqual({
      sourceId: '9767',
      title: 'Nioh',
      release_date: '2017-02-07',
      creator: 'Team Ninja',
      genres: ['Action', 'RPG'],
      platforms: ['PlayStation 5'],
      description: 'A masocore action RPG set in feudal Japan.',
      image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg',
    });
  });

  // A game's creator is its developer — the field the other two providers
  // spell entirely differently. IGDB files companies by role in one list, so
  // this is a filter rather than a lookup, and picking the wrong entry would
  // credit the publisher.
  it('reads the developer, not the publisher, as the creator', () => {
    expect(igdb.normalise(fixtures.igdbGame).creator).toBe('Team Ninja');
  });

  it('has no creator when every company is a publisher', () => {
    const publishersOnly = {
      ...fixtures.igdbGame,
      involved_companies: [{ developer: false, publisher: true, company: { name: 'Koei Tecmo' } }],
    };

    expect(igdb.normalise(publishersOnly).creator).toBeNull();
  });

  // IGDB sends seconds, and its own documentation calls them milliseconds.
  // Reading them the way the docs say would date every game to January 1970.
  it('reads a release date as Unix seconds', () => {
    expect(igdb.normalise(fixtures.igdbGame).release_date).toBe('2017-02-07');
    expect(igdb.normalise(fixtures.igdbSearchResult).release_date).toBe('2020-03-12');
  });

  it('has no release date when the game is unannounced', () => {
    expect(igdb.normalise({ id: 1, name: 'Untitled' }).release_date).toBeNull();
  });

  // IGDB returns an image_id, not a URL — the host and size are ours, and the
  // cover copier's allowlist only accepts what this builds.
  it('builds a cover URL from the image id', () => {
    expect(igdb.normalise(fixtures.igdbGame).image)
      .toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg');
  });

  it('has no image when the game has no cover', () => {
    expect(igdb.normalise({ id: 1, name: 'Untitled' }).image).toBeNull();
  });

  it('survives a search result that carries no developer or description', () => {
    const candidate = igdb.normalise(fixtures.igdbSearchResult);

    expect(candidate.title).toBe('Nioh 2');
    expect(candidate.creator).toBeNull();
    expect(candidate.description).toBeNull();
    expect(candidate.image)
      .toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/co250r.jpg');
  });

  // The detail record is what a captured game actually gets written from,
  // and it is the only shape carrying developers and platforms.
  it('reads platforms off a full record', () => {
    expect(igdb.normalise(fixtures.igdbGame).platforms).toEqual(['PlayStation 5']);
  });

  it('has no platforms on a thin search result', () => {
    expect(igdb.normalise(fixtures.igdbSearchResult).platforms).toEqual([]);
  });

  it('reads nothing at all as nothing', () => {
    expect(igdb.normalise(null)).toBeNull();
    expect(igdb.normalise('a string')).toBeNull();
  });

  // Both halves of the query are attacker-reachable: the id arrives as a URL
  // parameter and the search term is typed by a person, and both land in a
  // query language rather than in a parameter the transport keeps separate.

  // An id goes in unquoted, so anything but digits could be read as syntax.
  it('refuses to look up an id that is not one', async () => {
    await expect(igdb.details('1; where id = 2')).rejects.toThrow('bad id');
    await expect(igdb.details('')).rejects.toThrow('bad id');
  });

  // A term goes inside a quoted string, where an unescaped quote would end the
  // string early and leave the rest to be read as syntax.
  it('escapes what would end a quoted search term early', () => {
    expect(igdb.quote('nioh')).toBe('"nioh"');
    expect(igdb.quote('a "quoted" game')).toBe('"a \\"quoted\\" game"');
    expect(igdb.quote('trailing\\')).toBe('"trailing\\\\"');
    // The backslash is escaped before the quote, so this cannot come back out
    // as an escaped backslash followed by a live quote.
    expect(igdb.quote('\\"; where id = 2; //')).toBe('"\\\\\\"; where id = 2; //"');
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
    ['igdb', igdb],
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
    expect(providerFor('game')).toBe(igdb);
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
      'images.igdb.com',
    ]);
  });

  it('offers a second lookup only where search comes back thin', () => {
    expect(typeof providerFor('game').details).toBe('function');
    expect(typeof providerFor('cinema').details).toBe('function');
    // Open Library's search already returns everything a Review wants.
    expect(providerFor('book').details).toBeNull();
  });
});
