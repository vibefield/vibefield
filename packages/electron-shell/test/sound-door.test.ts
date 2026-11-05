/**
 * SD-2 — the window's two sound doors into main (contracts' IPC_CHANNELS soundAttention, soundPreview): narrow,
 * validated both ways, and only a registered window's main frame may knock. Attention is heard only from the
 * window in front (it is the person's, §14 rule 3); a Play in Settings answers played, or why not (§8).
 */
import type { SoundAttention } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSoundAttentionDoor, createSoundPreviewDoor } from "../src/main/sound-door";

type Sender = { id: number };
const OURS: Sender = { id: 1 };
const BEHIND: Sender = { id: 2 };
const STRANGER: Sender = { id: 9 };

describe("the attention door", () => {
  const door = () => {
    const accepted: SoundAttention[] = [];
    const knock = createSoundAttentionDoor<Sender>({
      owns: (s) => s === OURS || s === BEHIND,
      focused: (s) => s === OURS,
      accept: (a) => accepted.push(a),
    });
    return { knock, accepted };
  };
  it("takes the window in front's attention, as sent", () => {
    const d = door();
    d.knock(OURS, true, { focused: "pty-a", places: { "pty-a": -0.3 } });
    expect(d.accepted).toEqual([{ focused: "pty-a", places: { "pty-a": -0.3 } }]);
  });
  it("ignores a window behind, a stranger, a subframe, and anything that is not attention", () => {
    const d = door();
    d.knock(BEHIND, true, { focused: null, places: {} });
    d.knock(STRANGER, true, { focused: null, places: {} });
    d.knock(OURS, false, { focused: null, places: {} });
    d.knock(OURS, true, { focused: 3, places: {} });
    d.knock(OURS, true, { focused: null, places: { a: 7 } });
    d.knock(OURS, true, undefined);
    expect(d.accepted).toEqual([]);
  });
});

describe("the Play door (§8 'Settings → Sound')", () => {
  it("plays the cue asked for and answers what happened", async () => {
    const play = vi.fn(async () => ({ played: true as const }));
    const knock = createSoundPreviewDoor<Sender>({ owns: (s) => s === OURS, play });
    expect(await knock(OURS, true, { cue: "approval" })).toEqual({ played: true });
    expect(play).toHaveBeenCalledWith("approval");
  });
  it("answers why it did not play", async () => {
    const knock = createSoundPreviewDoor<Sender>({
      owns: () => true,
      play: async () => ({ played: false as const, reason: "off" as const }),
    });
    expect(await knock(OURS, true, { cue: "done" })).toEqual({ played: false, reason: "off" });
  });
  it("refuses a stranger, a subframe, the mark and a malformed ask, playing nothing", async () => {
    const play = vi.fn(async () => ({ played: true as const }));
    const knock = createSoundPreviewDoor<Sender>({ owns: (s) => s === OURS, play });
    await expect(knock(STRANGER, true, { cue: "done" })).rejects.toThrow();
    await expect(knock(OURS, false, { cue: "done" })).rejects.toThrow();
    await expect(knock(OURS, true, { cue: "mark" })).rejects.toThrow();
    await expect(knock(OURS, true, "done")).rejects.toThrow();
    expect(play).not.toHaveBeenCalled();
  });
});
