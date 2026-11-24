import { type ReactElement, useCallback, useEffect, useReducer } from "react";
import { VitalsView } from "./VitalsView";
import { useVitalsCaptures } from "./vitals-captures-door";
import { EMPTY_FEED, reduceFeed, type VitalsDoor } from "./vitals-feed";

// VT-2 (track VT, 2026-11-24) — the Vitals window's controller: it hears the host's one stream and hands the view
// what the stream folded to. The view is controller-free (docs/UI_SYSTEM.md); the catalog mounts it over fixtures.

export function Vitals({ door }: { door: VitalsDoor }): ReactElement {
  const [feed, dispatch] = useReducer(reduceFeed, EMPTY_FEED);
  useEffect(() => door.subscribe(dispatch), [door]);
  const capture = useVitalsCaptures(door.captures);
  // VT-4b — the one ask the window makes: an incident whole, which main reads for it
  const openIncident = useCallback((id: string) => door.openIncident?.(id), [door]);
  return (
    <VitalsView
      model={feed.model}
      logs={feed.logs}
      incidents={feed.incidents}
      {...(capture === null ? {} : { capture })}
      {...(door.openIncident !== undefined ? { onOpenIncident: openIncident } : {})}
    />
  );
}
