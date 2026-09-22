// Regression guards for the migration's two tricky spots: Obsidian alias
// parsing and drifted-slug reconciliation. The full transformation is proven
// by the dry run against real Grimoire data; these lock the parsing rules.
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const { canon, parseWikilinks } = require("./migrate-grimoire");

describe("parseWikilinks", () => {
    it("keeps the target slug, drops the display alias", () => {
        expect(parseWikilinks("see [[bittorrent-peer-connections|independent connections]]")).toEqual([
            "bittorrent-peer-connections",
        ]);
    });

    it("collapses a link that wraps across a newline", () => {
        expect(parseWikilinks("[[bittorrent-peer-connections|independent\nconnections]]")).toEqual([
            "bittorrent-peer-connections",
        ]);
    });

    it("dedupes repeated links and handles several in one doc", () => {
        const md = "[[tcp-ip-model]] and [[transport-tcp-vs-udp]] and [[tcp-ip-model]] again";
        expect(parseWikilinks(md).sort()).toEqual(["tcp-ip-model", "transport-tcp-vs-udp"]);
    });

    it("returns nothing when there are no links", () => {
        expect(parseWikilinks("plain prose, no links")).toEqual([]);
    });
});

describe("canon (drifted-slug reconciliation)", () => {
    it("maps each drifted quest slug to its canonical lore slug", () => {
        expect(canon("per-piece-hash-verification")).toBe("bittorrent-piece-hashing");
        expect(canon("encapsulation-decapsulation")).toBe("encapsulation-and-decapsulation");
        expect(canon("transport-vs-auth-phases")).toBe("ssh-transport-vs-auth-phases");
    });

    it("leaves an already-canonical slug unchanged", () => {
        expect(canon("dns-listening-mode")).toBe("dns-listening-mode");
        expect(canon("tcp-ip-model")).toBe("tcp-ip-model");
    });
});
