# Mind Dump (Backend)

The API behind [`mind-dump`](https://github.com/carnoldcoding/mind-dump). Express 5 on
Node 24, MongoDB Atlas, Cloudflare R2 for media. Vitest for tests, deliberately
thin: the pure halves are covered and the I/O halves are not.

Read these before making non-trivial changes:

- [`docs/branching.md`](./docs/branching.md) — the git workflow, in full:
  branches, releases, hotfixes, versioning, and what an agent may merge. The
  same model governs the frontend repo.
- [`docs/deployment.md`](./docs/deployment.md) — how a release reaches the
  server, what `deploy.sh` does, what is in `.env`, and what is not automated.

The frontend's `CONTEXT.md` is the domain glossary for both repos — Review,
Status, Category, Critique, Mod. Use those terms; this repo has no glossary of
its own and should not grow a second one.

## Commands

- `npm run dev` — the server, on `PORT` or 5000
- `npm test` — Vitest

`node` is not on `PATH` in a non-login shell on this machine; it lives at
`~/.nvm/versions/node/v24.14.0/bin`.

## CI

Pull requests into `dev` and `main` run `npm ci`, the tests, and a step that
requires every route and controller — a cheap check that the wiring still
loads, which no unit test covers.

## Things that will surprise you

- **Production is a separate checkout.** `~/apps/mind-dump-api`, not this
  directory. Running production out of the working tree meant any `git
  checkout` swapped its source files underneath it; the systemd unit's comment
  records why that changed.
- **Deploys install a tag, never a branch**, and nothing deploys on merge.
  `deploy.sh` runs on the box, by hand.
- **Providers are a table, not a cascade.** `lib/providers/index.js` maps a
  Review's Category to its source — IGDB for games, TMDB for cinema, Open
  Library for books. A fourth Category is an entry there and a module beside
  the others.
- **IGDB authenticates through Twitch**, not with an API key. A Client ID and
  Secret are exchanged for an access token that `twitchAuth.js` caches; its
  dates are Unix **seconds**, whatever IGDB's own documentation says.
- **Only the pure halves are tested.** Normalisers, the transition rule, the
  cover allowlist. Fetching and writing are one call each and are left alone —
  see the comment at the top of `lib/providers/providers.test.js`.
- **Deleting a Review takes its media with it.** `mediaStore.removeWhere` runs
  the object-then-record sequence that keeps R2 and Mongo in step; a bulk
  delete beside a loop of R2 deletes would quietly stop honouring it.
- **There is no `version` in `package.json`.** The tag is the version — see
  `docs/branching.md`.
