import { type DocSyncStatus, DocSyncStatusList } from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useSyncExternalStore } from "react";
import { getRendererLogger } from "./logging";

// C6-4 — per-doc sync standing, renderer-side (board-status pattern: a
// module-level store so the file pill and the Settings Mesh section read it
// without prop threading). FED by useDocSyncFeed (mounted once inside
// FielddProvider); snapshot and every delta carry the whole list, so the
// store never patches.
//
// null = the stream has not answered yet (booting, daemon away). An EMPTY
// list is different and MEANINGFUL: sync has nothing to say — no peers, mesh
// off, no traffic — and the honest rendering of both is quiet, never an
// error and never a blank pretending to be knowledge.

let current: DocSyncStatusList | null = null;
const listeners = new Set<() => void>();

export function setDocSyncStatuses(raw: unknown): void {
  const parsed = DocSyncStatusList.safeParse(raw);
  if (!parsed.success) {
    // tolerant reader: refuse junk, keep the last good list
    getRendererLogger()
      .child({ component: "docs.sync" })
      .warn("renderer.docs.sync_status_rejected", "An unreadable sync status list was rejected", {
        issue: parsed.error.issues[0]?.message ?? "unknown",
      });
    return;
  }
  current = parsed.data;
  for (const fn of listeners) fn();
}

/** Test seam + boot reset — the feed owns this in the running app. */
export function resetDocSyncStatuses(): void {
  current = null;
  for (const fn of listeners) fn();
}

export function getDocSyncStatuses(): DocSyncStatusList | null {
  return current;
}

export function subscribeDocSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Mount once inside FielddProvider: streams doc.sync.subscribe into the
 * store. Reconnect replays with a fresh snapshot (client P5 law). */
export function useDocSyncFeed(): void {
  const sub = useSubscription("doc.sync.subscribe", {});
  useEffect(() => {
    if (sub.status === "live" && sub.data !== null) setDocSyncStatuses(sub.data);
  }, [sub.status, sub.data]);
}

export function useDocSyncStatuses(): DocSyncStatusList | null {
  return useSyncExternalStore(subscribeDocSync, getDocSyncStatuses);
}

/** The one doc the file pill cares about; null while unknown or quiet. */
export function useDocSyncStatusFor(docId: string | undefined): DocSyncStatus | null {
  const statuses = useDocSyncStatuses();
  if (docId === undefined || statuses === null) return null;
  return statuses.find((s) => s.docId === docId) ?? null;
}
