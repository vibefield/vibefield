import { type ReactElement, useState } from "react";
import { ApprovalWaitMoment } from "./ApprovalWaitMoment";
import { LimitMoment } from "./LimitMoment";
import { useMonitorMomentRows } from "./monitor/moment-rows";

// The claims strip's moments (DESIGN.md §8 "The moments" and "Asking again";
// TS-D20b ruled A by James 2026-10-29): the strip says one moment at a time,
// the limit moment first. The approval line (TS-4b) is said only while the
// limit moment is not showing, and stands aside while it is.

export function ClaimsStripMoment({
  openNewProfile,
  offersConnect,
}: {
  /** the limit moment's Add a profile…; absent while Settings is open */
  openNewProfile?: (() => void) | undefined;
  /** this Mac is in the ordinary unconnected state (`useOffersConnect`) */
  offersConnect: boolean;
}): ReactElement {
  const rows = useMonitorMomentRows();
  const [limitShown, setLimitShown] = useState(false);
  return (
    <>
      <LimitMoment openNewProfile={openNewProfile} onShown={setLimitShown} />
      <ApprovalWaitMoment rows={rows} offersConnect={offersConnect} held={limitShown} />
    </>
  );
}
