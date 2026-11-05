/**
 * smoke:godview's rung 11m (SP-1d, TH-1, TH-2; testing/smoke.ts), held in the source. The keyboard reaches Chat's draft
 * as every field in that smoke takes it: `sendInputEvent` runs none of Chromium's default actions, so a synthesized
 * press on the draft does not focus it: it blurs it to the body, where the frame stops every key under a cover
 * (`focusDeck`'s comment; run92b, 2026-11-01). The rung focuses the window and its contents first, then PLACES the focus
 * on the draft, and never presses it. Since TH-1 Send goes the send road (no pane, no Return pressed for it), and since
 * TH-2 the rung presses the head's Jump to after a split and focuses the shell's pane again before 11h.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const smoke = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "testing", "smoke.ts"),
  "utf8",
);

/** 11m's own rows in smoke.ts: from its heading to 11h's, which follows it. */
function rung11m(source: string): string {
  const start = source.indexOf("// 11m. CHAT'S THREAD AND COMPOSER");
  const end = source.indexOf("// 11h. THE LINE'S KEYS");
  if (start < 0 || end < start) throw new Error("no 11m before 11h in smoke.ts");
  return source.slice(start, end);
}

/** A press on the draft: `pressAt` aimed at `.vf-chat-input`. */
const PRESS_ON_DRAFT = /pressAt\(\s*["'`]\.vf-chat-input["'`]\s*\)/u;

describe("11m gives Chat's draft the keyboard as focusDeck gives a pane", () => {
  const rung = rung11m(smoke);

  it("never presses the draft for its focus: a synthesized press blurs it", () => {
    expect(PRESS_ON_DRAFT.test(rung)).toBe(false);
  });

  it("focuses the window and its contents, then places the focus in the draft, before the first key", () => {
    const window = rung.indexOf("win.focus();");
    const contents = rung.indexOf("win.webContents.focus();");
    const placed = rung.indexOf("executeJavaScript(PLACE_IN_DRAFT)");
    const typed = rung.indexOf("await typeKeys(nonce)");
    expect(window).toBeGreaterThanOrEqual(0);
    expect(contents).toBeGreaterThan(window);
    expect(placed).toBeGreaterThan(contents);
    expect(typed).toBeGreaterThan(placed);
  });

  it("would see a press on the draft if it were there (the scan is not blind)", () => {
    expect(PRESS_ON_DRAFT.test('        await pressAt(".vf-chat-input");\n')).toBe(true);
    expect(PRESS_ON_DRAFT.test('        await pressAt(".vf-chat-send");\n')).toBe(false);
  });
});

describe("11m on the send road, then the head's Jump to (TH-1; TH-2)", () => {
  const rung = rung11m(smoke);

  it("presses no Return for Send and pastes into no pane: fieldd delivers the line", () => {
    expect(rung).not.toContain('pressKeyOnce("Return")');
    expect(rung).not.toContain(".vf-chat-pane");
    expect(rung).not.toMatch(/startsWith\("Pasted into"\)/u);
  });

  it("splits the deck, presses Jump to in Chat, holds the deck to GV-D4's mirror, then focuses the shell again", () => {
    const split = rung.indexOf("pressChord(win, SPLIT_CHORD.key, SPLIT_CHORD.shift)");
    const press = rung.indexOf(`pressAt('.vf-chat-thread-acts button[data-act="jump"]')`);
    const mirrored = rung.indexOf(`mirroredInto("Chat's Jump to", split, jumped, floor)`);
    const refocus = rung.lastIndexOf("await focusPane(win, shell)");
    expect(split).toBeGreaterThanOrEqual(0);
    expect(press).toBeGreaterThan(split);
    expect(mirrored).toBeGreaterThan(press);
    expect(refocus).toBeGreaterThan(mirrored);
    // the spark's floor session is fieldd's word for its run, never the deck's
    expect(rung).toContain('opts.handle.client.request("agent.list", {})');
  });
});
