#!/usr/bin/env node
// One-time migration: Grimoire (state.json + lore/*.md) → the mind data model
// (spec §12). Unifies Quests and Lore into single Quest nodes, turns
// [[wikilinks]] into edges, reconciles drifted slugs, and assigns disciplines
// to lore-only concepts.
//
// Usage:
//   node scripts/migrate-grimoire.js               # dry run → scratchpad JSON + report
//   node scripts/migrate-grimoire.js --out FILE    # dry run → FILE
//   GRIMOIRE_HOME=/path node scripts/migrate-grimoire.js
//   node scripts/migrate-grimoire.js --commit      # write to Mongo (SHELVED: needs dev DB)
//
// The reconciliation and discipline-assignment maps below are the auditable
// record of every hand decision (spec §12 / §14 deviations). Change them here,
// re-run the dry run, and review the report before ever committing.

const fs = require("fs");
const path = require("path");
const os = require("os");

const GRIMOIRE = process.env.GRIMOIRE_HOME || path.join(os.homedir(), "repos/grimoire");

// ── Hand decisions (spec §14 deviations) ────────────────────────────────────

// Drifted slug pairs → the ONE canonical slug per concept. Canonical = the
// Lore slug in every case, because the [[wikilink]] edges already reference the
// Lore slug (fewer edges to rewrite) and the Lore slugs read more precisely.
// The Quest's progress is carried onto the canonical node; the Quest keeps its
// own discipline (from state.json).
const RECONCILE = {
    "encapsulation-decapsulation": "encapsulation-and-decapsulation",
    "layer-addressing": "layer-addressing-mac-ip-port",
    "recursive-vs-authoritative": "recursive-vs-authoritative-dns",
    "transport-vs-auth-phases": "ssh-transport-vs-auth-phases",
    "per-peer-tcp-connections": "bittorrent-peer-connections",
    "per-piece-hash-verification": "bittorrent-piece-hashing",
    "piece-indexing-reassembly": "bittorrent-piece-indexing",
};

// Lore-only concepts (no Quest) placed into an EXISTING discipline. Confident,
// content-based; applied and recorded as deviations.
const ASSIGN = {
    "dns-and-private-endpoints": { domain: "networking", discipline: "dns" },
    "ip-addressing-and-cidr": { domain: "networking", discipline: "tcp-ip-model" },
    "tcp-ip-model": { domain: "networking", discipline: "tcp-ip-model" }, // the overview note of that discipline
};

// Lore-only concepts with NO fitting existing discipline — a new-taxonomy call
// that belongs to the user. Imported to a provisional "unfiled" discipline so
// their edges still resolve (graph stays complete), and FLAGGED for re-filing.
const SHELVED_ASSIGN = {
    "vnet-peering": { domain: "networking", discipline: "unfiled", suggest: "cloud-networking" },
    "vnets-and-subnets": { domain: "networking", discipline: "unfiled", suggest: "cloud-networking" },
    "dhcp-vs-static-ip": { domain: "sysadmin", discipline: "unfiled", suggest: "network-config" },
};

// ── helpers ─────────────────────────────────────────────────────────────────

const canon = (slug) => RECONCILE[slug] || slug;

function parseWikilinks(md) {
    const out = new Set();
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(md))) {
        // Obsidian alias syntax is [[target|display text]] — keep only the
        // target slug, and collapse any newline the link wrapped across.
        const target = m[1].split("|")[0].replace(/\s+/g, "").trim();
        if (target) out.add(target);
    }
    return [...out];
}

function readLore() {
    const root = path.join(GRIMOIRE, "lore");
    const files = {};
    for (const dom of fs.readdirSync(root)) {
        const p = path.join(root, dom);
        if (!fs.statSync(p).isDirectory()) continue;
        for (const f of fs.readdirSync(p)) {
            if (!f.endsWith(".md") || f.startsWith("_inbox")) continue; // §12: exclude staging
            const slug = f.replace(/\.md$/, "");
            const body = fs.readFileSync(path.join(p, f), "utf8");
            files[slug] = { slug, domain: dom, body, links: parseWikilinks(body) };
        }
    }
    return files;
}

// ── build the node set ──────────────────────────────────────────────────────

function migrate() {
    const state = JSON.parse(fs.readFileSync(path.join(GRIMOIRE, "state.json"), "utf8"));
    const lore = readLore();
    const report = { reconciled: [], assigned: [], shelved: [], droppedLinks: [], excluded: ["lore/**/_inbox-*.md"], counts: {} };

    // nodes keyed by canonical node id "<domain>/<discipline>/<slug>"
    const nodes = {};
    const disciplines = {};
    const idFor = (domain, discipline, slug) => `${domain}/${discipline}/${slug}`;
    const bySlug = {}; // canonical slug → node id (for edge resolution)

    function ensureDiscipline(domain, slug, src) {
        const id = `${domain}/${slug}`;
        if (!disciplines[id]) {
            disciplines[id] = {
                _id: id, domain, slug,
                title: src?.title || "",
                logos: src?.logos ?? 0,
                questsSinceBoss: src?.quests_since_boss ?? 0,
                bloodstain: src?.bloodstain ? { amount: src.bloodstain.amount } : null,
            };
        }
        return disciplines[id];
    }

    // 1. Quests with progress from state.json → nodes (canonical slug).
    for (const [domain, d] of Object.entries(state.domains || {})) {
        for (const [discSlug, disc] of Object.entries(d.disciplines || {})) {
            ensureDiscipline(domain, discSlug, disc);
            for (const [qSlug, q] of Object.entries(disc.quests || {})) {
                const cslug = canon(qSlug);
                if (cslug !== qSlug) report.reconciled.push({ questSlug: qSlug, canonical: cslug, discipline: `${domain}/${discSlug}` });
                const id = idFor(domain, discSlug, cslug);
                nodes[id] = {
                    _id: id, slug: cslug, domain, discipline: discSlug, title: q.title || cslug,
                    streak: q.streak ?? 0,
                    mastered: !!q.mastered,
                    masteredAt: q.mastered_at || null,
                    recallTier: q.mastered ? (q.review_tier ?? 0) : -1,
                    nextRecallDue: q.next_review_due && q.next_review_due !== "0001-01-01T00:00:00Z" ? q.next_review_due : null,
                    prestiged: !!q.prestiged,
                    lore: null, links: [],
                };
                bySlug[cslug] = id;
            }
        }
    }

    // 2. Create/attach a node for every Lore file (including lore-only), but
    //    do NOT resolve edges yet — every node must exist first, or an edge to
    //    a not-yet-created lore-only node would be falsely dropped.
    for (const [slug, l] of Object.entries(lore)) {
        const cslug = canon(slug);
        let id = bySlug[cslug];
        if (!id) {
            const a = ASSIGN[cslug] || SHELVED_ASSIGN[cslug];
            if (!a) { report.shelved.push({ slug: cslug, reason: "lore-only, no discipline mapping — NEEDS DECISION" }); continue; }
            ensureDiscipline(a.domain, a.discipline);
            id = idFor(a.domain, a.discipline, cslug);
            nodes[id] = {
                _id: id, slug: cslug, domain: a.domain, discipline: a.discipline, title: cslug,
                streak: 0, mastered: false, masteredAt: null, recallTier: -1, nextRecallDue: null, prestiged: false,
                lore: null, links: [],
            };
            bySlug[cslug] = id;
            if (ASSIGN[cslug]) report.assigned.push({ slug: cslug, discipline: `${a.domain}/${a.discipline}` });
            else report.shelved.push({ slug: cslug, provisional: `${a.domain}/${a.discipline}`, suggestNewDiscipline: a.suggest, reason: "needs a new discipline — provisional 'unfiled', re-file on your call" });
        }
        nodes[id].lore = l.body;
    }

    // 3. Edge pass — every node now exists, so targets resolve or are truly
    //    broken. Canonicalise each target; drop staging/self/unknown targets.
    for (const [slug, l] of Object.entries(lore)) {
        const cslug = canon(slug);
        const id = bySlug[cslug];
        if (!id) continue; // hard-shelved lore-only, no node
        for (const target of l.links) {
            const ct = canon(target);
            if (ct === cslug) continue; // self-link
            if (bySlug[ct]) {
                if (!nodes[id].links.includes(ct)) nodes[id].links.push(ct);
            } else {
                report.droppedLinks.push({ from: cslug, to: target, reason: target.startsWith("_inbox") ? "staging target" : "no such node" });
            }
        }
    }

    report.counts = {
        nodes: Object.keys(nodes).length,
        disciplines: Object.keys(disciplines).length,
        edges: Object.values(nodes).reduce((a, n) => a + n.links.length, 0),
        withProgress: Object.values(nodes).filter((n) => n.streak > 0 || n.mastered).length,
        unstarted: Object.values(nodes).filter((n) => !n.mastered && n.streak === 0).length,
    };

    return { quests: Object.values(nodes), disciplines: Object.values(disciplines), report };
}

// ── run ─────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    if (args.includes("--commit")) {
        console.error("--commit is SHELVED: it needs the dev database (spec §11). Dry run only for now.");
        process.exit(2);
    }
    const outIdx = args.indexOf("--out");
    const out = outIdx >= 0 ? args[outIdx + 1] : path.join(os.tmpdir(), "grimoire-migration.json");

    const result = migrate();
    fs.writeFileSync(out, JSON.stringify(result, null, 2));

    const r = result.report;
    const line = (s) => process.stdout.write(s + "\n");
    line("=== Grimoire → mind migration (DRY RUN) ===");
    line(`source: ${GRIMOIRE}`);
    line(`counts: ${JSON.stringify(r.counts)}`);
    line(`\nreconciled drifted slugs (${r.reconciled.length}):`);
    r.reconciled.forEach((x) => line(`  ${x.questSlug} → ${x.canonical}  [${x.discipline}]`));
    line(`\nlore-only → existing discipline (${r.assigned.length}):`);
    r.assigned.forEach((x) => line(`  ${x.slug} → ${x.discipline}`));
    line(`\nSHELVED — needs your decision (${r.shelved.length}):`);
    r.shelved.forEach((x) => line(`  ${x.slug}: ${x.reason}${x.suggestNewDiscipline ? ` (suggest: ${x.suggestNewDiscipline})` : ""}`));
    line(`\ndropped links (${r.droppedLinks.length}):`);
    r.droppedLinks.forEach((x) => line(`  ${x.from} ⇒ ${x.to}  (${x.reason})`));
    line(`\nfull output written to: ${out}`);
}

if (require.main === module) main();
module.exports = { migrate, canon, parseWikilinks, RECONCILE, ASSIGN, SHELVED_ASSIGN };
