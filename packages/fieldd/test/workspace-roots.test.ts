// FS-1a (L2) — the roots registry: places persisted atomically and read back
// by the next boot; a place's `lastActiveAt` only moving forward; a folder
// that vanished kept as `missing: true` and restored when it returns (never
// dropped); the system's own folders never places; a file that does not parse
// set aside, never a boot failure; seeding from the session records in one
// write; the answer's order (places newest first, then home, then volumes).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, WorkspaceRoot, WorkspaceRootsFile } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowseFacts } from "../src/workspace/browse-exports";
import { rootIdFor } from "../src/workspace/paths";
import { RootsRegistry } from "../src/workspace/roots";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function world(): { base: string; file: string; folder: (name: string) => string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-roots-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const file = join(base, "user", ...LAYOUT.WORKSPACE_ROOTS_FILE);
  return {
    base,
    file,
    folder: (name) => {
      const path = join(base, "work", name);
      mkdirSync(path, { recursive: true });
      return path;
    },
  };
}

/** No volumes, a home of the test's own. */
function browseOf(home: string): () => BrowseFacts {
  return () => ({
    platform: process.platform,
    home,
    user: "",
    fs: {
      readdir: () => [],
      // macOS keeps temporary folders under /private, which is never exported:
      // the fixture reads its home as the alias it was made through
      realpath: (path) => path.replace(/^\/private\//, "/"),
      isDirectory: (path) => existsSync(path),
      exists: existsSync,
    },
  });
}

function registry(
  file: string,
  home: string,
  extra: Partial<ConstructorParameters<typeof RootsRegistry>[0]> = {},
) {
  return new RootsRegistry({
    file,
    deviceId: () => "dev_test",
    browse: browseOf(home),
    // a temporary folder on macOS lives under /private, which is never a place
    ...extra,
  });
}

describe("the roots registry (places, persisted; browse exports, live)", () => {
  it("makes a spawn's folder a place, persists it atomically, and the next boot reads it", () => {
    const { file, folder, base } = world();
    const home = folder("home");
    const project = folder("project");
    const one = registry(file, home);
    expect(one.touchPlace(project, "2026-10-05T10:00:00.000Z")).toBe(true);
    const onDisk = WorkspaceRootsFile.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(onDisk.places).toEqual([
      {
        path: project,
        addedAt: "2026-10-05T10:00:00.000Z",
        lastActiveAt: "2026-10-05T10:00:00.000Z",
        missing: false,
        realPath: project,
      },
    ]);
    // no temp file is left beside it
    expect(readdirSync(join(base, "user", ...LAYOUT.WORKSPACE_DIR))).toEqual(["roots.json"]);
    const two = registry(file, home);
    const roots = two.roots().map((root) => WorkspaceRoot.parse(root));
    expect(roots[0]).toEqual({
      rootId: rootIdFor("place", project),
      name: "project",
      path: project,
      device: "dev_test",
      kind: "place",
      missing: false,
      lastActiveAt: "2026-10-05T10:00:00.000Z",
    });
    expect(roots[1]).toMatchObject({
      kind: "browse",
      browse: "home",
      path: home,
      lastActiveAt: null,
    });
  });

  it("moves lastActiveAt forward only, and orders places newest first", () => {
    const { file, folder } = world();
    const home = folder("home");
    const a = folder("a");
    const b = folder("b");
    const roots = registry(file, home);
    roots.touchPlace(a, "2026-10-05T10:00:00.000Z");
    roots.touchPlace(b, "2026-10-05T11:00:00.000Z");
    expect(roots.touchPlace(a, "2026-10-05T09:00:00.000Z")).toBe(false); // older: no change
    expect(roots.roots().map((root) => root.name)).toEqual(["b", "a", "home"]);
    roots.touchPlace(a, "2026-10-05T12:00:00.000Z");
    expect(roots.roots().map((root) => root.name)).toEqual(["a", "b", "home"]);
    expect(roots.find(rootIdFor("place", a))?.lastActiveAt).toBe("2026-10-05T12:00:00.000Z");
  });

  it("keeps a vanished folder as missing — never dropped — and restores it when it returns", () => {
    const { file, folder } = world();
    const home = folder("home");
    const gone = folder("gone");
    const roots = registry(file, home);
    roots.touchPlace(gone, "2026-10-05T10:00:00.000Z");
    const heard: number[] = [];
    roots.onChange(() => heard.push(1));
    rmSync(gone, { recursive: true });
    expect(roots.refresh()).toBe(true);
    expect(roots.find(rootIdFor("place", gone))?.missing).toBe(true);
    expect(
      WorkspaceRootsFile.parse(JSON.parse(readFileSync(file, "utf8"))).places[0]?.missing,
    ).toBe(true);
    expect(registry(file, home).find(rootIdFor("place", gone))?.missing).toBe(true);
    mkdirSync(gone);
    expect(roots.refresh()).toBe(true);
    expect(roots.find(rootIdFor("place", gone))?.missing).toBe(false);
    expect(heard.length).toBe(2);
    // the worker's word marks it too
    rmSync(gone, { recursive: true });
    roots.markMissing(rootIdFor("place", gone));
    expect(roots.find(rootIdFor("place", gone))?.missing).toBe(true);
  });

  it("exports places wherever work ran, but refuses filesystem roots and absent folders", () => {
    const { file, folder } = world();
    const home = folder("home");
    const real = new RootsRegistry({
      file,
      deviceId: () => "dev_test",
      browse: browseOf(home),
      platform: "darwin",
      realpath: (path) => (path === "/tmp/x" ? "/private/tmp/x" : path),
      isDirectory: () => true,
    });
    expect(real.touchPlace("/System/Library")).toBe(true);
    expect(real.touchPlace("/Library/Caches")).toBe(true);
    expect(real.touchPlace("/tmp/x")).toBe(true); // /tmp is /private/tmp
    expect(real.touchPlace("/")).toBe(false);
    expect(registry(file, home).touchPlace(join(home, "not-there"))).toBe(false);
    expect(real.touchPlace("/var/folders/work")).toBe(true);
    const windows = new RootsRegistry({
      file,
      deviceId: () => "win",
      platform: "win32",
      realpath: (p) => p,
      isDirectory: () => true,
    });
    expect(windows.touchPlace("C:\\")).toBe(false);
  });

  it("sets aside a file that does not parse and starts empty — never a failed boot", () => {
    const { file, folder } = world();
    const home = folder("home");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "{ not json");
    const roots = registry(file, home);
    expect(roots.roots().filter((root) => root.kind === "place")).toEqual([]);
    const set = readdirSync(join(file, "..")).filter((name) => name.includes("unreadable"));
    expect(set).toHaveLength(1);
    const place = folder("after");
    roots.touchPlace(place, "2026-10-05T10:00:00.000Z");
    expect(WorkspaceRootsFile.parse(JSON.parse(readFileSync(file, "utf8"))).places).toHaveLength(1);
  });

  it("seeds places from the session records in one write", () => {
    const { file, folder } = world();
    const home = folder("home");
    const a = folder("a");
    const b = folder("b");
    const roots = registry(file, home);
    const heard: number[] = [];
    roots.onChange(() => heard.push(1));
    expect(
      roots.seedPlaces([
        { cwd: a, at: "2026-10-01T00:00:00.000Z" },
        { cwd: b, at: "2026-10-02T00:00:00.000Z" },
        { cwd: a, at: "2026-10-03T00:00:00.000Z" },
        { cwd: join(home, "gone"), at: "2026-10-04T00:00:00.000Z" },
      ]),
    ).toBe(3);
    expect(heard).toHaveLength(1);
    expect(roots.roots().map((root) => [root.name, root.lastActiveAt])).toEqual([
      ["a", "2026-10-03T00:00:00.000Z"],
      ["b", "2026-10-02T00:00:00.000Z"],
      ["home", null],
    ]);
    expect(roots.seedPlaces([{ cwd: b, at: "2026-10-01T00:00:00.000Z" }])).toBe(0);
  });
});

describe("a place keeps the identity it was touched with (R6)", () => {
  it("reads a place swapped for a link — elsewhere, or to / — as missing, across a restart", () => {
    const { file, folder } = world();
    const home = folder("home");
    const place = folder("project");
    const elsewhere = folder("elsewhere");
    const roots = registry(file, home);
    roots.touchPlace(place, "2026-10-05T10:00:00.000Z");
    const id = rootIdFor("place", place);
    expect(roots.find(id)?.missing).toBe(false);
    rmSync(place, { recursive: true });
    symlinkSync(elsewhere, place, "junction");
    expect(roots.refresh()).toBe(true);
    expect(roots.find(id)?.missing).toBe(true);
    expect(registry(file, home).find(id)?.missing).toBe(true);
    const next = registry(file, home);
    next.refresh();
    expect(next.find(id)?.missing).toBe(true);
    rmSync(place);
    if (process.platform !== "win32") {
      symlinkSync("/", place);
      roots.refresh();
      expect(roots.find(id)?.missing).toBe(true);
      rmSync(place);
    }
    // the folder itself back: present again, the identity unchanged
    mkdirSync(place);
    roots.refresh();
    expect(roots.find(id)?.missing).toBe(false);
    expect(
      WorkspaceRootsFile.parse(JSON.parse(readFileSync(file, "utf8"))).places[0]?.realPath,
    ).toBe(place);
  });

  it("keeps a place reached through a system link (/tmp, /var) present, across a restart", () => {
    const { file, folder } = world();
    const home = folder("home");
    // the injected seam: macOS's own links
    const seams = {
      platform: "darwin" as const,
      realpath: (path: string) =>
        path.startsWith("/tmp/") || path.startsWith("/var/") ? `/private${path}` : path,
      isDirectory: () => true,
    };
    const roots = registry(file, home, seams);
    expect(roots.touchPlace("/tmp/x", "2026-10-05T10:00:00.000Z")).toBe(true);
    expect(roots.touchPlace("/var/folders/ab/T/run", "2026-10-05T10:00:00.000Z")).toBe(true);
    expect(roots.refresh()).toBe(false);
    const again = registry(file, home, seams);
    expect(again.refresh()).toBe(false);
    expect(again.roots().filter((row) => row.kind === "place" && !row.missing)).toHaveLength(2);
    expect(
      WorkspaceRootsFile.parse(JSON.parse(readFileSync(file, "utf8"))).places.map((p) => [
        p.path,
        p.realPath,
      ]),
    ).toEqual([
      ["/tmp/x", "/private/tmp/x"],
      ["/var/folders/ab/T/run", "/private/var/folders/ab/T/run"],
    ]);
    // and this machine's own temporary folder, through whatever link it has
    const own = world();
    const aliased = mkdtempSync(join(tmpdir(), "vf-alias-"));
    cleanup.push(() => rmSync(aliased, { recursive: true, force: true }));
    const real = registry(own.file, home);
    expect(real.touchPlace(aliased)).toBe(true);
    expect(real.refresh()).toBe(false);
    const restarted = registry(own.file, home);
    expect(restarted.refresh()).toBe(false);
    expect(restarted.find(rootIdFor("place", aliased))?.missing).toBe(false);
  });

  it("adopts a real path for a place written before the field, never a filesystem root", () => {
    const { file, folder, base } = world();
    const home = folder("home");
    const kept = folder("kept");
    const rooted = join(base, "rooted");
    if (process.platform !== "win32") symlinkSync("/", rooted);
    else symlinkSync("C:\\", rooted, "junction");
    mkdirSync(join(file, ".."), { recursive: true });
    const old = (path: string) => ({
      path,
      addedAt: "2026-10-01T00:00:00.000Z",
      lastActiveAt: "2026-10-01T00:00:00.000Z",
      missing: false,
    });
    writeFileSync(file, JSON.stringify({ version: 1, places: [old(kept), old(rooted)] }));
    const roots = registry(file, home);
    expect(roots.refresh()).toBe(true);
    expect(roots.find(rootIdFor("place", kept))?.missing).toBe(false);
    expect(roots.find(rootIdFor("place", rooted))?.missing).toBe(true);
    const stored = WorkspaceRootsFile.parse(JSON.parse(readFileSync(file, "utf8"))).places;
    expect(stored.find((p) => p.path === kept)?.realPath).toBe(kept);
    expect(stored.find((p) => p.path === rooted)?.realPath).toBeUndefined();
    // what it adopted binds it: swapped later, it reads missing
    rmSync(kept, { recursive: true });
    symlinkSync(folder("other"), kept, "junction");
    roots.refresh();
    expect(roots.find(rootIdFor("place", kept))?.missing).toBe(true);
    // a run there now is where work happens: the touch re-records it
    expect(roots.touchPlace(kept, "2026-10-06T00:00:00.000Z")).toBe(true);
    expect(roots.find(rootIdFor("place", kept))?.missing).toBe(false);
    expect(roots.touchPlace(rooted)).toBe(false);
  });
});

describe("picked roots survive the chooser and the daemon", () => {
  it("canonicalizes an alias, deduplicates picks, and reloads beside old places", () => {
    const { file, folder, base } = world();
    const home = folder("home");
    const picked = folder("chosen folder");
    const alias = join(base, "alias");
    symlinkSync(picked, alias, "junction");
    const one = registry(file, home);
    one.touchPlace(home);
    const expected = one.preparePicked(alias)!;
    expect(expected.path).toBe(picked);
    expect(one.roots().some((row) => row.kind === "picked")).toBe(false);
    let changes = 0;
    one.onChange(() => changes++);
    expect(one.registerPicked(expected.path)).toEqual(expected);
    expect(one.registerPicked(expected.path)).toEqual(expected);
    expect(changes).toBe(1);
    const two = registry(file, home);
    expect(two.find(expected.rootId)).toEqual(expected);
    expect(two.roots().some((row) => row.kind === "place")).toBe(true);
    const stored = WorkspaceRootsFile.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(stored.picked).toHaveLength(1);
    expect(stored.places).toHaveLength(1);
  });
  it("keeps missing picks and refuses to follow a replacement link", () => {
    const { file, folder } = world();
    const home = folder("home");
    const picked = folder("chosen");
    const elsewhere = folder("elsewhere");
    const roots = registry(file, home);
    const original = roots.registerPicked(picked)!;
    rmSync(picked, { recursive: true });
    roots.refresh();
    expect(roots.find(original.rootId)?.missing).toBe(true);
    symlinkSync(elsewhere, picked, "junction");
    roots.refresh();
    expect(roots.find(original.rootId)?.missing).toBe(true);
    expect(roots.registerPicked(picked)).toBeNull();
    rmSync(picked);
    mkdirSync(picked);
    roots.refresh();
    expect(roots.find(original.rootId)).toEqual(original);
  });
  it("refuses filesystem roots, absent directories and files", () => {
    const { file, folder, base } = world();
    const roots = registry(file, folder("home"));
    const plain = join(base, "plain.txt");
    writeFileSync(plain, "plain");
    expect(roots.preparePicked(process.platform === "win32" ? "C:\\" : "/")).toBeNull();
    expect(roots.preparePicked(plain)).toBeNull();
    expect(roots.preparePicked(join(base, "absent"))).toBeNull();
  });
  it("a failed atomic write publishes no picked row or change event", () => {
    const { folder, base } = world();
    const blocked = join(base, "file-not-directory");
    writeFileSync(blocked, "blocked");
    const roots = registry(join(blocked, "roots.json"), folder("home"));
    let changes = 0;
    roots.onChange(() => changes++);
    expect(() => roots.registerPicked(folder("chosen"))).toThrow();
    expect(roots.roots().some((row) => row.kind === "picked")).toBe(false);
    expect(changes).toBe(0);
  });
});
