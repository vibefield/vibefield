import { EventEmitter } from "node:events";
import type {
  CallerContext,
  IndexAppsParams,
  IndexAppsResult,
  IndexAppsSource,
  IndexCatalogApp,
  PlaceRef,
  ProjectKey,
  RowsCursor,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { CatalogTable } from "./catalog-rows";
import type { MeshLink, MeshRoster } from "./index-mesh";

// MA-3d (`draft/thinking-mini-apps.md` v0.2 §4, RULED 2026-11-05; the build plan's §3 "3d" as the lead ruled it,
// 2026-11-05 09:30Z) — the made apps across desktops, the AGGREGATOR half. The source half is index-apps.ts (3a:
// this desktop's rosetta library, walked into one `apps` rows table); this file is everything a daemon does with the
// OTHER self desktops' tables, and the fold a window or the phone pages:
//
//   · THE REPLICA. For every self peer the roster lists online, ONE standing `index.apps.catalog.subscribe` (the
//     table's own door, the plan's L1), applied into a RowsCopy and persisted atomically, 0600, at
//     `<dir>/<device>.json` (`dir` is LAYOUT.MESH_APPS_DIR under the user root; daemon.ts joins it, 3e). A peer
//     that sleeps KEEPS its rows (DS-L8). It rides PeerLink directly, as IndexMesh does (index-mesh.ts' header):
//     frames that beat the open answer are buffered, and a replay asks from the copy's CURRENT cursor.
//   · A REFUSAL IS PER TABLE. An older peer has no apps door: its refusal (NOT_FOUND, method-not-found, any
//     non-retryable answer) marks ONLY that peer's apps unsupported, never the peer (the maps' fact 1, H5). Its
//     projects and sessions are IndexMesh's and stay live. It is not asked again until the roster says it returned.
//   · THE STANDING. Every frame the owner sends declares `libraryReady?` and `previewsBase?` (contracts'
//     OWNER_STANDING); the newest frame's pair stands, and a fact a frame lacks is unknown. `sources()` answers it
//     beside each desktop's state, a peer's `previewsBase` only once it passes `artifactRootUrlClaim` with its host
//     equal to that peer's MagicDNS name as the roster authenticates it — else stripped, never rewritten (C16).
//   · THE FOLD (MA-D4). One row per `madeAppFoldKey` (contracts' one composer; never re-spelled here), the newest
//     presentation (`publishedAt ?? capturedAt ?? 0`) serving it, `devices` naming every holder, the serving one
//     first. The merged intent (an injected reader; empty until 3h) drops a hidden app unless `includeHidden`. `q`,
//     `devices`, `projectKey` and `kept` narrow; keyset pages; a tailnet caller's page is cut at
//     INDEX_TAILNET_LIMITS.MAX_ROWS and says `clipped`. The project joins at THIS door through an injected
//     `joinProject` (3e wires ProjectDoors), never from a row (PJ-4), and never for a peer daemon (DS-L4).
//   · ITS OWN PINGS. `changes()` is the shelf's `index.apps.subscribe` (rows always empty). It is never wired to
//     IndexMesh's `change`, so an app's move never regroups the projects (the fieldd map's Q13).
//
// DS-L2: a replica row is served as the device it was subscribed from, whatever it claims. EL2: a row is metadata,
// never a path (contracts refuse one) and never bytes.

/** This desktop's own apps (index-apps.ts' `IndexApps`, 3a), read through its public face alone. */
export interface AppsLocalSource {
  /** the `apps` rows table, keyed by `appId` */
  readonly table: CatalogTable<IndexCatalogApp>;
  /** the first walk landed (DS-L8: no answer before it) */
  readonly ready: boolean;
  /** this desktop's standing as its own frames declare it (`IndexApps.standing()`): rosetta's last
   * `canonical_ready`, and the previews serve's root URL as its own listener reported it (3b). Absent: unknown. */
  standing(): { libraryReady?: boolean; previewsBase?: string };
  /** when the library was last read (epoch ms), for the source's `asOf` */
  readonly heardAt?: number | null | undefined;
  /** `ready` or the standing moved */
  on(event: "changed", listener: () => void): unknown;
  off(event: "changed", listener: () => void): unknown;
}

/** The person's merged keep-and-hide intent, by fold key (the lead's ruling on L8; slice 3h). Until 3h it is
 * empty: no app is kept or hidden. */
export interface MadeAppIntentReader {
  of(foldKey: string): { kept?: true; hidden?: true } | undefined;
  /** the merged intent moved; the answer is how to stop listening */
  onChanged?(listener: () => void): () => void;
}

/** What `joinProject` answers for an app's root session on its desktop (PJ-4, the grouping's key). */
export interface AppProjectJoin {
  projectKey: ProjectKey;
  place?: PlaceRef;
  ink?: number;
}

export interface AppsMeshOptions {
  local: AppsLocalSource;
  roster: MeshRoster;
  link: MeshLink;
  /** where the replicas live (LAYOUT.MESH_APPS_DIR under the user root) */
  dir: string;
  /** the project an app's ROOT session sits in on its desktop (3e: ProjectDoors over the session's cwd) */
  joinProject: (device: string, rootSessionId: string) => AppProjectJoin | undefined;
  /** the merged intent (3h); absent: none */
  intents?: MadeAppIntentReader;
  /** whether a desktop can export a page (RO-A1). Absent: no desktop can, which rosetta 0.1.3 says */
  exportReady?: (device: string) => boolean;
  logger?: Logger;
  now?: () => number;
  /** test seams for the cadences (defaults: INDEX_MESH) */
  staleAfterMs?: number;
  persistIntervalMs?: number;
  replicaMinIntervalMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  changesMinIntervalMs?: number;
}

/** The pings' open answer and lifetime, in ProductAPI's `SubscriptionInstall` shape (IndexMesh.changes'). */
export interface AppsChanges {
  open: unknown;
  start: () => void;
  dispose: () => void;
}

export class AppsMesh extends EventEmitter {
  constructor(_opts: AppsMeshOptions) {
    super();
    this.setMaxListeners(0); // one listener per change subscriber
  }

  /** Load the kept replicas, follow the roster and this desktop's table, and attach every online self peer. */
  start(): void {
    // MA-3d red: the skeleton follows nothing
  }

  /** Stop every subscription and write each replica whose file is behind what was heard. */
  dispose(): void {
    // MA-3d red: the skeleton holds nothing
  }

  // ── the doors (3e registers them) ──

  /** `index.apps.list` — a page of the answering scope's fold. A `tailnet` caller's page is cut at
   * INDEX_TAILNET_LIMITS.MAX_ROWS; a `peer-fieldd` caller (a routed call) is answered this desktop's own apps,
   * with no project column. */
  list(_params: IndexAppsParams, _ctx: CallerContext): IndexAppsResult {
    return { rows: [], sources: [] };
  }

  /** Every desktop's standing in the scope: state, rows, `libraryReady`, a validated `previewsBase`. */
  sources(_scope: "local" | "mesh" = "mesh"): IndexAppsSource[] {
    return [];
  }

  /** `index.apps.subscribe` — invalidation pings: rows always empty, the revision moving when the scope's fold moves
   * (an app on any desktop, a desktop's standing, the merged intent). */
  changes(
    _params: {
      scope?: "local" | "mesh" | undefined;
      since?: RowsCursor | undefined;
      minIntervalMs?: number | undefined;
    },
    _emit: (payload: unknown, kind: "delta" | "snapshot") => void,
  ): AppsChanges {
    return {
      open: { snapshot: { epoch: "apps-changes-unbuilt", revision: 0, rows: [] } },
      start: () => {
        // MA-3d red: no pings
      },
      dispose: () => {
        // MA-3d red: nothing to stop
      },
    };
  }

  /** A peer's replica as the copy holds it, for tests and diagnostics. */
  replica(_device: string): IndexCatalogApp[] | undefined {
    return undefined;
  }
}
