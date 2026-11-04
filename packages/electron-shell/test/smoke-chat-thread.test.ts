/**
 * smoke:godview's rung 11m (SP-1d; testing/smoke.ts): the keyboard reaches Chat's draft as every field in that smoke
 * takes it, held in the source. `sendInputEvent` runs none of Chromium's default actions, so a synthesized press on the
 * draft does not focus it: it blurs it to the body, where the frame stops every key under a cover (`focusDeck`'s
 * comment; run92b, 2026-11-01). The rung focuses the window and its contents first, then PLACES the focus on the draft,
 * and never presses it.
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
