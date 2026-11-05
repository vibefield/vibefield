/**
 * SD-2 — the desktop's sound as main composes it: an agent's sound, a Play in Settings → Sound (§8: it plays while
 * Quiet holds, and answers why when it cannot), the likeliest sound made ahead of need, and a harness that never makes
 * a sound. The player and the renders are stand-ins; nothing here is heard.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SoundPlayerState } from "@vibefield/contracts";
import { ENGINE_HASH } from "@vibefield/sound";
import { describe, expect, it } from "vitest";
import { createDesktopSound } from "../src/main/desktop-sound";
import { isStaleScoreFolder, pruneStaleScores, SoundRenders } from "../src/main/sound-renders";

function rig(
  opts: {
    state?: SoundPlayerState;
    sounds?: boolean | null;
    audible?: boolean;
    theme?: "light" | "dark";
    plays?: boolean;
  } = {},
) {
  const played: string[] = [];
  const asked: { cue: string; options: unknown }[] = [];
  const logged: string[] = [];
  const sound = createDesktopSound({
    player: {
      state: () => opts.state ?? "ready",
      play: async (file) => {
        played.push(file);
        return opts.plays ?? true;
      },
    },
    renders: {
      file: async (cue, options) => {
        asked.push({ cue, options });
        return `/cache/${cue}.wav`;
      },
    },
    theme: () => opts.theme ?? "light",
    preferences: () => (opts.sounds === null ? null : { sounds: opts.sounds ?? true }),
    audible: opts.audible ?? true,
    log: {
      info: (event) => logged.push(event),
      warn: (event) => logged.push(event),
    },
  });
  return { sound, played, asked, logged };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("an agent's sound", () => {
  it("is rendered, played, and said once in the log", async () => {
    const r = rig();
    r.sound.play("done", { space: "night", pan: 0.3 });
    await settle();
    expect(r.played).toEqual(["/cache/done.wav"]);
    expect(r.logged).toEqual(["desktop.sound.played"]);
  });
  it("is never heard in a harness: rendered nowhere, held and said", async () => {
    const r = rig({ audible: false });
    r.sound.play("approval", {});
    await settle();
    expect(r.played).toEqual([]);
    expect(r.asked).toEqual([]);
    expect(r.logged).toEqual(["desktop.sound.held"]);
  });
  it("asks nothing of a player that cannot play", async () => {
    const r = rig({ state: "missing" });
    r.sound.play("done", {});
    await settle();
    expect(r.asked).toEqual([]);
  });
});

describe("a Play in Settings → Sound (§8)", () => {
  it("plays centred, in the theme's space, through the agents' path", async () => {
    const r = rig({ theme: "dark" });
    expect(await r.sound.preview("question")).toEqual({ played: true });
    expect(r.asked).toEqual([{ cue: "question", options: { space: "night", profile: "desktop" } }]);
  });
  it("answers off while Play sounds is off, or before the preferences are read", async () => {
    expect(await rig({ sounds: false }).sound.preview("done")).toEqual({
      played: false,
      reason: "off",
    });
    expect(await rig({ sounds: null }).sound.preview("done")).toEqual({
      played: false,
      reason: "off",
    });
  });
  it("answers unavailable with no player, and in a harness", async () => {
    for (const r of [rig({ state: "unsupported" }), rig({ audible: false })]) {
      expect(await r.sound.preview("done")).toEqual({ played: false, reason: "unavailable" });
      expect(r.played).toEqual([]);
    }
  });
  it("answers failed when the system would not play it", async () => {
    expect(await rig({ plays: false }).sound.preview("done")).toEqual({
      played: false,
      reason: "failed",
    });
  });
});

describe("the likeliest sound, made ahead of need", () => {
  it("is Done in the theme's space, centred, once a launch, and never played", async () => {
    const r = rig({ theme: "dark" });
    r.sound.prepare();
    r.sound.prepare();
    await settle();
    expect(r.asked).toEqual([{ cue: "done", options: { space: "night", profile: "desktop" } }]);
    expect(r.played).toEqual([]);
  });
  it("waits for the preferences, and for Play sounds", async () => {
    for (const sounds of [null, false] as const) {
      const r = rig({ sounds });
      r.sound.prepare();
      await settle();
      expect(r.asked, String(sounds)).toEqual([]);
    }
  });
  it("is made on a Mac whose player would not start (the worker's witness either way), never off macOS", async () => {
    const failed = rig({ state: "failed" });
    failed.sound.prepare();
    const off = rig({ state: "unsupported" });
    off.sound.prepare();
    await settle();
    expect(failed.asked).toHaveLength(1);
    expect(off.asked).toEqual([]);
  });
  it("is made in a harness too: a smoke renders, and only never plays", async () => {
    const r = rig({ audible: false });
    r.sound.prepare();
    await settle();
    expect(r.asked).toHaveLength(1);
  });
});

describe("the renders say what each ask found", () => {
  it("rendered, with how long it took, then found", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-sound-renders-"));
    try {
      const events: unknown[] = [];
      let t = 1000;
      const renders = new SoundRenders({
        dir,
        render: async () => {
          t += 140;
          return Uint8Array.from([1, 2, 3]);
        },
        onFile: (event) => events.push(event),
        now: () => t,
      });
      const file = await renders.file("done", { space: "day" });
      expect(readdirSync(join(dir, ENGINE_HASH))).toEqual([file.split("/").at(-1)]);
      await renders.file("done", { space: "day" });
      expect(events).toEqual([
        { cue: "done", key: expect.any(String), outcome: "rendered", ms: 140 },
        { cue: "done", key: expect.any(String), outcome: "found", ms: 0 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("prunes what older scores left (named as a score is) and nothing else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-sound-prune-"));
    try {
      for (const name of [ENGINE_HASH, "0badf00d", "notes", "ABCDEF12"]) {
        mkdirSync(join(dir, name));
      }
      writeFileSync(join(dir, "1234abcd"), "a file, not a folder");
      expect([...(await pruneStaleScores(dir))].sort()).toEqual(["0badf00d", "1234abcd"]);
      expect(readdirSync(dir).sort()).toEqual([ENGINE_HASH, "ABCDEF12", "notes"].sort());
      expect(isStaleScoreFolder(ENGINE_HASH)).toBe(false);
      expect(await pruneStaleScores(join(dir, "nowhere"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
