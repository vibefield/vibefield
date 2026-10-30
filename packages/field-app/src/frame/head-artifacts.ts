import { ArtifactView, type PluginRegistrySnapshot } from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useState, useSyncExternalStore } from "react";
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
// - WHY THE SHELF HAS NO HUB, in one of four states: the plugin that offers it is off, it can't
//   run, it is opening — or, still opening after 10 s, it isn't starting.

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

/** Why the Artifacts shelf holds no Hub (DESIGN.md §8 "Artifacts"): its plugin is off, it can't
 * run, it is opening, or it isn't starting. */
export type HubWait = "off" | "cant-run" | "opening" | "not-starting";

/** How long the shelf says "Opening Artifacts…" before it says the Hub isn't starting (§8
 * "Artifacts": still opening after 10 s). Nothing in the registry says a Hub failed, so the wait
 * itself is bounded. */
export const HUB_START_BOUND_MS = 10_000;

/** Why the Artifacts shelf holds no Hub, by the registry's `state` of the plugin that offers it —
 * the one contributing `hud.side-panel`, the Browser plugin. "opening" while it is `enabled` and
 * its Hub not yet bound, and before any registry has answered (booting, the daemon away: nothing
 * says it is off). "off" while it is `disabled`, the one state turning it on would help. Otherwise
 * — `invalid` or `incompatible`, on or off, or no plugin offering it at all — "cant-run". Should
 * two offer it, the likelier to bring a Hub speaks. */
export function hubWaits(
  registry: PluginRegistrySnapshot | null,
): Exclude<HubWait, "not-starting"> {
  if (registry === null) return "opening";
  const offering = registry.plugins.filter((plugin) =>
    plugin.contributions.surfaces.some((surface) => surface.slot === "hud.side-panel"),
  );
  if (offering.some((plugin) => plugin.state === "enabled")) return "opening";
  if (offering.some((plugin) => plugin.state === "disabled")) return "off";
  return "cant-run";
}

/** The shelf's wait with the start bounded: an opening that has lasted `HUB_START_BOUND_MS` with
 * no Hub bound says the Hub isn't starting. The clock runs from the moment the wait became
 * "opening", whether or not the shelf shows — a shelf opened onto a long wait says so at once —
 * and starts again with every new opening: a Hub that binds, or a plugin turned off, ends it.
 * `bound`: a Hub is bound, so nothing waits. */
export function useHubWaits(registry: PluginRegistrySnapshot | null, bound: boolean): HubWait {
  const waits = hubWaits(registry);
  const opening = !bound && waits === "opening";
  const [stalled, setStalled] = useState(false);
  if (stalled && !opening) setStalled(false);
  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(() => setStalled(true), HUB_START_BOUND_MS);
    return () => window.clearTimeout(timer);
  }, [opening]);
  return opening && stalled ? "not-starting" : waits;
}
