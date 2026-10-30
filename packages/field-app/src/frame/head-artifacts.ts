import { ArtifactView, type PluginRegistrySnapshot } from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useSyncExternalStore } from "react";
import { getRendererLogger } from "../logging";

// THE HEAD'S ARTIFACTS (HN-8; PL-D1, PL-D2 ruled by James 2026-10-29; DESIGN.md §8 "The head",
// "Artifacts — the Artifacts shelf's contents"): what the head reads for its package and the
// shelf it opens, beside the controller that reads it. Nothing here is drawn.
// - THE PACKAGE'S DOT is the catalog's STANDING state, read by the head itself over the window's
//   fieldd client (`artifact.subscribe`, on the workspace.read the window's token holds) — never
//   through the Hub — so it stands while the sheet is shut and whether the Hub runs or not. A
//   module store (the sync dot's pattern, `doc-sync-store.ts`): FED once inside FielddProvider
//   (FieldView), READ by the pill's package and the covered views' circle, so neither subscribes
//   twice, and a head with no daemon to ask (the catalog, the tests) reads no dot.
// - WHY THE SHELF HAS NO HUB: the plugin that offers it is off, or it is starting.

/** The package's name at rest — the pill's button and the covered views' circle. */
export const ARTIFACTS = "Artifacts";

/** The titles of the artifacts whose source is unavailable, in the catalog's order. */
export function unavailableSources(artifacts: readonly ArtifactView[]): string[] {
  return artifacts
    .filter((artifact) => artifact.availability === "source-unavailable")
    .map((artifact) => artifact.title);
}

/** The words of the package's dot (DESIGN.md §8 "The head"): STANDING states only, as the sync
 * dot's (C6-4) — orange while an artifact's source is unavailable, said by its title, or past one
 * by how many; null, no dot, while every source is there. Every other state is the shelf's. */
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

/** Mount ONCE inside FielddProvider: streams the catalog into the store. A reconnect replays a
 * fresh snapshot (the client's P5 law), so the dot heals with it. */
export function useArtifactCatalogFeed(): void {
  const sub = useSubscription("artifact.subscribe", {});
  useEffect(() => {
    if (sub.status === "live" && sub.data !== null) setArtifactCatalog(sub.data);
  }, [sub.status, sub.data]);
}

/** The package's dot: the words its tooltip and name say while it stands; null while none. */
export function useArtifactsDot(): string | null {
  return useSyncExternalStore(subscribeArtifactsDot, readArtifactsDot);
}

/** Why the Artifacts shelf holds no Hub (DESIGN.md §8 "Artifacts"): "off" while the plugin that
 * offers it — the one contributing `hud.side-panel` — is not on, or none offers it; otherwise
 * "opening": it is starting or restarting. With no registry yet (booting, the daemon away)
 * nothing says it is off, so the shelf waits as it would for a start. */
export function hubWaits(registry: PluginRegistrySnapshot | null): "off" | "opening" {
  if (registry === null) return "opening";
  const offered = registry.plugins.some(
    (plugin) =>
      plugin.state === "enabled" &&
      plugin.contributions.surfaces.some((surface) => surface.slot === "hud.side-panel"),
  );
  return offered ? "opening" : "off";
}
