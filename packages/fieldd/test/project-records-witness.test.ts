// PJ-2's witness (build-pj23.md D7; `thinking-project-places.md` §9 Slices:
// "a rename made on one desktop reads on the other; a split gives each record
// back its side") — two desktops, each with its own library on the
// Loro-level host, joined by the in-process doc mesh (doc-mesh-harness.ts, as
// doc-library.test.ts's two-desktop rows), each running ProjectRecords and
// the grouping over its own places and the other's. The records cross the
// doc plane for real; the place rows the peer's grouping reads are handed
// over directly (their replica path is PJ-1's, index-mesh.test.ts).
//   · a rename made on A reads on B, `nameFrom: "you"`;
//   · a split made on A gives each record back its side on B;
//   · concurrent renames converge to one name on both;
//   · two desktops' first acts at once freeze the same ink (P3) and agree;
//   · an OLDER desktop holding the library leaves the records intact;
//   · a window's act through PJ-3's real door (ProjectDoors.intent →
//     projectIntentWriter → ProjectRecords) is a record the other desktop's
//     door answers: a rename, a split and a link by PlaceRef, the refusals
//     the door's own.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DocLibraryEntry,
  type IndexCatalogProject,
  type IndexCatalogSession,
  type PlaceFacts,
  ProjectGetParams,
  ProjectIntentParams,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogTable } from "../src/catalog-rows";
import { LibraryDocService, systemAccount, systemDocId } from "../src/library-doc";
import { RpcCallError } from "../src/native-link";
import type { GroupedProject } from "../src/projects/grouping";
import { ProjectDoors } from "../src/projects/project-doors";
import { ProjectGroups } from "../src/projects/project-groups";
import { ProjectRecords, projectIntentWriter } from "../src/projects/project-records";
import { PROJECT_MAPS } from "../src/projects/records-doc";
import { Device, Mesh } from "./doc-mesh-harness";

let dirs: string[] = [];
let stops: Array<() => void> = [];
afterEach(async () => {
  for (const stop of stops.reverse()) stop();
  stops = [];
  await new Promise((r) => setTimeout(r, 60));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
vi.setConfig({ testTimeout: 15_000 });

const tmp = (tag: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `vf-pjw-${tag}-`));
  dirs.push(dir);
  return dir;
};

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 1_000; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const ACCOUNT = systemAccount("ada@example.com", "fuid-a");
const LIBRARY = systemDocId("library", ACCOUNT);
const APP = "github.com/o/app";
const ROOT_A = "a".repeat(40);
const ROOT_B = "b".repeat(40);

function repo(placeId: string, path: string, over: Partial<PlaceFacts> = {}): PlaceFacts {
  return {
    placeId,
    path,
    aliases: [],
    kind: "project",
    caseless: true,
    exists: true,
    mounted: true,
    git: true,
    root: ROOT_A,
    identityRemote: APP,
    remotes: [APP],
    samples: [],
    hits: [],
    observedAt: 1,
    ...over,
  };
}

/** One desktop: a library on the host, its places, the grouping, the records. */
interface Desk {
  name: string;
  device: Device;
  library: LibraryDocService;
  groups: ProjectGroups;
  records: ProjectRecords;
  places: PlaceFacts[];
  setPlaces(places: PlaceFacts[]): void;
  /** the project holding a place, as this desktop groups it now */
  of(placeId: string): GroupedProject;
}

/** A clock both desktops read, so "older" is a fact the test chooses. */
let clock = 1_000;

async function desk(mesh: Mesh, name: string, peer: () => Desk | undefined): Promise<Desk> {
  const dataDir = tmp(name);
  const device = new Device(name, mesh, dataDir);
  const library = new LibraryDocService({ dataDir, docId: LIBRARY });
  await library.ready();
  device.docs.registerSystemDoc(LIBRARY, "Library", library.doc, library.hostOwner());
  mesh.devices.set(name, device);
  const projects = new CatalogTable<IndexCatalogProject>({ epoch: "e", keyOf: (r) => r.projectId });
  const sessions = new CatalogTable<IndexCatalogSession>({ epoch: "e", keyOf: (r) => r.sessionId });
  const row = (device: string, places: PlaceFacts[]): IndexCatalogProject => ({
    device,
    projectId: `${device}-p`,
    name: "p",
    rootPaths: [],
    sessionCount: 0,
    places,
  });
  const groups = new ProjectGroups({
    deviceId: () => name,
    local: { projects, sessions },
    peers: () => {
      const other = peer();
      return other === undefined
        ? []
        : [{ device: other.name, projects: [row(other.name, other.places)], sessions: [] }];
    },
    intents: () => library.projectIntents(),
    settleMs: 5,
  });
  groups.followLibrary(library);
  groups.start();
  let ids = 0;
  const records = new ProjectRecords({
    library: () => library,
    groups,
    now: () => (clock += 10),
    newId: () => `${name}-rec-${++ids}`,
  });
  stops.push(
    () => records.dispose(),
    () => groups.dispose(),
  );
  const self: Desk = {
    name,
    device,
    library,
    groups,
    records,
    places: [],
    setPlaces(places) {
      self.places = places;
      projects.replaceAll([row(name, places)]);
    },
    of(placeId) {
      const result = groups.regroupNow()!.result;
      return result.projects.find((p) => p.places.some((pl) => pl.placeId === placeId))!;
    },
  };
  return self;
}

async function pair(aPlaces: PlaceFacts[], bPlaces: PlaceFacts[]): Promise<[Desk, Desk, Mesh]> {
  const mesh = new Mesh();
  let a: Desk | undefined;
  let b: Desk | undefined;
  a = await desk(mesh, "A", () => b);
  b = await desk(mesh, "B", () => a);
  a.setPlaces(aPlaces);
  b.setPlaces(bPlaces);
  await a.device.sync.start();
  await b.device.sync.start();
  return [a, b, mesh];
}

/** Partition the two, run `work`, heal, and have each greet the other again. */
async function apart(mesh: Mesh, desks: Desk[], work: () => Promise<unknown>): Promise<void> {
  mesh.drop = () => true;
  await work();
  mesh.drop = null;
  for (const d of desks) d.device.sync.replicate([LIBRARY], { regreet: true });
}

describe("PJ-2 — the two-desktop witness (D7)", () => {
  it("a rename made on desktop A reads on desktop B, named by you", async () => {
    const [a, b] = await pair([repo("a", "/Users/ada/app")], [repo("b", "/Users/bo/app")]);
    const before = b.of("b");
    expect(before.places.map((pl) => pl.placeId).sort()).toEqual(["a", "b"]);
    const act = await a.records.intent(a.of("a").key, { op: "rename", name: "Field" }, "test");
    await until(() => b.of("b").name === "Field", "the rename to read on B");
    expect(b.of("b")).toMatchObject({
      key: act.key,
      name: "Field",
      nameFrom: "you",
      provisional: false,
      // P3: the ink both desktops drew before the act is the record's
      ink: before.ink,
    });
  });

  it("a split made on A gives each record back its side on B", async () => {
    // two projects at first: B's folder has no remote and its own history
    const [a, b] = await pair(
      [repo("a", "/Users/ada/app")],
      [repo("b", "/Users/bo/pocket", { identityRemote: undefined, remotes: [], root: ROOT_B })],
    );
    expect(b.of("a").key).not.toBe(b.of("b").key);
    const field = await a.records.intent(a.of("a").key, { op: "rename", name: "Field" }, "test");
    const pocket = await b.records.intent(b.of("b").key, { op: "rename", name: "Pocket" }, "test");
    // B's folder takes the remote: one project now, the older record names it
    b.setPlaces([repo("b", "/Users/bo/pocket", { root: ROOT_B })]);
    a.groups.regroupNow();
    await until(() => a.of("b").key === field.key && b.of("b").key === field.key, "the join");
    for (const d of [a, b])
      expect(d.of("b")).toMatchObject({ name: "Field", alsoCalled: ["Pocket"] });

    // A splits B's folder out of it
    await a.records.intent(field.key, { op: "split", place: "b" }, "test");
    await until(() => b.of("b").key === pocket.key, "the split to read on B");
    for (const d of [a, b]) {
      expect(d.of("a")).toMatchObject({ key: field.key, name: "Field", nameFrom: "you" });
      expect(d.of("a").alsoCalled).toBeUndefined();
      expect(d.of("b")).toMatchObject({ key: pocket.key, name: "Pocket", nameFrom: "you" });
    }
  });

  it("concurrent renames converge to one name on both desktops", async () => {
    const [a, b, mesh] = await pair([repo("a", "/Users/ada/app")], [repo("b", "/Users/bo/app")]);
    const made = await a.records.intent(a.of("a").key, { op: "rename", name: "Field" }, "test");
    await until(() => b.of("b").key === made.key, "the record on B");
    await apart(mesh, [a, b], async () => {
      await Promise.all([
        a.records.intent(made.key, { op: "rename", name: "Named on A" }, "test"),
        b.records.intent(made.key, { op: "rename", name: "Named on B" }, "test"),
      ]);
      // apart, each holds only its own
      expect(a.library.projectIntents().records[0]?.name).toBe("Named on A");
      expect(b.library.projectIntents().records[0]?.name).toBe("Named on B");
    });
    await until(
      () => a.of("a").name === b.of("b").name && a.of("a").name !== "Field",
      "one name on both",
    );
    expect(["Named on A", "Named on B"]).toContain(a.of("a").name);
    expect(a.library.projectIntents()).toEqual(b.library.projectIntents());
  });

  it("two desktops' first acts at once freeze the same ink (P3) and agree on one key", async () => {
    const [a, b, mesh] = await pair([repo("a", "/Users/ada/app")], [repo("b", "/Users/bo/app")]);
    const provisional = a.of("a");
    expect(b.of("b")).toMatchObject({ key: provisional.key, ink: provisional.ink });
    await apart(mesh, [a, b], async () => {
      await a.records.intent(provisional.key, { op: "pin", pinned: true }, "test");
      await b.records.intent(provisional.key, { op: "rename", name: "Mine" }, "test");
      // apart, each made its own record of the project
      expect(a.library.projectIntents().records.map((r) => r.id)).toEqual(["A-rec-1"]);
      expect(b.library.projectIntents().records.map((r) => r.id)).toEqual(["B-rec-1"]);
    });
    await until(
      () =>
        a.library.projectIntents().records.length === 2 &&
        b.library.projectIntents().records.length === 2,
      "both records on both",
    );
    // each record froze the ink both desktops drew: nothing jumps
    for (const r of a.library.projectIntents().records) expect(r.ink).toBe(provisional.ink);
    for (const d of [a, b]) {
      // the older record keys it; the person's name names it (the oldest NAMED)
      expect(d.of(d === a ? "a" : "b")).toMatchObject({
        key: "r:A-rec-1",
        ink: provisional.ink,
        name: "Mine",
        nameFrom: "you",
        pinned: true,
      });
    }
  });

  it("an OLDER desktop holding the library leaves the records intact", async () => {
    const mesh = new Mesh();
    let a: Desk | undefined;
    let b: Desk | undefined;
    a = await desk(mesh, "A", () => b);
    b = await desk(mesh, "B", () => a);
    a.setPlaces([repo("a", "/Users/ada/app")]);
    b.setPlaces([repo("b", "/Users/bo/app")]);
    // C runs an older build: it holds the library and writes only canvases
    const cDir = tmp("C");
    const c = new Device("C", mesh, cDir);
    const older = new LibraryDocService({ dataDir: cDir, docId: LIBRARY });
    await older.ready();
    c.docs.registerSystemDoc(LIBRARY, "Library", older.doc, older.hostOwner());
    mesh.devices.set("C", c);
    for (const d of [a.device, b.device, c]) await d.sync.start();

    const made = await a.records.intent(a.of("a").key, { op: "rename", name: "Field" }, "test");
    const reached = (lib: LibraryDocService) =>
      lib.doc.getMap(PROJECT_MAPS.names).get(made.recordId) === "Field";
    await until(() => reached(older) && reached(b.library), "the record on B and C");
    expect(older.entries()).toEqual([]);
    const canvas: DocLibraryEntry = {
      docId: "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e",
      name: "Board made on the older desktop",
      createdAt: 1_790_000_000_000,
      engineSchema: null,
      baseEpoch: 0,
    };
    await older.upsert(canvas, "older");
    await until(
      () => a.library.get(canvas.docId) !== undefined && b.library.get(canvas.docId) !== undefined,
      "the older desktop's canvas on A and B",
    );
    // its library carried every project map as A wrote it, and still does
    for (const name of Object.values(PROJECT_MAPS))
      expect(older.doc.getMap(name).toJSON()).toEqual(a.library.doc.getMap(name).toJSON());
    for (const d of [a, b]) {
      expect(d.of(d === a ? "a" : "b")).toMatchObject({ key: made.key, name: "Field" });
      expect(d.library.entries().map((e) => e.name)).toEqual([canvas.name]);
    }
  });
});

describe("PJ-2 × PJ-3 — a window's act through the real door reads on the other desktop", () => {
  const doorOf = (d: Desk) =>
    new ProjectDoors({
      groups: d.groups,
      deviceId: () => d.name,
      localSessions: () => [],
      peerSessions: () => [],
      sources: () => [],
      records: () => projectIntentWriter(d.records),
    });
  const window = { paths: true, tailnet: false };
  const act = (door: ProjectDoors, params: unknown) =>
    door.intent(ProjectIntentParams.parse(params));
  const refusal = async (work: Promise<unknown>) => {
    try {
      await work;
      return "wrote";
    } catch (error) {
      if (!(error instanceof RpcCallError)) throw error;
      return `${error.kind}:${(error.details as { reason?: string } | undefined)?.reason ?? ""}`;
    }
  };

  it("a rename, a split and a link made through A's door are what B's door answers", async () => {
    const [a, b] = await pair(
      [repo("a", "/Users/ada/app"), repo("h", "/Users/ada", { kind: "home", git: false })],
      [repo("b", "/Users/bo/app")],
    );
    const [doorA, doorB] = [doorOf(a), doorOf(b)];
    const key = a.of("a").key;
    const renamed = await act(doorA, { key, op: "rename", name: "Field" });
    expect(renamed.key).toBe(`r:${renamed.recordId}`);
    await until(() => b.of("b").key === renamed.key, "the rename on B");
    expect(doorB.get(ProjectGetParams.parse({ key: renamed.key }), window).project).toMatchObject({
      name: "Field",
      nameFrom: "you",
    });

    // B's folder split out by A's window, named by its PlaceRef
    await act(doorA, { key: renamed.key, op: "split", place: { device: "B", placeId: "b" } });
    await until(() => b.of("b").key !== renamed.key, "the split on B");
    expect(b.of("a").key).toBe(renamed.key);
    // and linked back later: the later act wins (D2)
    await act(doorA, { key: renamed.key, op: "link", place: { device: "B", placeId: "b" } });
    await until(() => b.of("b").key === renamed.key, "the link on B");
    expect(
      doorB.get(ProjectGetParams.parse({ key: renamed.key }), window).project.places,
    ).toHaveLength(2);

    // the records' refusals are the door's own answers
    expect(
      await refusal(
        act(doorA, { key: renamed.key, op: "link", place: { device: "A", placeId: "a" } }),
      ),
    ).toBe("PRECONDITION_FAILED:same-project");
    expect(
      await refusal(
        act(doorA, { key: renamed.key, op: "link", place: { device: "A", placeId: "h" } }),
      ),
    ).toBe("PRECONDITION_FAILED:home");
    expect(
      await refusal(
        act(doorA, { key: a.of("h").key, op: "split", place: { device: "A", placeId: "h" } }),
      ),
    ).toBe("PRECONDITION_FAILED:home");
  });
});
