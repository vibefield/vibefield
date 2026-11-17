import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { resolveCustodyLevel } from "../src/main/custody/level";
import { OWN } from "./custody-fakes";

// OB custody, C1 — the level is decided by the shell from what the BUILD is, never from
// what the disk holds, so there is nothing on disk to delete that downgrades it: `sealed` for a packaged shell on
// macOS whose own signature carries a team and the hardened runtime, `files` for every other build. Whose code this
// process is comes from trust's `ownIdentity`, which the rows stand in for; no row runs codesign.

describe("the shell's custody level (C1)", () => {
  it("sealed: a packaged build on macOS whose own code is a team's, under the hardened runtime", async () => {
    const ownIdentity = vi.fn(async () => OWN);
    const level = await resolveCustodyLevel({ platform: "darwin", packaged: true, ownIdentity });
    expect(level).toEqual({ level: "sealed", own: OWN });
    expect(ownIdentity).toHaveBeenCalledTimes(1);
  });

  it("files: a package with no team or no hardened runtime (unsigned, ad-hoc), which trust answers with null", async () => {
    expect(
      await resolveCustodyLevel({
        platform: "darwin",
        packaged: true,
        ownIdentity: async () => null,
      }),
    ).toEqual({ level: "files" });
  });

  it("files: an identity that could not be asked is no identity", async () => {
    expect(
      await resolveCustodyLevel({
        platform: "darwin",
        packaged: true,
        ownIdentity: async () => {
          throw new Error("codesign did not start");
        },
      }),
    ).toEqual({ level: "files" });
  });

  it("files, without asking: an unpackaged build, and every platform but macOS", async () => {
    const ownIdentity = vi.fn(async () => OWN);
    for (const facts of [
      { platform: "darwin", packaged: false },
      { platform: "linux", packaged: true },
      { platform: "win32", packaged: true },
      { platform: "linux", packaged: false },
    ] as const) {
      expect(await resolveCustodyLevel({ ...facts, ownIdentity }), JSON.stringify(facts)).toEqual({
        level: "files",
      });
    }
    expect(ownIdentity).not.toHaveBeenCalled();
  });

  it("is decided in main once per boot, before any pair is built, and from nothing on disk", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main");
    const main = readFileSync(join(src, "index.ts"), "utf8");
    // one decision in the composition root, made before the first supervisor is built
    expect(main.split("resolveCustodyLevel(")).toHaveLength(2);
    expect(main.indexOf("resolveCustodyLevel(")).toBeLessThan(main.indexOf("buildSupervisor({"));
    expect(main).toContain("packaged: app.isPackaged,");
    // and the decision itself opens no file
    const level = readFileSync(join(src, "custody", "level.ts"), "utf8");
    expect(level).not.toMatch(/node:fs|readFile|existsSync/u);
  });
});
