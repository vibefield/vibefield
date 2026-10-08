import type { PlaceFacts } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type GroupingDevice,
  type GroupingPlace,
  type GroupingRecord,
  type GroupingResult,
  groupPlaces,
  RECENT,
} from "../src/projects/grouping";
import { projectKey } from "../src/projects/normalize";

// PJ-1 — the grouping engine on small, hand-built desktops: each rule of
// thinking-project-places.md §4 alone (the corpus witness is
// project-grouping-witness.test.ts). Facts are what an owner publishes.

const ROOT_A = "a".repeat(40);
const ROOT_B = "b".repeat(40);
const sha = (n: number): string => n.toString(16).padStart(40, "0");

function place(placeId: string, path: string, over: Partial<PlaceFacts> = {}): PlaceFacts {
  return {
    placeId,
    path,
    aliases: [],
    kind: "project",
    caseless: true,
    exists: true,
    mounted: true,
    git: false,
    remotes: [],
    samples: [],
    hits: [],
    observedAt: 0,
    ...over,
  };
}

const repo = (
  placeId: string,
  path: string,
  remote: string | null,
  over: Partial<PlaceFacts> = {},
) =>
  place(placeId, path, {
    git: true,
    root: ROOT_A,
    ...(remote !== null ? { identityRemote: remote, remotes: [remote] } : {}),
    ...over,
  });

const at = (facts: PlaceFacts, more: Omit<GroupingPlace, "facts"> = {}): GroupingPlace => ({
  facts,
  ...more,
});

const isPlace = (p: PlaceFacts | GroupingPlace): p is GroupingPlace =>
  typeof (p as { facts?: unknown }).facts === "object";

const desk = (deviceId: string, ...places: Array<PlaceFacts | GroupingPlace>): GroupingDevice => ({
  deviceId,
  places: places.map((p) => (isPlace(p) ? p : at(p))),
});

const projectOf = (result: GroupingResult, placeId: string) =>
  result.projects.find((p) =>
    p.places.some((pl) => pl.placeId === placeId || pl.aliasIds.includes(placeId)),
  );
const together = (result: GroupingResult, a: string, b: string): boolean =>
  projectOf(result, a)?.key === projectOf(result, b)?.key;

describe("E1 — the identity remote joins, on any desktop", () => {
  it("joins two clones of one repository across desktops, named like the busiest folder", () => {
    const result = groupPlaces({
      devices: [
        desk(
          "mac",
          at(repo("m1", "/Users/a/Projects/vibe-field", "github.com/o/vibefield"), { sessions: 9 }),
        ),
        desk("box", at(repo("b1", "C:/src/VibeField", "github.com/o/vibefield"), { sessions: 2 })),
      ],
    });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      name: "vibe-field",
      nameFrom: "folder",
      kind: "repo",
      devices: ["box", "mac"],
      sessions: 11,
    });
    expect(result.edges).toEqual([
      { a: "b1", b: "m1", rule: "remote", via: "github.com/o/vibefield" },
    ]);
  });

  it("names the project after the repository when the folder is another word", () => {
    const result = groupPlaces({
      devices: [desk("mac", repo("m1", "/p/web-shell", "github.com/o/terminal"))],
    });
    expect(result.projects[0]).toMatchObject({ name: "terminal", nameFrom: "repository" });
  });

  it("only SUGGESTS on another remote in common (a starter as upstream, C8b)", () => {
    const result = groupPlaces({
      devices: [
        desk(
          "mac",
          repo("alpha", "/apps/alpha", "github.com/me/alpha", {
            remotes: ["github.com/me/alpha", "github.com/me/starter"],
            root: ROOT_B,
          }),
          repo("beta", "/apps/beta", "github.com/me/beta", {
            remotes: ["github.com/me/beta", "github.com/me/starter"],
          }),
        ),
      ],
    });
    expect(together(result, "alpha", "beta")).toBe(false);
    expect(result.suggestions).toEqual([
      {
        id: "rem:alpha|beta",
        type: "shared-remote",
        a: "alpha",
        b: "beta",
        via: "github.com/me/starter",
      },
    ]);
  });
});

describe("E2 — confirmed RECENT shared history", () => {
  const copy = (depth: number) =>
    groupPlaces({
      devices: [
        desk("mac", repo("main", "/p/app", "github.com/o/app")),
        desk(
          "studio",
          repo("copy", "/scratch/app-copy", null, {
            hits: [{ placeId: "main", sha: sha(depth), depth }],
          }),
        ),
      ],
    });

  it(`joins a copy that holds the other's commit from at most ${RECENT} commits back`, () => {
    const result = copy(RECENT);
    expect(together(result, "main", "copy")).toBe(true);
    expect(result.edges).toEqual([
      { a: "copy", b: "main", rule: "history", via: ROOT_A, depth: RECENT },
    ]);
  });

  it("only suggests related history past that, or at the root alone (C8a, C13)", () => {
    const result = copy(RECENT * 2);
    expect(together(result, "main", "copy")).toBe(false);
    expect(result.suggestions.map((s) => [s.type, s.via])).toEqual([["related-history", ROOT_A]]);
  });

  it("never joins on a hit whose places do not share a first commit", () => {
    const result = groupPlaces({
      devices: [
        desk(
          "mac",
          repo("x", "/p/x", null, { hits: [{ placeId: "y", sha: sha(0), depth: 0 }] }),
          repo("y", "/p/y", null, { root: ROOT_B }),
        ),
      ],
    });
    expect(together(result, "x", "y")).toBe(false);
  });

  it("reaches a place by its second spelling (an alias id)", () => {
    const result = groupPlaces({
      devices: [
        desk(
          "box",
          repo("C:/src/App", "C:/src/App", "github.com/o/app"),
          repo("c:/src/app", "c:/src/app", "github.com/o/app"),
        ),
        desk(
          "mac",
          repo("copy", "/p/copy", null, {
            hits: [{ placeId: "c:/src/app", sha: sha(1), depth: 1 }],
          }),
        ),
      ],
    });
    const box = projectOf(result, "C:/src/App")!;
    expect(box.places).toHaveLength(2);
    const spelled = box.places.find((pl) => pl.deviceId === "box")!;
    expect(spelled).toMatchObject({
      placeId: "C:/src/App",
      aliases: ["c:/src/app"],
      aliasIds: ["c:/src/app"],
    });
    expect(together(result, "copy", "C:/src/App")).toBe(true);
  });
});

describe("Temporary is a bucket; each desktop's Home is a project (PJ-L4, J11)", () => {
  it("files temporary and task folders as ONE bucket across desktops", () => {
    const result = groupPlaces({
      devices: [
        desk(
          "mac",
          place("t1", "/private/tmp/x", { kind: "temp" }),
          repo("fixture", "/private/tmp/fixture", null, { kind: "temp" }),
          repo("task", "/Users/a/Documents/Codex/1/2", "github.com/o/app", { kind: "task" }),
        ),
        desk("box", place("t2", "C:/Users/a/AppData/Local/Temp/y", { kind: "temp" })),
      ],
    });
    const temp = result.projects.find((p) => p.bucket === "temp")!;
    expect(temp.places.map((p) => p.placeId).sort()).toEqual(["fixture", "t1", "t2", "task"]);
    expect(temp).toMatchObject({ name: "Temporary", nameFrom: "bucket", kind: "temp" });
    expect(temp.key).toBe(projectKey("bucket:temp"));
  });

  it("J11 — a desktop's home folder, `/` and drive roots are ITS Home: a project, never joined to another desktop's", () => {
    const devices = [
      desk(
        "mac",
        at(place("home", "/Users/a", { kind: "home" }), { sessions: 9, lastAt: 9 }),
        place("root", "/", { kind: "home" }),
        // a dotfiles repository at ~ is still Home, and its remote joins nothing
        repo("dots", "/Users/a/dotfiles", "github.com/a/dotfiles"),
      ),
      desk(
        "box",
        place("home2", "C:/Users/a", { kind: "home" }),
        place("drive", "D:/", { kind: "home" }),
      ),
      desk("studio", repo("home3", "/Users/a", "github.com/a/dotfiles", { kind: "home" })),
    ];
    const result = groupPlaces({ devices });
    const homes = result.projects.filter((p) => p.kind === "home");
    expect(homes.map((p) => p.places.map((pl) => pl.placeId).sort())).toEqual(
      expect.arrayContaining([["home", "root"], ["drive", "home2"], ["home3"]]),
    );
    expect(homes).toHaveLength(3);
    for (const home of homes) {
      expect(home).toMatchObject({
        name: "Home",
        nameFrom: "home",
        bucket: null,
        provisional: true,
      });
      // told apart by its desktop, not by a parent folder ("Users")
      expect(home.disambiguation).toBeUndefined();
      expect(home.key).toMatch(/^p1:/);
    }
    expect(new Set(homes.map((p) => p.key)).size).toBe(3);
    // the studio's home holds the dotfiles remote, and still joins nothing
    expect(together(result, "home3", "dots")).toBe(false);
    expect(result.suggestions.filter((x) => [x.a, x.b].includes("home3"))).toEqual([]);
    // a record binds to a Home like to any project
    const named = groupPlaces({
      devices,
      intents: {
        records: [
          { id: "rec-h", anchors: ["place:home2", "place:drive"], name: "Box", createdAt: 1 },
        ],
      },
    });
    expect(projectOf(named, "home2")).toMatchObject({
      key: "r:rec-h",
      name: "Box",
      nameFrom: "you",
    });
  });

  it("keeps a real clone in a temp folder with its repository", () => {
    const result = groupPlaces({
      devices: [
        desk(
          "mac",
          repo("main", "/p/app", "github.com/o/app"),
          repo("tmp", "/private/tmp/app", "github.com/o/app", { kind: "temp" }),
        ),
      ],
    });
    expect(together(result, "main", "tmp")).toBe(true);
    expect(result.projects[0]!.bucket).toBeNull();
  });
});

describe("suggestions that do not depend on git", () => {
  it("one per pair of projects: the same folder on two desktops, the same name", () => {
    const result = groupPlaces({
      devices: [
        desk("mac", place("m", "/Users/a/research/player", { homeRelative: "research/player" })),
        desk(
          "studio",
          place("s", "/Users/b/research/player", { homeRelative: "Research/player" }),
          place("d", "/Users/b/Desktop/player", { homeRelative: "Desktop/player" }),
        ),
      ],
    });
    expect(result.projects).toHaveLength(3);
    expect(result.suggestions.map((s) => [s.type, s.a, s.b])).toEqual([
      ["same-folder", "m", "s"],
      ["same-name", "m", "d"],
      ["same-name", "d", "s"],
    ]);
  });
});

describe("the person's intents (E3) and records (PJ-L3)", () => {
  const devices = [
    desk("mac", place("m", "/Users/a/research/player", { homeRelative: "research/player" })),
    desk("studio", place("s", "/Users/b/research/player", { homeRelative: "research/player" })),
  ];

  it("a link joins two projects", () => {
    expect(
      together(groupPlaces({ devices, intents: { links: [{ a: "m", b: "s", at: 1 }] } }), "m", "s"),
    ).toBe(true);
  });

  it("binds the oldest record by its anchors: key, name and ink; a later one is also called", () => {
    const facts = [repo("a", "/p/a", "github.com/o/app"), repo("b", "/p/b", "github.com/o/app")];
    const result = groupPlaces({
      devices: [desk("mac", ...facts)],
      intents: {
        records: [
          { id: "r2", anchors: ["remote:github.com/o/app"], name: "Second", createdAt: 2 },
          { id: "r1", anchors: [`root:${ROOT_A}`], name: "Field", ink: 3, createdAt: 1 },
          { id: "r3", anchors: ["place:a"], createdAt: 3 },
        ],
      },
    });
    expect(result.projects[0]).toMatchObject({
      key: "r:r1",
      provisional: false,
      name: "Field",
      nameFrom: "you",
      ink: 3,
      alsoCalled: ["Second"],
      recordId: "r1",
    });
  });

  it("a record's places acted in are acted on every desktop; its pin and hide ride the project", () => {
    const result = groupPlaces({
      devices: [
        desk("mac", repo("a", "/p/a", "github.com/o/app")),
        desk("studio", repo("b", "/q/a", "github.com/o/app")),
      ],
      intents: {
        records: [
          {
            id: "r1",
            anchors: ["remote:github.com/o/app", "place:b"],
            places: [{ placeId: "b", at: 5 }],
            pinned: true,
            hidden: true,
            createdAt: 1,
          },
        ],
      },
    });
    const project = projectOf(result, "a")!;
    expect(project).toMatchObject({ key: "r:r1", pinned: true, hidden: true });
    expect(project.places.map((pl) => [pl.placeId, pl.acted])).toEqual(
      expect.arrayContaining([
        ["a", false],
        ["b", true],
      ]),
    );
  });
});

// PJ-2 (build-pj23.md D2, D3) — splits bound to a record, links and splits
// ordered by their act, dismissals bound to the pair of records.
describe("PJ-2 — splits, links and dismissals as the person made them", () => {
  const app = "github.com/o/app";
  const three = () => [
    desk("mac", repo("a", "/p/a", app), repo("b", "/p/b", app), repo("c", "/p/c", app)),
  ];
  const record = (over: Partial<GroupingRecord> = {}): GroupingRecord => ({
    id: "R",
    anchors: [`root:${ROOT_A}`, `remote:${app}`, "place:a", "place:b", "place:c"],
    name: "App",
    createdAt: 1,
    ...over,
  });

  it("a split keeps its place apart from its record's side, and nothing else", () => {
    const d = repo("d", "/q/d", null, { hits: [{ placeId: "b", sha: sha(2), depth: 2 }] });
    const result = groupPlaces({
      devices: [...three(), desk("studio", d)],
      intents: { records: [record()], splits: [{ place: "b", notRecord: "R", at: 2 }] },
    });
    expect(together(result, "a", "c")).toBe(true);
    expect(projectOf(result, "a")).toMatchObject({ key: "r:R", name: "App" });
    expect(together(result, "a", "b")).toBe(false);
    // the split is bound to R, not global: b still joins d by recent history
    expect(together(result, "b", "d")).toBe(true);
    expect(projectOf(result, "b")!.provisional).toBe(true);
    // and the person's own word is not argued with: no suggestion to re-join
    expect(result.suggestions).toEqual([]);
  });

  it("the split place is the one left out, not its neighbours (a clone that joins through it)", () => {
    // `a` sorts first among the remote's places: were it the hub, `c` could
    // reach R's side only through the split place, and would follow it out
    const result = groupPlaces({
      devices: three(),
      intents: {
        records: [record({ anchors: ["place:b", "place:a"] })],
        splits: [{ place: "a", notRecord: "R", at: 2 }],
      },
    });
    expect(together(result, "b", "c")).toBe(true);
    expect(together(result, "a", "c")).toBe(false);
    expect(projectOf(result, "c")).toMatchObject({ key: "r:R" });
  });

  it("a split gives each record back its side", () => {
    const records = [
      record({ id: "R1", name: "Field", createdAt: 1 }),
      record({ id: "R2", name: "Pocket", anchors: ["place:b"], createdAt: 2 }),
    ];
    const merged = groupPlaces({ devices: three(), intents: { records } });
    expect(projectOf(merged, "b")).toMatchObject({ key: "r:R1", alsoCalled: ["Pocket"] });
    const split = groupPlaces({
      devices: three(),
      intents: { records, splits: [{ place: "b", notRecord: "R1", at: 3 }] },
    });
    expect(projectOf(split, "a")).toMatchObject({ key: "r:R1", name: "Field" });
    expect(projectOf(split, "b")).toMatchObject({ key: "r:R2", name: "Pocket", nameFrom: "you" });
    expect(projectOf(split, "a")!.alsoCalled).toBeUndefined();
  });

  it("for a pair, the later act wins: an older link does not re-join a split place; a newer one lifts the split", () => {
    const links = (at: number) => [{ a: "b", b: "a", at }];
    const splits = [{ place: "b", notRecord: "R", at: 20 }];
    const older = groupPlaces({
      devices: three(),
      intents: { records: [record()], splits, links: links(10) },
    });
    expect(together(older, "a", "b")).toBe(false);
    const newer = groupPlaces({
      devices: three(),
      intents: { records: [record()], splits, links: links(30) },
    });
    expect(together(newer, "a", "b")).toBe(true);
    expect(together(newer, "b", "c")).toBe(true);
    // lifted, the split no longer keeps R from the group that holds b
    expect(projectOf(newer, "b")).toMatchObject({ key: "r:R" });
    // a tie is the split's: nothing joins without a clear later word
    const tie = groupPlaces({
      devices: three(),
      intents: { records: [record()], splits, links: links(20) },
    });
    expect(together(tie, "a", "b")).toBe(false);
  });

  it("a dismissal binds to the pair of records: no second reason surfaces for the same two projects", () => {
    // two reasons for one pair: an old shared first commit and the same folder
    const pair = [
      desk(
        "mac",
        repo("m", "/Users/a/research/player", null, {
          root: ROOT_B,
          homeRelative: "research/player",
        }),
      ),
      desk(
        "studio",
        repo("s", "/Users/b/research/player", null, {
          root: ROOT_B,
          homeRelative: "research/player",
        }),
      ),
    ];
    const before = groupPlaces({ devices: pair });
    expect(before.suggestions.map((x) => x.type)).toEqual(["related-history"]);
    const records: GroupingRecord[] = [
      { id: "Rm", anchors: ["place:m"], createdAt: 1 },
      { id: "Rs", anchors: ["place:s"], createdAt: 2 },
    ];
    const after = groupPlaces({ devices: pair, intents: { records, dismissals: [["Rs", "Rm"]] } });
    expect(after.suggestions).toEqual([]);
    // a dismissal of other records says nothing about this pair
    const other = groupPlaces({ devices: pair, intents: { records, dismissals: [["Rm", "Rx"]] } });
    expect(other.suggestions).toHaveLength(1);
  });
});

describe("keys and determinism (PJ-L1)", () => {
  const devices = [
    desk(
      "mac",
      at(repo("m1", "/p/app", "github.com/o/app"), { sessions: 3, lastAt: 5 }),
      at(repo("m2", "/p/app-2", "github.com/o/app"), { sessions: 3, lastAt: 4 }),
      at(place("f", "/p/notes"), { lastAt: 9 }),
      repo("old", "/p/fork", null, { hits: [{ placeId: "m1", sha: sha(9), depth: 64 }] }),
    ),
    desk("studio", repo("s1", "/q/app", "github.com/o/app"), place("n", "/q/notes")),
  ];

  it("answers the same projects whatever order the replica delivered the facts in", () => {
    const shuffled = [...devices].reverse().map((d) => ({ ...d, places: [...d.places].reverse() }));
    expect(groupPlaces({ devices: shuffled })).toEqual(groupPlaces({ devices }));
  });

  it("keys a project by its strongest anchor no other group holds, opaquely", () => {
    const result = groupPlaces({ devices });
    const app = projectOf(result, "m1")!;
    // the root is shared with the drifted fork, so the remote is the identity
    expect(app.key).toBe(projectKey("remote:github.com/o/app"));
    expect(projectOf(result, "old")!.key).toBe(projectKey("place:old"));
    for (const p of result.projects) expect(p.key).toMatch(/^p1:[a-z2-7]{26}$/);
    expect(new Set(result.projects.map((p) => p.key)).size).toBe(result.projects.length);
    expect(result.groupingVersion).toBe(2);
  });

  it("gives two projects that read alike their parent folder as a second line", () => {
    const result = groupPlaces({ devices });
    expect(result.projects.filter((p) => p.name === "notes").map((p) => p.disambiguation)).toEqual(
      expect.arrayContaining(["p", "q"]),
    );
  });

  it("drops a second claimant of a placeId rather than letting it share a key", () => {
    const result = groupPlaces({
      devices: [desk("mac", place("same", "/p/one")), desk("studio", place("same", "/q/two"))],
    });
    expect(result.projects.map((p) => p.places.map((pl) => pl.path))).toEqual([["/p/one"]]);
  });
});
