// FS-1a — the worker's engines, in-process (mille's own loader): one engine
// per export, a place nested in the home export answered by ITS OWN engine;
// the cap (`WORKSPACE_LIMITS.HOSTS_MAX`): the least recently used idle engine
// goes, and every engine busy is a retryable refusal; the idle lease
// (`HOST_IDLE_MS`); a search's walk cut by its entry budget saying so
// (`complete: false`, never a silent "no matches"), what it walked kept for
// the next ask, and a narrower subtree covering what the wide one could not.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_LIMITS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { Engines, WorkerFailure } from "../src/workspace/host/engine";
import { TREE_SESSION_POLICY } from "../src/workspace/host/listener";
import { matchName, walkNames } from "../src/workspace/host/names";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function base(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "vf-eng-")));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function engines(opts: ConstructorParameters<typeof Engines>[0] = {}): Engines {
  const made = new Engines(opts);
  cleanup.push(() => made.disposeAll());
  return made;
}

const list = (e: Engines, rootPath: string, segments: string[] = []) =>
  e.list({ rootPath, segments, offset: 0, limit: 50, kinds: "all" });

describe("the worker's engines (one per export, bounded)", () => {
  it("answers a place nested in home with its own engine, never by walking home", async () => {
    const home = base();
    const place = join(home, "Projects", "repo");
    mkdirSync(join(place, "src"), { recursive: true });
    const e = engines();
    const viaPlace = await list(e, place);
    expect(viaPlace.path).toBe(place);
    expect(viaPlace.entries.map((entry) => entry.name)).toEqual(["src"]);
    expect(e.count).toBe(1);
    const viaHome = await list(e, home, ["Projects", "repo"]);
    expect(viaHome.entries.map((entry) => entry.name)).toEqual(["src"]);
    expect(e.count).toBe(2);
  });

  it("at the cap, disposes the least recently used idle engine; all busy is refused, retryable", async () => {
    const dir = base();
    const roots = ["a", "b", "c"].map((name) => {
      mkdirSync(join(dir, name, "x"), { recursive: true });
      return join(dir, name);
    });
    const e = engines({ hostsMax: 2 });
    await list(e, roots[0] as string);
    await list(e, roots[1] as string);
    expect(e.count).toBe(2);
    await list(e, roots[2] as string); // evicts a, the least recently used
    expect(e.count).toBe(2);
    await list(e, roots[0] as string); // a comes back, evicting b
    expect(e.count).toBe(2);
    // a wide folder keeps the first ask's engine busy while the second asks
    for (let i = 0; i < 3_000; i += 1) writeFileSync(join(roots[0] as string, `w${i}`), "");
    const tight = engines({ hostsMax: 1 });
    const both = await Promise.allSettled([
      list(tight, roots[0] as string),
      list(tight, roots[1] as string),
    ]);
    const refused = both.filter((outcome) => outcome.status === "rejected");
    expect(refused).toHaveLength(1);
    const reason = (refused[0] as PromiseRejectedResult).reason as WorkerFailure;
    expect(reason).toBeInstanceOf(WorkerFailure);
    expect(reason.code).toBe("busy");
    expect(WORKSPACE_LIMITS.HOSTS_MAX).toBeGreaterThanOrEqual(2);
  });

  it("an attached lease survives idle sweeping and cap pressure until released", async () => {
    const a = base();
    const b = base();
    let clock = 100;
    const e = engines({ hostsMax: 1, idleMs: 50, now: () => clock });
    const held = await e.attach(a);
    clock += 100;
    await e.sweep();
    expect(e.count).toBe(1);
    await expect(list(e, b)).rejects.toMatchObject({ code: "busy" });
    held.release();
    held.release();
    clock += 51;
    await e.sweep();
    expect(e.count).toBe(0);
    expect((await list(e, b)).path).toBe(b);
  });

  it("disposes an engine idle past its lease", async () => {
    const dir = base();
    mkdirSync(join(dir, "x"));
    let clock = 1_000;
    const e = engines({ idleMs: 50, now: () => clock });
    await list(e, dir);
    expect(e.count).toBe(1);
    clock += 49;
    await e.sweep();
    expect(e.count).toBe(1);
    clock += 2;
    await e.sweep();
    expect(e.count).toBe(0);
    await list(e, dir); // the next ask makes a fresh one
    expect(e.count).toBe(1);
  });
});

describe("a search's coverage (the lead's ruling: never a silent 'no matches')", () => {
  it("says `complete: false` when the entry budget cut the walk, keeps what it walked, and a narrower path covers", async () => {
    const root = base();
    // 6 wide folders of 20 files, then the needle three levels down in the last
    for (let i = 0; i < 6; i += 1) {
      const folder = join(root, `wide${i}`);
      mkdirSync(folder);
      for (let j = 0; j < 20; j += 1) writeFileSync(join(folder, `f${j}.txt`), "");
    }
    mkdirSync(join(root, "wide5", "deeper", "deepest"), { recursive: true });
    writeFileSync(join(root, "wide5", "deeper", "deepest", "needle.md"), "");
    const e = engines({ walkEntries: 60 });
    const search = (segments: string[] = []) =>
      e.search({ rootPath: root, segments, q: "needle", limit: 10, kinds: "all" });
    const wide = await search();
    expect(wide.hits).toEqual([]);
    expect(wide.complete).toBe(false);
    expect(wide.walked).toBeGreaterThanOrEqual(60);
    // the same ask again: the walk is kept beside the engine, the cut is said again
    const again = await search();
    expect(again).toMatchObject({ complete: false, walked: wide.walked });
    const narrow = await search(["wide5"]);
    expect(narrow.complete).toBe(true);
    expect(narrow.hits.map((hit) => hit.relativePath)).toEqual(["wide5/deeper/deepest/needle.md"]);
    const unbounded = engines();
    const whole = await unbounded.search({
      rootPath: root,
      segments: [],
      q: "needle",
      limit: 10,
      kinds: "all",
    });
    expect(whole.complete).toBe(true);
    expect(whole.hits).toHaveLength(1);
  });

  it("says `complete: false` when the time budget cut the walk", async () => {
    const root = base();
    for (let i = 0; i < 3; i += 1) mkdirSync(join(root, `d${i}`, "inner"), { recursive: true });
    let clock = 0;
    // every reading of the clock moves it past the walk's whole budget
    const e = engines({ walkMs: 10, now: () => (clock += 100) });
    const cut = await e.search({
      rootPath: root,
      segments: [],
      q: "inner",
      limit: 10,
      kinds: "all",
    });
    expect(cut.complete).toBe(false);
  });
});

describe("the search's name walk and matcher (host/names.ts)", () => {
  it("never descends hidden, vendored, package or hung folders, nor the home folder's Library", async () => {
    const root = base();
    for (const dir of [
      "work/src",
      ".cache/deep",
      "node_modules/pkg",
      "Deck.key/Data",
      "Tool.app/Contents",
      "Library/Caches",
      "slow/inside",
    ])
      mkdirSync(join(root, dir), { recursive: true });
    for (const file of [
      "work/src/needle.ts",
      ".cache/deep/needle.bin",
      "node_modules/pkg/needle.js",
      "Deck.key/Data/needle.jpg",
      "Tool.app/Contents/needle",
      "Library/Caches/needle.db",
      "slow/inside/needle.txt",
    ])
      writeFileSync(join(root, file), "");
    const hung = new Set([join(root, "slow")]);
    const walk = await walkNames({
      start: root,
      startRel: "",
      home: true,
      maxEntries: 1_000,
      deadline: Date.now() + 10_000,
      readTimeoutMs: 2_000,
      hung,
      now: Date.now,
    });
    const needles = walk.rels.filter((rel) => rel.endsWith("needle.ts") || rel.includes("/needle"));
    expect(needles).toEqual(["work/src/needle.ts"]);
    // the skipped folders are still NAMED (a reader can find the package itself)
    expect(walk.rels).toEqual(expect.arrayContaining(["Deck.key", "Tool.app", "Library", "slow"]));
    // a folder known to hang is not read again, and the walk says it is incomplete
    expect(walk.complete).toBe(false);
    hung.clear();
    const notHome = await walkNames({
      start: root,
      startRel: "",
      home: false,
      maxEntries: 1_000,
      deadline: Date.now() + 10_000,
      readTimeoutMs: 2_000,
      hung,
      now: Date.now,
    });
    expect(notHome.complete).toBe(true);
    expect(notHome.rels).toEqual(
      expect.arrayContaining(["Library/Caches/needle.db", "slow/inside/needle.txt"]),
    );
  });

  it("matches in order, smart case, and ranks an exact name, then a prefix, then word starts", () => {
    expect(matchName("vf", "vibe-field")).not.toBeNull();
    expect(matchName("fv", "vibe-field")).toBeNull();
    expect(matchName("VF", "vibe-field")).toBeNull(); // an uppercase query matches case
    expect(matchName("vibe", "VibeField")).not.toBeNull(); // a lowercase one any case
    const ranked = ["my-vibe-field-notes", "vibe-field", "vibe-field-old", "very-big-folder"]
      .map((name) => [name, matchName("vibe-field", name)] as const)
      .filter(([, score]) => score !== null)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([name]) => name);
    expect(ranked).toEqual(["vibe-field", "vibe-field-old", "my-vibe-field-notes"]);
    expect(matchName("", "x")).toBeNull();
  });
});

it("hands mille an attached session's every bound by name, the viewport cap included (R6)", () => {
  // the witness that mille enforces it is workspace-attach.test.ts's clamp row;
  // 2 048 equals mille's own default at the pin, so only this pin shows the
  // number is ours
  expect(TREE_SESSION_POLICY).toEqual({
    access: "read-only",
    allowSearch: true,
    maxFileBytes: WORKSPACE_LIMITS.MAX_FILE_BYTES,
    maxViewportRows: WORKSPACE_LIMITS.MAX_VIEWPORT_ROWS,
  });
});

// fix7 (PJ-7's first phone run): a phone's Browse at an external SSD that other
// lanes were building on timed every `workspace.list` out at the worker's 20 s.
// The cause, measured there (lane fix7, probe/ssd-probe-3-1.log): mille arms a
// RECURSIVE watcher on an engine's root at its first filesystem-facing call, and
// every watcher batch reconciles under the engine's one policy lock, which
// `prefetch` and `resync` take too — one `resync` of a two-entry folder waited
// 37 011 ms. The seam below models that lock HELD: from the moment it is held
// (by a named call, or by a watcher batch — `held = true`), every filesystem-
// facing call on that engine waits without end; a call already running ends.
/** mille's engine, as the worker's own seam hands it (R24: a test names no
 * mille entry but the clients) */
type FileExplorerHost = Parameters<
  NonNullable<NonNullable<ConstructorParameters<typeof Engines>[0]>["onHost"]>
>[0];
type Gate = {
  /** the call that takes the lock and keeps it (null: none does) */
  holdAt: string | null;
  held: boolean;
  started: Promise<void>;
  start: () => void;
};
const LOCKED = ["prefetch", "resync", "list", "resolvePath", "refreshWorkspaceRoots"] as const;

function gatedEngines(
  opts: { holdNew?: string | null } & ConstructorParameters<typeof Engines>[0],
) {
  const { holdNew = null, ...rest } = opts;
  const hosts: FileExplorerHost[] = [];
  const gates = new Map<FileExplorerHost, Gate>();
  /** engines made from now on are born with their lock held */
  const policy = { bornHeld: false };
  const made = engines({
    ...rest,
    onHost: (host) => {
      hosts.push(host);
      let start!: () => void;
      const gate: Gate = {
        holdAt: holdNew,
        held: policy.bornHeld,
        started: new Promise<void>((resolve) => {
          start = resolve;
        }),
        start: () => start(),
      };
      gates.set(host, gate);
      const fx = host.local as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      for (const name of LOCKED) {
        const original = fx[name];
        if (typeof original !== "function") continue;
        fx[name] = (...args: unknown[]) => {
          if (name === "resolvePath") gate.start();
          if (name === gate.holdAt) gate.held = true;
          if (gate.held) return new Promise(() => {});
          return original.apply(host.local, args);
        };
      }
    },
  });
  return { e: made, hosts, gates, policy };
}

/** The answer, or null when it did not come within `ms`. */
function within<T>(answer: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    answer,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

describe("a list never waits behind a search, nor without end on its engine (fix7)", () => {
  it("a list answers while a search holds its engine's lock; the search ends partial at its budget", async () => {
    const root = base();
    // a deep tree: thirty needles, each three folders down
    for (let i = 0; i < 30; i += 1) {
      const folder = join(root, "deep", `a${i}`, "b", "c");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `needle-${i}.txt`), "");
    }
    mkdirSync(join(root, "quiet", "inner"), { recursive: true });
    // every engine's first hit resolve keeps the lock (the search hydrated a
    // build's busiest folders, and the watcher reconciles them under it)
    const { e, hosts, gates } = gatedEngines({
      holdNew: "resolvePath",
      listMs: 1_500,
      resolveMs: 300,
    });
    const started = Date.now();
    const search = e.search({ rootPath: root, segments: [], q: "needle", limit: 50, kinds: "all" });
    await within(
      new Promise<void>((resolve) => {
        const look = (): void => {
          const resolving = hosts.find((host) => gates.get(host) !== undefined);
          if (resolving !== undefined) void gates.get(resolving)?.started.then(resolve);
          else setTimeout(look, 5);
        };
        look();
      }),
      2_000,
    );
    const listing = await within(list(e, root, ["quiet"]), 6_000);
    expect(
      listing?.entries.map((entry) => entry.name),
      "the list was answered",
    ).toEqual(["inner"]);
    const answer = await within(search, 6_000);
    expect(answer, "the search was answered").not.toBeNull();
    expect(answer?.complete).toBe(false);
    expect(answer?.hits.length ?? 0).toBeLessThan(30);
    expect(Date.now() - started).toBeLessThan(6_000);
  });

  it("a list whose engine stays held is answered by a fresh engine within its deadline; held again, it is the folder's timed-out", async () => {
    const root = base();
    mkdirSync(join(root, "quiet", "inner"), { recursive: true });
    const { e, hosts, gates, policy } = gatedEngines({ listMs: 1_500 });
    expect((await list(e, root, ["quiet"])).entries.map((entry) => entry.name)).toEqual(["inner"]);
    expect(hosts).toHaveLength(1);
    // the watcher's batch holds the first engine's lock from now on
    const first = gates.get(hosts[0] as FileExplorerHost) as Gate;
    first.held = true;
    const again = await within(list(e, root, ["quiet"]), 6_000);
    expect(
      again?.entries.map((entry) => entry.name),
      "a fresh engine answered",
    ).toEqual(["inner"]);
    expect(hosts).toHaveLength(2);
    // the fresh engine is the export's now: the next ask goes straight to it
    expect((await list(e, root, ["quiet"])).entries).toHaveLength(1);
    expect(hosts).toHaveLength(2);
    // every engine held (the next one is too): the folder's honest refusal,
    // within two deadlines — never a third wait
    (gates.get(hosts[1] as FileExplorerHost) as Gate).held = true;
    policy.bornHeld = true;
    const refusal = await within(
      list(e, root, ["quiet"]).then(
        () => null,
        (error: unknown) => error,
      ),
      6_000,
    );
    expect(refusal).toBeInstanceOf(WorkerFailure);
    expect((refusal as WorkerFailure).code).toBe("timed-out");
    expect((refusal as WorkerFailure).message).toMatch(/“quiet” did not answer within 1\.5 s/);
    expect(hosts).toHaveLength(3);
  });

  it("searches of one subtree asked together share one walk (a reader typing)", async () => {
    const root = base();
    for (let i = 0; i < 20; i += 1) mkdirSync(join(root, `pj${i}`, "x"), { recursive: true });
    const walks: string[] = [];
    const e = engines({ onWalk: (startRel) => walks.push(startRel) });
    const answers = await Promise.all(
      ["p", "pj", "pj7"].map((q) =>
        e.search({ rootPath: root, segments: [], q, limit: 50, kinds: "dirs" }),
      ),
    );
    expect(walks).toEqual([""]);
    expect(answers.map((answer) => answer.complete)).toEqual([true, true, true]);
    expect(answers[1]?.hits.length).toBe(20);
  });
});
