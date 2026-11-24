import { type ReactElement, useEffect, useReducer } from "react";
import { VitalsView } from "./VitalsView";
import { EMPTY_FEED, reduceFeed, type VitalsDoor } from "./vitals-feed";

// VT-2 (track VT, 2026-11-24) — the Vitals window's controller: it hears the host's one stream and hands the view
// what the stream folded to. The view is controller-free (docs/UI_SYSTEM.md); the catalog mounts it over fixtures.

export function Vitals({ door }: { door: VitalsDoor }): ReactElement {
  const [feed, dispatch] = useReducer(reduceFeed, EMPTY_FEED);
  useEffect(() => door.subscribe(dispatch), [door]);
  return <VitalsView model={feed.model} logs={feed.logs} />;
}
