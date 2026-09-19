// Mind — game-logic entry point. The pure domain core (spec §5): constants,
// the Logos/Level curve, typed errors, and the State transitions. No Mongo,
// no HTTP. Ported from Grimoire's Go internal/domain package.

const constants = require("./constants");
const leveling = require("./leveling");
const errors = require("./errors");
const { State, addDays, newQuest, newDiscipline } = require("./state");

module.exports = {
    ...constants,
    ...leveling,
    ...errors,
    State,
    addDays,
    newQuest,
    newDiscipline,
};
