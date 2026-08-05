import { AppPreferences } from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { useState } from "react";

// The sync-posture question, asked in two places (UA-3/UA-3w): the Account
// page's section and the Setup Assistant's pane 4. Same key, same words, same
// write — a user who answers it in the wizard must not be asked something
// subtly different in Settings a week later.

export type SyncPosture = "automatic" | "opt-in";

/** The posture key as `storage.appPreferences.set` takes it (spec §8). */
export const SYNC_POSTURE_KEY = "mesh.syncPosture";

/** The two cards, verbatim. Copy lives here so both surfaces read identically
 * (DESIGN.md §9: a name survives its flow). */
export const POSTURE_CHOICES = [
  {
    value: "automatic",
    title: "Sync new projects automatically",
    description: "New documents join your mesh as you make them.",
  },
  {
    value: "opt-in",
    title: "Ask per project",
    description: "New documents stay on this device until you say otherwise.",
  },
] as const satisfies readonly { value: SyncPosture; title: string; description: string }[];

/** Tolerant read (design-00): today's daemon shortens `desktop.showTray` to
 * `showTray`, so accept both spellings of the posture key and default to
 * today's behavior. */
export function readPosture(raw: unknown): SyncPosture {
  if (typeof raw !== "object" || raw === null) return "automatic";
  const record = raw as Record<string, unknown>;
  const value = record.syncPosture ?? record[SYNC_POSTURE_KEY];
  return value === "opt-in" ? "opt-in" : "automatic";
}

export interface SyncPostureControl {
  posture: SyncPosture;
  /** The preferences subscription's own state — surfaces say which half of a
   * page is reachable rather than greying out the lot. */
  status: "loading" | "live" | "error";
  /** No live, parseable snapshot — the cards cannot be trusted to write. */
  unavailable: boolean;
  pending: boolean;
  writeError: string | null;
  /** Resolves true when the write landed, so a caller can react to success
   * only (the settings undo stack is one such caller). */
  set(value: SyncPosture): Promise<boolean>;
}

export function useSyncPosture(): SyncPostureControl {
  const client = useFielddClient();
  const subscription = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const parsed = AppPreferences.safeParse(subscription.data);

  return {
    posture: readPosture(subscription.data),
    status: subscription.status,
    unavailable: subscription.status !== "live" || !parsed.success,
    pending,
    writeError,
    set: async (value) => {
      setPending(true);
      setWriteError(null);
      try {
        await client.request("storage.appPreferences.set", { key: SYNC_POSTURE_KEY, value });
        return true;
      } catch (error) {
        setWriteError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setPending(false);
      }
    },
  };
}
