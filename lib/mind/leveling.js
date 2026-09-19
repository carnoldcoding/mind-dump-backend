// Mind — the Logos → Level curve, ported verbatim from Grimoire's leveling.go.
// min(level, LevelCap) Quests' worth of Logos per level-up: cheap early
// levels, flattening at a fixed ceiling so later levels stay reachable.

const { LevelCap, QuestLogos } = require("./constants");

// costForLevel — Logos to go from level n to level n+1.
function costForLevel(level) {
    const quests = Math.min(level, LevelCap);
    return quests * QuestLogos;
}

// thresholdForLevel — cumulative Logos required to reach a level. Level 1 is
// the baseline (0 Logos).
function thresholdForLevel(level) {
    let total = 0;
    for (let l = 1; l < level; l++) total += costForLevel(l);
    return total;
}

// levelForLogos — the level implied by a cumulative Logos total.
function levelForLogos(logos) {
    let level = 1;
    while (logos >= thresholdForLevel(level + 1)) level++;
    return level;
}

// averageLevel — arithmetic mean of the given levels, or the baseline level 1
// if none are given (an untouched Domain).
function averageLevel(levels) {
    if (!levels || levels.length === 0) return 1;
    const sum = levels.reduce((a, b) => a + b, 0);
    return sum / levels.length;
}

module.exports = { costForLevel, thresholdForLevel, levelForLogos, averageLevel };
