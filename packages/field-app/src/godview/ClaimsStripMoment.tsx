import type { ReactElement } from "react";
import { ApprovalWaitMoment } from "./ApprovalWaitMoment";
import { useMonitorMomentRows } from "./monitor/moment-rows";

// The claims strip's moment (DESIGN.md §8 "Asking again"; TS-D20b ruled A by
// James 2026-10-29): the approval line (TS-4b). *Amended 2026-11-06 (UM-D23;
// the lead's ruling 5, ‹for James›):* the limit moment left the strip for the
// profiles column's add (`ProfilesColumn`), so the strip holds this line alone
// and the two are independent — TS-D20b's reason, one strip with room for one
// moment, the limit moment first, is gone.

export function ClaimsStripMoment({
  offersConnect,
}: {
  /** this Mac is in the ordinary unconnected state (`useOffersConnect`) */
  offersConnect: boolean;
}): ReactElement {
  const rows = useMonitorMomentRows();
  return <ApprovalWaitMoment rows={rows} offersConnect={offersConnect} />;
}
