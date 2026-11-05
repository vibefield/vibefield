// MA-3b — the made-app service (`draft/thinking-mini-apps.md` v0.2 §4.4–§4.6, RULED 2026-11-05; the build plan's
// §3 "3b" as the lead's RULINGS amend it). A made app is a page an agent presented, which rosetta keeps; this desktop
// serves one ONLY when a person opens it (MA-L3), at the app's own origin, for life (MA-L6, an origin includes its
// host). This service owns that serve, as AH's ArtifactService owns a live artifact's, and nothing else:
//  - the private registry `registries/field.made-apps.v1.json` (`MadeAppRegistry`, atomic 0600, an unreadable file
//    moved aside), one `MadeAppServeRecord` per app it has served: its port for life, its preview id, the folder it
//    serves and the serve ids being retired. Never replicated, never answered by a door.
//  - `open`: the honest refusals (`MADE_APP_OPEN`), the export through an injected `MadeAppExporter` (RO-A1; at
//    rosetta 0.1.3 the injected one answers `export-unbuilt`, the lead's C9) into `artifacts/made/<appId>/<digest>/`,
//    the port by the made rule over the ONE reservation set it shares with AH, the declare, and the URL its listener
//    reported, validated against the app's port and this desktop's MagicDNS name and stripped when it fails (C16:
//    validate or strip, never rewrite).
//  - the idle close at MADE_APP_LIMITS.IDLE_CLOSE_MS from the last open, on one timer to the next due close; kept and
//    hidden come from an injected intent reader (slice 3h writes the intent; until then nothing is kept or hidden).
//  - the shared ceiling: open made serves and AH's objects together under ARTIFACT_LIMITS.LOCAL_OBJECTS.
//  - the previews serve: ONE standing serve per desktop over `artifacts/made-previews/` only (the lead's L12), its
//    port by the made rule over the device id; after each capture the JPEG is HARD-LINKED there (`fs.link`, never a
//    read), and a hidden app's link is removed.
//  - the capture: owed at the first serve and on a new page digest, run at the next open on this desktop (L11; no
//    window-show event, never a timer).
// `artifact.mark` (the person's intent, slice 3h) and `reveal` (the home's shell.openLink, slice 3e) are NOT this
// service's. It never handles page or image bytes (EL2): it names folders, and Electron and truffle move the bytes.
//
// RED (MA-3b, 2026-11-05): every export below is declared with its final signature; the bodies return
// wrong-but-typed values until the green commit. `made-app-service.test.ts` holds the rows.

import type {
  ArtifactOpenResult,
  IndexCatalogApp,
  MadeAppAvailability,
  MadeAppOpenRefusal,
  MadeAppPreview,
  ShellWebContentsCaptureArtifactPreviewParams,
  ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { ArtifactServeBridge, CanonicalServingConfigV1 } from "./artifact-service";
import type { ServeSpec } from "./mesh-client";
import { RpcCallError } from "./native-link";

/** Every made serve id starts here, inside AH's `artifact-` namespace (ARTIFACT_SERVE_PREFIX): MeshClient then adopts
 * a live one across a fieldd restart and never removes one as a stray (mesh-client.ts), so this service's durable
 * retirement is the only road a made serve goes down. An app's id is `artifact-made-<appId[0..16]>-<fingerprint>`. */
export const MADE_APP_SERVE_PREFIX = "artifact-made-";
/** The previews serve's id: `artifact-made-previews-<fingerprint>`. No app id can collide with it: an app's id is hex. */
export const MADE_PREVIEWS_SERVE_PREFIX = "artifact-made-previews-";
/** The technical names truffle carries for the two serves. */
export const MADE_APP_SERVE_NAME_PREFIX = "made-app:";
export const MADE_PREVIEWS_SERVE_NAME = "made-app-previews";

/** The made rule's first candidate for an app's port: AH-D4's derivation over the same range with
 * MADE_APP_PORT_DOMAIN + appId (artifacts.ts). The service then probes linearly over the shared reservations. */
export function madeAppPortCandidate(_appId: string): number {
  return 0;
}

/** The made rule's first candidate for this desktop's previews serve: MADE_APP_PREVIEWS_PORT_DOMAIN + deviceId. */
export function madeAppPreviewsPortCandidate(_deviceId: string): number {
  return 0;
}

/** What one app's serve is made of. `allow` is the canonical audience (the linked login's escaped glob), derived at
 * every declare so a re-link re-gates (L7). */
export interface MadeAppServeInput {
  appId: string;
  listenPort: number;
  allow: readonly string[];
  /** `artifacts/previews/<previewId>`: where Electron's capture writes (the `/.vibefield/preview` route). */
  previewDir: string;
  /** `artifacts/made/<appId>/<digest>`: the runnable document rosetta's export wrote (the `/` route). */
  folder: string;
}

/** An app's complete serving config, whose digest its serve id carries: AH's routes form (preview route, then the
 * folder), key-sorted by `canonicalJson`, route order kept. Pinned by `made-app-serving.vector.json`. */
export function canonicalMadeAppServingConfig(_input: MadeAppServeInput): CanonicalServingConfigV1 {
  return { v: 1, listenPort: 0, tls: true, allow: [], routes: [] };
}

export function madeAppServeId(_input: MadeAppServeInput): string {
  return "";
}

/** What the previews serve is made of: one folder, `artifacts/made-previews`, and nothing else. */
export interface MadePreviewsServeInput {
  listenPort: number;
  allow: readonly string[];
  dir: string;
}

export function canonicalMadePreviewsServingConfig(
  _input: MadePreviewsServeInput,
): CanonicalServingConfigV1 {
  return { v: 1, listenPort: 0, tls: true, allow: [], routes: [] };
}

export function madePreviewsServeId(_input: MadePreviewsServeInput): string {
  return "";
}

/** A refusal state `artifact.open` answers (`MADE_APP_OPEN`). */
export type MadeAppRefusalState = MadeAppOpenRefusal["state"];

/** `artifact.open`'s refusal, worded as MADE_APP_OPEN documents it: UNAVAILABLE, its retryability by state, and
 * `{service: "apps", state, device?}` (`MadeAppOpenRefusal`). An injected exporter words `export-unbuilt` with it. */
export function madeAppRefusal(_state: MadeAppRefusalState, _device?: string): RpcCallError {
  return new RpcCallError("INTERNAL", "MA-3b red: no refusal is worded yet", true);
}

/** RO-A1's export, as fieldd asks it: rosetta writes the runnable document of one presentation into `into` (a folder
 * under `artifacts/made/`), never fieldd. */
export interface MadeAppExportRequest {
  sessionId: string;
  publicationId: string;
  into: string;
}

/** RO-A1's answer: whether it wrote (false: the folder already held this digest and shell), rosetta's digest of the
 * page, its shell's version and the hosts the shell loads from (MA-L9, as data). */
export interface MadeAppExport {
  written: boolean;
  digest: string;
  shellVersion: string;
  hosts: string[];
}

/** The export seam (the lead's C9): slice 3e injects one over `IndexService.exportArtifact`. At rosetta 0.1.3 it
 * throws `madeAppRefusal("export-unbuilt")`; any other failure it throws is worded `export-failed`. */
export interface MadeAppExporter {
  export(request: MadeAppExportRequest): Promise<MadeAppExport>;
}

/** One presentation of an app, for an open that names an older version (Versions). */
export interface MadeAppPresentation {
  presentationId: string;
  sessionId: string;
  digest?: string;
  availability: MadeAppAvailability;
}

/** THIS desktop's library, as slice 3a reads it (`IndexApps`); 3e wires it. */
export interface MadeAppRows {
  /** The newest presentation's row of one app, or undefined when the library holds none. */
  get(appId: string): IndexCatalogApp | undefined;
  /** rosetta's `canonical_ready`: false while the library is still reading its history. */
  libraryReady(): boolean;
  /** One presentation of an app (3a's `IndexService.artifacts({artifactId})`), or undefined. */
  presentation(appId: string, presentationId: string): Promise<MadeAppPresentation | undefined>;
}

/** The person's intent for one fold key (`madeAppFoldKey`), merged, as slice 3h reads it from the settings document. */
export interface MadeAppIntent {
  kept?: true;
  hidden?: true;
}

export interface MadeAppIntentReader {
  of(foldKey: string): MadeAppIntent | undefined;
  /** Called whenever the merged intent may have moved. */
  on(cb: () => void): () => void;
}

/** Until slice 3h: nothing is kept and nothing is hidden. */
export const NO_MADE_APP_INTENTS: MadeAppIntentReader = {
  of: () => undefined,
  on: () => () => undefined,
};

/** The idle close's one timer (a test seam; production uses an unref'd setTimeout). */
export interface MadeAppTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** What the service stamps on its own desktop's row (slice 3a's `AppIntentStamps.of`): the newest capture. */
export interface MadeAppStamp {
  preview?: MadeAppPreview;
}

/** What `open` is asked: the daemon has already routed `device` and keeps `reveal` for the home (slice 3e). */
export interface MadeAppOpenParams {
  appId: string;
  presentationId?: string;
}

export interface MadeAppServiceHealth {
  /** apps with a serve record (a reservation for life) */
  apps: number;
  /** of those, the ones with a serve declared */
  open: number;
  retiring: number;
  storage: "ready" | "failed";
}

export interface MadeAppServiceOptions {
  /** `users/<fuid>/`: the registry, `artifacts/made/`, `artifacts/previews/` and `artifacts/made-previews/` live here. */
  dataDir: string;
  /** This desktop's device id: the previews serve's port domain, and the `device` every refusal names. */
  deviceId: string;
  /** The serve bridge, AH's shape: the daemon composes these specs into its one desired set. */
  bridge: ArtifactServeBridge;
  rows: MadeAppRows;
  exporter: MadeAppExporter;
  /** Slice 3h's merged intent. Absent: nothing kept, nothing hidden. */
  intents?: MadeAppIntentReader;
  /** The account a serve's `allow` is derived from at every declare. null: no serve can be carried (`not-linked`). */
  linkedLogin: () => string | null;
  /** This desktop's MagicDNS name (the mesh's self identity). A listener's URL is answered only when its host is it. */
  selfDnsName: () => string | undefined;
  /** AH's reservations (the daemon passes the ports of AH's declared serves); read at every allocation. */
  otherReservedPorts?: () => ReadonlySet<number>;
  /** AH's objects, which share ARTIFACT_LIMITS.LOCAL_OBJECTS with open made serves. */
  otherLiveObjects?: () => number;
  /** Electron's capture (AH-4's seam), keyed by the app's preview id. */
  capturePreview?: (
    params: ShellWebContentsCaptureArtifactPreviewParams,
  ) => Promise<ShellWebContentsCaptureArtifactPreviewResult>;
  /** Whether the shell can draw now (a visible desktop window). */
  capturePreviewAvailable?: () => boolean;
  logger?: Logger;
  now?: () => number;
  timers?: MadeAppTimers;
  /** How long `open` waits for its listener's URL before it answers `starting` (MADE_APP_LIMITS.OPEN_WAIT_MS). */
  openWaitMs?: number;
  /** Fault seam for the atomic registry write. */
  writeRegistry?: (path: string, body: string) => void;
}

export class MadeAppService {
  readonly #options: MadeAppServiceOptions;

  constructor(options: MadeAppServiceOptions) {
    this.#options = options;
  }

  /** Load the registry, resume retirements, close what is overdue, declare open serves and the previews serve. */
  start(): Promise<void> {
    return Promise.resolve();
  }

  /** Open a made app: refuse honestly, export, reserve, declare, and answer what its listener reported. */
  open(_params: MadeAppOpenParams): Promise<ArtifactOpenResult> {
    return Promise.resolve({ state: "starting" });
  }

  /** Re-derive every serve's audience from the linked login (the daemon calls this on `links.changed`). */
  relink(): Promise<void> {
    return Promise.resolve();
  }

  /** Every port this service holds for life: each app's, closed ones included, and the previews serve's. */
  reservedPorts(): ReadonlySet<number> {
    return new Set<number>();
  }

  /** The made serves as last declared: the daemon composes them into its desired set. */
  desiredServes(): ServeSpec[] {
    return [];
  }

  /** The previews serve's root URL as its listener reported it, validated as AH §6 validates a URL (`previewsBase` on
   * this desktop's `sources[]` entry), or undefined. */
  previewsBase(): string | undefined {
    return undefined;
  }

  /** Slice 3a's `AppIntentStamps.of`: what this desktop stamps on its own row of `appId`. */
  of(_appId: string): MadeAppStamp | undefined {
    return undefined;
  }

  /** `previews-changed`: the apps whose stamp moved, for 3a to restamp. */
  on(_event: "previews-changed", _cb: (appIds: string[]) => void): () => void {
    return () => undefined;
  }

  /** Resolves once queued work (mutations, retirements and captures) has settled. */
  settled(): Promise<void> {
    return Promise.resolve();
  }

  health(): MadeAppServiceHealth {
    return { apps: 0, open: 0, retiring: 0, storage: "ready" };
  }

  /** Stop timers and listeners; every serve stays up (field-native outlives fieldd, and a restart adopts it). */
  dispose(): Promise<void> {
    void this.#options; // red: the options are held for the green bodies
    return Promise.resolve();
  }
}
