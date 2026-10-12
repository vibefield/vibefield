// @vitest-environment happy-dom
/**
 * THE DECK'S DOOR (Godview round 3, L2 and L8b; DESIGN.md §8 "The edge moves").
 *
 * The terminals' wrapper has a state — away, up, or maximized — and two readers
 * outside Godview's own tree: the frame (the Peek and the head read ONE boolean,
 * "is it maximized") and, later, the shell's window lights. So the state leaves
 * through a door module in `frame/`, as Find's and the line's do. This file
 * holds the door to four things:
 *   1. it keeps the three-valued state, or nothing while withdrawn
 *   2. the frame's hook is one boolean, true only for "maximized"
 *   3. `GodviewStage` writes the state on its root beside its three siblings,
 *      and speaks to the door only when told to (`publishesDeck`) and only
 *      while it is open
 *   4. the two stages that are NOT the window's Godview — the catalog's and
 *      Settings' miniature — never speak for the window
 * The window's own stage (the overlay's) is held in
 * `godview-overlay-boundaries.test.tsx`, which mounts the shipping overlay.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodviewPreview } from "../src/design-system/GodviewPreview";
import {
  type GodviewDeckState,
  getGodviewDeck,
  publishGodviewDeck,
  resetGodviewDeckDoorForTest,
  subscribeGodviewDeck,
  useGodviewDeck,
  useGodviewDeckMaximized,
} from "../src/frame/deck-door";
import { DEFAULT_DECK_APPEARANCE } from "../src/godview/deck-appearance";
import { GodviewStage } from "../src/godview/GodviewStage";
import { GodviewMiniature } from "../src/panels/terminal/GodviewMiniature";
import { BUILTIN_THEMES } from "../src/panels/terminal/theme-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  resetGodviewDeckDoorForTest();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  resetGodviewDeckDoorForTest();
});

function render(node: ReactElement): void {
  root ??= createRoot(host);
  act(() => root?.render(node));
}

/** What a reader in the frame saw, render by render. */
const seen: { maximized: boolean[]; state: (GodviewDeckState | null)[] } = {
  maximized: [],
  state: [],
};
function FrameReader(): null {
  seen.maximized.push(useGodviewDeckMaximized());
  return null;
}
function GodviewReader(): null {
  seen.state.push(useGodviewDeck());
  return null;
}

function stage(props: {
  open?: boolean;
  deckState?: GodviewDeckState;
  publishesDeck?: boolean;
}): ReactElement {
  return (
    <GodviewStage
      open={props.open ?? true}
      theme="light"
      tuningOpen={false}
      animations={false}
      {...(props.deckState !== undefined ? { deckState: props.deckState } : {})}
      {...(props.publishesDeck !== undefined ? { publishesDeck: props.publishesDeck } : {})}
      deck={<p>deck</p>}
    />
  );
}

const stageRoot = (): HTMLElement => host.querySelector<HTMLElement>(".vf-godview") as HTMLElement;

describe("the deck's door", () => {
  it("keeps the three-valued state, and nothing while withdrawn", () => {
    expect(getGodviewDeck()).toBeNull();
    for (const state of ["up", "away", "maximized"] as const) {
      publishGodviewDeck(state);
      expect(getGodviewDeck()).toBe(state);
    }
    publishGodviewDeck(null);
    expect(getGodviewDeck()).toBeNull();
  });

  it("tells a listener of each change once, and never of a publish that changed nothing", () => {
    let heard = 0;
    const stop = subscribeGodviewDeck(() => {
      heard += 1;
    });
    publishGodviewDeck("up");
    publishGodviewDeck("up");
    expect(heard).toBe(1);
    publishGodviewDeck("away");
    publishGodviewDeck(null);
    publishGodviewDeck(null);
    expect(heard).toBe(3);
    stop();
    publishGodviewDeck("up");
    expect(heard).toBe(3);
  });

  it("gives the frame one boolean: maximized is false for up, for away and while withdrawn", () => {
    seen.maximized = [];
    render(<FrameReader />);
    expect(seen.maximized.at(-1)).toBe(false); // withdrawn
    act(() => publishGodviewDeck("up"));
    expect(seen.maximized.at(-1)).toBe(false);
    act(() => publishGodviewDeck("away"));
    expect(seen.maximized.at(-1)).toBe(false);
    // none of those is news to the frame: it rendered once and never again
    expect(seen.maximized).toEqual([false]);
    // …and the boolean is not a constant: it is true exactly while maximized
    act(() => publishGodviewDeck("maximized"));
    expect(seen.maximized.at(-1)).toBe(true);
    act(() => publishGodviewDeck("up"));
    expect(seen.maximized.at(-1)).toBe(false);
    act(() => publishGodviewDeck("maximized"));
    act(() => publishGodviewDeck(null));
    expect(seen.maximized.at(-1)).toBe(false);
  });

  it("gives Godview's own readers the state itself", () => {
    seen.state = [];
    render(<GodviewReader />);
    act(() => publishGodviewDeck("up"));
    act(() => publishGodviewDeck("away"));
    act(() => publishGodviewDeck(null));
    expect(seen.state).toEqual([null, "up", "away", null]);
  });
});

describe("the stage and the door", () => {
  it("writes the deck's state on its root beside its siblings, up unless told otherwise", () => {
    render(stage({}));
    expect(stageRoot().getAttribute("data-godview-deck")).toBe("up");
    expect(stageRoot().getAttribute("data-godview-open")).toBe("true");
    render(stage({ deckState: "away" }));
    expect(stageRoot().getAttribute("data-godview-deck")).toBe("away");
    render(stage({ deckState: "maximized" }));
    expect(stageRoot().getAttribute("data-godview-deck")).toBe("maximized");
    render(stage({ deckState: "up" }));
    expect(stageRoot().getAttribute("data-godview-deck")).toBe("up");
  });

  it("says nothing to the door unless it is the window's: a stage draws its state and publishes none", () => {
    render(stage({ deckState: "maximized" }));
    expect(stageRoot().getAttribute("data-godview-deck")).toBe("maximized");
    expect(getGodviewDeck()).toBeNull();
  });

  it("the window's stage publishes its state while open, and withdraws when closed and on unmount", () => {
    render(stage({ publishesDeck: true }));
    expect(getGodviewDeck()).toBe("up");
    render(stage({ publishesDeck: true, deckState: "away" }));
    expect(getGodviewDeck()).toBe("away");
    // closed — Godview is not the window's view: the door says nothing
    render(stage({ publishesDeck: true, deckState: "away", open: false }));
    expect(getGodviewDeck()).toBeNull();
    render(stage({ publishesDeck: true, deckState: "up" }));
    expect(getGodviewDeck()).toBe("up");
    act(() => root?.unmount());
    root = null;
    expect(getGodviewDeck()).toBeNull();
  });

  it("a stage that does not publish never withdraws the window's word either", () => {
    publishGodviewDeck("up"); // the window's Godview, elsewhere in the page
    render(stage({ deckState: "maximized" }));
    expect(getGodviewDeck()).toBe("up");
    render(stage({ deckState: "maximized", open: false }));
    expect(getGodviewDeck()).toBe("up");
    act(() => root?.unmount());
    root = null;
    expect(getGodviewDeck()).toBe("up");
  });
});

describe("the stages that are not the window's Godview", () => {
  it("the catalog's stage never speaks for the window", () => {
    render(<GodviewPreview />);
    expect(stageRoot().getAttribute("data-godview-deck")).toBe("up");
    expect(getGodviewDeck()).toBeNull();
    // …and its leaving withdraws nothing a live Godview said
    publishGodviewDeck("up");
    act(() => root?.unmount());
    root = null;
    expect(getGodviewDeck()).toBe("up");
  });

  it("Settings' miniature never speaks for the window", () => {
    render(
      <GodviewMiniature
        mode="dark"
        theme={BUILTIN_THEMES.dark}
        palette={Array.from({ length: 16 }, () => "#808080")}
        appearance={DEFAULT_DECK_APPEARANCE}
      />,
    );
    expect(stageRoot().getAttribute("data-godview-deck")).toBe("up");
    expect(getGodviewDeck()).toBeNull();
    publishGodviewDeck("up");
    act(() => root?.unmount());
    root = null;
    expect(getGodviewDeck()).toBe("up");
  });
});
