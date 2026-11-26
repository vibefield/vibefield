// EY-1 (1f, 2026-11-19) — main makes its ONE browser native with the pop-up hook: a pop-up the run's policy allowed
// that the address rule then refused warns `desktop.pages.popup_belt_refused`, once each. The native is a fake that
// keeps what it was made with; the support makes it through "Clear browsing data", whose desk profile exists on disk.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_DESK_PROFILE_REF } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

const natives = vi.hoisted(() => ({
  made: [] as ({ readonly onPopupBeltRefused?: () => void } | undefined)[],
}));

vi.mock("electron", () => ({ BrowserWindow: class {}, session: {} }));
vi.mock("../src/main/live-surfaces/browser-electron-native", () => ({
  ElectronBrowserSurfaceNative: class {
    constructor(hooks?: { readonly onPopupBeltRefused?: () => void }) {
      natives.made.push(hooks);
    }
    async clearProfile(): Promise<void> {}
  },
}));

import { createProductionLiveSurfaceSupport } from "../src/main/live-surfaces/authority-production";
import { browserSurfaceProfileName } from "../src/main/live-surfaces/browser-security";

let root: string | undefined;

afterEach(() => {
  natives.made.length = 0;
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("main's browser native and the pop-up hook (EY-1 1f)", () => {
  it("makes the native with the hook, and a pop-up the address rule refused warns desktop.pages.popup_belt_refused once", async () => {
    root = mkdtempSync(join(tmpdir(), "ey1-popup-hook-"));
    const desk = browserSurfaceProfileName({
      profile: { mode: "persistent", ref: BROWSER_DESK_PROFILE_REF },
    });
    mkdirSync(join(root, desk), { recursive: true });
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn } as unknown as Logger;
    const support = createProductionLiveSurfaceSupport({
      capture: null,
      browserProfilesRoot: root,
      logger,
    });
    await support.clearBrowsingData();
    expect(natives.made).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    natives.made[0]?.onPopupBeltRefused?.();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("desktop.pages.popup_belt_refused");
    await support.dispose();
  });
});
