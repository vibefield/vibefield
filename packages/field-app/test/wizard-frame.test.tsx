// @vitest-environment happy-dom
/**
 * Track FG, FG-4b — the Setup Assistant's frame (wizard-ui.tsx's PaneSwap; DESIGN.md §6 and §8 "The Setup
 * Assistant's glass"; VF-PM 2026-10-31 05:42Z): it swaps on a pane's face, watching its own children; a hold that has
 * begun to show stands its floor; the logo shows while a hold stands. And a hold's own parts: its line's crossfade
 * (`WizardStatus`) and its way out (`WizardHoldOut`). happy-dom runs no animations, so the rows stub `animate` and
 * record what the frame asks of it, on a fake clock (vitest fakes `performance.now` with the timers); its
 * MutationObserver answers in a microtask, which an async act waits for, and each swap is also delivered by hand
 * (`observeFrames`), since happy-dom can lose an observer to a collection.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crossfade,
  leavingFrames,
  WizardHold,
  WizardHoldOut,
  WizardPane,
  WizardShellView,
  WizardStatus,
} from "../src/boot/onboarding/wizard-ui";
import { ease } from "../src/boot/splash/field-mark";
import { type FrameObservers, observeFrames } from "./wizard-frame-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WIZARD_CSS = readFileSync(join(process.cwd(), "src/boot/onboarding/wizard-ui.css"), "utf8");
const REDUCED = WIZARD_CSS.slice(WIZARD_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));

/** What the frame asked `animate` for: the root's face (happy-dom hands `animate` a form's own object, not the proxy
 * a query returns, so a row reads the face), whether it is a leaving copy, and its timing. */
interface Played {
  readonly face: string | null;
  readonly leaving: boolean;
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
}

let played: Played[] = [];
let ends: (() => void)[] = [];
let host: HTMLDivElement | null = null;
let root: Root | null = null;
let heard: FrameObservers | null = null;

function stubAnimate(): void {
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      played.push({
        face: this.getAttribute("data-face"),
        leaving: this.classList.contains("vf-wizard-pane-leaving"),
        keyframes,
        options,
      });
      return {
        finished: new Promise<void>((resolve) => {
          ends.push(resolve);
        }),
      };
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  played = [];
  ends = [];
  stubAnimate();
  heard = observeFrames();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  heard = null;
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Step {
  readonly paneKey: string;
  readonly content: ReactNode;
}

let show: (step: Step) => void = () => undefined;

/** The glass on the field (Finish setting up's sheet on the app), its frame showing what the row says. */
function Stage({ first, size }: { first: Step; size: "glass" | "sheet" }): ReactElement {
  const [step, setStep] = useState(first);
  show = setStep;
  return (
    <WizardShellView
      dark={false}
      onToggleTheme={() => undefined}
      ground={size === "glass" ? "field" : "app"}
      size={size}
      paneKey={step.paneKey}
    >
      {step.content}
    </WizardShellView>
  );
}

async function mount(first: Step, size: "glass" | "sheet" = "glass"): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => created.render(<Stage first={first} size={size} />));
}

/** The next step, and the frame's answer to it: its observer's microtask, inside the act, and the same news by hand. */
async function to(step: Step): Promise<void> {
  await act(async () => show(step));
  heard?.hear();
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const logo = (): boolean =>
  host?.querySelector(".vf-wizard-shell")?.getAttribute("data-logo") === "shown";
const copies = (): HTMLElement[] =>
  Array.from(host?.querySelectorAll<HTMLElement>(".vf-wizard-pane-leaving") ?? []);

function pane(paneKey: string, words = paneKey): Step {
  return {
    paneKey,
    content: (
      <WizardPane eyebrow="Step" title={words} actions={<button type="submit">Continue</button>} />
    ),
  };
}

function hold(paneKey: string, face: string, line = "Looking…"): Step {
  return {
    paneKey,
    content: (
      <WizardHold face={face}>
        <WizardStatus line={line} />
      </WizardHold>
    ),
  };
}

const IN = [{ opacity: 0 }, { opacity: 1 }];
const OUT = [{ opacity: 1, easing: "ease" }, { opacity: 0 }];

describe("the frame (FG-4b)", () => {
  it("brings the first pane in with the glass, and a first hold's logo with it", async () => {
    await mount(hold("deriving", "deriving"));
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({ face: "deriving", leaving: false, keyframes: IN });
    expect(played[0]?.options).toEqual({
      duration: 240,
      delay: 0,
      easing: "ease",
      fill: "backwards",
    });
    expect(logo()).toBe(true);
  });

  it("fades a pane out before a hold comes, and shows the logo as the hold's words come", async () => {
    await mount(pane("you"));
    expect(logo()).toBe(false);
    wait(1_000);
    await to(hold("agents", "agents:looking"));
    expect(played.map(({ face, leaving }) => [face, leaving])).toEqual([
      ["you", false],
      ["you", true],
      ["agents:looking", false],
    ]);
    // the pane leaves as a still copy, whole, out over 120ms; the hold waits under it, then comes in over 240ms
    expect(played[1]?.keyframes).toEqual(OUT);
    expect(played[1]?.options).toEqual({ duration: 120, fill: "forwards" });
    expect(played[2]?.options).toMatchObject({ duration: 240, delay: 120, fill: "backwards" });
    const [copy] = copies();
    expect(copy?.hasAttribute("inert")).toBe(true);
    expect(copy?.getAttribute("aria-hidden")).toBe("true");
    expect(copy?.style.getPropertyValue("--vf-wizard-age")).toBe("1000ms");
    // the logo comes as the hold's words do, once the pane is out
    wait(119);
    expect(logo()).toBe(false);
    wait(1);
    expect(logo()).toBe(true);
    // the copy goes when its fade ends
    await act(async () => {
      for (const end of ends) end();
    });
    expect(copies()).toHaveLength(0);
  });

  it("shows no hold for a load answered before the old pane has gone: no copy of it, and no logo", async () => {
    await mount(pane("you"));
    wait(1_000);
    await to(hold("agents", "agents:looking"));
    wait(50);
    await to(pane("profiles"));
    // the hold never began its fade in, so it leaves no copy, and the next pane follows the one before it
    expect(played.map(({ face, leaving }) => [face, leaving])).toEqual([
      ["you", false],
      ["you", true],
      ["agents:looking", false],
      ["profiles", false],
    ]);
    expect(played[3]?.options).toMatchObject({ duration: 240, delay: 70 });
    wait(2_000);
    expect(logo()).toBe(false);
  });

  it("stands a hold that has begun to show for its floor, 800ms from its fade in, its copy whole until then", async () => {
    await mount(pane("you"));
    wait(1_000);
    await to(hold("agents", "agents:looking"));
    // its fade in began at 120; 180 into it, the load answers
    wait(300);
    expect(logo()).toBe(true);
    await to(pane("profiles"));
    const copy = played[3];
    expect(copy).toMatchObject({ face: "agents:looking", leaving: true });
    // from where its fade had come, whole by the fade's end, whole to its floor (800 after its fade in began), then out
    expect(copy?.options).toEqual({ duration: 740, fill: "forwards" });
    expect(copy?.keyframes).toEqual([
      { offset: 0, opacity: ease(180 / 240), easing: "ease-out" },
      { offset: 60 / 740, opacity: 1 },
      { offset: 620 / 740, opacity: 1, easing: "ease" },
      { offset: 1, opacity: 0 },
    ]);
    // the logo stays to the floor and goes as the words do; the pane waits for the logo's 280 after them
    expect(played[4]).toMatchObject({ face: "profiles", leaving: false });
    expect(played[4]?.options).toMatchObject({ delay: 620 + 280 });
    wait(619);
    expect(logo()).toBe(true);
    wait(1);
    expect(logo()).toBe(false);
  });

  it("keeps the logo from one hold to the next, the next words waiting only for the last", async () => {
    await mount(hold("deriving", "deriving", "Reading what this field already knows…"));
    wait(1_000);
    await to({
      paneKey: "welcome",
      content: (
        <WizardHold face="welcome" card>
          <h1>Welcome.</h1>
        </WizardHold>
      ),
    });
    expect(played.map(({ face, leaving }) => [face, leaving])).toEqual([
      ["deriving", false],
      ["deriving", true],
      ["welcome", false],
    ]);
    expect(played[2]?.options).toMatchObject({ delay: 120 });
    expect(logo()).toBe(true);
    wait(2_000);
    expect(logo()).toBe(true);
  });

  it("carries one face from one root to the next without a fade: a load's fallback, then the view it waited for", async () => {
    function Fallback(): ReactElement {
      return (
        <WizardHold face="agents:looking">
          <WizardStatus line="Looking on this Mac…" />
        </WizardHold>
      );
    }
    function View(): ReactElement {
      return (
        <WizardHold face="agents:looking">
          <WizardStatus line="Looking on this Mac…" />
        </WizardHold>
      );
    }
    await mount(pane("you"));
    wait(1_000);
    await to({ paneKey: "agents", content: <Fallback /> });
    const fallback = host?.querySelector("form.vf-wizard-hold");
    // 80 into its fade in, the view takes its place, its fade resumed where the fallback's stood
    wait(200);
    await to({ paneKey: "agents", content: <View /> });
    expect(host?.querySelector("form.vf-wizard-hold")).not.toBe(fallback);
    // no copy of the face: the only one is You's, from the swap before
    expect(copies().map((copy) => copy.dataset.face)).toEqual(["you"]);
    expect(played.map(({ face, leaving }) => [face, leaving])).toEqual([
      ["you", false],
      ["you", true],
      ["agents:looking", false],
      ["agents:looking", false],
    ]);
    expect(played[3]?.options).toMatchObject({ duration: 240, delay: -80 });
    // once its fade in is over, a new root of the face needs none
    wait(1_000);
    await to({ paneKey: "agents", content: <Fallback /> });
    expect(played).toHaveLength(4);
    expect(logo()).toBe(true);
  });

  it("watches its own children, and never swaps for a pane's own changes: the same face redrawn", async () => {
    await mount(pane("you", "James"));
    expect(heard?.watches().map(({ target, options }) => [target.className, options])).toEqual([
      ["vf-wizard-frame", { childList: true }],
    ]);
    await to(pane("you", "Jam"));
    expect(host?.querySelector("h1")?.textContent).toBe("Jam");
    expect(played).toHaveLength(1);
    expect(copies()).toHaveLength(0);
  });

  it("halves its fades under reduced motion, and the logo's lead with them", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    await mount(pane("you"));
    wait(1_000);
    await to(hold("agents", "agents:looking"));
    expect(played[1]?.options).toEqual({ duration: 60, fill: "forwards" });
    expect(played[2]?.options).toMatchObject({ duration: 160, delay: 60 });
    wait(1_000);
    await to(pane("profiles"));
    expect(played[4]?.options).toMatchObject({ duration: 160, delay: 120 });
  });

  it("swaps at once where the host cannot animate, the logo keeping its time", async () => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    await mount(pane("you"));
    wait(1_000);
    await to(hold("agents", "agents:looking"));
    expect(copies()).toHaveLength(0);
    expect(host?.querySelectorAll(".vf-wizard-frame > *")).toHaveLength(1);
    expect(logo()).toBe(false);
    wait(120);
    expect(logo()).toBe(true);
  });

  it("resumes each timed part of a leaving hold as old as it was: the hold, its way out, its line", async () => {
    const opening = (line: string): Step => ({
      paneKey: "devices",
      content: (
        <WizardHold face="connect:opening">
          <WizardStatus line={line} />
          <WizardHoldOut>
            <button type="button">Cancel</button>
          </WizardHoldOut>
        </WizardHold>
      ),
    });
    await mount(pane("history"));
    wait(1_000);
    await to(opening("Opening Tailscale…"));
    wait(2_000);
    await to(opening("Joining your network…"));
    wait(100);
    await to(pane("setting-up"));
    const copy = copies().find((leaving) => leaving.dataset.face === "connect:opening");
    expect(copy?.style.getPropertyValue("--vf-wizard-age")).toBe("2100ms");
    const age = (selector: string): string | undefined =>
      copy?.querySelector<HTMLElement>(selector)?.style.getPropertyValue("--vf-wizard-age");
    expect(age(".vf-wizard-hold-out")).toBe("2100ms");
    expect(age('.vf-wizard-status-words[data-state="in"]')).toBe("100ms");
    expect(age('.vf-wizard-status-words[data-state="out"]')).toBe("100ms");
  });

  it("never swaps in the sheet, which keeps its panes as they stood (FG-D26)", async () => {
    await mount(pane("agents"), "sheet");
    await to(pane("history"));
    expect(heard?.watches()).toEqual([]);
    expect(played).toHaveLength(0);
    expect(host?.querySelector(".vf-wizard-shell")?.hasAttribute("data-logo")).toBe(false);
    expect(host?.querySelector(".vf-wizard-shell .vf-wizard-logo")).toBeNull();
  });
});

describe("a leaving pane's opacity (`leavingFrames`)", () => {
  it("fades out from where it stands when it may go at once", () => {
    expect(leavingFrames(1, 240, 1_000, 1_000, 120)).toEqual({
      keyframes: [{ opacity: 1, easing: "ease" }, { opacity: 0 }],
      duration: 120,
    });
    expect(leavingFrames(0.4, 1_100, 1_000, 1_000, 60).keyframes[0]).toEqual({
      opacity: 0.4,
      easing: "ease",
    });
  });

  it("comes in whole, stands whole to its floor, then goes, all as one fade", () => {
    expect(leavingFrames(0.25, 1_100, 1_800, 1_000, 120)).toEqual({
      keyframes: [
        { offset: 0, opacity: 0.25, easing: "ease-out" },
        { offset: 100 / 920, opacity: 1 },
        { offset: 800 / 920, opacity: 1, easing: "ease" },
        { offset: 1, opacity: 0 },
      ],
      duration: 920,
    });
    // a fade in already over stands whole from the start
    expect(leavingFrames(1, 900, 1_800, 1_000, 120).keyframes[1]).toEqual({
      offset: 0,
      opacity: 1,
    });
  });
});

describe("a hold's line (`WizardStatus`)", () => {
  interface Words {
    readonly line: string;
    readonly sub?: string;
    readonly ink?: boolean;
  }
  let say: (words: Words) => void = () => undefined;
  function Speaker({ first }: { first: Words }): ReactElement {
    const [words, setWords] = useState(first);
    say = setWords;
    return <WizardStatus {...words} />;
  }
  async function speak(first: Words): Promise<void> {
    host = document.createElement("div");
    document.body.append(host);
    const created = createRoot(host);
    root = created;
    await act(async () => created.render(<Speaker first={first} />));
  }
  const units = (): { state: string | null; line: string; sub: string; style: string }[] =>
    Array.from(host?.querySelectorAll<HTMLElement>(".vf-wizard-status-words") ?? [], (unit) => ({
      state: unit.getAttribute("data-state"),
      line: unit.querySelector(".vf-wizard-status-line")?.textContent ?? "",
      sub: unit.querySelector(".vf-wizard-status-sub")?.textContent ?? "",
      style: unit.getAttribute("style") ?? "",
    }));

  it("stands its first words at once, with the hold, as a status", async () => {
    await speak({ line: "Opening your field…", sub: "drawing the board" });
    expect(host?.querySelector(".vf-wizard-status")?.getAttribute("role")).toBe("status");
    expect(units()).toEqual([
      { state: null, line: "Opening your field…", sub: "drawing the board", style: "" },
    ]);
  });

  it("counts a new sub in place: nothing leaves", async () => {
    await speak({ line: "Discovering conversations…", sub: "1,215 files checked" });
    await act(async () => say({ line: "Discovering conversations…", sub: "1,216 files checked" }));
    expect(units()).toEqual([
      { state: null, line: "Discovering conversations…", sub: "1,216 files checked", style: "" },
    ]);
  });

  it("crossfades a new line in its cell: the words standing leave from where they stood, the next come after", async () => {
    await speak({ line: "Opening your field…", sub: "settling" });
    wait(500);
    await act(async () => say({ line: "Finding your history…" }));
    expect(units().map(({ state, line, sub }) => [state, line, sub])).toEqual([
      ["out", "Opening your field…", "settling"],
      ["in", "Finding your history…", ""],
    ]);
    const leaving = host?.querySelector<HTMLElement>('[data-state="out"]');
    expect(leaving?.getAttribute("aria-hidden")).toBe("true");
    expect(leaving?.style.getPropertyValue("--vf-wizard-from")).toBe("1");
    // the next line arrives with its own wait, none of it spent
    expect(host?.querySelector<HTMLElement>('[data-state="in"]')?.hasAttribute("style")).toBe(
      false,
    );
    // the words leaving go when their fade ends
    await act(async () => {
      leaving?.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(units().map(({ state }) => state)).toEqual(["in"]);
  });

  it("never shows words followed before they began to show: the next take their place, and the last go on leaving", async () => {
    await speak({ line: "Discovering conversations…", sub: "5,912 files checked" });
    wait(2_000);
    await act(async () => say({ line: "4,441 sessions found in 74 projects" }));
    wait(30);
    await act(async () => say({ line: "Welcome to your field, james.", ink: true }));
    expect(units().map(({ state, line }) => [state, line])).toEqual([
      ["out", "Discovering conversations…"],
      ["in", "Welcome to your field, james."],
    ]);
    // its wait goes on from where the words it replaced had come to
    const standing = host?.querySelector<HTMLElement>('[data-state="in"]');
    expect(standing?.style.getPropertyValue("--vf-wizard-ahead")).toBe("30ms");
    expect(standing?.getAttribute("data-ink")).toBe("true");
  });

  it("lets words caught in their fade in leave from the opacity they had come to", async () => {
    await speak({ line: "Finding your history…" });
    wait(500);
    await act(async () => say({ line: "Discovering conversations…", sub: "12 files checked" }));
    // 140 waited, then 120 of the 240 fade in
    wait(260);
    await act(async () => say({ line: "Opening your field…" }));
    const leaving = host?.querySelector<HTMLElement>('[data-state="out"]');
    expect(leaving?.querySelector(".vf-wizard-status-line")?.textContent).toBe(
      "Discovering conversations…",
    );
    expect(Number(leaving?.style.getPropertyValue("--vf-wizard-from"))).toBeCloseTo(ease(0.5), 10);
  });

  it("decides each step of the crossfade by its own clock (`crossfade`)", () => {
    const words = (line: string) => ({ line, sub: undefined, ink: false });
    const first = {
      standing: { ...words("A"), at: 0, ahead: 0 },
      leaving: null,
      moved: false,
      leaves: 0,
    };
    const full = { out: 140, in: 240 } as const;
    // the first words stood whole: they leave from 1
    const second = crossfade(first, words("B"), 10, full);
    expect(second.leaving).toMatchObject({ line: "A", from: 1, at: 10, key: 1 });
    expect(second.standing).toMatchObject({ line: "B", at: 10, ahead: 0 });
    // B never showed: C takes its place 100 in, and A goes on leaving
    const third = crossfade(second, words("C"), 110, full);
    expect(third.leaving).toBe(second.leaving);
    expect(third.standing).toMatchObject({ line: "C", at: 110, ahead: 100 });
    // C's fade in is 60 of 240 along when D comes: it leaves from there
    const fourth = crossfade(third, words("D"), 210, full);
    expect(fourth.leaving).toMatchObject({ line: "C", key: 2 });
    expect(fourth.leaving?.from).toBeCloseTo(ease(60 / 240), 10);
    // halved and more under reduced motion: 60 to wait
    const reduced = { out: 60, in: 120 } as const;
    expect(crossfade(second, words("C"), 69, reduced).standing.ahead).toBe(59);
    expect(crossfade(second, words("C"), 70, reduced).leaving).toMatchObject({ line: "B" });
  });
});

describe("a hold's way out (`WizardHoldOut`)", () => {
  it("hides itself for 6s from when it came, or not at all where its load has waited already (Start now)", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const created = createRoot(host);
    root = created;
    const born = performance.now();
    await act(async () =>
      created.render(
        <>
          <WizardHoldOut>
            <button type="button">Continue</button>
          </WizardHoldOut>
          <WizardHoldOut now>
            <button type="button">Start now</button>
          </WizardHoldOut>
        </>,
      ),
    );
    const [late, now] = Array.from(host.querySelectorAll<HTMLElement>(".vf-wizard-hold-out"));
    expect(late?.getAttribute("data-late")).toBe("true");
    expect(now?.hasAttribute("data-late")).toBe(false);
    expect(Number(late?.dataset.born)).toBe(born);
  });
});

describe("the hold's and the logo's stylesheet (DESIGN.md §8, FG-4b)", () => {
  it("spans the glass, its rows the logo's, its words 26 under the logo and the title card's 30", () => {
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-hold \{\s*position: absolute;\s*inset: -96px -160px -40px;\s*display: grid;\s*margin: 0;\s*padding: 0 160px;\s*grid-template-rows: minmax\(0, 1fr\) var\(--vf-wizard-logo-height\) minmax\(0, 1fr\);\s*text-align: center;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-hold-words \{[^}]*align-items: center;\s*padding-top: 26px;\s*grid-row: 3;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-hold\[data-hold="card"\] \.vf-wizard-hold-words \{\s*padding-top: 30px;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-hold-voice \{\s*max-width: 420px;\s*margin: 10px 0 0;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-hold-actions \{[^}]*gap: 8px;\s*margin-top: 28px;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(/\n\.vf-wizard-hold-why \{\s*max-width: 360px;\s*margin: 0;\s*\}/u);
  });

  it("hides a way out, taking no focus and no press, until its load has run 6s, then fades it in", () => {
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-hold-out \{[^}]*gap: 8px;\s*margin-top: 18px;\s*animation: vf-wizard-late 240ms ease both;\s*animation-delay: calc\(0ms - var\(--vf-wizard-age, 0ms\)\);\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-hold-out\[data-late="true"\] \{\s*animation-delay: calc\(6s - var\(--vf-wizard-age, 0ms\)\);\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /@keyframes vf-wizard-late \{\s*from \{\s*opacity: 0;\s*visibility: hidden;\s*\}\s*\}/u,
    );
    expect(REDUCED).toMatch(/\.vf-wizard-hold-out \{\s*animation-duration: 120ms;\s*\}/u);
  });

  it("draws the logo as the field's mark at the window's centre, faded by the shell, filtered by the theme", () => {
    expect(WIZARD_CSS).toMatch(
      /@property --vf-glass-logo \{\s*syntax: "<number>";\s*inherits: true;\s*initial-value: 0;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-logo \{\s*position: absolute;\s*top: 50%;\s*left: 50%;\s*width: var\(--vf-wizard-logo-width\);\s*height: var\(--vf-wizard-logo-height\);\s*transform: translate\(-50%, -50%\);\s*background: url\("\.\.\/splash\/assets\/mark-white\.webp"\) center \/ 73\.4% auto no-repeat;\s*filter: var\(--vf-wizard-logo-filter\);\s*opacity: var\(--vf-glass-logo\);\s*pointer-events: none;\s*\}/u,
    );
    // in over 400ms once the last words are out, out over 280ms; a first hold's from nothing
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-shell \{[^}]*transition: --vf-glass-logo 280ms ease;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /\n\.vf-wizard-shell\[data-logo="shown"\] \{\s*--vf-glass-logo: 1;\s*transition: --vf-glass-logo 400ms ease;\s*\}/u,
    );
    expect(WIZARD_CSS).toMatch(
      /@starting-style \{\s*\.vf-wizard-shell\[data-logo="shown"\] \{\s*--vf-glass-logo: 0;\s*\}\s*\}/u,
    );
    expect(REDUCED).toMatch(/\.vf-wizard-shell \{\s*transition-duration: 120ms;\s*\}/u);
    expect(REDUCED).toMatch(
      /\.vf-wizard-shell\[data-logo="shown"\] \{\s*transition-duration: 160ms;\s*\}/u,
    );
    // the mark the logo is drawn from ships beside the splash
    expect(() =>
      readFileSync(join(process.cwd(), "src/boot/splash/assets/mark-white.webp")),
    ).not.toThrow();
  });
});
