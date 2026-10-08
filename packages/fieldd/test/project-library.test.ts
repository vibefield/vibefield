// PJ-2 (build-pj23.md D1, D5) — the person's project records in the LIBRARY:
// root maps of their own beside the canvases' (projects/records-doc.ts).
//   · every write durable and read back on the next boot; anchors read oldest
//     first, written once; a link or split made again moves its time;
//   · records merge per key across desktops with the canvases' rows;
//   · an OLDER desktop — one whose library knows only the canvases' maps —
//     reads none of it, and carries it through its own writes untouched;
//   · a relink copies the local account's records, idempotent by record id.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocLibraryEntry } from "@vibefield/contracts";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { LibraryDocService, systemAccount, systemDocId } from "../src/library-doc";
import { PROJECT_MAPS, type ProjectWrite } from "../src/projects/records-doc";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const tmp = (tag: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `vf-plib-${tag}-`));
  dirs.push(dir);
  return dir;
};

const ACCOUNT = systemAccount("ada@example.com", "fuid-a");
const LIBRARY = systemDocId("library", ACCOUNT);
const library = (dataDir = tmp("lib"), docId = LIBRARY) =>
  new LibraryDocService({ dataDir, docId });

const canvas = (docId: string, name: string): DocLibraryEntry => ({
  docId,
  name,
  createdAt: 1_790_000_000_000,
  engineSchema: null,
  baseEpoch: 0,
});
const DOC = "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e";

const born = (record: string, at: number, anchors: string[]): ProjectWrite[] => [
  { kind: "create", record, createdAt: at, ink: 7 },
  ...anchors.map((anchor): ProjectWrite => ({ kind: "anchor", record, anchor, at })),
];

const sync = (a: LibraryDocService, b: LibraryDocService): void => {
  a.doc.import(b.doc.export({ mode: "update", from: a.doc.oplogVersion() }));
  b.doc.import(a.doc.export({ mode: "update", from: b.doc.oplogVersion() }));
};

describe("PJ-2 — project records in the library", () => {
  it("persists every act and reads it back on the next boot, anchors oldest first", async () => {
    const dataDir = tmp("persist");
    const first = library(dataDir);
    const heard: string[] = [];
    first.on("changed", (change: { origin: string }) => heard.push(change.origin));
    await first.writeProjects(
      born("rec-1", 10, ["place:pl_b", "root:aaaa", "remote:github.com/o/app"]),
      "test",
    );
    await first.writeProjects(
      [
        // written once: a later add of an anchor it holds does not move it
        { kind: "anchor", record: "rec-1", anchor: "root:aaaa", at: 30 },
        { kind: "anchor", record: "rec-1", anchor: "place:pl_a", at: 20 },
        { kind: "name", record: "rec-1", name: "Field" },
        { kind: "pinned", record: "rec-1", value: true },
        { kind: "recipe", record: "rec-1", recipe: { agent: "claude", model: "x" } },
        { kind: "acted", record: "rec-1", place: "pl_a", at: 21 },
        { kind: "acted", record: "rec-1", place: "pl_a", at: 5 },
        { kind: "link", a: "pl_z", b: "pl_a", at: 22 },
        { kind: "split", place: "pl_b", notRecord: "rec-1", at: 23 },
        { kind: "dismiss", a: "rec-2", b: "rec-1", at: 24 },
      ],
      "test",
    );
    expect(heard).toEqual(["local", "local"]);
    // nothing moved: no commit, no change heard
    expect(
      await first.writeProjects([{ kind: "name", record: "rec-1", name: "Field" }], "test"),
    ).toBe(false);
    expect(heard).toHaveLength(2);

    const second = library(dataDir);
    await second.ready();
    expect(second.projectIntents()).toEqual({
      records: [
        {
          id: "rec-1",
          // the first act's anchors strongest first, then the later one
          anchors: ["root:aaaa", "remote:github.com/o/app", "place:pl_b", "place:pl_a"],
          name: "Field",
          ink: 7,
          recipe: { agent: "claude", model: "x" },
          pinned: true,
          places: [{ placeId: "pl_a", at: 21 }],
          createdAt: 10,
        },
      ],
      links: [{ a: "pl_a", b: "pl_z", at: 22 }],
      splits: [{ place: "pl_b", notRecord: "rec-1", at: 23 }],
      dismissals: [["rec-1", "rec-2"]],
    });
    // a link made again moves its time (the later act wins, D2)
    await second.writeProjects([{ kind: "link", a: "pl_a", b: "pl_z", at: 40 }], "test");
    expect(second.projectIntents().links).toEqual([{ a: "pl_a", b: "pl_z", at: 40 }]);
  });

  it("refuses a write naming an id that cannot be a key, and applies none of the act", async () => {
    const lib = library();
    await expect(
      lib.writeProjects(
        [...born("rec-1", 1, ["root:aaaa"]), { kind: "name", record: "rec\u0000bad", name: "x" }],
        "test",
      ),
    ).rejects.toThrow(/non-empty id/);
    await lib.writeProjects([{ kind: "create", record: "rec-2", createdAt: 2 }], "test");
    expect(lib.projectIntents().records.map((r) => r.id)).toEqual(["rec-2"]);
  });

  it("merges per key across desktops: a rename on A, a split on B and a canvas both survive", async () => {
    const a = library(tmp("a"));
    const b = library(tmp("b"));
    await a.writeProjects(born("rec-1", 1, ["root:aaaa"]), "test");
    sync(a, b);
    await a.writeProjects([{ kind: "name", record: "rec-1", name: "Named on A" }], "test");
    await b.writeProjects([{ kind: "split", place: "pl_b", notRecord: "rec-1", at: 5 }], "test");
    await b.upsert(canvas(DOC, "Board"), "test");
    sync(a, b);
    for (const lib of [a, b]) {
      expect(lib.projectIntents().records[0]?.name).toBe("Named on A");
      expect(lib.projectIntents().splits).toEqual([{ place: "pl_b", notRecord: "rec-1", at: 5 }]);
      expect(lib.get(DOC)?.name).toBe("Board");
    }
  });

  it("an OLDER desktop reads none of it, and carries it through its own writes untouched", async () => {
    const newer = library(tmp("new"));
    await newer.upsert(canvas(DOC, "Board"), "test");
    await newer.writeProjects(
      [...born("rec-1", 1, ["root:aaaa"]), { kind: "name", record: "rec-1", name: "Field" }],
      "test",
    );
    // the older build's document: the same id, written only through the
    // canvases' maps — it never names a `projects.*` container
    const older = new LoroDoc();
    older.import(newer.doc.export({ mode: "snapshot" }));
    const asOlder = library(tmp("old"));
    asOlder.doc.import(older.export({ mode: "snapshot" }));
    expect(asOlder.entries().map((e) => e.docId)).toEqual([DOC]);
    older.getMap("names").set(DOC, "Board, renamed by the older desktop");
    older.commit({ origin: "library:older" });

    // its snapshot still holds every project map, byte for byte as values
    const carried = new LoroDoc();
    carried.import(older.export({ mode: "snapshot" }));
    for (const name of Object.values(PROJECT_MAPS)) {
      expect(carried.getMap(name).toJSON()).toEqual(newer.doc.getMap(name).toJSON());
    }
    // and its edit merges back beside them
    newer.doc.import(older.export({ mode: "update", from: newer.doc.oplogVersion() }));
    expect(newer.get(DOC)?.name).toBe("Board, renamed by the older desktop");
    expect(newer.projectIntents().records[0]).toMatchObject({ id: "rec-1", name: "Field" });
    expect(newer.entries()).toHaveLength(1);
  });

  it("D5 — a relink copies the local account's records into the linked library, once", async () => {
    const dataDir = tmp("relink");
    const local = library(dataDir, systemDocId("library", systemAccount(null, "fuid-a")));
    await local.writeProjects(
      [
        ...born("rec-local", 1, ["root:aaaa", "place:pl_a"]),
        { kind: "name", record: "rec-local", name: "Made unlinked" },
        { kind: "acted", record: "rec-local", place: "pl_a", at: 2 },
        { kind: "split", place: "pl_b", notRecord: "rec-local", at: 3 },
      ],
      "test",
    );
    const linked = library(dataDir, LIBRARY);
    // the linked account already holds a record of its own, and one of the
    // local records by id (an earlier link's copy, renamed since)
    await linked.writeProjects(
      [
        ...born("rec-account", 5, ["remote:github.com/o/other"]),
        ...born("rec-local", 1, ["root:aaaa"]),
        { kind: "name", record: "rec-local", name: "Renamed while linked" },
      ],
      "test",
    );
    expect(await linked.adoptProjects(local, "relink")).toBe(0);
    const fresh = library(tmp("fresh"), LIBRARY);
    expect(await fresh.adoptProjects(local, "relink")).toBe(1);
    expect(await fresh.adoptProjects(local, "relink")).toBe(0);
    expect(fresh.projectIntents()).toEqual(local.projectIntents());
    // the record the linked library held is left as it is
    expect(linked.projectIntents().records.find((r) => r.id === "rec-local")?.name).toBe(
      "Renamed while linked",
    );
    expect(linked.projectIntents().splits).toEqual([
      { place: "pl_b", notRecord: "rec-local", at: 3 },
    ]);
  });
});
