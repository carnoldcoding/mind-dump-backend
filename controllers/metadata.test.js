// The cover copier makes the *server* fetch a URL a caller supplied, so the
// host check is the whole of the defence and gets its own tests. Being gated
// to the tailnet limits who can ask; it says nothing about where the server
// would then go.

const { isAllowedCover } = require('./metadata');

describe('which covers we will fetch', () => {
  it.each([
    'https://media.rawg.io/media/games/nioh.jpg',
    'https://image.tmdb.org/t/p/w500/inception.jpg',
    'https://covers.openlibrary.org/b/id/8231856-L.jpg',
  ])('fetches from %s', url => {
    expect(isAllowedCover(url)).toBe(true);
  });

  // The reason the allowlist exists: every one of these is somewhere the
  // server can reach and a caller cannot.
  it.each([
    ['loopback', 'http://127.0.0.1:27017/'],
    ['loopback by name', 'http://localhost/admin'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['a LAN host', 'http://192.168.1.10/'],
    ['another tailnet host', 'https://webserver.tail75a2e4.ts.net/api/posts'],
    ['somewhere else entirely', 'https://example.com/cover.jpg'],
  ])('refuses %s', (_name, url) => {
    expect(isAllowedCover(url)).toBe(false);
  });

  it('refuses plain http even on a host we do fetch from', () => {
    expect(isAllowedCover('http://media.rawg.io/media/games/nioh.jpg')).toBe(false);
  });

  // A hostname ending in an allowed one is not an allowed one.
  it('refuses a lookalike host', () => {
    expect(isAllowedCover('https://media.rawg.io.evil.test/x.jpg')).toBe(false);
    expect(isAllowedCover('https://notmedia.rawg.io/x.jpg')).toBe(false);
  });

  it('refuses anything that is not a url', () => {
    expect(isAllowedCover('not a url')).toBe(false);
    expect(isAllowedCover('')).toBe(false);
    expect(isAllowedCover('file:///etc/passwd')).toBe(false);
  });
});
