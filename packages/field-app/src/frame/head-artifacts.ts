import { ArtifactView } from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useSyncExternalStore } from "react";
import { getRendererLogger } from "../logging";
import type { MadeAppsClient } from "./apps/made-apps";

// THE HEAD'S ARTIFACTS (HN-8; PL-D1, PL-D2 ruled by James 2026-10-29; DESIGN.md §8 "The head",
// "Artifacts — the Artifacts shelf's contents"): what the head reads for its package and the
// shelf it opens, beside the controller that reads it. Nothing here is drawn.
// - THE PACKAGE'S DOT is the catalog's STANDING state, read by the head itself over the window's
//   fieldd client (`artifact.subscribe`, on the workspace.read the window's token holds), so it
//   stands while the sheet is shut. A module store (the sync dot's pattern, `doc-sync-store.ts`): FED once inside FielddProvider
//   (FieldView), READ by the pill's package and the covered views' circle, so neither subscribes
//   twice, and a head with no daemon to ask (the catalog, the tests) reads no dot.
// - THE WINDOW'S CLIENT FOR THE SHELF (MA-4c; L14; FL-2; §8 "Artifacts — the Artifacts shelf's
//   contents", as amended 2026-11-09): both groups, Live and From your agents, ask the window's own
//   doors. A module store as the dot's: FED by the same feed, inside FielddProvider, and READ by the
//   head's controller, so a head with no daemon to ask (the catalog, the tests) draws neither group.
// - THE WORDS ARE APPS (MA-D13 (a); §9 "Apps"): "Artifact" is the code's word, never the
//   screen's, so the names here (`ARTIFACTS`, the `artifacts` surface) stay as they are.

/** The package's name at rest — the pill's button and the covered views' circle — and the
 * shelf's, which is Apps on screen (MA-D13 (a); DESIGN.md §9 "Apps"). */
export const ARTIFACTS = "Apps";

/** The titles of the artifacts whose source is unavailable, in the catalog's order. */
export function unavailableSources(artifacts: readonly ArtifactView[]): string[] {
  return artifacts
    .filter((artifact) => artifact.availability === "source-unavailable")
    .map((artifact) => artifact.title);
}

/** The words of the package's dot (DESIGN.md §8 "The head"; §9 "Apps"): STANDING states only, as
 * the sync dot's (C6-4) — orange while a live app's source is unavailable, said by its title, or
 * past one by how many; null, no dot, while every source is there. Every other state is the
 * shelf's. */
export function artifactsDotWords(unavailable: readonly string[]): string | null {
  const [only] = unavailable;
  if (only === undefined) return null;
  if (unavailable.length === 1) return `${ARTIFACTS} — ${only}'s source is unavailable`;
  return `${ARTIFACTS} — ${unavailable.length} sources unavailable`;
}

// The dot's words, or null — the store keeps only what the dot says, so a catalog that moves
// without moving the dot (a preview refreshed, a title changed) re-renders no head.
let current: string | null = null;
const listeners = new Set<() => void>();

/** One whole catalog list, as `artifact.subscribe` sends it. A tolerant reader: a list it cannot
 * read is refused, and the last good reading stands. */
export function setArtifactCatalog(raw: unknown): void {
  const parsed = ArtifactView.array().safeParse(raw);
  if (!parsed.success) {
    getRendererLogger()
      .child({ component: "artifacts.head" })
      .warn("renderer.artifacts.catalog_rejected", "An unreadable artifact catalog was rejected", {
        issue: parsed.error.issues[0]?.message ?? "unknown",
      });
    return;
  }
  const words = artifactsDotWords(unavailableSources(parsed.data));
  if (words === current) return;
  current = words;
  for (const fn of listeners) fn();
}

/** Test seam + boot reset — the feed owns this in the running app. */
export function resetArtifactCatalog(): void {
  current = null;
  for (const fn of listeners) fn();
}

function subscribeArtifactsDot(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readArtifactsDot(): string | null {
  return current;
}

// The window's client, or null — the shelf's two groups ask with it while the shelf shows.
let appsClient: MadeAppsClient | null = null;
const appsListeners = new Set<() => void>();

/** The window's client the shelf's two groups ask with (DESIGN.md §8 "Artifacts — the
 * Artifacts shelf's contents", as amended 2026-11-09): put in by the head's feed inside
 * FielddProvider, and null where no daemon is asked (the catalog, the tests). Test seam + boot
 * reset as well — the feed owns it in the running app. */
export function setHeadAppsClient(client: MadeAppsClient | null): void {
  if (client === appsClient) return;
  appsClient = client;
  for (const fn of appsListeners) fn();
}

function subscribeHeadAppsClient(fn: () => void): () => void {
  appsListeners.add(fn);
  return () => appsListeners.delete(fn);
}

function readHeadAppsClient(): MadeAppsClient | null {
  return appsClient;
}

/** The window's client for the shelf's two groups, or null: neither is drawn. */
export function useHeadAppsClient(): MadeAppsClient | null {
  return useSyncExternalStore(subscribeHeadAppsClient, readHeadAppsClient);
}

/** Mount ONCE inside FielddProvider: streams the catalog into the store, and hands the window's
 * client to the shelf's two groups for as long as it is mounted (MA-4c, FL-2). A reconnect
 * replays a fresh snapshot (the client's P5 law), so the dot heals with it. */
export function useArtifactCatalogFeed(): void {
  const client = useFielddClient();
  const sub = useSubscription("artifact.subscribe", {});
  useEffect(() => {
    if (sub.status === "live" && sub.data !== null) setArtifactCatalog(sub.data);
  }, [sub.status, sub.data]);
  useEffect(() => {
    setHeadAppsClient(client);
    return () => {
      // only its own: a feed that has gone never takes another's client with it
      if (appsClient === client) setHeadAppsClient(null);
    };
  }, [client]);
}

/** The package's dot: the words its tooltip and name say while it stands; null while none. */
export function useArtifactsDot(): string | null {
  return useSyncExternalStore(subscribeArtifactsDot, readArtifactsDot);
}
