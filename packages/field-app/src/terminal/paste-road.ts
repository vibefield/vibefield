// THE PASTE ROAD: how text goes into a terminal surface the way ⌘V puts it there (HN-4, HN-L5;
// DESIGN.md §8 "The hand", where cards go). The surface's own paste handler takes it — bracketed
// when its program asked for that — and nothing presses Return. Godview's panes take a card's
// play by it (`godview/line-panes.ts`), and Chat's thread takes Send and its starters by the
// same road (SP-1d; DESIGN.md §8 "Chat's composer": the thread pane's door, `chat/SparkPane.tsx`,
// pastes through `pasteIntoInput`), so the road has one home under the terminal plane both sit
// on, not in Godview. The wait for a session's routed input lives here too: a paste is
// only handed over once the runtime says that input is open.

/** Paste `text` into a terminal surface's own input — the road ⌘V takes. The input is focused
 * first, because the input it pastes through is the one holding the keyboard. True when the
 * surface's handler claimed the event, which says a surface is there to hear it, NOT that the
 * paste was sent: ghosttea's handler claims a paste its runtime then drops while the routed
 * input is closed, so a caller asks the runtime that first (`whenPaneInputOpen`) and hands
 * nothing over while the session's input is closed. */
export function pasteIntoInput(input: HTMLTextAreaElement, text: string): boolean {
  input.focus();
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const event = new ClipboardEvent("paste", {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  return event.defaultPrevented;
}

/** What a pane's input wait listens to: the window's terminal runtime (GT-D17 — the deck holds
 * it for Godview), which answers a session's routed activation now and announces each change of
 * one. */
export interface PaneInputSource {
  routedActivation(sessionId: string): { readonly inputAllowed: boolean } | undefined;
  addEventListener(type: "routed-activation-state", listener: () => void): void;
  removeEventListener(type: "routed-activation-state", listener: () => void): void;
}

/** HN-4 — true once the session `sessionOf()` names takes input, false after `timeoutMs` or with
 * no session to wait for. A card spring-loaded into Godview lands while the pane's routed input
 * may still be reopening after the change of view — the ⌘2 race the godview smoke waits out by
 * its markers. The runtime announces every change of a session's activation, so the wait is the
 * announcement, bounded, never a poll; `sessionOf` is asked again at each one, since the pane may
 * have changed what it shows. */
export function whenPaneInputOpen(
  source: PaneInputSource | null,
  sessionOf: () => string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const open = (): boolean => {
    const sessionId = sessionOf();
    return sessionId !== undefined && source?.routedActivation(sessionId)?.inputAllowed === true;
  };
  if (open()) return Promise.resolve(true);
  if (source === null || sessionOf() === undefined) return Promise.resolve(false);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (answer: boolean): void => {
      clearTimeout(timer);
      source.removeEventListener("routed-activation-state", hear);
      resolve(answer);
    };
    const hear = (): void => {
      if (open()) settle(true);
    };
    source.addEventListener("routed-activation-state", hear);
    timer = setTimeout(() => settle(open()), timeoutMs);
  });
}
