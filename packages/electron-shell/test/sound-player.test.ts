/**
 * SD-2 (DESIGN.md §14 "In VibeField", §8 "Settings → Sound") — the system-sound player. It loads once, lazily, and
 * says honestly why it cannot play (off macOS, a build without it, or one that would not start): never a switch that
 * silently does nothing. On a Mac its witness plays a SILENT file through the built addon: nothing is heard; the row
 * proves the system path opened the file, played it to its end and answered 0 (the audible row is James's, owed).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeWav } from "@vibefield/sound";
import { describe, expect, it, vi } from "vitest";
import { createSoundPlayer } from "../src/main/sound-player";

const ADDON = resolve(
  import.meta.dirname,
  "../../../apps/desktop/build/native/macos/desktop-sound-player.node",
);

describe("the player's state", () => {
  it("is unsupported off macOS, and never loads anything there", () => {
    const load = vi.fn();
    const player = createSoundPlayer({
      platform: "win32",
      path: "/x/desktop-sound-player.node",
      load,
    });
    expect(player.state()).toBe("unsupported");
    expect(load).not.toHaveBeenCalled();
  });
  it("is missing in a build made without it", () => {
    expect(createSoundPlayer({ platform: "darwin", path: null }).state()).toBe("missing");
    expect(
      createSoundPlayer({
        platform: "darwin",
        path: "/nowhere/desktop-sound-player.node",
        exists: () => false,
      }).state(),
    ).toBe("missing");
  });
  it("is failed when it would not start, said once, and never retried", () => {
    const onError = vi.fn();
    const load = vi.fn(() => {
      throw new Error("dlopen refused");
    });
    const player = createSoundPlayer({
      platform: "darwin",
      path: "/b/p.node",
      exists: () => true,
      load,
      onError,
    });
    expect(player.state()).toBe("failed");
    expect(player.state()).toBe("failed");
    expect(load).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
  it("is failed when what loaded has no play", () => {
    const player = createSoundPlayer({
      platform: "darwin",
      path: "/b/p.node",
      exists: () => true,
      load: () => ({}),
    });
    expect(player.state()).toBe("failed");
  });
  it("refuses a relative path", () => {
    const player = createSoundPlayer({
      platform: "darwin",
      path: "p.node",
      exists: () => true,
      load: () => ({}),
    });
    expect(player.state()).toBe("failed");
  });
});

describe("a play", () => {
  const ready = (play: (path: string) => Promise<number>) =>
    createSoundPlayer({
      platform: "darwin",
      path: "/b/p.node",
      exists: () => true,
      load: () => ({ play }),
    });
  it("answers true when the system played the file to its end", async () => {
    const play = vi.fn(async () => 0);
    expect(await ready(play).play("/c/done.wav")).toBe(true);
    expect(play).toHaveBeenCalledWith("/c/done.wav");
  });
  it("answers false on the system's refusal, and stays ready for the next sound", async () => {
    const onError = vi.fn();
    const player = createSoundPlayer({
      platform: "darwin",
      path: "/b/p.node",
      exists: () => true,
      load: () => ({ play: async () => -50 }),
      onError,
    });
    expect(await player.play("/c/broken.wav")).toBe(false);
    expect(player.state()).toBe("ready");
    expect(onError).toHaveBeenCalledTimes(1);
  });
  it("answers false when nothing can play", async () => {
    expect(await createSoundPlayer({ platform: "linux", path: null }).play("/c/done.wav")).toBe(
      false,
    );
  });
});

describe.runIf(process.platform === "darwin")(
  "the built addon on this Mac (a silent witness)",
  () => {
    it("plays a silent file through the system-sound path to its end", async () => {
      expect(
        existsSync(ADDON),
        `${ADDON}: build it with apps/desktop/packaging/build-sound-player.mjs`,
      ).toBe(true);
      const dir = mkdtempSync(join(tmpdir(), "vf-sound-witness-"));
      try {
        const file = join(dir, "silence.wav");
        const silence = new Float32Array(48_000 / 5);
        writeFileSync(file, encodeWav([silence, silence], 48_000));
        const player = createSoundPlayer({ platform: "darwin", path: ADDON });
        expect(player.state()).toBe("ready");
        expect(await player.play(file)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
