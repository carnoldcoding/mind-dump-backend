// Body — the seed (spec R9, Appendix A). The accepted training content,
// written once into an empty database. `seedContent` is the content alone, so
// a test can compare it with the spec; `seed` writes it through a repository.
//
// Three Movements stand in for ones that wait on equipment: the raised deep
// push-up for the dip, and the one-leg glute bridge for the kettlebell swing.
// The one-arm shrug is left out until a kettlebell exists.

const { conflict } = require("./errors");

const PF = "pastFailure";
const F = "failure";
const NF = "noFailure";

const reps = (ref, name, rule, sets = 2) => ({ ref, name, kind: "reps", rule, sets, loaded: false });
const hold = (ref, name, rule, sets = 2) => ({ ref, name, kind: "hold", rule, sets, loaded: false });

const MOVEMENTS = [
    hold("handstand", "Handstand hold, chest to wall", NF, 5),
    reps("deepPushUp", "Deep push-up on parallettes", PF),
    reps("pullUp", "Pull-up", PF),
    reps("chinUp", "Chin-up", PF),
    reps("raisedPushUp", "Deep push-up, feet raised", PF),
    reps("row", "Row under a bar", PF),
    reps("pike", "Pike push-up", PF),
    reps("pikeRaised", "Pike push-up, feet raised", NF),
    reps("neck", "Neck extension with a band", NF, 3),
    reps("squat", "Squat", PF),
    reps("splitSquat", "Split squat, each side", PF),
    reps("hipHinge", "One-leg hip hinge, each side", PF),
    reps("gluteBridge", "Glute bridge, one leg", PF),
    reps("calfRaise", "Standing calf raise, one leg", PF),
    reps("legRaise", "Hanging leg raise", PF),
    hold("sidePlank", "Side plank, each side", F),
];

// A slot is a Movement and, for a Pair, the number its two neighbours share.
const slot = (ref, pair = null) => ({ ref, pair });

const WORKOUTS = [
    {
        key: "upperA", name: "Upper A", weekday: 1,
        slots: [slot("handstand"), slot("deepPushUp", 1), slot("pullUp", 1), slot("raisedPushUp", 2), slot("row", 2), slot("pike"), slot("neck")],
    },
    {
        key: "lowerA", name: "Lower A", weekday: 2,
        slots: [slot("squat"), slot("splitSquat"), slot("hipHinge"), slot("calfRaise", 1), slot("legRaise", 1), slot("sidePlank")],
    },
    {
        key: "upperB", name: "Upper B", weekday: 4,
        slots: [slot("handstand"), slot("pikeRaised", 1), slot("chinUp", 1), slot("raisedPushUp", 2), slot("row", 2), slot("deepPushUp"), slot("neck")],
    },
    {
        key: "lowerB", name: "Lower B", weekday: 5,
        slots: [slot("splitSquat"), slot("squat"), slot("gluteBridge"), slot("calfRaise", 1), slot("legRaise", 1), slot("sidePlank"), slot("neck")],
    },
];

const stretch = (name) => ({ name, sets: 2, seconds: 30 });

const ROUTINE = [
    stretch("Pancake"),
    stretch("Figure four, each side"),
    stretch("Hip flexor lunge with reach, each side"),
    stretch("Chest stretch with a pole"),
    stretch("Lat stretch"),
    stretch("Wrist stretch"),
    stretch("Deep squat hold"),
    { name: "Wall angels", sets: 1, reps: 10 },
];

const PHASE = { name: "Phase 1", startLb: 245, targetLb: 216 };

function seedContent() {
    return {
        movements: MOVEMENTS.map((m) => ({ ...m })),
        plan: {
            workouts: WORKOUTS.map((w) => ({ ...w, slots: w.slots.map((s) => ({ ...s })) })),
            routine: { items: ROUTINE.map((i) => ({ ...i })) },
            phase: { ...PHASE },
        },
    };
}

// Dry by default: without `commit` this only reports what it would write. It
// refuses when a Plan exists, so a second run cannot overwrite an edited Plan.
async function seed(repo, { commit = false } = {}) {
    if (await repo.getPlan()) throw conflict("plan_exists", "A Plan exists already; the seed writes only into an empty Body");

    const content = seedContent();
    if (!commit) return { committed: false, ...content };

    const ids = {};
    for (const { ref, ...movement } of content.movements) {
        ids[ref] = (await repo.insert("movements", movement))._id;
    }
    const plan = {
        ...content.plan,
        workouts: content.plan.workouts.map((w) => ({
            ...w,
            slots: w.slots.map((s) => ({ movementId: ids[s.ref], pair: s.pair })),
        })),
    };
    await repo.setPlan(plan);
    return { committed: true, ...content };
}

module.exports = { seedContent, seed };
