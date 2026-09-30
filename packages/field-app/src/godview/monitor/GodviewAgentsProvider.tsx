import type { PaneFrameAgent } from "@vibecook/puppeteer-views";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { AgentSessionSummary } from "./facet-types";
import { type LocalFieldState, useLocalAgentField } from "./local-agent-field";
import { paneFrameAgents, paneFrameFactsKey, runIdsBySession } from "./pane-frame-facts";
import type { MonitorDoor } from "./remote-door";

/**
 * THE FOLD, LIFTED (AR-6 §4.1; built at GT-6).
 *
 * Until now `useMonitorAgents` owned the `agent.subscribe` stream, and the fold
 * was the monitor's private reading of the daemon. The deck needs it too — the
 * pane frame names the agent in a pane, says what it is doing, and aims its
 * verbs at the RUN — and two subscriptions on one window would be two boards
 * disagreeing by a tick over the same daemon (PF5's rule is one subscription
 * per window).
 *
 * So the stream lives here, above both, mounted by `GodviewOverlay` where the
 * monitor and the deck are siblings. The monitor keeps its own projection and
 * takes the fold as input; the deck reads the frame's facts by the pane join.
 * Nothing in this module dials anything: the transport is still the DECK'S
 * (`door.observe` — the deck's fieldd client subscribing on the field's
 * behalf, EL2), and the door arrives as a prop.
 *
 * TWO CONTEXTS, one subscription, and the split is deliberate. The fold
 * publishes a whole board at fieldd's tick while an agent is active: usage
 * samples, freshness and the latest reply all move several times a second. The
 * monitor draws all of that and subscribes to the broad value, exactly as it
 * did when it owned the stream. The DECK draws a badge, a readout and a meter,
 * and re-rendering `GhostteaWorkspace` at the daemon's cadence for facts no
 * frame reads would be paying the pane tree for news about a token count — so
 * the deck's value is gated on the frame's own fields and changes only when one
 * of them does.
 */

export interface AgentFold {
  /** The fold's rows, as fieldd's last frame had them. */
  rows: readonly AgentSessionSummary[];
  /** THE PANE JOIN (AR-3): a managed row by the floor session its PTY is. */
  byTerminal: ReadonlyMap<string, AgentSessionSummary>;
  /** The field's honest state — `unavailable` carries fieldd's own reason. */
  state: LocalFieldState;
  reason?: string;
}

/** What the deck's frames read: the agent facts per pane session, and the run
 * each session belongs to (the verbs' target). */
export interface DeckAgentFacts {
  agents: ReadonlyMap<string, PaneFrameAgent>;
  runs: ReadonlyMap<string, string>;
}

const EMPTY_DECK_FACTS: DeckAgentFacts = { agents: new Map(), runs: new Map() };

const AgentFoldContext = createContext<AgentFold | undefined>(undefined);
const DeckAgentFactsContext = createContext<DeckAgentFacts | undefined>(undefined);

/**
 * The pane join. `hosted: "local"` only, and the restriction is the point: a
 * remote row's `runtimeSessionId` names a session on the PEER'S floor, while
 * the pane in this deck shows a local REPLICA with an id of its own (GT-5c) —
 * joining on it would hang one device's facts off another device's pane. A row
 * with no terminal (`hosted: "none"` — an exited run, an ingested one) joins
 * nothing, which is the honest answer for a run with no pane.
 *
 * A row carrying a mirror wins a contested session id: fieldd's fold names one
 * run per PTY, so a collision means a replacement is mid-flight, and the run
 * that has spoken is the one worth drawing.
 */
export function foldByTerminal(
  rows: readonly AgentSessionSummary[],
): ReadonlyMap<string, AgentSessionSummary> {
  const byTerminal = new Map<string, AgentSessionSummary>();
  for (const row of rows) {
    const terminal = row.terminal;
    if (terminal?.hosted !== "local") continue;
    const sessionId = terminal.runtimeSessionId;
    if (sessionId === undefined || sessionId === "") continue;
    const held = byTerminal.get(sessionId);
    if (held !== undefined && held.monitor !== undefined && row.monitor === undefined) continue;
    byTerminal.set(sessionId, row);
  }
  return byTerminal;
}

export function GodviewAgentsProvider({
  door = null,
  subscribed = true,
  children,
}: {
  /** The deck's door (GT-D17). Null before a deck exists — the field is then
   * `no-door`, which is not the same fact as an empty one. */
  door?: MonitorDoor | null;
  /**
   * PF6, kept where it was. The monitor's subscription used to live inside a
   * stage mounted only while Godview was open, so a closed Godview held none;
   * this provider is mounted beside the DECK, which stays alive across a close
   * on purpose (that is what makes reopening instant). So the ask is gated
   * here instead: false asks the daemon nothing and publishes the `no-door`
   * field, and the first frame comes back within a tick of reopening.
   */
  subscribed?: boolean;
  children: ReactNode;
}): ReactElement {
  const field = useLocalAgentField({ door: subscribed ? door : null });

  const fold = useMemo<AgentFold>(
    () => ({
      rows: field.rows,
      byTerminal: foldByTerminal(field.rows),
      state: field.state,
      ...(field.reason !== undefined ? { reason: field.reason } : {}),
    }),
    [field],
  );

  // The deck's gate: the projection runs every frame (a handful of rows), but
  // the OBJECT handed down is the previous one until a field a frame draws
  // actually moves — the identity rule the monitor's own damage gate uses, so
  // React bails out of the deck's subtree rather than re-rendering the panes.
  const deckFacts = useRef<DeckAgentFacts>(EMPTY_DECK_FACTS);
  const deckKey = useRef("");
  const agents = paneFrameAgents(fold.byTerminal);
  const runs = runIdsBySession(fold.byTerminal);
  const key = paneFrameFactsKey(agents, runs);
  if (key !== deckKey.current) {
    deckKey.current = key;
    deckFacts.current = { agents, runs };
  }

  return (
    <AgentFoldContext.Provider value={fold}>
      <DeckAgentFactsContext.Provider value={deckFacts.current}>
        {children}
      </DeckAgentFactsContext.Provider>
    </AgentFoldContext.Provider>
  );
}

/** The fold, for a surface that draws the whole board. Throws outside a
 * provider rather than answering an empty field: "nobody subscribed" and "the
 * daemon answered, and nothing is running" are different facts, and only one of
 * them is a bug (the same distinction `no-door` makes on the wire). */
export function useAgentFold(): AgentFold {
  const fold = useContext(AgentFoldContext);
  if (fold === undefined) {
    throw new Error(
      "useAgentFold: no GodviewAgentsProvider above this tree — Godview's fold is one subscription per window",
    );
  }
  return fold;
}

/** The frame's facts, for the deck. Same law as `useAgentFold`. */
export function useDeckAgentFacts(): DeckAgentFacts {
  const facts = useContext(DeckAgentFactsContext);
  if (facts === undefined) {
    throw new Error(
      "useDeckAgentFacts: no GodviewAgentsProvider above this deck — the pane frame reads the window's one fold",
    );
  }
  return facts;
}
