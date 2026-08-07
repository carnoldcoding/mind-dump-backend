#!/usr/bin/env bash
#
# Deploys a released version of the API.
#
#   ./deploy.sh              # latest version tag
#   ./deploy.sh v0.0.1       # a specific one
#
# Pull-only by design: nothing outside this machine holds a credential to it,
# and nothing restarts the API unless a person asks. `main` is release-only, so
# anything tagged there has already been verified on a release branch — see
# the frontend repo's docs/branching.md.
#
# If a version cannot be installed, or does not answer after restarting, this
# puts the previous one back and restarts again — so a bad deploy self-reverts
# rather than leaving the API down, or leaving the checkout on a version that
# was never installed.

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/mind-dump-api}"
SERVICE="mind_dump_api"
HEALTH_URL="http://localhost:3000/api/system/probe"
HEALTH_TIMEOUT=30

# Named absolutely for the same reason the systemd unit names node absolutely:
# nvm puts npm on PATH from a shell rc, so whether `npm` resolves — and to
# which version — depends on the shell a person happens to deploy from. It is
# not something to find out half-way through a release.
NODE_BIN="${NODE_BIN:-$HOME/.nvm/versions/node/v24.14.0/bin}"
NPM="$NODE_BIN/npm"

say() { printf '\n▸ %s\n' "$1"; }
die() { printf '\n✗ %s\n\n' "$1" >&2; exit 1; }

[[ -d "$APP_DIR/.git" ]] || die "no checkout at $APP_DIR — see docs/deployment.md"
cd "$APP_DIR"

# Refusing to start is better than starting a server with no database: without
# this the API comes up, fails every request, and looks like a code problem.
[[ -f .env ]] || die ".env is missing from $APP_DIR — copy it in before deploying"

# Checked here rather than where it is used, so a missing runtime stops the
# deploy while the checkout is still on the running version. Discovering it
# after `git checkout` is what leaves the tree ahead of what is installed.
[[ -x "$NPM" ]] || die "no npm at $NPM — set NODE_BIN to the directory holding the node this service runs"

say "fetching"
git fetch --tags --prune origin

TARGET="${1:-$(git tag -l 'v*' --sort=-v:refname | head -1)}"
[[ -n "$TARGET" ]] || die "no version tags found — nothing has been released yet"
git rev-parse -q --verify "refs/tags/$TARGET" >/dev/null || die "no such tag: $TARGET"

# What to go back to if this does not come up.
PREVIOUS="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)"

if [[ "$TARGET" == "$PREVIOUS" ]]; then
    say "already on $TARGET — nothing to do"
    exit 0
fi

say "deploying $TARGET (currently $PREVIOUS)"

# Each step reports its own failure rather than leaning on `set -e`, which is
# suppressed inside a function called as a condition — the shape the caller
# below needs. Without these, a failed install would carry on to the restart.
install_and_restart() {
    git checkout -q --detach "$1" || return 1
    # --omit=dev: the test runner has no business in production.
    "$NPM" ci --omit=dev --silent || return 1
    sudo systemctl restart "$SERVICE" || return 1
}

healthy() {
    local waited=0
    until curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; do
        (( waited++ ))
        (( waited >= HEALTH_TIMEOUT )) && return 1
        sleep 1
    done
    return 0
}

# Failing to install is as much a failed deploy as failing to answer, and it
# leaves the same mess: the checkout has already moved, so stopping here would
# strand the tree on a version whose dependencies were never installed. Nothing
# would be serving it — the restart never ran — until the next crash, when
# Restart=always would bring exactly that up.
if ! install_and_restart "$TARGET"; then
    printf '\n✗ could not install %s — putting %s back\n' "$TARGET" "$PREVIOUS" >&2
    install_and_restart "$PREVIOUS" \
        || die "$TARGET failed to install and $PREVIOUS could not be put back. Check: journalctl -u $SERVICE -n 50"
    healthy || die "rolled back to $PREVIOUS and it is not answering. Check: journalctl -u $SERVICE -n 50"
    die "rolled back to $PREVIOUS, which is live. $TARGET needs looking at."
fi

say "waiting for $HEALTH_URL"
if healthy; then
    say "$TARGET is live"
    exit 0
fi

printf '\n✗ %s did not answer within %ss — rolling back to %s\n' "$TARGET" "$HEALTH_TIMEOUT" "$PREVIOUS" >&2
install_and_restart "$PREVIOUS"

if healthy; then
    die "rolled back to $PREVIOUS, which is live. $TARGET needs looking at."
fi

die "rolled back to $PREVIOUS and it is ALSO not answering. Check: journalctl -u $SERVICE -n 50"
