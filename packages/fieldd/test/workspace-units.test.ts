// FS-1a — the files service's pure rules, per platform: the request path
// rule, the never-exported folders, the browse enumerator (one fixture per
// platform), the worker's launch (development bundle, packaged executable,
// source run) and the installed engine's resolution.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_ROOT_ID_PATTERN, WorkspaceRootId } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type BrowseFacts, enumerateBrowseExports } from "../src/workspace/browse-exports";
import {
  chooseFilesHostLaunch,
  FILES_HOST_ROLE_ARG,
  type FilesHostFacts,
  installedMilleNative,
  milleNativeFileName,
  milleTriple,
} from "../src/workspace/launch";
import {
  displayName,
  isExcludedRoot,
  isWithin,
  parseRelativePath,
  rootIdFor,
} from "../src/workspace/paths";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

describe("the request path rule (FS-D4: confined requests)", () => {
  it("reads a relative path into segments, folding empty and '.' segments", () => {
    expect(parseRelativePath(undefined)).toEqual({ ok: true, segments: [] });
    expect(parseRelativePath("")).toEqual({ ok: true, segments: [] });
    expect(parseRelativePath(".")).toEqual({ ok: true, segments: [] });
    expect(parseRelativePath("Projects/project100")).toEqual({
      ok: true,
      segments: ["Projects", "project100"],
    });
    expect(parseRelativePath("a//b/./c/")).toEqual({ ok: true, segments: ["a", "b", "c"] });
    // a name may hold dots, spaces and unicode
    expect(parseRelativePath("..hidden/a b/héllo")).toEqual({
      ok: true,
      segments: ["..hidden", "a b", "héllo"],
    });
  });

  it("refuses a climb, an absolute path, a drive letter, a backslash, a control character", () => {
    expect(parseRelativePath("..")).toEqual({ ok: false, reason: "parent" });
    expect(parseRelativePath("a/../../etc")).toEqual({ ok: false, reason: "parent" });
    expect(parseRelativePath("/etc/passwd")).toEqual({ ok: false, reason: "absolute" });
    expect(parseRelativePath("\\\\server\\share")).toEqual({ ok: false, reason: "absolute" });
    expect(parseRelativePath("C:\\Windows")).toEqual({ ok: false, reason: "absolute" });
    expect(parseRelativePath("c:relative")).toEqual({ ok: false, reason: "absolute" });
    expect(parseRelativePath("a\\..\\b")).toEqual({ ok: false, reason: "invalid" });
    expect(parseRelativePath("a\u0000b")).toEqual({ ok: false, reason: "invalid" });
    expect(parseRelativePath("x".repeat(5_000))).toEqual({ ok: false, reason: "too-long" });
  });

  it("never exports the operating system's own folders, on their real paths", () => {
    expect(isExcludedRoot("/", "darwin")).toBe(true);
    expect(isExcludedRoot("/System", "darwin")).toBe(true);
    expect(isExcludedRoot("/System/Library/CoreServices", "darwin")).toBe(true);
    expect(isExcludedRoot("/Library", "darwin")).toBe(true);
    expect(isExcludedRoot("/private/tmp/x", "darwin")).toBe(true);
    expect(isExcludedRoot("/Users/ada/Library", "darwin")).toBe(false);
    expect(isExcludedRoot("/privateer", "darwin")).toBe(false);
    expect(isExcludedRoot("/home/ada/work", "linux")).toBe(false);
    expect(isExcludedRoot("C:\\", "win32")).toBe(false);
  });

  it("says whether a real path is inside a root, per platform", () => {
    expect(isWithin("/a/b", "/a/b", "darwin")).toBe(true);
    expect(isWithin("/a/b", "/a/b/c", "darwin")).toBe(true);
    expect(isWithin("/a/b", "/a/bc", "darwin")).toBe(false);
    expect(isWithin("/a/b", "/a", "darwin")).toBe(false);
    expect(isWithin("/a/b", "/etc", "linux")).toBe(false);
    expect(isWithin("C:\\Users\\ada", "C:\\Users\\ada\\x", "win32")).toBe(true);
    expect(isWithin("C:\\Users\\ada", "D:\\x", "win32")).toBe(false);
  });

  it("names every root with a valid mille export id (the lead's ruling: fs1b hands it to mille)", () => {
    const paths = [
      "/Users/ada",
      "/Volumes/Samsung Red",
      "C:\\",
      "/home/ada/プロジェクト",
      `/${"x".repeat(4_000)}`,
    ];
    for (const kind of ["place", "browse", "picked", "project"] as const)
      for (const path of paths) {
        const id = rootIdFor(kind, path);
        expect(id, `${kind} ${path.slice(0, 40)}`).toMatch(WORKSPACE_ROOT_ID_PATTERN);
        expect(WorkspaceRootId.safeParse(id).success).toBe(true);
      }
    for (const bad of ["", "-r", ".r", "r/x", "../x", "r x", "r".repeat(65)])
      expect(WorkspaceRootId.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("names a root by a digest of its kind and path, stable and distinct", () => {
    const place = rootIdFor("place", "/Users/ada");
    expect(place).toMatch(/^r_[0-9a-f]{20}$/);
    expect(rootIdFor("place", "/Users/ada")).toBe(place);
    expect(rootIdFor("browse", "/Users/ada")).not.toBe(place);
    expect(displayName("/Volumes/SamsungRed", "darwin")).toBe("SamsungRed");
    expect(displayName("C:\\", "win32")).toBe("C:\\");
  });
});

/** A fixture filesystem: directories, and symlinks as `path → real`. */
function fixtureFs(dirs: string[], links: Record<string, string> = {}): BrowseFacts["fs"] {
  const all = new Set(dirs);
  return {
    readdir: (path) => {
      const prefix = path.endsWith("/") || path.endsWith("\\") ? path : `${path}/`;
      const names = new Set<string>();
      for (const candidate of [...all, ...Object.keys(links)]) {
        if (candidate.startsWith(prefix)) {
          const rest = candidate.slice(prefix.length);
          if (rest.length > 0 && !rest.includes("/")) names.add(rest);
        }
      }
      if (!all.has(path)) throw new Error(`ENOENT ${path}`);
      return [...names];
    },
    realpath: (path) => links[path] ?? path,
    isDirectory: (path) => all.has(path) || (links[path] !== undefined && all.has(links[path])),
    exists: (path) => all.has(path),
  };
}

describe("the browse exports (L2: one enumerator, a fixture per platform)", () => {
  it("macOS: home, then /Volumes/* less the boot volume's alias of / and dot-entries", () => {
    const facts: BrowseFacts = {
      platform: "darwin",
      home: "/Users/ada",
      user: "ada",
      fs: fixtureFs(
        [
          "/",
          "/Users/ada",
          "/Volumes",
          "/Volumes/SamsungRed",
          "/Volumes/.timemachine",
          "/Volumes/Backup",
        ],
        { "/Volumes/Macintosh HD": "/" },
      ),
    };
    expect(enumerateBrowseExports(facts)).toEqual([
      { path: "/Users/ada", browse: "home" },
      { path: "/Volumes/Backup", browse: "volume" },
      { path: "/Volumes/SamsungRed", browse: "volume" },
    ]);
  });

  it("Linux: home, then /media/$USER/* and /mnt/*", () => {
    const facts: BrowseFacts = {
      platform: "linux",
      home: "/home/ada",
      user: "ada",
      fs: fixtureFs([
        "/home/ada",
        "/media",
        "/media/ada",
        "/media/ada/USB",
        "/media/bob",
        "/media/bob/Theirs",
        "/mnt",
        "/mnt/data",
      ]),
    };
    expect(enumerateBrowseExports(facts)).toEqual([
      { path: "/home/ada", browse: "home" },
      { path: "/media/ada/USB", browse: "volume" },
      { path: "/mnt/data", browse: "volume" },
    ]);
  });

  it("Windows: home, then every drive letter that answers", () => {
    const facts: BrowseFacts = {
      platform: "win32",
      home: "C:\\Users\\ada",
      user: "ada",
      fs: fixtureFs(["C:\\Users\\ada", "C:\\", "D:\\"]),
    };
    expect(enumerateBrowseExports(facts)).toEqual([
      { path: "C:\\Users\\ada", browse: "home" },
      { path: "C:\\", browse: "volume" },
      { path: "D:\\", browse: "volume" },
    ]);
  });

  it("this machine: the real home directory leads", () => {
    const [first] = enumerateBrowseExports({
      platform: process.platform,
      home: homedir(),
      user: "",
      fs: { readdir: () => [], realpath: (p) => p, isDirectory: () => true, exists: () => true },
    });
    expect(first?.browse).toBe("home");
  });
});

describe("the worker's launch (L1: fieldd's own executable in a files-host role)", () => {
  const facts = (over: Partial<FilesHostFacts>): FilesHostFacts => ({
    sea: false,
    execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
    bundleDir: "/repo/packages/fieldd/dist",
    platform: "darwin",
    arch: "arm64",
    musl: false,
    exists: () => true,
    ...over,
  });

  it("development: the runtime fieldd runs under, with the bundle beside bin.cjs", () => {
    expect(chooseFilesHostLaunch(facts({}))).toEqual({
      kind: "launch",
      launch: {
        command: "/Applications/Electron.app/Contents/MacOS/Electron",
        args: ["/repo/packages/fieldd/dist/files-host.cjs"],
        milleNative: "/repo/packages/fieldd/dist/mille.darwin-arm64.node",
      },
    });
  });

  it("packaged: the single executable itself, in the files-host role", () => {
    expect(
      chooseFilesHostLaunch(
        facts({ sea: true, execPath: "/App/Contents/Resources/bin/fieldd", bundleDir: undefined }),
      ),
    ).toEqual({
      kind: "launch",
      launch: {
        command: "/App/Contents/Resources/bin/fieldd",
        args: [FILES_HOST_ROLE_ARG],
        milleNative: "/App/Contents/Resources/bin/mille.darwin-arm64.node",
      },
    });
  });

  it("is unconfigured, saying why, when a file is missing or there is no bundle", () => {
    const sea = chooseFilesHostLaunch(
      facts({ sea: true, execPath: "/bin/fieldd", exists: (p) => !p.endsWith(".node") }),
    );
    expect(sea).toMatchObject({ kind: "unconfigured" });
    expect(sea.kind === "unconfigured" ? sea.reason : "").toMatch(
      /native engine.*beside the executable/,
    );
    const source = chooseFilesHostLaunch(facts({ bundleDir: undefined }));
    expect(source).toMatchObject({ kind: "unconfigured" });
    const noBundle = chooseFilesHostLaunch(facts({ exists: (p) => !p.endsWith(".cjs") }));
    expect(noBundle.kind === "unconfigured" ? noBundle.reason : "").toMatch(/bundle/);
    expect(chooseFilesHostLaunch(facts({ platform: "freebsd" }))).toMatchObject({
      kind: "unconfigured",
    });
  });

  it("names mille's binaries as mille's own loader does", () => {
    expect(milleTriple("darwin", "x64", false)).toBe("darwin-x64");
    expect(milleTriple("linux", "x64", true)).toBe("linux-x64-musl");
    expect(milleTriple("linux", "arm64", false)).toBe("linux-arm64-gnu");
    expect(milleTriple("win32", "x64", false)).toBe("win32-x64-msvc");
    expect(milleTriple("aix", "ppc64", false)).toBeNull();
    expect(milleNativeFileName("darwin-arm64")).toBe("mille.darwin-arm64.node");
  });

  it("resolves the installed engine from fieldd's own dependency, as the build stages it", async () => {
    const found = installedMilleNative(PACKAGE_ROOT);
    expect(found).not.toBeNull();
    expect(existsSync(found as string)).toBe(true);
    const twin = (await import(join(PACKAGE_ROOT, "scripts", "files-host-build.mjs"))) as {
      installedMilleNativeFile: () => { file: string } | null;
    };
    expect(twin.installedMilleNativeFile()?.file).toBe(found);
    // a package directory with no mille resolves to nothing, never a guess
    const empty = mkdtempSync(join(tmpdir(), "vf-fh-none-"));
    cleanup.push(() => rmSync(empty, { recursive: true, force: true }));
    mkdirSync(join(empty, "node_modules"), { recursive: true });
    expect(installedMilleNative(empty)).toBeNull();
  });
});
