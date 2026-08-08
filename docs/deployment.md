# Deployment

The API runs under systemd on the home server, behind nginx. There is no
container in production and no CI/CD pipeline that reaches the machine: the box
pulls, and a person decides when.

```
  internet ──► nginx :443  ──►  127.0.0.1:3000  ──►  mind_dump_api.service
              api.syntheticsoul.me                    node server.js
                                                      ~/apps/mind-dump-api
```

Gated routes are a second nginx site restricted to the tailnet — see
[ADR-0001](../../mind-dump/docs/adr/0001-tailnet-gated-system-access.md) in the
frontend repo. The application itself has no auth; the boundary is nginx.

## Why not Docker

Considered and declined. The two problems worth solving were an unpinned Node
version and production running out of the development checkout, and both are
fixed by the unit file in `deploy/` at a fraction of the cost. Docker's real
benefit here would be dev/prod parity, and pinning gets most of that.

Worth revisiting when there is a second service, a second machine, or a reason
the runtime has to be reproducible somewhere other than this box.

## Layout

Production is its **own checkout**, separate from wherever development happens:

```
~/apps/mind-dump-api      production — detached at a version tag
~/repos/…/mind-dump-backend   development — branches, work in progress
```

They must stay separate. Production previously ran out of the development tree,
which meant `git checkout` silently changed production's source files; nothing
broke only because Node had already loaded them, and a restart at the wrong
moment would have started whatever branch was checked out.

## First-time setup

```bash
git clone git@github.com:carnoldcoding/mind-dump-backend.git ~/apps/mind-dump-api
cd ~/apps/mind-dump-api
cp ~/repos/mind-dump-fullstack/mind-dump-backend/.env .env   # never tracked
npm ci --omit=dev

sudo cp deploy/mind_dump_api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart mind_dump_api
```

`deploy.sh` restarts the service, which needs root. To avoid a password prompt
mid-deploy, allow that one command:

```
# /etc/sudoers.d/mind-dump-api   (edit with visudo)
logia ALL=(root) NOPASSWD: /bin/systemctl restart mind_dump_api
```

## Deploying

```bash
cd ~/apps/mind-dump-api
./deploy.sh            # latest version tag
./deploy.sh v0.0.1     # a specific one
```

It fetches tags, checks the version out detached, installs production
dependencies, restarts, and then polls `/api/system/probe` for 30 seconds. A
version that cannot be installed, or that does not answer once restarted, is
put back the way it was and restarted again — so a bad deploy reverts itself
rather than leaving the API down, or leaving the checkout on a version whose
dependencies were never installed.

Rolling back deliberately is the same command with an older tag.

`npm` is resolved through `NODE_BIN`, which defaults to the directory holding
the node the systemd unit runs. Neither is left to `PATH`: nvm exports it from
a shell rc, so whether `npm` is found at all depends on which shell the deploy
happens to run from. Point `NODE_BIN` elsewhere when the runtime moves, and
expect to change the unit's `ExecStart` at the same time.

The probe only proves the server is answering. It says nothing about the
metadata providers, so a release that is missing `IGDB_CLIENT_ID`,
`IGDB_CLIENT_SECRET` or `TMDB_API_KEY` deploys green and fails only when
something asks for a lookup. Check one by hand after a release that touches
them:

```bash
curl -s 'localhost:3000/api/metadata/search?type=game&q=nioh'
```

## Environment

`.env` lives only on the box and is never committed. `.env.example` lists every
variable the server expects. `deploy.sh` refuses to run without it, because a
server that starts with no database looks like a code fault rather than a
missing file.

The metadata lookup needs `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` and
`TMDB_API_KEY`; without them `/api/metadata/*` answers 502 and Capture falls
back to recording titles.

IGDB is the one provider whose credentials are not a key. They are a Twitch
application's, exchanged for an access token the server caches in memory and
renews about every sixty days — so a restart costs one extra call and nothing
needs rotating on a schedule. Rotating the secret deliberately does not need a
restart either: the running server is refused once, drops the dead token and
fetches another.

## What is not automated

- **Nothing deploys on merge.** Releases are deliberate; `main` is release-only,
  and a deploy installs a tag rather than a branch. How a change reaches `main`
  in the first place is [`branching.md`](./branching.md).
- **CI does not reach this machine.** It runs tests on pull requests and stops
  there.
- **The frontend is not served from this box** — nginx here has only the two API
  sites. A release of the API is not a release of the site.
