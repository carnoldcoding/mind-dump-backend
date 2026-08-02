// Which provider answers for which Category.
//
// A table rather than a conditional cascade, so a fourth Category is an entry
// here and a new module beside the others — nothing else changes.

const rawg = require('./rawg');
const tmdb = require('./tmdb');
const openLibrary = require('./openLibrary');

// Keyed by the singular `type` a Review carries, not the plural Category in a
// URL. See the frontend's CONTEXT.md.
const PROVIDERS = {
  game: rawg,
  cinema: tmdb,
  book: openLibrary,
};

/** The provider for a Review type, or null when there isn't one. */
function providerFor(type) {
  return PROVIDERS[type] || null;
}

function supportedTypes() {
  return Object.keys(PROVIDERS);
}

module.exports = { providerFor, supportedTypes };
