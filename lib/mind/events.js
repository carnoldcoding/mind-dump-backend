// Mind — pure event builders (spec §4.2). Given a transition's input and its
// outcome, produce the immutable event(s) to append to the log. Pure: no clock
// of their own (now is passed in), no Mongo. The append-only events are the
// history the projection and every pattern chart are folded from.

// One graded answer → an `answer` event, plus a `mastered` event on the call
// that actually masters the Quest (logosAwarded > 0 distinguishes it from a
// no-op call against an already-mastered Quest).
function progressEvents({ domain, discipline, quest, correct, sessionId = null, meta = {} }, outcome, now) {
    const base = { t: now, sessionId, domain, discipline, quest };
    const events = [{ ...base, op: "answer", correct, meta }];
    if (outcome.logosAwarded > 0) {
        events.push({ ...base, op: "mastered", logosDelta: outcome.logosAwarded });
    }
    return events;
}

// One recall result → a `recall` event, plus a `prestige` event when passing
// the final tier retires the Quest.
function recallEvents({ domain, discipline, quest, correct, sessionId = null, meta = {} }, outcome, now) {
    const base = { t: now, sessionId, domain, discipline, quest };
    const events = [
        { ...base, op: "recall", correct, tierBefore: outcome.tierBefore, tierAfter: outcome.tierAfter, meta },
    ];
    if (outcome.prestiged) events.push({ ...base, op: "prestige" });
    return events;
}

// One Boss Phase resolution → a `boss` event carrying the real, floored Logos
// delta and any recovered Bloodstain.
function bossEvents({ domain, discipline, sessionId = null, meta = {} }, result, now) {
    return [
        {
            t: now, sessionId, domain, discipline, op: "boss",
            won: result.win, logosDelta: result.logosDelta,
            bloodstainRecovered: result.bloodstainRecovered, meta,
        },
    ];
}

// Creating an un-started Quest.
function startQuestEvent({ domain, discipline, quest, title, sessionId = null }, now) {
    return [{ t: now, sessionId, domain, discipline, quest, op: "startQuest", meta: { title } }];
}

function loreEditEvent({ domain, discipline, quest, sessionId = null }, now) {
    return [{ t: now, sessionId, domain, discipline, quest, op: "loreEdit" }];
}

function linkEditEvent({ domain, discipline, quest, sessionId = null, added = [] }, now) {
    return [{ t: now, sessionId, domain, discipline, quest, op: "linkEdit", meta: { added } }];
}

function sessionStartEvent(sessionId, now) {
    return [{ t: now, sessionId, op: "sessionStart" }];
}

function sessionEndEvent(sessionId, now) {
    return [{ t: now, sessionId, op: "sessionEnd" }];
}

module.exports = {
    progressEvents,
    recallEvents,
    bossEvents,
    startQuestEvent,
    loreEditEvent,
    linkEditEvent,
    sessionStartEvent,
    sessionEndEvent,
};
