import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BROWSER_DESK_PROFILE_REF,
  type LiveSurfaceNavigationCommandV1,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type ClearableBrowserSurface,
  clearBrowsingData,
} from "../src/main/live-surfaces/browser-data";
import { browserSurfaceProfileName } from "../src/main/live-surfaces/browser-security";

// BP-D4 (thinking-browser-profile.md §3·3, 2026-10-26) — Settings' "Clear browsing data" as main does it: THIS shell's
// profiles (each KNOWN profile's, by its id — BP-D10, 2026-11-25: the desk's among the person's several — named the way
// this shell names it, BP-D6, and any other a page opened), never one that is not on disk, never one of the other kind,
// never one found by listing the root; then every page on a cleared profile that has a window is reloaded.

const ROOT = "/data/users/7/browser/profiles";
/** BP-D10 (2026-11-25): the known profiles' list its one caller passes until the list has its store */
const DESK = [BROWSER_DESK_PROFILE_REF] as const;
const folder = (ref: string, packaged: boolean) =>
  join(ROOT, browserSurfaceProfileName({ profile: { mode: "persistent", ref } }, packaged));
const desk = (packaged: boolean) => folder(BROWSER_DESK_PROFILE_REF, packaged);

function surface(
  path: string | undefined,
  options: { closed?: boolean; reload?: "ok" | "throws" } = {},
): ClearableBrowserSurface & { readonly reloads: number } {
  let reloads = 0;
  return {
    get reloads() {
      return reloads;
    },
    persistentProfilePath: () => path,
    isClosed: () => options.closed === true,
    navigate: async (command: LiveSurfaceNavigationCommandV1) => {
      if (command.action !== "reload") throw new Error(`unexpected ${command.action}`);
      if (options.reload === "throws")
        throw new Error("Browser surface is not available for navigation");
      reloads += 1;
    },
  };
}

describe("BP-D4 — Clear browsing data clears this shell's profiles and reloads their open pages", () => {
  it("clears the desk's profile by THIS shell's name, reloads the pages on it, and says the counts", async () => {
    for (const packaged of [false, true]) {
      const cleared: string[] = [];
      const onDesk = [surface(desk(packaged)), surface(desk(packaged))];
      const result = await clearBrowsingData({
        profilesRoot: ROOT,
        packaged,
        refs: DESK,
        surfaces: onDesk,
        exists: () => true,
        clearProfile: async (path) => {
          cleared.push(path);
        },
      });
      expect(cleared).toEqual([desk(packaged)]);
      expect(cleared).not.toContain(desk(!packaged));
      expect(result).toEqual({ profiles: 1, pages: 2 });
      expect(onDesk.map((s) => s.reloads)).toEqual([1, 1]);
    }
  });

  it("clears another persistent profile a page opened too, never a memory page's, and makes no profile to clear it", async () => {
    const other = join(ROOT, "f".repeat(40));
    const cleared: string[] = [];
    const memory = surface(undefined);
    const onOther = surface(other);
    const result = await clearBrowsingData({
      profilesRoot: ROOT,
      packaged: false,
      refs: DESK,
      surfaces: [memory, onOther],
      // the desk's profile was never written (no desk page has opened yet): not made in order to be cleared
      exists: (path) => path === other,
      clearProfile: async (path) => {
        cleared.push(path);
      },
    });
    expect(cleared).toEqual([other]);
    expect(result).toEqual({ profiles: 1, pages: 1 });
    expect(memory.reloads).toBe(0);
  });

  it("lets a closed surface go, counts no page it could not reload (at rest), and answers zero with no root", async () => {
    const closed = surface(desk(false), { closed: true });
    const resting = surface(desk(false), { reload: "throws" });
    const live = surface(desk(false));
    const result = await clearBrowsingData({
      profilesRoot: ROOT,
      packaged: false,
      refs: DESK,
      surfaces: [closed, resting, live],
      exists: () => true,
      clearProfile: async () => undefined,
    });
    expect(result).toEqual({ profiles: 1, pages: 1 });
    expect(closed.reloads).toBe(0);
    expect(live.reloads).toBe(1);
    const none = await clearBrowsingData({
      profilesRoot: undefined,
      packaged: false,
      refs: DESK,
      surfaces: [live],
      exists: () => true,
      clearProfile: async () => {
        throw new Error("never asked");
      },
    });
    expect(none).toEqual({ profiles: 0, pages: 0 });
  });

  it("clears BEFORE it reloads, so a reloaded page comes back signed out", async () => {
    const order: string[] = [];
    const page: ClearableBrowserSurface = {
      persistentProfilePath: () => desk(false),
      isClosed: () => false,
      navigate: async () => {
        order.push("reload");
      },
    };
    await clearBrowsingData({
      profilesRoot: ROOT,
      packaged: false,
      refs: DESK,
      surfaces: [page],
      exists: () => true,
      clearProfile: async () => {
        order.push("clear");
      },
    });
    expect(order).toEqual(["clear", "reload"]);
  });
});

// BP-D10 (2026-11-25) — several browser profiles: Clear reads the KNOWN ids (the list its caller passes), each named the
// way this shell names it, beside the open pages' profiles. It never lists the root, never opens a store of the other
// kind, never makes a profile to clear it, and a malformed id never reaches the file system.
describe("BP-D10 — Clear browsing data clears the known browser profiles by their ids", () => {
  const work = `p-${"w0".repeat(10)}`;
  const home = `p-${"h1".repeat(10)}`;

  /** a file system that says what was asked of it: every `exists` and every clear */
  function disk(onDisk: (path: string) => boolean) {
    const asked: string[] = [];
    const cleared: string[] = [];
    return {
      asked,
      cleared,
      exists: (path: string) => {
        asked.push(path);
        return onDisk(path);
      },
      clearProfile: async (path: string) => {
        cleared.push(path);
      },
    };
  }

  it("clears a named profile with NO open page when its id is in the list, by THIS shell's name, and never the other kind's", async () => {
    for (const packaged of [false, true]) {
      const fs = disk(() => true);
      const result = await clearBrowsingData({
        profilesRoot: ROOT,
        packaged,
        refs: [BROWSER_DESK_PROFILE_REF, work],
        surfaces: [],
        ...fs,
      });
      expect(fs.cleared).toEqual([desk(packaged), folder(work, packaged)]);
      expect(result).toEqual({ profiles: 2, pages: 0 });
      // the other kind's folders are never so much as asked after
      for (const other of [desk(!packaged), folder(work, !packaged)]) {
        expect(fs.asked).not.toContain(other);
        expect(fs.cleared).not.toContain(other);
      }
      expect(folder(work, packaged)).not.toBe(desk(packaged));
    }
  });

  it("leaves alone a profile whose id is not in the list and that no open page has", async () => {
    const fs = disk(() => true);
    const result = await clearBrowsingData({
      profilesRoot: ROOT,
      packaged: false,
      refs: [BROWSER_DESK_PROFILE_REF, work],
      surfaces: [],
      ...fs,
    });
    expect(fs.cleared).not.toContain(folder(home, false));
    expect(fs.asked).not.toContain(folder(home, false));
    expect(result.profiles).toBe(2);
  });

  it("can never list the profiles' root: its only file-system doors are the two it is handed", () => {
    // The fakes above cannot see a directory listing, so the no-scan law is held where it lives: the module's own imports
    // name no file system (node:fs, fs/promises, electron), and it reaches for none at run time.
    const source = readFileSync(
      new URL("../src/main/live-surfaces/browser-data.ts", import.meta.url),
      "utf8",
    );
    const imported = [...source.matchAll(/\bfrom\s+"([^"]+)"/gu)].map((match) => match[1]);
    expect(imported).toEqual(["node:path", "@vibefield/contracts", "./browser-security"]);
    expect(source).not.toMatch(/\b(?:require|import)\s*\(|\breaddir|\bopendir|\bglob\b/u);
  });

  it("clears an open page's profile beside the listed ones, once each, and reloads that page", async () => {
    const onHome = surface(folder(home, false));
    const onWork = surface(folder(work, false));
    const fs = disk(() => true);
    const result = await clearBrowsingData({
      profilesRoot: ROOT,
      packaged: false,
      refs: [BROWSER_DESK_PROFILE_REF, work, work],
      surfaces: [onHome, onWork],
      ...fs,
    });
    expect(fs.cleared).toEqual([desk(false), folder(work, false), folder(home, false)]);
    expect(result).toEqual({ profiles: 3, pages: 2 });
    expect([onHome.reloads, onWork.reloads]).toEqual([1, 1]);
  });

  it("passes over a malformed id in the list: it is never digested, so it never reaches the file system", async () => {
    const malformed = [
      "",
      "Desk",
      "run:x",
      `run:${work}`,
      "../x",
      "..",
      "/etc",
      `p-${"a".repeat(15)}`,
      `p-${"a".repeat(33)}`,
      `p-${"A".repeat(16)}`,
      `${work} `,
      "private profile name",
    ];
    const fs = disk(() => true);
    const result = await clearBrowsingData({
      profilesRoot: ROOT,
      packaged: false,
      refs: [...malformed, work],
      surfaces: [],
      ...fs,
    });
    expect(fs.asked).toEqual([folder(work, false)]);
    expect(fs.cleared).toEqual([folder(work, false)]);
    for (const ref of malformed)
      for (const packaged of [false, true]) expect(fs.asked).not.toContain(folder(ref, packaged));
    expect(result).toEqual({ profiles: 1, pages: 0 });
  });

  it("makes nothing for a listed id with nothing on disk: it is asked after, and not cleared", async () => {
    const fs = disk((path) => path === desk(false));
    const result = await clearBrowsingData({
      profilesRoot: ROOT,
      packaged: false,
      refs: [BROWSER_DESK_PROFILE_REF, work, home],
      surfaces: [],
      ...fs,
    });
    expect(fs.asked).toEqual([desk(false), folder(work, false), folder(home, false)]);
    expect(fs.cleared).toEqual([desk(false)]);
    expect(result).toEqual({ profiles: 1, pages: 0 });
  });

  it("with the desk's list alone, asks after and clears exactly what it did before the list", async () => {
    for (const packaged of [false, true]) {
      const onDesk = surface(desk(packaged));
      const fs = disk(() => true);
      const result = await clearBrowsingData({
        profilesRoot: ROOT,
        packaged,
        refs: DESK,
        surfaces: [onDesk],
        ...fs,
      });
      expect(fs.asked).toEqual([desk(packaged)]);
      expect(fs.cleared).toEqual([desk(packaged)]);
      expect(result).toEqual({ profiles: 1, pages: 1 });
      expect(onDesk.reloads).toBe(1);
    }
  });

  it("an empty list clears only the open pages' profiles, and no root still answers zero", async () => {
    const onWork = surface(folder(work, false));
    const fs = disk(() => true);
    expect(
      await clearBrowsingData({
        profilesRoot: ROOT,
        packaged: false,
        refs: [],
        surfaces: [onWork],
        ...fs,
      }),
    ).toEqual({ profiles: 1, pages: 1 });
    expect(fs.asked).toEqual([folder(work, false)]);
    const none = disk(() => true);
    expect(
      await clearBrowsingData({
        profilesRoot: undefined,
        packaged: false,
        refs: [BROWSER_DESK_PROFILE_REF, work],
        surfaces: [],
        ...none,
      }),
    ).toEqual({ profiles: 0, pages: 0 });
    expect(none.asked).toEqual([]);
  });
});
