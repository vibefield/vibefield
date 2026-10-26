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
// profiles (the desk's, named the way this shell names it — BP-D6 — and any other a page opened), never one that is not on
// disk, never one of the other kind; then every page on a cleared profile that has a window is reloaded.

const ROOT = "/data/users/7/browser/profiles";
const desk = (packaged: boolean) =>
  join(
    ROOT,
    browserSurfaceProfileName(
      { profile: { mode: "persistent", ref: BROWSER_DESK_PROFILE_REF } },
      packaged,
    ),
  );

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
      surfaces: [page],
      exists: () => true,
      clearProfile: async () => {
        order.push("clear");
      },
    });
    expect(order).toEqual(["clear", "reload"]);
  });
});
