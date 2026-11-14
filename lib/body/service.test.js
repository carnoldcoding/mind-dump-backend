// Body — service-layer tests against an in-memory repository, the same split
// Finances uses: the rules that refuse a write are checked here, and the Mongo
// repository (repository.js) is the untested I/O half.
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const service = require("./service");
const { BodyError } = require("./errors");
const { seedContent, seed } = require("./seed");

function inMemoryRepo() {
    const tables = { movements: [], sessions: [], checks: [], weighins: [] };
    let plan = null;
    let next = 1;
    const find = (kind, id) => tables[kind].find((d) => d._id === String(id));
    const clone = (v) => JSON.parse(JSON.stringify(v));
    return {
        tables,
        async getPlan() { return plan ? clone(plan) : null; },
        async setPlan(p) { plan = clone(p); },
        async list(kind) { return clone(tables[kind]); },
        async get(kind, id) { const d = find(kind, id); return d ? clone(d) : null; },
        async insert(kind, doc) { const d = { ...clone(doc), _id: String(next++) }; tables[kind].push(d); return clone(d); },
        async update(kind, id, fields) { const d = find(kind, id); if (!d) return false; Object.assign(d, clone(fields)); return true; },
        async remove(kind, id) { const n = tables[kind].length; tables[kind] = tables[kind].filter((d) => d._id !== String(id)); return tables[kind].length < n; },
        async pushSet(id, set) { const d = find("sessions", id); if (!d) return false; d.sets.push(clone(set)); return true; },
        async putByDate(kind, date, fields) {
            const d = tables[kind].find((x) => x.date === date);
            if (d) Object.assign(d, fields); else tables[kind].push({ _id: String(next++), date, ...fields });
        },
        async removeByDate(kind, date) { const n = tables[kind].length; tables[kind] = tables[kind].filter((d) => d.date !== date); return tables[kind].length < n; },
    };
}

async function rejects(promise, code) {
    await expect(promise).rejects.toBeInstanceOf(BodyError);
    await expect(promise).rejects.toMatchObject({ code });
}

// A seeded repository, plus the ids of a few Movements by name.
async function seeded() {
    const repo = inMemoryRepo();
    await seed(repo, { commit: true });
    const id = (name) => repo.tables.movements.find((m) => m.name === name)._id;
    return { repo, id };
}

describe("seed (R9, Appendix A)", () => {
    it("plans four Workouts on Monday, Tuesday, Thursday and Friday", () => {
        const { plan } = seedContent();
        expect(plan.workouts.map((w) => [w.key, w.name, w.weekday])).toEqual([
            ["upperA", "Upper A", 1], ["lowerA", "Lower A", 2], ["upperB", "Upper B", 4], ["lowerB", "Lower B", 5],
        ]);
    });

    it("orders Upper A as the spec lists it, with two Pairs", () => {
        const { plan, movements } = seedContent();
        const name = (ref) => movements.find((m) => m.ref === ref).name;
        const upperA = plan.workouts[0].slots;
        expect(upperA.map((s) => name(s.ref))).toEqual([
            "Handstand hold, chest to wall",
            "Deep push-up on parallettes",
            "Pull-up",
            "Deep push-up, feet raised",
            "Row under a bar",
            "Pike push-up",
            "Neck extension with a band",
        ]);
        expect(upperA.map((s) => s.pair)).toEqual([null, 1, 1, 2, 2, null, null]);
    });

    it("gives each Movement the Rule and set count of the spec", () => {
        const { movements } = seedContent();
        const by = (name) => movements.find((m) => m.name === name);
        expect(by("Handstand hold, chest to wall")).toMatchObject({ kind: "hold", rule: "noFailure", sets: 5 });
        expect(by("Pull-up")).toMatchObject({ kind: "reps", rule: "pastFailure", sets: 2 });
        expect(by("Pike push-up, feet raised")).toMatchObject({ kind: "reps", rule: "noFailure", sets: 2 });
        expect(by("Neck extension with a band")).toMatchObject({ kind: "reps", rule: "noFailure", sets: 3 });
        expect(by("Side plank, each side")).toMatchObject({ kind: "hold", rule: "failure", sets: 2 });
    });

    it("puts the neck work on both Upper days and on Lower B only", () => {
        const { plan, movements } = seedContent();
        const neck = movements.find((m) => m.name === "Neck extension with a band").ref;
        const has = (key) => plan.workouts.find((w) => w.key === key).slots.some((s) => s.ref === neck);
        expect([has("upperA"), has("lowerA"), has("upperB"), has("lowerB")]).toEqual([true, false, true, true]);
    });

    it("lists seven holds of 2 x 30 seconds and the wall angels in the Routine", () => {
        const { plan } = seedContent();
        const items = plan.routine.items;
        expect(items).toHaveLength(8);
        expect(items.slice(0, 7).every((i) => i.sets === 2 && i.seconds === 30)).toBe(true);
        expect(items[7]).toEqual({ name: "Wall angels", sets: 1, reps: 10 });
    });

    it("starts Phase 1 at 245.0 lb with a 216.0 lb target", () => {
        expect(seedContent().plan.phase).toEqual({ name: "Phase 1", startLb: 245, targetLb: 216 });
    });

    it("writes nothing on a dry run", async () => {
        const repo = inMemoryRepo();
        await seed(repo, { commit: false });
        expect(await repo.getPlan()).toBeNull();
        expect(repo.tables.movements).toHaveLength(0);
    });

    it("refuses to write when a Plan exists", async () => {
        const { repo } = await seeded();
        await rejects(seed(repo, { commit: true }), "plan_exists");
    });

    it("stores one Movement record for a Movement that two Workouts share", async () => {
        const { repo } = await seeded();
        expect(repo.tables.movements.filter((m) => m.name === "Row under a bar")).toHaveLength(1);
        const plan = await repo.getPlan();
        const rowId = repo.tables.movements.find((m) => m.name === "Row under a bar")._id;
        expect(plan.workouts.filter((w) => w.slots.some((s) => s.movementId === rowId)).map((w) => w.key)).toEqual(["upperA", "upperB"]);
    });
});

describe("load (R4)", () => {
    it("returns every record and the summary", async () => {
        const { repo } = await seeded();
        const data = await service.load(repo, "2026-11-09");
        expect(Object.keys(data).sort()).toEqual(["checks", "movements", "plan", "sessions", "summary", "today", "weighins"]);
        expect(data.summary.today.due).toBe("upperA");
    });

    it("returns no Plan and no summary before the seed", async () => {
        const data = await service.load(inMemoryRepo(), "2026-11-09");
        expect(data.plan).toBeNull();
        expect(data.summary).toBeNull();
    });

    it("refuses a today that is not a calendar date", async () => {
        await rejects(service.load(inMemoryRepo(), "2026-02-30"), "invalid_input");
    });
});

describe("Sessions and Sets (R2, R3, R21, R24, R25)", () => {
    it("starts one Session for a Workout on a date, and returns it again on a second start", async () => {
        const { repo } = await seeded();
        const a = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        const b = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        expect(a).toMatchObject({ date: "2026-11-09", workoutKey: "upperA", sets: [], skipped: [] });
        expect(b._id).toBe(a._id);
        expect(repo.tables.sessions).toHaveLength(1);
    });

    it("refuses a Workout that is not one of the four", async () => {
        const { repo } = await seeded();
        await rejects(service.startSession(repo, { date: "2026-11-09", workoutKey: "arms" }), "invalid_input");
    });

    it("stores the full reps of a Set, whatever the Rule", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        const out = await service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 7 });
        expect(out.sets).toHaveLength(1);
        expect(out.sets[0]).toEqual({ id: out.sets[0].id, movementId: id("Pull-up"), full: 7 });
        expect(typeof out.sets[0].id).toBe("string");
        const neck = await service.addSet(repo, { id: s._id, movementId: id("Neck extension with a band"), full: 10 });
        expect(neck.sets[1]).toEqual({ id: neck.sets[1].id, movementId: id("Neck extension with a band"), full: 10 });
    });

    // Past failure nobody counts, so the reps after failure are not a field.
    it("refuses partial and assisted reps on every Movement", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 7, partial: 3 }), "invalid_input");
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 7, assisted: 2 }), "invalid_input");
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Neck extension with a band"), full: 10, partial: 0 }), "invalid_input");
    });

    it("stores seconds for a hold, and refuses reps on it", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        const hold = id("Handstand hold, chest to wall");
        await rejects(service.addSet(repo, { id: s._id, movementId: hold, full: 5 }), "invalid_input");
        const out = await service.addSet(repo, { id: s._id, movementId: hold, seconds: 25 });
        expect(out.sets[0]).toEqual({ id: out.sets[0].id, movementId: hold, seconds: 25 });
    });

    it("refuses an unknown field and a wrong type (R3)", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 7, mood: "good" }), "invalid_input");
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: "7" }), "invalid_input");
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 7.5 }), "invalid_input");
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: -1 }), "invalid_input");
        await rejects(service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA", note: "x" }), "invalid_input");
    });

    it("refuses a Set with no rep at all", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 0 }), "invalid_input");
    });

    it("takes a load in pounds on a loaded Movement only", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        await rejects(service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 7, load: 25 }), "invalid_input");
        const shrug = await service.addMovement(repo, { name: "One-arm shrug", kind: "reps", rule: "pastFailure", sets: 2, loaded: true });
        const out = await service.addSet(repo, { id: s._id, movementId: shrug._id, full: 12, load: 70 });
        expect(out.sets[0]).toMatchObject({ full: 12, load: 70 });
    });

    it("edits and deletes a past Set (R29)", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        const one = await service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 7 });
        const setId = one.sets[0].id;
        const edited = await service.updateSet(repo, { id: s._id, setId, full: 8 });
        expect(edited.sets[0]).toEqual({ id: setId, movementId: id("Pull-up"), full: 8 });
        const removed = await service.removeSet(repo, { id: s._id, setId });
        expect(removed.sets).toEqual([]);
        await rejects(service.removeSet(repo, { id: s._id, setId }), "not_found");
    });

    it("marks a Movement skipped, and clears the mark when a Set is logged", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        const skipped = await service.skipMovement(repo, { id: s._id, movementId: id("Pull-up"), skipped: true });
        expect(skipped.skipped).toEqual([id("Pull-up")]);
        const after = await service.addSet(repo, { id: s._id, movementId: id("Pull-up"), full: 5 });
        expect(after.skipped).toEqual([]);
    });

    it("refuses a Set on a Session or a Movement that does not exist", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        await rejects(service.addSet(repo, { id: "999", movementId: id("Pull-up"), full: 5 }), "not_found");
        await rejects(service.addSet(repo, { id: s._id, movementId: "999", full: 5 }), "not_found");
    });
});

describe("Movements (R10, R11, D15)", () => {
    it("adds a Movement with its kind, Rule, set count and loaded flag", async () => {
        const { repo } = await seeded();
        const m = await service.addMovement(repo, { name: " Dip ", kind: "reps", rule: "failure", sets: 2 });
        expect(m).toMatchObject({ name: "Dip", kind: "reps", rule: "failure", sets: 2, loaded: false });
    });

    it("refuses a hold that goes past failure, and a set count outside 1 to 10", async () => {
        const { repo } = await seeded();
        await rejects(service.addMovement(repo, { name: "Plank", kind: "hold", rule: "pastFailure", sets: 2 }), "invalid_input");
        await rejects(service.addMovement(repo, { name: "Dip", kind: "reps", rule: "failure", sets: 0 }), "invalid_input");
        await rejects(service.addMovement(repo, { name: "", kind: "reps", rule: "failure", sets: 2 }), "invalid_input");
    });

    it("changes one field and keeps the others", async () => {
        const { repo, id } = await seeded();
        const m = await service.updateMovement(repo, id("Pull-up"), { sets: 3 });
        expect(m).toMatchObject({ name: "Pull-up", kind: "reps", rule: "pastFailure", sets: 3 });
    });

    it("refuses to delete a Movement that has Sets or is in the Plan", async () => {
        const { repo, id } = await seeded();
        await rejects(service.removeMovement(repo, id("Pull-up")), "movement_in_plan");

        const spare = await service.addMovement(repo, { name: "Dip", kind: "reps", rule: "failure", sets: 2 });
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        await service.addSet(repo, { id: s._id, movementId: spare._id, full: 9 });
        await rejects(service.removeMovement(repo, spare._id), "movement_has_sets");

        const unused = await service.addMovement(repo, { name: "Unused", kind: "reps", rule: "failure", sets: 2 });
        await service.removeMovement(repo, unused._id);
        expect(repo.tables.movements.some((m) => m.name === "Unused")).toBe(false);
    });
});

describe("Plan (R10, R11)", () => {
    it("replaces a Movement in a Workout and keeps the old Movement and its Sets", async () => {
        const { repo, id } = await seeded();
        const s = await service.startSession(repo, { date: "2026-11-09", workoutKey: "upperA" });
        const raised = id("Deep push-up, feet raised");
        await service.addSet(repo, { id: s._id, movementId: raised, full: 12 });

        const dip = await service.addMovement(repo, { name: "Dip", kind: "reps", rule: "failure", sets: 2 });
        const before = (await repo.getPlan()).workouts.find((w) => w.key === "upperA").slots;
        const slots = before.map((slot) => (slot.movementId === raised ? { ...slot, movementId: dip._id } : slot));
        const plan = await service.updateWorkout(repo, "upperA", { slots });

        expect(plan.workouts.find((w) => w.key === "upperA").slots[3]).toEqual({ movementId: dip._id, pair: 2 });
        expect(repo.tables.movements.some((m) => m._id === raised)).toBe(true);
        expect(repo.tables.sessions[0].sets[0].movementId).toBe(raised);
    });

    it("refuses a slot list with an unknown Movement, a repeated Movement, or a broken Pair", async () => {
        const { repo, id } = await seeded();
        const a = id("Pull-up"), b = id("Chin-up"), c = id("Pike push-up");
        await rejects(service.updateWorkout(repo, "upperA", { slots: [{ movementId: "999", pair: null }] }), "invalid_input");
        await rejects(service.updateWorkout(repo, "upperA", { slots: [{ movementId: a, pair: null }, { movementId: a, pair: null }] }), "invalid_input");
        // A Pair is two neighbours.
        await rejects(service.updateWorkout(repo, "upperA", { slots: [{ movementId: a, pair: 1 }] }), "invalid_input");
        await rejects(service.updateWorkout(repo, "upperA", {
            slots: [{ movementId: a, pair: 1 }, { movementId: c, pair: null }, { movementId: b, pair: 1 }],
        }), "invalid_input");
    });

    it("moves a Workout to a free weekday, and refuses a weekday another Workout holds", async () => {
        const { repo } = await seeded();
        const plan = await service.updateWorkout(repo, "upperB", { weekday: 3 });
        expect(plan.workouts.find((w) => w.key === "upperB").weekday).toBe(3);
        await rejects(service.updateWorkout(repo, "upperB", { weekday: 1 }), "weekday_taken");
        await rejects(service.updateWorkout(repo, "upperB", { weekday: 8 }), "invalid_input");
    });

    it("edits the Routine list", async () => {
        const { repo } = await seeded();
        const items = [{ name: "Pancake", sets: 2, seconds: 30 }, { name: "Wall angels", sets: 1, reps: 10 }];
        const plan = await service.updateRoutine(repo, { items });
        expect(plan.routine.items).toEqual(items);
        await rejects(service.updateRoutine(repo, { items: [{ name: "Both", sets: 1, seconds: 30, reps: 10 }] }), "invalid_input");
        await rejects(service.updateRoutine(repo, { items: [{ name: "Neither", sets: 1 }] }), "invalid_input");
    });

    it("edits the Phase", async () => {
        const { repo } = await seeded();
        const plan = await service.updatePhase(repo, { name: "Phase 1", startLb: 245, targetLb: 209 });
        expect(plan.phase).toEqual({ name: "Phase 1", startLb: 245, targetLb: 209 });
        await rejects(service.updatePhase(repo, { name: "Phase 1", startLb: 245, targetLb: -1 }), "invalid_input");
    });

    it("refuses a Plan edit before the seed", async () => {
        await rejects(service.updatePhase(inMemoryRepo(), { name: "P", startLb: 245, targetLb: 216 }), "not_found");
    });
});

describe("Routine check (R14) and Weigh-in (R17)", () => {
    it("checks a date once, and clears it", async () => {
        const { repo } = await seeded();
        await service.checkRoutine(repo, { date: "2026-11-09", done: true });
        await service.checkRoutine(repo, { date: "2026-11-09", done: true });
        expect(repo.tables.checks.map((c) => c.date)).toEqual(["2026-11-09"]);
        await service.checkRoutine(repo, { date: "2026-11-09", done: false });
        expect(repo.tables.checks).toEqual([]);
    });

    it("keeps one Weigh-in for a date; a second entry replaces the first", async () => {
        const { repo } = await seeded();
        await service.setWeighIn(repo, { date: "2026-11-09", lb: 244.2 });
        await service.setWeighIn(repo, { date: "2026-11-09", lb: 243.8 });
        expect(repo.tables.weighins.map((w) => [w.date, w.lb])).toEqual([["2026-11-09", 243.8]]);
    });

    it("refuses a bodyweight that is not a plausible number of pounds", async () => {
        const { repo } = await seeded();
        await rejects(service.setWeighIn(repo, { date: "2026-11-09", lb: "244" }), "invalid_input");
        await rejects(service.setWeighIn(repo, { date: "2026-11-09", lb: 0 }), "invalid_input");
        await rejects(service.setWeighIn(repo, { date: "11/09/2026", lb: 244 }), "invalid_input");
    });

    it("removes a Weigh-in", async () => {
        const { repo } = await seeded();
        await service.setWeighIn(repo, { date: "2026-11-09", lb: 244.2 });
        await service.removeWeighIn(repo, { date: "2026-11-09" });
        expect(repo.tables.weighins).toEqual([]);
    });
});
