/**
 * smoke:godview's shell markers and the routed input gate, the parts a test can hold (testing/smoke-shell-marker.ts):
 * what a wait for a shell marker says when it ends without one — "never created" told apart from "created empty" — a
 * session's input gate read off the direct-terminal markers, and 11h's card play: its judge and its line of evidence.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CARD_PLAY_EVIDENCE,
  type CardPlaySeen,
  cardPlayEvidenceLine,
  gateOpen,
  judgeCardPlay,
  latestGate,
  markerFile,
  newCardPlayEvidence,
  shellMarkerFailure,
} from "../src/testing/smoke-shell-marker";

let dir: string | null = null;
const scratch = (): string => {
  dir ??= mkdtempSync(join(tmpdir(), "vf-shell-marker-"));
  return dir;
};
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("a shell marker's file, as the disk holds it", () => {
  it("tells a file never created from one created empty, and counts the bytes of any other", () => {
    const absent = join(scratch(), "absent.txt");
    const empty = join(scratch(), "empty.txt");
    const other = join(scratch(), "other.txt");
    writeFileSync(empty, "");
    writeFileSync(other, "not the nonce\n");
    expect(markerFile(absent)).toEqual({ exists: false });
    expect(markerFile(empty)).toEqual({ exists: true, bytes: 0 });
    expect(markerFile(other)).toEqual({ exists: true, bytes: 14 });
  });
});

describe("what the wait says when it ends without the marker", () => {
  const path = "/tmp/fr2abc.txt";

  it("never created: the shell ran no line with that redirect", () => {
    const message = shellMarkerFailure(path, { exists: false }, "fr2abc");
    expect(message).toMatch(/^the routed pane did not create \/tmp\/fr2abc\.txt/);
    expect(message).toContain("the file does not exist");
  });

  it("created empty: a line with that redirect ran, and its command printed nothing", () => {
    const message = shellMarkerFailure(path, { exists: true, bytes: 0 }, "fr2abc");
    expect(message).not.toContain("did not create");
    expect(message).toContain("/tmp/fr2abc.txt");
    expect(message).toContain("exists and is empty (0 bytes)");
    expect(message).toContain("fr2abc");
  });

  it("created with other words: the bytes it holds, without the marker", () => {
    const message = shellMarkerFailure(path, { exists: true, bytes: 14 }, "fr2abc");
    expect(message).not.toContain("did not create");
    expect(message).toContain("holds 14 bytes without it");
  });

  it("with no marker asked for, a file that is not there is the only failure", () => {
    expect(shellMarkerFailure(path, { exists: false })).toMatch(
      /^the routed pane did not create \/tmp\/fr2abc\.txt/,
    );
  });
});

describe("a session's input gate, from the direct-terminal markers", () => {
  const facts = (sessionId: string, presentationReady: boolean, inputAllowed: boolean) => ({
    sessionId,
    activationId: "a",
    phase: presentationReady ? "presenting" : "recovering",
    presentationReady,
    inputAllowed,
  });

  it("reads the session's own latest marker, never a later one of another pane", () => {
    const history = [
      facts("aimed", true, true),
      facts("aimed", false, false),
      facts("other", true, true),
    ];
    expect(latestGate(history, "aimed")).toEqual(facts("aimed", false, false));
    expect(gateOpen(latestGate(history, "aimed"))).toBe(false);
    expect(gateOpen(latestGate(history, "other"))).toBe(true);
  });

  it("is not open for a session no marker names, nor while it presents with input closed", () => {
    expect(latestGate([], "aimed")).toBeNull();
    expect(gateOpen(null)).toBe(false);
    expect(gateOpen(facts("aimed", true, false))).toBe(false);
    expect(gateOpen(facts("aimed", false, true))).toBe(false);
  });
});

describe("11h's card play, as the hand's lab door answers it (R-T 2)", () => {
  const pasted: CardPlaySeen = {
    at: { x: 590, y: 380 },
    target: "pane",
    answer: { ok: true, label: "Paste into vibe-field" },
    played: { ok: true, note: "Pasted into vibe-field" },
    refused: null,
  };

  it("passes a card the deck's pane answered and pasted", () => {
    expect(judgeCardPlay(pasted)).toEqual([]);
  });

  it("names no answer, a play that never reached a place, a place that is not a pane, and an outcome that is no paste", () => {
    expect(judgeCardPlay(null)).toEqual(["the hand's lab door answered nothing"]);
    const covered = "no place takes a card there — div.vf-cover is on top";
    const unplayed = { ...pasted, target: null, answer: null, played: null, refused: covered };
    expect(judgeCardPlay(unplayed)).toEqual([`nothing was played: ${covered}`]);
    const placed = { ...pasted, target: "desk", played: { ok: true, note: "Placed as a note" } };
    expect(judgeCardPlay(placed)).toEqual([
      "the place that took the card is desk, not a pane",
      'the play said "Placed as a note"',
    ]);
    const closed = "Not pasted — vibe-field's pane is not taking input";
    expect(judgeCardPlay({ ...pasted, played: { ok: false, note: closed } })).toEqual([
      `the play said ${JSON.stringify(closed)}`,
    ]);
  });

  it("prints ONE line of evidence when its rung fails: the cause, the file, the samples, the play, the gate now", () => {
    const evidence = newCardPlayEvidence("s-active", "/tmp/hn4abc.txt");
    evidence.inputAllowed.play = true;
    evidence.play = pasted;
    const cause = new Error("the routed pane did not create /tmp/hn4abc.txt");
    const line = cardPlayEvidenceLine(evidence, cause, { exists: false }, null);
    expect(line.startsWith(CARD_PLAY_EVIDENCE)).toBe(true);
    expect(JSON.parse(line.slice(CARD_PLAY_EVIDENCE.length))).toEqual({
      failed: "the routed pane did not create /tmp/hn4abc.txt",
      session: "s-active",
      file: { path: "/tmp/hn4abc.txt", exists: false },
      inputAllowed: { play: true, Return: null },
      play: pasted,
      waitedMs: { inputBeforeReturn: null },
      gateNow: null,
    });
  });
});
