// @vitest-environment happy-dom
/**
 * DS-D4 (a) — A RUN A STOP HAS NOT STOPPED (DESIGN.md §8, §9), in pieces:
 *
 *   1. the words: nothing for a Stop only sent, sent again, heard, or in a
 *      stage this build does not know (the frame's own "Stopping the turn…"
 *      answers the press); **Ending** **the run** while fieldd ends a turn that
 *      did not stop; **Still** **running** with **End run** once fieldd will
 *      take the Stop no further
 *   2. the pane: the shipping view, a status region in the held-edge readout's
 *      figure, one row per state, and End run as its one act
 *   3. its stylesheet: item 42's recipe, the attention light, ink and danger
 *      text for Still running, the act the one pointer target, the entrance
 *      once from starting styles
 *
 * The controller over the deck's real facts, and End run reaching
 * `terminal.terminate` on the pane's own session, are rows of
 * `godview-deck-frames.test.tsx`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentStopState } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeStop, type StopPaneFace } from "../src/godview/pane-faces";
import { StopPaneStateView } from "../src/godview/StopPaneState";

const SENT_AT = "2026-10-31T06:00:00.000Z";
const UNHEARD_AT = "2026-10-31T06:00:06.000Z";

const stop = (overrides: Partial<AgentStopState> = {}): AgentStopState => ({
  sentAt: SENT_AT,
  stage: "sent",
  ...overrides,
});

describe("the words a stopping pane says (DESIGN.md §8, §9)", () => {
  it("says nothing for a Stop only sent or sent again: the frame's own verb answers the press", () => {
    expect(describeStop(undefined)).toBeUndefined();
    expect(describeStop(stop())).toBeUndefined();
    expect(describeStop(stop({ stage: "resent" }))).toBeUndefined();
  });

  it("says nothing for a Stop heard, by an exit or by its status: an exit shows as any exit", () => {
    expect(describeStop(stop({ stage: "heard", heardBy: "exit" }))).toBeUndefined();
    expect(describeStop(stop({ stage: "heard", heardBy: "status" }))).toBeUndefined();
  });

  it("takes a stage it does not know as still stopping, and says nothing for it", () => {
    expect(describeStop(stop({ stage: "paused" }))).toBeUndefined();
  });

  it("says Ending the run while fieldd ends a turn that did not stop", () => {
    expect(describeStop(stop({ stage: "terminating" }))).toEqual({
      state: "ending",
      word: "Ending",
      rest: "the run",
      caption: "it did not stop after two sends · ending it",
    });
  });

  it("says Still running, with End run, once fieldd will take the Stop no further", () => {
    const still: StopPaneFace = {
      state: "still-running",
      word: "Still",
      rest: "running",
      caption: "the stop was sent twice and not heard ·",
      act: "end-run",
    };
    // a run whose status cannot be read, after its second bound
    expect(describeStop(stop({ stage: "resent", unheardAt: UNHEARD_AT }))).toEqual(still);
    // a ladder that could not be placed
    expect(describeStop(stop({ stage: "terminating", unheardAt: UNHEARD_AT }))).toEqual(still);
  });

  it("never says interrupted, and never Stopped over a live pane", () => {
    for (const held of [
      stop({ stage: "terminating" }),
      stop({ stage: "resent", unheardAt: UNHEARD_AT }),
    ]) {
      const face = describeStop(held);
      const said = [face?.word, face?.rest, face?.caption].join(" ").toLowerCase();
      expect(said).not.toContain("interrupt");
      expect(said).not.toContain("stopped");
    }
  });
});

describe("the stopping pane (the shipping view)", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  async function mountView(face: StopPaneFace, onEndRun?: () => void): Promise<HTMLElement> {
    const element = document.createElement("div");
    document.body.append(element);
    container = element;
    root = createRoot(element);
    const mounted = root;
    await act(async () => mounted.render(<StopPaneStateView face={face} onEndRun={onEndRun} />));
    return element;
  }

  function faceOf(held: AgentStopState): StopPaneFace {
    const face = describeStop(held);
    if (face === undefined) throw new Error("this Stop has a face");
    return face;
  }

  afterEach(async () => {
    const mounted = root;
    root = null;
    if (mounted !== null) await act(async () => mounted.unmount());
    container?.remove();
    container = null;
  });

  const readout = (view: HTMLElement) => view.querySelector(".vf-godview-stop-state");

  it("draws Ending the run as a status region, the veil, bloom and glow for the eye, and no act", async () => {
    const view = await mountView(faceOf(stop({ stage: "terminating" })), vi.fn());
    const state = readout(view);
    expect(state?.getAttribute("role")).toBe("status");
    expect(state?.getAttribute("data-stop-state")).toBe("ending");
    for (const light of ["veil", "bloom", "glow"]) {
      expect(
        state?.querySelector(`.vf-godview-stop-state-${light}`)?.getAttribute("aria-hidden"),
      ).toBe("true");
    }
    expect(view.querySelector(".vf-godview-stop-state-word")?.textContent).toBe("Ending");
    expect(view.querySelector(".vf-godview-stop-state-rest")?.textContent).toBe("the run");
    expect(view.querySelector(".vf-godview-stop-state-caption")?.textContent).toBe(
      "it did not stop after two sends · ending it",
    );
    expect(view.querySelector("button")).toBeNull();
  });

  it("draws Still running with End run, the figure's one act, which ends the run once per press", async () => {
    const onEndRun = vi.fn();
    const view = await mountView(
      faceOf(stop({ stage: "resent", unheardAt: UNHEARD_AT })),
      onEndRun,
    );
    expect(readout(view)?.getAttribute("data-stop-state")).toBe("still-running");
    expect(view.querySelector(".vf-godview-stop-state-word")?.textContent).toBe("Still");
    expect(view.querySelector(".vf-godview-stop-state-rest")?.textContent).toBe("running");
    expect(view.querySelector(".vf-godview-stop-state-caption")?.textContent).toBe(
      "the stop was sent twice and not heard · End run",
    );
    const buttons = view.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    const endRun = buttons[0];
    expect(endRun?.getAttribute("type")).toBe("button");
    expect(endRun?.textContent).toBe("End run");
    await act(async () => endRun?.click());
    expect(onEndRun).toHaveBeenCalledTimes(1);
  });
});

describe("the stopping pane's stylesheet (DESIGN.md §8, §2.5, §2.7)", () => {
  // vitest loads no CSS: the rules are held here from the state's own block of the sheet
  const sheet = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/godview/godview.css"),
    "utf8",
  );
  const stopSheet = sheet.slice(
    sheet.indexOf("/* DS-D4 (a) — A RUN A STOP HAS NOT STOPPED"),
    sheet.indexOf("/* M49 — a deck piece behind its own boundary"),
  );
  /** A rule's body, by its whole selector at a line's start. */
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped} \\{([^}]*)\\}`, "m").exec(stopSheet)?.[1] ?? "";
  };

  it("is its own block, under the pane's frame, and takes no pointer but its act's", () => {
    expect(stopSheet.startsWith("/* DS-D4 (a)")).toBe(true);
    expect(stopSheet).not.toContain("item 42 — A SESSION");
    const state = rule(".vf-godview-stop-state");
    expect(state).toContain("z-index: 5;");
    expect(state).toContain("pointer-events: none;");
    expect(rule(".vf-godview-stop-state-act")).toContain("pointer-events: auto;");
  });

  it("draws item 42's figure: the veil, the words in text main, the rest at 40%, one caption line", () => {
    expect(rule(".vf-godview-stop-state-veil")).toContain(
      "background: color-mix(in srgb, var(--deck-ground) 62%, transparent);",
    );
    const words = rule(".vf-godview-stop-state-words");
    expect(words).toContain("font: 800 64px / 1 var(--vf-font-sans);");
    expect(words).toContain("color: var(--text-main);");
    expect(rule(".vf-godview-stop-state-rest")).toContain(
      "color: color-mix(in srgb, var(--text-main) 40%, transparent);",
    );
    const caption = rule(".vf-godview-stop-state-caption");
    expect(caption).toContain("font-size: 11px;");
    expect(caption).toContain("font-weight: 600;");
  });

  it("lights Ending in the pane colour and Still running in the attention fill, its caption in the attention ink", () => {
    expect(rule(".vf-godview-stop-state")).toMatch(/--pane-color: var\(\s*--ghostty-pane-color,/);
    expect(rule('.vf-godview-stop-state[data-stop-state="still-running"]')).toContain(
      "--pane-color: var(--vf-orange);",
    );
    expect(
      rule(
        '.vf-godview-stop-state[data-stop-state="still-running"] .vf-godview-stop-state-caption',
      ),
    ).toContain("color: var(--vf-monitor-ink-attention);");
  });

  it("says End run in the danger text, a text button in the caption's own type, and draws no ring", () => {
    const actRule = rule(".vf-godview-stop-state-act");
    expect(actRule).toContain("color: var(--vf-red);");
    expect(actRule).toContain("font: inherit;");
    expect(actRule).toContain("background: none;");
    expect(stopSheet).not.toMatch(/1\.5px/);
  });

  it("plays its entrance once from starting styles, never a keyframe, and under reduced motion fades the whole in 100ms", () => {
    expect(stopSheet).not.toMatch(/@keyframes|animation(-name)?\s*:/);
    expect(stopSheet).toContain("@starting-style {");
    expect(stopSheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.vf-godview-stop-state \{\s*transition: opacity 100ms ease;\s*\}/,
    );
    expect(stopSheet).toMatch(
      /\.vf-godview\[data-godview-animations="off"\] \.vf-godview-stop-state,\s*\.vf-godview\[data-godview-animations="off"\] \.vf-godview-stop-state \* \{\s*transition: none;\s*\}/,
    );
  });
});
