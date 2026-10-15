// Mind — game-logic constants, ported verbatim from Grimoire's Go
// internal/domain package (types.go). The one rename: Grimoire's
// spaced-repetition "review ladder" is "recall" here, because "review"
// already means a game/movie/book in this app.

// MasteryStreak — consecutive correct answers required to master a Quest.
const MasteryStreak = 3;

// QuestLogos — flat, one-time Logos reward for mastering a Quest.
const QuestLogos = 100;

// Boss Phase stakes.
const BossWinLogos = 150;
const BossLoseLogos = 150;

// BossEvery — mastered Quests within a Discipline that unlock a Boss Phase.
const BossEvery = 3;

// OpenQuestCap — max simultaneously open (created, not mastered) Quests
// across the whole state before opening a NEW Discipline is blocked.
// Depth (a new Quest in an existing Discipline) is never blocked by this.
const OpenQuestCap = 3;

// LevelCap — level-up cost stops growing past this: min(level, LevelCap)
// Quests' worth of Logos per level-up.
const LevelCap = 3;

// RecallLadderDays — spacing, in days, of the recall (spaced-repetition)
// ladder. Index 0 is the first recall after mastery; passing at the last
// index Prestiges the Quest. (Grimoire's ReviewLadderDays.)
const RecallLadderDays = [1, 3, 7, 14, 30];

// Domains are open: any subject the learner studies becomes one, created on
// first use. A slug is lowercase words joined by single hyphens ("cars",
// "music-theory"), so it can sit inside a composite id ("domain/discipline/quest")
// without ambiguity. Before 2026-10-15 this was a fixed list of networking,
// devops, and sysadmin (Grimoire's three).
const DomainSlugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DomainSlugMax = 32;

module.exports = {
    MasteryStreak,
    QuestLogos,
    BossWinLogos,
    BossLoseLogos,
    BossEvery,
    OpenQuestCap,
    LevelCap,
    RecallLadderDays,
    DomainSlugPattern,
    DomainSlugMax,
};
