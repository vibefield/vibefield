import type { AgentMonitorState } from "@vibecook/puppeteer-core";
import type {
  MonitorAgent as ViewsMonitorAgent,
  MonitorAgentFacet as ViewsMonitorAgentFacet,
} from "@vibecook/puppeteer-views";
import type { AgentFieldRow } from "@vibefield/contracts";
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
   * before the first monitor state (a starting row) — and always on another
   * desktop's run, whose mirror never crosses (DS-3: its desk row does). */
  monitor?: AgentMonitorState;
  /** The fold's row, verbatim, for a reader that wants the rest. A run on THIS
   * desktop carries it; one on another desktop carries `remoteRow` instead. */
  summary?: AgentSessionSummary;
  /** DS-3 — another desktop's run as its owner sent it on the mesh board: a
   * field row (the contract the board validates), which on the desk board also
   * carries the reply line, the blocker's question and the cost
   * (`AgentDeskRow`'s extras, read tolerantly by `mesh-rows.ts`). */
  remoteRow?: AgentFieldRow;
}

/** DS-3 — where a row LIVES: the device facet the views take beside `remote`
 * (pu-device's `MonitorAgent.device`, consumed at the next pin move; the shape
 * is the same so the swap is a type change, not a mapping). VibeField maps it
 * from the roster (`devices.ts`); the views draw it as the OS's mark. */
export interface MonitorDeviceFacet {
  id: string;
  /** the roster's name for it (a machine's own name) */
  name: string;
  /** its OS, from the roster's `platform`; `unknown` when the roster has none */
  os: "macos" | "windows" | "linux" | "unknown";
  /** this is the desktop the window is on */
  here: boolean;
}

export interface MonitorAgent extends Omit<ViewsMonitorAgent, "agent"> {
  agent?: MonitorAgentFacet;
  /** GT-6b — the floor's own id for a live PTY that no pane is showing, and
   * the only thing such a row carries that a verb can act on. It is NOT the
   * package's `session`: that field means the host holds the terminal's
   * summary, and for a row read off `terminal.roster` it does not (no cwd, no
   * activity, no birth time). Views ignore this; the door's select reads it. */
  floorSessionId?: string;
  /** DS-3 — the desktop this row lives on; every row carries one once the
   * roster has answered (this desktop's rows say `here`). */
  device?: MonitorDeviceFacet;
}
