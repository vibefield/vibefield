import type { PlaceFacts } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type GroupingDevice,
  type GroupingPlace,
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

describe("the buckets (PJ-L4)", () => {
  it("files home, temporary and task folders as two buckets across desktops", () => {
    const result = groupPlaces({
      devices: [
        desk(
          "mac",
          place("home", "/Users/a", { kind: "home" }),
          place("root", "/", { kind: "home" }),
          place("t1", "/private/tmp/x", { kind: "temp" }),
          repo("fixture", "/private/tmp/fixture", null, { kind: "temp" }),
          repo("task", "/Users/a/Documents/Codex/1/2", "github.com/o/app", { kind: "task" }),
        ),
        desk("box", place("home2", "C:/Users/a", { kind: "home" })),
      ],
    });
    const home = result.projects.find((p) => p.bucket === "home")!;
    const temp = result.projects.find((p) => p.bucket === "temp")!;
    expect(home.places.map((p) => p.placeId).sort()).toEqual(["home", "home2", "root"]);
    expect(temp.places.map((p) => p.placeId).sort()).toEqual(["fixture", "t1", "task"]);
    expect([home.name, temp.name]).toEqual(["Home", "Temporary"]);
    expect(home.key).toBe(projectKey("bucket:home"));
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

  it("a link joins, a dismissal hides its suggestion, a split takes a place out of the evidence", () => {
    expect(together(groupPlaces({ devices, intents: { links: [["m", "s"]] } }), "m", "s")).toBe(
      true,
    );
    expect(groupPlaces({ devices, intents: { dismissed: ["rel:m|s"] } }).suggestions).toEqual([]);
    const split = groupPlaces({
      devices: [
        desk("mac", repo("a", "/p/a", "github.com/o/app"), repo("b", "/p/b", "github.com/o/app")),
      ],
      intents: { splits: ["b"] },
    });
    expect(together(split, "a", "b")).toBe(false);
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
    expect(result.groupingVersion).toBe(1);
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
