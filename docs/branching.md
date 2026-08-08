# Branching Strategy

`main` is release-only. `dev` is the trunk. Work happens on short-lived
branches off `dev`, and reaches `main` through a release branch.

The same model governs [`mind-dump`](https://github.com/carnoldcoding/mind-dump), the frontend.
Each repo carries its own copy of this document so it is answerable offline and
on GitHub; they are meant to stay identical apart from the repo-specific notes
at the end.

Adopted 2026-08-02, replacing the trunk-based model in place since 2026-07-03,
which itself replaced an ad-hoc history of long-lived feature branches. Revised
2026-08-08 — see [What changed, and why](#what-changed-and-why).

```
  feat/*  fix/*  chore/*        short-lived, off dev, back into dev
        \    |    /
         \   |   /
          v  v  v
  ─────────► dev ──────────────► releases/0.4.0 ──────► main ──► tag v0.4.0
             ▲                         ▲
             │                         │
             └── main merges back      └── dev merges in as more work lands


  main ──► hotfix/* ──► main ──► tag v0.4.1
                │
                └──────► dev
```

## What each branch is for

**`main`** — verified, production-ready, and nothing else. It receives a merge
from a `releases/*` branch, or from a `hotfix/*` branch, and nothing else.
Every commit on it is a release. If something is on `main`, it has been run and
looked at, not merely merged.

**`dev`** — the trunk. Everything integrates here first. `dev` is expected to
be working but not proven; it is where a change is allowed to be *probably*
right.

**`feat/*`, `fix/*`, `chore/*`, `refactor/*`, `docs/*`** — short-lived, branch
off `dev`, merge back into `dev` by PR. One coherent piece of work each. If a
branch has been open long enough to need rebasing twice, it was too big.

**`releases/<major>.<minor>.<patch>`** — cut from `dev` when a set of work is
ready to be verified, and the staging area for that release until it ships.

**Work continues to arrive on it.** Merge `dev` into the release branch as more
lands. This is the deliberate change from the original model, which allowed
stabilisation fixes alone: in practice an iteration keeps growing while it is
being verified, and a rule that forbids that is a rule that gets ignored rather
than followed.

The consequence to be honest about: "verified" describes the branch at the
moment you last looked at it, not permanently. Merging `dev` in resets that,
and the version wants looking at again before it goes to `main`.

**`hotfix/*`** — branches off **`main`**, not `dev`, so the fix carries nothing
unreleased with it. PR into `main`, tag a patch, then merge `main` back into
`dev` so the next release does not undo it. This is the only route to `main`
that skips a release branch, and it exists for fixing what is already out
there — not for anything that is merely urgent.

## Versioning

Releases follow semantic versioning, and **the tag is the version**. There is
no `version` field in `package.json` in either repo.

- **patch** (`0.4.0` → `0.4.1`) — fixes only, nothing new to learn as a user.
- **minor** (`0.3.0` → `0.4.0`) — new capability, existing behaviour intact.
- **major** (`0.x` → `1.0`) — behaviour removed or changed out from under you.

While the site is pre-1.0, a minor bump is the honest choice for anything that
changes what a surface does, because there is no stability promise yet to break.

Tags are annotated, and their subject is one line saying what the release is in
the terms a person would use — `v0.3.0 — The Review editor becomes a menu`, not
a changelog.

## Rules

- **No direct pushes to `main` or `dev`.** Every change, regardless of size or
  who or what authors it, goes through a branch and a PR.
- **Branch naming**: `<type>/<short-kebab-description>` — `feat/journal-page`,
  `fix/audio-player-seek`, `chore/dep-updates`. Release branches are the one
  exception: `releases/0.4.0`, named for the version rather than the work.
- **Merge strategy**: merge commits only. Squash and rebase merge are disabled
  at the repo level, deliberately — the full intermediate trail is kept,
  including an agent's "tried X, reverted, did Y", rather than flattened away.
- **Commits are atomic and meaningful on their own** — imperative subject, body
  explaining *why* where it is not obvious. No "wip" or "fix typo from last
  commit"; clean up with `--amend` or an interactive rebase before pushing, so
  what lands is already the real story.

## What an agent may merge

An agent **opens its own PR and may merge it into `dev`**, once CI is green. A
failing or still-running check means it stops and says so.

An agent **never merges into `main`.** `main` means verified, and verifying is
looking at the thing running — which an agent cannot do. That judgement is the
one part of this that stays manual.

Tagging follows the merge, so an agent cuts the tag after a person has merged
the release.

## Workflow

1. Branch off the latest `dev`.
2. Do the work, in clean atomic commits.
3. Open a PR into `dev`. Merge it once CI passes.
4. When a set of work is worth releasing, cut `releases/x.y.z` from `dev`.
5. Verify it — actually run it, on the devices that matter.
6. Fix what verification finds *on the release branch*, and merge those fixes
   back to `dev`. Merge `dev` in as more work lands, and re-verify.
7. Merge the release into `main`, then tag it.

## Gates

CI runs on pull requests into `dev` and `main`: `npm ci`, the test suite, and a
step that requires every route and controller, on the Node version production
runs. It does not deploy anything and it does not reach this machine.

Deploying is separate and deliberate: `deploy.sh` runs on the box and installs
a **tag**, so merging to `main` ships nothing by itself. See
[`deployment.md`](./deployment.md).

CI cannot tell you whether the thing looks right, which is why step 5 exists and
why `main` is the one merge an agent does not make.

## PR description convention

No enforced GitHub template — this shape, by convention:

```
## Summary
- What changed, 1-3 bullets

## Why
Motivation / context for the change

## Test plan (optional)
How this was verified
```

## What changed, and why

Revised 2026-08-08, after an audit found the document and the practice had
drifted apart in five places:

- **Release branches now take `dev` merges.** The old rule was "only
  stabilisation, no new features", and it was never once followed.
- **The version moved to the tag alone.** It used to be bumped on the release
  branch, which needed a carry-back PR to `dev` every time and would have
  conflicted on every `dev` merge under the new model.
- **An agent may now merge into `dev`.** The old rule was that it never merged
  anything; it was overridden within a week of being written.
- **`hotfix/*` exists.** There was no route to `main` for an urgent fix, so
  `dev` → `main` happened twice instead, which the document forbade.
- **The Gates section claimed there was no CI.** There has been CI on both
  repos since 2026-08-02.

## The obvious objection

The model this replaced was adopted *because* long-lived branches had rotted:
`dev`, `game-reviews`, `legacy-no-ai`, `react-refactor`, `refactor-mvvm`,
`routing`, `ai-refactor` — all pruned in July 2026, one of them named `dev`.
Reintroducing a permanent `dev` reintroduces that risk, and it would be
dishonest to write this document without saying so.

What makes it different is the direction of flow. The branches that rotted were
long-lived *feature* branches, each accumulating work that was never
integrated. Here `dev` is the integration point — everything lands there first
and nothing lives beside it for long. So the failure mode to watch for is not
`dev` rotting; it is `dev` drifting far ahead of `main` because releases stop
being cut. If `dev` is more than a few pieces of work ahead of `main`, cut a
release rather than adding to it.

There is a second one now. A release branch that takes `dev` merges and gives
nothing back is a branch whose only distinction from `dev` is that `main` will
accept it. That is a common and workable arrangement, but if a release is
repeatedly cut and immediately merged with nothing happening on it, the branch
is ceremony — and the honest response is to drop it, not to keep performing it.
