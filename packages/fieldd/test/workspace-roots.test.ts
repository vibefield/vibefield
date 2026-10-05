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
