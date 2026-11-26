import {
  chmodSync,
  existsSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pagesUidFolderFor,
  ROOT_SOCKETS_MAX,
  removePagesRoot,
  socketAnswers,
  sweepStalePagesRoots,
} from "../src/main/pages/broker/roots";

// EY-1 (2026-11-19): the engine roots' end. Every row's parent is a folder of the test's own
// under its TMPDIR, given as a parameter: no row reaches the account's /tmp. Nothing is
// signalled, and the only connect is to a socket path nothing listens on.

const UID = process.getuid?.() ?? 0;
const BOUND = 4 * 60_000;
const NOW = Date.now();
const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-pages-roots-"));
  chmodSync(dir, 0o700);
  cleanup.push(dir);
  return dir;
}

/** A parent with this uid's folder, 0700. */
function parentWithFolder(): { parent: string; folder: string } {
  const parent = temp();
  const folder = pagesUidFolderFor(parent, UID);
  mkdirSync(folder, { mode: 0o700 });
  chmodSync(folder, 0o700);
  return { parent, folder };
}

/** An engine root as an instance leaves it, every entry `ageMs` old. */
function root(folder: string, name: string, ageMs: number): string {
  const path = join(folder, name);
  const run = join(path, "sock", "namespaces", "pages", "run");
  mkdirSync(run, { recursive: true });
  mkdirSync(join(path, "home"));
  writeFileSync(join(run, "0123456789abcdef.sock"), "");
  writeFileSync(join(path, "home", "state.json"), "{}");
  age(path, ageMs);
  for (const sub of ["sock", "home"]) age(join(path, sub), ageMs);
  age(join(path, "sock", "namespaces"), ageMs);
  age(join(path, "sock", "namespaces", "pages"), ageMs);
  age(run, ageMs);
  age(join(run, "0123456789abcdef.sock"), ageMs);
  age(join(path, "home", "state.json"), ageMs);
  age(path, ageMs);
  return path;
}

function age(path: string, ageMs: number): void {
  const at = (NOW - ageMs) / 1000;
  utimesSync(path, at, at);
}

const dead = async () => false;

describe("the start sweep", () => {
  it("removes a root whose newest entry is older than the bound, and leaves a younger one", async () => {
    const { parent, folder } = parentWithFolder();
    const old = root(folder, "pg-0000aaaa", 10 * 60_000);
    const young = root(folder, "pg-0000bbbb", 60_000);
    const fresh = root(folder, "pg-0000cccc", 10 * 60_000);
    writeFileSync(join(fresh, "home", "new.json"), "{}");
    const swept = await sweepStalePagesRoots({
      parent,
      olderThanMs: BOUND,
      now: () => NOW,
      answers: dead,
    });
    expect(swept).toEqual({ skipped: null, removed: 1, young: 2, live: 0, left: 0 });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
  });

  it("leaves a live main's root, whose socket answers, asking it nothing", async () => {
    const { parent, folder } = parentWithFolder();
    const live = root(folder, "pg-0000aaaa", 10 * 60_000);
    const answers = vi.fn(async (_path: string) => true);
    const swept = await sweepStalePagesRoots({
      parent,
      olderThanMs: BOUND,
      now: () => NOW,
      answers,
    });
    expect(swept).toMatchObject({ removed: 0, live: 1 });
    expect(existsSync(live)).toBe(true);
    expect(answers).toHaveBeenCalledWith(
      join(live, "sock", "namespaces", "pages", "run", "0123456789abcdef.sock"),
    );
  });

  it("takes only pg- and eight hex, each a real directory of this uid; leaves and counts the rest", async () => {
    const { parent, folder } = parentWithFolder();
    const elsewhere = temp();
    writeFileSync(join(elsewhere, "keep.txt"), "keep");
    symlinkSync(elsewhere, join(folder, "pg-0000aaaa"));
    writeFileSync(join(folder, "pg-0000bbbb"), "a file");
    const other = root(folder, "other-folder", 10 * 60_000);
    const notHex = root(folder, "pg-0000zzzz", 10 * 60_000);
    const swept = await sweepStalePagesRoots({
      parent,
      olderThanMs: BOUND,
      now: () => NOW,
      answers: dead,
    });
    expect(swept).toEqual({ skipped: null, removed: 0, young: 0, live: 0, left: 2 });
    expect(existsSync(join(elsewhere, "keep.txt"))).toBe(true);
    expect(existsSync(join(folder, "pg-0000bbbb"))).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(notHex)).toBe(true);
  });

  it("leaves a root whose run folder is a link, probing nothing outside it", async () => {
    const { parent, folder } = parentWithFolder();
    const outside = temp();
    writeFileSync(join(outside, "elsewhere.sock"), "");
    const linked = join(folder, "pg-0000aaaa");
    mkdirSync(join(linked, "sock", "namespaces", "pages"), { recursive: true });
    symlinkSync(outside, join(linked, "sock", "namespaces", "pages", "run"));
    const at = (NOW - 10 * 60_000) / 1000;
    lutimesSync(join(linked, "sock", "namespaces", "pages", "run"), at, at);
    for (const sub of ["sock/namespaces/pages", "sock/namespaces", "sock", ""]) {
      age(join(linked, sub), 10 * 60_000);
    }
    const answers = vi.fn(async (_path: string) => false);
    const swept = await sweepStalePagesRoots({
      parent,
      olderThanMs: BOUND,
      now: () => NOW,
      answers,
    });
    expect(swept).toMatchObject({ removed: 0, left: 1 });
    expect(answers).not.toHaveBeenCalled();
    expect(existsSync(linked)).toBe(true);
    expect(existsSync(join(outside, "elsewhere.sock"))).toBe(true);
  });

  it("leaves a root with more sockets than its bound, probing none", async () => {
    const { parent, folder } = parentWithFolder();
    const crowded = root(folder, "pg-0000aaaa", 10 * 60_000);
    const run = join(crowded, "sock", "namespaces", "pages", "run");
    for (let n = 0; n < ROOT_SOCKETS_MAX; n += 1) {
      writeFileSync(join(run, `extra${n}.sock`), "");
      age(join(run, `extra${n}.sock`), 10 * 60_000);
    }
    age(run, 10 * 60_000);
    const answers = vi.fn(async (_path: string) => false);
    const swept = await sweepStalePagesRoots({
      parent,
      olderThanMs: BOUND,
      now: () => NOW,
      answers,
    });
    expect(swept).toMatchObject({ removed: 0, left: 1 });
    expect(answers).not.toHaveBeenCalled();
    expect(existsSync(crowded)).toBe(true);
  });

  it.skipIf(UID === 0)("leaves an unreadable root, counted, and goes on to the next", async () => {
    const { parent, folder } = parentWithFolder();
    const shut = root(folder, "pg-0000aaaa", 10 * 60_000);
    const old = root(folder, "pg-0000bbbb", 10 * 60_000);
    chmodSync(join(shut, "home"), 0o000);
    try {
      const swept = await sweepStalePagesRoots({
        parent,
        olderThanMs: BOUND,
        now: () => NOW,
        answers: dead,
      });
      expect(swept).toEqual({ skipped: null, removed: 1, young: 0, live: 0, left: 1 });
      expect(existsSync(old)).toBe(false);
    } finally {
      chmodSync(join(shut, "home"), 0o700);
    }
  });

  it("never follows a link out of a root it removes", async () => {
    const { parent, folder } = parentWithFolder();
    const victim = temp();
    writeFileSync(join(victim, "keep.txt"), "keep");
    const old = root(folder, "pg-0000aaaa", 10 * 60_000);
    symlinkSync(victim, join(old, "home", "out"));
    // the link's own time (lutimes: utimes would age its target), then its folder's
    const at = (NOW - 10 * 60_000) / 1000;
    lutimesSync(join(old, "home", "out"), at, at);
    age(join(old, "home"), 10 * 60_000);
    const swept = await sweepStalePagesRoots({
      parent,
      olderThanMs: BOUND,
      now: () => NOW,
      answers: dead,
    });
    expect(swept).toMatchObject({ removed: 1 });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(victim, "keep.txt"))).toBe(true);
  });

  it("does nothing, and says why, when the uid folder is absent, a link, open, or another uid's", async () => {
    const options = { olderThanMs: BOUND, now: () => NOW, answers: dead };
    expect(await sweepStalePagesRoots({ parent: temp(), ...options })).toMatchObject({
      skipped: "absent",
    });
    const linked = temp();
    const target = temp();
    chmodSync(target, 0o700);
    const kept = root(target, "pg-0000aaaa", 10 * 60_000);
    symlinkSync(target, pagesUidFolderFor(linked, UID));
    expect(await sweepStalePagesRoots({ parent: linked, ...options })).toMatchObject({
      skipped: "not-ours",
    });
    expect(existsSync(kept)).toBe(true);
    const open = temp();
    mkdirSync(pagesUidFolderFor(open, UID), { mode: 0o755 });
    chmodSync(pagesUidFolderFor(open, UID), 0o755);
    expect(await sweepStalePagesRoots({ parent: open, ...options })).toMatchObject({
      skipped: "not-ours",
    });
    const { parent } = parentWithFolder();
    mkdirSync(pagesUidFolderFor(parent, UID + 1), { mode: 0o700 });
    chmodSync(pagesUidFolderFor(parent, UID + 1), 0o700);
    expect(await sweepStalePagesRoots({ parent, uid: UID + 1, ...options })).toMatchObject({
      skipped: "not-ours",
    });
  });
});

describe("an instance's own root", () => {
  it("is removed once its engine has gone, only as a pg- root of this uid's folder", () => {
    const { parent, folder } = parentWithFolder();
    const own = root(folder, "pg-0000aaaa", 0);
    expect(removePagesRoot(own, { parent })).toBe(true);
    expect(existsSync(own)).toBe(false);
    const outside = temp();
    const stray = root(outside, "pg-0000bbbb", 0);
    expect(removePagesRoot(stray, { parent })).toBe(false);
    expect(existsSync(stray)).toBe(true);
    const named = root(folder, "keep-me", 0);
    expect(removePagesRoot(named, { parent })).toBe(false);
    const elsewhere = temp();
    symlinkSync(elsewhere, join(folder, "pg-0000cccc"));
    expect(removePagesRoot(join(folder, "pg-0000cccc"), { parent })).toBe(false);
    expect(existsSync(elsewhere)).toBe(true);
  });
});

describe("a socket's answer", () => {
  it("is no when nothing listens at the path", async () => {
    expect(await socketAnswers(join(temp(), "nothing.sock"), 200)).toBe(false);
  });
});
