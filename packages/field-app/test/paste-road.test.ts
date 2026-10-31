// @vitest-environment happy-dom
/**
 * The paste road (`terminal/paste-road.ts`; HN-4, HN-L5, SP-1d): the road ⌘V takes into a terminal
 * surface — focused first, one `paste` carrying the text, the surface's claim reported and never
 * read as "sent" — and the bounded wait for a session's routed input, which hears the runtime's
 * announcement rather than polling. Godview's panes and Chat's thread share both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PaneInputSource,
  pasteIntoInput,
  whenPaneInputOpen,
} from "../src/terminal/paste-road";

const WAIT_MS = 1_500;

describe("pasteIntoInput: the road ⌘V takes", () => {
  let input: HTMLTextAreaElement;

  beforeEach(() => {
    input = document.createElement("textarea");
    document.body.appendChild(input);
  });

  afterEach(() => {
    input.remove();
  });

  it("focuses the input first, then hands it one paste whose text/plain is the text — nothing presses Return", () => {
    const heard: Array<{ type: string; text: string | undefined; focused: boolean }> = [];
    for (const type of ["paste", "keydown", "keypress", "input"]) {
      input.addEventListener(type, (event) => {
        heard.push({
          type,
          text: (event as ClipboardEvent).clipboardData?.getData("text/plain"),
          focused: document.activeElement === input,
        });
        if (type === "paste") event.preventDefault();
      });
    }
    pasteIntoInput(input, "run the tests\nthen push");
    expect(heard).toEqual([{ type: "paste", text: "run the tests\nthen push", focused: true }]);
    expect(document.activeElement).toBe(input);
  });

  it("answers whether the surface's handler claimed the paste — a surface was there, not that it was sent", () => {
    expect(pasteIntoInput(input, "unheard"), "no handler claimed it").toBe(false);
    input.addEventListener("paste", (event) => event.preventDefault());
    expect(pasteIntoInput(input, "claimed")).toBe(true);
  });
});

describe("whenPaneInputOpen: the bounded wait for a session's routed input", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A runtime whose one session's input is open or not, announcing each change to its hearers. */
  function runtimeOf(open: boolean): {
    readonly source: PaneInputSource;
    readonly hearers: Set<() => void>;
    set(next: boolean): void;
  } {
    let inputAllowed = open;
    const hearers = new Set<() => void>();
    return {
      source: {
        routedActivation: () => ({ inputAllowed }),
        addEventListener: (_type, hear) => {
          hearers.add(hear);
        },
        removeEventListener: (_type, hear) => {
          hearers.delete(hear);
        },
      },
      hearers,
      set: (next) => {
        inputAllowed = next;
        for (const hear of [...hearers]) hear();
      },
    };
  }

  it("answers at once when the input is already open, and with no runtime or no session at once too", async () => {
    const open = runtimeOf(true);
    await expect(whenPaneInputOpen(open.source, () => "s-ros", WAIT_MS)).resolves.toBe(true);
    expect(open.hearers.size, "an open input was listened for").toBe(0);
    await expect(whenPaneInputOpen(null, () => "s-ros", WAIT_MS)).resolves.toBe(false);
    const closed = runtimeOf(false);
    await expect(whenPaneInputOpen(closed.source, () => undefined, WAIT_MS)).resolves.toBe(false);
    expect(closed.hearers.size).toBe(0);
  });

  it("waits on the runtime's announcement, bounded: open the moment it opens, closed at the bound", async () => {
    const runtime = runtimeOf(false);
    const answers: boolean[] = [];

    void whenPaneInputOpen(runtime.source, () => "s-ros", WAIT_MS).then((open) => {
      answers.push(open);
    });
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(answers).toEqual([]);
    runtime.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual([true]);
    expect(runtime.hearers.size, "the wait kept listening").toBe(0);

    runtime.set(false);
    void whenPaneInputOpen(runtime.source, () => "s-ros", WAIT_MS).then((open) => {
      answers.push(open);
    });
    runtime.set(false);
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(answers, "an announcement that opened nothing ended the wait").toEqual([true]);
    await vi.advanceTimersByTimeAsync(1);
    expect(answers).toEqual([true, false]);
    expect(runtime.hearers.size).toBe(0);
  });

  it("asks which session again at each announcement: the pane may have changed what it shows", async () => {
    let inputAllowed = false;
    let shows = "s-old";
    const hearers = new Set<() => void>();
    const source: PaneInputSource = {
      routedActivation: (sessionId) => ({ inputAllowed: inputAllowed && sessionId === "s-new" }),
      addEventListener: (_type, hear) => {
        hearers.add(hear);
      },
      removeEventListener: (_type, hear) => {
        hearers.delete(hear);
      },
    };
    const answer = whenPaneInputOpen(source, () => shows, WAIT_MS);
    shows = "s-new";
    inputAllowed = true;
    for (const hear of [...hearers]) hear();
    await expect(answer).resolves.toBe(true);
  });
});
