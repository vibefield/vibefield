import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentCatalogEntry,
  ARTIFACT_LIMITS,
  createAgentCatalogReaders,
  INDEX_MESH,
  IndexAppsCatalogDelta,
  IndexAppsCatalogOpen,
  IndexAppsCatalogSnapshotPage,
  IndexCatalogApp,
  type IndexCatalogTable,
  type IndexThread,
  MADE_APP_LIMITS,
  type MadeAppPreview,
  ROWS,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import type { ArtifactEntry } from "@vibefield/rosetta-protocol";
import { PROTOCOL_VERSION } from "@vibefield/rosetta-protocol/protocol-version";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnrollmentStore, type IndexArtifactsRead, IndexService } from "../src/agent-index";
import { CatalogTable, type RowsPump } from "../src/catalog-rows";
import {
  type AppIntentStamps,
  IndexApps,
  type IndexAppsOptions,
  type IndexAppsReader,
} from "../src/index-apps";
import { IndexCatalog } from "../src/index-catalog";
import { RpcCallError } from "../src/native-link";
import type { RosettadState, RosettadSupervisor } from "../src/rosettad-supervisor";
import { SCRIPTED_ROW } from "./agent-catalog-fixture";

// MA-3a (`draft/thinking-mini-apps.md` v0.2 §4.1–§4.2; the build plan's 3a as
// the lead ruled it, RULINGS L13 + C10) — the `apps` table's SOURCE
// (index-apps.ts). Every row is about one rule of the walk or the row:
//   · the first walk waits for the catalog's first snapshot, then reads the
//     library newest first in pages of WALK_PAGE, and the table says nothing
//     before that walk lands (DS-L8);
//   · a 410 restarts the walk from the head, keeping what it read, at most
//     WALK_RESTARTS times, and removals come ONLY from a walk that completed;
//   · the next walks run on the table's OWN META_RESNAPSHOT_MS timer (C10);
//     a `sessions` change re-reads the newest REREAD_PAGE at the floor;
//   · the cap keeps the ROWS newest by `publishedAt ?? capturedAt ?? 0`;
//   · a row is a projection — a delegated session's root through `threads`,
//     the agent through the catalog's reader (R23b), the title clipped, the
//     file name a basename — and never carries a path, keep or hide;
//   · every frame declares the owner's standing, and a standing that moved
//     alone is sent at once as a delta with no rows.
// The first blocks drive the table over a CATALOG STAND-IN (the public surface
// it reads, `IndexAppsCatalog`) and a scripted LIBRARY (the reader seam, its
// pages typed as rosetta's own `ArtifactEntry`), on fake timers. The last
// block runs it over the real `IndexCatalog` and the real reader against the
// scripted rosettad (test/fixtures/fake-rosettad.mjs).

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-rosettad.mjs");
const readers = createAgentCatalogReaders(AGENT_CATALOG);

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** 64 lowercase hex, as rosetta's identities are (blake3 there; any stable digest here). */
const hex = (seed: string): string => createHash("sha256").update(seed).digest("hex");
/** an app's `appId` (rosetta's `artifact_id`) */
const id = (name: string): string => hex(`app:${name}`);

/** One app's presentation as rosetta answers it — typed as rosetta's OWN `ArtifactEntry`. */
const app = (
  name: string,
  publishedAt: number | null,
  over: {
    session?: string;
    title?: string;
    filename?: string;
    agent?: string;
    availability?: string;
    captured?: number | null;
    version?: number;
  } = {},
): ArtifactEntry => {
  const version = over.version ?? 1;
  return {
    publication: {
      id: hex(`presentation:${name}:${version}`),
      artifact_id: id(name),
      session_id: over.session ?? "s1",
      timeline_id: `tl-${name}-${version}`,
      title: over.title ?? `App ${name}`,
      filename: over.filename ?? `${name}.html`,
      path: `/Users/someone/work/${name}.html`,
      url: null,
      native_id: null,
      version: null,
      published_at: publishedAt,
      source_offset: 4_096,
      description: null,
      dropped_files: null,
    },
    availability: (over.availability ?? "captured") as ArtifactEntry["availability"],
    captured_at: over.captured === undefined ? 900 : over.captured,
    recovered_from: null,
    asset: {
      url: `/api/assets/${hex(`page:${name}:${version}`)}.html`,
      digest: hex(`page:${name}:${version}`),
      media_type: "text/html; charset=utf-8",
      byte_len: 120,
    },
    agent: over.agent ?? "claude-code",
    session_title: null,
    project_id: "p1",
    project_name: "app",
    presentations: version,
  };
};

const thread = (sessionId: string, rootSessionId: string): IndexThread => ({
  sessionId,
  nativeSessionId: `nat-${sessionId}`,
  parentSessionId: rootSessionId,
  rootSessionId,
  delegation: null,
  activity: null,
  streamState: "indexed",
});

/** The catalog's public surface as the table reads it: its first snapshot (`ready` and the `changed` it emits), its
 * threads, its device. */
class CatalogStandIn extends EventEmitter {
  ready = false;
  deviceId = "dev-a";
  readonly threads = new CatalogTable<IndexThread>({
    epoch: "threads-test",
    keyOf: (row) => row.sessionId,
  });

  device(): string {
    return this.deviceId;
  }

  /** the first snapshot landed: IndexCatalog emits `changed` naming the tables it moved */
  land(): void {
    this.ready = true;
    this.emit("changed", { tables: ["projects", "sessions"] satisfies IndexCatalogTable[] });
  }

  moved(...tables: IndexCatalogTable[]): void {
    this.emit("changed", { tables });
  }
}

const expired = (): RpcCallError =>
  new RpcCallError(
    "PRECONDITION_FAILED",
    "the library moved under the cursor; read again from the head",
    false,
    { service: "index", reason: "cursor-expired" },
  );

/** rosetta's order: `sort_at DESC, id DESC`, `sort_at = published_at ?? 0` */
const newestFirst = (a: ArtifactEntry, b: ArtifactEntry): number =>
  (b.publication.published_at ?? 0) - (a.publication.published_at ?? 0) ||
  (a.publication.id < b.publication.id ? 1 : a.publication.id > b.publication.id ? -1 : 0);

interface Library {
  /** the newest presentation of each app, as the library holds them now */
  apps: ArtifactEntry[];
  canonicalReady: boolean;
  /** the library's revision: a cursor minted under another is a 410 */
  revision: number;
  /** every ask, in order */
  readonly calls: IndexArtifactsRead[];
  /** a refusal for this ask (its number counts from 1), before it reads */
  fail: ((ask: IndexArtifactsRead, n: number) => Error | undefined) | undefined;
  /** hold this ask until the promise settles; the page is read as the library stands then */
  hold: ((ask: IndexArtifactsRead, n: number) => Promise<void> | undefined) | undefined;
  readonly read: IndexAppsReader;
}

/** A scripted library behind the reader seam: rosetta's paging, newest first, with an opaque cursor. */
function library(apps: ArtifactEntry[]): Library {
  const lib: Library = {
    apps,
    canonicalReady: true,
    revision: 1,
    calls: [],
    fail: undefined,
    hold: undefined,
    read: async (ask) => {
      lib.calls.push({ ...ask });
      const n = lib.calls.length;
      const failure = lib.fail?.(ask, n);
      if (failure !== undefined) throw failure;
      const held = lib.hold?.(ask, n);
      if (held !== undefined) await held;
      let offset = 0;
      if (ask.cursor !== undefined) {
        const cursor = JSON.parse(ask.cursor) as { revision: number; offset: number };
        if (cursor.revision !== lib.revision) throw expired();
        offset = cursor.offset;
      }
      const sorted = [...lib.apps].sort(newestFirst);
      const entries = sorted.slice(offset, offset + ask.limit);
      const more = offset + ask.limit < sorted.length;
      return {
        entries,
        next_cursor: more
          ? JSON.stringify({ revision: lib.revision, offset: offset + ask.limit })
          : null,
        canonical_ready: lib.canonicalReady,
      };
    },
  };
  return lib;
}

type AppsOverOptions = Omit<Partial<IndexAppsOptions>, "catalog" | "artifacts"> & {
  catalog?: CatalogStandIn;
};

/** The table over a library and a catalog stand-in, started; `changed` counts its announcements. */
function appsOver(lib: Library, opts: AppsOverOptions = {}) {
  const { catalog: given, ...rest } = opts;
  const catalog = given ?? new CatalogStandIn();
  const apps = new IndexApps({ catalog, artifacts: lib.read, epoch: "apps-test", ...rest });
  cleanup.push(() => apps.dispose());
  const changed: number[] = [];
  apps.on("changed", () => changed.push(Date.now()));
  apps.start();
  return { apps, catalog, changed };
}

/** A real macrotask turn (setImmediate is not faked): every promise the last timer started settles. */
const drain = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};
/** Fake timers and a fake clock; setImmediate stays real, so `drain` is a true turn of the loop. */
const useFakeClock = (): void => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
};
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await drain();
};
const heads = (calls: readonly IndexArtifactsRead[]): string[] =>
  calls.map((ask) => (ask.cursor === undefined ? "head" : "next"));
const snapshotOf = (open: RowsPump["open"]): Record<string, unknown> | undefined =>
  "snapshot" in open ? (open.snapshot as Record<string, unknown>) : undefined;

/** `IndexService.artifacts` is the reader the daemon injects (3e): a compile-time witness. */
type ReaderFits = IndexService["artifacts"] extends IndexAppsReader ? true : never;
const readerFits: ReaderFits = true;

describe("IndexApps — the walk (MA-3a, L13)", () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("PIN — a real IndexCatalog is the catalog seam and IndexService.artifacts the reader; nothing is read before start", async () => {
    const catalog = new IndexCatalog({
      supervisor: null,
      expectedProtocolVersion: PROTOCOL_VERSION,
      deviceId: () => "dev-a",
    });
    cleanup.push(() => catalog.dispose());
    const lib = library([app("a", 1)]);
    const apps = new IndexApps({ catalog, artifacts: lib.read });
    cleanup.push(() => apps.dispose());
    await advance(0);
    expect(readerFits).toBe(true);
    expect(apps.ready, "nothing landed").toBe(false);
    expect(apps.table.size).toBe(0);
    expect(lib.calls, "nothing was read").toEqual([]);
  });

  it("walks the library once the catalog's first snapshot has landed: newest first, in pages of WALK_PAGE, from the head", async () => {
    const lib = library(Array.from({ length: 5 }, (_, n) => app(`b-${n}`, 2_000 + n)));
    const { apps, catalog } = appsOver(lib, { walkPage: 2 });
    await advance(0);
    expect(lib.calls, "nothing is read before the catalog's first snapshot").toEqual([]);

    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    expect(heads(lib.calls), "the head, then rosetta's cursor to the end").toEqual([
      "head",
      "next",
      "next",
    ]);
    expect(
      lib.calls.map((ask) => ask.limit),
      "pages of WALK_PAGE",
    ).toEqual([2, 2, 2]);
    expect(
      lib.calls.every(
        (ask) =>
          ask.q === undefined &&
          ask.agent === undefined &&
          ask.project === undefined &&
          ask.artifactId === undefined,
      ),
      "the walk asks for the whole library",
    ).toBe(true);
    expect(apps.table.keys().sort(), "every app is a row").toEqual(
      lib.apps.map((entry) => entry.publication.artifact_id).sort(),
    );
    for (const row of apps.table.rows()) {
      expect(IndexCatalogApp.safeParse(row).success, `row ${row.appId} parses`).toBe(true);
    }
    // the first snapshot's own change names `sessions`: the first walk covers it, never a re-read beside it
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS + 1);
    expect(lib.calls, "no re-read beside the first walk").toHaveLength(3);
  });

  it("starts at once over a catalog that is already ready, at the registry's WALK_PAGE", async () => {
    const catalog = new CatalogStandIn();
    catalog.ready = true;
    const lib = library([app("a", 2), app("b", 1)]);
    const { apps } = appsOver(lib, { catalog });
    await advance(0);
    expect(apps.ready, "the first walk landed with no word from the catalog").toBe(true);
    expect(lib.calls, "one page holds the library").toEqual([{ limit: MADE_APP_LIMITS.WALK_PAGE }]);
  });

  it("answers nothing before the first walk lands (DS-L8)", async () => {
    const lib = library([app("a", 3), app("b", 2), app("c", 1)]);
    let release: (() => void) | undefined;
    lib.hold = (_ask, n) =>
      n === 2
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined;
    const { apps, catalog, changed } = appsOver(lib, { walkPage: 2 });
    catalog.land();
    await advance(0);
    expect(lib.calls, "the walk reached its second page").toHaveLength(2);
    expect(apps.ready, "not ready while the first walk reads").toBe(false);
    expect(changed, "nothing announced before the first walk lands").toEqual([]);

    expect(release, "the second page is held").toBeDefined();
    release?.();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    expect(changed.length, "its landing is announced").toBeGreaterThanOrEqual(1);
    expect(apps.table.size).toBe(3);
  });

  it("an empty library is ready, and its landing is announced", async () => {
    const { apps, catalog, changed } = appsOver(library([]));
    catalog.land();
    await advance(0);
    expect(apps.ready, "an empty library still lands").toBe(true);
    expect(changed, "announced once").toHaveLength(1);
    expect(apps.table.size).toBe(0);
  });

  it("a 410 mid-walk restarts from the head, keeps what it read, and removes nothing until the walk completes", async () => {
    const lib = library([app("x", 30), app("y", 20), app("z", 10)]);
    const { apps, catalog } = appsOver(lib, { walkPage: 2, resnapshotMs: 1_000 });
    catalog.land();
    await advance(0);
    expect(apps.table.has(id("z")), "the first walk holds z").toBe(true);

    const before = lib.calls.length;
    lib.apps = [app("w", 40), app("x", 30), app("y", 20)]; // z left the library, w arrived
    let expiredOnce = false;
    lib.fail = (ask) => {
      if (ask.cursor === undefined || expiredOnce) return undefined;
      expiredOnce = true;
      return expired();
    };
    let release: (() => void) | undefined;
    lib.hold = (ask) =>
      expiredOnce && ask.cursor !== undefined
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined;
    await advance(1_000);
    expect(heads(lib.calls.slice(before)), "head, next (410), the head again, next (held)").toEqual(
      ["head", "next", "head", "next"],
    );
    expect(apps.table.has(id("z")), "a 410 removes nothing").toBe(true);
    expect(apps.table.has(id("w")), "what the walk read is upserted while it walks").toBe(true);

    expect(release, "the restarted walk's second page is held").toBeDefined();
    release?.();
    await advance(0);
    expect(apps.table.has(id("z")), "the completed walk removes the app that left").toBe(false);
    expect(apps.table.keys().sort()).toEqual([id("w"), id("x"), id("y")].sort());
  });

  it("a walk that meets more 410s than WALK_RESTARTS gives up, removes nothing, and the next timer's walk completes", async () => {
    const lib = library([app("x", 30), app("y", 20), app("z", 10)]);
    const { apps, catalog } = appsOver(lib, { walkPage: 2, resnapshotMs: 1_000 });
    catalog.land();
    await advance(0);
    expect(apps.table.has(id("z")), "the first walk holds z").toBe(true);

    const before = lib.calls.length;
    // z left the library and w arrived: still two pages, so every walk meets the cursor
    lib.apps = [app("w", 40), app("x", 30), app("y", 20)];
    lib.fail = (ask) => (ask.cursor !== undefined ? expired() : undefined);
    await advance(1_000);
    const restarted = heads(lib.calls.slice(before)).filter((at) => at === "head");
    expect(restarted, "one walk and WALK_RESTARTS restarts, no more").toHaveLength(
      1 + MADE_APP_LIMITS.WALK_RESTARTS,
    );
    expect(apps.table.has(id("z")), "a walk that gave up removes nothing").toBe(true);
    expect(apps.ready, "and the table still speaks for the library").toBe(true);

    lib.fail = undefined;
    await advance(1_000);
    expect(apps.table.has(id("z")), "the next timer's completed walk removes it").toBe(false);
    expect(apps.table.has(id("x"))).toBe(true);
  });

  it("walks again on its OWN META_RESNAPSHOT_MS timer though the catalog says nothing (C10), and that walk removes an app that left", async () => {
    const lib = library([app("a", 2), app("b", 1)]);
    const { apps, catalog } = appsOver(lib);
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    expect(lib.calls, "one walk so far").toHaveLength(1);

    lib.apps = [app("a", 2)]; // b left the library
    await advance(INDEX_MESH.META_RESNAPSHOT_MS - 1);
    expect(lib.calls, "no second walk before the cadence").toHaveLength(1);
    await advance(1);
    expect(lib.calls, "the cadence's own walk").toHaveLength(2);
    expect(lib.calls[1], "a whole walk from the head").toEqual({
      limit: MADE_APP_LIMITS.WALK_PAGE,
    });
    expect(apps.table.has(id("b")), "the completed walk removed b").toBe(false);
    expect(apps.table.has(id("a"))).toBe(true);
  });

  it("MA-3f: carries rosetta's description and dropped files, so page only is true from the first served page", async () => {
    const told = app("told", 30);
    told.publication.description = "A checkout flow.";
    told.publication.dropped_files = 2;
    const long = app("long", 20);
    long.publication.description = "d".repeat(MADE_APP_LIMITS.DESCRIPTION_CHARS + 1);
    long.publication.dropped_files = 0;
    const { apps, catalog } = appsOver(library([told, long, app("plain", 10)]));
    catalog.land();
    await advance(0);
    expect(apps.table.get(id("told"))).toMatchObject({
      description: "A checkout flow.",
      droppedFiles: 2,
    });
    expect(apps.table.get(id("long"))?.description, "too long costs the field").toBeUndefined();
    expect(apps.table.get(id("long"))?.droppedFiles, "none dropped is said").toBe(0);
    expect(apps.table.get(id("plain"))?.droppedFiles, "unknown stays absent").toBeUndefined();
  });

  it("MA-3f: re-reads on rosetta's artifacts_changed as it does on a sessions change, by the same delay and floor", async () => {
    const lib = library([app("a", 20)]);
    const { apps, catalog } = appsOver(lib);
    catalog.land();
    await advance(0);
    const walked = lib.calls.length;
    lib.apps = [app("n", 30), app("a", 20)];
    catalog.emit("library-changed");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS - 1);
    expect(lib.calls, "nothing before the delay").toHaveLength(walked);
    await advance(1);
    expect(lib.calls, "one re-read").toHaveLength(walked + 1);
    expect(apps.table.has(id("n"))).toBe(true);
  });

  it("re-reads the newest REREAD_PAGE REREAD_DELAY_MS after a sessions change, at most once per REREAD_MIN_INTERVAL_MS, and only upserts", async () => {
    const lib = library([app("a", 20), app("b", 10)]);
    const { apps, catalog } = appsOver(lib);
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    const walked = lib.calls.length;

    lib.apps = [app("n", 30), app("a", 20)]; // n arrived; b left (a re-read never removes it)
    catalog.moved("sessions");
    catalog.moved("sessions");
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS - 1);
    expect(lib.calls, "nothing before the delay").toHaveLength(walked);
    await advance(1);
    expect(lib.calls, "one re-read for the burst").toHaveLength(walked + 1);
    expect(lib.calls[walked], "the newest REREAD_PAGE, from the head").toEqual({
      limit: MADE_APP_LIMITS.REREAD_PAGE,
    });
    expect(apps.table.has(id("n")), "the new app is upserted").toBe(true);
    expect(apps.table.has(id("b")), "a re-read removes nothing").toBe(true);

    // the floor: the next change re-reads no sooner than REREAD_MIN_INTERVAL_MS after the last re-read
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS - 1);
    expect(lib.calls, "the floor holds the next re-read").toHaveLength(walked + 1);
    await advance(1);
    expect(lib.calls, "the floor's re-read").toHaveLength(walked + 2);

    // a change that names no sessions is no reason to re-read
    catalog.moved("projects", "threads");
    await advance(MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS + MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(lib.calls, "projects and threads moving re-read nothing").toHaveLength(walked + 2);
  });

  it("a re-read reads on past a page of new apps, and stops at the page that holds a presentation it already has", async () => {
    const lib = library([app("old", 1)]);
    const { apps, catalog } = appsOver(lib, { rereadPage: 3 });
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    const walked = lib.calls.length;

    lib.apps = [...Array.from({ length: 4 }, (_, n) => app(`new-${n}`, 100 + n)), app("old", 1)];
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    const reread = lib.calls.slice(walked);
    expect(heads(reread), "a page of new apps, then the page that meets the held one").toEqual([
      "head",
      "next",
    ]);
    expect(
      reread.map((ask) => ask.limit),
      "pages of REREAD_PAGE",
    ).toEqual([3, 3]);
    expect(apps.table.size, "the four new apps beside the old").toBe(5);
  });

  it("keeps the ROWS newest by publishedAt ?? capturedAt ?? 0, and the walk stops at the cap", async () => {
    const lib = library([
      app("p5", 5_000),
      app("p4", 4_000),
      app("p3", 3_000),
      app("p2", 2_000),
      app("p1", 1_000),
    ]);
    const { apps, catalog } = appsOver(lib, { walkPage: 2, rowCap: 3 });
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    expect(lib.calls, "the walk stops once it holds the cap: two pages").toHaveLength(2);
    expect(apps.table.keys().sort(), "the three newest").toEqual(
      [id("p5"), id("p4"), id("p3")].sort(),
    );

    // rosetta orders an unpublished page last (its sort_at is 0); its captured_at still makes it the newest here
    const second = library([
      app("q3", 3_000),
      app("q2", 2_000),
      app("q1", 1_000),
      app("unpublished", null, { captured: 9_000 }),
    ]);
    const other = appsOver(second, { walkPage: 2, rowCap: 3 });
    other.catalog.land();
    await advance(0);
    expect(other.apps.ready, "the second table's walk landed").toBe(true);
    expect(other.apps.table.keys().sort(), "publishedAt ?? capturedAt ?? 0").toEqual(
      [id("unpublished"), id("q3"), id("q2")].sort(),
    );
  });
});

describe("IndexApps — the row (MA-3a; MA §4.2, R23b, EL2)", () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a delegated session's app carries its root, resolved through the catalog's threads; a top-level one carries none", async () => {
    const catalog = new CatalogStandIn();
    catalog.threads.upsert([thread("child-1", "root-1")]);
    const lib = library([
      app("from-child", 3, { session: "child-1" }),
      app("from-root", 2, { session: "root-1" }),
      app("from-unknown", 1, { session: "s-9" }),
    ]);
    const { apps } = appsOver(lib, { catalog });
    catalog.land();
    await advance(0);
    const child = apps.table.get(id("from-child"));
    expect(child, "the child's app is a row").toBeDefined();
    expect(child?.sessionId, "where the page was presented").toBe("child-1");
    expect(child?.rootSessionId, "its root, through threads").toBe("root-1");
    const root = apps.table.get(id("from-root"));
    expect(root, "the root's app is a row").toBeDefined();
    expect(root, "a session that is its own root names none").not.toHaveProperty("rootSessionId");
    expect(apps.table.get(id("from-unknown"))).not.toHaveProperty("rootSessionId");
  });

  it("names the agent through the catalog's reader (R23b): an injected table moves the provider; an unmapped kind has none; a word that is not a kind costs the agent, never the row", async () => {
    const table: readonly AgentCatalogEntry[] = [
      ...AGENT_CATALOG,
      {
        ...SCRIPTED_ROW,
        seams: { puppeteer: { provider: "scripted" }, rosetta: { kind: "scripted" } },
      },
    ];
    const injectedReaders = createAgentCatalogReaders(table);
    expect(injectedReaders.idForKind("scripted"), "the injected table maps the kind").toBeDefined();
    expect(readers.idForKind("scripted"), "THE table does not").toBeUndefined();
    expect(readers.idForKind("claude-code"), "THE table maps claude-code").toBeDefined();

    const entries = [
      app("claude", 4, { agent: "claude-code" }),
      app("scripted", 3, { agent: "scripted" }),
      app("unmapped", 2, { agent: "zz-unmapped" }),
      app("garbled", 1, { agent: "Not A Kind!" }),
    ];
    const injected = appsOver(library(entries), { agentCatalog: table });
    const plain = appsOver(library(entries));
    injected.catalog.land();
    plain.catalog.land();
    await advance(0);
    expect(injected.apps.ready && plain.apps.ready, "both walks landed").toBe(true);

    expect(injected.apps.table.get(id("claude"))).toMatchObject({
      kind: "claude-code",
      provider: readers.idForKind("claude-code"),
    });
    expect(injected.apps.table.get(id("scripted")), "the injected table's provider").toMatchObject({
      kind: "scripted",
      provider: injectedReaders.idForKind("scripted"),
    });
    const scripted = plain.apps.table.get(id("scripted"));
    expect(scripted?.kind, "THE table: the kind").toBe("scripted");
    expect(scripted, "and no provider").not.toHaveProperty("provider");
    const unmapped = plain.apps.table.get(id("unmapped"));
    expect(unmapped?.kind).toBe("zz-unmapped");
    expect(unmapped).not.toHaveProperty("provider");
    const garbled = plain.apps.table.get(id("garbled"));
    expect(garbled, "a word that is not a kind costs the agent, never the row").toBeDefined();
    expect(garbled).not.toHaveProperty("kind");
    expect(garbled).not.toHaveProperty("provider");
  });

  it("builds the row by projection: every column from rosetta's entry, and no path, no asset url, no member it does not declare", async () => {
    const shown: ArtifactEntry = {
      publication: {
        id: hex("k-presentation"),
        artifact_id: hex("k-app"),
        session_id: "s1",
        timeline_id: "artifact-message-1",
        title: "Checkout design review",
        filename: "checkout.html",
        path: "/Users/someone/secret/checkout.html",
        url: "https://claude.ai/code/artifact/review",
        native_id: "review",
        version: "2",
        published_at: 3_608_000,
        source_offset: 4_096,
        description: null,
        dropped_files: null,
      },
      availability: "captured",
      captured_at: 3_700_000,
      recovered_from: "/archive/secret/checkout.html",
      asset: {
        url: `/api/assets/${hex("k-page")}.html`,
        digest: hex("k-page"),
        media_type: "text/html; charset=utf-8",
        byte_len: 15,
      },
      agent: "claude-code",
      session_title: "Review checkout",
      project_id: "p1",
      project_name: "Rosetta",
      presentations: 2,
    };
    // a newer rosetta's members ride beside, and a spread would carry them through
    const wider = {
      ...shown,
      publication: { ...shown.publication, mirror_path: "/Users/someone/also/secret" },
      future_path: "/Users/someone/future",
    } as ArtifactEntry;
    const { apps, catalog } = appsOver(library([wider]));
    catalog.land();
    await advance(0);
    const row = apps.table.get(hex("k-app"));
    expect(row, "the app is a row").toBeDefined();
    expect(row, "the row, member by member").toEqual({
      device: "dev-a",
      appId: hex("k-app"),
      presentationId: hex("k-presentation"),
      title: "Checkout design review",
      filename: "checkout.html",
      kind: "claude-code",
      provider: readers.idForKind("claude-code"),
      projectId: "p1",
      sessionId: "s1",
      timelineId: "artifact-message-1",
      versions: 2,
      publishedAt: 3_608_000,
      capturedAt: 3_700_000,
      availability: "captured",
      byteLen: 15,
      digest: hex("k-page"),
      hostedUrl: "https://claude.ai/code/artifact/review",
      nativeId: "review",
    });
    expect(IndexCatalogApp.safeParse(row).success, "the contract reads it").toBe(true);
    const text = JSON.stringify(apps.table.rows());
    for (const secret of [
      "/Users/someone",
      "/archive/secret",
      "/api/assets/",
      "source_offset",
      "mirror_path",
      "future_path",
      "session_title",
      "project_name",
    ]) {
      expect(text, `no row carries ${secret}`).not.toContain(secret);
    }
    for (const never of ["path", "recoveredFrom", "recovered_from", "asset"]) {
      expect(row, `no row has a ${never}`).not.toHaveProperty(never);
    }
    const declared = new Set(Object.keys(IndexCatalogApp.shape));
    for (const key of Object.keys(row ?? {})) {
      expect(declared.has(key), `${key} is a declared column`).toBe(true);
    }
  });

  it("clips the title, takes the file name for an empty one, drops a row whose file name or identity is not one, and folds an unheard availability", async () => {
    const notHex = app("not-hex", 2);
    const entries: ArtifactEntry[] = [
      app("long", 6, { title: "x".repeat(300) }),
      app("untitled", 5, { title: "" }),
      app("nested", 4, { filename: "nested/app.html" }),
      app("dots", 3, { filename: ".." }),
      { ...notHex, publication: { ...notHex.publication, artifact_id: "not-hex" } },
      app("odd-word", 1, { availability: "captured_partially" }),
    ];
    const { apps, catalog } = appsOver(library(entries));
    catalog.land();
    await advance(0);
    expect(apps.ready, "the walk landed").toBe(true);
    expect(apps.table.get(id("long"))?.title, "clipped to TITLE_CHARS").toBe(
      "x".repeat(ARTIFACT_LIMITS.TITLE_CHARS),
    );
    expect(apps.table.get(id("untitled"))?.title, "an empty title takes the file name").toBe(
      "untitled.html",
    );
    expect(apps.table.has(id("nested")), "a file name that is a path is no row").toBe(false);
    expect(apps.table.has(id("dots")), "neither is `..`").toBe(false);
    expect(apps.table.has("not-hex"), "an identity that is not rosetta's is no row").toBe(false);
    expect(
      apps.table.get(id("odd-word"))?.availability,
      "a word this build has not heard folds to unknown",
    ).toBe("unknown");
    expect(apps.table.size, "the rest of the page landed").toBe(3);
  });

  it("stamps this desktop on every row, and stamps every row again once the id moves", async () => {
    const lib = library([app("a", 2), app("b", 1)]);
    const { apps, catalog } = appsOver(lib, { rereadPage: 1 });
    catalog.land();
    await advance(0);
    expect(
      apps.table.rows().map((row) => row.device),
      "stamped with this desktop",
    ).toEqual(["dev-a", "dev-a"]);

    catalog.deviceId = "dev-b";
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    // the re-read's one page holds `a` and stops there; `b` is stamped all the same
    expect(
      apps.table.rows().map((row) => row.device),
      "every row re-stamped once the id moved",
    ).toEqual(["dev-b", "dev-b"]);
  });

  it("stamps the origin's preview from AppIntentStamps, never keep or hide (RULINGS L8), and restamps on the origin's word", async () => {
    const preview: MadeAppPreview = {
      id: "01JC4MA0PV0000000000000001",
      digest: hex("jpeg"),
      pageDigest: hex("page:a:1"),
      capturedAt: 5_000,
    };
    const stamped = new Map<string, ReturnType<AppIntentStamps["of"]>>([
      [id("a"), { preview, kept: true, hidden: true }],
    ]);
    const stamps: AppIntentStamps = { of: (appId) => stamped.get(appId) };
    const { apps, catalog } = appsOver(library([app("a", 2), app("b", 1)]), { stamps });
    catalog.land();
    await advance(0);
    const a = apps.table.get(id("a"));
    expect(a?.preview, "the origin's preview rides its row").toEqual(preview);
    expect(a, "keep is the person's intent, never a row's").not.toHaveProperty("kept");
    expect(a, "nor is hide").not.toHaveProperty("hidden");
    expect(apps.table.get(id("b")), "b is a row").toBeDefined();
    expect(apps.table.get(id("b")), "with no preview yet").not.toHaveProperty("preview");

    const revision = apps.table.revision;
    stamped.set(id("b"), { preview: { ...preview, id: "01JC4MA0PV0000000000000002" } });
    apps.restampIntents([id("b")]);
    expect(apps.table.get(id("b"))?.preview?.id, "restamped").toBe("01JC4MA0PV0000000000000002");
    expect(apps.table.revision, "as one frame").toBe(revision + 1);
  });

  it("says libraryReady from rosetta's canonical_ready, false as false", async () => {
    const lib = library([app("a", 1)]);
    lib.canonicalReady = false;
    const { apps, catalog } = appsOver(lib);
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    expect(apps.libraryReady, "still reading its history is false, never unknown").toBe(false);
    expect(apps.standing().libraryReady).toBe(false);

    lib.canonicalReady = true;
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(apps.libraryReady, "the next page says ready").toBe(true);
  });

  it("stops reading once disposed, and stops listening to the catalog", async () => {
    const lib = library([app("a", 1)]);
    const { apps, catalog } = appsOver(lib);
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    const before = lib.calls.length;
    apps.dispose();
    catalog.moved("sessions");
    await advance(INDEX_MESH.META_RESNAPSHOT_MS);
    expect(lib.calls, "a disposed table reads nothing more").toHaveLength(before);
    expect(catalog.listenerCount("changed"), "and no longer hears the catalog").toBe(0);
  });
});

describe("IndexApps — the standing on every frame (MA-3a; contracts OWNER_STANDING)", () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const BASE = "https://studio.tail1234.ts.net:14211/";

  it("declares libraryReady and previewsBase on either arm of the open answer, each snapshot page, each delta and the heartbeat", async () => {
    const lib = library([app("a", 2), app("b", 1)]);
    const { apps, catalog } = appsOver(lib, { previewsBase: () => BASE });
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    const standing = { libraryReady: true, previewsBase: BASE };
    expect(apps.standing(), "the standing the frames declare").toEqual(standing);

    // a fresh reader: the snapshot arm, then its deltas and heartbeats
    const fresh: Array<{ payload: unknown; kind: string }> = [];
    const follow = apps.pump({
      emit: (payload, kind) => fresh.push({ payload, kind }),
      digestIntervalMs: 1_000,
    });
    cleanup.push(() => follow.dispose());
    expect(IndexAppsCatalogOpen.safeParse(follow.open).success, "the open answer parses").toBe(
      true,
    );
    expect(snapshotOf(follow.open), "the snapshot arm declares the standing").toMatchObject({
      rows: expect.any(Array),
      ...standing,
    });
    follow.start();
    const kept = apps.table.cursor();

    lib.apps = [app("n", 3), ...lib.apps];
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    await advance(ROWS.MIN_INTERVAL_MS);
    expect(apps.table.has(id("n")), "the re-read moved the table").toBe(true);

    // a reader that kept its cursor: the resumed arm, and its catch-up
    const caught: Array<{ payload: unknown; kind: string }> = [];
    const resumed = apps.pump({
      since: kept,
      emit: (payload, kind) => caught.push({ payload, kind }),
      digestIntervalMs: 0,
    });
    cleanup.push(() => resumed.dispose());
    expect(IndexAppsCatalogOpen.safeParse(resumed.open).success).toBe(true);
    expect(resumed.open, "the resumed arm declares the standing").toMatchObject({
      resumed: { epoch: apps.epoch, revision: kept.revision },
      ...standing,
    });
    resumed.start();
    expect(caught, "its catch-up").toHaveLength(1);
    expect(caught[0]?.payload).toMatchObject({
      upserts: [expect.objectContaining({ appId: id("n") })],
      ...standing,
    });

    lib.apps = [app("m", 4), ...lib.apps];
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS);
    await advance(1_000);
    const frames = fresh.map((frame) => frame.payload as Record<string, unknown>);
    expect(
      frames.some(
        (frame) =>
          Array.isArray(frame.upserts) &&
          frame.upserts.some((row) => (row as { appId?: string }).appId === id("m")),
      ),
      "the fresh reader heard m",
    ).toBe(true);
    expect(
      frames.some((frame) => "digest" in frame),
      "and a heartbeat",
    ).toBe(true);
    for (const frame of [...frames, ...caught.map((c) => c.payload as Record<string, unknown>)]) {
      expect(frame, "every delta declares the standing").toMatchObject(standing);
      expect(IndexAppsCatalogDelta.safeParse(frame).success, "and parses as the door's delta").toBe(
        true,
      );
    }

    // a snapshot in pages: every page declares it
    const paged = appsOver(library([app("p", 3), app("q", 2), app("r", 1)]), {
      previewsBase: () => BASE,
      pageBytes: 1,
    });
    paged.catalog.land();
    await advance(0);
    expect(paged.apps.ready, "the paged table's walk landed").toBe(true);
    const pages: unknown[] = [];
    const pump = paged.apps.pump({ emit: (payload) => pages.push(payload), digestIntervalMs: 0 });
    cleanup.push(() => pump.dispose());
    pages.unshift(snapshotOf(pump.open));
    pump.start();
    expect(pages, "one row a page").toHaveLength(3);
    for (const page of pages) {
      expect(page, "every page declares the standing").toMatchObject(standing);
      expect(IndexAppsCatalogSnapshotPage.safeParse(page).success).toBe(true);
    }
  });

  it("sends a standing that moved with no row moved at once, as a delta with no rows at the revision the reader holds", async () => {
    let base: string | undefined;
    const lib = library([app("a", 1)]);
    lib.canonicalReady = false;
    const { apps, catalog } = appsOver(lib, { previewsBase: () => base });
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    const frames: unknown[] = [];
    const pump = apps.pump({ emit: (payload) => frames.push(payload), digestIntervalMs: 0 });
    cleanup.push(() => pump.dispose());
    expect(snapshotOf(pump.open), "the open declares the library still reading").toMatchObject({
      libraryReady: false,
    });
    expect(snapshotOf(pump.open), "and no previews serve yet").not.toHaveProperty("previewsBase");
    pump.start();
    const held = apps.table.revision;

    base = BASE;
    apps.standingChanged();
    await drain();
    expect(frames, "at once, not at the floor").toHaveLength(1);
    expect(frames[0], "a delta with no rows at the reader's revision").toEqual({
      epoch: apps.epoch,
      since: held,
      revision: held,
      upserts: [],
      removed: [],
      libraryReady: false,
      previewsBase: BASE,
    });
    expect(IndexAppsCatalogDelta.safeParse(frames[0]).success).toBe(true);
    expect(apps.table.revision, "the table's revision moves only with a row").toBe(held);
    apps.standingChanged();
    await drain();
    expect(frames, "a standing that did not move sends nothing").toHaveLength(1);

    // the library's own word: canonical_ready turning true, no row moved
    lib.canonicalReady = true;
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(frames, "the library's standing moved").toHaveLength(2);
    expect(frames[1]).toEqual({
      epoch: apps.epoch,
      since: held,
      revision: held,
      upserts: [],
      removed: [],
      libraryReady: true,
      previewsBase: BASE,
    });
  });
});

// ── the review's rows (MA-3a review fixes): what the green does past the red's rows ──

interface Said {
  level: string;
  event: string;
  attrs: LogFields | undefined;
}

/** A logger that keeps every line it is told (the event, the level, the attributes). */
const recorder = (): { said: Said[]; logger: Logger } => {
  const said: Said[] = [];
  const at =
    (level: string) =>
    (event: string, _message: string, attrs?: LogFields): void => {
      said.push({ level, event, attrs });
    };
  const logger: Logger = {
    child: () => logger,
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: (event, _message, _error, attrs) => {
      said.push({ level: "error", event, attrs });
    },
    fatal: (event, _message, _error, attrs) => {
      said.push({ level: "fatal", event, attrs });
    },
    isLevelEnabled: () => true,
  };
  return { said, logger };
};

/** Hold the asks `which` picks until `release()`; each held ask reads the library as it stands at the release. */
const holding = (lib: Library, which: (ask: IndexArtifactsRead, n: number) => boolean) => {
  const releases: Array<() => void> = [];
  lib.hold = (ask, n) =>
    which(ask, n)
      ? new Promise<void>((resolve) => {
          releases.push(resolve);
        })
      : undefined;
  return {
    get held(): number {
      return releases.length;
    },
    release(): void {
      lib.hold = undefined;
      for (const release of releases.splice(0)) release();
    },
  };
};

describe("IndexApps — what a frame reads now, and the cap (MA-3a review)", () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const preview = (n: number): MadeAppPreview => ({
    id: `01JC4MA0PV000000000000000${n}`,
    digest: hex(`jpeg:${n}`),
    pageDigest: hex(`page:a:${n}`),
    capturedAt: 5_000 + n,
  });

  it("a restamp that lands while a walk reads survives that walk's landing (the preview is read when the frame is made)", async () => {
    const lib = library([app("a", 3), app("b", 2), app("c", 1)]);
    const stamped = new Map<string, ReturnType<AppIntentStamps["of"]>>();
    const stamps: AppIntentStamps = { of: (appId) => stamped.get(appId) };
    const held = holding(lib, (_ask, n) => n === 2);
    const { apps, catalog } = appsOver(lib, { walkPage: 1, stamps });
    catalog.land();
    await advance(0);
    expect(held.held, "the first walk's second page is held").toBe(1);
    expect(apps.table.get(id("a")), "a, read on page 1, has no preview yet").not.toHaveProperty(
      "preview",
    );

    // a capture finishes while the walk reads: 3b says so once (`previews-changed`)
    stamped.set(id("a"), { preview: preview(1) });
    apps.restampIntents([id("a")]);
    expect(apps.table.get(id("a"))?.preview, "restamped at once").toEqual(preview(1));

    held.release();
    await advance(0);
    expect(apps.ready, "the walk landed").toBe(true);
    expect(apps.table.get(id("a"))?.preview, "the landing keeps the new preview").toEqual(
      preview(1),
    );
  });

  it("at the cap a walking frame removes nothing: it keeps an app still in the library, holds a new one back, and the landing makes the ROWS newest", async () => {
    const lib = library([app("a", 300), app("b", 200), app("c", 100)]);
    const { apps, catalog } = appsOver(lib, { walkPage: 1, rowCap: 3, resnapshotMs: 1_000 });
    const sizes: number[] = [];
    apps.table.onDelta(() => sizes.push(apps.table.size));
    catalog.land();
    await advance(0);
    expect(apps.table.keys().sort(), "the first walk holds the three").toEqual(
      [id("a"), id("b"), id("c")].sort(),
    );

    lib.apps = [app("n", 400), app("a", 300), app("c", 100)]; // b left the library, n arrived
    const at = lib.calls.length;
    const held = holding(lib, (_ask, n) => n === at + 2);
    await advance(1_000);
    expect(held.held, "the cadence's walk is held on its second page").toBe(1);
    expect(apps.table.has(id("c")), "c is still in the library: the walking frame kept it").toBe(
      true,
    );
    expect(apps.table.has(id("b")), "nothing is removed while walking, b included").toBe(true);
    expect(apps.table.has(id("n")), "the new app waits for the landing").toBe(false);
    held.release();
    await advance(0);
    expect(apps.table.keys().sort(), "the landing: the ROWS newest of what the walk read").toEqual(
      [id("n"), id("a"), id("c")].sort(),
    );
    expect(Math.max(...sizes), "the table never held more than ROWS").toBeLessThanOrEqual(3);

    // a walk that gives up at the cap removes nothing either
    const second = library([app("a", 300), app("b", 200), app("c", 100)]);
    const other = appsOver(second, { walkPage: 1, rowCap: 3, resnapshotMs: 1_000 });
    other.catalog.land();
    await advance(0);
    const firstWalk = second.calls.length;
    second.apps = [app("n", 400), app("a", 300), app("c", 100)];
    second.fail = (ask) => (ask.cursor !== undefined ? expired() : undefined);
    await advance(1_000);
    expect(
      heads(second.calls.slice(firstWalk)).filter((head) => head === "head"),
      "the walk read n at every head and gave up",
    ).toHaveLength(1 + MADE_APP_LIMITS.WALK_RESTARTS);
    expect(
      other.apps.table.keys().sort(),
      "a walk that gave up removed nothing: c (still in the library) and b (gone) both held",
    ).toEqual([id("a"), id("b"), id("c")].sort());
  });

  it("a re-read at the cap holds a newer app back and owes a walk, which lands it; an older one owes nothing", async () => {
    const lib = library([app("a", 300), app("b", 200), app("c", 100)]);
    const { apps, catalog } = appsOver(lib, { rowCap: 3, walkPage: 50, rereadPage: 20 });
    const sizes: number[] = [];
    apps.table.onDelta(() => sizes.push(apps.table.size));
    catalog.land();
    await advance(0);
    expect(apps.table.size, "the first walk filled the cap").toBe(3);

    const at = lib.calls.length;
    lib.apps = [app("n", 400), ...lib.apps];
    const held = holding(lib, (ask) => ask.limit === 50);
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(
      lib.calls.slice(at).map((ask) => ask.limit),
      "the re-read, then the walk it owed",
    ).toEqual([20, 50]);
    expect(held.held, "the owed walk is held").toBe(1);
    expect(apps.table.has(id("c")), "the re-read removed nothing").toBe(true);
    expect(apps.table.has(id("n")), "n waits for the walk's landing").toBe(false);
    held.release();
    await advance(0);
    expect(apps.table.keys().sort(), "the walk landed the ROWS newest").toEqual(
      [id("n"), id("a"), id("b")].sort(),
    );
    expect(Math.max(...sizes), "the table never held more than ROWS").toBeLessThanOrEqual(3);

    // apps older than every row held: none of them would be a row, so no walk is owed
    const now = lib.calls.length;
    lib.apps = [...lib.apps, app("old", 50)];
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS);
    expect(
      lib.calls.slice(now).map((ask) => ask.limit),
      "a re-read alone",
    ).toEqual([20]);
    expect(apps.table.keys().sort()).toEqual([id("n"), id("a"), id("b")].sort());
  });

  it("a sessions change while the first walk reads owes a re-read once it lands (its head may predate the change)", async () => {
    const lib = library([app("a", 2), app("b", 1)]);
    const held = holding(lib, (_ask, n) => n === 2);
    const { apps, catalog } = appsOver(lib, { walkPage: 1 });
    catalog.land();
    await advance(0);
    expect(held.held, "the first walk's second page is held").toBe(1);

    // an ingest the first page could not have seen, and the catalog's word of it
    lib.apps = [app("n", 3), ...lib.apps];
    catalog.moved("sessions");
    held.release();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);
    expect(apps.table.has(id("n")), "its head predates n").toBe(false);

    const walked = lib.calls.length;
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(lib.calls.slice(walked), "the re-read the change owed").toEqual([
      { limit: MADE_APP_LIMITS.REREAD_PAGE },
    ]);
    expect(apps.table.has(id("n")), "which reads n").toBe(true);
  });

  it("a threads change re-roots the held rows as one frame and reads nothing: a child whose thread reached the catalog after its app was read", async () => {
    const lib = library([app("from-child", 2, { session: "child-1" }), app("plain", 1)]);
    const { apps, catalog } = appsOver(lib);
    catalog.land();
    await advance(0);
    expect(apps.table.get(id("from-child")), "read before its thread: no root").not.toHaveProperty(
      "rootSessionId",
    );
    const reads = lib.calls.length;
    const revision = apps.table.revision;

    catalog.threads.upsert([thread("child-1", "root-1")]);
    catalog.moved("threads");
    const child = apps.table.get(id("from-child"));
    expect(child?.rootSessionId, "its root, through threads").toBe("root-1");
    expect(apps.table.revision, "as one frame").toBe(revision + 1);
    expect(lib.calls, "and nothing read").toHaveLength(reads);

    // member for member the row a fresh read makes, so the next read moves nothing
    const fresh = appsOver(library([...lib.apps]), { catalog });
    await advance(0);
    expect(fresh.apps.ready, "a fresh table over the same catalog").toBe(true);
    expect(JSON.stringify(child), "the fresh read's row").toBe(
      JSON.stringify(fresh.apps.table.get(id("from-child"))),
    );
    expect(apps.table.get(id("plain")), "a top-level app names no root").not.toHaveProperty(
      "rootSessionId",
    );

    // the thread left (its session is a root now): the root goes with it
    catalog.threads.remove(["child-1"]);
    catalog.moved("threads");
    expect(apps.table.get(id("from-child")), "its own root again").not.toHaveProperty(
      "rootSessionId",
    );
    expect(lib.calls, "still nothing read").toHaveLength(reads);
  });

  it("a page with no entries that still points on is no completed walk: it lands nothing, and says walk-stalled", async () => {
    const lib = library([app("x", 3), app("y", 2), app("z", 1)]);
    let stalled = false;
    const catalog = new CatalogStandIn();
    const apps = new IndexApps({
      catalog,
      artifacts: async (ask) =>
        stalled ? { entries: [], next_cursor: "on", canonical_ready: true } : lib.read(ask),
      resnapshotMs: 1_000,
    });
    cleanup.push(() => apps.dispose());
    apps.start();
    catalog.land();
    await advance(0);
    expect(apps.table.size, "the first walk landed the three").toBe(3);

    stalled = true;
    await advance(1_000);
    expect(apps.table.keys().sort(), "a stalled walk removes nothing").toEqual(
      [id("x"), id("y"), id("z")].sort(),
    );
    expect(apps.refusal, "and says why").toEqual({ read: "walk-stalled" });

    stalled = false;
    lib.apps = [app("x", 3)];
    await advance(1_000);
    expect(apps.table.keys(), "the next completed walk removes what left").toEqual([id("x")]);
    expect(apps.refusal, "and clears the word").toBeNull();
  });
});

describe("IndexApps — the reads' cadence and words (MA-3a review)", () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a first walk rosetta refuses is tried again at the floor, doubling up to the cadence; refusal says why, and the streak warns once", async () => {
    const floor = MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS;
    const lib = library([app("a", 1)]);
    lib.fail = () =>
      new RpcCallError("UNAVAILABLE", "the agent index answered a malformed library", true, {
        service: "index",
        state: "malformed",
      });
    const { said, logger } = recorder();
    const { apps, catalog } = appsOver(lib, { logger, resnapshotMs: floor * 3 });
    catalog.land();
    await advance(0);
    expect(lib.calls, "the first walk").toHaveLength(1);
    expect(apps.ready, "it did not land").toBe(false);
    expect(apps.refusal, "why, in the refusal's own words").toEqual({
      read: "walk",
      kind: "UNAVAILABLE",
      state: "malformed",
    });

    await advance(floor - 1);
    expect(lib.calls, "no retry before the floor").toHaveLength(1);
    await advance(1);
    expect(lib.calls, "the floor's retry").toHaveLength(2);
    await advance(2 * floor - 1);
    expect(lib.calls, "the next waits twice the floor").toHaveLength(2);
    await advance(1);
    expect(lib.calls, "the second retry").toHaveLength(3);
    await advance(3 * floor - 1);
    expect(lib.calls, "four floors is past the cadence, which caps it").toHaveLength(3);
    await advance(1);
    expect(lib.calls, "the third retry, at the cadence").toHaveLength(4);
    expect(
      said
        .filter((line) => line.event === "fieldd.index_apps.read_failed")
        .map((line) => line.level),
      "one warn for the streak, then debug",
    ).toEqual(["warn", "debug", "debug", "debug"]);

    lib.fail = undefined;
    await advance(3 * floor);
    expect(apps.ready, "the retry that is answered lands").toBe(true);
    expect(apps.refusal, "and clears the word").toBeNull();
    expect(lib.calls, "one more walk").toHaveLength(5);
  });

  it("PIN — one read at a time: a re-read due while a walk reads waits for it, and a walk due while a re-read reads waits for that", async () => {
    const lib = library([app("a", 2), app("b", 1)]);
    const cadence = 60_000;
    const { apps, catalog } = appsOver(lib, { walkPage: 1, rereadPage: 5, resnapshotMs: cadence });
    catalog.land();
    await advance(0);
    expect(apps.ready, "the first walk landed").toBe(true);

    const at = lib.calls.length;
    const walk = holding(lib, (_ask, n) => n === at + 2);
    await advance(cadence);
    expect(walk.held, "the cadence's walk is held on its second page").toBe(1);
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS + MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(
      lib.calls.slice(at).map((ask) => ask.limit),
      "no re-read beside the walk",
    ).toEqual([1, 1]);
    walk.release();
    await advance(0);
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(
      lib.calls.slice(at).map((ask) => ask.limit),
      "the walk, then the re-read it held back",
    ).toEqual([1, 1, 5]);

    const again = lib.calls.length;
    const reread = holding(lib, (ask) => ask.limit === 5);
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS);
    expect(reread.held, "the next re-read is held").toBe(1);
    await advance(cadence);
    expect(
      lib.calls.slice(again).map((ask) => ask.limit),
      "no walk beside the re-read",
    ).toEqual([5]);
    reread.release();
    await advance(0);
    expect(
      lib.calls.slice(again).map((ask) => ask.limit),
      "the re-read, then the walk it held back",
    ).toEqual([5, 1, 1]);
  });

  it("PIN — heardAt is when the library last answered a page: null before any, then each read's time", async () => {
    const lib = library([app("a", 1)]);
    const { apps, catalog } = appsOver(lib);
    expect(apps.heardAt, "nothing heard yet").toBeNull();
    catalog.land();
    await advance(0);
    const first = apps.heardAt;
    expect(first, "the walk's page").toBe(Date.now());
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_DELAY_MS);
    expect(apps.heardAt, "the re-read's page, later").toBe(Date.now());
    expect(apps.heardAt ?? 0).toBeGreaterThan(first ?? 0);

    lib.fail = () => expired();
    catalog.moved("sessions");
    await advance(MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS);
    expect(apps.heardAt, "a refused read is not heard").toBe(
      first === null ? null : first + MADE_APP_LIMITS.REREAD_DELAY_MS,
    );
  });

  it("PIN — a previews base that is not a root https URL is no standing: stripped from every frame, and said once without its URL", async () => {
    const { said, logger } = recorder();
    let base = "https://studio.tail1234.ts.net:14211/previews/";
    const { apps, catalog } = appsOver(library([app("a", 1)]), {
      previewsBase: () => base,
      logger,
    });
    catalog.land();
    await advance(0);
    expect(apps.standing(), "a base with a path is none").toEqual({ libraryReady: true });
    base = "http://studio.tail1234.ts.net:14211/";
    apps.standingChanged();
    expect(apps.standing(), "nor is one that is not https").toEqual({ libraryReady: true });
    const pump = apps.pump({ emit: () => undefined, digestIntervalMs: 0 });
    cleanup.push(() => pump.dispose());
    expect(snapshotOf(pump.open), "no frame declares it").not.toHaveProperty("previewsBase");
    expect(
      said
        .filter((line) => line.event === "fieldd.index_apps.previews_base_refused")
        .map((line) => line.level),
      "said once",
    ).toEqual(["warn"]);
    expect(JSON.stringify(said), "never its URL (EL7)").not.toContain("tail1234");
  });
});

describe("IndexApps — validate or strip, member by member (MA-3a review; the lead's C16)", () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("PIN — a stamp's preview the contract does not read is stripped, and so is one that carries a url", async () => {
    const good: MadeAppPreview = {
      id: "01JC4MA0PV0000000000000001",
      digest: hex("jpeg"),
      pageDigest: hex("page:a:1"),
      capturedAt: 5_000,
    };
    const stamped = new Map<string, unknown>([
      [id("bad-id"), { preview: { ...good, id: "not a ulid" } }],
      [id("bad-digest"), { preview: { ...good, digest: "NOT-HEX" } }],
      [id("with-url"), { preview: { ...good, url: "https://elsewhere.example/x.jpg" } }],
      [id("good"), { preview: { ...good, extra: "never rides" } }],
    ]);
    const stamps = { of: (appId: string) => stamped.get(appId) } as AppIntentStamps;
    const names = ["bad-id", "bad-digest", "with-url", "good"];
    const { apps, catalog } = appsOver(library(names.map((name, n) => app(name, 10 - n))), {
      stamps,
    });
    catalog.land();
    await advance(0);
    for (const name of names.slice(0, 3)) {
      expect(apps.table.get(id(name)), `${name} is a row`).toBeDefined();
      expect(apps.table.get(id(name)), `${name} rides no preview`).not.toHaveProperty("preview");
    }
    expect(apps.table.get(id("good"))?.preview, "the good one, by projection").toEqual(good);
  });

  it("PIN — an optional fact the contract does not read costs that fact, never the row: digest, hosted url, native id, project", async () => {
    const notHex = app("not-hex", 6);
    const tooLong = "n".repeat(MADE_APP_LIMITS.NATIVE_ID_CHARS + 1);
    const entries: ArtifactEntry[] = [
      {
        ...notHex,
        asset: notHex.asset === null ? null : { ...notHex.asset, digest: "NOT-A-DIGEST" },
      },
      {
        ...app("http", 5),
        publication: { ...app("http", 5).publication, url: "http://example.com/a" },
      },
      {
        ...app("long-native", 4),
        publication: { ...app("long-native", 4).publication, native_id: tooLong },
      },
      {
        ...app("empty-native", 3),
        publication: { ...app("empty-native", 3).publication, native_id: "" },
      },
      { ...app("no-project", 2), project_id: "" },
      { ...app("null-project", 1), project_id: null },
    ];
    const { apps, catalog } = appsOver(library(entries));
    catalog.land();
    await advance(0);
    expect(apps.table.size, "every entry is a row").toBe(entries.length);
    const row = (name: string) => apps.table.get(id(name));
    expect(row("not-hex"), "a digest that is not blake3 hex is none").not.toHaveProperty("digest");
    expect(row("not-hex")?.byteLen, "the asset's size stays").toBe(notHex.asset?.byte_len);
    expect(row("http"), "an http link is no hosted link").not.toHaveProperty("hostedUrl");
    expect(row("long-native"), "a native id past NATIVE_ID_CHARS is none").not.toHaveProperty(
      "nativeId",
    );
    expect(row("empty-native"), "nor is an empty one").not.toHaveProperty("nativeId");
    expect(row("no-project"), "an empty project is no project").not.toHaveProperty("projectId");
    expect(row("null-project")).not.toHaveProperty("projectId");
    for (const held of apps.table.rows()) {
      expect(IndexCatalogApp.safeParse(held).success, `${held.filename} parses`).toBe(true);
      expect(
        Object.values(held).some((value) => value === undefined),
        `${held.filename} holds no undefined member`,
      ).toBe(false);
    }
  });
});

// ── over the real catalog and the real reader, against the scripted rosettad ──

/** A supervisor that is only what the catalog and the reader read: its state, its health, its transitions. */
function supervisorAt(origin: string): RosettadSupervisor {
  const events = new EventEmitter();
  const state: RosettadState = {
    phase: "ready",
    origin,
    detail: null,
    pid: 1,
    protocolVersion: PROTOCOL_VERSION,
    announce: null,
    enrollRefusals: [],
  };
  return Object.assign(events, {
    state: () => state,
    health: () => state,
  }) as unknown as RosettadSupervisor;
}

async function startFake(script: { sessions: unknown[]; artifacts: { entries: ArtifactEntry[] } }) {
  const dir = mkdtempSync(join(tmpdir(), "vf-index-apps-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const files = {
    sessions: join(dir, "sessions.json"),
    artifacts: join(dir, "artifacts.json"),
    requests: join(dir, "requests.log"),
  };
  writeFileSync(files.sessions, JSON.stringify(script.sessions));
  writeFileSync(files.artifacts, JSON.stringify(script.artifacts));
  const child: ChildProcess = spawn(process.execPath, [FAKE, "serve", "--json"], {
    env: {
      ...process.env,
      FAKE_ROSETTAD_MODE: "ok",
      FAKE_ROSETTAD_SESSIONS: files.sessions,
      FAKE_ROSETTAD_ARTIFACTS: files.artifacts,
      FAKE_ROSETTAD_REQUEST_LOG: files.requests,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanup.push(() => {
    child.kill("SIGINT");
  });
  const origin = await new Promise<string>((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("the fake never said ready")), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      for (const line of buffered.split("\n")) {
        try {
          const parsed = JSON.parse(line) as { event?: string; origin?: string };
          if (parsed.event === "ready" && typeof parsed.origin === "string") {
            clearTimeout(timer);
            resolve(parsed.origin);
          }
        } catch {
          // not a whole line yet
        }
      }
    });
    child.once("exit", (code) => reject(new Error(`the fake exited ${code}`)));
  });
  const asked = (): string[] =>
    existsSync(files.requests)
      ? readFileSync(files.requests, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => line.slice(line.indexOf(" ") + 1))
      : [];
  return { dir, origin, asked };
}

/** Wait, bounded, for a condition; the caller ASSERTS on the answer. */
async function settle(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

const rosettaSession = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  native_session_id: `nat-${id}`,
  root_session_id: id,
  parent_session_id: null,
  runtime_id: "rt-claude",
  project_id: "p1",
  cwd: "/work/app",
  title: `title ${id}`,
  summary: null,
  started_at: 1_000,
  updated_at: 2_000,
  activity: { first_at: 1_000, last_at: 5_000 },
  stream_state: "indexed",
  role: "primary",
  delegation: null,
  ...over,
});

describe("IndexApps over the real catalog and reader (the scripted rosettad, MA-3a)", () => {
  it("lands the first walk after the catalog's snapshot: a delegated session's app carries its root, the agent its provider, and no path rides a row", async () => {
    const childApp = [1, 2].map((version) =>
      app("child-app", 3_000 + version, { session: "c1", version }),
    );
    const { dir, origin, asked } = await startFake({
      sessions: [
        rosettaSession("s1"),
        rosettaSession("c1", { parent_session_id: "s1", root_session_id: "s1", role: "subagent" }),
      ],
      artifacts: { entries: [app("root-app", 2_000, { session: "s1" }), ...childApp] },
    });
    const supervisor = supervisorAt(origin);
    const index = new IndexService({
      supervisor,
      store: new EnrollmentStore({ path: join(dir, "enrollment.json") }),
      expectedProtocolVersion: PROTOCOL_VERSION,
    });
    cleanup.push(() => index.dispose());
    const catalog = new IndexCatalog({
      supervisor,
      expectedProtocolVersion: PROTOCOL_VERSION,
      deviceId: () => "dev-a",
      epoch: "boot-test",
      batchMs: 20,
      reconnectMinMs: 50,
      reconnectMaxMs: 200,
      resnapshotMs: 0,
    });
    cleanup.push(() => catalog.dispose());
    const apps = new IndexApps({ catalog, artifacts: (ask) => index.artifacts(ask) });
    cleanup.push(() => apps.dispose());
    apps.start();
    catalog.start();

    const landed = await settle(() => apps.ready, 5_000);
    expect(landed, "the first walk landed after the catalog's snapshot").toBe(true);
    expect(catalog.threads.get("c1")?.rootSessionId, "the catalog holds the child").toBe("s1");
    expect(apps.table.keys().sort(), "both apps").toEqual([id("child-app"), id("root-app")].sort());
    const child = apps.table.get(id("child-app"));
    expect(child, "the delegated session's app").toMatchObject({
      sessionId: "c1",
      rootSessionId: "s1",
      presentationId: hex("presentation:child-app:2"),
      versions: 2,
      kind: "claude-code",
      provider: readers.idForKind("claude-code"),
    });
    expect(apps.table.get(id("root-app")), "a root's app names no root").not.toHaveProperty(
      "rootSessionId",
    );
    expect(apps.libraryReady, "the library is ready").toBe(true);
    for (const row of apps.table.rows()) {
      expect(IndexCatalogApp.safeParse(row).success, `row ${row.appId} parses`).toBe(true);
    }
    expect(JSON.stringify(apps.table.rows()), "no path rides a row").not.toContain(
      "/Users/someone",
    );
    expect(asked(), "the walk's head, in rosetta's spelling").toContain(
      `/api/artifacts?limit=${MADE_APP_LIMITS.WALK_PAGE}`,
    );
    // the row's own deadline sits above its bounded wait, so a miss reds on the assertion, never on the runner's
    // clock (a config without the suite's 30 s, such as a unit speed run, would otherwise cut it at 5 s)
  }, 20_000);
});
