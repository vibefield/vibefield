import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BROWSER_DESK_PROFILE_REF } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserSurfaceProfileName } from "../src/main/live-surfaces/browser-security";
import { removeSmokeRoot } from "../src/testing/smoke-daemons";
import { PROFILE_SEED_FLAG, profileSeedUrl } from "../src/testing/smoke-profile-seed";

// BP-D7 (thinking-browser-profile.md §3·6) — `smoke:profile`'s two halves agree with the shell they judge: the runner names
// the desk profile's directories exactly as main does (BP-D6), the harness takes its seed's address off argv and nothing
// else, and phase A's root is KEPT only by the runner's own switch (every other smoke still removes its own).

const here = dirname(fileURLToPath(import.meta.url));
const runner = pathToFileURL(
  resolve(here, "../../../apps/desktop/packaging/run-browser-profile-smoke.mjs"),
).href;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("smoke:profile (row 31)", () => {
  it("the runner names the desk profile's two directories as browserSurfaceProfileName does, by contracts' ref", async () => {
    const { profileDirName, DESK_REF } = (await import(runner)) as {
      profileDirName: (packaged: boolean) => string;
      DESK_REF: string;
    };
    expect(DESK_REF).toBe(BROWSER_DESK_PROFILE_REF);
    const desk = { profile: { mode: "persistent" as const, ref: BROWSER_DESK_PROFILE_REF } };
    expect(profileDirName(false)).toBe(browserSurfaceProfileName(desk, false));
    expect(profileDirName(true)).toBe(browserSurfaceProfileName(desk, true));
  });

  it("the harness takes its seed's address off argv: an http(s) URL after the flag, else nothing", () => {
    expect(profileSeedUrl([`${PROFILE_SEED_FLAG}=http://127.0.0.1:5000/seed?v=ab`])).toBe(
      "http://127.0.0.1:5000/seed?v=ab",
    );
    expect(profileSeedUrl(["--smoke-canvas"])).toBeUndefined();
    expect(profileSeedUrl([PROFILE_SEED_FLAG])).toBeUndefined();
    expect(profileSeedUrl([`${PROFILE_SEED_FLAG}=file:///etc/passwd`])).toBeUndefined();
    expect(profileSeedUrl([`${PROFILE_SEED_FLAG}=not a url`])).toBeUndefined();
  });

  it("phase A's root is kept ONLY by the runner's switch, and said; without it the root goes, as every smoke's does", () => {
    const home = mkdtempSync(join(tmpdir(), "vf-smoke-"));
    const root = join(home, "users", "u-1");
    try {
      vi.stubEnv("FIELDD_DATA_DIR", "");
      mkdirSync(root, { recursive: true });
      vi.stubEnv("VF_SMOKE_KEEP_ROOT", "1");
      const said: string[] = [];
      const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        said.push(String(chunk));
        return true;
      });
      removeSmokeRoot(root, true);
      write.mockRestore();
      expect(existsSync(root)).toBe(true);
      expect(said.join("")).toContain(`SMOKE_ROOT_KEPT ${JSON.stringify({ root, home })}`);
      vi.stubEnv("VF_SMOKE_KEEP_ROOT", "");
      const quiet = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      removeSmokeRoot(root, true);
      quiet.mockRestore();
      expect(existsSync(root)).toBe(false);
      expect(existsSync(home)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
