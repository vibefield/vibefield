import type { AgentStopState } from "@vibefield/contracts";
import { frameScheduler } from "@vibefield/puppeteer-view-sdk/host";
import type { PaneFrameAgent } from "@vibefield/puppeteer-views";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";
import { type ChromeFacts, type ChromeRun, NO_RUNS } from "./chrome-facts";
import { type GodviewMonitorFeed, useMonitorReplica } from "./model-replica";
import {
  paneFrameAgents,
  paneFrameFactsKey,
  runIdsBySession,
  runsByTerminal,
  stopsBySession,
} from "./pane-frame-facts";
import type { MonitorDoor } from "./remote-door";

/**
 * THE WINDOW'S ONE SUBSCRIPTION (AR-6 §4.1, built at GT-6; MV-3b; MV-3d).
 *
 * The monitor and the deck read the same daemon, and two subscriptions on one
 * window would be two boards disagreeing by a tick over it (PF5's rule is one
 * subscription per window). So the stream lives here, above both, mounted by
 * `GodviewOverlay` where the monitor and the deck are siblings. Nothing in this
 * module dials anything: the transport is still the DECK'S (the door's model
 * port — the deck's fieldd client subscribing on the window's behalf, EL2), and
 * the door arrives as a prop.
 *
 * MV-3b (MV-D18, M19) — the stream is the MODEL BOARD's feed
 * (`model-replica.ts`, the door's model port), and the stage draws its replica.
 *
 * MV-3d (M35) — and it is the only one. The fold's `full` board stayed beside it
 * for the chrome the model does not serve (the deck's pane frames and
 * launchers, the find sheet, the AR-7 marker), and those read the chrome's facts
 * that ride this desktop's own rows of the model board now (`chrome-facts.ts`).
 * So while Godview is open the window holds one subscription, and a closed
 * Godview holds none (PF6).
 *
 * TWO CONTEXTS, one subscription, and the split is deliberate. The monitor
 * takes the feed itself and draws everything the model and the chrome say. The
 * DECK draws a badge, a readout and a meter, and re-rendering
 * `GhostteaWorkspace` at the daemon's cadence for facts no frame reads would be
 * paying the pane tree for news about a token count — so the deck's value is
 * gated on the frame's own fields and changes only when one of them does.
 */

/** What the deck's frames read: the agent facts per pane session, the run
 * each session belongs to (the verbs' target), and the Stop its run holds
 * (ST-D4 (a), `StopPaneState`). */
export interface DeckAgentFacts {
  agents: ReadonlyMap<string, PaneFrameAgent>;
  runs: ReadonlyMap<string, string>;
  stops: ReadonlyMap<string, AgentStopState>;
}

const EMPTY_DECK_FACTS: DeckAgentFacts = { agents: new Map(), runs: new Map(), stops: new Map() };

const DeckAgentFactsContext = createContext<DeckAgentFacts | undefined>(undefined);
/** `null` is a fact of its own: no door, no model port, or Godview closed. The
 * sentinel below tells "no provider" from it. */
const NO_PROVIDER = Symbol("no GodviewAgentsProvider");
const MonitorFeedContext = createContext<GodviewMonitorFeed | null | typeof NO_PROVIDER>(
  NO_PROVIDER,
);

const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * The deck's facts over this desktop's runs, handed down as the SAME object
 * until a field a frame draws actually moves — the identity rule the monitor's
 * own damage gate uses, so React bails out of the deck's subtree rather than
 * re-rendering the panes. The projection runs once per runs array the chrome
 * hands out (a handful of rows); the provider renders again only when the
 * gated object changes.
 */
function useDeckFacts(chrome: ChromeFacts | null): DeckAgentFacts {
  const held = useRef<{ runs: readonly ChromeRun[] | null; key: string; facts: DeckAgentFacts }>({
    runs: null,
    key: "",
    facts: EMPTY_DECK_FACTS,
  });
  const subscribe = useCallback(
    (listener: () => void) => (chrome === null ? NO_SUBSCRIPTION() : chrome.subscribe(listener)),
    [chrome],
  );
  const read = (): DeckAgentFacts => {
    const runs = chrome?.runs() ?? NO_RUNS;
    const cache = held.current;
    if (runs === cache.runs) return cache.facts;
    const byTerminal = runsByTerminal(runs);
    const agents = paneFrameAgents(byTerminal);
    const sessions = runIdsBySession(byTerminal);
    const stops = stopsBySession(byTerminal);
    const key = paneFrameFactsKey(agents, sessions, stops);
    held.current =
      key === cache.key
        ? { runs, key, facts: cache.facts }
        : { runs, key, facts: { agents, runs: sessions, stops } };
    return held.current.facts;
  };
  return useSyncExternalStore(subscribe, read, read);
}

export function GodviewAgentsProvider({
  door = null,
  subscribed = true,
  children,
}: {
  /** The deck's door (GT-D17). Null before a deck exists — the window then has
   * no feed (`no-door`), which is not the same fact as an empty board. */
  door?: MonitorDoor | null;
  /**
   * PF6, kept where it was. The monitor's subscription used to live inside a
   * stage mounted only while Godview was open, so a closed Godview held none;
   * this provider is mounted beside the DECK, which stays alive across a close
   * on purpose (that is what makes reopening instant). So the ask is gated
   * here instead: false asks the daemon nothing, and the first frame comes back
   * within a tick of reopening.
   */
  subscribed?: boolean;
  children: ReactNode;
}): ReactElement {
  // the model board, on the view host's ONE frame scheduler (M7), so a change
  // reaches the view in the frame it arrived in
  const { feed } = useMonitorReplica(door?.model ?? null, {
    subscribed,
    scheduler: frameScheduler,
  });
  const deckFacts = useDeckFacts(feed?.chrome ?? null);

  return (
    <DeckAgentFactsContext.Provider value={deckFacts}>
      <MonitorFeedContext.Provider value={feed}>{children}</MonitorFeedContext.Provider>
    </DeckAgentFactsContext.Provider>
  );
}

/**
 * LR (2026-10-15) — the monitor drawn over a feed of its owner's choosing: last
 * run's picture, held still (`last-run.ts`), while the window's own
 * subscription stays open beside it for the deck. Null hands the window's own
 * feed through, under the SAME provider, so lifting the picture swaps the
 * replica the views read and remounts nothing.
 */
export function MonitorFeedOverride({
  feed,
  children,
}: {
  feed: GodviewMonitorFeed | null;
  children: ReactNode;
}): ReactElement {
  const own = useContext(MonitorFeedContext);
  return <MonitorFeedContext.Provider value={feed ?? own}>{children}</MonitorFeedContext.Provider>;
}

/** MV-3b — the model board's feed, for the stage that draws the replica and the
 * chrome that reads its runs (MV-3d). Null while there is no door, no model
 * port on it, or Godview is closed — the `no-door` fact, which is not an empty
 * board. Throws outside a provider, like the deck's reader below. */
export function useMonitorFeed(): GodviewMonitorFeed | null {
  const feed = useContext(MonitorFeedContext);
  if (feed === NO_PROVIDER) {
    throw new Error(
      "useMonitorFeed: no GodviewAgentsProvider above this tree — the model board is one subscription per window",
    );
  }
  return feed;
}

/** The frame's facts, for the deck. Throws outside a provider rather than
 * answering an empty field: "nobody subscribed" and "the daemon answered, and
 * nothing is running" are different facts, and only one of them is a bug (the
 * same distinction `no-door` makes on the wire). */
export function useDeckAgentFacts(): DeckAgentFacts {
  const facts = useContext(DeckAgentFactsContext);
  if (facts === undefined) {
    throw new Error(
      "useDeckAgentFacts: no GodviewAgentsProvider above this deck — the pane frame reads the window's one board",
    );
  }
  return facts;
}
