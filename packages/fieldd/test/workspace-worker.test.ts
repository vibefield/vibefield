// FS-1a — the files worker, REAL: fieldd's supervisor over the bundled worker
// (test/files-host-bundle.ts — fieldd's own build, mille's engine loaded from
// the explicit path the supervisor hands it). The rows: the READY line and its
// generation; a page cut at the page with the next cursor; folders first and
// a folder's child count; folders only; a folder listed again read from the
// disk, not the engine's memory; the confinement the worker owns (a symlink on
// the way, never followed — inside the root or out of it); a gone root; a
// bounded search; the worker killed — every question in flight answered
// `restarting`, the next generation ready with its number moved; a worker that
// cannot load its engine is TERMINAL, never a spin; the L6 knob and a source
// run read as their honest states.
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceEntry } from "@vibefield/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  FILES_HOST_BUNDLE,
  FILES_HOST_ROLE_ARG,
  type FilesHostLaunch,
  milleTriple,
} from "../src/workspace/launch";
import {
  FilesHostRefusal,
  FilesHostSupervisor,
  FilesHostUnavailable,
} from "../src/workspace/supervisor";
import { filesHostLaunch, sourceFilesHostLaunch } from "./files-host-bundle";
import { until } from "./ws-rpc";

let launch: FilesHostLaunch;
beforeAll(async () => {
  launch = await filesHostLaunch();
}, 60_000);

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function tree(): { root: string; outside: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-fw-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  const outside = join(base, "outside");
  mkdirSync(join(outside, "secret"), { recursive: true });
  writeFileSync(join(outside, "secret", "key.txt"), "no");
  // 250 folders (a page and a half), three files, a nested folder
  for (let i = 0; i < 250; i += 1)
    mkdirSync(join(root, "wide", `d${String(i).padStart(3, "0")}`), { recursive: true });
  for (const name of ["one.txt", "two.txt", ".hidden.txt"])
    writeFileSync(join(root, "wide", name), name);
  mkdirSync(join(root, "deep", "a", "b"), { recursive: true });
  writeFileSync(join(root, "deep", "a", "b", "needle-file.md"), "x");
  mkdirSync(join(root, "deep", "needle-folder"), { recursive: true });
  for (const name of ["x", "y", ".z"]) writeFileSync(join(root, "deep", "needle-folder", name), "");
  // the escape: a link out of the root, and a link to a folder inside it
  symlinkSync(outside, join(root, "escape"));
  symlinkSync(join(root, "deep"), join(root, "alias"));
  return { root, outside };
}

async function ready(launchSpec = launch): Promise<FilesHostSupervisor> {
  const supervisor = new FilesHostSupervisor({
    launch: { kind: "launch", launch: launchSpec },
    timings: { RESTART_BASE_MS: 50, RESTART_MAX_MS: 200 },
  });
  cleanup.push(() => supervisor.stop());
  supervisor.start();
  await until(() => supervisor.health().phase === "ready", 20_000);
  return supervisor;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a refusal");
}

describe("the files worker (fieldd's supervisor over the real bundle)", () => {
  it("says READY with its generation and the engine it loaded", async () => {
    const supervisor = await ready();
    const health = supervisor.health();
    expect(health).toMatchObject({ phase: "ready", generation: 1, detail: null });
    expect(health.pid).toBeGreaterThan(0);
    expect(health.mille).toEqual({ packageVersion: "0.3.4", nativeVersion: "0.3.4" });
    // the pipe answers the ops it names and no others: git reaches a root only
    // over an attached session's own git leg (the `git` op was retired, R6)
    expect(
      await refusal(supervisor.request("git" as never, { rootPath: "/", request: {} } as never)),
    ).toMatchObject({ error: { code: "internal", message: "unknown op git" } });
  });

  it("pages a wide folder: folders first, child counts, the cut and the next offset", async () => {
    const { root } = tree();
    const supervisor = await ready();
    const first = await supervisor.request("list", {
      rootPath: root,
      segments: ["wide"],
      offset: 0,
      limit: 200,
      kinds: "all",
    });
    expect(first.total).toBe(253);
    expect(first.entries).toHaveLength(200);
    expect(first.nextOffset).toBe(200);
    expect(first.path).toBe(join(root, "wide"));
    for (const entry of first.entries) WorkspaceEntry.parse(entry);
    expect(first.entries[0]).toMatchObject({
      name: "d000",
      kind: "dir",
      path: join(root, "wide", "d000"),
      childCount: 0,
    });
    const second = await supervisor.request("list", {
      rootPath: root,
      segments: ["wide"],
      offset: 200,
      limit: 200,
      kinds: "all",
    });
    expect(second.entries.map((entry) => entry.name).slice(-3)).toEqual([
      ".hidden.txt",
      "one.txt",
      "two.txt",
    ]);
    expect(second.nextOffset).toBeNull();
    expect(second.entries.find((e) => e.name === "one.txt")).toMatchObject({
      kind: "file",
      size: 7,
    });
    const dirs = await supervisor.request("list", {
      rootPath: root,
      segments: ["wide"],
      offset: 0,
      limit: 300,
      kinds: "dirs",
    });
    expect(dirs.total).toBe(250);
    expect(dirs.entries.every((entry) => entry.kind === "dir")).toBe(true);
    const deep = await supervisor.request("list", {
      rootPath: root,
      segments: ["deep"],
      offset: 0,
      limit: 10,
      kinds: "dirs",
    });
    // a hidden child is not counted
    expect(deep.entries.find((e) => e.name === "needle-folder")?.childCount).toBe(2);
  });

  it("reads a folder listed before from the disk again (no watcher, no stale answer)", async () => {
    const { root } = tree();
    const supervisor = await ready();
    const ask = () =>
      supervisor.request("list", {
        rootPath: root,
        segments: ["deep"],
        offset: 0,
        limit: 50,
        kinds: "all",
      });
    expect((await ask()).entries.map((e) => e.name)).toEqual(["a", "needle-folder"]);
    mkdirSync(join(root, "deep", "born-later"));
    rmSync(join(root, "deep", "a"), { recursive: true });
    expect((await ask()).entries.map((e) => e.name)).toEqual(["born-later", "needle-folder"]);
  });

  it("never follows a symlink — out of the root or within it — and answers it as absent", async () => {
    const { root } = tree();
    const supervisor = await ready();
    const listed = await supervisor.request("list", {
      rootPath: root,
      segments: [],
      offset: 0,
      limit: 50,
      kinds: "all",
    });
    expect(listed.entries.find((e) => e.name === "escape")).toMatchObject({ kind: "symlink" });
    expect(listed.entries.find((e) => e.name === "escape")?.childCount).toBeUndefined();
    for (const segments of [["escape"], ["escape", "secret"], ["alias"], ["alias", "a"]]) {
      const error = await refusal(
        supervisor.request("list", {
          rootPath: root,
          segments,
          offset: 0,
          limit: 10,
          kinds: "all",
        }),
      );
      expect(error, segments.join("/")).toBeInstanceOf(FilesHostRefusal);
      expect((error as FilesHostRefusal).error.code, segments.join("/")).toBe("not-found");
    }
    const file = await refusal(
      supervisor.request("list", {
        rootPath: root,
        segments: ["wide", "one.txt"],
        offset: 0,
        limit: 1,
        kinds: "all",
      }),
    );
    expect((file as FilesHostRefusal).error.code).toBe("not-a-directory");
    const gone = await refusal(
      supervisor.request("list", {
        rootPath: join(root, "nope"),
        segments: [],
        offset: 0,
        limit: 1,
        kinds: "all",
      }),
    );
    expect((gone as FilesHostRefusal).error.code).toBe("root-missing");
  });

  it("searches a root or a subtree, bounded: kinds, the limit, `clipped`, never outside it", async () => {
    const { root } = tree();
    const supervisor = await ready();
    const search = (q: string, kinds: "all" | "dirs", limit = 10, segments: string[] = []) =>
      supervisor.request("search", { rootPath: root, segments, q, limit, kinds });
    const all = await search("needle", "all");
    // the worker's hits are RELATIVE to the export; the door makes them absolute
    expect(all.hits.map((hit) => hit.relativePath).sort()).toEqual([
      "deep/a/b/needle-file.md",
      "deep/needle-folder",
    ]);
    expect(all.hits.find((hit) => hit.name === "needle-folder")?.kind).toBe("dir");
    expect(all).toMatchObject({ complete: true, clipped: false });
    expect(all.walked).toBeGreaterThan(250);
    expect((await search("needle", "dirs")).hits.map((hit) => hit.name)).toEqual(["needle-folder"]);
    // a subtree: only what lies below `deep/a`
    const sub = await search("needle", "all", 10, ["deep", "a"]);
    expect(sub.hits.map((hit) => hit.relativePath)).toEqual(["deep/a/b/needle-file.md"]);
    const cut = await search("d0", "dirs", 5);
    expect(cut.hits).toHaveLength(5);
    expect(cut.clipped).toBe(true);
    // the link out of the root is never walked: its folder is never a hit
    expect((await search("secret", "all")).hits).toEqual([]);
    // a subtree behind a symlink is refused like a listing behind one
    const behind = await refusal(search("secret", "all", 10, ["escape"]));
    expect((behind as FilesHostRefusal).error.code).toBe("not-found");
  });

  it("restarts a killed worker: questions in flight hear `restarting`, the generation moves", async () => {
    const { root } = tree();
    const supervisor = await ready();
    const before = supervisor.health();
    process.kill(before.pid as number, "SIGKILL");
    await until(() => supervisor.health().phase !== "ready", 5_000);
    const during = await refusal(
      supervisor.request("list", {
        rootPath: root,
        segments: [],
        offset: 0,
        limit: 1,
        kinds: "all",
      }),
    );
    expect(during).toBeInstanceOf(FilesHostUnavailable);
    expect((during as FilesHostUnavailable).state).toBe("restarting");
    expect((during as FilesHostUnavailable).retryable).toBe(true);
    await until(() => supervisor.health().phase === "ready", 20_000);
    const after = supervisor.health();
    expect(after.generation).toBe(before.generation + 1);
    expect(after.pid).not.toBe(before.pid);
    const listed = await supervisor.request("list", {
      rootPath: root,
      segments: ["deep"],
      offset: 0,
      limit: 5,
      kinds: "dirs",
    });
    expect(listed.total).toBe(2);
  });

  it("reads a worker that cannot load its engine as TERMINAL — failed, not respawned", async () => {
    const supervisor = new FilesHostSupervisor({
      launch: {
        kind: "launch",
        launch: { ...launch, milleNative: join(tmpdir(), "no-such-mille.node") },
      },
      timings: { RESTART_BASE_MS: 20 },
    });
    cleanup.push(() => supervisor.stop());
    supervisor.start();
    await until(() => supervisor.health().phase === "failed", 20_000);
    const failed = supervisor.health();
    expect(failed.detail).toMatch(/did not load/);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(supervisor.health().generation).toBe(1);
    const error = await refusal(
      supervisor.request("list", {
        rootPath: tmpdir(),
        segments: [],
        offset: 0,
        limit: 1,
        kinds: "all",
      }),
    );
    expect(error).toMatchObject({ state: "failed", retryable: false });
  });

  it("answers the L6 knob and a source run honestly, and stops a live worker on stop()", async () => {
    const off = new FilesHostSupervisor({ launch: { kind: "off" } });
    off.start();
    expect(await refusal(off.request("stats", {}))).toMatchObject({
      state: "off",
      retryable: false,
    });
    const source = new FilesHostSupervisor({
      launch: { kind: "unconfigured", reason: "a source run" },
    });
    source.start();
    expect(source.health()).toMatchObject({ phase: "unconfigured", detail: "a source run" });
    const live = await ready();
    const pid = live.health().pid as number;
    await live.stop();
    expect(live.health().phase).toBe("stopped");
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe("the packaged role (L1): fieldd's own bundle re-run as the files worker", () => {
  it("bin.cjs with --vibefield-role=files-host loads the worker staged beside it, never the daemon", async () => {
    // fieldd's bundle as its build makes it (package.json's first step), staged
    // beside the worker and the engine the way the packaged layout stages the
    // executable's sidecars; the role is what the single executable runs
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "vf-role-")));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const { build } = await import("esbuild");
    await build({
      absWorkingDir: join(import.meta.dirname, ".."),
      entryPoints: ["src/bin.ts"],
      outfile: join(dir, "bin.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      define: { "import.meta.url": "undefined" },
      external: ["bufferutil", "utf-8-validate"],
      logLevel: "silent",
    });
    const sourceLaunch = await sourceFilesHostLaunch();
    copyFileSync(sourceLaunch.args[0] as string, join(dir, FILES_HOST_BUNDLE));
    const native = join(dir, `mille.${milleTriple(process.platform, process.arch, false)}.node`);
    copyFileSync(launch.milleNative, native);
    const supervisor = await ready({
      command: process.execPath,
      args: [join(dir, "bin.cjs"), FILES_HOST_ROLE_ARG],
      milleNative: native,
    });
    const { root } = tree();
    const page = await supervisor.request("list", {
      rootPath: root,
      segments: ["deep"],
      offset: 0,
      limit: 5,
      kinds: "dirs",
    });
    expect(page.entries.map((entry) => entry.name)).toEqual(["a", "needle-folder"]);
    // the process that answered is the one the role started — the worker, its
    // engine for this root alive in it
    const stats = await supervisor.request("stats", {});
    expect(stats.pid).toBe(supervisor.health().pid);
    expect(stats.engines).toBe(1);
  }, 60_000);
});
