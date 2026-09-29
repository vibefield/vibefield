// @vitest-environment happy-dom
/**
 * THE LAUNCH (QL-2, Minimal Pane Frame pass 4 §27, look C · Cells), driven.
 *
 * The shipping `DeckLaunchers` from the views package, mounted over a pane that
 * stands in for ghosttea's (its class, its id, a terminal input, and the frame's
 * badge with a mark slot, as `DeckFrames` draws it), with a port whose answer
 * the test holds and a first-frame watch it fires. Fake timers drive the
 * launch's own clock. The contract's lines are named where they are held.
 */

import {
  DeckLaunchers,
  type LauncherAgent,
  type LauncherOutcome,
  type LauncherPort,
  type LauncherSession,
  type WatchFirstFrame,
} from "@vibecook/puppeteer-views/launcher";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CWD = "/Users/j/src/puppeteer";
const AGENTS: LauncherAgent[] = [
  { providerId: "agent-a", label: "Agent A" },
  { providerId: "agent-b", label: "Agent B" },
];
const PAST: LauncherSession = {
  key: "past-1",
  providerId: "agent-a",
  nativeSessionId: "native-1",
  title: "Fix the parser",
  cwd: CWD,
  here: true,
  resumable: true,
};

interface RenderOptions {
  /** The host watches first frames (the default) or has no signal. */
  watch?: boolean;
  /** The fresh shells; `shell-1` by default. */
  fresh?: readonly string[];
  /** The panes as the host lays them out; the rig's one pane showing `sessionId` by default. */
  panes?: readonly { id: string; session: string }[];
  active?: string;
  reduced?: boolean;
}

interface Rig {
  pane: HTMLElement;
  input: HTMLTextAreaElement;
  port: LauncherPort & {
    launch: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
  answer(outcome: LauncherOutcome): Promise<void>;
  drawn(): void;
  watched: string[];
  watching(): boolean;
  addPane(id: string): HTMLElement;
  render(sessionId?: string, options?: RenderOptions): void;
  launch(pane?: HTMLElement): HTMLElement | null;
  launcher(pane?: HTMLElement): HTMLElement | null;
  root: Root;
}

let rig: Rig | undefined;

function makePane(id: string): HTMLElement {
  const pane = document.createElement("div");
  pane.className = "ghostty-pane";
  pane.dataset.paneId = id;
  const input = document.createElement("textarea");
  input.className = "terminal-input";
  pane.append(input);
  pane.insertAdjacentHTML(
    "beforeend",
    '<div class="vf-pane-frame"><span class="vf-pane-badge"><span class="vf-pane-badge-name">' +
      '<span class="vf-pane-mark"><svg></svg></span><span class="vf-pane-name">puppeteer</span>' +
      "</span></span></div>",
  );
  return pane;
}

function makeRig(): Rig {
  const deck = document.createElement("div");
  deck.className = "vf-deck-framed";
  const pane = makePane("p1");
  deck.append(pane);
  document.body.append(deck);

  let settle: ((outcome: LauncherOutcome) => void) | undefined;
  const held = () =>
    new Promise<LauncherOutcome>((resolve) => {
      settle = resolve;
    });
  const port = {
    recent: vi.fn(async () => ({ status: { readiness: "ready" as const }, sessions: [PAST] })),
    launch: vi.fn(held),
    resume: vi.fn(held),
  };
  let onDrawn: (() => void) | undefined;
  const watched: string[] = [];
  const watchFirstFrame: WatchFirstFrame = (sessionId, drawn) => {
    watched.push(sessionId);
    onDrawn = drawn;
    return () => {
      onDrawn = undefined;
    };
  };
  const root = createRoot(document.createElement("div"));
  const deckRef = { current: deck };

  const render = (sessionId = "shell-1", options: RenderOptions = {}): void => {
    const fresh = options.fresh ?? ["shell-1"];
    const panes = options.panes ?? [{ id: "p1", session: sessionId }];
    act(() => {
      root.render(
        <DeckLaunchers
          deckRef={deckRef}
          panes={panes.map((entry) => ({ id: entry.id, session: { id: entry.session, cwd: CWD } }))}
          activePaneId={options.active ?? "p1"}
          freshSessionIds={new Set(fresh)}
          cwdBySession={new Map(fresh.map((id) => [id, CWD]))}
          paneColors={new Map([["p1", "hsl(140 52% 40%)"]])}
          agents={AGENTS}
          port={port}
          reducedMotion={options.reduced ?? false}
          {...(options.watch === false ? {} : { watchFirstFrame })}
        />,
      );
    });
  };

  return {
    pane,
    input: pane.querySelector("textarea") as HTMLTextAreaElement,
    port,
    async answer(outcome) {
      await act(async () => {
        settle?.(outcome);
        await Promise.resolve();
      });
    },
    drawn() {
      act(() => onDrawn?.());
    },
    watched,
    watching: () => onDrawn !== undefined,
    addPane(id) {
      const next = makePane(id);
      deck.append(next);
      return next;
    },
    render,
    launch: (target = pane) => target.querySelector<HTMLElement>("[data-vf-pane-launch]"),
    launcher: (target = pane) => target.querySelector<HTMLElement>(".vf-pane-launcher"),
    root,
  };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function clickAgent(index: number, pane = rig?.pane): void {
  const buttons = pane?.querySelectorAll<HTMLButtonElement>(".vf-pane-launcher-agent");
  act(() => {
    buttons?.[index]?.click();
  });
}

/**
 * The timers left once zero-delay work has run: the pane finder's own DOM sync
 * (`usePaneElements`) is a `setTimeout(0)` that is none of the launch's.
 */
function timersLeft(): number {
  advance(0);
  return vi.getTimerCount();
}

function caption(r: Rig): string | null | undefined {
  return r.launch()?.querySelector(".vf-pane-launch-caption span")?.textContent;
}

/** A pane's size, as the launch reads it (happy-dom lays nothing out). */
function sizePane(pane: HTMLElement, width: number, height: number): void {
  Object.defineProperty(pane, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(pane, "clientHeight", { configurable: true, get: () => height });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  rig = makeRig();
});

afterEach(() => {
  act(() => rig?.root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  rig = undefined;
});

describe("the launch (QL-2 · C · Cells), in a pane", () => {
  it("answers in the click's frame, holds the pane through the swap, and lands on the first frame", async () => {
    const r = rig as Rig;
    r.render();
    expect(r.launcher()).not.toBeNull();
    clickAgent(1);
    // C1: in the click's frame, before any answer — the launcher leaves toward
    // the mark, the launch is up, and the badge holds its own mark back (C6).
    expect(r.launcher()?.classList.contains("is-leaving")).toBe(true);
    expect(r.launch()?.className).toBe("vf-pane-launch is-depart is-lit");
    expect(r.pane.getAttribute("data-vf-launching")).toBe("held");
    expect(r.port.launch).toHaveBeenCalledWith({
      paneId: "p1",
      sessionId: "shell-1",
      providerId: "agent-b",
      cwd: CWD,
    });
    // Nothing is said until the indicator is up: a region filled as it mounts is not read.
    expect(r.launch()?.querySelector('[role="status"]')?.textContent).toBe("");

    // C8: keys are held while the launch is in flight, not typed into the shell it replaces.
    const key = new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      r.input.dispatchEvent(key);
    });
    expect(key.defaultPrevented).toBe(true);

    // C5: the indicator comes at 320ms, starting.
    advance(319);
    expect(r.launch()?.classList.contains("is-waiting")).toBe(false);
    advance(1);
    expect(r.launch()?.className).toBe("vf-pane-launch is-starting is-lit is-waiting");
    expect(r.launch()?.querySelector('[role="status"]')?.textContent).toBe("Starting Agent B");

    // C4: the caption says which wait, and from 1.5s the seconds (it ticks every 100ms).
    advance(1_100);
    expect(caption(r)).toBe("starting");
    advance(230);
    expect(caption(r)).toBe("starting · 1.6s");

    // C2/C3: the host mounts the agent (the pane's session changes, so the
    // launcher unmounts) and answers; the launch outlives its launcher.
    r.render("agent-1");
    expect(r.launcher()).toBeNull();
    await r.answer({ accepted: true, sessionId: "agent-1" });
    expect(r.watched).toEqual(["agent-1"]);
    expect(r.watching()).toBe(true);
    expect(r.launch()?.className).toBe("vf-pane-launch is-opening is-lit is-waiting");

    // The first frame: home — the ground opens, the mark flies to the badge's
    // slot (the frame opens it), and the pane is let go.
    r.drawn();
    expect(r.launch()?.className).toBe("vf-pane-launch is-home is-lit");
    const ground = r.launch()?.querySelector<HTMLElement>(".vf-pane-launch-ground");
    expect(ground?.style.getPropertyValue("--vf-launch-hole")).not.toBe("");
    // The caption fades out with its last words, never flipping back to `starting`.
    expect(caption(r)).toMatch(/^opening/);
    advance(140);
    expect(r.pane.getAttribute("data-vf-launching")).toBe("landing");
    advance(440);
    expect(r.launch()).toBeNull();
    expect(r.pane.hasAttribute("data-vf-launching")).toBe(false);
    // Everything the launch held is let go: its watch and every timer.
    expect(r.watching()).toBe(false);
    expect(timersLeft()).toBe(0);
  });

  it("shows no indicator at all for a launch that has drawn before it was due (C5)", async () => {
    const r = rig as Rig;
    r.render();
    clickAgent(0);
    advance(100);
    await r.answer({ accepted: true, sessionId: "agent-1" });
    r.drawn();
    // Home before the indicator was due: the ground goes at once, and the
    // indicator's timer firing later changes nothing.
    expect(r.launch()?.className).toBe("vf-pane-launch is-home");
    expect(r.launch()?.querySelector('[role="status"]')?.textContent).toBe("Agent A is open");
    advance(250);
    expect(r.launch()?.className).toBe("vf-pane-launch is-home");
    advance(400);
    expect(r.launch()).toBeNull();
    expect(timersLeft()).toBe(0);
  });

  it("releases a first frame that never comes, 3s after the answer (C9)", async () => {
    const r = rig as Rig;
    r.render();
    clickAgent(0);
    advance(400);
    await r.answer({ accepted: true, sessionId: "agent-1" });
    advance(2_999);
    expect(r.launch()?.className).toBe("vf-pane-launch is-opening is-lit is-waiting");
    advance(1);
    expect(r.launch()?.className).toBe("vf-pane-launch is-home is-lit");
    advance(600);
    expect(r.launch()).toBeNull();
    // The watch goes with the launch (a frame that came during the flight changed nothing).
    expect(r.watching()).toBe(false);
    expect(timersLeft()).toBe(0);
  });

  it("lands at the answer when the host has no first-frame signal", async () => {
    const r = rig as Rig;
    r.render("shell-1", { watch: false });
    clickAgent(0);
    advance(1_000);
    await r.answer({ accepted: true, sessionId: "agent-1" });
    expect(r.launch()?.className).toBe("vf-pane-launch is-home is-lit");
    expect(r.watched).toEqual([]);
  });

  it("puts a refused launch back: the mark returns, the launcher comes back and says why (C7)", async () => {
    const r = rig as Rig;
    r.render();
    clickAgent(1);
    advance(600);
    await r.answer({ accepted: false, reason: "its profile is signed out" });
    expect(r.launch()?.className).toBe("vf-pane-launch is-refused is-lit");
    // The launcher is back at once; the row stays empty until the mark lands in it.
    expect(r.launcher()?.classList.contains("is-leaving")).toBe(false);
    expect(r.pane.querySelector(".vf-pane-launcher-agent.is-flying")).not.toBeNull();
    expect(r.pane.querySelector(".vf-pane-launcher-failure")?.textContent).toBe(
      "Agent B didn’t launch: its profile is signed out",
    );
    advance(600);
    expect(r.launch()).toBeNull();
    expect(r.pane.hasAttribute("data-vf-launching")).toBe(false);
    expect(r.pane.querySelector(".vf-pane-launcher-agent.is-flying")).toBeNull();
    expect(r.watched).toEqual([]);
    // …and the launcher launches again, clearing the old reason.
    clickAgent(0);
    expect(r.pane.querySelector(".vf-pane-launcher-failure")).toBeNull();
    expect(r.port.launch).toHaveBeenCalledTimes(2);
  });

  it("launches once per pane, however fast the second click", () => {
    const r = rig as Rig;
    r.render();
    clickAgent(0);
    clickAgent(1);
    expect(r.port.launch).toHaveBeenCalledTimes(1);
  });

  it("lets the pane go when the agent leaves it before drawing, and the launcher there now says so", async () => {
    const r = rig as Rig;
    r.render();
    clickAgent(1);
    r.render("agent-1");
    advance(400);
    await r.answer({ accepted: true, sessionId: "agent-1" });
    expect(r.watching()).toBe(true);
    // The agent exits at once and the host puts a fresh shell back in its pane:
    // the launch lets go at once instead of covering that shell until C9.
    r.render("shell-2", { fresh: ["shell-2"] });
    expect(r.launch()?.className).toBe("vf-pane-launch is-left is-lit");
    expect(r.watching()).toBe(false);
    expect(r.launch()?.querySelector('[role="status"]')?.textContent).toBe(
      "Agent B exited before it opened",
    );
    // The new shell's launcher is its own: not held by the old launch, and it says why it is back.
    expect(r.launcher()?.classList.contains("is-leaving")).toBe(false);
    expect(r.pane.querySelector(".vf-pane-launcher-failure")?.textContent).toBe(
      "Agent B exited before it opened",
    );
    // The grid drains (200ms), then the mark goes out where it is (180ms).
    advance(379);
    expect(r.launch()).not.toBeNull();
    advance(1);
    expect(r.launch()).toBeNull();
    expect(r.pane.hasAttribute("data-vf-launching")).toBe(false);
    // …and nothing about the old launch stands in the way of the next one.
    clickAgent(0);
    expect(r.port.launch).toHaveBeenCalledTimes(2);
    expect(r.port.launch).toHaveBeenLastCalledWith({
      paneId: "p1",
      sessionId: "shell-2",
      providerId: "agent-a",
      cwd: CWD,
    });
    expect(r.pane.querySelector(".vf-pane-launcher-failure")).toBeNull();
  });

  it("launches again at once in a pane its agent left, while the old launch is still going out", async () => {
    const r = rig as Rig;
    r.render();
    clickAgent(1);
    r.render("agent-1");
    await r.answer({ accepted: true, sessionId: "agent-1" });
    r.render("shell-2", { fresh: ["shell-2"] });
    expect(r.launch()?.className).toContain("is-left");
    clickAgent(0);
    expect(r.port.launch).toHaveBeenCalledTimes(2);
    expect(r.launch()?.className).toBe("vf-pane-launch is-depart is-lit");
    expect(r.pane.getAttribute("data-vf-launching")).toBe("held");
    expect(r.pane.querySelectorAll("[data-vf-pane-launch]")).toHaveLength(1);
  });

  it("waits for a host that mounts the agent after it answers: its own shell is not a leaving", async () => {
    const r = rig as Rig;
    r.render();
    clickAgent(0);
    await r.answer({ accepted: true, sessionId: "agent-1" });
    // The pane still shows the launcher's shell (a host that mounts after answering).
    advance(400);
    expect(r.launch()?.className).toBe("vf-pane-launch is-opening is-lit is-waiting");
    r.render("agent-1");
    r.drawn();
    expect(r.launch()?.className).toBe("vf-pane-launch is-home is-lit");
  });

  it("lets go of a pane that goes away mid-launch, and drops an answer that comes after", async () => {
    const r = rig as Rig;
    r.render();
    clickAgent(0);
    r.render("agent-1");
    await r.answer({ accepted: true, sessionId: "agent-1" });
    expect(r.watching()).toBe(true);
    r.render("agent-1", { panes: [] });
    expect(r.launch()).toBeNull();
    expect(r.pane.hasAttribute("data-vf-launching")).toBe(false);
    expect(r.watching()).toBe(false);
    expect(timersLeft()).toBe(0);

    // A launch whose pane goes before the port answers: the answer changes nothing.
    r.render();
    clickAgent(1);
    r.render("shell-1", { panes: [] });
    await r.answer({ accepted: true, sessionId: "agent-2" });
    expect(r.watched).toEqual(["agent-1"]);
    expect(r.launch()).toBeNull();
    expect(timersLeft()).toBe(0);
  });

  it("keeps a refusal under the launcher it came from when a shell shows in two panes", async () => {
    const r = rig as Rig;
    const second = r.addPane("p2");
    const both = [
      { id: "p1", session: "shell-1" },
      { id: "p2", session: "shell-1" },
    ];
    r.render("shell-1", { panes: both });
    clickAgent(1);
    await r.answer({ accepted: false, reason: "its profile is signed out" });
    expect(r.pane.querySelector(".vf-pane-launcher-failure")?.textContent).toBe(
      "Agent B didn’t launch: its profile is signed out",
    );
    r.render("shell-1", { panes: both, active: "p2" });
    expect(r.launcher(second)).not.toBeNull();
    expect(second.querySelector(".vf-pane-launcher-failure")).toBeNull();
  });

  it("resumes a past session: the caption says resuming, and a refusal names the session", async () => {
    const r = rig as Rig;
    r.render();
    const field = r.pane.querySelector<HTMLInputElement>(".vf-pane-launcher-field input");
    await act(async () => {
      field?.focus();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });
    const row = r.pane.querySelector<HTMLElement>(".vf-pane-launcher-row");
    expect(row?.getAttribute("data-vf-launch-source")).toBe("session:0");
    act(() => {
      row?.click();
    });
    expect(r.port.resume).toHaveBeenCalledWith({
      paneId: "p1",
      sessionId: "shell-1",
      session: PAST,
      cwd: CWD,
    });
    advance(320);
    expect(caption(r)).toBe("resuming");
    expect(r.launch()?.querySelector('[role="status"]')?.textContent).toBe("Resuming Agent A");
    await r.answer({ accepted: false, reason: "the folder is gone" });
    expect(r.pane.querySelector(".vf-pane-launcher-failure")?.textContent).toBe(
      "“Fix the parser” didn’t resume: the folder is gone",
    );
  });

  it("fades rather than travels under reduced motion, in half the time (M6)", async () => {
    const r = rig as Rig;
    r.render("shell-1", { reduced: true });
    clickAgent(0);
    expect(r.launch()?.className).toBe("vf-pane-launch is-depart is-lit is-reduced");
    advance(400);
    r.render("agent-1", { reduced: true });
    await r.answer({ accepted: true, sessionId: "agent-1" });
    r.drawn();
    // The ground fades where it is: no hole opens from the mark.
    expect(r.launch()?.className).toBe("vf-pane-launch is-home is-reduced");
    const ground = r.launch()?.querySelector<HTMLElement>(".vf-pane-launch-ground");
    expect(ground?.style.getPropertyValue("--vf-launch-hole")).toBe("");
    // The badge's slot opens without animating, in half the time.
    advance(70);
    expect(r.pane.getAttribute("data-vf-launching")).toBe("landing");
    expect(r.pane.classList.contains("vf-pane-launch-still")).toBe(true);
    advance(220);
    expect(r.launch()).toBeNull();
    expect(r.pane.hasAttribute("data-vf-launching")).toBe(false);
    expect(r.pane.classList.contains("vf-pane-launch-still")).toBe(false);
  });

  it("keeps the mark in the middle of a pane resized while it waits, and not once it is on its way", async () => {
    const r = rig as Rig;
    type Watcher = { callback: ResizeObserverCallback; targets: Element[]; self: ResizeObserver };
    const watchers: Watcher[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly #watcher: Watcher;
        constructor(callback: ResizeObserverCallback) {
          this.#watcher = { callback, targets: [], self: this as unknown as ResizeObserver };
          watchers.push(this.#watcher);
        }
        observe(target: Element): void {
          this.#watcher.targets.push(target);
        }
        unobserve(): void {}
        disconnect(): void {
          this.#watcher.targets = [];
        }
      },
    );
    /** Every observer of the pane hears its new size, as the browser would tell them. */
    const resize = (width: number, height: number): void => {
      sizePane(r.pane, width, height);
      act(() => {
        for (const watcher of watchers) {
          const entries = watcher.targets
            .filter((target) => target === r.pane)
            .map(
              (target) =>
                ({
                  target,
                  borderBoxSize: [{ inlineSize: width, blockSize: height }],
                  contentBoxSize: [{ inlineSize: width, blockSize: height }],
                  contentRect: { width, height },
                }) as unknown as ResizeObserverEntry,
            );
          if (entries.length > 0) watcher.callback(entries, watcher.self);
        }
      });
    };
    sizePane(r.pane, 800, 400);
    r.render();
    clickAgent(0);
    const mark = r.launch()?.querySelector<HTMLElement>(".vf-pane-launch-mark");
    expect(mark?.style.transform).toBe("translate(387.00px, 171.00px) scale(1.0000)");
    // A split halves the pane: the grid and the mark follow its middle.
    resize(400, 400);
    expect(mark?.style.transform).toBe("translate(187.00px, 171.00px) scale(1.0000)");
    expect(r.launch()?.style.getPropertyValue("--launch-cx")).toBe("200px");
    // Once the mark is flying home, a resize moves the grid but not the mark.
    r.render("agent-1");
    await r.answer({ accepted: true, sessionId: "agent-1" });
    r.drawn();
    advance(140);
    const flying = mark?.style.transform;
    resize(600, 400);
    expect(mark?.style.transform).toBe(flying);
    expect(r.launch()?.style.getPropertyValue("--launch-cx")).toBe("300px");
  });
});
