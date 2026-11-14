#!/usr/bin/env node
// One-time seed: the accepted Body Plan (spec R9, Appendix A) into an empty
// database. The content and the refusal rule are in lib/body/seed.js, where
// they are tested; this file only connects and prints.
//
// Usage:
//   node --env-file=.env scripts/seed-body.js            # dry run: prints what it would write
//   node --env-file=.env scripts/seed-body.js --commit   # writes to the database in DB_NAME
//
// It refuses when a Plan exists, so it cannot overwrite an edited Plan.

const connectDB = require("../config/db");
const repo = require("../lib/body/repository");
const { seed } = require("../lib/body/seed");
const { BodyError } = require("../lib/body/errors");

async function main() {
    const commit = process.argv.includes("--commit");
    await connectDB();

    const result = await seed(repo, { commit });
    const names = Object.fromEntries(result.movements.map((m) => [m.ref, m.name]));

    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`${result.movements.length} Movements`);
    for (const w of result.plan.workouts) {
        console.log(`\n${w.name} (weekday ${w.weekday})`);
        w.slots.forEach((s, i) => console.log(`  ${i + 1}. ${names[s.ref]}${s.pair ? `  [Pair ${s.pair}]` : ""}`));
    }
    console.log(`\nRoutine: ${result.plan.routine.items.map((i) => i.name).join("; ")}`);
    console.log(`Phase: ${result.plan.phase.name}, ${result.plan.phase.startLb} lb to ${result.plan.phase.targetLb} lb`);
    console.log(result.committed ? "\nWritten." : "\nDry run. Nothing was written. Add --commit to write.");
}

main().then(() => process.exit(0)).catch((err) => {
    console.error(err instanceof BodyError ? `Refused: ${err.message}` : err);
    process.exit(1);
});
