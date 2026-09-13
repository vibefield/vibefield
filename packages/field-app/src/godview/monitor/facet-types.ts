import type {
  AgentMonitorMirror,
  AgentProviderSummary,
  AgentSessionSummary,
  AgentStatus,
  AgentTier,
} from "@vibefield/contracts";

// The agent shapes the monitor reads — TYPE IMPORTS since AR-3, exactly as
// GT-D13 promised: the source behind the seam is fieldd's fold, and its row is
// the contract's `AgentSessionSummary` (SessionSummary v2, AR-D4). Nothing here
// is mirrored from a runtime package any more, and nothing here enumerates a
// vendor (AR-L1): `kind` is puppeteer's open provider id, `label` the
// adapter's own name for it, and the monitor projection rides verbatim under
// `monitor` for a view that wants more than the fold derived.
//
// The TERMINAL half stays what it was: `SessionSummary` from
// `@vibecook/ghosttea-protocol`, because a monitor row IS a floor session and
// the deck already holds one per pane.

export type {
  AgentMonitorMirror,
  AgentProviderSummary,
  AgentSessionSummary,
  AgentStatus,
  AgentTier,
};

/** puppeteer's provider id, OPEN. The union of four this used to be was the
 * last vendor enumeration in the renderer (AR-L1). */
export type AgentKind = string;

/** Latest trustworthy context-window measurement for an agent session, as the
 * views draw it. `usedPercent` is exact and unrounded in the inclusive range
 * 0..100 — the views round it themselves, because how much precision to show
 * is presentation. Derived from `AgentMonitorMirror.context` by the projection. */
export interface ContextWindowRuntimeState {
  usedTokens: number;
  capacityTokens: number;
  usedPercent: number;
  modelId?: string;
  updatedAt: string;
}
