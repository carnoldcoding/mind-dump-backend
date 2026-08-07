// IGDB's credentials are Twitch's.
//
// Its own file because it is not vocabulary. The other two providers are pure
// translation — a key goes in a header, a response comes back — and igdb.js is
// meant to read like them. Token state is the one thing that cannot, so it
// lives here instead of putting a cache and a clock in the middle of a
// normaliser.
//
// IGDB does not take an API key. A Client ID and Client Secret are exchanged
// for an app access token which is then sent on every request, so a lookup
// costs two calls the first time and one thereafter.

const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';

// Tokens last around 60 days. Renewing a minute early costs one extra call
// every two months and removes the race where a token expires mid-flight.
const EXPIRY_MARGIN_MS = 60 * 1000;

// Process-local, which is the right scope for a single-process server: a
// restart re-fetches, and nothing else needs to see it. Somewhere shared would
// be worth having only if this ran as several processes, and it does not.
let cached = null;

/**
 * A valid app access token, from cache when there is one.
 *
 * Concurrent callers share one in-flight request rather than each starting
 * their own — Capture searches on every keystroke, and a cold cache would
 * otherwise mean several identical token calls at once.
 */
function appAccessToken() {
  if (cached && cached.expiresAt > Date.now()) return cached.pending;

  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId) throw new Error('IGDB_CLIENT_ID is not set');
  if (!clientSecret) throw new Error('IGDB_CLIENT_SECRET is not set');

  const pending = requestToken(clientId, clientSecret).catch(error => {
    // A failed exchange must not be remembered, or one outage would keep
    // answering from cache until the process restarts.
    cached = null;
    throw error;
  });

  // Held optimistically so simultaneous callers join this request. The real
  // expiry replaces it once the response says how long the token is good for.
  cached = { pending, expiresAt: Date.now() + EXPIRY_MARGIN_MS };
  return pending;
}

async function requestToken(clientId, clientSecret) {
  const url = new URL(TOKEN_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url, { method: 'POST' });
  // The body is not read into the error: it echoes the credentials back on
  // some failures, and this message reaches the logs.
  if (!res.ok) throw new Error(`Twitch token request failed (${res.status})`);

  const body = await res.json();
  if (!body.access_token) throw new Error('Twitch returned no access token');

  const lifetimeMs = Number(body.expires_in) * 1000;
  cached = {
    pending: Promise.resolve(body.access_token),
    expiresAt: Number.isFinite(lifetimeMs)
      ? Date.now() + Math.max(lifetimeMs - EXPIRY_MARGIN_MS, 0)
      : Date.now() + EXPIRY_MARGIN_MS,
  };

  return body.access_token;
}

/**
 * Forget the current token.
 *
 * A token can stop working before it expires — revoked from the Twitch console,
 * or invalidated when the secret is rotated. IGDB answers 401, and the caller
 * uses this to make the next attempt fetch a fresh one instead of replaying the
 * dead token until the cache times out.
 */
function forgetToken() {
  cached = null;
}

module.exports = { appAccessToken, forgetToken };
