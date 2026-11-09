// MA-3b — the made-app service (`draft/thinking-mini-apps.md` v0.2 §4.4–§4.6, RULED 2026-11-05; the build plan's
// §3 "3b" as the lead's RULINGS amend it). A made app is a page an agent presented, which rosetta keeps; this desktop
// serves one ONLY when a person opens it (MA-L3), at the app's own origin, for life (MA-L6, an origin includes its
// host). This service owns that serve, as AH's ArtifactService owns a live artifact's, and nothing else:
//  - the private registry `registries/field.made-apps.v1.json` (`MadeAppRegistry`, atomic 0600, an unreadable file
//    moved aside), one `MadeAppServeRecord` per app it has served: its port for life, its preview id, the folder it
//    serves and the serve ids being retired. Never replicated, never answered by a door.
//  - `open`: the honest refusals (`MADE_APP_OPEN`), the export through an injected `MadeAppExporter` (MA-3f: rosetta's
//    door, RO-32 by digest) into the NON-served `drive/import/<appId>/<digest>/`, the view the files worker builds from
//    it into `artifacts/made/<appId>/<digest>/` (DR-1b), the port by the made rule over the ONE reservation set it
//    shares with AH, the declare under the app's headers (DR-D11 (a)), and the URL its listener reported, validated
//    against the app's port and this desktop's MagicDNS name and stripped when it fails (C16: validate or strip, never
//    rewrite).
//  - the idle close at MADE_APP_LIMITS.IDLE_CLOSE_MS from the last open, on one timer to the next due close; kept and
//    hidden come from an injected intent reader (slice 3h writes the intent; until then nothing is kept or hidden),
//    read by the fold key the app's ROW spells. A record whose row is not held while the library's table does not
//    speak yet (a restart, before 3a's walk) is neither kept, hidden, closed nor evicted: it stays as it was until
//    `reconsider()` reads its row (RULINGS L8: kept means no idle close).
//  - the shared ceiling: open made serves and AH's objects together under ARTIFACT_LIMITS.LOCAL_OBJECTS.
//  - the previews serve: ONE standing serve per desktop over `artifacts/made-previews/` only (the lead's L12), its
//    port by the made rule over the device id; after each capture the JPEG is HARD-LINKED there (`fs.link`, never a
//    read), and a hidden app's link is removed.
//  - the capture: owed at the first serve and on a new page digest, run at the next open on this desktop (L11; no
//    window-show event, never a timer). An open that answered `starting` captures when its own listener reports.
// `artifact.mark` (the person's intent, slice 3h) and `reveal` (the home's shell.openLink, slice 3e) are NOT this
// service's. It never handles page or image bytes (EL2): it names folders, and Electron and truffle move the bytes.
//
// Remove-before-add, as AH's: a serve whose config changes (a new folder, a new gate) keeps its port, so the old id
// goes to the record's durable `retiringServeIds` and the new one is declared only once the old one has converged. A
// made serve id sits inside AH's `artifact-` namespace, which MeshClient adopts and never removes as a stray, so this
// service also sweeps, at start and at every relink and BEFORE that pass declares, any `artifact-made-` listener it
// does not mean to hold (a login that changed while fieldd was down leaves one on the port the new serve takes). A
// removal or a sweep that failed is retried on the same one timer, at AH's maintenance cadence, while it is owed.

import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  ARTIFACT_LIMITS,
  type ArtifactOpenResult,
  artifactRootUrlClaim,
  Blake3Hex,
  type IndexCatalogApp,
  LAYOUT,
  MADE_APP_LIMITS,
  MADE_APP_OPEN,
  MADE_APP_PORT_DOMAIN,
  MADE_APP_PREVIEW_FILE,
  MADE_APP_PREVIEWS_PORT_DOMAIN,
  MADE_APP_REGISTRY_FILE,
  MADE_APP_VIEW,
  type MadeAppAvailability,
  MadeAppOpenRefusal,
  MadeAppPreview,
  MadeAppRegistry,
  MadeAppServeRecord,
  madeAppFoldKey,
  madeAppReachOf,
  madeAppServeHeaders,
  readMadeAppEnvironment,
  type ServeHeader,
  ShellWebContentsCaptureArtifactPreviewParams,
  type ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { ulid } from "@vibefield/users";
import {
  type ArtifactServeBridge,
  type CanonicalServingConfigV1,
  canonicalAllow,
  canonicalJson,
} from "./artifact-service";
import { canonicalTailnetDnsName } from "./device-service";
import type { ObservedServe, ServeSpec, ServeState } from "./mesh-client";
import { RpcCallError } from "./native-link";
import { serveAllowGlob } from "./terminal-serve";
import type { BuildMadeViewArgs, MadeViewRoots } from "./workspace/protocol";

/** Every made serve id starts here, inside AH's `artifact-` namespace (ARTIFACT_SERVE_PREFIX): MeshClient then adopts
 * a live one across a fieldd restart and never removes one as a stray (mesh-client.ts), so this service's durable
 * retirement is the only road a made serve goes down. An app's id is `artifact-made-<appId[0..16]>-<fingerprint>`. */
export const MADE_APP_SERVE_PREFIX = "artifact-made-";
/** The previews serve's id: `artifact-made-previews-<fingerprint>`. No app id can collide with it: an app's id is hex. */
export const MADE_PREVIEWS_SERVE_PREFIX = "artifact-made-previews-";
/** The technical names truffle carries for the two serves. */
export const MADE_APP_SERVE_NAME_PREFIX = "made-app:";
export const MADE_PREVIEWS_SERVE_NAME = "made-app-previews";

/** AH's preview route (`canonicalArtifactServingConfig`): the capture's folder, mounted ahead of the page. */
const PREVIEW_ROUTE_PREFIX = "/.vibefield/preview";
/** Lowercase RFC 4648 base32, unpadded: the fingerprint's alphabet, as AH's serve ids spell it. */
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
/** A record's `retiringServeIds` bound (`MadeAppServeRecord`), as AH's. */
const MAX_RETIRING_IDS = 16;
/** setTimeout's ceiling (2^31 − 1 ms): a due close past it re-arms when the timer fires. */
const MAX_TIMER_MS = 2_147_483_647;
/** How soon the idle close is tried again while the registry cannot be written (a close is durable first). */
const STORAGE_RETRY_MS = 60_000;
/** How soon a removal (or a sweep) that failed is tried again, while one is owed: AH's maintenance cadence
 * (artifact-service.ts `DEFAULT_MAINTENANCE_MS`). A hidden or idle-closed app's listener is never left up unbounded. */
const RETRY_MS = 10_000;

/** The made rule's first candidate for an app's port: AH-D4's derivation over the same range with
 * MADE_APP_PORT_DOMAIN + appId (artifacts.ts). The service then probes linearly over the shared reservations. */
export function madeAppPortCandidate(appId: string): number {
  return portCandidate(MADE_APP_PORT_DOMAIN, appId);
}

/** The made rule's first candidate for this desktop's previews serve: MADE_APP_PREVIEWS_PORT_DOMAIN + deviceId. */
export function madeAppPreviewsPortCandidate(deviceId: string): number {
  return portCandidate(MADE_APP_PREVIEWS_PORT_DOMAIN, deviceId);
}

function portCandidate(domain: string, id: string): number {
  const digest = createHash("sha256").update(domain).update(id).digest();
  const width = ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1;
  return ARTIFACT_LIMITS.LISTEN_PORT_MIN + (digest.readUInt32BE(0) % width);
}

/** What one app's serve is made of. `allow` is the canonical audience (the linked login's escaped glob), derived at
 * every declare so a re-link re-gates (L7). */
export interface MadeAppServeInput {
  appId: string;
  listenPort: number;
  allow: readonly string[];
  /** `artifacts/previews/<previewId>`: where Electron's capture writes (the `/.vibefield/preview` route). */
  previewDir: string;
  /** `artifacts/made/<appId>/<digest>`: the view the files worker built from rosetta's page (the `/` route). */
  folder: string;
  /** MA-3f (DR-D11 (a)): the app's policy, set on every response of its serve. A policy change is a serve change
   * (DR-L7), so the headers are part of the config its id carries. None is the config every older row pins. */
  headers?: readonly ServeHeader[];
}

/** A made app's serving config: AH's, and its headers when it has any. */
export type CanonicalMadeAppServingConfig = CanonicalServingConfigV1 & { headers?: ServeHeader[] };

/** An app's complete serving config, whose digest its serve id carries: AH's routes form (preview route, then the
 * folder), key-sorted by `canonicalJson`, route order kept. Pinned by `made-app-serving.vector.json`. */
export function canonicalMadeAppServingConfig(
  input: MadeAppServeInput,
): CanonicalMadeAppServingConfig {
  return {
    v: 1,
    listenPort: input.listenPort,
    tls: true,
    allow: canonicalAllow(input.allow),
    routes: [
      { allow: [], dir: input.previewDir, prefix: PREVIEW_ROUTE_PREFIX, stripPrefix: false },
      { allow: [], dir: input.folder, prefix: "/", stripPrefix: false },
    ],
    ...(input.headers !== undefined && input.headers.length > 0
      ? { headers: [...input.headers] }
      : {}),
  };
}

export function madeAppServeId(input: MadeAppServeInput): string {
  const fingerprint = fingerprintOf(canonicalMadeAppServingConfig(input));
  return `${MADE_APP_SERVE_PREFIX}${input.appId.slice(0, 16)}-${fingerprint}`;
}

/** What the previews serve is made of: one folder, `artifacts/made-previews`, and nothing else. */
export interface MadePreviewsServeInput {
  listenPort: number;
  allow: readonly string[];
  dir: string;
}

export function canonicalMadePreviewsServingConfig(
  input: MadePreviewsServeInput,
): CanonicalServingConfigV1 {
  return {
    v: 1,
    listenPort: input.listenPort,
    tls: true,
    allow: canonicalAllow(input.allow),
    routes: [{ allow: [], dir: input.dir, prefix: "/", stripPrefix: false }],
  };
}

export function madePreviewsServeId(input: MadePreviewsServeInput): string {
  return `${MADE_PREVIEWS_SERVE_PREFIX}${fingerprintOf(canonicalMadePreviewsServingConfig(input))}`;
}

function fingerprintOf(config: CanonicalServingConfigV1): string {
  return base32(createHash("sha256").update(canonicalJson(config)).digest()).slice(0, 16);
}

/** A refusal state `artifact.open` answers (`MADE_APP_OPEN`). */
export type MadeAppRefusalState = MadeAppOpenRefusal["state"];

/** Each refusal's retryability, as MADE_APP_OPEN documents it, and the sentence a log or a client shows. */
const REFUSALS: Record<MadeAppRefusalState, { retryable: boolean; message: string }> = {
  [MADE_APP_OPEN.STATE_EXPORT_UNBUILT]: {
    retryable: false,
    // *2026-11-09 (MA-3f):* no exporter of this build answers it. The state stays in the contract
    // for a desktop on an older build, which still answers it to a newer home.
    message: "that desktop's build cannot write a made app out yet",
  },
  [MADE_APP_OPEN.STATE_NOT_KEPT]: {
    retryable: false,
    message: "this desktop's history keeps no verified copy of the page",
  },
  [MADE_APP_OPEN.STATE_TOO_LARGE]: {
    retryable: false,
    message: "the page was past the history's size bound, so it was not kept",
  },
  [MADE_APP_OPEN.STATE_UNSUPPORTED]: {
    retryable: false,
    message: "the history found a page it cannot keep",
  },
  [MADE_APP_OPEN.STATE_READING]: {
    retryable: true,
    message: "this desktop is still reading its history",
  },
  [MADE_APP_OPEN.STATE_EXPORT_FAILED]: {
    retryable: true,
    message: "the page could not be exported for serving",
  },
  [MADE_APP_OPEN.STATE_NOT_LINKED]: {
    retryable: true,
    message:
      "this desktop is not linked to a tailscale account, so there is no one to serve the app to",
  },
};

/** `artifact.open`'s refusal, worded as MADE_APP_OPEN documents it: UNAVAILABLE, its retryability by state, and
 * `{service: "apps", state, device?}` (`MadeAppOpenRefusal`). An injected exporter words `export-unbuilt` with it. */
export function madeAppRefusal(state: MadeAppRefusalState, device?: string): RpcCallError {
  const { retryable, message } = REFUSALS[state];
  return new RpcCallError("UNAVAILABLE", message, retryable, {
    service: MADE_APP_OPEN.SERVICE,
    state,
    ...(device !== undefined ? { device } : {}),
  });
}

/** rosetta's availability words that refuse an open before any export; `captured` and `unknown` go to the exporter
 * (a word this build cannot read is not a refusal: rosetta's export decides). */
function availabilityRefusal(availability: MadeAppAvailability): MadeAppRefusalState | undefined {
  switch (availability) {
    case "not_captured":
    case "missing":
    case "changed_during_read":
      return MADE_APP_OPEN.STATE_NOT_KEPT;
    case "too_large":
      return MADE_APP_OPEN.STATE_TOO_LARGE;
    case "unsupported":
      return MADE_APP_OPEN.STATE_UNSUPPORTED;
    default:
      return undefined;
  }
}

/** RO-32's export, as fieldd asks it: rosetta places one presentation's own bytes as `index.html` in `into`, a folder
 * below its `--export-root` (`drive/import/<appId>/<digest>`) that nothing serves, never fieldd. */
export interface MadeAppExportRequest {
  sessionId: string;
  publicationId: string;
  into: string;
}

/** What this service reads of rosetta's answer (`ArtifactExportResponse`): the file it placed and the environment the
 * page was written for, hosts and theme, as data (MA-L9). `members` is empty until RO-34b, so a multi-file publish
 * serves its page alone, which the row says (`droppedFiles`). */
export interface MadeAppExport {
  page: { path: string; blake3: string; bytes: number };
  environment: unknown;
}

/** The export seam (the lead's C9), over `IndexService.exportArtifact` in production. A refusal it throws
 * (`madeAppRefusal`) passes through; any other failure is worded `export-failed`. */
export interface MadeAppExporter {
  export(request: MadeAppExportRequest): Promise<MadeAppExport>;
}

/** What the exporter needs of `IndexService`. */
export interface MadeAppExportDoor {
  exportArtifact(
    sessionId: string,
    publicationId: string,
    request: { into: string },
    onStatus?: (status: number) => RpcCallError | undefined,
  ): Promise<MadeAppExport>;
}

/** The exporter over rosetta's door. Its 404 is the page not kept, in words; any other refusal is logged by status and
 * left to the service, which words it `export-failed`. */
export function rosettaMadeAppExporter(door: MadeAppExportDoor, logger: Logger): MadeAppExporter {
  return {
    export: ({ sessionId, publicationId, into }) =>
      door.exportArtifact(sessionId, publicationId, { into }, (status) => {
        if (status === 404) return madeAppRefusal(MADE_APP_OPEN.STATE_NOT_KEPT);
        logger.info("fieldd.made_apps.export_refused", "rosetta refused a made app's export", {
          status,
        });
        return undefined;
      }),
  };
}

/** The files worker's view (DR-1b): the stored page between DR-1a's head and tail, written into the served folder. Its
 * failures are worded `export-failed`. */
export interface MadeAppViewBuilder {
  build(args: BuildMadeViewArgs): Promise<unknown>;
}

/** The export root and the served root, made (0700) before rosettad starts, since `--export-root` must name an
 * existing directory and the worker makes neither. A folder that cannot be made answers undefined and is logged: the
 * opens then say `export-failed`, and the history daemon stays up. */
export function prepareMadeAppRoots(dataDir: string, logger: Logger): MadeViewRoots | undefined {
  const sourceRoot = join(dataDir, ...LAYOUT.DRIVE_IMPORT_DIR);
  const servedRoot = join(dataDir, ...LAYOUT.ARTIFACT_MADE_DIR);
  try {
    for (const root of [sourceRoot, servedRoot]) mkdirSync(root, { recursive: true, mode: 0o700 });
    return { sourceRoot, servedRoot };
  } catch (error) {
    logger.warn("fieldd.made_apps.roots_unmade", "A made app's folders could not be made", {
      error: errorName(error),
    });
    return undefined;
  }
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
  /** The newest presentation's row of one app, or undefined when the table holds none. */
  get(appId: string): IndexCatalogApp | undefined;
  /** Whether the table speaks for the library (DS-L8): 3a's first walk of this boot completed (`IndexApps.ready`)
   * AND rosetta's last `canonical_ready` is true. 3e wires `() => indexApps.ready && indexApps.libraryReady === true`,
   * never `libraryReady` alone: rosetta says `canonical_ready` from a walk's FIRST page, while the table is partial.
   * Until it speaks, an app with no row answers `library-reading` (never NOT_FOUND), and a record whose row is not
   * held yet has no readable intent (its fold key is its row's). */
  speaks(): boolean;
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

const DEFAULT_TIMERS: MadeAppTimers = {
  set: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  },
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

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
  view: MadeAppViewBuilder;
  /** Slice 3h's merged intent. Absent: nothing kept, nothing hidden. */
  intents?: MadeAppIntentReader;
  /** The account a serve's `allow` is derived from at every declare. null: no serve can be carried (`not-linked`). */
  linkedLogin: () => string | null;
  /** This desktop's MagicDNS name (the mesh's self identity). A listener's URL is answered only when its host is it. */
  selfDnsName: () => string | undefined;
  /** AH's reservations (`ArtifactService.reservedPorts()`, MA-3f: its committed intents, absent ones included, and a
   * port it has picked and not committed yet), read at every allocation after the probe's wait. Neither service
   * re-allocates when the native add fails, so a port handed out twice would collide for life. */
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
  /** The service's ONE timer (the idle close, and the retry of an owed removal or sweep); the open's bounded wait for
   * its URL is a plain timeout. */
  timers?: MadeAppTimers;
  /** How long `open` waits for its listener's URL before it answers `starting` (MADE_APP_LIMITS.OPEN_WAIT_MS). */
  openWaitMs?: number;
  /** Fault seam for the atomic registry write. */
  writeRegistry?: (path: string, body: string) => void;
}

/** The registry as this service holds it: the file's two members, the apps keyed by id. */
interface Registry {
  previewsListenPort: number | undefined;
  apps: ReadonlyMap<string, MadeAppServeRecord>;
}

/** The presentation an open serves: the row's newest, or a version it named. */
interface OpenTarget {
  presentationId: string;
  sessionId: string;
  digest: string | undefined;
  availability: MadeAppAvailability;
}

export class MadeAppService {
  readonly #deviceId: string;
  readonly #bridge: ArtifactServeBridge;
  readonly #rows: MadeAppRows;
  readonly #exporter: MadeAppExporter;
  readonly #view: MadeAppViewBuilder;
  readonly #intents: MadeAppIntentReader;
  readonly #linkedLogin: () => string | null;
  readonly #selfDnsName: () => string | undefined;
  readonly #otherReservedPorts: () => ReadonlySet<number>;
  readonly #otherLiveObjects: () => number;
  readonly #capturePreview: MadeAppServiceOptions["capturePreview"];
  readonly #capturePreviewAvailable: () => boolean;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #timers: MadeAppTimers;
  readonly #openWaitMs: number;
  readonly #writeRegistry: (path: string, body: string) => void;
  readonly #registryPath: string;
  readonly #madeRoot: string;
  /** Where rosetta's export places a page (`--export-root`); nothing here is served. */
  readonly #exportRoot: string;
  readonly #previewRoot: string;
  readonly #madePreviewsRoot: string;
  /** F9: a port picked and not yet committed, so AH's allocation cannot pick it in between. */
  readonly #claimedPorts = new Set<number>();

  #registry: Registry = { previewsListenPort: undefined, apps: new Map() };
  /** The specs last declared, and of them each app's serve id: what is on the floor, by this service's word. */
  #specs: ServeSpec[] = [];
  #declared = new Map<string, string>();
  #previewsDeclared: string | undefined;
  /** The previews serve's ids being removed. In memory: the registry keeps no list for it, and the start's sweep is
   * the net for a crash between its remove and its add. */
  readonly #previewsRetiring = new Set<string>();
  /** Apps whose older digest folders go once their old serve has converged. */
  readonly #prune = new Set<string>();
  /** Apps whose preview link is withheld (seen hidden, or stamped while their intent could not be read): once the app
   * is read unhidden, the link comes back. */
  readonly #linkWithheld = new Set<string>();
  /** A sweep is owed: the last one could not list the floor or remove a stray, or a close could not name its floor id
   * (a full retirement list). The one timer retries it at RETRY_MS. */
  #sweepOwed = false;
  /** Opens that answered `starting`: their capture runs when their listener reports its URL. */
  readonly #captureOnUrl = new Set<string>();
  readonly #capturing = new Set<string>();
  readonly #waiters = new Set<() => void>();
  readonly #previewListeners = new Set<(appIds: string[]) => void>();
  #chain: Promise<void> = Promise.resolve();
  #previewChain: Promise<void> = Promise.resolve();
  #timer: unknown = null;
  #storageOk = true;
  #started = false;
  #disposed = false;
  #disposePromise: Promise<void> | null = null;
  #bridgeOff: (() => void) | null = null;
  #intentsOff: (() => void) | null = null;

  constructor(options: MadeAppServiceOptions) {
    this.#deviceId = options.deviceId;
    this.#bridge = options.bridge;
    this.#rows = options.rows;
    this.#exporter = options.exporter;
    this.#view = options.view;
    this.#intents = options.intents ?? NO_MADE_APP_INTENTS;
    this.#linkedLogin = options.linkedLogin;
    this.#selfDnsName = options.selfDnsName;
    this.#otherReservedPorts = options.otherReservedPorts ?? (() => new Set<number>());
    this.#otherLiveObjects = options.otherLiveObjects ?? (() => 0);
    this.#capturePreview = options.capturePreview;
    this.#capturePreviewAvailable =
      options.capturePreviewAvailable ?? (() => options.capturePreview !== undefined);
    this.#logger = (options.logger ?? createNoopLogger()).child({ component: "made-apps" });
    this.#now = options.now ?? Date.now;
    this.#timers = options.timers ?? DEFAULT_TIMERS;
    this.#openWaitMs = options.openWaitMs ?? MADE_APP_LIMITS.OPEN_WAIT_MS;
    this.#writeRegistry = options.writeRegistry ?? atomicWritePrivate;
    this.#registryPath = join(options.dataDir, ...LAYOUT.REGISTRIES_DIR, MADE_APP_REGISTRY_FILE);
    this.#madeRoot = join(options.dataDir, ...LAYOUT.ARTIFACT_MADE_DIR);
    this.#exportRoot = join(options.dataDir, ...LAYOUT.DRIVE_IMPORT_DIR);
    this.#previewRoot = join(options.dataDir, ...LAYOUT.ARTIFACT_PREVIEWS_DIR);
    this.#madePreviewsRoot = join(options.dataDir, ...LAYOUT.ARTIFACT_MADE_PREVIEWS_DIR);
    this.#load();
  }

  /** Load the registry, resume retirements, close what is overdue, declare open serves and the previews serve. */
  start(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#started || this.#disposed) return;
      this.#started = true;
      this.#bridgeOff = this.#bridge.on(() => this.#onBridge());
      this.#intentsOff = this.#intents.on(() => {
        if (!this.#disposed) this.#background("intent", () => this.#reconsider());
      });
      this.#applyIntents();
      // the sweep goes BEFORE the declare: a listener left under another login holds the port the new serve takes
      this.#sweepOwed = true;
      await this.#sweepStrays();
      await this.#reconcile();
      this.#armTimer();
    });
  }

  /** Open a made app: refuse honestly, export, reserve, declare, and answer what its listener reported. */
  open(params: MadeAppOpenParams): Promise<ArtifactOpenResult> {
    return this.#enqueue(() => this.#openNow(params), true).then((appId) => this.#answer(appId));
  }

  /** Re-derive every serve's audience from the linked login (the daemon calls this on `links.changed`). */
  relink(): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.#started || this.#disposed) return;
      const login = this.#linkedLogin();
      const now = this.#now();
      let apps: Map<string, MadeAppServeRecord> | null = null;
      for (const [appId, declaredId] of this.#declared) {
        const record = this.#registry.apps.get(appId);
        if (record === undefined) continue;
        const input = login === null ? undefined : this.#appInput(record, login);
        if (input !== undefined && madeAppServeId(input) === declaredId) continue;
        apps ??= new Map(this.#registry.apps);
        apps.set(appId, this.#retiring(record, declaredId, now));
      }
      if (apps !== null) this.#tryCommit({ ...this.#registry, apps }, "relink checkpoint");
      this.#sweepOwed = true;
      await this.#sweepStrays();
      await this.#reconcile();
      this.#armTimer();
    });
  }

  /** The library's rows moved (3e wires IndexApps' `changed`, which fires when the table first speaks and whenever a
   * row or the standing moves): an app's fold key, so its intent, is read from its row, and a record whose row was not
   * held (a restart, before the walk) can now be kept, hidden or closed. Re-applies keep, hide and the idle close. */
  reconsider(): Promise<void> {
    return this.#enqueue(() => this.#reconsider());
  }

  /** Every port this service holds for life: each app's, closed ones included, the previews serve's, and one picked
   * and not committed yet (F9). */
  reservedPorts(): ReadonlySet<number> {
    const ports = new Set<number>(this.#claimedPorts);
    for (const record of this.#registry.apps.values()) ports.add(record.listenPort);
    if (this.#registry.previewsListenPort !== undefined) {
      ports.add(this.#registry.previewsListenPort);
    }
    return ports;
  }

  /** The made serves as last declared: the daemon composes them into its desired set. */
  desiredServes(): ServeSpec[] {
    return [...this.#specs];
  }

  /** The previews serve's root URL as its listener reported it, validated as AH §6 validates a URL (`previewsBase` on
   * this desktop's `sources[]` entry), or undefined. */
  previewsBase(): string | undefined {
    const port = this.#registry.previewsListenPort;
    if (this.#previewsDeclared === undefined || port === undefined) return undefined;
    return this.#liveUrl(this.#previewsDeclared, port);
  }

  /** Slice 3a's `AppIntentStamps.of`: what this desktop stamps on its own row of `appId`. */
  of(appId: string): MadeAppStamp | undefined {
    const preview = this.#registry.apps.get(appId)?.preview;
    return preview === undefined ? undefined : { preview };
  }

  /** `previews-changed`: the apps whose stamp moved, for 3a to restamp. */
  on(_event: "previews-changed", cb: (appIds: string[]) => void): () => void {
    this.#previewListeners.add(cb);
    return () => {
      this.#previewListeners.delete(cb);
    };
  }

  /** Resolves once queued work (mutations, retirements and captures) has settled. */
  async settled(): Promise<void> {
    for (;;) {
      const chain = this.#chain;
      const previews = this.#previewChain;
      await chain;
      await previews;
      if (chain === this.#chain && previews === this.#previewChain) return;
    }
  }

  health(): MadeAppServiceHealth {
    let retiring = this.#previewsRetiring.size;
    for (const record of this.#registry.apps.values()) retiring += record.retiringServeIds.length;
    return {
      apps: this.#registry.apps.size,
      open: this.#declared.size,
      retiring,
      storage: this.#storageOk ? "ready" : "failed",
    };
  }

  /** Stop timers and listeners; every serve stays up (field-native outlives fieldd, and a restart adopts it). */
  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise;
    this.#disposed = true;
    if (this.#timer !== null) {
      this.#timers.clear(this.#timer);
      this.#timer = null;
    }
    this.#bridgeOff?.();
    this.#bridgeOff = null;
    this.#intentsOff?.();
    this.#intentsOff = null;
    for (const check of [...this.#waiters]) check();
    this.#previewListeners.clear();
    this.#disposePromise = this.settled();
    return this.#disposePromise;
  }

  // ---- open ---------------------------------------------------------------

  /** The durable half of an open, inside the mutation chain: the refusals in their order, the export, the record and
   * the declare. Answers the app id; the wait for its URL runs outside the chain (`#answer`). */
  async #openNow(params: MadeAppOpenParams): Promise<string> {
    const { appId } = params;
    const device = this.#deviceId;
    const row = this.#rows.get(appId);
    if (row === undefined) {
      // a partial table is not the library's word (DS-L8): the app may sit on a page not read yet
      if (!this.#rows.speaks()) throw madeAppRefusal(MADE_APP_OPEN.STATE_READING, device);
      throw notFound();
    }
    if (this.#intentOf(appId)?.hidden === true) throw notFound();
    const target = await this.#target(row, params.presentationId);
    const refusal = availabilityRefusal(target.availability);
    if (refusal !== undefined) throw madeAppRefusal(refusal, device);
    const login = this.#linkedLogin();
    if (login === null) throw madeAppRefusal(MADE_APP_OPEN.STATE_NOT_LINKED, device);
    const existing = this.#registry.apps.get(appId);
    if (existing === undefined && this.#registry.apps.size >= MADE_APP_LIMITS.INTENTS) {
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        `at most ${MADE_APP_LIMITS.INTENTS} made apps may hold a port on one desktop`,
        false,
        { resource: MADE_APP_OPEN.RESOURCE, limit: MADE_APP_LIMITS.INTENTS },
      );
    }
    this.#evictionsFor(existing); // the ceiling refuses before any export
    // The folder is named by the digest the library expects, known before the export.
    // It names a folder before anything parses it, so only rosetta's blake3 grammar may (never a path, EL7).
    const digest = target.digest;
    if (digest === undefined || !Blake3Hex.safeParse(digest).success) {
      throw madeAppRefusal(MADE_APP_OPEN.STATE_EXPORT_FAILED, device);
    }
    const folder = this.#folder(row.appId, digest);
    const exported =
      existing?.exportedDigest === digest &&
      existing.viewVersion === MADE_APP_VIEW.VERSION &&
      existing.network !== undefined &&
      isDirectory(folder)
        ? { reach: existing.reach ?? [], network: existing.network }
        : await this.#export(target, digest, row.appId, folder);

    const evictions = this.#evictionsFor(existing);
    const now = this.#now();
    const listenPort = existing?.listenPort ?? (await this.#allocatePort(appId));
    try {
      let next = MadeAppServeRecord.parse({
        ...(existing ?? {}),
        appId,
        listenPort,
        previewId: existing?.previewId ?? ulid(now),
        exportedPresentationId: target.presentationId,
        exportedDigest: digest,
        state: "open",
        lastOpenedAt: now,
        retiringServeIds: existing?.retiringServeIds ?? [],
        reach: exported.reach,
        network: exported.network,
        viewVersion: MADE_APP_VIEW.VERSION,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      // Remove-before-add: a serve declared under another config keeps its port, so it goes first.
      const declaredId = this.#declared.get(appId);
      const input = this.#appInput(next, login);
      if (
        declaredId !== undefined &&
        (input === undefined || madeAppServeId(input) !== declaredId)
      ) {
        next = this.#retiring(next, declaredId, now);
      }
      const apps = new Map(this.#registry.apps);
      apps.set(appId, next);
      for (const evicted of evictions) apps.set(evicted.appId, this.#closing(evicted, now));
      this.#commit({ ...this.#registry, apps });
    } finally {
      this.#claimedPorts.delete(listenPort);
    }
    if (existing?.exportedDigest !== undefined && existing.exportedDigest !== digest) {
      this.#prune.add(appId);
    }
    for (const evicted of evictions) this.#captureOnUrl.delete(evicted.appId);
    const carried = await this.#reconcile();
    this.#armTimer();
    // MADE_APP_OPEN: the serve's declare failed is `export-failed` (retryable), never a `starting` that is not coming
    if (!carried) throw madeAppRefusal(MADE_APP_OPEN.STATE_EXPORT_FAILED, device);
    return appId;
  }

  /** The presentation an open serves: the newest unless it names another, which must be one of the app's. */
  async #target(row: IndexCatalogApp, presentationId: string | undefined): Promise<OpenTarget> {
    if (presentationId === undefined || presentationId === row.presentationId) {
      return {
        presentationId: row.presentationId,
        sessionId: row.sessionId,
        digest: row.digest,
        availability: row.availability,
      };
    }
    const version = await this.#rows.presentation(row.appId, presentationId);
    if (version === undefined || version.presentationId !== presentationId) throw notFound();
    return {
      presentationId: version.presentationId,
      sessionId: version.sessionId,
      digest: version.digest,
      availability: version.availability,
    };
  }

  /** rosetta places the page in the export folder and the files worker builds the served view from it. rosetta's own
   * refusal words pass through, named for this desktop; anything else, an answer for another digest, a policy that
   * composes no headers or a view that cannot be built is `export-failed`, and the folders it was making go. Answers
   * what the record keeps of the page's environment: the hosts flat, as `reach`, and by directive, as the headers'
   * input. */
  async #export(
    target: OpenTarget,
    digest: string,
    appId: string,
    folder: string,
  ): Promise<{ reach: string[]; network: Record<string, string[]> }> {
    const into = join(this.#exportRoot, appId, digest);
    const failed = () => {
      this.#discardFolder(into);
      this.#discardFolder(folder);
      return madeAppRefusal(MADE_APP_OPEN.STATE_EXPORT_FAILED, this.#deviceId);
    };
    let answer: MadeAppExport;
    try {
      mkdirSync(dirname(into), { recursive: true, mode: 0o700 });
      answer = await this.#exporter.export({
        sessionId: target.sessionId,
        publicationId: target.presentationId,
        into,
      });
    } catch (error) {
      const state = refusalStateOf(error);
      if (state !== undefined) {
        this.#discardFolder(into);
        throw madeAppRefusal(state, this.#deviceId);
      }
      this.#logger.info("fieldd.made_apps.export_failed", "A made app's export failed", {
        error: errorName(error),
      });
      throw failed();
    }
    if (answer?.page?.blake3 !== digest || answer.page.path !== MADE_APP_VIEW.FILE) {
      this.#logger.info(
        "fieldd.made_apps.export_digest_mismatch",
        "A made app's export answered another page than the library names",
      );
      throw failed();
    }
    const environment = readMadeAppEnvironment(answer.environment);
    if (environment.stripped.length > 0) {
      this.#logger.info(
        "fieldd.made_apps.environment_stripped",
        "A made app's environment named entries this build cannot read",
        { stripped: environment.stripped.length },
      );
    }
    const headers = madeAppServeHeaders(environment.policy);
    if (!headers.ok) {
      this.#logger.info(
        "fieldd.made_apps.policy_refused",
        "A made app's policy composed no headers",
        {
          refused: headers.refused,
        },
      );
      throw failed();
    }
    try {
      await this.#view.build({
        source: join(into, MADE_APP_VIEW.FILE),
        folder,
        theme: { colorScheme: "light", variables: environment.variables },
        blake3: digest,
      });
    } catch (error) {
      this.#logger.info("fieldd.made_apps.view_failed", "A made app's view could not be built", {
        error: errorName(error),
      });
      throw failed();
    }
    return {
      reach: madeAppReachOf(environment.policy),
      network: environment.policy.hosts as Record<string, string[]>,
    };
  }

  /** What an open answers, outside the chain: `serving` on its listener's validated URL, waited for up to
   * `openWaitMs`, else `starting`. Both carry the shell's hosts. An owed capture runs at a `serving` answer, or when a
   * `starting` open's listener reports. It is enqueued on the preview chain and runs only once the table speaks, so
   * on this desktop it may reach the shell before a window's reveal (the daemon's handler reveals after this answer),
   * after it, or not at all yet: nothing orders the two. */
  async #answer(appId: string): Promise<ArtifactOpenResult> {
    const url =
      this.#servingUrl(appId) ??
      (this.#serveFailed(appId) ? undefined : await this.#awaitUrl(appId));
    const reach = this.#registry.apps.get(appId)?.reach;
    const reachPart = reach === undefined ? {} : { reach: [...reach] };
    if (url !== undefined) {
      this.#maybeCapture(appId);
      return { state: "serving", url, ...reachPart };
    }
    // the floor refused the serve (its add failed, or its proxy errored): MADE_APP_OPEN's failed declare
    if (this.#serveFailed(appId)) {
      throw madeAppRefusal(MADE_APP_OPEN.STATE_EXPORT_FAILED, this.#deviceId);
    }
    this.#captureOnUrl.add(appId);
    // the URL may have come between the wait's end and here
    if (this.#servingUrl(appId) !== undefined) this.#onUrls();
    return { state: "starting", ...reachPart };
  }

  #awaitUrl(appId: string): Promise<string | undefined> {
    if (this.#openWaitMs <= 0 || this.#disposed) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const finish = (url: string | undefined) => {
        if (timer !== undefined) clearTimeout(timer);
        this.#waiters.delete(check);
        resolve(url);
      };
      const check = () => {
        if (this.#disposed) {
          finish(undefined);
          return;
        }
        const url = this.#servingUrl(appId);
        if (url !== undefined || this.#serveFailed(appId)) finish(url);
      };
      this.#waiters.add(check);
      timer = setTimeout(() => finish(undefined), this.#openWaitMs);
    });
  }

  /** Room under ARTIFACT_LIMITS.LOCAL_OBJECTS, which open made serves share with AH's objects: the least recently
   * opened closable serves close. A kept serve never closes, and neither does one whose intent cannot be read yet
   * (its row is not held: it may be kept). Short of room, the open is RESOURCE_EXHAUSTED, worded by what holds it:
   * kept apps (retryable false, MADE_APP_OPEN's case) or what this service cannot close now (retryable true: AH's
   * objects may go, and a walk may read an app closable). */
  #evictionsFor(existing: MadeAppServeRecord | undefined): MadeAppServeRecord[] {
    if (existing?.state === "open") return [];
    const open = [...this.#registry.apps.values()].filter((record) => record.state === "open");
    const over = open.length + this.#otherLiveObjects() + 1 - ARTIFACT_LIMITS.LOCAL_OBJECTS;
    if (over <= 0) return [];
    const closable: MadeAppServeRecord[] = [];
    let kept = 0;
    let unread = 0;
    for (const record of open) {
      const intent = this.#intentOf(record.appId);
      if (intent === undefined) unread += 1;
      else if (intent.kept === true && intent.hidden !== true) kept += 1;
      else closable.push(record);
    }
    if (closable.length >= over) {
      return closable.sort((a, b) => (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0)).slice(0, over);
    }
    const bound = `at most ${ARTIFACT_LIMITS.LOCAL_OBJECTS} apps and artifacts may be served at once`;
    const details = { resource: MADE_APP_OPEN.RESOURCE, limit: ARTIFACT_LIMITS.LOCAL_OBJECTS };
    if (unread === 0 && kept > 0) {
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        `${bound}, and every open app is kept`,
        false,
        details,
      );
    }
    throw new RpcCallError(
      "RESOURCE_EXHAUSTED",
      unread > 0
        ? `${bound}, and this desktop is still reading which open apps are kept`
        : `${bound}, and live artifacts hold every place`,
      true,
      details,
    );
  }

  async #allocatePort(appId: string): Promise<number> {
    return await this.#probePort(madeAppPortCandidate(appId));
  }

  /** The made rule's linear probe over the ONE reservation set: AH's, this service's (closed apps included) and the
   * live listeners (best effort: the mesh may be down, and then the persisted reservations are the truth). */
  async #probePort(first: number): Promise<number> {
    const live: number[] = [];
    try {
      for (const serve of await this.#bridge.observed()) {
        if (Number.isInteger(serve.listenPort) && serve.listenPort > 0) live.push(serve.listenPort);
      }
    } catch {
      // Mesh down is normal; a later native collision surfaces as the add's own error.
    }
    // F9: both reservation sets are read AFTER the wait, and the pick is held until its commit or failure (the caller
    // releases it), so AH's allocation cannot hand out the same port in between. Nothing awaits from here to the pick.
    const used = new Set<number>([...this.#otherReservedPorts(), ...this.reservedPorts(), ...live]);
    const width = ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1;
    for (let offset = 0; offset < width; offset += 1) {
      const candidate =
        ARTIFACT_LIMITS.LISTEN_PORT_MIN +
        ((first - ARTIFACT_LIMITS.LISTEN_PORT_MIN + offset) % width);
      if (!used.has(candidate)) {
        this.#claimedPorts.add(candidate);
        return candidate;
      }
    }
    throw new RpcCallError("RESOURCE_EXHAUSTED", "no artifact listener port is available", true, {
      resource: "artifact-listen-port",
      min: ARTIFACT_LIMITS.LISTEN_PORT_MIN,
      max: ARTIFACT_LIMITS.LISTEN_PORT_MAX,
    });
  }

  // ---- reconciliation -----------------------------------------------------

  /** Drain the retirements, prune old folders, then declare every open app with nothing retiring, and the previews
   * serve, under the linked login. Unlinked, nothing is declared. Answers whether the declare landed (false: it
   * threw, which an open answers `export-failed`). */
  async #reconcile(): Promise<boolean> {
    if (this.#disposed) return true;
    await this.#drainRetiring();
    this.#pruneFolders();

    const login = this.#linkedLogin();
    const specs: ServeSpec[] = [];
    const declared = new Map<string, string>();
    if (login !== null) {
      for (const record of this.#registry.apps.values()) {
        if (record.state !== "open" || record.retiringServeIds.length > 0) continue;
        const input = this.#appInput(record, login);
        if (input === undefined) continue;
        try {
          // the capture refuses a missing folder, so it is made before the declare
          mkdirSync(input.previewDir, { recursive: true, mode: 0o700 });
        } catch (error) {
          this.#logger.info(
            "fieldd.made_apps.preview_prepare_deferred",
            "A made app's preview storage is unavailable and will be retried",
            { appId: record.appId, error: errorName(error) },
          );
          continue;
        }
        const spec = appSpec(input);
        specs.push(spec);
        declared.set(record.appId, madeAppServeId(input));
      }
    }
    const previews = await this.#previewsSpec(login);
    if (previews !== undefined) specs.push(previews);

    this.#specs = specs;
    this.#declared = declared;
    this.#previewsDeclared = previews?.serveId;
    let carried = true;
    try {
      await this.#bridge.declare(specs);
    } catch (error) {
      carried = false;
      this.#logger.info(
        "fieldd.made_apps.declare_deferred",
        "Made app listeners are not carried yet",
        {
          error: errorName(error),
        },
      );
    }
    this.#adoptUrls();
    return carried;
  }

  async #drainRetiring(): Promise<void> {
    for (const snapshot of [...this.#registry.apps.values()]) {
      for (const serveId of [...snapshot.retiringServeIds]) {
        try {
          await this.#bridge.remove(serveId);
        } catch (error) {
          this.#logger.info(
            "fieldd.made_apps.remove_deferred",
            "A made app's listener removal will be retried",
            { appId: snapshot.appId, error: errorName(error) },
          );
          break;
        }
        const latest = this.#registry.apps.get(snapshot.appId);
        if (latest === undefined) break;
        const next = MadeAppServeRecord.parse({
          ...latest,
          retiringServeIds: latest.retiringServeIds.filter((id) => id !== serveId),
        });
        if (!this.#tryCommit(this.#withRecord(next), "retirement checkpoint")) break;
      }
    }
  }

  /** An app's older digest folders go once nothing serves them: after its retirements have converged. */
  #pruneFolders(): void {
    for (const appId of [...this.#prune]) {
      const record = this.#registry.apps.get(appId);
      if (record?.exportedDigest === undefined) {
        this.#prune.delete(appId);
        continue;
      }
      if (record.retiringServeIds.length > 0) continue;
      try {
        // both roots: the served views and the exports they were built from. An export's page is a hard link to
        // rosetta's own object, so removing it unlinks a name and never the object.
        for (const root of [this.#madeRoot, this.#exportRoot]) {
          const dir = join(root, appId);
          if (!isDirectory(dir)) continue;
          for (const name of readdirSync(dir)) {
            if (name === record.exportedDigest) continue;
            rmSync(join(dir, name), { recursive: true, force: true });
          }
        }
        this.#prune.delete(appId);
      } catch (error) {
        this.#logger.info(
          "fieldd.made_apps.prune_deferred",
          "A made app's older export folders will be removed later",
          { appId, error: errorName(error) },
        );
      }
    }
  }

  /** The previews serve under `login`: its port assigned once (persisted first), its folder made, and a serve
   * declared under another gate removed before the new one is added on the same port. */
  async #previewsSpec(login: string | null): Promise<ServeSpec | undefined> {
    let wanted: ServeSpec | undefined;
    if (login !== null) {
      const port = await this.#previewsPort();
      if (port !== undefined) {
        try {
          mkdirSync(this.#madePreviewsRoot, { recursive: true, mode: 0o700 });
          wanted = previewsSpec({
            listenPort: port,
            allow: [serveAllowGlob(login)],
            dir: this.#madePreviewsRoot,
          });
        } catch (error) {
          this.#logger.info(
            "fieldd.made_apps.previews_prepare_deferred",
            "The made apps' previews folder is unavailable and will be retried",
            { error: errorName(error) },
          );
        }
      }
    }
    if (this.#previewsDeclared !== undefined && this.#previewsDeclared !== wanted?.serveId) {
      this.#previewsRetiring.add(this.#previewsDeclared);
    }
    for (const serveId of [...this.#previewsRetiring]) {
      if (serveId === wanted?.serveId) {
        this.#previewsRetiring.delete(serveId);
        continue;
      }
      try {
        await this.#bridge.remove(serveId);
        this.#previewsRetiring.delete(serveId);
      } catch (error) {
        this.#logger.info(
          "fieldd.made_apps.previews_remove_deferred",
          "The previews listener's removal will be retried",
          { error: errorName(error) },
        );
      }
    }
    return this.#previewsRetiring.size > 0 ? undefined : wanted;
  }

  async #previewsPort(): Promise<number | undefined> {
    const kept = this.#registry.previewsListenPort;
    if (kept !== undefined) return kept;
    const port = await this.#probePort(madeAppPreviewsPortCandidate(this.#deviceId));
    const committed = this.#tryCommit(
      { ...this.#registry, previewsListenPort: port },
      "previews port",
    );
    this.#claimedPorts.delete(port);
    return committed ? port : undefined;
  }

  /** Keep each declared app's URL as its listener reported it (raw; checked again whenever it is answered). */
  #adoptUrls(): void {
    const states = this.#states();
    let apps: Map<string, MadeAppServeRecord> | null = null;
    for (const [appId, serveId] of this.#declared) {
      const record = this.#registry.apps.get(appId);
      const url = states.get(serveId)?.url;
      if (
        record === undefined ||
        url === undefined ||
        url === record.lastServedUrl ||
        url.length > ARTIFACT_LIMITS.URL_CHARS
      ) {
        continue;
      }
      apps ??= new Map(this.#registry.apps);
      apps.set(appId, MadeAppServeRecord.parse({ ...record, lastServedUrl: url }));
    }
    if (apps !== null) this.#tryCommit({ ...this.#registry, apps }, "observed URL checkpoint");
  }

  /** Remove any `artifact-made-` listener this service does not mean to hold (`#wantedIds`): one a crash left between
   * a remove and its add, one declared under a login that changed while fieldd was down, or one a close could not
   * name. It runs before its pass declares. A sweep that could not list the floor, or left a stray up, stays owed
   * and the one timer retries it. */
  async #sweepStrays(): Promise<void> {
    if (this.#disposed) return;
    let observed: ObservedServe[];
    try {
      observed = await this.#bridge.observed();
    } catch {
      this.#sweepOwed = true;
      return;
    }
    const wanted = this.#wantedIds();
    let clean = true;
    for (const serve of observed) {
      if (!serve.serveId.startsWith(MADE_APP_SERVE_PREFIX) || wanted.has(serve.serveId)) continue;
      try {
        await this.#bridge.remove(serve.serveId);
      } catch (error) {
        clean = false;
        this.#logger.info(
          "fieldd.made_apps.stray_remove_deferred",
          "A made app listener this desktop no longer declares will be removed later",
          { error: errorName(error) },
        );
      }
    }
    this.#sweepOwed = !clean;
  }

  /** The made ids this service means to hold under the linked login: each OPEN app's (whether or not this pass can
   * declare it: an app whose preview folder could not be made, one whose old serve is still retiring, or one whose
   * intent is not read yet keeps its live listener) and the previews serve's on its kept port. Unlinked: none. */
  #wantedIds(): Set<string> {
    const wanted = new Set<string>();
    const login = this.#linkedLogin();
    if (login === null) return wanted;
    for (const record of this.#registry.apps.values()) {
      if (record.state !== "open") continue;
      const input = this.#appInput(record, login);
      if (input !== undefined) wanted.add(madeAppServeId(input));
    }
    const port = this.#registry.previewsListenPort;
    if (port !== undefined) {
      wanted.add(
        madePreviewsServeId({
          listenPort: port,
          allow: [serveAllowGlob(login)],
          dir: this.#madePreviewsRoot,
        }),
      );
    }
    return wanted;
  }

  // ---- keep, hide and the idle close --------------------------------------

  async #reconsider(): Promise<void> {
    if (this.#disposed || !this.#started) return;
    if (this.#applyIntents()) await this.#reconcile();
    this.#armTimer();
  }

  /** Hidden: the serve retires and its preview link goes. Unhidden: the link comes back (no reopen). Open, unkept and
   * past its idle close: it closes. A record whose intent cannot be read yet is left as it was. Answers whether a
   * record changed. */
  #applyIntents(): boolean {
    const now = this.#now();
    let apps: Map<string, MadeAppServeRecord> | null = null;
    for (const record of this.#registry.apps.values()) {
      const intent = this.#intentOf(record.appId);
      // not readable yet (its row is not held, the table does not speak): decide nothing; `reconsider()` will
      if (intent === undefined) continue;
      if (intent.hidden === true) {
        if (record.state === "open") {
          apps ??= new Map(this.#registry.apps);
          apps.set(record.appId, this.#closing(record, now));
        }
        this.#captureOnUrl.delete(record.appId);
        if (!this.#linkWithheld.has(record.appId) && record.previewId !== undefined) {
          this.#unlinkPreview(record.previewId);
        }
        this.#linkWithheld.add(record.appId);
        continue;
      }
      if (this.#linkWithheld.delete(record.appId) && record.preview !== undefined) {
        try {
          this.#linkPreview(record.preview.id);
        } catch (error) {
          this.#logger.info(
            "fieldd.made_apps.relink_preview_failed",
            "An unhidden made app's preview could not be linked again",
            { appId: record.appId, error: errorName(error) },
          );
        }
      }
      if (record.state === "open" && intent.kept !== true && this.#overdue(record, now)) {
        apps ??= new Map(this.#registry.apps);
        apps.set(record.appId, this.#closing(record, now));
      }
    }
    if (apps === null) return false;
    return this.#tryCommit({ ...this.#registry, apps }, "intent checkpoint");
  }

  /** The one timer's work: close what is overdue, then retry what is owed (a removal that failed, a sweep that could
   * not be made), so a hidden or idle-closed app's listener never waits for an unrelated event to go. */
  async #tick(): Promise<void> {
    if (this.#disposed) return;
    const closed = this.#closeOverdue();
    if (closed || this.#retryOwed()) {
      if (this.#sweepOwed) await this.#sweepStrays();
      await this.#reconcile();
    }
    this.#armTimer();
  }

  /** Close every open app past its idle close whose intent is read and not kept. Answers whether it committed. */
  #closeOverdue(): boolean {
    const now = this.#now();
    let apps: Map<string, MadeAppServeRecord> | null = null;
    for (const record of this.#registry.apps.values()) {
      if (record.state !== "open" || !this.#overdue(record, now)) continue;
      const intent = this.#intentOf(record.appId);
      if (intent === undefined || (intent.kept === true && intent.hidden !== true)) continue;
      apps ??= new Map(this.#registry.apps);
      apps.set(record.appId, this.#closing(record, now));
    }
    return apps !== null && this.#tryCommit({ ...this.#registry, apps }, "idle close checkpoint");
  }

  #overdue(record: MadeAppServeRecord, now: number): boolean {
    return (record.lastOpenedAt ?? 0) + MADE_APP_LIMITS.IDLE_CLOSE_MS <= now;
  }

  /** Whether a removal (an app's, the previews serve's) or a sweep is still owed. */
  #retryOwed(): boolean {
    if (this.#sweepOwed || this.#previewsRetiring.size > 0) return true;
    for (const record of this.#registry.apps.values()) {
      if (record.retiringServeIds.length > 0) return true;
    }
    return false;
  }

  /** ONE timer: to the next due close of an open app whose intent is read and unkept, or RETRY_MS while a removal or
   * a sweep is owed, whichever is sooner; none while nothing can close and nothing is owed. */
  #armTimer(): void {
    if (this.#timer !== null) {
      this.#timers.clear(this.#timer);
      this.#timer = null;
    }
    if (this.#disposed) return;
    const now = this.#now();
    let due: number | undefined;
    for (const record of this.#registry.apps.values()) {
      if (record.state !== "open") continue;
      const intent = this.#intentOf(record.appId);
      if (intent === undefined || (intent.kept === true && intent.hidden !== true)) continue;
      const at = (record.lastOpenedAt ?? 0) + MADE_APP_LIMITS.IDLE_CLOSE_MS;
      if (due === undefined || at < due) due = at;
    }
    if (this.#retryOwed()) due = Math.min(due ?? Number.POSITIVE_INFINITY, now + RETRY_MS);
    if (due === undefined) return;
    let ms = Math.min(Math.max(0, due - now), MAX_TIMER_MS);
    if (!this.#storageOk) ms = Math.max(ms, STORAGE_RETRY_MS);
    this.#timer = this.#timers.set(() => {
      this.#timer = null;
      if (!this.#disposed) this.#background("idle close", () => this.#tick());
    }, ms);
  }

  /** A record closed: no serve declared, its floor serve retiring; its port, preview and folder kept. */
  #closing(record: MadeAppServeRecord, now: number): MadeAppServeRecord {
    const login = this.#linkedLogin();
    const input = login === null ? undefined : this.#appInput(record, login);
    // Before the first declare (a restart), the floor's id is the one the current login spells; the sweep is the net.
    const floorId =
      this.#declared.get(record.appId) ?? (input === undefined ? undefined : madeAppServeId(input));
    const closed = MadeAppServeRecord.parse({ ...record, state: "closed", updatedAt: now });
    // a close never fails on a full retirement list: the sweep, owed now, removes what it could not name
    if (floorId === undefined || closed.retiringServeIds.length >= MAX_RETIRING_IDS) {
      this.#sweepOwed = true;
      return closed;
    }
    return this.#retiring(closed, floorId, now);
  }

  #retiring(record: MadeAppServeRecord, serveId: string, now: number): MadeAppServeRecord {
    if (record.retiringServeIds.includes(serveId)) return record;
    if (record.retiringServeIds.length >= MAX_RETIRING_IDS) {
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        "too many made app listener replacements are awaiting removal",
        true,
        { resource: "made-app-retiring-listeners", limit: MAX_RETIRING_IDS },
      );
    }
    return MadeAppServeRecord.parse({
      ...record,
      retiringServeIds: [...record.retiringServeIds, serveId],
      updatedAt: now,
    });
  }

  /** The person's merged intent for an app, read by the fold key its ROW spells. Undefined while that key is unknown:
   * the row is not held and the table does not speak yet (a restart, before 3a's walk), so a `native:` or `hosted:`
   * intent cannot be read and nothing may be decided from it. Once the table speaks, an app with no row (gone from
   * the library) is read by its desktop's form. */
  #intentOf(appId: string): MadeAppIntent | undefined {
    const row = this.#rows.get(appId);
    if (row === undefined && !this.#rows.speaks()) return undefined;
    const foldKey = madeAppFoldKey(row ?? { device: this.#deviceId, appId });
    return this.#intents.of(foldKey) ?? {};
  }

  /** Whether the app's declared serve is one the floor refused: its add failed, or its proxy reports an error. */
  #serveFailed(appId: string): boolean {
    const serveId = this.#declared.get(appId);
    return serveId !== undefined && this.#states().get(serveId)?.status === "error";
  }

  // ---- previews and the capture -------------------------------------------

  /** The capture runs when one is owed (no preview yet, or one of another page), the shell can draw and the app's
   * listener answers a valid URL: one at a time, beside the mutation chain, never while hidden. */
  #maybeCapture(appId: string): void {
    const capture = this.#capturePreview;
    if (capture === undefined || this.#disposed || this.#capturing.has(appId)) return;
    if (!this.#capturePreviewAvailable()) return;
    const record = this.#registry.apps.get(appId);
    const previewId = record?.previewId;
    const pageDigest = record?.exportedDigest;
    if (record === undefined || previewId === undefined || pageDigest === undefined) return;
    if (record.preview?.pageDigest === pageDigest) return;
    const intent = this.#intentOf(appId);
    if (intent === undefined || intent.hidden === true) return;
    const url = this.#servingUrl(appId);
    if (url === undefined) return;
    const params = ShellWebContentsCaptureArtifactPreviewParams.safeParse({
      artifactId: previewId,
      url,
      allowHosts: record.reach ?? [],
    });
    if (!params.success) {
      this.#logger.info(
        "fieldd.made_apps.capture_refused",
        "A made app's capture was not asked: its URL or hosts are not a capture's",
        { appId },
      );
      return;
    }
    this.#capturing.add(appId);
    void this.#enqueuePreview(async () => {
      try {
        const result = await capture(params.data);
        const digest = result.digest;
        if (digest === undefined) {
          this.#logger.info(
            "fieldd.made_apps.capture_undigested",
            "The shell's capture answered no digest, so no preview is stamped",
            { appId },
          );
          return;
        }
        await this.#enqueue(async () => this.#stamp(appId, previewId, digest, pageDigest));
      } catch (error) {
        this.#logger.info("fieldd.made_apps.capture_failed", "A made app's capture failed", {
          appId,
          error: errorName(error),
        });
      } finally {
        this.#capturing.delete(appId);
      }
    });
  }

  /** After a capture: the JPEG hard-linked into made-previews (unless hidden), then the record's preview, announced. */
  #stamp(appId: string, previewId: string, digest: string, pageDigest: string): void {
    if (this.#disposed) return;
    const record = this.#registry.apps.get(appId);
    if (record === undefined || record.previewId !== previewId) return;
    const intent = this.#intentOf(appId);
    if (intent !== undefined && intent.hidden !== true) {
      try {
        this.#linkPreview(previewId);
      } catch (error) {
        this.#logger.info(
          "fieldd.made_apps.link_failed",
          "A made app's capture could not be linked for the previews serve",
          { appId, error: errorName(error) },
        );
        return;
      }
    } else {
      // hidden, or not readable now: the link waits until the app is read unhidden (`#applyIntents`)
      this.#linkWithheld.add(appId);
    }
    const now = this.#now();
    const preview = MadeAppPreview.parse({ id: previewId, digest, pageDigest, capturedAt: now });
    const next = MadeAppServeRecord.parse({ ...record, preview, updatedAt: now });
    if (!this.#tryCommit(this.#withRecord(next), "preview checkpoint")) return;
    for (const cb of [...this.#previewListeners]) {
      try {
        cb([appId]);
      } catch (error) {
        this.#logger.info("fieldd.made_apps.listener_failed", "A previews listener threw", {
          error: errorName(error),
        });
      }
    }
  }

  /** Hard-link the capture's JPEG into `made-previews/<previewId>/` (L12): `fs.link` to a dot-temp, then a rename, so
   * the previews serve never sees a half state and nothing reads the bytes. The link must be the very file the
   * capture wrote: a symlink, or a file swapped in meanwhile, is refused (EL7). */
  #linkPreview(previewId: string): void {
    const source = join(this.#previewRoot, previewId, MADE_APP_PREVIEW_FILE);
    const before = lstatSync(source);
    if (!before.isFile()) throw new Error("the capture is not a regular file");
    const dir = join(this.#madePreviewsRoot, previewId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `.${MADE_APP_PREVIEW_FILE}.${ulid(this.#now())}.tmp`);
    linkSync(source, tmp);
    try {
      const linked = lstatSync(tmp);
      if (!linked.isFile() || linked.ino !== before.ino || linked.dev !== before.dev) {
        throw new Error("the capture changed while it was linked");
      }
      renameSync(tmp, join(dir, MADE_APP_PREVIEW_FILE));
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }

  #unlinkPreview(previewId: string): void {
    try {
      rmSync(join(this.#madePreviewsRoot, previewId), { recursive: true, force: true });
    } catch (error) {
      this.#logger.info(
        "fieldd.made_apps.unlink_preview_failed",
        "A hidden made app's preview link could not be removed",
        { error: errorName(error) },
      );
    }
  }

  // ---- the bridge ---------------------------------------------------------

  #onBridge(): void {
    if (this.#disposed) return;
    for (const check of [...this.#waiters]) check();
    this.#background("listener report", async () => {
      if (this.#disposed) return;
      this.#adoptUrls();
      this.#onUrls();
    });
  }

  /** An open that answered `starting` captures once its listener reports a valid URL. */
  #onUrls(): void {
    for (const appId of [...this.#captureOnUrl]) {
      if (this.#servingUrl(appId) === undefined) continue;
      this.#captureOnUrl.delete(appId);
      this.#maybeCapture(appId);
    }
  }

  #states(): Map<string, ServeState> {
    return new Map(this.#bridge.states().map((state) => [state.serveId ?? state.name, state]));
  }

  /** The app's URL as its own active listener reported it, if it is the app's to answer. */
  #servingUrl(appId: string): string | undefined {
    const serveId = this.#declared.get(appId);
    const record = this.#registry.apps.get(appId);
    if (serveId === undefined || record === undefined) return undefined;
    return this.#liveUrl(serveId, record.listenPort);
  }

  /** C16, validate or strip: an active listener's URL is answered only when it is a root URL (AH §6), on the port this
   * service gave it, at this desktop's own MagicDNS name. It is never rewritten. */
  #liveUrl(serveId: string, port: number): string | undefined {
    const state = this.#states().get(serveId);
    if (state?.status !== "active" || state.url === undefined) return undefined;
    const claim = artifactRootUrlClaim(state.url);
    if (claim === null || claim.port !== port) return undefined;
    const self = canonicalTailnetDnsName(this.#selfDnsName());
    if (self === undefined || claim.hostname !== self) return undefined;
    return state.url;
  }

  // ---- storage --------------------------------------------------------------

  #folder(appId: string, digest: string): string {
    return join(this.#madeRoot, appId, digest);
  }

  #appInput(record: MadeAppServeRecord, login: string): MadeAppServeInput | undefined {
    if (record.previewId === undefined || record.exportedDigest === undefined) return undefined;
    // the headers are composed from the record, so a restart spells the same serve. No serve without its policy.
    if (record.network === undefined) return undefined;
    const headers = madeAppServeHeaders({ source: "captured", hosts: record.network });
    if (!headers.ok) return undefined;
    return {
      appId: record.appId,
      listenPort: record.listenPort,
      allow: [serveAllowGlob(login)],
      previewDir: join(this.#previewRoot, record.previewId),
      folder: this.#folder(record.appId, record.exportedDigest),
      headers: headers.headers,
    };
  }

  #discardFolder(folder: string): void {
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch (error) {
      this.#logger.info(
        "fieldd.made_apps.discard_failed",
        "A failed export's folder could not be removed",
        { error: errorName(error) },
      );
    }
  }

  /** Tolerant load: an unreadable file is moved aside and boot goes on empty; a record this build cannot read is
   * dropped alone, so one bad record never costs the others their ports. */
  #load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.#registryPath, "utf8");
    } catch (error) {
      if (isCode(error, "ENOENT")) return;
      this.#storageOk = false;
      this.#logger.error(
        "fieldd.made_apps.read_failed",
        "The made apps' serve registry could not be read",
        undefined,
        { error: errorName(error) },
      );
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.#quarantine();
      return;
    }
    const shape = json as { v?: unknown; apps?: unknown; previewsListenPort?: unknown } | null;
    if (
      shape === null ||
      typeof shape !== "object" ||
      shape.v !== 1 ||
      !Array.isArray(shape.apps)
    ) {
      this.#quarantine();
      return;
    }
    const port = MadeAppRegistry.shape.previewsListenPort.safeParse(shape.previewsListenPort);
    const apps = new Map<string, MadeAppServeRecord>();
    let dropped = 0;
    for (const item of shape.apps) {
      const record = MadeAppServeRecord.safeParse(item);
      if (!record.success || apps.has(record.data.appId) || apps.size >= MADE_APP_LIMITS.INTENTS) {
        dropped += 1;
        continue;
      }
      apps.set(record.data.appId, record.data);
    }
    if (dropped > 0) {
      this.#logger.warn(
        "fieldd.made_apps.records_dropped",
        "Made app serve records this build cannot read were dropped",
        { dropped },
      );
    }
    this.#registry = { previewsListenPort: port.success ? port.data : undefined, apps };
  }

  #quarantine(): void {
    const backup = `${this.#registryPath}.bad-${this.#now()}`;
    try {
      durableRenameSync(this.#registryPath, backup);
    } catch {
      this.#storageOk = false;
    }
    this.#logger.error(
      "fieldd.made_apps.registry_unreadable",
      "The made apps' serve registry was unreadable; it was moved aside",
      undefined,
      { backup },
    );
  }

  #withRecord(record: MadeAppServeRecord): Registry {
    const apps = new Map(this.#registry.apps);
    apps.set(record.appId, record);
    return { ...this.#registry, apps };
  }

  /** Durable first: memory moves only once the file has. A failure is INTERNAL `made-app-storage` and moves nothing. */
  #commit(next: Registry): void {
    const file: MadeAppRegistry = {
      v: 1,
      ...(next.previewsListenPort !== undefined
        ? { previewsListenPort: next.previewsListenPort }
        : {}),
      apps: [...next.apps.values()],
    };
    try {
      this.#writeRegistry(this.#registryPath, `${JSON.stringify(file, null, 2)}\n`);
    } catch (error) {
      this.#storageOk = false;
      throw new RpcCallError(
        "INTERNAL",
        "the made apps' serve registry could not be persisted",
        true,
        { service: "made-app-storage", state: "failed", code: errorName(error) },
      );
    }
    this.#registry = next;
    this.#storageOk = true;
  }

  #tryCommit(next: Registry, checkpoint: string): boolean {
    try {
      this.#commit(next);
      return true;
    } catch (error) {
      this.#logger.error(
        "fieldd.made_apps.checkpoint_failed",
        `The made apps' ${checkpoint} could not be persisted`,
        undefined,
        { error: errorName(error) },
      );
      return false;
    }
  }

  // ---- queues ---------------------------------------------------------------

  #enqueue<T>(operation: () => Promise<T>, rejectWhenDisposed = false): Promise<T> {
    if (rejectWhenDisposed && this.#disposed) return Promise.reject(stopping());
    const run = this.#chain.then(async () => {
      if (rejectWhenDisposed && this.#disposed) throw stopping();
      return await operation();
    });
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Queued work no caller awaits (an event's): a failure is logged, never an unhandled rejection. */
  #background(what: string, operation: () => Promise<void>): void {
    this.#enqueue(operation).catch((error: unknown) => {
      this.#logger.info(
        "fieldd.made_apps.background_failed",
        `The made apps' ${what} work failed`,
        {
          error: errorName(error),
        },
      );
    });
  }

  /** Captures are serialized apart from the mutations, so an open never waits for a browser load. */
  #enqueuePreview(operation: () => Promise<void>): Promise<void> {
    const run = this.#previewChain.then(operation);
    this.#previewChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function appSpec(input: MadeAppServeInput): ServeSpec {
  return {
    serveId: madeAppServeId(input),
    name: `${MADE_APP_SERVE_NAME_PREFIX}${input.appId}`,
    listenPort: input.listenPort,
    target: { kind: "dir", path: input.folder },
    previewDir: input.previewDir,
    ...(input.headers !== undefined && input.headers.length > 0
      ? { headers: [...input.headers] }
      : {}),
    allow: canonicalAllow(input.allow),
    tls: true,
  };
}

function previewsSpec(input: MadePreviewsServeInput): ServeSpec {
  return {
    serveId: madePreviewsServeId(input),
    name: MADE_PREVIEWS_SERVE_NAME,
    listenPort: input.listenPort,
    target: { kind: "dir", path: input.dir },
    allow: canonicalAllow(input.allow),
    tls: true,
  };
}

/** A hidden app and one no row names answer the same: a hidden app never opens. */
function notFound(): RpcCallError {
  return new RpcCallError("NOT_FOUND", "no such made app on this desktop", false);
}

function stopping(): RpcCallError {
  return new RpcCallError("UNAVAILABLE", "the made app service is stopping", true, {
    service: "made-apps",
    state: "stopping",
  });
}

/** An exporter's own refusal (`MadeAppOpenRefusal` in an UNAVAILABLE), whatever device it named. */
function refusalStateOf(error: unknown): MadeAppRefusalState | undefined {
  if (!(error instanceof RpcCallError) || error.kind !== "UNAVAILABLE") return undefined;
  const refusal = MadeAppOpenRefusal.safeParse(error.details);
  return refusal.success ? refusal.data.state : undefined;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** AH's atomic private write (artifact-service.ts `atomicWriteIntent`): a 0600 temp, fsync, the durable rename, and
 * the directory fsynced where the platform allows it. */
function atomicWritePrivate(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  // "r+": Windows FlushFileBuffers needs a write-access handle
  const file = openSync(tmp, "r+");
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  durableRenameSync(tmp, path);
  if (process.platform !== "win32") {
    let directory: number | null = null;
    try {
      directory = openSync(dirname(path), "r");
      fsyncSync(directory);
    } catch (error) {
      if (!isCode(error, "EINVAL") && !isCode(error, "ENOTSUP")) throw error;
    } finally {
      if (directory !== null) closeSync(directory);
    }
  }
}

function errorName(error: unknown): string {
  if (error instanceof RpcCallError) return error.kind;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code.slice(0, 64);
  }
  return error instanceof Error ? error.name : "UNKNOWN";
}

function isCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
