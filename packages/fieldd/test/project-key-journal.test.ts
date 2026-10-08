// PJ-3 (D9) — the projects' key memory (key-journal.ts): a key that moves is
// inferred from where its places went — a merge, a first record (`p1:` →
// `r:`), an anchor that stopped being unique (through the real engine, in
// ProjectGroups) — followed as a chain, bounded, and kept across a restart
// and across a grouping that briefly lacked a place.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexCatalogProject, IndexCatalogSession, PlaceFacts } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogTable } from "../src/catalog-rows";
import { KeyJournal } from "../src/projects/key-journal";
import { projectKey } from "../src/projects/normalize";
import { ProjectGroups, type ProjectGroupsChange } from "../src/projects/project-groups";

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-pj3-keys-"));
  dirs.push(dir);
  return dir;
}

const current =
  (...keys: string[]) =>
  (key: string): boolean =>
    keys.includes(key);

describe("the key journal infers moves from where places went (D9)", () => {
  it("records nothing on a first sight, and nothing while a key stays", () => {
    const journal = new KeyJournal();
    expect(journal.observe([{ key: "p1:a", placeIds: ["pl-1", "pl-2"] }])).toEqual([]);
    expect(journal.observe([{ key: "p1:a", placeIds: ["pl-1", "pl-2"] }])).toEqual([]);
    // a split where the old key survives on one side is no move
    expect(
      journal.observe([
        { key: "p1:a", placeIds: ["pl-1"] },
        { key: "p1:b", placeIds: ["pl-2"] },
      ]),
    ).toEqual([]);
    expect(journal.moves()).toEqual([]);
  });

  it("a merge moves the key that is gone into the one that holds its places", () => {
    let now = 100;
    const journal = new KeyJournal({ now: () => now });
    journal.observe([
      { key: "p1:a", placeIds: ["pl-1"] },
      { key: "p1:b", placeIds: ["pl-2"] },
    ]);
    now = 200;
    expect(journal.observe([{ key: "p1:a", placeIds: ["pl-1", "pl-2"] }])).toEqual([
      { from: "p1:b", to: "p1:a", at: 200 },
    ]);
    expect(journal.movedTo("p1:b", current("p1:a"))).toBe("p1:a");
    expect(journal.movedTo("p1:zzz", current("p1:a"))).toBeUndefined();
  });

  it("a first record re-keys `p1:` → `r:` with the same places", () => {
    const journal = new KeyJournal();
    journal.observe([{ key: "p1:a", placeIds: ["pl-1", "pl-2"] }]);
    expect(
      journal.observe([{ key: "r:rec-1", placeIds: ["pl-1", "pl-2"] }]).map((m) => m.to),
    ).toEqual(["r:rec-1"]);
    expect(journal.movedTo("p1:a", current("r:rec-1"))).toBe("r:rec-1");
  });

  it("a scattered key goes where most of its places went; a tie to the smaller key", () => {
    const journal = new KeyJournal();
    journal.observe([{ key: "p1:a", placeIds: ["pl-1", "pl-2", "pl-3"] }]);
    const moves = journal.observe([
      { key: "p1:x", placeIds: ["pl-1"] },
      { key: "p1:y", placeIds: ["pl-2", "pl-3"] },
    ]);
    expect(moves.map((m) => [m.from, m.to])).toEqual([["p1:a", "p1:y"]]);
    const tied = new KeyJournal();
    tied.observe([{ key: "p1:a", placeIds: ["pl-1", "pl-2"] }]);
    expect(
      tied
        .observe([
          { key: "p1:z", placeIds: ["pl-1"] },
          { key: "p1:m", placeIds: ["pl-2"] },
        ])
        .map((m) => m.to),
    ).toEqual(["p1:m"]);
  });

  it("follows a chain to the key that holds the places now, and stops at a dead end", () => {
    const journal = new KeyJournal();
    journal.observe([{ key: "p1:a", placeIds: ["pl-1"] }]);
    journal.observe([{ key: "p1:b", placeIds: ["pl-1"] }]);
    journal.observe([{ key: "r:c", placeIds: ["pl-1"] }]);
    expect(journal.movedTo("p1:a", current("r:c"))).toBe("r:c");
    expect(journal.movedTo("p1:b", current("r:c"))).toBe("r:c");
    // its places all gone: the chain leads nowhere a project stands
    expect(journal.movedTo("p1:a", current())).toBeUndefined();
  });

  it("a place a grouping briefly lacked keeps its last key — the move is seen when it returns", () => {
    const journal = new KeyJournal();
    journal.observe([{ key: "p1:mine", placeIds: ["pl-mac"] }]);
    // a boot whose own rows have not arrived: the place is absent, not moved
    expect(journal.observe([{ key: "p1:peer", placeIds: ["pl-studio"] }])).toEqual([]);
    // the rows arrive, and the mac's place now groups with the Studio's
    expect(
      journal
        .observe([{ key: "p1:joined", placeIds: ["pl-mac", "pl-studio"] }])
        .map((m) => [m.from, m.to]),
    ).toEqual([
      ["p1:mine", "p1:joined"],
      ["p1:peer", "p1:joined"],
    ]);
  });

  it("bounds what it remembers: the oldest moves, the least recently seen places", () => {
    const journal = new KeyJournal({ movesMax: 2, placesMax: 3 });
    journal.observe([{ key: "k0", placeIds: ["pl-1"] }]);
    for (let i = 1; i <= 4; i += 1) journal.observe([{ key: `k${i}`, placeIds: ["pl-1"] }]);
    expect(journal.moves().map((m) => m.from)).toEqual(["k2", "k3"]);
    journal.observe([{ key: "a", placeIds: ["pl-2", "pl-3", "pl-4", "pl-5"] }]);
    expect(journal.places).toBe(3);
  });
});

describe("the key journal persists (it survives a restart)", () => {
  it("answers movedTo after a restart, and diffs the next grouping against the last one", () => {
    const file = join(scratch(), "projects", "keys.json");
    const before = new KeyJournal({ file });
    before.observe([
      { key: "p1:a", placeIds: ["pl-1"] },
      { key: "p1:b", placeIds: ["pl-2"] },
    ]);
    before.observe([{ key: "p1:a", placeIds: ["pl-1", "pl-2"] }]);
    // opaque keys and placeIds only
    const written = readFileSync(file, "utf8");
    expect(JSON.parse(written)).toMatchObject({ format: 1 });
    const after = new KeyJournal({ file });
    expect(after.movedTo("p1:b", current("p1:a"))).toBe("p1:a");
    // the first grouping after the restart re-keys the project: a move from
    // the key it held before the restart
    expect(
      after.observe([{ key: "r:rec", placeIds: ["pl-1", "pl-2"] }]).map((m) => m.from),
    ).toEqual(["p1:a"]);
    expect(after.movedTo("p1:b", current("r:rec"))).toBe("r:rec");
  });

  it("reads a damaged or foreign file as nothing, and a bad row as absent", () => {
    const dir = scratch();
    const garbage = join(dir, "garbage.json");
    writeFileSync(garbage, "{not json");
    expect(new KeyJournal({ file: garbage }).moves()).toEqual([]);
    const mixed = join(dir, "mixed.json");
    writeFileSync(
      mixed,
      JSON.stringify({
        format: 1,
        places: [["pl-1", "p1:a", 1], ["pl-2", 7, 1], "nope"],
        moves: [
          ["p1:x", "p1:a", 5],
          [1, 2, 3],
        ],
      }),
    );
    const journal = new KeyJournal({ file: mixed });
    expect(journal.places).toBe(1);
    expect(journal.moves()).toEqual([{ from: "p1:x", to: "p1:a", at: 5 }]);
    const future = join(dir, "future.json");
    writeFileSync(future, JSON.stringify({ format: 2, moves: [["p1:x", "p1:a", 5]] }));
    expect(new KeyJournal({ file: future }).moves()).toEqual([]);
  });
});

// ── through the engine ──────────────────────────────────────────────────────

const sha = (n: number) => n.toString(16).padStart(40, "0");

function place(placeId: string, path: string, over: Partial<PlaceFacts> = {}): PlaceFacts {
  return {
    placeId,
    path,
    aliases: [],
    kind: "project",
    caseless: true,
    exists: true,
    mounted: true,
    git: true,
    remotes: [],
    samples: [],
    hits: [],
    observedAt: 1,
    ...over,
  };
}

function row(projectId: string, places: PlaceFacts[]): IndexCatalogProject {
  return { device: "dev-a", projectId, name: projectId, rootPaths: [], sessionCount: 0, places };
}

function tables() {
  return {
    projects: new CatalogTable<IndexCatalogProject>({ epoch: "e", keyOf: (r) => r.projectId }),
    sessions: new CatalogTable<IndexCatalogSession>({ epoch: "e", keyOf: (r) => r.sessionId }),
  };
}

describe("ProjectGroups diffs each change of the grouping into the journal", () => {
  it("an anchor that stops being unique moves the key, and the listeners hear it", () => {
    const local = tables();
    const root = sha(7);
    const app = place("pl-app", "/Users/ada/app", {
      root,
      identityRemote: "github.com/acme/app",
      remotes: ["github.com/acme/app"],
    });
    local.projects.upsert([row("p-app", [app])]);
    const journal = new KeyJournal();
    const groups = new ProjectGroups({ deviceId: () => "dev-a", local, journal });
    const heard: ProjectGroupsChange[] = [];
    groups.onChange((change) => heard.push(change));
    const first = groups.regroupNow();
    // alone, the project's identity is its first commit
    const rootKey = projectKey(`root:${root}`);
    expect(first?.result.projects[0]?.key).toBe(rootKey);
    // a fork of the same first commit appears (another identity remote, no
    // recent history in common): only a suggestion, but the first commit is
    // no longer the app's alone, so its key falls back to its remote
    const fork = place("pl-fork", "/Users/ada/fork", {
      root,
      identityRemote: "github.com/other/fork",
      remotes: ["github.com/other/fork"],
    });
    local.projects.upsert([row("p-fork", [fork])]);
    const second = groups.regroupNow();
    const remoteKey = projectKey("remote:github.com/acme/app");
    const moved = second?.result.projects.find((p) =>
      p.places.some((pl) => pl.placeId === "pl-app"),
    );
    expect(moved?.key).toBe(remoteKey);
    expect(heard.at(-1)?.moves.map((m) => [m.from, m.to])).toEqual([[rootKey, remoteKey]]);
    expect(groups.movedTo(rootKey)).toBe(remoteKey);
    expect(groups.movedTo(remoteKey)).toBeUndefined();
    // a recompute that moves no key tells the listeners so
    local.sessions.upsert([
      {
        device: "dev-a",
        sessionId: "s1",
        nativeSessionId: "n1",
        cwd: "/Users/ada/app",
        activity: { firstAt: 1, lastAt: 2 },
        streamState: "indexed",
      } as IndexCatalogSession,
    ]);
    groups.regroupNow();
    expect(heard.at(-1)?.moves).toEqual([]);
    expect(heard).toHaveLength(3);
  });
});
