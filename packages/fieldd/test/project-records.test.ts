// PJ-2 (build-pj23.md D4, D7; P3) — the person's acts on projects, through the
// in-process ProjectRecords service over a real library and the real grouping
// on one desktop (the two-desktop witness is project-records-witness.test.ts):
//   · a project's first act makes its record — anchored as the project stands,
//     the provisional ink frozen (P3), the key moved to `r:` and still
//     answered by its old name; later acts add to the same record;
//   · the frozen ink holds when the provisional identity moves under it;
//   · split, link and dismiss as the engine reads them (D2, D3);
//   · a person's launch records the place it ran in (D6); a folder no place
//     holds yet waits for the grouping that has it; Home makes no record;
//   · the refusals: a bucket, an unknown key, a place not the project's, a
//     bad name, a project with itself, no library yet.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexCatalogProject, IndexCatalogSession, PlaceFacts } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogTable } from "../src/catalog-rows";
import { LibraryDocService, systemAccount, systemDocId } from "../src/library-doc";
import { provisionalInk } from "../src/projects/normalize";
import { ProjectGroups } from "../src/projects/project-groups";
import { ProjectRecords, ProjectRecordsRefusal } from "../src/projects/project-records";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const ROOT = "a".repeat(40);
const APP = "github.com/o/app";

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
    observedAt: 1,
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
    root: ROOT,
    ...(remote !== null ? { identityRemote: remote, remotes: [remote] } : {}),
    ...over,
  });

/** One desktop: its catalog rows, a library, the grouping and the records. */
async function desktop(places: PlaceFacts[], opts: { library?: boolean } = {}) {
  const projects = new CatalogTable<IndexCatalogProject>({ epoch: "e", keyOf: (r) => r.projectId });
  const sessions = new CatalogTable<IndexCatalogSession>({ epoch: "e", keyOf: (r) => r.sessionId });
  const setPlaces = (list: PlaceFacts[]) =>
    projects.replaceAll([
      { device: "dev-a", projectId: "p", name: "p", rootPaths: [], sessionCount: 0, places: list },
    ]);
  setPlaces(places);
  const dir = mkdtempSync(join(tmpdir(), "vf-precords-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const library = new LibraryDocService({
    dataDir: dir,
    docId: systemDocId("library", systemAccount(null, "fuid")),
  });
  await library.ready();
  const mounted = opts.library === false ? null : library;
  const groups = new ProjectGroups({
    deviceId: () => "dev-a",
    local: { projects, sessions },
    intents: () => mounted?.projectIntents() ?? null,
    settleMs: 5,
  });
  groups.followLibrary(mounted);
  groups.start();
  cleanup.push(() => groups.dispose());
  let clock = 1_000;
  let ids = 0;
  const folders = new Map<string, string>();
  const records = new ProjectRecords({
    library: () => mounted,
    groups,
    placeOf: (cwd) => {
      let best: string | null = null;
      let length = -1;
      for (const [path, id] of folders)
        if ((cwd === path || cwd.startsWith(`${path}/`)) && path.length > length)
          [best, length] = [id, path.length];
      return best;
    },
    now: () => (clock += 10),
    newId: () => `rec-${++ids}`,
  });
  cleanup.push(() => records.dispose());
  const now = () => groups.regroupNow()!.result;
  const of = (placeId: string) =>
    now().projects.find((p) => p.places.some((pl) => pl.placeId === placeId))!;
  return { library, groups, records, setPlaces, folders, now, of };
}

const until = async (predicate: () => boolean, what: string) => {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("PJ-2 — ProjectRecords: a record is made by an act", () => {
  it("the first act makes the record: anchored, the provisional ink frozen, the key moved", async () => {
    const d = await desktop([repo("a", "/p/app", APP), repo("b", "/q/app", APP)]);
    const before = d.of("a");
    expect(before.provisional).toBe(true);
    const renamed = await d.records.intent(before.key, { op: "rename", name: " Field " }, "test");
    expect(renamed).toEqual({ key: "r:rec-1", recordId: "rec-1", wrote: true });
    expect(d.of("a")).toMatchObject({
      key: "r:rec-1",
      name: "Field",
      nameFrom: "you",
      ink: before.ink,
      provisional: false,
    });
    const [record] = d.library.projectIntents().records;
    expect(record).toMatchObject({ id: "rec-1", ink: before.ink, name: "Field" });
    expect(record!.anchors).toEqual([`root:${ROOT}`, `remote:${APP}`, "place:a", "place:b"]);

    // the old key still names it here; a later act adds to the same record
    await d.records.intent(before.key, { op: "pin", pinned: true }, "test");
    await d.records.intent("r:rec-1", { op: "hide", hidden: true }, "test");
    expect(d.library.projectIntents().records).toHaveLength(1);
    expect(d.of("a")).toMatchObject({ key: "r:rec-1", pinned: true, hidden: true });
    // an act that changes nothing commits nothing
    expect((await d.records.intent("r:rec-1", { op: "pin", pinned: true }, "test")).wrote).toBe(
      false,
    );
  });

  it("P3 — the frozen ink holds when the provisional identity moves under it", async () => {
    const app = repo("a", "/p/app", APP);
    // a drifted fork shares the first commit: the root stops being unique
    const fork = repo("f", "/p/fork", "github.com/me/fork");
    const control = await desktop([app]);
    const acted = await desktop([app]);
    const ink = acted.of("a").ink;
    expect(ink).toBe(provisionalInk(`root:${ROOT}`));
    await acted.records.intent(acted.of("a").key, { op: "pin", pinned: true }, "test");
    control.setPlaces([app, fork]);
    acted.setPlaces([app, fork]);
    // the record-less project's ink moved with its identity; the record's did not
    expect(control.of("a").ink).toBe(provisionalInk(`remote:${APP}`));
    expect(control.of("a").ink).not.toBe(ink);
    expect(acted.of("a").ink).toBe(ink);
  });

  it("split, link and dismiss write what the engine reads (D2, D3)", async () => {
    const d = await desktop([
      repo("a", "/p/app", APP),
      repo("b", "/q/app", APP),
      place("m", "/Users/ada/research/player", { homeRelative: "research/player" }),
      place("n", "/Users/ada/notes/player"),
    ]);
    // split b from its project: the record keeps a's side
    const app = d.of("a");
    const split = await d.records.intent(app.key, { op: "split", place: "b" }, "test");
    expect(d.of("a").key).toBe(split.key);
    expect(d.of("b").key).not.toBe(split.key);
    expect(d.library.projectIntents().splits).toEqual([
      { place: "b", notRecord: split.recordId, at: expect.any(Number) },
    ]);
    // the same-name suggestion between m and n, dismissed: both get a record
    expect(d.now().suggestions.map((s) => s.type)).toEqual(["same-name"]);
    await d.records.intent(d.of("m").key, { op: "dismiss", with: d.of("n").key }, "test");
    expect(d.now().suggestions).toEqual([]);
    expect(d.of("m").provisional || d.of("n").provisional).toBe(false);
    // link m and n: one project, its record holding both sides' anchors
    const linked = await d.records.intent(
      d.of("m").key,
      { op: "link", with: d.of("n").key },
      "test",
    );
    expect(d.of("n").key).toBe(d.of("m").key);
    expect(d.of("m").places).toHaveLength(2);
    expect(linked.key).toBe(d.of("m").key);
  });

  it("D6 — a launch records its place; one in a folder no place holds waits; Temporary makes none", async () => {
    const d = await desktop([
      repo("a", "/p/app", APP),
      place("h", "/Users/ada", { kind: "home" }),
      place("t", "/private/tmp/x", { kind: "temp" }),
    ]);
    d.folders.set("/p/app", "a");
    d.folders.set("/Users/ada", "h");
    d.folders.set("/private/tmp/x", "t");
    d.records.actedIn("/p/app/src", 5_000);
    d.records.actedIn("/private/tmp/x", 5_001);
    d.records.actedIn("/p/later", 5_002);
    await until(() => d.library.projectIntents().records.length === 1, "the launch's record");
    expect(d.library.projectIntents().records[0]).toMatchObject({
      places: [{ placeId: "a", at: 5_000 }],
    });
    expect(d.of("a").places[0]!.acted).toBe(true);
    // the folder becomes a place, and the grouping that has it records the act
    d.setPlaces([
      repo("a", "/p/app", APP),
      place("h", "/Users/ada", { kind: "home" }),
      place("t", "/private/tmp/x", { kind: "temp" }),
      place("l", "/p/later"),
    ]);
    d.folders.set("/p/later", "l");
    d.groups.regroupNow();
    await until(() => d.library.projectIntents().records.length === 2, "the later place's record");
    expect(d.of("l")).toMatchObject({ provisional: false });
    expect(d.of("t").recordId).toBeUndefined();
    // J11 — a desktop's Home is a project: a launch there is an act like any
    d.records.actedIn("/Users/ada", 5_003);
    await until(() => d.library.projectIntents().records.length === 3, "Home's record");
    expect(d.of("h")).toMatchObject({ name: "Home", provisional: false });
  });

  it("refuses an act on Temporary, an unknown key, a place not the project's, a bad name, itself, Home's links", async () => {
    const d = await desktop([
      repo("a", "/p/app", APP),
      repo("b", "/q/app", APP),
      place("solo", "/p/solo"),
      place("h", "/Users/ada", { kind: "home" }),
      place("root", "/", { kind: "home" }),
      place("t", "/private/tmp/x", { kind: "temp" }),
    ]);
    const code = async (work: Promise<unknown>) => {
      try {
        await work;
        return "wrote";
      } catch (error) {
        return error instanceof ProjectRecordsRefusal ? error.code : String(error);
      }
    };
    const app = d.of("a").key;
    const home = d.of("h").key;
    expect(await code(d.records.intent(d.of("t").key, { op: "pin", pinned: true }, "t"))).toBe(
      "bucket",
    );
    expect(await code(d.records.intent("p1:nothing", { op: "pin", pinned: true }, "t"))).toBe(
      "not-found",
    );
    expect(await code(d.records.intent(app, { op: "split", place: "solo" }, "t"))).toBe(
      "not-in-project",
    );
    expect(
      await code(d.records.intent(d.of("solo").key, { op: "split", place: "solo" }, "t")),
    ).toBe("not-in-project");
    expect(await code(d.records.intent(app, { op: "rename", name: "  " }, "t"))).toBe("invalid");
    expect(await code(d.records.intent(app, { op: "rename", name: "x".repeat(201) }, "t"))).toBe(
      "invalid",
    );
    expect(await code(d.records.intent(app, { op: "link", with: app }, "t"))).toBe("invalid");
    expect(await code(d.records.intent(app, { op: "dismiss", with: d.of("t").key }, "t"))).toBe(
      "bucket",
    );
    // J11 — Home groups by its desktop alone
    expect(await code(d.records.intent(app, { op: "link", with: home }, "t"))).toBe("home");
    expect(await code(d.records.intent(home, { op: "dismiss", with: app }, "t"))).toBe("home");
    expect(await code(d.records.intent(home, { op: "split", place: "root" }, "t"))).toBe("home");
    expect(d.library.projectIntents().records).toEqual([]);
    // and is renamed like any project
    expect(await code(d.records.intent(home, { op: "rename", name: "Studio home" }, "t"))).toBe(
      "wrote",
    );
    expect(d.of("root")).toMatchObject({ name: "Studio home", nameFrom: "you" });

    const none = await desktop([repo("a", "/p/app", APP)], { library: false });
    expect(
      await code(none.records.intent(none.of("a").key, { op: "pin", pinned: true }, "t")),
    ).toBe("unavailable");
  });
});
