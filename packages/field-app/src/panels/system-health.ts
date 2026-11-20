import { SystemHealthV1 } from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useMemo, useRef } from "react";
import { getRendererLogger } from "../logging";

/** Item 600 (2026-11-19): fieldd's `system.health.subscribe` as the Settings sections read it, through contracts'
 * SystemHealthV1 (the tolerant reader). `health` is null before the first answer and while an answer does not read
 * as the contract; `unreadable` says the second, so a section shows its unavailable words for it, never a blank and
 * never a half-read answer. */
export interface SystemHealthRead {
  health: SystemHealthV1 | null;
  unreadable: boolean;
  /** the stream's own error */
  error: Error | null;
}

export function useSystemHealth(): SystemHealthRead {
  const sub = useSubscription("system.health.subscribe");
  const read = useMemo(
    () => (sub.data === null ? null : SystemHealthV1.safeParse(sub.data)),
    [sub.data],
  );
  const unreadable = read !== null && !read.success;
  // said once each time the stream turns unreadable, by the paths and codes alone (an answer's values, the serves'
  // capability URLs among them, are never logged)
  const said = useRef(false);
  useEffect(() => {
    if (read === null || read.success) {
      said.current = false;
      return;
    }
    if (said.current) return;
    said.current = true;
    getRendererLogger()
      .child({ component: "settings.health" })
      .warn(
        "renderer.health.unreadable",
        "fieldd's health answer does not read as SystemHealthV1",
        {
          issues: read.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`),
        },
      );
  }, [read]);
  return { health: read?.success ? read.data : null, unreadable, error: sub.error };
}
