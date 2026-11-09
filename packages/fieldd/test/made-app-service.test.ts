// MA-3b — the made-app service (`made-app-service.ts`): a made app is served only when a person opens it, at its own
// port for life, from the folder rosetta's export wrote, behind the linked login; it closes a day after its last open
// unless kept; a hidden app never serves; one previews serve per desktop carries made apps' JPEGs and nothing else.
// Unit rows over fakes (the serve bridge, the library rows, the exporter, the intent reader, the capture, the clock and
// the one timer): no daemon, no field-native. The pure rules are held to `made-app-serving.vector.json`, which a
// script computed independently of this code. Rows named "PIN:" pass on the red skeleton by design.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  ARTIFACT_LIMITS,
  IndexCatalogApp,
  MADE_APP_LIMITS,
  MADE_APP_PORT_DOMAIN,
  MADE_APP_PREVIEWS_PORT_DOMAIN,
  MADE_APP_REGISTRY_FILE,
  MADE_APP_VIEW,
  MadeAppRegistry,
  type MadeAppServeRecord,
  madeAppFoldKey,
  madeAppServeHeaders,
  type ShellWebContentsCaptureArtifactPreviewParams,
  type ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { type ArtifactServeBridge, canonicalJson } from "../src/artifact-service";
import {
  canonicalMadeAppServingConfig,
  canonicalMadePreviewsServingConfig,
  type MadeAppExport,
  type MadeAppExporter,
  type MadeAppExportRequest,
  type MadeAppIntent,
  type MadeAppIntentReader,
  type MadeAppPresentation,
  type MadeAppRows,
  MadeAppService,
  type MadeAppServiceOptions,
  type MadeAppTimers,
  type MadeAppViewBuilder,
  madeAppPortCandidate,
  madeAppPreviewsPortCandidate,
  madeAppRefusal,
  madeAppServeId,
  madePreviewsServeId,
  prepareMadeAppRoots,
  rosettaMadeAppExporter,
} from "../src/made-app-service";
import type { ObservedServe, ServeSpec, ServeState } from "../src/mesh-client";
import { RpcCallError } from "../src/native-link";
import { serveAllowGlob } from "../src/terminal-serve";
import type { BuildMadeViewArgs } from "../src/workspace/protocol";
import { TEST_LOGIN } from "./link-fixture";

const FIXTURES = join(import.meta.dirname, "../../contracts/fixtures");
const HOST = "studio.tail1234.ts.net";
const HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"];
const T0 = 1_793_836_900_000;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

interface ServingVector {
  portDomain: string;
  previewsPortDomain: string;
  appId: string;
  deviceId: string;
  portCandidate: number;
  previewsPortCandidate: number;
  app: {
    listenPort: number;
    allow: string[];
    previewDir: string;
    folder: string;
    canonicalJson: string;
    sha256: string;
    serveId: string;
  };
  appWithHeaders: {
    listenPort: number;
    allow: string[];
    previewDir: string;
    folder: string;
    headers: Array<{ name: string; value: string }>;
    canonicalJson: string;
    sha256: string;
    serveId: string;
  };
  previews: {
    listenPort: number;
    allow: string[];
    dir: string;
    canonicalJson: string;
    sha256: string;
    serveId: string;
  };
}

const VECTOR = fixture("made-app-serving.vector.json") as ServingVector;
const GOLDEN_ROW = IndexCatalogApp.parse(fixture("index-catalog-app.valid.json"));
const DEVICE = GOLDEN_ROW.device;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hex = (seed: string) => sha256(seed);

/** The made rule's first candidate, computed here on its own (the vector pins the module's). */
function candidateOf(domain: string, id: string): number {
  const digest = createHash("sha256").update(domain).update(id).digest();
  const width = ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1;
  return ARTIFACT_LIMITS.LISTEN_PORT_MIN + (digest.readUInt32BE(0) % width);
}

/** The port `steps` past `port` in the linear probe, wrapping inside AH's range. */
function probed(port: number, steps = 1): number {
  const width = ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1;
  return (
    ARTIFACT_LIMITS.LISTEN_PORT_MIN + ((port - ARTIFACT_LIMITS.LISTEN_PORT_MIN + steps) % width)
  );
}

/** One app in THIS desktop's library: the contract's golden row with its own ids, no preview and no hosted link. */
function appRow(n: number, over: Record<string, unknown> = {}): IndexCatalogApp {
  const { "//": _note, preview: _preview, hostedUrl: _hosted, ...golden } = GOLDEN_ROW;
  return IndexCatalogApp.parse({
    ...golden,
    device: DEVICE,
    appId: hex(`app-${n}`),
    presentationId: hex(`presentation-${n}-1`),
    title: `App ${n}`,
    filename: `app-${n}.html`,
    sessionId: `ses-${n}`,
    timelineId: `artifact-message-${n}`,
    versions: 1,
    digest: hex(`page-${n}-1`),
    nativeId: `native-${n}`,
    ...over,
  });
}

const digestOf = (row: IndexCatalogApp) => row.digest ?? "<no digest>";
const glob = (login: string) => serveAllowGlob(login);

/** One call the bridge saw, in order: a declare names every id it carried, a remove whether it converged. */
type BridgeEvent = { op: "declare"; ids: string[] } | { op: "remove"; id: string; ok: boolean };

class FakeBridge implements ArtifactServeBridge {
  declared: ServeSpec[][] = [];
  desired: ServeSpec[] = [];
  native = new Map<string, ServeState>();
  listeners = new Set<() => void>();
  removeAttempts: string[] = [];
  events: BridgeEvent[] = [];
  failRemoveCount = 0;
  /** ids whose removal fails while they are named here */
  failRemove = new Set<string>();
  /** AH's FakeBridge's: the declare throws (a non-mesh-down failure) */
  failDeclare = false;
  /** the floor refuses every add: a carried serve's fused state is `error` with no URL */
  errorOnAdd = false;
  autoCarry = true;
  observedOverride: ObservedServe[] | null = null;
  afterDeclare: ((specs: ServeSpec[]) => void) | null = null;

  async declare(specs: ServeSpec[]): Promise<void> {
    this.declared.push(structuredClone(specs));
    this.events.push({ op: "declare", ids: specs.map((spec) => spec.serveId ?? spec.name) });
    if (this.failDeclare) throw new RpcCallError("INTERNAL", "scripted declare failure", true);
    this.desired = specs;
    if (this.autoCarry) {
      for (const spec of specs) {
        const id = spec.serveId ?? spec.name;
        if (!this.native.has(id)) {
          this.native.set(
            id,
            this.errorOnAdd
              ? { ...spec, status: "error", error: "scripted add failure" }
              : { ...spec, status: "active", url: `https://${HOST}:${spec.listenPort}` },
          );
        }
      }
    }
    this.afterDeclare?.(specs);
  }

  async remove(serveId: string): Promise<{ removed: boolean }> {
    this.removeAttempts.push(serveId);
    if (this.failRemoveCount > 0 || this.failRemove.has(serveId)) {
      if (this.failRemoveCount > 0) this.failRemoveCount -= 1;
      this.events.push({ op: "remove", id: serveId, ok: false });
      throw new RpcCallError("INTERNAL", "scripted remove failure", true);
    }
    this.native.delete(serveId);
    this.events.push({ op: "remove", id: serveId, ok: true });
    return { removed: true };
  }

  /** Where `serveId`'s first converged removal sits in the call order (-1: never). */
  removedAt(serveId: string): number {
    return this.events.findIndex((e) => e.op === "remove" && e.id === serveId && e.ok);
  }

  /** Where the first declare that carried `serveId` sits in the call order (-1: never). */
  firstDeclaredAt(serveId: string): number {
    return this.events.findIndex((e) => e.op === "declare" && e.ids.includes(serveId));
  }

  states(): ServeState[] {
    return this.desired.map((spec) => {
      const id = spec.serveId ?? spec.name;
      return this.native.get(id) ?? { ...spec, status: "pending" };
    });
  }

  async observed(): Promise<ObservedServe[]> {
    if (this.observedOverride !== null) return this.observedOverride;
    return [...this.native.values()].flatMap((state) =>
      state.listenPort === undefined
        ? []
        : [
            {
              serveId: state.serveId ?? state.name,
              name: state.name,
              listenPort: state.listenPort,
            },
          ],
    );
  }

  on(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** The listener reports `url` for `serveId` (a runtime event). */
  carry(serveId: string, url: string): void {
    const spec = this.desired.find((s) => (s.serveId ?? s.name) === serveId);
    const base: ServeState = this.native.get(serveId) ?? {
      ...(spec ?? { name: serveId, serveId, target: { kind: "routes" } }),
      status: "active",
    };
    this.native.set(serveId, { ...base, status: "active", url });
    for (const cb of this.listeners) cb();
  }

  last(): ServeSpec[] {
    return this.declared.at(-1) ?? [];
  }
}

/** 3a's `IndexApps` as 3e adapts it: the table's rows, its first walk (`ready`) and rosetta's last `canonical_ready`
 * (`libraryReady`), joined exactly as the seam's doc says 3e joins them. */
class FakeRows implements MadeAppRows {
  apps = new Map<string, IndexCatalogApp>();
  versions = new Map<string, MadeAppPresentation>();
  /** IndexApps.ready: this boot's first walk completed */
  walked = true;
  /** IndexApps.libraryReady: rosetta's last canonical_ready (undefined: no page read) */
  canonicalReady: boolean | undefined = true;

  add(row: IndexCatalogApp): IndexCatalogApp {
    this.apps.set(row.appId, row);
    return row;
  }

  get(appId: string): IndexCatalogApp | undefined {
    return this.apps.get(appId);
  }

  speaks(): boolean {
    return this.walked && this.canonicalReady === true;
  }

  async presentation(
    appId: string,
    presentationId: string,
  ): Promise<MadeAppPresentation | undefined> {
    return this.versions.get(`${appId}:${presentationId}`);
  }
}

class FakeExporter implements MadeAppExporter {
  calls: MadeAppExportRequest[] = [];
  hosts: string[] = [...HOSTS];
  variables: Record<string, string> = { "--color-text-primary": "#111" };
  /** the page's path inside `into`, as rosetta names it */
  path = "index.html";
  failWith: unknown = null;
  /** rosetta's digest per publication; by default, the name of the folder it was asked to write */
  digests = new Map<string, string>();

  async export(request: MadeAppExportRequest): Promise<MadeAppExport> {
    this.calls.push({ ...request });
    if (this.failWith !== null) throw this.failWith;
    mkdirSync(request.into, { recursive: true });
    writeFileSync(join(request.into, "index.html"), "<!doctype html><title>made</title>");
    return {
      page: {
        path: this.path,
        blake3: this.digests.get(request.publicationId) ?? basename(request.into),
        bytes: 34,
      },
      environment: { hosts: { "script-src": [...this.hosts] }, variables: { ...this.variables } },
    };
  }
}

/** The files worker's view: it records what it was asked and writes the served folder. */
class FakeView implements MadeAppViewBuilder {
  calls: BuildMadeViewArgs[] = [];
  failWith: unknown = null;

  async build(args: BuildMadeViewArgs): Promise<unknown> {
    this.calls.push(structuredClone(args));
    if (this.failWith !== null) throw this.failWith;
    mkdirSync(args.folder, { recursive: true });
    writeFileSync(join(args.folder, MADE_APP_VIEW.FILE), "<!doctype html><title>view</title>");
    return { bytes: 34 };
  }
}

class FakeIntents implements MadeAppIntentReader {
  readonly #rows = new Map<string, MadeAppIntent>();
  readonly #listeners = new Set<() => void>();

  of(foldKey: string): MadeAppIntent | undefined {
    return this.#rows.get(foldKey);
  }

  on(cb: () => void): () => void {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  set(foldKey: string, intent: MadeAppIntent | undefined): void {
    if (intent === undefined) this.#rows.delete(foldKey);
    else this.#rows.set(foldKey, intent);
    for (const cb of this.#listeners) cb();
  }
}

class FakeTimers implements MadeAppTimers {
  armed: Array<{ fn: () => void; ms: number; handle: number }> = [];
  #next = 0;

  set(fn: () => void, ms: number): unknown {
    this.#next += 1;
    this.armed.push({ fn, ms, handle: this.#next });
    return this.#next;
  }

  clear(handle: unknown): void {
    this.armed = this.armed.filter((timer) => timer.handle !== handle);
  }

  delays(): number[] {
    return this.armed.map((timer) => timer.ms);
  }

  /** Fire the oldest armed timer; false when none is armed. */
  fire(): boolean {
    const timer = this.armed.shift();
    if (timer === undefined) return false;
    timer.fn();
    return true;
  }
}

/** Electron's capture, as AH-4 built it: it refuses a missing preview folder, then atomically replaces the JPEG (a
 * new inode each time) and answers its SHA-256. */
class FakeCapture {
  calls: ShellWebContentsCaptureArtifactPreviewParams[] = [];
  /** a hostile capture: `thumbnail.jpg` is a symlink to this file instead of a JPEG */
  symlinkTo: string | null = null;
  /** a shell that answers `{captured: true}` and no digest */
  noDigest = false;
  #count = 0;

  constructor(readonly dataDir: string) {}

  readonly fn = async (
    params: ShellWebContentsCaptureArtifactPreviewParams,
  ): Promise<ShellWebContentsCaptureArtifactPreviewResult> => {
    this.calls.push(structuredClone(params));
    const dir = join(this.dataDir, "artifacts", "previews", params.artifactId);
    if (!existsSync(dir)) throw new Error(`the preview folder ${dir} does not exist`);
    this.#count += 1;
    const bytes = Buffer.from(`jpeg ${params.artifactId} #${this.#count}`);
    if (this.symlinkTo !== null) {
      rmSync(join(dir, "thumbnail.jpg"), { force: true });
      symlinkSync(this.symlinkTo, join(dir, "thumbnail.jpg"));
      return { captured: true, digest: sha256(bytes) };
    }
    const tmp = join(dir, ".thumbnail.jpg.tmp");
    writeFileSync(tmp, bytes);
    renameSync(tmp, join(dir, "thumbnail.jpg"));
    return this.noDigest ? { captured: true } : { captured: true, digest: sha256(bytes) };
  };
}

interface Parts {
  dataDir: string;
  bridge: FakeBridge;
  rows: FakeRows;
  exporter: FakeExporter;
  view: FakeView;
  intents: FakeIntents;
  timers: FakeTimers;
  clock: { now: number };
  capture: FakeCapture;
  login: string | null;
  dns: string | undefined;
  available: boolean;
  stamps: string[][];
}

function parts(over: Partial<Parts> = {}): Parts {
  let dataDir = over.dataDir;
  if (dataDir === undefined) {
    const fresh = mkdtempSync(join(tmpdir(), "vf-ma3b-"));
    cleanup.push(() => rmSync(fresh, { recursive: true, force: true }));
    dataDir = fresh;
  }
  return {
    bridge: new FakeBridge(),
    rows: new FakeRows(),
    exporter: new FakeExporter(),
    view: new FakeView(),
    intents: new FakeIntents(),
    timers: new FakeTimers(),
    clock: { now: T0 },
    capture: new FakeCapture(dataDir),
    login: TEST_LOGIN,
    dns: HOST,
    available: true,
    stamps: [],
    ...over,
    dataDir,
  };
}

function baseOptions(p: Parts): MadeAppServiceOptions {
  return {
    dataDir: p.dataDir,
    deviceId: DEVICE,
    bridge: p.bridge,
    rows: p.rows,
    exporter: p.exporter,
    view: p.view,
    intents: p.intents,
    linkedLogin: () => p.login,
    selfDnsName: () => p.dns,
    capturePreview: p.capture.fn,
    capturePreviewAvailable: () => p.available,
    now: () => p.clock.now,
    timers: p.timers,
    openWaitMs: 50,
  };
}

function made(p: Parts, over: Partial<MadeAppServiceOptions> = {}): MadeAppService {
  const svc = new MadeAppService({ ...baseOptions(p), ...over });
  svc.on("previews-changed", (appIds) => p.stamps.push([...appIds]));
  cleanup.push(() => svc.dispose());
  return svc;
}

type Settled = { ok: true; value: unknown } | { ok: false; error: unknown };

/** What an open came to, as a value an assertion can show: the answer, or the refusal's kind, retryability and
 * details. */
async function opened(
  svc: MadeAppService,
  appId: string,
  presentationId?: string,
): Promise<unknown> {
  let settled: Settled;
  try {
    const value = await svc.open(
      presentationId === undefined ? { appId } : { appId, presentationId },
    );
    settled = { ok: true, value };
  } catch (error) {
    settled = { ok: false, error };
  }
  if (settled.ok) return { resolved: settled.value };
  const error = settled.error;
  if (error instanceof RpcCallError) {
    return { kind: error.kind, retryable: error.retryable, details: error.details };
  }
  return { threw: error instanceof Error ? error.message : String(error) };
}

const serving = (port: number) => ({
  resolved: { state: "serving", url: `https://${HOST}:${port}`, reach: HOSTS },
});
const starting = { resolved: { state: "starting", reach: HOSTS } };
const refused = (state: string, retryable: boolean) => ({
  kind: "UNAVAILABLE",
  retryable,
  details: { service: "apps", state, device: DEVICE },
});

const registryPath = (p: Parts) => join(p.dataDir, "registries", MADE_APP_REGISTRY_FILE);

function readRegistry(p: Parts): MadeAppRegistry | undefined {
  if (!existsSync(registryPath(p))) return undefined;
  return MadeAppRegistry.parse(JSON.parse(readFileSync(registryPath(p), "utf8")));
}

function recordOf(p: Parts, appId: string): MadeAppServeRecord | undefined {
  return readRegistry(p)?.apps.find((record) => record.appId === appId);
}

const previewIdOf = (p: Parts, appId: string) => recordOf(p, appId)?.previewId ?? "<no preview id>";
const madeFolder = (p: Parts, row: IndexCatalogApp, digest = digestOf(row)) =>
  join(p.dataDir, "artifacts", "made", row.appId, digest);
/** Where rosetta's export places the page: below `--export-root`, never served. */
const exportFolder = (p: Parts, row: IndexCatalogApp, digest = digestOf(row)) =>
  join(p.dataDir, "drive", "import", row.appId, digest);

/** The headers a policy's hosts compose, by the contract's own composer. */
function headersFor(hosts: Record<string, string[]>): Array<{ name: string; value: string }> {
  const answer = madeAppServeHeaders({ source: "captured", hosts });
  if (!answer.ok) throw new Error(`no headers: ${answer.refused}`);
  return answer.headers;
}
const capturedFile = (p: Parts, previewId: string) =>
  join(p.dataDir, "artifacts", "previews", previewId, "thumbnail.jpg");
const linkedFile = (p: Parts, previewId: string) =>
  join(p.dataDir, "artifacts", "made-previews", previewId, "thumbnail.jpg");

const isPreviewsSpec = (spec: ServeSpec) =>
  spec.serveId?.startsWith("artifact-made-previews-") === true;
const appSpecOf = (bridge: FakeBridge, appId: string) =>
  bridge
    .last()
    .find((spec) => spec.serveId?.startsWith(`artifact-made-${appId.slice(0, 16)}-`) === true);
const previewsSpecOf = (bridge: FakeBridge) => bridge.last().find(isPreviewsSpec);
/** A listener already on the floor (field-native outlived fieldd), not declared by this service. */
const liveServe = (serveId: string, listenPort: number): ServeState => ({
  serveId,
  name: serveId,
  listenPort,
  target: { kind: "dir", path: "/elsewhere" },
  status: "active",
  url: `https://${HOST}:${listenPort}`,
});
const appPort = (row: IndexCatalogApp) => candidateOf(MADE_APP_PORT_DOMAIN, row.appId);

describe("MadeAppService (MA-3b unit)", () => {
  it("pins the made port rule, both serves' canonical bytes and their serve ids (the vector)", () => {
    expect(madeAppPortCandidate(VECTOR.appId), "the app's first candidate").toBe(
      VECTOR.portCandidate,
    );
    expect(
      madeAppPreviewsPortCandidate(VECTOR.deviceId),
      "the previews serve's first candidate",
    ).toBe(VECTOR.previewsPortCandidate);
    const app = {
      appId: VECTOR.appId,
      listenPort: VECTOR.app.listenPort,
      allow: VECTOR.app.allow,
      previewDir: VECTOR.app.previewDir,
      folder: VECTOR.app.folder,
    };
    const appCanonical = canonicalJson(canonicalMadeAppServingConfig(app));
    expect(appCanonical, "the app serve's canonical JSON").toBe(VECTOR.app.canonicalJson);
    expect(sha256(appCanonical)).toBe(VECTOR.app.sha256);
    expect(madeAppServeId(app), "the app serve's id").toBe(VECTOR.app.serveId);
    const previews = {
      listenPort: VECTOR.previews.listenPort,
      allow: VECTOR.previews.allow,
      dir: VECTOR.previews.dir,
    };
    const previewsCanonical = canonicalJson(canonicalMadePreviewsServingConfig(previews));
    expect(previewsCanonical, "the previews serve's canonical JSON").toBe(
      VECTOR.previews.canonicalJson,
    );
    expect(sha256(previewsCanonical)).toBe(VECTOR.previews.sha256);
    expect(madePreviewsServeId(previews), "the previews serve's id").toBe(VECTOR.previews.serveId);
  });

  it("MA-3f: a serve's headers are part of its config, so a policy change is a serve change (DR-L7)", () => {
    const { canonicalJson: wanted, sha256: digest, serveId, ...fields } = VECTOR.appWithHeaders;
    const input = { appId: VECTOR.appId, ...fields };
    const canonical = canonicalJson(canonicalMadeAppServingConfig(input));
    expect(canonical).toBe(wanted);
    expect(sha256(canonical)).toBe(digest);
    expect(madeAppServeId(input)).toBe(serveId);
    // one serve, two policies, two ids; and no headers is the row every older vector pins
    const { headers: _none, ...bare } = input;
    expect(madeAppServeId(bare)).toBe(VECTOR.app.serveId);
    expect(madeAppServeId({ ...input, headers: [] })).toBe(VECTOR.app.serveId);
  });

  it("PIN: the vector's domains are the contract's, apart from AH's, and its candidates follow the rule", () => {
    expect(VECTOR.portDomain).toBe(MADE_APP_PORT_DOMAIN);
    expect(VECTOR.previewsPortDomain).toBe(MADE_APP_PREVIEWS_PORT_DOMAIN);
    expect(
      new Set([MADE_APP_PORT_DOMAIN, MADE_APP_PREVIEWS_PORT_DOMAIN, "artifact-port-v1\0"]).size,
    ).toBe(3);
    expect(candidateOf(VECTOR.portDomain, VECTOR.appId)).toBe(VECTOR.portCandidate);
    expect(candidateOf(VECTOR.previewsPortDomain, VECTOR.deviceId)).toBe(
      VECTOR.previewsPortCandidate,
    );
    expect(VECTOR.deviceId).toBe(DEVICE);
  });

  it("words every refusal as MADE_APP_OPEN documents it: the three goldens, and each state's retryability", () => {
    const goldens: Record<string, unknown> = {};
    const worded: Record<string, unknown> = {};
    for (const [file, state] of [
      ["error-data.apps-export-unbuilt.json", "export-unbuilt"],
      ["error-data.apps-not-kept.json", "not-kept"],
      ["error-data.apps-reading.json", "library-reading"],
    ] as const) {
      const golden = fixture(file) as {
        kind: string;
        retryable: boolean;
        details: { device: string };
      };
      goldens[file] = golden;
      const error = madeAppRefusal(state, golden.details.device);
      worded[file] = { kind: error.kind, retryable: error.retryable, details: error.details };
    }
    expect(worded, "the refusals equal MA-1's goldens").toEqual(goldens);

    const retryable = {
      "export-unbuilt": false,
      "not-kept": false,
      "too-large": false,
      unsupported: false,
      "library-reading": true,
      "export-failed": true,
      "not-linked": true,
    } as const;
    const each: Record<string, unknown> = {};
    for (const state of Object.keys(retryable) as Array<keyof typeof retryable>) {
      const error = madeAppRefusal(state);
      each[state] = { kind: error.kind, retryable: error.retryable, details: error.details };
    }
    expect(each).toEqual(
      Object.fromEntries(
        Object.entries(retryable).map(([state, r]) => [
          state,
          { kind: "UNAVAILABLE", retryable: r, details: { service: "apps", state } },
        ]),
      ),
    );
  });

  it("keeps one previews serve: its port by the made rule over the device id, the made-previews folder only, its base validated", async () => {
    const p = parts();
    const svc = made(p);
    await svc.start();
    const port = VECTOR.previewsPortCandidate;
    const dir = join(p.dataDir, "artifacts", "made-previews");
    const spec = previewsSpecOf(p.bridge);
    expect(
      spec,
      "the previews serve is declared at start while linked, with no app open",
    ).toBeDefined();
    expect(spec).toEqual({
      serveId: madePreviewsServeId({ listenPort: port, allow: [glob(TEST_LOGIN)], dir }),
      name: "made-app-previews",
      listenPort: port,
      target: { kind: "dir", path: dir },
      allow: [glob(TEST_LOGIN)],
      tls: true,
    });
    expect(existsSync(dir), "the made-previews folder is made").toBe(true);
    expect(readRegistry(p)?.previewsListenPort, "its port is reserved for life").toBe(port);
    expect([...svc.reservedPorts()]).toEqual([port]);
    expect(svc.previewsBase(), "the base its listener reported").toBe(`https://${HOST}:${port}`);

    p.bridge.carry(spec?.serveId ?? "<none>", `https://evil.tail1234.ts.net:${port}`);
    await svc.settled();
    expect(svc.previewsBase(), "another host is stripped, never rewritten").toBeUndefined();
    p.bridge.carry(spec?.serveId ?? "<none>", `https://${HOST}:${port}`);
    p.dns = undefined;
    expect(svc.previewsBase(), "no base while this desktop's own name is unknown").toBeUndefined();

    // the port probes past AH's reservations like an app's
    const q = parts();
    const ahs = made(q, { otherReservedPorts: () => new Set([port]) });
    await ahs.start();
    expect(previewsSpecOf(q.bridge)?.listenPort, "the previews port skips AH's").toBe(probed(port));

    // unlinked, there is no audience to serve to
    const u = parts({ login: null });
    const unlinked = made(u);
    await unlinked.start();
    expect(previewsSpecOf(u.bridge), "no previews serve while unlinked").toBeUndefined();
  });

  it("exports the page into its digest folder, declares its serve on the app's own port and answers its listener's URL", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    p.exporter.hosts = [...HOSTS, "evil.ts.net", "10.0.0.1", "*.example.com", "Cdn.Example.com"];
    const svc = made(p);
    await svc.start();
    const outcome = await opened(svc, row.appId);
    const folder = madeFolder(p, row);
    expect(p.exporter.calls, "the exporter is asked once, into the non-served export").toEqual([
      { sessionId: row.sessionId, publicationId: row.presentationId, into: exportFolder(p, row) },
    ]);
    const port = appPort(row);
    expect(outcome, "the open answers its listener's URL and the shell's valid hosts").toEqual(
      serving(port),
    );
    const record = recordOf(p, row.appId);
    expect(record, "the app's serve record is persisted").toBeDefined();
    expect(record).toMatchObject({
      appId: row.appId,
      listenPort: port,
      exportedPresentationId: row.presentationId,
      exportedDigest: row.digest,
      state: "open",
      lastOpenedAt: T0,
      retiringServeIds: [],
      lastServedUrl: `https://${HOST}:${port}`,
      reach: HOSTS,
      createdAt: T0,
    });
    const previewId = previewIdOf(p, row.appId);
    expect(ULID.test(previewId), `a preview id is minted at the first open (${previewId})`).toBe(
      true,
    );
    const previewDir = join(p.dataDir, "artifacts", "previews", previewId);
    const allow = [glob(TEST_LOGIN)];
    const headers = headersFor({ script: HOSTS });
    expect(appSpecOf(p.bridge, row.appId)).toEqual({
      serveId: madeAppServeId({
        appId: row.appId,
        listenPort: port,
        allow,
        previewDir,
        folder,
        headers,
      }),
      name: `made-app:${row.appId}`,
      listenPort: port,
      target: { kind: "dir", path: folder },
      previewDir,
      headers,
      allow,
      tls: true,
    });
    expect(existsSync(previewDir), "the capture's folder is made before the declare").toBe(true);
    expect(svc.desiredServes(), "desiredServes() is what was declared").toEqual(p.bridge.last());
    expect(svc.reservedPorts().has(port)).toBe(true);
    expect(statSync(registryPath(p)).mode & 0o777, "the registry is the owner's alone").toBe(0o600);
    expect(svc.health()).toEqual({ apps: 1, open: 1, retiring: 0, storage: "ready" });
  });

  it("shares one reservation set with AH: it probes past AH's ports and live listeners, read at every allocation", async () => {
    const p = parts();
    const one = p.rows.add(appRow(1));
    const two = p.rows.add(appRow(2));
    const ah = new Set<number>([appPort(one)]);
    // a fresh Set per call, as 3e's real getter answers: a reference held from an earlier call goes stale
    const svc = made(p, { otherReservedPorts: () => new Set(ah) });
    await svc.start();
    p.bridge.observedOverride = [
      { serveId: "other", name: "other", listenPort: probed(appPort(one)) },
    ];
    await svc.open({ appId: one.appId });
    expect(appSpecOf(p.bridge, one.appId)?.listenPort, "past AH's port and a live listener").toBe(
      probed(appPort(one), 2),
    );
    ah.add(appPort(two));
    await svc.open({ appId: two.appId });
    expect(appSpecOf(p.bridge, two.appId)?.listenPort, "AH's set is read again").toBe(
      probed(appPort(two)),
    );
    expect([...svc.reservedPorts()].sort()).toEqual(
      [VECTOR.previewsPortCandidate, probed(appPort(one), 2), probed(appPort(two))].sort(),
    );
  });

  it("passes an exporter's own refusal through, words any other export failure export-failed, and reserves nothing", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    const results: Record<string, unknown> = {};
    p.exporter.failWith = new RpcCallError(
      "UNAVAILABLE",
      "rosetta 0.1.3 has no export door",
      false,
      {
        service: "apps",
        state: "export-unbuilt",
      },
    );
    results.unbuilt = await opened(svc, row.appId);
    p.exporter.failWith = new Error("socket hang up");
    results.thrown = await opened(svc, row.appId);
    p.exporter.failWith = null;
    p.exporter.digests.set(row.presentationId, hex("another page"));
    results.mismatch = await opened(svc, row.appId);
    expect(results).toEqual({
      unbuilt: refused("export-unbuilt", false),
      thrown: refused("export-failed", true),
      mismatch: refused("export-failed", true),
    });
    expect(p.exporter.calls, "each open asked the exporter").toHaveLength(3);
    expect(appSpecOf(p.bridge, row.appId), "nothing is declared").toBeUndefined();
    expect(recordOf(p, row.appId), "no record, so no port, is kept").toBeUndefined();
    expect(
      existsSync(madeFolder(p, row)),
      "a folder written under the wrong digest is removed",
    ).toBe(false);
  });

  it("refuses honestly before any export: unknown, hidden, a library still reading, rosetta's availability, unlinked", async () => {
    const cases: Record<string, (p: Parts) => IndexCatalogApp | string> = {
      unknown: () => hex("never made"),
      reading: (p) => {
        p.rows.canonicalReady = false;
        return hex("not read yet");
      },
      // rosetta's canonical_ready is true from the walk's first page while the table is partial (DS-L8)
      walking: (p) => {
        p.rows.walked = false;
        p.rows.canonicalReady = true;
        return hex("on a later page");
      },
      no_page_read: (p) => {
        p.rows.canonicalReady = undefined;
        return hex("nothing read");
      },
      hidden: (p) => {
        const row = p.rows.add(appRow(1));
        p.intents.set(madeAppFoldKey(row), { hidden: true });
        return row;
      },
      not_captured: (p) => p.rows.add(appRow(1, { availability: "not_captured" })),
      missing: (p) => p.rows.add(appRow(1, { availability: "missing" })),
      changed_during_read: (p) => p.rows.add(appRow(1, { availability: "changed_during_read" })),
      too_large: (p) => p.rows.add(appRow(1, { availability: "too_large" })),
      unsupported: (p) => p.rows.add(appRow(1, { availability: "unsupported" })),
      unlinked: (p) => {
        p.login = null;
        return p.rows.add(appRow(1));
      },
    };
    const actual: Record<string, unknown> = {};
    const exported: Record<string, number> = {};
    for (const [name, arrange] of Object.entries(cases)) {
      const p = parts();
      const target = arrange(p);
      const svc = made(p);
      await svc.start();
      actual[name] = await opened(svc, typeof target === "string" ? target : target.appId);
      exported[name] = p.exporter.calls.length;
    }
    const notFound = { kind: "NOT_FOUND", retryable: false };
    expect(actual).toMatchObject({
      unknown: notFound,
      reading: refused("library-reading", true),
      walking: refused("library-reading", true),
      no_page_read: refused("library-reading", true),
      hidden: notFound,
      not_captured: refused("not-kept", false),
      missing: refused("not-kept", false),
      changed_during_read: refused("not-kept", false),
      too_large: refused("too-large", false),
      unsupported: refused("unsupported", false),
      unlinked: refused("not-linked", true),
    });
    expect(exported, "no refusal asks the exporter").toEqual(
      Object.fromEntries(Object.keys(cases).map((name) => [name, 0])),
    );

    // a word this build cannot read is not a refusal: rosetta's export decides
    const p = parts();
    const row = p.rows.add(appRow(1, { availability: "unknown" }));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId), "an unknown availability goes to the exporter").toEqual(
      serving(appPort(row)),
    );
  });

  it("answers starting with no URL until its listener reports one, then serving on that URL (never synthesized)", async () => {
    const p = parts();
    p.bridge.autoCarry = false;
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    const first = await opened(svc, row.appId);
    const spec = appSpecOf(p.bridge, row.appId);
    expect(spec, "the serve is declared").toBeDefined();
    expect(first, "no URL before the listener reports one").toEqual(starting);
    const url = `https://${HOST}:${appPort(row)}`;
    p.bridge.carry(spec?.serveId ?? "<none>", url);
    await svc.settled();
    expect(recordOf(p, row.appId)?.lastServedUrl, "the listener's report is kept").toBe(url);
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));

    // a listener that reports inside the wait answers the same open
    const q = parts();
    q.bridge.autoCarry = false;
    const two = q.rows.add(appRow(2));
    q.bridge.afterDeclare = (specs) => {
      const mine = specs.find((s) =>
        s.serveId?.startsWith(`artifact-made-${two.appId.slice(0, 16)}-`),
      );
      if (mine?.serveId !== undefined) {
        const id = mine.serveId;
        setTimeout(() => q.bridge.carry(id, `https://${HOST}:${mine.listenPort}`), 5);
      }
    };
    const waiting = made(q, { openWaitMs: 5_000 });
    await waiting.start();
    expect(await opened(waiting, two.appId), "the open waited for its URL").toEqual(
      serving(appPort(two)),
    );
  });

  it("checks a listener's URL against the app's port and this desktop's MagicDNS name: it strips a bad one, never rewrites it", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    const port = appPort(row);
    expect(await opened(svc, row.appId), "the good URL is answered").toEqual(serving(port));
    const id = appSpecOf(p.bridge, row.appId)?.serveId ?? "<none>";
    const other = port === ARTIFACT_LIMITS.LISTEN_PORT_MAX ? port - 1 : port + 1;
    const hostile = [
      `https://evil.tail1234.ts.net:${port}`,
      `https://${HOST}:${other}`,
      `https://${HOST}:${port}/app`,
      `https://${HOST}:${port}/?x=1`,
      `https://me@${HOST}:${port}`,
      `http://${HOST}:${port}`,
      `https://STUDIO.tail1234.ts.net:${port}`,
      `https://${HOST}.:${port}`,
      `https://${HOST}:0${port}`,
    ];
    const answers: Record<string, unknown> = {};
    for (const url of hostile) {
      p.bridge.carry(id, url);
      await svc.settled();
      answers[url] = await opened(svc, row.appId);
    }
    expect(answers).toEqual(Object.fromEntries(hostile.map((url) => [url, starting])));

    p.bridge.carry(id, `https://${HOST}:${port}`);
    p.dns = undefined;
    expect(await opened(svc, row.appId), "unknown own name: no URL").toEqual(starting);
  });

  it("closes a serve IDLE_CLOSE_MS after its last open, on one timer, keeping its port, preview and folder", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    await svc.settled();
    expect(p.timers.delays(), "one timer, to the next due close").toEqual([
      MADE_APP_LIMITS.IDLE_CLOSE_MS,
    ]);
    p.clock.now += 60_000;
    await svc.open({ appId: row.appId });
    expect(p.timers.delays(), "an open moves the close").toEqual([MADE_APP_LIMITS.IDLE_CLOSE_MS]);

    const spec = appSpecOf(p.bridge, row.appId);
    const before = recordOf(p, row.appId);
    const previewId = previewIdOf(p, row.appId);
    p.clock.now += MADE_APP_LIMITS.IDLE_CLOSE_MS;
    expect(p.timers.fire(), "the idle timer is armed").toBe(true);
    await svc.settled();
    expect(p.bridge.removeAttempts, "the serve is retired").toContain(spec?.serveId);
    expect(appSpecOf(p.bridge, row.appId), "and no longer declared").toBeUndefined();
    expect(previewsSpecOf(p.bridge), "the previews serve stays").toBeDefined();
    expect(recordOf(p, row.appId)).toMatchObject({
      state: "closed",
      listenPort: before?.listenPort,
      previewId: before?.previewId,
      exportedDigest: before?.exportedDigest,
      retiringServeIds: [],
    });
    expect(existsSync(madeFolder(p, row)), "the export folder is kept").toBe(true);
    expect(existsSync(linkedFile(p, previewId)), "the preview is kept").toBe(true);
    expect(svc.reservedPorts().has(appPort(row)), "the port stays reserved").toBe(true);
    expect(p.timers.delays(), "no timer while nothing is open").toEqual([]);

    expect(await opened(svc, row.appId), "a reopen serves on the same port").toEqual(
      serving(appPort(row)),
    );
    expect(p.exporter.calls, "no export while the folder holds the digest").toHaveLength(1);
    p.clock.now += MADE_APP_LIMITS.IDLE_CLOSE_MS;
    p.timers.fire();
    await svc.settled();
    rmSync(madeFolder(p, row), { recursive: true, force: true });
    await svc.open({ appId: row.appId });
    expect(p.exporter.calls, "the folder is a cache: gone, it is exported again").toHaveLength(2);
  });

  it("never idle-closes a kept app; when the keep is lifted an overdue serve closes at once", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    p.intents.set(madeAppFoldKey(row), { kept: true });
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    await svc.settled();
    expect(p.timers.delays(), "no idle timer for a kept app").toEqual([]);
    p.clock.now += 3 * MADE_APP_LIMITS.IDLE_CLOSE_MS;
    const serveId = appSpecOf(p.bridge, row.appId)?.serveId;
    expect(serveId, "a kept app stays up").toBeDefined();
    p.intents.set(madeAppFoldKey(row), undefined);
    await svc.settled();
    expect(appSpecOf(p.bridge, row.appId), "lifted and overdue, it closes").toBeUndefined();
    expect(recordOf(p, row.appId)?.state).toBe("closed");
    // MeshClient never removes an `artifact-` stray: undeclared is not gone, so the removal itself is asserted
    expect(p.bridge.removeAttempts, "its listener is removed, not only undeclared").toContain(
      serveId,
    );
    expect(p.bridge.native.has(serveId ?? "<none>"), "nothing listens on it").toBe(false);
  });

  it("hides: the serve retires, its preview link goes, and an open is NOT_FOUND; unhidden, the link comes back", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    await svc.settled();
    const previewId = previewIdOf(p, row.appId);
    expect(existsSync(linkedFile(p, previewId)), "the capture is linked").toBe(true);
    const spec = appSpecOf(p.bridge, row.appId);

    p.intents.set(madeAppFoldKey(row), { hidden: true });
    await svc.settled();
    expect(p.bridge.removeAttempts, "the hidden app's serve retires").toContain(spec?.serveId);
    expect(appSpecOf(p.bridge, row.appId)).toBeUndefined();
    expect(recordOf(p, row.appId)?.state).toBe("closed");
    expect(existsSync(linkedFile(p, previewId)), "its preview link is removed").toBe(false);
    expect(existsSync(capturedFile(p, previewId)), "the capture itself is kept").toBe(true);
    expect(await opened(svc, row.appId)).toMatchObject({ kind: "NOT_FOUND", retryable: false });

    p.intents.set(madeAppFoldKey(row), undefined);
    await svc.settled();
    expect(existsSync(linkedFile(p, previewId)), "unhidden, its link is back").toBe(true);
    expect(statSync(linkedFile(p, previewId)).ino).toBe(statSync(capturedFile(p, previewId)).ino);
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
  });

  it("shares ARTIFACT_LIMITS.LOCAL_OBJECTS with AH: at the ceiling an open closes the least recently opened unkept serve, and refuses when all are kept", async () => {
    const p = parts();
    const rows = [1, 2, 3].map((n) => p.rows.add(appRow(n)));
    const [one, two, three] = rows as [IndexCatalogApp, IndexCatalogApp, IndexCatalogApp];
    const svc = made(p, { otherLiveObjects: () => ARTIFACT_LIMITS.LOCAL_OBJECTS - 2 });
    await svc.start();
    expect(await opened(svc, one.appId)).toEqual(serving(appPort(one)));
    p.clock.now += 1_000;
    expect(await opened(svc, two.appId)).toEqual(serving(appPort(two)));
    p.clock.now += 1_000;
    await svc.open({ appId: one.appId });
    p.clock.now += 1_000;
    const twoId = appSpecOf(p.bridge, two.appId)?.serveId;
    expect(twoId, "two is up before the third opens").toBeDefined();
    expect(await opened(svc, three.appId), "room is made for the third").toEqual(
      serving(appPort(three)),
    );
    expect(
      {
        one: appSpecOf(p.bridge, one.appId) !== undefined,
        two: appSpecOf(p.bridge, two.appId) !== undefined,
      },
      "the least recently opened goes",
    ).toEqual({ one: true, two: false });
    expect(recordOf(p, two.appId)?.state).toBe("closed");
    expect(p.bridge.removeAttempts, "the evicted listener is removed").toContain(twoId);
    expect(p.bridge.native.has(twoId ?? "<none>"), "so the ceiling bounds live listeners").toBe(
      false,
    );

    p.intents.set(madeAppFoldKey(one), { kept: true });
    p.intents.set(madeAppFoldKey(three), { kept: true });
    await svc.settled();
    expect(await opened(svc, two.appId), "every serve is kept: nothing can close").toEqual({
      kind: "RESOURCE_EXHAUSTED",
      retryable: false,
      details: { resource: "apps", limit: ARTIFACT_LIMITS.LOCAL_OBJECTS },
    });

    // AH's objects alone fill it: no made app holds it, so a retry may succeed once one goes
    const q = parts();
    const solo = q.rows.add(appRow(4));
    const full = made(q, { otherLiveObjects: () => ARTIFACT_LIMITS.LOCAL_OBJECTS });
    await full.start();
    expect(await opened(full, solo.appId), "live artifacts hold every place").toEqual({
      kind: "RESOURCE_EXHAUSTED",
      retryable: true,
      details: { resource: "apps", limit: ARTIFACT_LIMITS.LOCAL_OBJECTS },
    });
    expect(q.exporter.calls, "the ceiling refuses before any export").toEqual([]);
  });

  it("evicts as many closable serves as AH's objects push past the ceiling, and an all-kept refusal exports nothing", async () => {
    const p = parts();
    const [one, two, three, four] = [1, 2, 3, 4].map((n) => p.rows.add(appRow(n))) as [
      IndexCatalogApp,
      IndexCatalogApp,
      IndexCatalogApp,
      IndexCatalogApp,
    ];
    let others = 0;
    const svc = made(p, { otherLiveObjects: () => others });
    await svc.start();
    for (const row of [one, two, three]) {
      expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
      p.clock.now += 1_000;
    }
    const ids = [one, two].map((row) => appSpecOf(p.bridge, row.appId)?.serveId);
    // AH published past the made side's count: three open + 30 + the new one is two over
    others = ARTIFACT_LIMITS.LOCAL_OBJECTS - 2;
    expect(await opened(svc, four.appId), "room is made for the fourth").toEqual(
      serving(appPort(four)),
    );
    expect(
      Object.fromEntries(
        [one, two, three, four].map((row, i) => [i + 1, recordOf(p, row.appId)?.state]),
      ),
      "the two least recently opened go",
    ).toEqual({ 1: "closed", 2: "closed", 3: "open", 4: "open" });
    expect(p.bridge.removeAttempts, "both evicted listeners are removed").toEqual(
      expect.arrayContaining(ids),
    );

    // every open serve kept, and a new app (its folder holds nothing): refused before the export
    p.intents.set(madeAppFoldKey(three), { kept: true });
    p.intents.set(madeAppFoldKey(four), { kept: true });
    await svc.settled();
    const fifth = p.rows.add(appRow(5));
    const calls = p.exporter.calls.length;
    expect(await opened(svc, fifth.appId)).toEqual({
      kind: "RESOURCE_EXHAUSTED",
      retryable: false,
      details: { resource: "apps", limit: ARTIFACT_LIMITS.LOCAL_OBJECTS },
    });
    expect(p.exporter.calls.length, "no export for a refused open").toBe(calls);
    expect(existsSync(madeFolder(p, fifth)), "and no folder").toBe(false);
  });

  it("re-gates to the linked login at every declare: a new login replaces both serves on their ports; unlinked, both go", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    const oldApp = appSpecOf(p.bridge, row.appId);
    const oldPreviews = previewsSpecOf(p.bridge);

    p.login = "someone@else.example";
    await svc.relink();
    const app = appSpecOf(p.bridge, row.appId);
    const previews = previewsSpecOf(p.bridge);
    const order = (oldId: string | undefined, newId: string | undefined) => {
      const removed = p.bridge.removedAt(oldId ?? "<none>");
      const declared = p.bridge.firstDeclaredAt(newId ?? "<none>");
      return { removed: removed >= 0, declared: declared >= 0, removedFirst: removed < declared };
    };
    expect(
      {
        app: order(oldApp?.serveId, app?.serveId),
        previews: order(oldPreviews?.serveId, previews?.serveId),
      },
      "each old gate's removal converges before its replacement is first declared",
    ).toEqual({
      app: { removed: true, declared: true, removedFirst: true },
      previews: { removed: true, declared: true, removedFirst: true },
    });
    expect({ app: app?.allow, previews: previews?.allow }).toEqual({
      app: [glob("someone@else.example")],
      previews: [glob("someone@else.example")],
    });
    expect({ app: app?.listenPort, previews: previews?.listenPort }, "on the same ports").toEqual({
      app: oldApp?.listenPort,
      previews: oldPreviews?.listenPort,
    });
    expect(app?.serveId, "a new gate is a new serve").not.toBe(oldApp?.serveId);

    p.login = null;
    await svc.relink();
    expect(
      { app: appSpecOf(p.bridge, row.appId), previews: previewsSpecOf(p.bridge) },
      "unlinked, nothing is served",
    ).toEqual({ app: undefined, previews: undefined });
    expect(await opened(svc, row.appId)).toEqual(refused("not-linked", true));

    p.login = TEST_LOGIN;
    await svc.relink();
    expect(appSpecOf(p.bridge, row.appId)?.allow, "linked again, the open app is back").toEqual([
      glob(TEST_LOGIN),
    ]);
  });

  it("remove-before-add: a re-gate or a re-point whose old serve will not go declares nothing new, then lands on the same port once the removal converges", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    await svc.settled();
    const oldApp = appSpecOf(p.bridge, row.appId);
    const oldPreviews = previewsSpecOf(p.bridge);
    expect({ app: oldApp, previews: oldPreviews }, "both serves are up").toMatchObject({
      app: { listenPort: appPort(row) },
      previews: { listenPort: VECTOR.previewsPortCandidate },
    });
    const oldAppId = oldApp?.serveId ?? "<none>";
    const oldPreviewsId = oldPreviews?.serveId ?? "<none>";

    // a re-gate whose old listeners refuse to go
    p.bridge.failRemove = new Set([oldAppId, oldPreviewsId]);
    p.login = "someone@else.example";
    await svc.relink();
    const allow = [glob("someone@else.example")];
    const regated = (spec: ServeSpec | undefined) => spec?.allow?.[0] === allow[0];
    expect(
      {
        app: p.bridge.declared.some((specs) => specs.some((s) => regated(s) && !isPreviewsSpec(s))),
        previews: p.bridge.declared.some((specs) =>
          specs.some((s) => regated(s) && isPreviewsSpec(s)),
        ),
      },
      "no new gate is declared beside an old one still listening on its port",
    ).toEqual({ app: false, previews: false });
    expect(recordOf(p, row.appId)?.retiringServeIds, "the old app id is retiring, durably").toEqual(
      [oldAppId],
    );
    expect(p.timers.delays(), "a retry is owed on the one timer").toContain(10_000);

    p.bridge.failRemove.clear();
    expect(p.timers.fire(), "the retry fires").toBe(true);
    await svc.settled();
    const app = appSpecOf(p.bridge, row.appId);
    const previews = previewsSpecOf(p.bridge);
    expect(
      { app: [app?.listenPort, app?.allow], previews: [previews?.listenPort, previews?.allow] },
      "the new gates land on the same ports",
    ).toEqual({ app: [appPort(row), allow], previews: [VECTOR.previewsPortCandidate, allow] });
    expect(
      {
        app: p.bridge.removedAt(oldAppId) < p.bridge.firstDeclaredAt(app?.serveId ?? "<none>"),
        previews:
          p.bridge.removedAt(oldPreviewsId) <
          p.bridge.firstDeclaredAt(previews?.serveId ?? "<none>"),
      },
      "each removal converged before its replacement's first declare",
    ).toEqual({ app: true, previews: true });
    expect(recordOf(p, row.appId)?.retiringServeIds).toEqual([]);

    // a re-point (a new presentation) whose old serve refuses to go
    const gatedId = app?.serveId ?? "<none>";
    const v2 = p.rows.add(
      appRow(1, { presentationId: hex("presentation-1-2"), digest: hex("page-1-2"), versions: 2 }),
    );
    p.bridge.failRemove = new Set([gatedId]);
    expect(
      await opened(svc, v2.appId),
      "the new page is not up while the old one holds the port",
    ).toEqual(starting);
    const pointsAtV2 = (s: ServeSpec) =>
      s.target.kind === "dir" && s.target.path === madeFolder(p, v2);
    expect(
      p.bridge.declared.some((specs) => specs.some(pointsAtV2)),
      "the re-pointed serve is never declared beside the old one",
    ).toBe(false);
    expect(recordOf(p, v2.appId)?.retiringServeIds).toEqual([gatedId]);
    p.bridge.failRemove.clear();
    expect(p.timers.fire(), "the retry fires").toBe(true);
    await svc.settled();
    const repointed = appSpecOf(p.bridge, v2.appId);
    expect({ target: repointed?.target, port: repointed?.listenPort }).toEqual({
      target: { kind: "dir", path: madeFolder(p, v2) },
      port: appPort(row),
    });
    expect(
      p.bridge.removedAt(gatedId) < p.bridge.firstDeclaredAt(repointed?.serveId ?? "<none>"),
      "the old serve's removal converged first",
    ).toBe(true);
  });

  it("retries a hidden app's failed removal on the one timer, without another open (RULINGS L8: hidden means retire)", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    await svc.settled();
    const serveId = appSpecOf(p.bridge, row.appId)?.serveId ?? "<none>";
    p.bridge.failRemoveCount = 1;
    p.intents.set(madeAppFoldKey(row), { hidden: true });
    await svc.settled();
    expect(p.bridge.native.has(serveId), "the first removal failed: it still listens").toBe(true);
    expect(recordOf(p, row.appId)).toMatchObject({ state: "closed", retiringServeIds: [serveId] });
    expect(p.timers.delays(), "a bounded retry, at AH's maintenance cadence").toEqual([10_000]);
    expect(p.timers.fire(), "the retry fires").toBe(true);
    await svc.settled();
    expect(p.bridge.native.has(serveId), "retried, it is gone").toBe(false);
    expect(recordOf(p, row.appId)?.retiringServeIds).toEqual([]);
    expect(p.timers.delays(), "nothing is owed, nothing is open: no timer").toEqual([]);
  });

  it("after a restart: resumes a removal that failed, closes what is overdue and re-declares what is open", async () => {
    const p = parts();
    const [one, two, three] = [1, 2, 3].map((n) => p.rows.add(appRow(n))) as [
      IndexCatalogApp,
      IndexCatalogApp,
      IndexCatalogApp,
    ];
    const first = made(p);
    await first.start();
    await first.open({ appId: one.appId });
    p.clock.now += 10_000;
    await first.open({ appId: two.appId });
    p.clock.now += MADE_APP_LIMITS.IDLE_CLOSE_MS - 10_000;
    await first.open({ appId: three.appId });
    const ids = {
      one: appSpecOf(p.bridge, one.appId)?.serveId,
      two: appSpecOf(p.bridge, two.appId)?.serveId,
      three: appSpecOf(p.bridge, three.appId)?.serveId,
    };
    expect(
      Object.values(ids).every((id) => id !== undefined),
      "three serves are up",
    ).toBe(true);
    p.bridge.failRemoveCount = 1;
    expect(p.timers.fire(), "one's close is due").toBe(true);
    await first.settled();
    expect(recordOf(p, one.appId), "a failed removal is kept as a record").toMatchObject({
      state: "closed",
      retiringServeIds: [ids.one],
    });
    await first.dispose();
    expect(
      p.bridge.removeAttempts.filter((id) => id !== ids.one),
      "dispose removes nothing",
    ).toEqual([]);

    // the floor outlived fieldd: its listeners are still up
    const bridge = new FakeBridge();
    bridge.native = new Map(p.bridge.native);
    p.clock.now += 20_000;
    const q = parts({ dataDir: p.dataDir, rows: p.rows, clock: p.clock, bridge });
    const second = made(q);
    await second.start();
    await second.settled();
    expect(bridge.removeAttempts, "one's removal resumes and two, overdue, closes").toEqual(
      expect.arrayContaining([ids.one, ids.two]),
    );
    expect(bridge.removeAttempts).not.toContain(ids.three);
    expect(appSpecOf(bridge, three.appId)?.serveId, "three is declared again, as it was").toBe(
      ids.three,
    );
    expect({
      one: recordOf(q, one.appId)?.retiringServeIds,
      two: recordOf(q, two.appId)?.state,
      three: recordOf(q, three.appId)?.state,
    }).toEqual({ one: [], two: "closed", three: "open" });
  });

  it("owes a capture at the first serve: while the shell cannot draw it waits for the next open, then runs with the shell's hosts and is hard-linked", async () => {
    const p = parts();
    p.available = false;
    p.exporter.hosts = [...HOSTS, "evil.ts.net"];
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    await svc.settled();
    expect(p.capture.calls, "no capture while the shell cannot draw").toEqual([]);
    expect(svc.of(row.appId)?.preview, "no preview yet").toBeUndefined();

    p.available = true;
    p.clock.now += 5_000;
    await svc.open({ appId: row.appId });
    await svc.settled();
    const previewId = previewIdOf(p, row.appId);
    expect(
      p.capture.calls,
      "the owed capture runs at the next open, with the shell's valid hosts",
    ).toEqual([
      { artifactId: previewId, url: `https://${HOST}:${appPort(row)}`, allowHosts: HOSTS },
    ]);
    expect(existsSync(capturedFile(p, previewId)), "the capture wrote its JPEG").toBe(true);
    expect(existsSync(linkedFile(p, previewId)), "and it is linked into made-previews").toBe(true);
    expect(statSync(linkedFile(p, previewId)).ino, "a hard link, never a copy").toBe(
      statSync(capturedFile(p, previewId)).ino,
    );
    const preview = {
      id: previewId,
      digest: sha256(readFileSync(capturedFile(p, previewId))),
      pageDigest: row.digest,
      capturedAt: T0 + 5_000,
    };
    expect(recordOf(p, row.appId)?.preview).toEqual(preview);
    expect(svc.of(row.appId), "the row's stamp").toEqual({ preview });
    expect(p.stamps, "the stamp is announced").toEqual([[row.appId]]);

    await svc.open({ appId: row.appId });
    await svc.settled();
    expect(p.capture.calls, "nothing is owed for the same page").toHaveLength(1);
  });

  it("captures an open that answered starting when its listener reports its URL (the open's own event, never a timer)", async () => {
    const p = parts();
    p.bridge.autoCarry = false;
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(starting);
    const spec = appSpecOf(p.bridge, row.appId);
    expect(spec, "the serve is declared").toBeDefined();
    expect(p.capture.calls, "nothing to photograph before a URL").toEqual([]);
    p.bridge.carry(spec?.serveId ?? "<none>", `https://${HOST}:${appPort(row)}`);
    await svc.settled();
    expect(p.capture.calls).toEqual([
      {
        artifactId: previewIdOf(p, row.appId),
        url: `https://${HOST}:${appPort(row)}`,
        allowHosts: HOSTS,
      },
    ]);
  });

  it("a new presentation owes a new capture: the export goes to the new digest folder, the serve re-points on its port and the old folder goes", async () => {
    const p = parts();
    const v1 = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, v1.appId)).toEqual(serving(appPort(v1)));
    await svc.settled();
    const oldSpec = appSpecOf(p.bridge, v1.appId);
    const previewId = previewIdOf(p, v1.appId);
    expect(p.capture.calls, "the first serve was captured").toHaveLength(1);

    const v2 = p.rows.add(
      appRow(1, { presentationId: hex("presentation-1-2"), digest: hex("page-1-2"), versions: 2 }),
    );
    p.clock.now += 1_000;
    expect(await opened(svc, v2.appId)).toEqual(serving(appPort(v1)));
    await svc.settled();
    expect(p.exporter.calls.at(-1)).toEqual({
      sessionId: v2.sessionId,
      publicationId: v2.presentationId,
      into: exportFolder(p, v2),
    });
    const spec = appSpecOf(p.bridge, v2.appId);
    expect({ path: spec?.target, port: spec?.listenPort }).toEqual({
      path: { kind: "dir", path: madeFolder(p, v2) },
      port: oldSpec?.listenPort,
    });
    const removed = p.bridge.removedAt(oldSpec?.serveId ?? "<none>");
    expect(
      {
        removed: removed >= 0,
        first: removed < p.bridge.firstDeclaredAt(spec?.serveId ?? "<none>"),
      },
      "the old serve's removal converges before the re-pointed one is first declared",
    ).toEqual({ removed: true, first: true });
    expect(
      existsSync(madeFolder(p, v1)),
      "the old digest's folder goes once the old serve is removed",
    ).toBe(false);
    expect(existsSync(madeFolder(p, v2))).toBe(true);
    expect(p.capture.calls, "the new page is photographed").toHaveLength(2);
    expect(recordOf(p, v2.appId)?.preview).toMatchObject({ id: previewId, pageDigest: v2.digest });
    // L12: the link is replaced after each capture, so the previews serve never serves the old bytes under the new ?v=
    expect(existsSync(linkedFile(p, previewId)), "the new capture is linked").toBe(true);
    expect(
      statSync(linkedFile(p, previewId)).ino,
      "the link is the new capture's file, not the first's",
    ).toBe(statSync(capturedFile(p, previewId)).ino);
    expect(recordOf(p, v2.appId)?.preview?.digest, "the stamp names the new JPEG").toBe(
      sha256(readFileSync(capturedFile(p, previewId))),
    );
  });

  it("opens an older version: that presentation is exported into its own folder and the app's one serve re-points to it", async () => {
    const p = parts();
    const newest = p.rows.add(
      appRow(1, { presentationId: hex("presentation-1-2"), digest: hex("page-1-2"), versions: 2 }),
    );
    const older: MadeAppPresentation = {
      presentationId: hex("presentation-1-1"),
      sessionId: "ses-1-older",
      digest: hex("page-1-1"),
      availability: "captured",
    };
    p.rows.versions.set(`${newest.appId}:${older.presentationId}`, older);
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, newest.appId, older.presentationId)).toEqual(serving(appPort(newest)));
    const olderFolder = join(p.dataDir, "artifacts", "made", newest.appId, hex("page-1-1"));
    expect(p.exporter.calls).toEqual([
      {
        sessionId: older.sessionId,
        publicationId: older.presentationId,
        into: join(p.dataDir, "drive", "import", newest.appId, hex("page-1-1")),
      },
    ]);
    expect(appSpecOf(p.bridge, newest.appId)?.target).toEqual({ kind: "dir", path: olderFolder });
    expect(recordOf(p, newest.appId)?.exportedPresentationId).toBe(older.presentationId);

    expect(await opened(svc, newest.appId, hex("no such version"))).toMatchObject({
      kind: "NOT_FOUND",
      retryable: false,
    });
    expect(await opened(svc, newest.appId), "no version: the newest").toEqual(
      serving(appPort(newest)),
    );
    expect(appSpecOf(p.bridge, newest.appId)?.target).toEqual({
      kind: "dir",
      path: madeFolder(p, newest),
    });
  });

  it("MA-3f: places the page apart, builds the view where it is served, from rosetta's digest and environment", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    const into = exportFolder(p, row);
    expect(p.view.calls).toEqual([
      {
        source: join(into, MADE_APP_VIEW.FILE),
        folder: madeFolder(p, row),
        theme: { colorScheme: "light", variables: [["--color-text-primary", "#111"]] },
        blake3: digestOf(row),
      },
    ]);
    expect(recordOf(p, row.appId)).toMatchObject({
      network: { script: HOSTS },
      viewVersion: MADE_APP_VIEW.VERSION,
      reach: HOSTS,
    });
    expect(existsSync(into), "the export is kept beside the view").toBe(true);
  });

  it("MA-3f: a restart spells the same serve from the record, with no export", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const first = made(p);
    await first.start();
    await opened(first, row.appId);
    const before = appSpecOf(p.bridge, row.appId);
    await first.dispose();
    const second = made(p);
    await second.start();
    expect(appSpecOf(p.bridge, row.appId)).toEqual(before);
    expect(p.exporter.calls, "the record held all it needed").toHaveLength(1);
  });

  it("MA-3f: a new page's policy is a new serve, and the old one is removed before it is declared", async () => {
    const p = parts();
    const v1 = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    await opened(svc, v1.appId);
    const oldId = appSpecOf(p.bridge, v1.appId)?.serveId ?? "";
    const v2 = p.rows.add(
      appRow(1, { presentationId: hex("presentation-1-2"), digest: hex("page-1-2"), versions: 2 }),
    );
    p.exporter.hosts = ["esm.sh"];
    await opened(svc, v2.appId);
    const spec = appSpecOf(p.bridge, v2.appId);
    expect(spec?.headers).toEqual(headersFor({ script: ["esm.sh"] }));
    expect(spec?.serveId).not.toBe(oldId);
    expect(p.bridge.removedAt(oldId)).toBeLessThan(p.bridge.firstDeclaredAt(spec?.serveId ?? ""));
    // both roots keep the current digest alone
    expect(existsSync(exportFolder(p, v1)), "the old export goes").toBe(false);
    expect(existsSync(madeFolder(p, v1)), "the old view goes").toBe(false);
    expect(existsSync(exportFolder(p, v2))).toBe(true);
  });

  it("MA-3f: a view built at another version, or a record with no policy, is exported again", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    await opened(svc, row.appId);
    await svc.dispose();
    const file = MadeAppRegistry.parse(JSON.parse(readFileSync(registryPath(p), "utf8")));
    const app = file.apps[0]!;
    const { viewVersion: _old, ...stale } = app;
    writeFileSync(registryPath(p), JSON.stringify({ ...file, apps: [stale] }));
    const next = made(p);
    await next.start();
    await opened(next, row.appId);
    expect(p.exporter.calls, "the second open exports again").toHaveLength(2);
  });

  it("MA-3f: an answer for another path, or a view that cannot be built, is export-failed and leaves nothing", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    p.exporter.path = "../index.html";
    expect(await opened(svc, row.appId)).toEqual(refused("export-failed", true));
    expect(p.view.calls, "no view of a page at another path").toEqual([]);
    p.exporter.path = "index.html";
    p.view.failWith = new Error("mismatch");
    expect(await opened(svc, row.appId)).toEqual(refused("export-failed", true));
    expect(existsSync(exportFolder(p, row))).toBe(false);
    expect(existsSync(madeFolder(p, row))).toBe(false);
    expect(recordOf(p, row.appId), "no record, so no port").toBeUndefined();
  });

  it("MA-3f: serves no app it cannot give its policy to", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    await opened(svc, row.appId);
    await svc.dispose();
    const file = MadeAppRegistry.parse(JSON.parse(readFileSync(registryPath(p), "utf8")));
    const { network: _policy, ...bare } = file.apps[0]!;
    writeFileSync(registryPath(p), JSON.stringify({ ...file, apps: [bare] }));
    const next = made(p);
    await next.start();
    expect(appSpecOf(p.bridge, row.appId), "no headers, no listener").toBeUndefined();
  });

  it("MA-3f: rosetta's 404 is the page not kept; every other status is left for the service to word, and logged", async () => {
    const logged: unknown[] = [];
    const logger = { ...createNoopLogger(), info: (...line: unknown[]) => logged.push(line) };
    let onStatus: ((status: number) => RpcCallError | undefined) | undefined;
    const exporter = rosettaMadeAppExporter(
      {
        exportArtifact: async (_session, _publication, _request, given) => {
          onStatus = given;
          return { page: { path: "index.html", blake3: "x", bytes: 1 }, environment: {} };
        },
      },
      logger as unknown as Parameters<typeof rosettaMadeAppExporter>[1],
    );
    await exporter.export({ sessionId: "s", publicationId: "p", into: "/x" });
    const refusal = onStatus?.(404);
    expect(refusal?.details).toMatchObject({ service: "apps", state: "not-kept" });
    expect(logged, "a page not kept is no failure to log").toEqual([]);
    for (const status of [400, 409, 503]) expect(onStatus?.(status), `${status}`).toBeUndefined();
    expect(logged).toHaveLength(3);
  });

  it("MA-3f: makes both roots before rosettad needs them, and a folder it cannot make costs the opens alone", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-ma3f-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const logger = createNoopLogger();
    const roots = prepareMadeAppRoots(dataDir, logger);
    expect(roots).toEqual({
      sourceRoot: join(dataDir, "drive", "import"),
      servedRoot: join(dataDir, "artifacts", "made"),
    });
    expect(statSync(join(dataDir, "drive", "import")).mode & 0o777).toBe(0o700);
    const blocked = join(dataDir, "a-file");
    writeFileSync(blocked, "");
    expect(prepareMadeAppRoots(blocked, logger)).toBeUndefined();
  });

  describe("MA-3f: one reservation set, closed in both directions", () => {
    /** A bridge whose `observed` waits for `release`, so a row can act inside the probe's wait. */
    function heldObserved(p: Parts): () => void {
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const real = p.bridge.observed.bind(p.bridge);
      p.bridge.observed = async () => {
        await gate;
        return await real();
      };
      return release;
    }

    it("reads AH's set after the probe's wait, so a port AH took meanwhile is skipped", async () => {
      const p = parts();
      const row = p.rows.add(appRow(1));
      const ah = new Set<number>();
      const svc = made(p, { otherReservedPorts: () => new Set(ah) });
      await svc.start();
      const release = heldObserved(p);
      const opening = opened(svc, row.appId);
      await new Promise((resolve) => setTimeout(resolve, 10));
      ah.add(candidateOf(MADE_APP_PORT_DOMAIN, row.appId));
      release();
      await opening;
      expect(recordOf(p, row.appId)?.listenPort).toBe(
        probed(candidateOf(MADE_APP_PORT_DOMAIN, row.appId)),
      );
    });

    it("holds a port it picked until its commit, so AH cannot be handed it in between", async () => {
      const p = parts();
      const row = p.rows.add(appRow(1));
      const seen: boolean[] = [];
      const port = candidateOf(MADE_APP_PORT_DOMAIN, row.appId);
      const svc: MadeAppService = made(p, {
        writeRegistry: (path, body) => {
          seen.push(svc.reservedPorts().has(port));
          writeFileSync(path, body);
        },
      });
      mkdirSync(join(p.dataDir, "registries"), { recursive: true });
      await svc.start();
      await opened(svc, row.appId);
      expect(seen.at(-1), "the port is held while the record is written").toBe(true);
    });

    it("frees a picked port when its commit fails", async () => {
      const p = parts();
      const row = p.rows.add(appRow(1));
      const svc = made(p, {
        writeRegistry: () => {
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
      });
      await svc.start();
      await opened(svc, row.appId);
      expect(svc.reservedPorts().has(candidateOf(MADE_APP_PORT_DOMAIN, row.appId))).toBe(false);
    });
  });

  it("is honest when its registry cannot be written: the open fails INTERNAL and nothing is declared or reserved", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p, {
      writeRegistry: () => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
    });
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual({
      kind: "INTERNAL",
      retryable: true,
      details: { service: "made-app-storage", state: "failed", code: "ENOSPC" },
    });
    expect(appSpecOf(p.bridge, row.appId), "nothing is declared").toBeUndefined();
    expect(previewsSpecOf(p.bridge), "no previews serve on an unpersisted port").toBeUndefined();
    expect(svc.reservedPorts().has(appPort(row)), "nothing is reserved").toBe(false);
    expect(svc.reservedPorts().size, "not even the previews port").toBe(0);
    expect(svc.health().storage).toBe("failed");
  });

  it("moves an unreadable registry aside and starts empty", async () => {
    const p = parts();
    mkdirSync(join(p.dataDir, "registries"), { recursive: true });
    writeFileSync(registryPath(p), "{ not json");
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    const aside = readdirSync(join(p.dataDir, "registries")).filter((name) =>
      name.startsWith(`${MADE_APP_REGISTRY_FILE}.bad-`),
    );
    expect(aside, "the unreadable registry is moved aside").toHaveLength(1);
    expect(await opened(svc, row.appId), "and boot goes on").toEqual(serving(appPort(row)));
  });

  it("PIN: dispose removes no serve (field-native outlives fieldd, and a restart adopts it)", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    await svc.open({ appId: row.appId });
    await svc.dispose();
    expect(p.bridge.removeAttempts).toEqual([]);
  });

  it("PIN: with no capture provider an open schedules no capture", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const {
      capturePreview: _capture,
      capturePreviewAvailable: _available,
      ...options
    } = baseOptions(p);
    const svc = new MadeAppService(options);
    const stamps: string[][] = [];
    svc.on("previews-changed", (appIds) => stamps.push(appIds));
    cleanup.push(() => svc.dispose());
    await svc.start();
    await svc.open({ appId: row.appId });
    await svc.settled();
    // what a capture would leave, observed from outside (the fake is unreachable from these options)
    const previewId = previewIdOf(p, row.appId);
    expect({
      stamps,
      linked: existsSync(join(p.dataDir, "artifacts", "made-previews", previewId)),
      recorded: recordOf(p, row.appId)?.preview,
      stamp: svc.of(row.appId)?.preview,
    }).toEqual({ stamps: [], linked: false, recorded: undefined, stamp: undefined });
  });

  it("after a restart, keeps, hides and idle-closes nothing until the library's rows speak: a kept app is never closed before the walk (RULINGS L8)", async () => {
    const p = parts();
    const [kept, hidden, plain] = [1, 2, 3].map((n) => p.rows.add(appRow(n))) as [
      IndexCatalogApp,
      IndexCatalogApp,
      IndexCatalogApp,
    ];
    const first = made(p);
    await first.start();
    for (const row of [kept, hidden, plain]) await first.open({ appId: row.appId });
    const ids = Object.fromEntries(
      [kept, hidden, plain].map((row, i) => [i, appSpecOf(p.bridge, row.appId)?.serveId]),
    );
    await first.dispose();
    // while fieldd was down: the person kept one and hid another (native-keyed intents), and a day and more passed
    p.intents.set(madeAppFoldKey(kept), { kept: true });
    p.intents.set(madeAppFoldKey(hidden), { hidden: true });
    p.clock.now += 3 * MADE_APP_LIMITS.IDLE_CLOSE_MS;

    const bridge = new FakeBridge();
    bridge.native = new Map(p.bridge.native);
    const rows = new FakeRows();
    rows.walked = false; // 3a's first walk has not landed: the table holds no row yet
    const q = parts({ dataDir: p.dataDir, clock: p.clock, intents: p.intents, bridge, rows });
    let others = 0;
    const second = made(q, { otherLiveObjects: () => others });
    await second.start();
    await second.settled();
    expect(
      {
        removed: bridge.removeAttempts,
        states: [kept, hidden, plain].map((row) => recordOf(q, row.appId)?.state),
        declared: [kept, hidden, plain].map((row) => appSpecOf(bridge, row.appId)?.serveId),
        timers: q.timers.delays(),
      },
      "before the walk nothing is decided: every serve stays as it was, no idle timer",
    ).toEqual({
      removed: [],
      states: ["open", "open", "open"],
      declared: [ids[0], ids[1], ids[2]],
      timers: [],
    });

    // the ceiling never evicts an app whose keep is not read (a page-one row may open meanwhile): refused, retryable
    const fourth = rows.add(appRow(4));
    others = ARTIFACT_LIMITS.LOCAL_OBJECTS - 3;
    expect(await opened(second, fourth.appId), "no unread app is evicted").toEqual({
      kind: "RESOURCE_EXHAUSTED",
      retryable: true,
      details: { resource: "apps", limit: ARTIFACT_LIMITS.LOCAL_OBJECTS },
    });
    expect(bridge.removeAttempts, "nothing was closed for it").toEqual([]);
    others = 0;

    // the walk lands: 3e's IndexApps `changed` → reconsider()
    for (const row of [kept, hidden, plain]) rows.add(row);
    rows.walked = true;
    await second.reconsider();
    await second.settled();
    expect(
      {
        states: [kept, hidden, plain].map((row) => recordOf(q, row.appId)?.state),
        live: [ids[0], ids[1], ids[2]].map((id) => bridge.native.has(id ?? "<none>")),
      },
      "read: the kept app stays up, the hidden one retires, the overdue one closes",
    ).toEqual({ states: ["open", "closed", "closed"], live: [true, false, false] });
    expect(q.timers.delays(), "a kept app arms no idle close").toEqual([]);
  });

  it("answers export-failed, never starting, when the serve's declare fails or the floor refuses its add (MADE_APP_OPEN)", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    p.bridge.failDeclare = true;
    expect(await opened(svc, row.appId), "the declare threw").toEqual(
      refused("export-failed", true),
    );
    p.bridge.failDeclare = false;
    expect(await opened(svc, row.appId), "a retry serves").toEqual(serving(appPort(row)));

    const q = parts();
    q.bridge.errorOnAdd = true;
    const two = q.rows.add(appRow(2));
    const failing = made(q, { openWaitMs: 2_000 });
    await failing.start();
    const began = Date.now();
    expect(await opened(failing, two.appId), "the floor's add failed").toEqual(
      refused("export-failed", true),
    );
    expect(Date.now() - began, "an error ends the wait: it is not a URL still coming").toBeLessThan(
      1_500,
    );
  });

  it("sweeps, before it declares, every made listener it does not hold: a login changed while fieldd was down; never AH's, never an open app's", async () => {
    const p = parts();
    const [one, two] = [1, 2].map((n) => p.rows.add(appRow(n))) as [
      IndexCatalogApp,
      IndexCatalogApp,
    ];
    const first = made(p);
    await first.start();
    await first.open({ appId: one.appId });
    await first.open({ appId: two.appId });
    const oldApp = appSpecOf(p.bridge, one.appId)?.serveId ?? "<none>";
    const oldPreviews = previewsSpecOf(p.bridge)?.serveId ?? "<none>";
    const twoId = appSpecOf(p.bridge, two.appId)?.serveId ?? "<none>";
    await first.dispose();

    // two's capture folder cannot be made at the restart: its spec is skipped, but its listener is still wanted
    const twoPreviewDir = join(p.dataDir, "artifacts", "previews", previewIdOf(p, two.appId));
    rmSync(twoPreviewDir, { recursive: true, force: true });
    writeFileSync(twoPreviewDir, "not a folder");

    const bridge = new FakeBridge();
    bridge.native = new Map(p.bridge.native);
    const strayId = `artifact-made-${"f".repeat(16)}-aaaaaaaaaaaaaaaa`;
    const ahId = "artifact-01JC4MA0PV0000000000000001-bbbbbbbbbbbbbbbb";
    bridge.native.set(strayId, liveServe(strayId, 19_999));
    bridge.native.set(ahId, liveServe(ahId, 19_997));
    const q = parts({ dataDir: p.dataDir, rows: p.rows, clock: p.clock, bridge });
    q.login = "someone@else.example"; // the login changed while fieldd was down
    const second = made(q);
    await second.start();
    const newApp = appSpecOf(bridge, one.appId)?.serveId ?? "<none>";
    const newPreviews = previewsSpecOf(bridge)?.serveId ?? "<none>";
    expect(
      {
        stray: bridge.native.has(strayId),
        ah: bridge.native.has(ahId),
        oldApp: bridge.native.has(oldApp),
        oldPreviews: bridge.native.has(oldPreviews),
      },
      "the made strays and the old login's serves go; AH's listener is AH's",
    ).toEqual({ stray: false, ah: true, oldApp: false, oldPreviews: false });
    expect(
      {
        app:
          bridge.removedAt(oldApp) >= 0 &&
          bridge.removedAt(oldApp) < bridge.firstDeclaredAt(newApp),
        previews:
          bridge.removedAt(oldPreviews) >= 0 &&
          bridge.removedAt(oldPreviews) < bridge.firstDeclaredAt(newPreviews),
      },
      "each old-login listener is removed before the new login's serve is declared on its port",
    ).toEqual({ app: true, previews: true });
    expect(
      { declared: appSpecOf(bridge, two.appId), removed: bridge.removeAttempts.includes(twoId) },
      "two's folder failed: not declared this pass, and its old-login listener was a stray",
    ).toEqual({ declared: undefined, removed: true });

    // same login, same failed folder: two's live listener is wanted, so the relink's sweep spares it
    const r = parts({ dataDir: p.dataDir, rows: p.rows, clock: p.clock, bridge: new FakeBridge() });
    r.bridge.native = new Map(bridge.native);
    const sameId = madeAppServeId({
      appId: two.appId,
      listenPort: appPort(two),
      allow: [glob("someone@else.example")],
      previewDir: twoPreviewDir,
      folder: madeFolder(p, two),
      headers: headersFor({ script: HOSTS }),
    });
    r.bridge.native.set(sameId, liveServe(sameId, appPort(two)));
    r.login = "someone@else.example";
    const third = made(r);
    await third.start();
    const later = `artifact-made-${"e".repeat(16)}-cccccccccccccccc`;
    r.bridge.native.set(later, liveServe(later, 19_998));
    await third.relink();
    expect(
      {
        two: r.bridge.native.has(sameId),
        stray: r.bridge.native.has(later),
        ah: r.bridge.native.has(ahId),
      },
      "an open app whose spec could not be made this pass keeps its listener; a stray goes at a relink",
    ).toEqual({ two: true, stray: false, ah: true });
  });

  it("names a folder only by a blake3 digest (EL7): a version digest like ../../x, or none, is export-failed with no export", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const hostile: MadeAppPresentation = {
      presentationId: hex("presentation-1-0"),
      sessionId: "ses-1-hostile",
      digest: "../../x",
      availability: "captured",
    };
    p.rows.versions.set(`${row.appId}:${hostile.presentationId}`, hostile);
    const bare = p.rows.add(appRow(2, { digest: undefined }));
    const svc = made(p);
    await svc.start();
    expect({
      hostile: await opened(svc, row.appId, hostile.presentationId),
      noDigest: await opened(svc, bare.appId),
    }).toEqual({
      hostile: refused("export-failed", true),
      noDigest: refused("export-failed", true),
    });
    expect(p.exporter.calls, "no export is asked").toEqual([]);
    const artifacts = join(p.dataDir, "artifacts");
    expect(
      { x: existsSync(join(artifacts, "x")), made: existsSync(join(artifacts, "made")) },
      "no folder is made, inside made/ or out of it",
    ).toEqual({ x: false, made: false });
  });

  it("refuses to link a capture that is not a regular file (EL7), and stamps nothing for a capture with no digest", async () => {
    const p = parts();
    const outside = join(p.dataDir, "secret.txt");
    writeFileSync(outside, "not a preview");
    p.capture.symlinkTo = outside;
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(await opened(svc, row.appId)).toEqual(serving(appPort(row)));
    await svc.settled();
    const previewId = previewIdOf(p, row.appId);
    expect(p.capture.calls, "the capture ran").toHaveLength(1);
    expect(
      {
        linked: existsSync(join(p.dataDir, "artifacts", "made-previews", previewId)),
        stamps: p.stamps,
        preview: recordOf(p, row.appId)?.preview,
      },
      "a symlink is never linked, stamped or announced",
    ).toEqual({ linked: false, stamps: [], preview: undefined });

    const q = parts();
    q.capture.noDigest = true;
    const two = q.rows.add(appRow(2));
    const undigested = made(q);
    await undigested.start();
    expect(await opened(undigested, two.appId)).toEqual(serving(appPort(two)));
    await undigested.settled();
    expect(q.capture.calls, "the capture ran").toHaveLength(1);
    expect(
      { stamps: q.stamps, preview: recordOf(q, two.appId)?.preview },
      "no digest, no stamp",
    ).toEqual({ stamps: [], preview: undefined });
  });

  it("loads its registry record by record: one bad record is dropped alone and the good one keeps its port", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const port = probed(appPort(row), 7); // not the first candidate: only the record can name it
    mkdirSync(join(p.dataDir, "registries"), { recursive: true });
    writeFileSync(
      registryPath(p),
      JSON.stringify({
        v: 1,
        apps: [
          {
            appId: "not an app id",
            listenPort: 1,
            retiringServeIds: [],
            createdAt: 0,
            updatedAt: 0,
          },
          {
            appId: row.appId,
            listenPort: port,
            state: "closed",
            retiringServeIds: [],
            createdAt: T0,
            updatedAt: T0,
          },
        ],
      }),
    );
    const svc = made(p);
    await svc.start();
    expect(svc.health().apps, "the good record is kept").toBe(1);
    expect(await opened(svc, row.appId), "and it opens on its own port").toEqual(serving(port));
    expect(
      readdirSync(join(p.dataDir, "registries")).some((name) => name.includes(".bad-")),
      "the file is not quarantined for one record",
    ).toBe(false);
  });

  it("holds at most MADE_APP_LIMITS.INTENTS reservations: a new app past them is RESOURCE_EXHAUSTED, with no export", async () => {
    const p = parts();
    const apps = Array.from({ length: MADE_APP_LIMITS.INTENTS }, (_, i) => ({
      appId: hex(`reserved-${i}`),
      listenPort: ARTIFACT_LIMITS.LISTEN_PORT_MIN + (i % 10_000),
      state: "closed",
      retiringServeIds: [],
      createdAt: T0,
      updatedAt: T0,
    }));
    mkdirSync(join(p.dataDir, "registries"), { recursive: true });
    writeFileSync(registryPath(p), JSON.stringify({ v: 1, apps }));
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    expect(svc.health().apps).toBe(MADE_APP_LIMITS.INTENTS);
    expect(await opened(svc, row.appId)).toEqual({
      kind: "RESOURCE_EXHAUSTED",
      retryable: false,
      details: { resource: "apps", limit: MADE_APP_LIMITS.INTENTS },
    });
    expect(p.exporter.calls, "no export").toEqual([]);
  });

  it("refuses an open after dispose: UNAVAILABLE made-apps stopping, never an apps state", async () => {
    const p = parts();
    const row = p.rows.add(appRow(1));
    const svc = made(p);
    await svc.start();
    await svc.dispose();
    expect(await opened(svc, row.appId)).toEqual({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "made-apps", state: "stopping" },
    });
  });
});
