import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserProfilesPlacement,
  liesWithin,
  type PlacementFs,
  realOrPending,
  sayBrowserProfilesPlacement,
} from "../src/main/live-surfaces/browser-profiles-placement";

// BP-1c (BP-D9 (a), `draft/thinking-browser-profile.md` §3·8) — THE LAW: a desk browser profile lives inside Electron's
// userData, or Chromium never writes its cookie database. Main checks where this shell's profiles lie, once, at start,
// and says it: these rows pin the check over §3·8's four layouts (and BP-1c's three nested ones), the paths read as the
// filesystem names them, and the two lines the log says.

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

/** A filesystem where nothing exists: every path is read as given (resolved), so the rows are about the layout alone. */
const bare: PlacementFs = { exists: () => false, realpath: (p) => p };
/** The profiles root under a user root, as main joins it (`LAYOUT.BROWSER_PROFILES_DIR`). */
const profilesOf = (userRoot: string): string => join(userRoot, ...LAYOUT.BROWSER_PROFILES_DIR);

describe("liesWithin — by `relative`, never by a string prefix", () => {
  it("inside, or the same directory", () => {
    expect(liesWithin("/a/b", "/a/b/c/d")).toBe(true);
    expect(liesWithin("/a/b", "/a/b")).toBe(true);
    expect(liesWithin("/a", "/a/..b")).toBe(true);
  });

  it("a sibling, a parent, or a name that only starts the same is outside", () => {
    expect(liesWithin("/a/b", "/a/bc")).toBe(false);
    expect(liesWithin("/a/b", "/a/c/b")).toBe(false);
    expect(liesWithin("/a/b/c", "/a/b")).toBe(false);
  });
});

describe("browserProfilesPlacement — §3·8's layouts", () => {
  it.skipIf(process.platform === "win32")("each layout's answer", () => {
    const rows: [string, string, string, "kept" | "until-quit"][] = [
      // a packaged app, default paths: userData and the data root are one (`appData/VibeField`)
      [
        "packaged",
        "/Users/x/Library/Application Support/VibeField",
        profilesOf("/Users/x/Library/Application Support/VibeField/users/1"),
        "kept",
      ],
      // pnpm dev before BP-1c: siblings under the dev root
      [
        "dev, before",
        "/r/.vibefield/dev/electron-user-data",
        profilesOf("/r/.vibefield/dev/data/users/1"),
        "until-quit",
      ],
      // pnpm dev since BP-1c: userData IS the dev root, the data root under it
      ["dev", "/r/.vibefield/dev", profilesOf("/r/.vibefield/dev/data/users/1"), "kept"],
      // a smoke before BP-1c: a profile under the OS temp, a data root under /tmp
      [
        "smoke, before",
        "/var/folders/x/T/vf-smoke-profile-AbC123",
        profilesOf("/tmp/vf-smoke-hnUors/users/1"),
        "until-quit",
      ],
      // a smoke HOME: both in one
      ["smoke home", "/tmp/vf-smoke-hnUors", profilesOf("/tmp/vf-smoke-hnUors/users/1"), "kept"],
      // a packaged app with FIELDD_DATA_DIR or --user-data-dir set apart (W9, row 31 before BP-1c)
      ["set apart", "/run/userdata", profilesOf("/tmp/vf-smoke-hnUors/users/1"), "until-quit"],
    ];
    for (const [name, userData, profilesRoot, signIns] of rows) {
      expect(browserProfilesPlacement(profilesRoot, userData, bare), name).toEqual({
        signIns,
        profilesRoot,
        userData,
      });
    }
  });

  // a symlink needs a privilege on Windows
  it.skipIf(process.platform === "win32")(
    "reads both paths as the filesystem names them: a link to userData is userData",
    () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-bp1c-place-")));
      cleanup.push(() => rmSync(base, { recursive: true, force: true }));
      const real = join(base, "home");
      mkdirSync(real);
      const link = join(base, "link");
      symlinkSync(real, link, "dir");
      // the profiles root does not exist yet (a desk's first page makes it); its nearest ancestor is read for real
      expect(realOrPending(profilesOf(join(link, "users", "1")))).toBe(
        profilesOf(join(real, "users", "1")),
      );
      expect(browserProfilesPlacement(profilesOf(join(link, "users", "1")), real).signIns).toBe(
        "kept",
      );
      expect(browserProfilesPlacement(profilesOf(join(real, "users", "1")), link).signIns).toBe(
        "kept",
      );
      const apart = join(base, "apart");
      mkdirSync(apart);
      expect(browserProfilesPlacement(profilesOf(join(apart, "users", "1")), link).signIns).toBe(
        "until-quit",
      );
    },
  );
});

describe("sayBrowserProfilesPlacement — said once, never silent", () => {
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  it("a placement that cannot keep sign-ins is a warning that names both folders", () => {
    const log = logger();
    sayBrowserProfilesPlacement(
      { signIns: "until-quit", profilesRoot: "/d/users/1/browser/profiles", userData: "/u" },
      log,
    );
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
    const [event, message, attrs] = log.warn.mock.calls[0] ?? [];
    expect(event).toBe("desktop.live_surfaces.browser_sign_ins_until_quit");
    expect(message).toContain("the desk browser can't keep sign-ins here");
    expect(attrs).toEqual({ profilesRoot: "/d/users/1/browser/profiles", userData: "/u" });
  });

  it("a placement that keeps them is said as a fact", () => {
    const log = logger();
    sayBrowserProfilesPlacement(
      { signIns: "kept", profilesRoot: "/u/users/1/browser/profiles", userData: "/u" },
      log,
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledOnce();
    expect(log.info.mock.calls[0]?.[0]).toBe("desktop.live_surfaces.browser_sign_ins_kept");
  });
});
