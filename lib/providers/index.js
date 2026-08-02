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

/**
 * Every host a cover can legitimately come from, collected from the providers
 * themselves so the allowlist cannot drift from where the URLs are built.
 */
function coverHosts() {
  return Object.values(PROVIDERS).flatMap(provider => provider.COVER_HOSTS || []);
}

module.exports = { providerFor, supportedTypes, coverHosts };
