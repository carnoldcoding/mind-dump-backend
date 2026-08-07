// Only the pure half is tested, the same division the providers use: the
// deleting is one mediaStore call per kind, and covering it would mean a
// database and a bucket for no return. What a Review *owns* is the part with
// a wrong answer, and a wrong answer here is silent — either files left in
// the bucket with nothing able to see them, or another Review's cover taken
// down with this one.

const { mediaFilters } = require('./posts');

const review = (overrides = {}) => ({
  _id: '6a09c9a11cd5165b9ad3a31f',
  slug: 'nioh',
  ...overrides,
});

const filterFor = (kind, ...args) =>
  Object.fromEntries(mediaFilters(...args))[kind];

describe('what a Review owns', () => {
  it('claims every kind of media', () => {
    expect(mediaFilters(review()).map(([kind]) => kind))
      .toEqual(['image', 'audio', 'cover']);
  });

  // Screenshots and audio were uploaded against an existing Review, so both
  // carry the id and neither needs anything cleverer.
  it('finds screenshots and audio by the Review they were uploaded to', () => {
    expect(filterFor('image', review())).toEqual({ post_id: '6a09c9a11cd5165b9ad3a31f' });
    expect(filterFor('audio', review())).toEqual({ post_id: '6a09c9a11cd5165b9ad3a31f' });
  });

  // The id is a Mongo ObjectId on a real document and a string on a media
  // row, so comparing them unconverted would match nothing and quietly leave
  // every file behind.
  it('compares ids as strings', () => {
    const objectIdish = { toString: () => '6a09c9a11cd5165b9ad3a31f' };

    expect(filterFor('image', review({ _id: objectIdish })))
      .toEqual({ post_id: '6a09c9a11cd5165b9ad3a31f' });
  });
});

describe('finding the cover', () => {
  // Two routes, because a cover can be stored either before its Review exists
  // (Capture, no post_id) or after (the backfill, which has one).
  it('looks for a cover by owner and by url', () => {
    expect(filterFor('cover', review({ image_path: 'https://s3.example/covers/1-nioh.jpg' })))
      .toEqual({
        $or: [
          { post_id: '6a09c9a11cd5165b9ad3a31f' },
          { url: 'https://s3.example/covers/1-nioh.jpg' },
        ],
      });
  });

  it('looks only by owner when the Review has no cover', () => {
    expect(filterFor('cover', review()))
      .toEqual({ post_id: '6a09c9a11cd5165b9ad3a31f' });
  });

  // The url is what makes a cover reachable without an owner, and it is also
  // the one thing another Review could be pointing at. Deleting this Review
  // must not blank that one's artwork, so a shared cover is left alone and
  // only a row explicitly owned by this Review is taken.
  it('will not take a cover another Review is also using', () => {
    const shared = review({ image_path: 'https://s3.example/covers/1-shared.jpg' });

    expect(filterFor('cover', shared, { coverSharedWithOthers: true }))
      .toEqual({ post_id: '6a09c9a11cd5165b9ad3a31f' });
  });

  // A Review still pointing at someone else's server has no cover of ours to
  // remove. The filter is harmless — it simply matches nothing.
  it('is unbothered by a Review still hotlinking its cover', () => {
    expect(filterFor('cover', review({ image_path: 'https://cdn.mobygames.com/nioh.jpg' })))
      .toEqual({
        $or: [
          { post_id: '6a09c9a11cd5165b9ad3a31f' },
          { url: 'https://cdn.mobygames.com/nioh.jpg' },
        ],
      });
  });
});
