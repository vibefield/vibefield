// PJ-1 (§9; L1, L2, L7) — the place scanner over the files worker's REAL
// `placeFacts` (in process; the bundled worker's round trip is
// workspace-worker.test.ts) on real repositories, publishing to a catalog that
// is only what the scanner touches. The rows: every rosetta root becomes a
// place on its project's row, one per real path with the other spellings as
// aliases; a checkout's worktrees ride its row unless a row of their own names
// them; this desktop's own places find each other's samples on the pass after
// they first publish them; a peer's place does too, and its change asks for a
// pass; an unchanged pass publishes the same facts with the same `observedAt`
// (L2) and a commit moves only its own place's; a folder that goes keeps its
// last-known git facts (sticky); `acted` is the files service's roots matched
// by the longest prefix (L7); and nothing is scanned while the worker or the
// catalog has nothing to say.
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexCatalogProject, IndexCatalogSession, PlaceFacts } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogTable } from "../src/catalog-rows";
import {
  type ActedRoot,
  type PlaceCatalog,
  type PlaceFactsAsker,
  PlaceScanner,
  placeIdFor,
} from "../src/projects/place-scanner";
import { ProjectGroups } from "../src/projects/project-groups";
import { readPlaces } from "../src/workspace/host/places";
import type { FilesHostHealth } from "../src/workspace/supervisor";
import { FilesHostRefusal, FilesHostUnavailable } from "../src/workspace/supervisor";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ada",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_COMMITTER_NAME: "Ada",
      GIT_COMMITTER_EMAIL: "ada@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

function scratch(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-scan-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

function repo(base: string, name: string, commits: number): string {
  const root = join(base, name);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "remote", "add", "origin", `git@github.com:acme/${name}.git`);
  for (let i = 0; i < commits; i += 1) {
    writeFileSync(join(root, "n.txt"), `${name} ${i}\n`);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", `c${i}`);
  }
  return root;
}

const head = (root: string) => git(root, "rev-parse", "HEAD").trim();

const until = async (predicate: () => boolean, what: string, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** The catalog as the scanner sees it: rows of roots, and what it was told. */
function catalogOf(rows: Array<{ projectId: string; rootPaths: string[] }>) {
  const events = new EventEmitter();
  const told: Array<Map<string, PlaceFacts[]>> = [];
  const catalog = Object.assign(events, {
    ready: true,
    projects: { rows: () => rows },
    setPlaces: (places: ReadonlyMap<string, readonly PlaceFacts[]>) => {
      told.push(
        new Map([...places].map(([id, list]) => [id, list.map((place) => ({ ...place }))])),
      );
    },
  }) as unknown as PlaceCatalog & EventEmitter & { ready: boolean };
  return { catalog, told, rows, last: () => told.at(-1) ?? new Map<string, PlaceFacts[]>() };
}

/** The worker as the scanner sees it: the REAL reads, in this process. */
function workerOf(opts: { ready?: boolean } = {}) {
  const events = new EventEmitter();
  let phase: FilesHostHealth["phase"] = opts.ready === false ? "starting" : "ready";
  let failNext = false;
  let refuseNext = false;
  const asks: number[] = [];
  const worker = Object.assign(events, {
    health: (): FilesHostHealth => ({
      phase,
      detail: null,
      pid: 1,
      generation: 1,
      mille: null,
    }),
    request: async (_op: "placeFacts", args: Parameters<typeof readPlaces>[0]) => {
      asks.push(args.places.length);
      if (failNext) {
        failNext = false;
        throw new FilesHostUnavailable(
          "restarting",
          "the files worker exited while answering",
          true,
        );
      }
      if (refuseNext) {
        refuseNext = false;
        throw new FilesHostRefusal({ code: "internal", message: "did not answer in time" });
      }
      return readPlaces(args, { temps: [] });
    },
  }) as unknown as PlaceFactsAsker & EventEmitter;
  return {
    worker,
    asks,
    ready() {
      phase = "ready";
      events.emit("transition", worker.health());
    },
    failNext() {
      failNext = true;
    },
    refuseNext() {
      refuseNext = true;
    },
  };
}

function scanner(
  catalog: PlaceCatalog,
  worker: PlaceFactsAsker,
  over: {
    peers?: Array<{ device: string; places: PlaceFacts[] }>;
    acted?: ActedRoot[];
    now?: () => number;
    /** default: never on its own — the test drives each pass */
    settleMs?: number;
  } = {},
) {
  const s = new PlaceScanner({
    catalog,
    worker,
    deviceId: () => "dev-a",
    taskRoots: () => [],
    peerPlaces: () => over.peers ?? [],
    actedRoots: () => over.acted ?? [],
    ...(over.now !== undefined ? { now: over.now } : {}),
    intervalMs: 0,
    settleMs: over.settleMs ?? 60_000,
    batchPlaces: 2,
  });
  cleanup.push(() => s.dispose());
  return s;
}

const byPath = (places: Map<string, PlaceFacts[]>, projectId: string) =>
  new Map((places.get(projectId) ?? []).map((place) => [place.path, place]));

describe("the place scanner (PJ-1)", () => {
  it("publishes each root as a place on its row, worktrees on their checkout's, spellings as aliases", async () => {
    const base = scratch();
    const app = repo(base, "app", 3);
    const side = join(base, "app-side");
    git(app, "worktree", "add", "-q", "-b", "side", side);
    const lib = repo(base, "lib", 2);
    const named = join(base, "app-named");
    git(app, "worktree", "add", "-q", "-b", "named", named);
    const link = join(base, "lib-link");
    symlinkSync(lib, link);
    const plain = join(base, "notes");
    mkdirSync(plain);
    const { catalog, last } = catalogOf([
      { projectId: "p-app", rootPaths: [app] },
      // a second spelling of lib's folder (a link) is one place with an alias
      { projectId: "p-lib", rootPaths: [lib, link] },
      { projectId: "p-named", rootPaths: [named] },
      { projectId: "p-notes", rootPaths: [plain] },
    ]);
    const { worker } = workerOf();
    const s = scanner(catalog, worker);
    s.start();
    await s.scanNow();
    const places = last();
    // the worktree no row names rides the checkout's row; the named one its own
    expect([...byPath(places, "p-app").keys()]).toEqual([app, side]);
    expect([...byPath(places, "p-named").keys()]).toEqual([named]);
    const appPlace = byPath(places, "p-app").get(app);
    expect(appPlace).toMatchObject({
      placeId: placeIdFor("dev-a", app),
      kind: "project",
      exists: true,
      mounted: true,
      git: true,
      identityRemote: "github.com/acme/app",
      remotes: ["github.com/acme/app"],
      branch: "main",
      root: git(app, "rev-list", "--max-parents=0", "HEAD").trim(),
    });
    expect(appPlace?.samples.map((sample) => sample.depth)).toEqual([0, 1, 2]);
    expect(byPath(places, "p-app").get(side)?.worktreeOf).toBe(placeIdFor("dev-a", app));
    expect(byPath(places, "p-named").get(named)?.worktreeOf).toBe(placeIdFor("dev-a", app));
    expect(places.get("p-lib")).toHaveLength(1);
    expect(places.get("p-lib")?.[0]).toMatchObject({ path: lib, aliases: [link] });
    expect(places.get("p-notes")?.[0]).toMatchObject({ git: false, remotes: [], samples: [] });
    expect(s.lastPass()).toMatchObject({ places: 5, skipped: 0 });
  });

  it("this desktop's places find each other's samples, then a peer's — and a peer's change asks for a pass", async () => {
    const base = scratch();
    const a = repo(base, "a", 4);
    const b = join(base, "b");
    git(base, "clone", "-q", a, b);
    writeFileSync(join(a, "n.txt"), "ahead\n");
    git(a, "commit", "-q", "-am", "ahead");
    const { catalog, last } = catalogOf([
      { projectId: "p-a", rootPaths: [a] },
      { projectId: "p-b", rootPaths: [b] },
    ]);
    const { worker } = workerOf();
    const peers: Array<{ device: string; places: PlaceFacts[] }> = [];
    const s = scanner(catalog, worker, { peers, settleMs: 5 });
    s.start();
    await s.scanNow();
    // first pass: nobody's samples were known yet
    expect(last().get("p-a")?.[0]?.hits).toEqual([]);
    await s.scanNow();
    const idA = placeIdFor("dev-a", a);
    const idB = placeIdFor("dev-a", b);
    // a holds b's tip; b holds a's commit one back; never itself
    expect(last().get("p-a")?.[0]?.hits).toEqual([{ placeId: idB, sha: head(b), depth: 0 }]);
    expect(last().get("p-b")?.[0]?.hits).toEqual([{ placeId: idA, sha: head(b), depth: 1 }]);
    // a peer's clone of a, at a's tip: a holds it
    const root = last().get("p-a")?.[0]?.root ?? "";
    peers.push({
      device: "dev-b",
      places: [
        {
          placeId: "pl_peer",
          path: "/elsewhere/a",
          aliases: [],
          kind: "project",
          caseless: true,
          exists: true,
          mounted: true,
          git: true,
          remotes: [],
          root,
          samples: [{ sha: head(a), depth: 0 }],
          hits: [],
          observedAt: 1,
        },
      ],
    });
    s.peersChanged();
    await until(
      () =>
        last()
          .get("p-a")?.[0]
          ?.hits.some((hit) => hit.placeId === "pl_peer") === true,
      "the pass a peer's change asks for",
    );
    expect(last().get("p-a")?.[0]?.hits).toEqual([
      { placeId: idB, sha: head(b), depth: 0 },
      { placeId: "pl_peer", sha: head(a), depth: 0 },
    ]);
    // b lacks a's tip: the peer's place is not in it
    expect(last().get("p-b")?.[0]?.hits).toEqual([{ placeId: idA, sha: head(b), depth: 1 }]);
  });

  it("L2: an unchanged pass publishes equal facts; a commit moves only its own place's observedAt", async () => {
    const base = scratch();
    const one = repo(base, "one", 2);
    const two = repo(base, "two", 2);
    const { catalog, told, last } = catalogOf([
      { projectId: "p-1", rootPaths: [one] },
      { projectId: "p-2", rootPaths: [two] },
    ]);
    const { worker } = workerOf();
    let clock = 1_000;
    const s = scanner(catalog, worker, { now: () => clock });
    s.start();
    await s.scanNow();
    await s.scanNow(); // the hits settle (each one's samples were new to the other)
    const settled = last();
    clock = 2_000;
    await s.scanNow();
    expect(last()).toEqual(settled);
    expect(s.lastPass()).toMatchObject({ changed: 0, read: 0, unchanged: 2 });
    clock = 3_000;
    writeFileSync(join(one, "n.txt"), "moved\n");
    git(one, "commit", "-q", "-am", "moved");
    await s.scanNow();
    expect(last().get("p-1")?.[0]?.observedAt).toBe(3_000);
    expect(last().get("p-2")?.[0]?.observedAt).toBe(settled.get("p-2")?.[0]?.observedAt);
    expect(s.lastPass()).toMatchObject({ changed: 1, read: 1, unchanged: 1 });
    expect(told.length).toBeGreaterThanOrEqual(4);
  });

  it("a folder that goes keeps its last-known git facts (sticky); `exists` says it is gone", async () => {
    const base = scratch();
    const gone = repo(base, "gone", 2);
    const { catalog, last } = catalogOf([{ projectId: "p-gone", rootPaths: [gone] }]);
    const { worker } = workerOf();
    const s = scanner(catalog, worker);
    s.start();
    await s.scanNow();
    const was = last().get("p-gone")?.[0];
    rmSync(gone, { recursive: true, force: true });
    await s.scanNow();
    const now = last().get("p-gone")?.[0];
    expect(now).toMatchObject({
      exists: false,
      git: true,
      identityRemote: was?.identityRemote,
      root: was?.root,
      branch: "main",
      samples: was?.samples,
    });
    expect(now?.observedAt).toBeGreaterThanOrEqual(was?.observedAt ?? 0);
  });

  it("L7: `acted` is the files service's roots, matched to a place by the longest prefix", async () => {
    const base = scratch();
    const outer = repo(base, "outer", 1);
    const inner = join(outer, "packages", "inner");
    mkdirSync(inner, { recursive: true });
    const { catalog } = catalogOf([{ projectId: "p", rootPaths: [outer, inner] }]);
    const { worker } = workerOf();
    const s = scanner(catalog, worker, {
      acted: [
        { path: join(inner, "src"), kind: "place", lastActiveAt: "2026-10-07T10:00:00.000Z" },
        { path: outer, kind: "place", lastActiveAt: "2026-10-06T10:00:00.000Z" },
        { path: join(outer, "docs"), kind: "place", lastActiveAt: "2026-10-08T10:00:00.000Z" },
        { path: base, kind: "browse", lastActiveAt: null },
        { path: join(base, "elsewhere"), kind: "place", lastActiveAt: "2026-10-08T10:00:00.000Z" },
      ],
    });
    s.start();
    await s.scanNow();
    expect(s.acted()).toEqual(
      new Map([
        [placeIdFor("dev-a", inner), "2026-10-07T10:00:00.000Z"],
        [placeIdFor("dev-a", outer), "2026-10-08T10:00:00.000Z"],
      ]),
    );
  });

  it("scans nothing until the worker is ready; a worker lost mid-pass publishes nothing and the next READY scans", async () => {
    const base = scratch();
    const app = repo(base, "app", 1);
    const { catalog, told } = catalogOf([{ projectId: "p", rootPaths: [app] }]);
    const control = workerOf({ ready: false });
    const s = scanner(catalog, control.worker, { settleMs: 5 });
    s.start();
    await s.scanNow();
    expect(control.asks).toEqual([]);
    expect(told).toEqual([]);
    control.failNext();
    control.ready(); // the transition asks for a pass after the settle
    await until(() => control.asks.length === 1, "the first ask");
    await new Promise((r) => setTimeout(r, 50));
    expect(told).toEqual([]);
    control.ready();
    await until(() => told.length === 1, "the pass the next READY asks for");
  });

  it("a batch the worker refuses waits for the next pass; the others publish now", async () => {
    const base = scratch();
    const paths = ["a", "b", "c"].map((name) => repo(base, name, 1));
    const { catalog, last } = catalogOf(
      paths.map((path, i) => ({ projectId: `p-${i}`, rootPaths: [path] })),
    );
    const control = workerOf();
    const s = scanner(catalog, control.worker);
    s.start();
    control.refuseNext(); // the first batch (two places, `batchPlaces: 2`)
    await s.scanNow();
    expect([...last().keys()]).toEqual(["p-2"]);
    expect(s.lastPass()).toMatchObject({ skipped: 2, places: 1 });
    await s.scanNow();
    expect([...last().keys()].sort()).toEqual(["p-0", "p-1", "p-2"]);
  });

  it("§4: a remote-less checkout, its worktree and a clone group as ONE project by history alone", async () => {
    // worktreeOf is no join rule: only the hits this desktop finds between its
    // own places (same root) join a repository that has no remote
    const base = scratch();
    const app = join(base, "app");
    mkdirSync(app);
    git(app, "init", "-q", "-b", "main");
    for (const n of [1, 2, 3]) {
      writeFileSync(join(app, "n.txt"), `${n}\n`);
      git(app, "add", ".");
      git(app, "commit", "-q", "-m", `c${n}`);
    }
    const side = join(base, "app-side");
    git(app, "worktree", "add", "-q", "-b", "side", side);
    writeFileSync(join(side, "n.txt"), "side\n");
    git(side, "commit", "-q", "-am", "side");
    const copy = join(base, "app-copy");
    git(base, "clone", "-q", app, copy);
    git(copy, "remote", "remove", "origin");
    const other = join(base, "other");
    mkdirSync(other);
    git(other, "init", "-q", "-b", "main");
    git(other, "commit", "-q", "--allow-empty", "-m", "other");
    const { catalog, last } = catalogOf([
      { projectId: "p-app", rootPaths: [app] },
      { projectId: "p-copy", rootPaths: [copy] },
      { projectId: "p-other", rootPaths: [other] },
    ]);
    const { worker } = workerOf();
    const s = scanner(catalog, worker);
    s.start();
    await s.scanNow();
    await s.scanNow(); // the hits among this desktop's own places
    const projects = new CatalogTable<IndexCatalogProject>({
      epoch: "e",
      keyOf: (row) => row.projectId,
    });
    projects.upsert(
      [...last()].map(([projectId, places]) => ({
        device: "dev-a",
        projectId,
        name: projectId,
        rootPaths: [],
        sessionCount: 0,
        places,
      })),
    );
    const sessions = new CatalogTable<IndexCatalogSession>({
      epoch: "e",
      keyOf: (row) => row.sessionId,
    });
    const groups = new ProjectGroups({ deviceId: () => "dev-a", local: { projects, sessions } });
    const result = groups.regroupNow()?.result;
    const ids = (paths: string[]) => paths.map((path) => placeIdFor("dev-a", path)).sort();
    const partition = (result?.projects ?? []).map((p) => p.places.map((pl) => pl.placeId).sort());
    expect(partition).toContainEqual(ids([app, side, copy]));
    expect(partition).toContainEqual(ids([other]));
    expect(result?.projects).toHaveLength(2);
    const joined = result?.projects.find((p) => p.places.length === 3);
    expect(joined?.kind).toBe("local");
    expect(joined?.edges.every((edge) => edge.rule === "history")).toBe(true);
  });

  it("a catalog whose roots did not move asks for no pass; one whose roots moved does", async () => {
    const base = scratch();
    const app = repo(base, "app", 1);
    const lib = repo(base, "lib", 1);
    const rows = [{ projectId: "p-app", rootPaths: [app] }];
    const { catalog, last } = catalogOf(rows);
    const control = workerOf();
    const s = scanner(catalog, control.worker, { settleMs: 5 });
    s.start();
    await s.scanNow();
    await until(() => control.asks.length >= 2, "the pass its own samples ask for");
    await new Promise((r) => setTimeout(r, 100));
    const asked = control.asks.length;
    (catalog as unknown as EventEmitter).emit("changed", { tables: ["projects"] });
    await new Promise((r) => setTimeout(r, 100));
    expect(control.asks.length).toBe(asked);
    rows.push({ projectId: "p-lib", rootPaths: [lib] });
    (catalog as unknown as EventEmitter).emit("changed", { tables: ["projects"] });
    await until(() => last().has("p-lib"), "the pass new roots ask for");
  });
});
