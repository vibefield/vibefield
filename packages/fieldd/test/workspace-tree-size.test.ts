// HD-3 — the files worker's measurer of worktree folders (`tree-size.ts`): nothing is walked unless it is asked
// for by name; an ask replaces the queue; one walk at a time, with a rest after each; a figure is kept on disk
// and stands for a day; a folder that is not a checkout is never walked; and a real folder is read with du.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_TREE_SIZE } from "@vibefield/contracts/registries";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorktreeList } from "../src/workspace/host/git";
import { measureWithDu, type TreeMeasure, TreeSizes } from "../src/workspace/host/tree-size";

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

/** A measurer and a rest the test releases by hand: who was walked, in order, and each pause asked for. */
function gated(): {
  walked: string[];
  rests: number[];
  measure: TreeMeasure;
  rest: (ms: number) => Promise<void>;
  answer(folder: string, bytes: number | null): Promise<void>;
  rested(): Promise<void>;
} {
  const walked: string[] = [];
  const rests: number[] = [];
  const release = new Map<string, (bytes: number | null) => void>();
  let wake: (() => void) | null = null;
  return {
    walked,
    rests,
    measure: (folder) =>
      new Promise((resolve) => {
        walked.push(folder);
        release.set(folder, resolve);
      }),
    rest: (ms) =>
      new Promise((resolve) => {
        rests.push(ms);
        wake = resolve;
      }),
    answer: async (folder, bytes) => {
      release.get(folder)?.(bytes);
      await settle();
    },
    rested: async () => {
      wake?.();
      wake = null;
      await settle();
    },
  };
}

function sizesOver(
  gate: ReturnType<typeof gated>,
  more: ConstructorParameters<typeof TreeSizes>[0] = {},
): TreeSizes {
  const sizes = new TreeSizes({
    measure: gate.measure,
    rest: gate.rest,
    isWorktree: () => true,
    platform: "darwin",
    ...more,
  });
  cleanup.push(() => sizes.dispose());
  return sizes;
}

describe("TreeSizes (HD-3)", () => {
  it("walks nothing until asked; then one folder at a time, resting after each", async () => {
    const gate = gated();
    const sizes = sizesOver(gate);
    expect(sizes.peek("/a")).toBeUndefined();
    await settle();
    expect(gate.walked, "a peek queues nothing").toEqual([]);

    expect(sizes.ask(["/a", "/b"])).toEqual([null, null]);
    await settle();
    expect(gate.walked).toEqual(["/a"]);
    await gate.answer("/a", 4096);
    expect(sizes.ask(["/a", "/b"]), "the figure is answerable at once").toEqual([4096, null]);
    expect(gate.walked, "the next walk waits out the rest").toEqual(["/a"]);
    expect(gate.rests).toEqual([WORKSPACE_TREE_SIZE.REST_MIN_MS]);
    await gate.rested();
    expect(gate.walked).toEqual(["/a", "/b"]);
    await gate.answer("/b", 8192);
    expect(sizes.ask(["/a", "/b"])).toEqual([4096, 8192]);
    expect(sizes.peek("/b")).toBe(8192);
  });

  it("rests in proportion to the walk it just made", async () => {
    const gate = gated();
    let clock = 10_000;
    const sizes = sizesOver(gate, { now: () => clock });
    sizes.ask(["/slow"]);
    await settle();
    clock += 3_000;
    await gate.answer("/slow", 1);
    expect(gate.rests).toEqual([3_000 * WORKSPACE_TREE_SIZE.REST_FACTOR]);
  });

  it("an ask replaces the queue: what is no longer named is no longer owed", async () => {
    const gate = gated();
    const sizes = sizesOver(gate);
    sizes.ask(["/a", "/b", "/c", "/d"]);
    await settle();
    expect(gate.walked).toEqual(["/a"]);
    // the reader scrolled: only /d and /e are on screen now
    expect(sizes.ask(["/d", "/e"])).toEqual([null, null]);
    await gate.answer("/a", 1);
    await gate.rested();
    await gate.answer("/d", 2);
    await gate.rested();
    await gate.answer("/e", 3);
    await gate.rested();
    expect(gate.walked, "/b and /c were never walked").toEqual(["/a", "/d", "/e"]);
    expect(sizes.peek("/b")).toBeUndefined();
  });

  it("takes at most ASK_MAX folders of one ask", async () => {
    const gate = gated();
    const sizes = sizesOver(gate);
    const many = Array.from({ length: WORKSPACE_TREE_SIZE.ASK_MAX + 5 }, (_, i) => `/w${i}`);
    const answers = sizes.ask(many);
    expect(answers.slice(0, WORKSPACE_TREE_SIZE.ASK_MAX).every((a) => a === null)).toBe(true);
    expect(answers.slice(WORKSPACE_TREE_SIZE.ASK_MAX).every((a) => a === undefined)).toBe(true);
  });

  it("a figure stands for a day; after it, the old figure is answered while it is walked again", async () => {
    const gate = gated();
    let clock = 1_000;
    const sizes = sizesOver(gate, { now: () => clock });
    sizes.ask(["/a"]);
    await settle();
    await gate.answer("/a", 100);
    await gate.rested();
    clock += WORKSPACE_TREE_SIZE.TTL_MS - 1;
    expect(sizes.ask(["/a"])).toEqual([100]);
    await settle();
    expect(gate.walked).toHaveLength(1);
    clock += 1;
    expect(sizes.ask(["/a"])).toEqual([100]);
    await settle();
    expect(gate.walked).toHaveLength(2);
    await gate.answer("/a", 250);
    expect(sizes.ask(["/a"])).toEqual([250]);
  });

  it("remembers a failed walk as no figure, for its shorter while", async () => {
    const gate = gated();
    let clock = 1_000;
    const sizes = sizesOver(gate, { now: () => clock });
    sizes.ask(["/a"]);
    await settle();
    await gate.answer("/a", null);
    await gate.rested();
    expect(sizes.ask(["/a"])).toEqual([undefined]);
    await settle();
    expect(gate.walked).toHaveLength(1);
    clock += WORKSPACE_TREE_SIZE.FAILED_TTL_MS;
    expect(sizes.ask(["/a"])).toEqual([null]);
    await settle();
    expect(gate.walked).toHaveLength(2);
  });

  it("keeps its figures on disk: a new measurer over the same file walks nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-tree-kept-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "workspace", "tree-sizes.json");
    const gate = gated();
    const first = sizesOver(gate, { file });
    first.ask(["/a", "/b"]);
    await settle();
    await gate.answer("/a", 4096);
    await gate.rested();
    await gate.answer("/b", null);
    first.dispose();
    const kept = JSON.parse(readFileSync(file, "utf8")) as { v: number; sizes: object };
    expect(kept.v).toBe(1);
    expect(Object.keys(kept.sizes), "a failed walk is not kept").toEqual(["/a"]);

    const again = gated();
    const second = sizesOver(again, { file });
    expect(second.peek("/a")).toBe(4096);
    expect(second.ask(["/a"])).toEqual([4096]);
    await settle();
    expect(again.walked).toEqual([]);
  });

  it("reads a kept file it cannot use as no figures, and a hostile one as only what is well formed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-tree-bad-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "tree-sizes.json");
    writeFileSync(file, "{ not json");
    expect(sizesOver(gated(), { file }).peek("/a")).toBeUndefined();
    writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        sizes: {
          "/good": { bytes: 12, at: 5 },
          relative: { bytes: 12, at: 5 },
          "/negative": { bytes: -1, at: 5 },
          "/words": { bytes: "12", at: 5 },
          "/null": null,
        },
      }),
    );
    const sizes = sizesOver(gated(), { file });
    expect(sizes.peek("/good")).toBe(12);
    for (const folder of ["relative", "/negative", "/words", "/null"])
      expect(sizes.peek(folder)).toBeUndefined();
  });

  it("EL7: never walks a folder that has no .git of its own, or a relative path", async () => {
    const gate = gated();
    const plain = mkdtempSync(join(tmpdir(), "vf-tree-plain-"));
    cleanup.push(() => rmSync(plain, { recursive: true, force: true }));
    const sizes = new TreeSizes({
      measure: gate.measure,
      rest: async () => {},
      platform: "darwin",
    });
    cleanup.push(() => sizes.dispose());
    expect(sizes.ask(["/", plain, "relative/path"])).toEqual([null, null, null]);
    for (let i = 0; i < 6; i += 1) await settle();
    expect(gate.walked).toEqual([]);
    expect(sizes.ask(["/", plain, "relative/path"])).toEqual([undefined, undefined, undefined]);
  });

  it("measures nothing on Windows, and nothing once disposed", async () => {
    const gate = gated();
    expect(sizesOver(gate, { platform: "win32" }).ask(["C:\\repo"])).toEqual([undefined]);
    const sizes = sizesOver(gate);
    sizes.dispose();
    expect(sizes.ask(["/a"])).toEqual([undefined]);
    await settle();
    expect(gate.walked).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "reads a real checkout with du, under the utility clamp where the platform has one",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "vf-tree-size-"));
      cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
      mkdirSync(join(dir, ".git"));
      mkdirSync(join(dir, "deep", "er"), { recursive: true });
      writeFileSync(join(dir, "deep", "er", "blob"), Buffer.alloc(300_000, 7));
      const bytes = await measureWithDu(dir);
      expect(bytes).toBeGreaterThanOrEqual(300_000);
      expect(bytes).toBeLessThan(2_000_000);
      expect(await measureWithDu(dir, { clamp: false })).toBe(bytes);
      expect(await measureWithDu(join(dir, "absent"))).toBeNull();

      const sizes = new TreeSizes();
      cleanup.push(() => sizes.dispose());
      expect(sizes.ask([dir])).toEqual([null]);
      for (let i = 0; i < 400 && sizes.peek(dir) === undefined; i += 1)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sizes.peek(dir)).toBe(bytes);
    },
  );
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
