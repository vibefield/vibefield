import type { AssetRef, ImageVariant, RosettaClient } from "@vibefield/rosetta-protocol";
import type { AssetSource } from "@vibefield/rosetta-room";

// THE ROOM'S ASSET SOURCE (AR-8c; AR-D40 (a)). An `<img src>` cannot carry a
// credential, and rosettad wants one on every route once it runs with a bearer
// (RO-1). So an image the room draws is READ through a session's client —
// every grant opens every asset (rosetta AUTH.md §5.4) — into an object URL,
// and the URLs this source made are BOUNDED: the oldest is revoked when one
// more would pass the bound, and all of them when the view goes away. The room
// asks again on every mount and every retry, so an evicted image is fetched
// again, never handed a dead URL; a failure is answered null (the room draws
// its "could not load" face with Retry) and never kept.

/** How many object URLs the History room's images may hold at once. A long
 * transcript's images past it are fetched again when they are shown again
 * (AR-D40: a URL-borne grant upstream only if this bound bites). */
export const HISTORY_ASSET_URL_LIMIT = 192;

export interface AssetSourceOptions {
  readonly limit?: number;
  /** test seams: the browser's object-URL pair */
  readonly createObjectURL?: (blob: Blob) => string;
  readonly revokeObjectURL?: (url: string) => void;
}

/** The source, and what its host asks of it beyond the room. */
export interface HistoryAssetSource extends AssetSource {
  /** How many object URLs it holds now. */
  readonly size: number;
  /** Revoke every URL it made (the view unmounting). */
  dispose(): void;
}

/** rosettad's own content-addressed route: ONE path segment under
 * `/api/assets/`, named `<digest>.<extension>` (rosetta `auth.rs`
 * `GRANT_ASSET_ROUTE`, which any live read grant opens). */
const ASSET_ROUTE = /^\/api\/assets\/([^/?#]+)\.[a-z0-9]+$/i;

/** The member's address when the timeline names rosettad's own route for it —
 * a PATH, so it stays true when the daemon comes back on another port — else
 * null. */
export function storedAssetPath(asset: AssetRef): string | null {
  const route = ASSET_ROUTE.exec(asset.url);
  return route !== null && route[1] === asset.digest ? asset.url : null;
}

/** The path and query of one rendition under the client's origin — rosetta's
 * own spelling (`RosettaClient.imageAssetUrl`: the rendition's member when the
 * timeline names one, else the full member asked for that recipe). */
function renditionOf(
  client: RosettaClient,
  asset: AssetRef,
  variant: ImageVariant,
): { ref: AssetRef; mediaType: string } {
  const url = new URL(client.imageAssetUrl(asset, variant));
  const rendition = variant === "full" ? asset : (asset.image_variants?.[variant] ?? asset);
  return {
    ref: { ...rendition, url: `${url.pathname}${url.search}` },
    mediaType: rendition.media_type,
  };
}

export function assetSourceOver(
  sessions: { anyClient(): RosettaClient | null },
  options: AssetSourceOptions = {},
): HistoryAssetSource {
  const limit = Math.max(1, options.limit ?? HISTORY_ASSET_URL_LIMIT);
  const create = options.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revoke = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  /** key → object URL, oldest first (a hit moves to the end) */
  const urls = new Map<string, string>();
  const inFlight = new Map<string, Promise<string | null>>();
  let disposed = false;

  const keep = (key: string, url: string): void => {
    urls.set(key, url);
    while (urls.size > limit) {
      const oldest = urls.keys().next().value;
      if (oldest === undefined) break;
      const evicted = urls.get(oldest);
      urls.delete(oldest);
      if (evicted !== undefined) revoke(evicted);
    }
  };

  return {
    get size() {
      return urls.size;
    },
    imageAssetUrl(asset, variant) {
      const key = `${asset.digest}\u0000${variant}`;
      const held = urls.get(key);
      if (held !== undefined) {
        urls.delete(key);
        urls.set(key, held);
        return held;
      }
      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;
      const client = sessions.anyClient();
      if (client === null || disposed) return null;
      const read = (async (): Promise<string | null> => {
        try {
          const { ref, mediaType } = renditionOf(client, asset, variant);
          const bytes = await client.readAsset(ref);
          if (disposed) return null;
          const url = create(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mediaType }));
          keep(key, url);
          return url;
        } catch {
          return null;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, read);
      return read;
    },
    // The room never LOADS this address: it is the attachment's identity and
    // its can-open gate, and only when it answers does the room ask for the
    // image's renditions above — so while it answered null every recorded
    // image read "Image data was not recorded" (fixed 2026-10-08). Full bytes
    // ride the session's client (`readAsset`, the grant). The room opens only
    // an optimized image; another kind stays "Attachment preview
    // unavailable", as in rosetta's own app.
    attachmentAssetUrl: storedAssetPath,
    dispose() {
      disposed = true;
      for (const url of urls.values()) revoke(url);
      urls.clear();
      inFlight.clear();
    },
  };
}
