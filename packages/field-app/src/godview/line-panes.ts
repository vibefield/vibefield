import type { PaneFrameAgent } from "@vibefield/puppeteer-views";
import type { LinePane, NewTerminalOutcome } from "../frame/line-door";
import { folderName } from "./monitor/folder-name";
import type { LocalMountOutcome } from "./monitor/remote-door";

// The deck's half of what Godview lends the line (One Frame FR-2,
// `frame/line-door.ts`): its panes named as the swarm names their bodies, its
// new terminal's outcome in the line's words, and the paste a card played from
// the hand goes in by (HN-4). Pure where it can be, so the line's rows are
// tested without a deck.

interface DeckPane {
  readonly id: string;
  readonly session: { readonly id: string; readonly cwd?: string | null };
}

/** The panes the deck shows, as the line names them (its note, and a card
 * carried over one): an agent's pane by the project its badge names (the
 * swarm's name for the body), a shell's by its folder; what runs there; the
 * agent's state; which is active; and the pane's own id, which a card played
 * onto it is pasted into (HN-4). */
export function linePanesOf(
  panes: readonly DeckPane[],
  agents: ReadonlyMap<string, PaneFrameAgent>,
  activePaneId: string | undefined,
  rememberedCwd: (sessionId: string) => string | undefined = () => undefined,
): LinePane[] {
  return panes.map((pane) => {
    const agent = agents.get(pane.session.id);
    const cwd = agent?.cwd ?? pane.session.cwd ?? rememberedCwd(pane.session.id);
    return {
      paneId: pane.id,
      sessionId: pane.session.id,
      name: agent?.project ?? folderName(cwd, "terminal"),
      runs: agent?.providerLabel ?? "shell",
      state: agent === undefined ? null : agent.status,
      active: pane.id === activePaneId,
    };
  });
}

/** The door's outcome in the line's terms — how the deck's rule placed it
 * (GV-D4), when the door says; its refusal in the swarm's own sentence for a
 * deck with no pane to place by (useMonitorAgents' createAt). */
export function newTerminalOutcome(outcome: LocalMountOutcome): NewTerminalOutcome {
  if (outcome.state === "mounted")
    return {
      state: "opened",
      ...(outcome.placement !== undefined ? { placement: outcome.placement } : {}),
    };
  if (outcome.state === "failed") return { state: "refused", reason: outcome.reason };
  return { state: "refused", reason: "no pane to open it in — open one in the deck first" };
}

/** What a pane's input wait listens to: the deck's runtime (GT-D17 — the deck
 * alone holds it), which answers a session's routed activation now and
 * announces each change of one. */
export interface PaneInputSource {
  routedActivation(sessionId: string): { readonly inputAllowed: boolean } | undefined;
  addEventListener(type: "routed-activation-state", listener: () => void): void;
  removeEventListener(type: "routed-activation-state", listener: () => void): void;
}

/** HN-4 — true once the session `sessionOf()` names takes input, false after
 * `timeoutMs` or with no session to wait for. A card spring-loaded into Godview
 * lands while the pane's routed input may still be reopening after the change
 * of view — the ⌘2 race the godview smoke waits out by its markers. The runtime
 * announces every change of a session's activation, so the wait is the
 * announcement, bounded, never a poll; `sessionOf` is asked again at each one,
 * since the pane may have changed what it shows. */
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

/** Paste `text` into a pane's input — the road ⌘V takes: the pane's own
 * paste handler takes it (bracketed when the program asked for that), and
 * nothing presses Return. The pane is focused first, because the input it
 * pastes through is the one holding the keyboard. True when the pane's handler
 * claimed the event — which says a pane is there to hear it, NOT that the
 * paste was sent: ghosttea's handler claims a paste its runtime then drops
 * while the routed input is closed. The deck's door asks the runtime that
 * first (`GodviewDeck`'s `pasteInto`) and hands nothing over while the
 * session's input is closed. */
export function pasteIntoPane(root: ParentNode, paneId: string, text: string): boolean {
  const id =
    typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(paneId) : paneId;
  const input = root.querySelector<HTMLTextAreaElement>(`[data-pane-id="${id}"] textarea`);
  if (input === null) return false;
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
