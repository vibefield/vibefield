// HD-3 — the files worker's measurer of worktree folders (`tree-size.ts`): it
// answers at once, walks one folder at a time, keeps a figure for its TTL,
// never walks a folder that is not a checkout, and reads a real folder with du.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_TREE_SIZE } from "@vibefield/contracts/registries";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorktreeList } from "../src/workspace/host/git";
import { measureWithDu, type TreeMeasure, TreeSizes } from "../src/workspace/host/tree-size";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

/** A measurer the test releases by hand: who was asked, in order. */
function gated(): {
  asked: string[];
  measure: TreeMeasure;
  answer(folder: string, bytes: number | null): Promise<void>;
} {
  const asked: string[] = [];
  const release = new Map<string, (bytes: number | null) => void>();
  return {
    asked,
    measure: (folder) =>
      new Promise((resolve) => {
        asked.push(folder);
        release.set(folder, resolve);
      }),
    answer: async (folder, bytes) => {
      release.get(folder)?.(bytes);
      await settle();
      await settle();
    },
  };
}

describe("TreeSizes (HD-3)", () => {
  it("answers at once, walks one folder at a time, and has the figure for the next read", async () => {
    const gate = gated();
    const sizes = new TreeSizes({
      measure: gate.measure,
      isWorktree: () => true,
      platform: "darwin",
    });
    expect(sizes.read("/a")).toBeNull();
    expect(sizes.read("/b")).toBeNull();
    expect(sizes.read("/a")).toBeNull();
    await settle();
    expect(gate.asked).toEqual(["/a"]);
    await gate.answer("/a", 4096);
    expect(gate.asked).toEqual(["/a", "/b"]);
    expect(sizes.read("/a")).toBe(4096);
    await gate.answer("/b", 8192);
    expect(sizes.read("/b")).toBe(8192);
    expect(gate.asked).toEqual(["/a", "/b"]);
  });

  it("answers the old figure while a stale one is measured again", async () => {
    const gate = gated();
    let clock = 1_000;
    const sizes = new TreeSizes({
      measure: gate.measure,
      isWorktree: () => true,
      platform: "linux",
      now: () => clock,
    });
    sizes.read("/a");
    await settle();
    await gate.answer("/a", 100);
    clock += WORKSPACE_TREE_SIZE.TTL_MS - 1;
    expect(sizes.read("/a")).toBe(100);
    expect(gate.asked).toHaveLength(1);
    clock += 1;
    expect(sizes.read("/a")).toBe(100);
    await settle();
    expect(gate.asked).toHaveLength(2);
    await gate.answer("/a", 250);
    expect(sizes.read("/a")).toBe(250);
  });

  it("remembers a failed walk as no figure and does not walk again until it is old", async () => {
    const gate = gated();
    const sizes = new TreeSizes({
      measure: gate.measure,
      isWorktree: () => true,
      platform: "darwin",
    });
    sizes.read("/a");
    await settle();
    await gate.answer("/a", null);
    expect(sizes.read("/a")).toBeUndefined();
    await settle();
    expect(gate.asked).toHaveLength(1);
  });

  it("EL7: never walks a folder that has no .git of its own, or a relative path", async () => {
    const gate = gated();
    const plain = mkdtempSync(join(tmpdir(), "vf-tree-plain-"));
    cleanup.push(() => rmSync(plain, { recursive: true, force: true }));
    const sizes = new TreeSizes({ measure: gate.measure, platform: "darwin" });
    for (const folder of ["/", plain, "relative/path"]) expect(sizes.read(folder)).toBeNull();
    await settle();
    await settle();
    await settle();
    await settle();
    expect(gate.asked).toEqual([]);
    for (const folder of ["/", plain, "relative/path"]) expect(sizes.read(folder)).toBeUndefined();
  });

  it("measures nothing on Windows, and nothing once disposed", async () => {
    const gate = gated();
    const windows = new TreeSizes({
      measure: gate.measure,
      isWorktree: () => true,
      platform: "win32",
    });
    expect(windows.read("C:\\repo")).toBeUndefined();
    const sizes = new TreeSizes({
      measure: gate.measure,
      isWorktree: () => true,
      platform: "darwin",
    });
    sizes.dispose();
    expect(sizes.read("/a")).toBeUndefined();
    await settle();
    expect(gate.asked).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("reads a real checkout with du", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-tree-size-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "deep", "er"), { recursive: true });
    writeFileSync(join(dir, "deep", "er", "blob"), Buffer.alloc(300_000, 7));
    const bytes = await measureWithDu(dir);
    expect(bytes).toBeGreaterThanOrEqual(300_000);
    expect(bytes).toBeLessThan(2_000_000);
    expect(await measureWithDu(join(dir, "absent"))).toBeNull();

    const sizes = new TreeSizes();
    cleanup.push(() => sizes.dispose());
    expect(sizes.read(dir)).toBeNull();
    for (let i = 0; i < 300 && sizes.read(dir) === null; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sizes.read(dir)).toBe(bytes);
  });
});

describe("parseWorktreeList (HD-3: the commit beside each worktree)", () => {
  it("reads HEAD for a branch, a detached checkout and a gone one; none for a bare repository", () => {
    const raw = [
      "worktree /r/main\nHEAD 4082d6c9a1b2c3d4e5f60718293a4b5c6d7e8f90\nbranch refs/heads/main",
      "worktree /tmp/wt-10bfix\nHEAD 0e4919fff0a1b2c3d4e5f60718293a4b5c6d7e8f\ndetached",
      "worktree /tmp/wt-09\nHEAD 22fdbadc00a1b2c3d4e5f60718293a4b5c6d7e8f\ndetached\nprunable gitdir file points to non-existent location",
      "worktree /r/bare.git\nbare",
      "worktree /r/odd\nHEAD not-a-commit\nbranch refs/heads/odd\n",
    ].join("\n\n");
    expect(parseWorktreeList(raw)).toEqual([
      {
        path: "/r/main",
        branch: "main",
        head: "4082d6c9a1b2c3d4e5f60718293a4b5c6d7e8f90",
        bare: false,
        prunable: false,
      },
      {
        path: "/tmp/wt-10bfix",
        branch: null,
        head: "0e4919fff0a1b2c3d4e5f60718293a4b5c6d7e8f",
        bare: false,
        prunable: false,
      },
      {
        path: "/tmp/wt-09",
        branch: null,
        head: "22fdbadc00a1b2c3d4e5f60718293a4b5c6d7e8f",
        bare: false,
        prunable: true,
      },
      { path: "/r/bare.git", branch: null, head: null, bare: true, prunable: false },
      { path: "/r/odd", branch: "odd", head: null, bare: false, prunable: false },
    ]);
  });
});
