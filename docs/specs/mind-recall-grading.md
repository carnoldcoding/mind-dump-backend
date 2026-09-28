# Spec: backend-graded recalls in Mind

Status: accepted, 2026-09-28

## Problem

Recall bookkeeping depends on the model, and the model gets it wrong.

- Every multiple-choice click goes through `answer()` in `lib/mind/broker.js`, which always calls `service.recordAnswer`. On a mastered quest that is a no-op that returns the stored streak, so a correct recall shows a `streak ●●●` card.
- The recall itself is recorded only if the model sends a `recordRecall` action in its next reply. On 2026-09-28 it skipped one (`dns-and-private-endpoints`), which is still due.
- Whether recalls are finished is the model's own claim. On 2026-09-28 it said "All due recalls are cleared" with five still due, then offered the mastered `nsg-rule-evaluation` as a fresh quest.

## Goal

The backend decides what each click counts as, records it, and tells the model what is still due. The model teaches; it does not keep score.

## Design

### 1. Classify each click from state (backend, `broker.answer`)

When a multiple-choice answer arrives, load the pending question's quest and classify it:

| Quest state at click time | Kind | What is recorded |
|---|---|---|
| Not mastered (or doesn't exist yet) | `mastery` | `service.recordAnswer`, as now |
| Mastered, not prestiged, `nextRecallDue <= now` | `recall` | `service.recordRecall` |
| Mastered, recall not due, or prestiged | `practice` | Nothing. No state change, no event (decided 2026-09-28: practice has no bearing on progression) |

The model does not declare the kind. It comes from the database alone.

### 1a. The recall ladder is applied by the backend

Recalls come due on a fixed ladder: 1, 3, 7, 14, then 30 days (`RecallLadderDays` in `lib/mind/constants.js`). Mastery puts a quest on the first step. Each recall click classified as `recall` goes through `state.recordRecall`, which:

- **Pass:** moves the quest up one step and sets `nextRecallDue` to now plus that step's days. Passing the 30-day step prestiges the quest, and it leaves the ladder.
- **Fail:** moves it down one step (never below the first) and sets `nextRecallDue` to now plus that step's days.

Today this only runs if the model remembers to send `recordRecall`, so a forgotten action leaves the quest stuck at its old step and still due. After this change, every recall click moves the quest on the ladder, with no model involvement. The intervals themselves don't change.

Because `practice` is decided by `nextRecallDue`, the ladder also sets when a quest counts as a recall again. After a failed recall, re-asking the same quest in that session is practice until its new due date.

### 2. Stop applying model-sent `recordRecall`

`runTurn` drops `recordRecall` actions the same way it already drops `recordAnswer`. Boss attempts stay model-judged.

### 3. Tell the model the result and what is still due

The follow-up message `answer()` builds for the model says which kind the click was and lists the recalls still due after it:

- `recall`: "This was a RECALL. It PASSED/FAILED. Recalls still due: N — [titles]." When N is 0: "No recalls remain due. Tell the learner recalls are done."
- `practice`: "This quest is mastered and not due for recall, so the answer was not recorded."

### 4. Methodology prompt (`lib/mind/methodology.js`)

- Replace "ask ONE pass/fail diagnostic question, then emit a recordRecall action" with: ask one multiple-choice question on the due quest; the app grades and records it.
- Only say recalls are finished when `CURRENT STATE.due` is empty.
- A quest with `m: true` in `known` is mastered. Never present it as a new topic.

### 5. Result cards (frontend, `Mind/Teach/Conversation.tsx`)

`answer()` returns the op that was applied, so the card follows it:

- `recordAnswer`: unchanged — `✓ streak ●●○`.
- `recordRecall`: `✓ recall · tier 2 → 3 · next in 14 days`, or `✗ recall · tier 2 → 1 · next in 3 days`. `PRESTIGE` banner as now.
- `practice`: `✓ practice · not recorded`. No streak dots.

## Out of scope

- Backfilling the `dns-and-private-endpoints` recall that was never recorded. It stays due; you'll get asked it again.
- Boss grading and streak rules.
- The opener menu and the minimap.

## Tests

Backend (`broker` tests with the in-memory repository):
- A click on a due, mastered quest moves the recall tier and does not touch the streak.
- A click on a mastered quest that isn't due records nothing.
- A click on an unmastered quest records a mastery answer, as now.
- A model-sent `recordRecall` action is not applied.
- The follow-up message lists the recalls still due.

Frontend: the card renders the recall and practice lines above.

## Delivery

- `fix/mind-recall-grading` off `dev` in both repos (`mind-dump-backend` and `mind-dump`), each with a PR into `dev`. I merge once CI passes.
- The backend change deploys separately from the frontend. If the backend ships first, the old frontend shows `✓ recall · tier 3` for a recall and no card for practice. Recording is correct either way, because the backend change alone fixes it.
