import { AppPreferences, deskLightValues } from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useMemo } from "react";
import { storeDeskLight } from "./desk-light-live";

/**
 * Item 583 — the person's light, from fieldd to this window's desks: the field's view subscribes to the app's
 * preferences and puts the light's rows in the window's store (`desk-light-live.ts`), where the stage reads them.
 * - Read tolerantly: a snapshot this build cannot parse leaves the light as it was.
 * - A preference that cannot be read at all (the subscription failed) is every row at its rest: a desk under the
 *   default light, never a desk waiting for a light that will not come.
 * - While the subscription is being asked again, the light stays what it last was.
 * - One reading per snapshot. A snapshot that says the same light again changes nothing: the store compares the
 *   rows by value.
 */
export function useDeskLightBridge(): void {
  const { data, status } = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const failed = status === "error";
  const values = useMemo(() => {
    const parsed = AppPreferences.safeParse(data);
    if (parsed.success) return deskLightValues(parsed.data.deskLight);
    return failed ? deskLightValues(undefined) : null;
  }, [data, failed]);
  useEffect(() => {
    if (values !== null) storeDeskLight(values);
  }, [values]);
}
