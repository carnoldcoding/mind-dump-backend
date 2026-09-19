// Mind — typed domain errors, ported from Grimoire's errors.go. Each carries
// a machine-readable `code` so the REST layer can map it to an HTTP status
// without string-matching the message.

const { BossEvery } = require("./constants");

class DomainError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "DomainError";
        this.code = code;
    }
}

class ErrInvalidDomain extends DomainError {
    constructor(slug) {
        super("invalid_domain", `invalid domain "${slug}": must be one of networking, devops, sysadmin`);
        this.slug = slug;
    }
}

class ErrTitleRequired extends DomainError {
    constructor(domain, discipline, quest) {
        super("title_required", `quest ${domain}/${discipline}/${quest} is new and requires a title`);
        Object.assign(this, { domain, discipline, quest });
    }
}

class ErrDisciplineLocked extends DomainError {
    constructor(openQuests) {
        super(
            "discipline_locked",
            `locked — ${openQuests.length} quests already open, close one before opening a new discipline`
        );
        this.openQuests = openQuests;
    }
}

class ErrQuestNotFound extends DomainError {
    constructor(domain, discipline, quest) {
        super("quest_not_found", `quest ${domain}/${discipline}/${quest} does not exist`);
        Object.assign(this, { domain, discipline, quest });
    }
}

class ErrQuestNotMastered extends DomainError {
    constructor(domain, discipline, quest) {
        super("quest_not_mastered", `quest ${domain}/${discipline}/${quest} has not been mastered yet, nothing to recall`);
        Object.assign(this, { domain, discipline, quest });
    }
}

class ErrQuestPrestiged extends DomainError {
    constructor(domain, discipline, quest) {
        super("quest_prestiged", `quest ${domain}/${discipline}/${quest} is already prestiged, no further recall needed`);
        Object.assign(this, { domain, discipline, quest });
    }
}

class ErrDisciplineNotFound extends DomainError {
    constructor(domain, discipline) {
        super("discipline_not_found", `discipline ${domain}/${discipline} does not exist`);
        Object.assign(this, { domain, discipline });
    }
}

class ErrBossNotAvailable extends DomainError {
    constructor(domain, discipline, questsSinceBoss) {
        super(
            "boss_not_available",
            `boss not available in ${domain}/${discipline}: ${questsSinceBoss}/${BossEvery} quests mastered since last boss`
        );
        Object.assign(this, { domain, discipline, questsSinceBoss });
    }
}

module.exports = {
    DomainError,
    ErrInvalidDomain,
    ErrTitleRequired,
    ErrDisciplineLocked,
    ErrQuestNotFound,
    ErrQuestNotMastered,
    ErrQuestPrestiged,
    ErrDisciplineNotFound,
    ErrBossNotAvailable,
};
