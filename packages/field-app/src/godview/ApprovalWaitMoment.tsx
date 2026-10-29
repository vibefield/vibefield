import type { AppPreferences } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import {
  APPROVAL_WAIT_MOMENT,
  type ApprovalWaitFact,
  type ApprovalWaitRow,
  ApprovalWaits,
  approvalWaitOpen,
  approvalWaitStands,
} from "../account/approval-wait";
import {
  APPROVAL_WAIT_ACT,
  APPROVAL_WAIT_DISMISS,
  APPROVAL_WAIT_LINE,
  approvalWaited,
} from "../account/link";
import { requestShellPresentation } from "../field/shell-presentation";
import { useSetupLedger } from "../setup/ledger";

// TS-4b (TS-D20 ruled A, and TS-D20b ruled A, the claims strip, by James
// 2026-10-29; DESIGN.md §8 "Asking again") — the line after an approval that
// waited more than ten minutes, as the wait clears: the agent, as its own mark
// and its project; "It waited 14m for you."; the phone's line; Connect your
// devices; and ×. Drawn in the claims strip's moment chrome (the limit
// moment's), so the strip says one moment the one way, the limit moment first
// (`ClaimsStripMoment.tsx`).

/** The row itself, controller-free, so the catalog mounts the shipping face.
 * Each act is handed the element it was pressed on. */
export function ApprovalWaitCard({
  fact,
  canConnect = true,
  leaving = false,
  onConnect,
  onDismiss,
}: {
  fact: ApprovalWaitFact;
  /** whether Settings can be opened from here now */
  canConnect?: boolean;
  /** × was pressed: the row goes back the way it came (M4) */
  leaving?: boolean;
  onConnect: (from: HTMLElement) => void;
  onDismiss: (from: HTMLElement) => void;
}): ReactElement {
  const titleId = useId();
  const lineId = useId();
  return (
    <section
      className="vf-monitor-moment"
      data-moment="approval-wait"
      data-leaving={leaving ? "" : undefined}
      aria-labelledby={titleId}
      aria-describedby={lineId}
    >
      <span className="vf-monitor-moment-plan">
        {fact.provider === undefined ? null : <AgentIcon providerId={fact.provider.id} />}
        <span>{fact.project || fact.provider?.label}</span>
      </span>
      <span id={titleId} className="vf-monitor-moment-title">
        {approvalWaited(fact.waitedMs)}
      </span>
      <span id={lineId} className="vf-monitor-moment-line">
        {APPROVAL_WAIT_LINE}
      </span>
      <span className="vf-monitor-moment-acts">
        <button
          type="button"
          className="vf-monitor-moment-act"
          data-variant="primary"
          disabled={!canConnect}
          onClick={(event) => onConnect(event.currentTarget)}
        >
          {APPROVAL_WAIT_ACT}
        </button>
        <button
          type="button"
          className="vf-monitor-moment-act"
          data-act="dismiss"
          aria-label={APPROVAL_WAIT_DISMISS}
          title={APPROVAL_WAIT_DISMISS}
          onClick={(event) => onDismiss(event.currentTarget)}
        >
          <FieldGlyph name="close" size={10} />
        </button>
      </span>
    </section>
  );
}

/** The retract's length (DESIGN.md §6): the row is unmounted when it ends. */
const LEAVE_MS = 180;

/** The approval line's controller. It watches the rows its host lends (this
 * window's model rows), and says the line once, as an approval of this Mac's
 * agent that waited more than ten minutes clears, when the nudge's rules allow
 * it: this Mac not connected, the switch on, the place open in the setup
 * ledger. A saying is written `connect-ask:approval-wait` asked before the row
 * shows; a refused write keeps this window's quiet. The row stands until ×, its
 * act, or the agent's next state change. */
export function ApprovalWaitMoment({
  rows,
  offersConnect,
  held = false,
}: {
  rows: readonly ApprovalWaitRow[];
  /** this Mac is in the ordinary unconnected state (`useOffersConnect`) */
  offersConnect: boolean;
  /** another moment holds the strip: a wait that clears now is not said, and
   * a line already said stands aside until the strip is free */
  held?: boolean;
}): ReactElement | null {
  const client = useFielddClient();
  const ledger = useSetupLedger();
  const preferences = useSubscription<AppPreferences>("storage.appPreferences.subscribe");
  const asksOn = preferences.status === "live" ? (preferences.data?.connectAsks ?? true) : null;
  const waits = useRef<ApprovalWaits | null>(null);
  // said in this window: quiet before the ledger's echo, and for good if its write is refused
  const said = useRef(false);
  const [shown, setShown] = useState<ApprovalWaitFact | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    waits.current ??= new ApprovalWaits();
    const cleared = waits.current.observe(rows);
    const fact = cleared[0];
    if (fact === undefined || said.current || held) return;
    if (!approvalWaitOpen({ offersConnect, asksOn, ledger, now: Date.now() })) return;
    said.current = true;
    setShown(fact);
    client
      .request("setup.moment", { moment: APPROVAL_WAIT_MOMENT, state: "asked" })
      .catch(() => undefined);
  }, [client, rows, held, offersConnect, asksOn, ledger]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setShown(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  // the next state change, or the link landing, takes the row away at once
  if (shown === null || held || !offersConnect || !approvalWaitStands(shown, rows)) return null;
  return (
    <ApprovalWaitCard
      fact={shown}
      leaving={leaving}
      onConnect={() => {
        requestShellPresentation("open-connect");
        setShown(null);
      }}
      onDismiss={() => setLeaving(true)}
    />
  );
}
