import type { PaneFrameAgent } from "@vibecook/puppeteer-views";
import type { LinePane, NewTerminalOutcome } from "../frame/line-door";
import { folderName } from "./monitor/folder-name";
import type { LocalMountOutcome } from "./monitor/remote-door";

// The deck's half of what Godview lends the line (One Frame FR-2,
// `frame/line-door.ts`): its panes named as the swarm names their bodies, its
// new terminal's outcome in the line's words, and the interim send's paste.
// Pure where it can be, so the line's rows are tested without a deck.

interface DeckPane {
  readonly id: string;
  readonly session: { readonly id: string; readonly cwd?: string | null };
}

/** The panes the deck shows, as @'s list names them: an agent's pane by the
 * project its badge names (the swarm's name for the body), a shell's by its
 * folder; what runs there; the agent's state; and which is active. */
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

/** Paste `text` into a pane's input — the road ⌘V takes: the pane's own
 * paste handler takes it (bracketed when the program asked for that), and
 * nothing presses Return. The pane is focused first, because the input it
 * pastes through is the one holding the keyboard. True when the pane's handler
 * claimed the event — which says a pane is there to hear it, NOT that the
 * paste was sent: ghosttea's handler claims a paste its runtime then drops
 * while the routed input is closed. The deck's door asks the runtime that
 * first (`GodviewDeck`'s `paste`) and hands nothing over while the session's
 * input is closed. */
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
