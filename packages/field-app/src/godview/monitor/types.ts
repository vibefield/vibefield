import type { MonitorAgent as ViewsMonitorAgent } from "@vibecook/puppeteer-views";

// THE ROW, since MV-3b: the views package's `MonitorAgent` — the one shape
// every view sees, in both apps — and nothing beside it. Until MV-3 VibeField
// kept its own facts on the agent facet (puppeteer's provider id, the tier, the
// run, the persona, the fold's row verbatim) for its chrome and verbs; the
// backend computes those facts now (MV-D22), the window's verbs read their joins
// off the board rows the fold keeps (`model-board.ts` `HeldModelRow`), and the
// find sheet's native session id is joined from the fold where the sheet reads
// it (`useMonitorAgents.ts` `findAgents`). The reference app does the same on
// its side (`renderer/monitor/types.ts` there), which is the whole point of
// AR-D13a: one view, two hosts, each with its own facts beside the row.

export type {
  AgentMonitorProps,
  AgentMonitorView,
  MonitorActions,
  MonitorAgentFacet,
  MonitorRemoteFacet,
  MonitorSession,
  MonitorSpawnMenu,
  MonitorSpawnTarget,
  MonitorTheme,
  PaneAttachment,
} from "@vibecook/puppeteer-views";

export type MonitorAgent = ViewsMonitorAgent;

/** DS-3 — where a row LIVES, as the device filter's chip names it: the
 * roster's name and OS mark for a device id (`devices.ts`), in VibeField's
 * four OS words (the chip draws `OsMark`). */
export interface MonitorDeviceFacet {
  id: string;
  /** the roster's name for it (a machine's own name) */
  name: string;
  /** its OS, from the roster's `platform`; `unknown` when the roster has none */
  os: "macos" | "windows" | "linux" | "unknown";
  /** this is the desktop the window is on */
  here: boolean;
}
