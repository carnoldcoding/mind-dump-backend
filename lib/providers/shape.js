// The shape every provider maps onto, and the small conversions all three
// need. Kept here so a provider module is nothing but its own vocabulary
// translated into ours.
//
// The shape is deliberately the Review's own field names: whatever comes back
// can be written onto a Review without a second translation step.

/**
 * @typedef {Object} Candidate
 * @property {string|null} sourceId    The provider's own id, for reference.
 * @property {string} title
 * @property {string|null} release_date Canonical ISO, or a bare year when that
 *                                      is all the source knows.
 * @property {string|null} creator      Developer, director or author.
 * @property {string[]} genres          The provider's own words, unmapped.
 * @property {string[]} platforms       Games only; empty for everything else.
 * @property {string|null} description
 * @property {string|null} image        Remote cover URL, not yet ours.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^\d{4}$/;

/**
 * Normalises a provider's date to canonical ISO.
 *
 * A bare year is passed through as a year rather than padded to January 1st:
 * Open Library frequently knows only the year, and inventing a month and a day
 * would be inventing precision the source does not have.
 */
function toIsoDate(value) {
  if (value == null) return null;

  const text = String(value).trim();
  if (!text) return null;
  if (ISO.test(text)) return text;
  if (YEAR.test(text)) return text;

  // Anything else — a full timestamp, a localised string — is read only if it
  // parses unambiguously, and reduced to the date part.
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** The first non-empty string in a list, or null. */
function firstOf(values) {
  const found = (values || []).find(value => typeof value === 'string' && value.trim());
  return found ? found.trim() : null;
}

/** Trimmed text, or null — never an empty string sitting in a field. */
function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

// Every provider fetch gets one, so a slow provider reports rather than
// holding a request open until something else gives up.
const REQUEST_TIMEOUT_MS = 8000;

const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

module.exports = { toIsoDate, firstOf, cleanText, timeout, REQUEST_TIMEOUT_MS };
