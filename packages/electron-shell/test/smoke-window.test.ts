/**
 * DK-18 (plan (36)) — the desk smokes keep their windows from the person's input (testing/smoke-window.ts): each window is
 * made by `smokeWindow` (shown inactive, click-through) and NO row makes one the key window (`win.focus()` activates the
 * app, and the person's keys follow it) — the smoke's keys go in by `sendInputEvent`, which needs no key window, and KEYS
 * witnesses that event-less focus path. Held in the source: the desk smokes' runners and their row modules.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testing = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "testing");
const read = (file: string): string => readFileSync(join(testing, file), "utf8");

/** The desk smokes' row modules — everything smoke:canvas, smoke:kind-faults and smoke:plugin-restart drive. */
const ROWS = [
  "smoke-covers.ts",
  "smoke-desk-rig.ts",
  "smoke-pegboard.ts",
  "smoke-peers.ts",
  "smoke-rest.ts",
  "smoke-selection-bar.ts",
  "smoke-send-to.ts",
  "smoke-thumb.ts",
  "smoke-tools-in-hand.ts",
  "smoke-try.ts",
  "smoke-unavailable.ts",
];

/** A runner's own body in smoke.ts: from its declaration to the next top-level declaration. */
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`no ${name} in smoke.ts`);
  const next = source.slice(start + 1).search(/\n(?:export )?(?:async )?function /u);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/** A window made the key window: `<window>.focus()` — never a DOM element's (`document.querySelector(…).focus()`). */
const FOCUS = /\b(?:win|a|b|peer|primary|auxiliary|window|w)\.focus\(\)/u;

describe("the desk smokes keep their windows from the person's input", () => {
  const smoke = read("smoke.ts");
  const runners = ["runSmokeCanvas", "runSmokePluginRestart"].map(
    (name) => [name, body(smoke, name)] as const,
  );

  it("make every window of theirs through smokeWindow — inactive and click-through", () => {
    for (const [name, text] of runners) {
      expect(text, name).toContain("smokeWindow(");
      expect(text, name).not.toContain("createMainWindow(");
    }
  });

  it("never make a window the key window — in the runners or in any row", () => {
    for (const [name, text] of runners) expect(FOCUS.test(text), name).toBe(false);
    for (const file of ROWS) expect(FOCUS.test(read(file)), file).toBe(false);
  });

  it("would see one if it were there (the scan is not blind)", () => {
    expect(FOCUS.test("    b.focus();\n")).toBe(true);
    expect(FOCUS.test('await js(`document.querySelector(".vf-line-input")?.focus()`)')).toBe(false);
  });
});
