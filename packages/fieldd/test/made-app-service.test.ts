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
  MadeAppRegistry,
  type MadeAppServeRecord,
  madeAppFoldKey,
  type ShellWebContentsCaptureArtifactPreviewParams,
  type ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";
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
  madeAppPortCandidate,
  madeAppPreviewsPortCandidate,
  madeAppRefusal,
  madeAppServeId,
  madePreviewsServeId,
} from "../src/made-app-service";
import type { ObservedServe, ServeSpec, ServeState } from "../src/mesh-client";
import { RpcCallError } from "../src/native-link";
import { serveAllowGlob } from "../src/terminal-serve";
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

class FakeBridge implements ArtifactServeBridge {
  declared: ServeSpec[][] = [];
  desired: ServeSpec[] = [];
  native = new Map<string, ServeState>();
  listeners = new Set<() => void>();
  removeAttempts: string[] = [];
  failRemoveCount = 0;
  autoCarry = true;
  observedOverride: ObservedServe[] | null = null;
  afterDeclare: ((specs: ServeSpec[]) => void) | null = null;

  async declare(specs: ServeSpec[]): Promise<void> {
    this.declared.push(structuredClone(specs));
    this.desired = specs;
    if (this.autoCarry) {
      for (const spec of specs) {
        const id = spec.serveId ?? spec.name;
        if (!this.native.has(id)) {
          this.native.set(id, {
            ...spec,
            status: "active",
            url: `https://${HOST}:${spec.listenPort}`,
          });
        }
      }
    }
    this.afterDeclare?.(specs);
  }

  async remove(serveId: string): Promise<{ removed: boolean }> {
    this.removeAttempts.push(serveId);
    if (this.failRemoveCount > 0) {
      this.failRemoveCount -= 1;
      throw new RpcCallError("INTERNAL", "scripted remove failure", true);
    }
    this.native.delete(serveId);
    return { removed: true };
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

class FakeRows implements MadeAppRows {
  apps = new Map<string, IndexCatalogApp>();
  versions = new Map<string, MadeAppPresentation>();
  ready = true;

  add(row: IndexCatalogApp): IndexCatalogApp {
    this.apps.set(row.appId, row);
    return row;
  }

  get(appId: string): IndexCatalogApp | undefined {
    return this.apps.get(appId);
  }

  libraryReady(): boolean {
    return this.ready;
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
  failWith: unknown = null;
  /** rosetta's digest per publication; by default, the name of the folder it was asked to write */
  digests = new Map<string, string>();

  async export(request: MadeAppExportRequest): Promise<MadeAppExport> {
    this.calls.push({ ...request });
    if (this.failWith !== null) throw this.failWith;
    mkdirSync(request.into, { recursive: true });
    writeFileSync(join(request.into, "index.html"), "<!doctype html><title>made</title>");
    return {
      written: true,
      digest: this.digests.get(request.publicationId) ?? basename(request.into),
      shellVersion: "rosetta-shell-1",
      hosts: [...this.hosts],
    };
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
    const tmp = join(dir, ".thumbnail.jpg.tmp");
    writeFileSync(tmp, bytes);
    renameSync(tmp, join(dir, "thumbnail.jpg"));
    return { captured: true, digest: sha256(bytes) };
  };
}

interface Parts {
  dataDir: string;
  bridge: FakeBridge;
  rows: FakeRows;
  exporter: FakeExporter;
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
    expect(p.exporter.calls, "the exporter is asked once, into the app's digest folder").toEqual([
      { sessionId: row.sessionId, publicationId: row.presentationId, into: folder },
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
    expect(appSpecOf(p.bridge, row.appId)).toEqual({
      serveId: madeAppServeId({ appId: row.appId, listenPort: port, allow, previewDir, folder }),
      name: `made-app:${row.appId}`,
      listenPort: port,
      target: { kind: "dir", path: folder },
      previewDir,
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
    const svc = made(p, { otherReservedPorts: () => ah });
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

  it("passes rosetta 0.1.3's export-unbuilt through, words any other export failure export-failed, and reserves nothing", async () => {
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
        p.rows.ready = false;
        return hex("not read yet");
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
    expect(appSpecOf(p.bridge, row.appId), "a kept app stays up").toBeDefined();
    p.intents.set(madeAppFoldKey(row), undefined);
    await svc.settled();
    expect(appSpecOf(p.bridge, row.appId), "lifted and overdue, it closes").toBeUndefined();
    expect(recordOf(p, row.appId)?.state).toBe("closed");
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

    p.intents.set(madeAppFoldKey(one), { kept: true });
    p.intents.set(madeAppFoldKey(three), { kept: true });
    await svc.settled();
    expect(await opened(svc, two.appId), "every serve is kept: nothing can close").toEqual({
      kind: "RESOURCE_EXHAUSTED",
      retryable: false,
      details: { resource: "apps", limit: ARTIFACT_LIMITS.LOCAL_OBJECTS },
    });
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
    expect(p.bridge.removeAttempts, "the old gates are removed first").toEqual(
      expect.arrayContaining([oldApp?.serveId, oldPreviews?.serveId]),
    );
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
      into: madeFolder(p, v2),
    });
    const spec = appSpecOf(p.bridge, v2.appId);
    expect({ path: spec?.target, port: spec?.listenPort }).toEqual({
      path: { kind: "dir", path: madeFolder(p, v2) },
      port: oldSpec?.listenPort,
    });
    expect(p.bridge.removeAttempts, "the old serve is removed first").toContain(oldSpec?.serveId);
    expect(
      existsSync(madeFolder(p, v1)),
      "the old digest's folder goes once the old serve is removed",
    ).toBe(false);
    expect(existsSync(madeFolder(p, v2))).toBe(true);
    expect(p.capture.calls, "the new page is photographed").toHaveLength(2);
    expect(recordOf(p, v2.appId)?.preview).toMatchObject({ id: previewId, pageDigest: v2.digest });
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
      { sessionId: older.sessionId, publicationId: older.presentationId, into: olderFolder },
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
    expect(svc.reservedPorts().has(appPort(row)), "nothing is reserved").toBe(false);
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
    cleanup.push(() => svc.dispose());
    await svc.start();
    await svc.open({ appId: row.appId });
    await svc.settled();
    expect(p.capture.calls).toEqual([]);
    expect(svc.of(row.appId)?.preview).toBeUndefined();
  });
});
