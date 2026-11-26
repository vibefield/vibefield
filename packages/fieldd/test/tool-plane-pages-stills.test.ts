import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGES_STILLS_MAX_AGE_MS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { PagesStills, type PagesStillsRemoval } from "../src/tool-plane/rooms/pages/stills";

// EY-2 (2b, 2026-11-19) — the stills keeper on a real disk: a private folder per run, 0700 and fieldd's own, named by a
// hash of the run; a link where a folder should be is refused and never followed; the run's total is what its folder
// holds; a folder goes when its run's record is forgotten or its newest still ages past the bound, never anything
// outside the root, each removal inside its audit line, told by the folder's hash, its count and bytes alone.

const places: string[] = [];
afterEach(() => {
  for (const place of places.splice(0)) rmSync(place, { recursive: true, force: true });
});

const uid = process.getuid?.();

function keeper(opts: { audit?: "fails" } = {}) {
  const place = mkdtempSync(join(tmpdir(), "vf-stills-"));
  places.push(place);
  const root = join(place, "stills");
  const removals: PagesStillsRemoval[] = [];
  const stills = new PagesStills({
    root,
    ...(uid !== undefined ? { uid } : {}),
    audited: async (removal, remove) => {
      // the audit line is written first: a line that will not write leaves the folder as it is
      if (opts.audit === "fails") throw new Error("the audit writer refused");
      removals.push(removal);
      remove();
    },
  });
  /** a folder outside the root that nothing may touch */
  const decoy = join(place, "decoy");
  mkdirSync(decoy, { mode: 0o755 });
  writeFileSync(join(decoy, "keep.txt"), "the person's own");
  return { place, root, stills, removals, decoy };
}

const modeOf = (path: string) => statSync(path).mode & 0o777;
const OLD = (Date.now() - PAGES_STILLS_MAX_AGE_MS - 60_000) / 1000;

describe("EY-2: a run's private folder", () => {
  it("is made 0700 under a 0700 root, named by a hash of the run, and is the same folder each time", () => {
    const { root, stills } = keeper();
    const folder = stills.folderFor("run-a");
    expect(folder).toBe(join(root, PagesStills.nameOf("run-a")));
    expect(PagesStills.nameOf("run-a")).toMatch(/^[0-9a-f]{32}$/);
    expect(folder).not.toContain("run-a");
    expect(modeOf(root)).toBe(0o700);
    expect(modeOf(folder)).toBe(0o700);
    expect(stills.folderFor("run-a")).toBe(folder);
    expect(stills.folderFor("run-b")).not.toBe(folder);
  });

  it("a folder made wider is kept 0700", () => {
    const { root, stills } = keeper();
    const folder = stills.folderFor("run-a");
    chmodSync(folder, 0o755);
    chmodSync(root, 0o755);
    stills.folderFor("run-a");
    expect(modeOf(root)).toBe(0o700);
    expect(modeOf(folder)).toBe(0o700);
  });

  it("a link where the run's folder should be is refused, never followed", () => {
    const { root, stills, decoy } = keeper();
    mkdirSync(root, { mode: 0o700 });
    symlinkSync(decoy, join(root, PagesStills.nameOf("run-a")));
    expect(() => stills.folderFor("run-a")).toThrow(/not a real directory/);
    expect(modeOf(decoy)).toBe(0o755);
    expect(readdirSync(decoy)).toEqual(["keep.txt"]);
  });

  it("a root that is a link is refused, never followed", () => {
    const { root, stills, decoy } = keeper();
    symlinkSync(decoy, root);
    expect(() => stills.folderFor("run-a")).toThrow(/not a real directory/);
    expect(readdirSync(decoy)).toEqual(["keep.txt"]);
    expect(modeOf(decoy)).toBe(0o755);
  });
});

describe("EY-2: the still the room answers is the run's own, and readable", () => {
  it("is a file the person's uid can read, directly in the run's 0700 folder under the 0700 root", () => {
    const { root, stills } = keeper();
    const folder = stills.folderFor("run-a");
    const still = join(folder, "still-1.png");
    writeFileSync(still, Buffer.alloc(10), { mode: 0o600 });
    expect(stills.holds("run-a", still)).toBe(true);
    // every part, up to the root, is a real directory of the uid's, 0700, and the file is the uid's to read
    for (const part of [root, folder]) {
      expect(lstatSync(part).isDirectory()).toBe(true);
      expect(modeOf(part)).toBe(0o700);
      if (uid !== undefined) expect(lstatSync(part).uid).toBe(uid);
    }
    expect(lstatSync(still).isFile()).toBe(true);
    if (uid !== undefined) expect(lstatSync(still).uid).toBe(uid);
    expect(statSync(still).mode & 0o400).toBe(0o400);
  });

  it("is never another run's, a link, a second name, a file below the folder, or one the uid cannot read", () => {
    const { stills, decoy } = keeper();
    const mine = stills.folderFor("run-a");
    const theirs = stills.folderFor("run-b");
    const other = join(theirs, "still-1.png");
    writeFileSync(other, Buffer.alloc(10), { mode: 0o600 });
    expect(stills.holds("run-a", other)).toBe(false);
    // a path through `..` is judged as written, never resolved into the run's folder
    const around = `${mine}/../${PagesStills.nameOf("run-b")}/still-1.png`;
    expect(stills.holds("run-a", around)).toBe(false);
    symlinkSync(join(decoy, "keep.txt"), join(mine, "link.png"));
    expect(stills.holds("run-a", join(mine, "link.png"))).toBe(false);
    linkSync(other, join(mine, "second.png"));
    expect(stills.holds("run-a", join(mine, "second.png"))).toBe(false);
    mkdirSync(join(mine, "below"), { mode: 0o700 });
    writeFileSync(join(mine, "below", "still.png"), Buffer.alloc(10), { mode: 0o600 });
    expect(stills.holds("run-a", join(mine, "below", "still.png"))).toBe(false);
    writeFileSync(join(mine, "unreadable.png"), Buffer.alloc(10), { mode: 0o200 });
    expect(stills.holds("run-a", join(mine, "unreadable.png"))).toBe(false);
    expect(stills.holds("run-a", join(mine, "absent.png"))).toBe(false);
    expect(stills.holds("run-a", mine)).toBe(false);
  });

  it("is never answered from a folder or root made wider, and checking it sets nothing", () => {
    const { root, stills } = keeper();
    const folder = stills.folderFor("run-a");
    const still = join(folder, "still-1.png");
    writeFileSync(still, Buffer.alloc(10), { mode: 0o600 });
    chmodSync(folder, 0o755);
    expect(stills.holds("run-a", still)).toBe(false);
    expect(modeOf(folder)).toBe(0o755);
    chmodSync(folder, 0o700);
    chmodSync(root, 0o755);
    expect(stills.holds("run-a", still)).toBe(false);
    expect(modeOf(root)).toBe(0o755);
  });
});

describe("EY-2: what a run's stills hold", () => {
  it("is the sum of its folder's files; a link inside is not counted", () => {
    const { stills, decoy } = keeper();
    expect(stills.used("run-a")).toBe(0);
    const folder = stills.folderFor("run-a");
    writeFileSync(join(folder, "a.png"), Buffer.alloc(100));
    writeFileSync(join(folder, "b.png"), Buffer.alloc(23));
    writeFileSync(join(decoy, "big.bin"), Buffer.alloc(10_000));
    symlinkSync(join(decoy, "big.bin"), join(folder, "c.png"));
    expect(stills.used("run-a")).toBe(123);
  });
});

describe("EY-2: a folder goes, and nothing outside the root", () => {
  it("when its run's record is forgotten: inside its audit line, told by hash, count and bytes, never a path", async () => {
    const { stills, removals, decoy } = keeper();
    const folder = stills.folderFor("run-a");
    writeFileSync(join(folder, "a.png"), Buffer.alloc(100));
    symlinkSync(decoy, join(folder, "into-decoy"));
    await stills.forget("run-a");
    expect(existsSync(folder)).toBe(false);
    expect(readdirSync(decoy)).toEqual(["keep.txt"]);
    expect(removals).toEqual([
      { why: "forgotten", folder: PagesStills.nameOf("run-a"), files: 1, bytes: 100 },
    ]);
    expect(JSON.stringify(removals)).not.toContain(folder);
    expect(JSON.stringify(removals)).not.toContain("run-a");
  });

  it("an audit line that will not write leaves the folder as it is", async () => {
    const { stills } = keeper({ audit: "fails" });
    const folder = stills.folderFor("run-a");
    writeFileSync(join(folder, "a.png"), Buffer.alloc(5));
    await expect(stills.forget("run-a")).rejects.toThrow(/refused/);
    expect(existsSync(join(folder, "a.png"))).toBe(true);
    utimesSync(join(folder, "a.png"), OLD, OLD);
    utimesSync(folder, OLD, OLD);
    await stills.sweep();
    expect(existsSync(folder)).toBe(true);
  });

  it("a link at the run's name goes and what it names stays; a run with no folder tells nothing", async () => {
    const { root, stills, removals, decoy } = keeper();
    mkdirSync(root, { mode: 0o700 });
    const link = join(root, PagesStills.nameOf("run-a"));
    symlinkSync(decoy, link);
    await stills.forget("run-a");
    expect(() => lstatSync(link)).toThrow();
    expect(readdirSync(decoy)).toEqual(["keep.txt"]);
    await stills.forget("run-b");
    expect(removals).toEqual([]);
  });

  it("once its newest still is older than the bound, at the sweep; a fresh one and anything not the keeper's stay", async () => {
    const { root, stills, removals } = keeper();
    const old = stills.folderFor("run-old");
    writeFileSync(join(old, "a.png"), Buffer.alloc(7));
    utimesSync(join(old, "a.png"), OLD, OLD);
    utimesSync(old, OLD, OLD);
    const fresh = stills.folderFor("run-fresh");
    writeFileSync(join(fresh, "a.png"), Buffer.alloc(9));
    // an old still beside a new one keeps the folder: the newest decides
    const mixed = stills.folderFor("run-mixed");
    writeFileSync(join(mixed, "old.png"), Buffer.alloc(1));
    utimesSync(join(mixed, "old.png"), OLD, OLD);
    writeFileSync(join(mixed, "new.png"), Buffer.alloc(1));
    utimesSync(mixed, OLD, OLD);
    const stranger = join(root, "not-the-keepers");
    mkdirSync(stranger);
    utimesSync(stranger, OLD, OLD);
    await stills.sweep();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(mixed)).toBe(true);
    expect(existsSync(stranger)).toBe(true);
    expect(removals).toEqual([
      { why: "age", folder: PagesStills.nameOf("run-old"), files: 1, bytes: 7 },
    ]);
  });

  it("a link in the root named as a folder of the keeper's is never followed by the sweep", async () => {
    const { root, stills, removals, decoy } = keeper();
    mkdirSync(root, { mode: 0o700 });
    utimesSync(join(decoy, "keep.txt"), OLD, OLD);
    utimesSync(decoy, OLD, OLD);
    symlinkSync(decoy, join(root, PagesStills.nameOf("run-a")));
    await stills.sweep();
    expect(readdirSync(decoy)).toEqual(["keep.txt"]);
    expect(removals).toEqual([]);
  });

  it("the sweeps run at once, and stop when told", async () => {
    const { stills, removals } = keeper();
    const old = stills.folderFor("run-old");
    utimesSync(old, OLD, OLD);
    const sweeps = stills.startSweeps();
    await sweeps.swept;
    sweeps.stop();
    expect(existsSync(old)).toBe(false);
    expect(removals).toEqual([
      { why: "age", folder: PagesStills.nameOf("run-old"), files: 0, bytes: 0 },
    ]);
  });
});
