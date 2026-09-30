import type { AgentMonitorState } from "@vibecook/puppeteer-core";
import type {
  MonitorAgent as ViewsMonitorAgent,
  MonitorAgentFacet as ViewsMonitorAgentFacet,
} from "@vibecook/puppeteer-views";
import type { AgentSessionSummary, AgentTier } from "./facet-types";

// THE ROW, since AR-5: the views package's `MonitorAgent` — the one shape
// every view sees, in both apps — plus the facts VibeField keeps beside an
// agent facet for its own chrome and verbs: puppeteer's provider id, the tier,
// the run, the persona, and the fold's row verbatim (`summary`), which is where
// the terminal join (`terminal.runtimeSessionId`, `terminal.replaced`) and the
// continuation live. A view reads the package's shape; this module's readers
// (the door's verbs, the remount, the claims) read the extension. Structural
// subtyping is what lets one array serve both.
//
// The reference app does the same on its side (`renderer/monitor/types.ts`
// there keeps its `AgentSessionInfo` beside the facet), which is the whole
// point of AR-D13a: one view, two hosts, each with its own facts.

export type {
  AgentMonitorProps,
  AgentMonitorView,
  MonitorActions,
  MonitorRemoteFacet,
  MonitorSession,
  MonitorSpawnMenu,
  MonitorSpawnTarget,
  MonitorTheme,
  PaneAttachment,
} from "@vibecook/puppeteer-views";

/** The agent half of a row: the package's facet, and what VibeField adds. */
export interface MonitorAgentFacet extends ViewsMonitorAgentFacet {
  /** puppeteer's provider id, open (AR-L1); the same as `provider.id`. */
  kind: string;
  tier: AgentTier;
  runtimeRunId: string;
  profileId?: string;
  /** AR-S5 — the Agent Profile the run was born under, when fieldd knows it */
  profileSet?: string;
  /** Core's projection, the mirror the fold carries verbatim; absent only
   * before the first monitor state (a starting row). */
  monitor?: AgentMonitorState;
  /** The fold's row, verbatim, for a reader that wants the rest. */
  summary: AgentSessionSummary;
}

export interface MonitorAgent extends Omit<ViewsMonitorAgent, "agent"> {
  agent?: MonitorAgentFacet;
  /** GT-6b — the floor's own id for a live PTY that no pane is showing, and
   * the only thing such a row carries that a verb can act on. It is NOT the
   * package's `session`: that field means the host holds the terminal's
   * summary, and for a row read off `terminal.roster` it does not (no cwd, no
   * activity, no birth time). Views ignore this; the door's select reads it. */
  floorSessionId?: string;
}
