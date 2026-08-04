// AH-1 — Artifact Hub serving foundation. Unit coverage pins durable intent,
// stable ports, config equality/replacement, crash-safe removals, migration,
// source health, and safe projection. Integration crosses the real fieldd ↔
// mock-field-native boundary so URL composition and local-only policy cannot
// be accidentally tested as two internally consistent halves.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ARTIFACT_INTENT_FILE,
  ARTIFACT_LIMITS,
  type ArtifactCatalogEntry,
  type ArtifactCatalogSlice,
  type ArtifactSource,
  type ArtifactStatus,
  type ArtifactView,
  CONTRACTS_VERSION,
  type DeviceInfo,
  LocalArtifactIntent,
  SHELL_PROVIDER_METHODS,
  ShellProviderCallParams,
  type ShellWebContentsCaptureArtifactPreviewParams,
  type ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  type ArtifactCatalogBridge,
  type ArtifactServeBridge,
  ArtifactService,
  artifactPortCandidate,
  artifactServeId,
  canonicalArtifactServingConfig,
  canonicalJson,
  parseCatalogSlice,
} from "../src/artifact-service";
import { bootstrap, verifyAuditSegment } from "../src/index";
import type { ObservedServe, ServeSpec, ServeState } from "../src/mesh-client";
import { RpcCallError } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, until, WsRpc } from "./ws-rpc";

const A = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const B = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const C = "01ARZ3NDEKTSV4RRFFQ69G5FAX";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ah1-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

class FakeBridge implements ArtifactServeBridge {
  declared: ServeSpec[][] = [];
  desired: ServeSpec[] = [];
  native = new Map<string, ServeState>();
  listeners = new Set<() => void>();
  removeAttempts: string[] = [];
  failDeclare = false;
  failRemoveCount = 0;
  autoCarry = true;
  observedOverride: ObservedServe[] | null = null;

  async declare(specs: ServeSpec[]): Promise<void> {
    if (this.failDeclare) throw new Error("mesh node not up");
    this.declared.push(structuredClone(specs));
    this.desired = specs;
    if (this.autoCarry) {
      for (const spec of specs) {
        const id = spec.serveId ?? spec.name;
        if (!this.native.has(id)) {
          this.native.set(id, {
            ...spec,
            status: "active",
            url: `https://unit.ts.net:${spec.listenPort}`,
          });
        }
      }
    }
  }

  async remove(serveId: string): Promise<{ removed: boolean }> {
    this.removeAttempts.push(serveId);
    if (this.failRemoveCount > 0) {
      this.failRemoveCount -= 1;
      throw new RpcCallError("INTERNAL", "scripted remove failure", true);
    }
    // Missing is the bridge contract's converged NOT_FOUND success.
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
              ...(state.url !== undefined ? { url: state.url } : {}),
            },
          ],
    );
  }

  on(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  fire(): void {
    for (const cb of this.listeners) cb();
  }

  last(): ServeSpec[] {
    return this.declared.at(-1) ?? [];
  }

  runtime(serveId: string, over: Partial<ServeState>): void {
    const current = this.native.get(serveId);
    if (current === undefined) throw new Error(`no native serve ${serveId}`);
    this.native.set(serveId, { ...current, ...over });
    this.fire();
  }
}

class FakeCatalog implements ArtifactCatalogBridge {
  bootId = "boot-self";
  deviceId = "dev-self";
  deviceRows: DeviceInfo[] = [deviceInfo("dev-self", { self: true, bootId: "boot-self" })];
  slices: Record<string, { data: unknown }> = {};
  publishes: ArtifactCatalogSlice[] = [];
  event: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;
  meshListeners = new Set<() => void>();
  deviceListeners = new Set<() => void>();

  currentDeviceId(): string {
    return this.deviceId;
  }

  devices(): DeviceInfo[] {
    return this.deviceRows;
  }

  async subscribe(
    cb: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }> {
    this.event = cb;
    return {
      snapshot: { storeId: "field.artifacts.v1", slices: structuredClone(this.slices) },
      dispose: () => {
        if (this.event === cb) this.event = null;
      },
    };
  }

  async publish(slice: ArtifactCatalogSlice): Promise<void> {
    const copy = structuredClone(slice);
    this.publishes.push(copy);
    this.slices[this.deviceId] = { data: copy };
  }

  onMeshWake(cb: () => void): () => void {
    this.meshListeners.add(cb);
    return () => this.meshListeners.delete(cb);
  }

  onDevicesChanged(cb: () => void): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  push(owner: string, slice: unknown): void {
    this.slices[owner] = { data: structuredClone(slice) };
    this.event?.(
      { kind: "peerUpdated", deviceId: owner, data: structuredClone(slice), version: 1 },
      "delta",
    );
  }

  remove(owner: string): void {
    delete this.slices[owner];
    this.event?.({ kind: "peerRemoved", deviceId: owner }, "delta");
  }

  replay(): void {
    this.event?.(
      { storeId: "field.artifacts.v1", slices: structuredClone(this.slices) },
      "snapshot",
    );
  }

  setDevices(rows: DeviceInfo[]): void {
    this.deviceRows = rows;
    for (const cb of this.deviceListeners) cb();
  }
}

function deviceInfo(deviceId: string, over: Partial<DeviceInfo> = {}): DeviceInfo {
  const publishedAt = 1_700_000_000_000;
  return {
    deviceId,
    name: `${deviceId}-name`,
    platform: "linux",
    headless: false,
    fielddVersion: "0.1.0",
    contractsVersion: CONTRACTS_VERSION,
    capabilities: { terminalHost: false, docHost: true, push: false },
    bootId: `boot-${deviceId}`,
    publishedAt,
    self: false,
    online: true,
    lastSeenAt: publishedAt,
    ...over,
  };
}

function catalogEntry(
  owner: string,
  artifactId: string,
  over: Partial<ArtifactCatalogEntry> = {},
): ArtifactCatalogEntry {
  return {
    artifactId,
    title: `${owner} artifact`,
    kind: "proxy",
    originDeviceId: owner,
    originBootId: `boot-${owner}`,
    url: `https://${owner}.tailnet.ts.net:17180`,
    advertisedAvailability: "active",
    availabilityAt: 1_700_000_000_100,
    publishedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_001,
    ...over,
  };
}

function service(
  dataDir: string,
  bridge: FakeBridge,
  options: {
    probe?: (source: ArtifactSource) => Promise<boolean>;
    writeIntent?: (path: string, body: string) => void;
    writeCatalogCache?: (path: string, body: string) => Promise<void>;
    ensurePreviewDir?: (path: string) => void;
    removePreviewDir?: (path: string) => void;
    capturePreview?: (
      params: ShellWebContentsCaptureArtifactPreviewParams,
    ) => Promise<ShellWebContentsCaptureArtifactPreviewResult>;
    capturePreviewAvailable?: () => boolean;
    catalog?: ArtifactCatalogBridge;
  } = {},
): ArtifactService {
  return new ArtifactService({
    dataDir,
    bridge,
    maintenanceMs: false,
    probe: options.probe ?? (async () => true),
    ...(options.catalog !== undefined ? { catalog: options.catalog } : {}),
    ...(options.writeIntent !== undefined ? { writeIntent: options.writeIntent } : {}),
    ...(options.writeCatalogCache !== undefined
      ? { writeCatalogCache: options.writeCatalogCache }
      : {}),
    ...(options.ensurePreviewDir !== undefined
      ? { ensurePreviewDir: options.ensurePreviewDir }
      : {}),
    ...(options.removePreviewDir !== undefined
      ? { removePreviewDir: options.removePreviewDir }
      : {}),
    ...(options.capturePreview !== undefined ? { capturePreview: options.capturePreview } : {}),
    ...(options.capturePreviewAvailable !== undefined
      ? { capturePreviewAvailable: options.capturePreviewAvailable }
      : {}),
  });
}

const proxy = (
  artifactId = A,
  over: Partial<{ title: string; port: number; scheme: "http" | "https"; allow: string[] }> = {},
) => ({
  artifactId,
  title: over.title ?? "Workbench",
  source: {
    kind: "proxy" as const,
    port: over.port ?? 3_000,
    scheme: over.scheme ?? "http",
  },
  ...(over.allow !== undefined ? { allow: over.allow } : {}),
});

function intentFile(dataDir: string): { v: number; artifacts: unknown[] } {
  return JSON.parse(readFileSync(join(dataDir, "registries", ARTIFACT_INTENT_FILE), "utf8")) as {
    v: number;
    artifacts: unknown[];
  };
}

async function auditRecords(dataDir: string): Promise<AuditRecordV1[]> {
  const records: AuditRecordV1[] = [];
  for (const name of readdirSync(join(dataDir, "audit")).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const verified = await verifyAuditSegment(join(dataDir, "audit", name));
    expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
    records.push(...verified.records);
  }
  return records;
}

describe("ArtifactService (AH-1 unit)", () => {
  it("pins the canonical bytes, stable port, and fingerprinted HTTPS serve shape", async () => {
    const vector = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../contracts/fixtures/artifact-serving.vector.json"),
        "utf8",
      ),
    ) as {
      intent: unknown;
      previewDir: string;
      portCandidate: number;
      canonicalJson: string;
      sha256: string;
      serveId: string;
    };
    const intent = LocalArtifactIntent.parse(vector.intent);
    expect(artifactPortCandidate(intent.artifactId)).toBe(vector.portCandidate);
    const canonical = canonicalJson(canonicalArtifactServingConfig(intent, vector.previewDir));
    expect(canonical).toBe(vector.canonicalJson);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(vector.sha256);
    expect(artifactServeId(intent, vector.previewDir)).toBe(vector.serveId);

    const dataDir = makeDataDir();
    const bridge = new FakeBridge();
    const svc = service(dataDir, bridge);
    await svc.start();
    const status = await svc.publish(
      proxy(A, { scheme: "https", allow: [" B@EXAMPLE.COM ", "b@example.com"] }),
    );
    const spec = bridge.last()[0]!;
    expect(status.status).toBe("active");
    expect(spec).toMatchObject({
      name: `artifact:${A}`,
      listenPort: artifactPortCandidate(A),
      target: { kind: "port", port: 3_000, scheme: "https" },
      allow: ["b@example.com"],
      tls: true,
    });
    expect(spec.serveId).toMatch(new RegExp(`^artifact-${A}-[a-z2-7]{16}$`));
    expect(spec.previewDir).toBe(join(dataDir, "artifacts", "previews", A));

    const persisted = intentFile(dataDir);
    expect(persisted.v).toBe(2);
    expect(persisted.artifacts).toHaveLength(1);
    expect(persisted.artifacts[0]).toMatchObject({
      artifactId: A,
      listenPort: artifactPortCandidate(A),
      publicTls: true,
      desired: "published",
      retiringServeIds: [],
    });
  });

  it("captures after first publish, refines only a generated title, and advances revisions", async () => {
    const dataDir = makeDataDir();
    const bridge = new FakeBridge();
    const catalog = new FakeCatalog();
    const calls: ShellWebContentsCaptureArtifactPreviewParams[] = [];
    let pageTitle = "Captured workbench";
    const svc = service(dataDir, bridge, {
      catalog,
      capturePreview: async (params) => {
        calls.push(structuredClone(params));
        return { captured: true, title: pageTitle };
      },
    });
    await svc.start();
    await svc.publish(proxy(A, { title: "localhost:3000" }));
    await until(() => svc.statuses()[0]?.previewRevision === 1);

    expect(calls).toEqual([
      {
        artifactId: A,
        url: `https://unit.ts.net:${artifactPortCandidate(A)}`,
      },
    ]);
    expect(svc.statuses()[0]).toMatchObject({
      artifactId: A,
      title: "Captured workbench",
      previewRevision: 1,
      status: "active",
    });
    expect(intentFile(dataDir).artifacts[0]).toMatchObject({
      title: "Captured workbench",
      previewRevision: 1,
    });

    pageTitle = "Refreshed workbench";
    const refreshed = await svc.refreshPreview(A);
    expect(refreshed).toEqual({ artifactId: A, captured: true, previewRevision: 2 });
    expect(svc.statuses()[0]).toMatchObject({
      title: "Captured workbench",
      previewRevision: 2,
    });
    await until(() => catalog.publishes.at(-1)?.artifacts[0]?.previewRevision === 2);
    expect(catalog.publishes.at(-1)?.artifacts[0]).toMatchObject({
      previewRevision: 2,
      title: "Captured workbench",
    });
  });

  it("serializes preview work without blocking later artifact publication", async () => {
    const calls: ShellWebContentsCaptureArtifactPreviewParams[] = [];
    const releases = new Map<
      string,
      (result: ShellWebContentsCaptureArtifactPreviewResult) => void
    >();
    const svc = service(makeDataDir(), new FakeBridge(), {
      capturePreview: (params) =>
        new Promise((resolve) => {
          calls.push(structuredClone(params));
          releases.set(params.artifactId, resolve);
        }),
    });
    await svc.start();
    await svc.publish(proxy(A));
    await until(() => calls.length === 1);

    await expect(svc.publish(proxy(B))).resolves.toMatchObject({ artifactId: B });
    expect(calls.map((call) => call.artifactId)).toEqual([A]);

    releases.get(A)?.({ captured: true });
    await until(() => calls.length === 2);
    expect(calls.map((call) => call.artifactId)).toEqual([A, B]);
    releases.get(B)?.({ captured: true });
    await until(() => svc.statuses().every((status) => status.previewRevision === 1));
  });

  it("defers unpublish cleanup until an in-flight preview write has settled", async () => {
    const dataDir = makeDataDir();
    let release!: (result: ShellWebContentsCaptureArtifactPreviewResult) => void;
    let captureStarted = false;
    const removed: string[] = [];
    const svc = service(dataDir, new FakeBridge(), {
      capturePreview: () =>
        new Promise((resolve) => {
          captureStarted = true;
          release = resolve;
        }),
      removePreviewDir: (path) => removed.push(path),
    });
    await svc.start();
    await svc.publish(proxy(A));
    await until(() => captureStarted);

    await expect(svc.unpublish({ artifactId: A })).resolves.toEqual({ removed: true });
    expect(removed).toEqual([]);
    expect(svc.statuses()[0]?.status).toBe("removing");

    release({ captured: true });
    await until(() => svc.statuses().length === 0);
    expect(removed).toEqual([join(dataDir, "artifacts", "previews", A)]);
  });

  it("keeps a user title and active artifact truth when capture is unavailable", async () => {
    const bridge = new FakeBridge();
    let attempts = 0;
    const svc = service(makeDataDir(), bridge, {
      capturePreview: async () => {
        attempts += 1;
        throw new RpcCallError("UNAVAILABLE", "desktop shell provider is unavailable", true);
      },
    });
    await svc.start();
    await svc.publish(proxy(A, { title: "My named app" }));
    await until(() => attempts === 1);
    const refreshed = await svc.refreshPreview(A);

    expect(refreshed).toEqual({
      artifactId: A,
      captured: false,
      reason: "desktop preview capture is unavailable",
    });
    expect(svc.statuses()[0]).toMatchObject({
      title: "My named app",
      status: "active",
    });
    expect(svc.statuses()[0]?.previewRevision).toBeUndefined();
  });

  it("schedules no add-time capture when the desktop provider is absent", async () => {
    const capturePreview = vi.fn(async () => ({ captured: true as const }));
    const svc = service(makeDataDir(), new FakeBridge(), {
      capturePreview,
      capturePreviewAvailable: () => false,
    });
    await svc.start();
    await svc.publish(proxy());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(capturePreview).not.toHaveBeenCalled();
    await expect(svc.refreshPreview(A)).resolves.toEqual({
      artifactId: A,
      captured: false,
      reason: "desktop preview capture is unavailable",
    });
    expect(capturePreview).not.toHaveBeenCalled();
  });

  it.each([
    ["target", { source: { kind: "proxy" as const, port: 4_000, scheme: "http" as const } }],
    ["scheme", { source: { kind: "proxy" as const, port: 3_000, scheme: "https" as const } }],
    ["allow", { allow: ["*@corp.example"] }],
  ])(
    "replaces changed %s config by fingerprint, remove-before-add, on the same port",
    async (_label, update) => {
      const bridge = new FakeBridge();
      const svc = service(makeDataDir(), bridge);
      await svc.start();
      await svc.publish(proxy());
      const before = bridge.last()[0]!;

      const status = await svc.update({ artifactId: A, ...update });
      const after = bridge.last()[0]!;
      expect(status.status).toBe("active");
      expect(after.listenPort).toBe(before.listenPort);
      expect(after.serveId).not.toBe(before.serveId);
      expect(bridge.removeAttempts).toContain(before.serveId);
      expect(bridge.native.has(before.serveId!)).toBe(false);
      expect(bridge.native.has(after.serveId!)).toBe(true);
    },
  );

  it("renames metadata without re-serving", async () => {
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    await svc.publish(proxy());
    const before = bridge.last()[0]!.serveId;
    const removes = bridge.removeAttempts.length;
    const updated = await svc.update({ artifactId: A, title: "A better title" });
    expect(updated.title).toBe("A better title");
    expect(bridge.last()[0]!.serveId).toBe(before);
    expect(bridge.removeAttempts).toHaveLength(removes);
  });

  it("persists a failed replacement removal and resumes it after restart", async () => {
    const dataDir = makeDataDir();
    const firstBridge = new FakeBridge();
    const first = service(dataDir, firstBridge);
    await first.start();
    await first.publish(proxy());
    const oldId = firstBridge.last()[0]!.serveId!;
    firstBridge.failRemoveCount = 1;

    const replacing = await first.update({
      artifactId: A,
      source: { kind: "proxy", port: 4_000, scheme: "http" },
    });
    expect(replacing.status).toBe("removing");
    expect(firstBridge.last()).toEqual([]); // replacement never races the failed removal
    expect(intentFile(dataDir).artifacts[0]).toMatchObject({ retiringServeIds: [oldId] });
    await first.dispose();

    const secondBridge = new FakeBridge();
    secondBridge.native = new Map(firstBridge.native);
    const second = service(dataDir, secondBridge);
    await second.start();
    expect(secondBridge.removeAttempts).toEqual([oldId]);
    expect(secondBridge.last()[0]!.target).toMatchObject({ port: 4_000 });
    expect(secondBridge.last()[0]!.listenPort).toBe(artifactPortCandidate(A));
    expect(intentFile(dataDir).artifacts[0]).toMatchObject({ retiringServeIds: [] });
    await until(() => second.statuses()[0]?.status === "active");
  });

  it("keeps failed unpublish visible as removing, then treats remove-NOT_FOUND as success", async () => {
    const dataDir = makeDataDir();
    const firstBridge = new FakeBridge();
    const first = service(dataDir, firstBridge);
    await first.start();
    await first.publish(proxy());
    const serveId = firstBridge.last()[0]!.serveId!;
    firstBridge.failRemoveCount = 1;
    expect(await first.unpublish({ artifactId: A })).toEqual({ removed: true });
    expect(first.statuses()[0]).toMatchObject({ status: "removing" });
    expect(intentFile(dataDir).artifacts[0]).toMatchObject({
      desired: "absent",
      retiringServeIds: [serveId],
    });
    await first.dispose();

    // The listener disappeared while fieldd was down. FakeBridge implements
    // the bridge law: native NOT_FOUND converges as successful removal.
    const secondBridge = new FakeBridge();
    const second = service(dataDir, secondBridge);
    await second.start();
    expect(secondBridge.removeAttempts).toEqual([serveId]);
    expect(second.statuses()).toEqual([]);
    expect(intentFile(dataDir).artifacts).toEqual([]);
  });

  it("folds source probes separately and clears a sticky CONNECTION_REFUSED only", async () => {
    let ready = false;
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge, { probe: async () => ready });
    await svc.start();
    const unavailable = await svc.publish(proxy());
    expect(unavailable).toMatchObject({
      status: "source-unavailable",
      error: "source is unavailable",
    });
    const id = bridge.last()[0]!.serveId!;
    bridge.runtime(id, { status: "error", error: "[CONNECTION_REFUSED] dial failed" });

    ready = true;
    bridge.autoCarry = false; // preserve Truffle's sticky runtime error on re-declare
    const recovered = await svc.publish(proxy());
    expect(recovered.status).toBe("active");
    expect(recovered.error).toBeUndefined();

    bridge.runtime(id, { status: "error", error: "[SERVE_ERROR] root /private/secret failed" });
    const listenerError = await svc.publish(proxy());
    expect(listenerError.status).toBe("error");
    expect(listenerError.error).toBe("artifact listener could not start");
    expect(JSON.stringify(listenerError)).not.toContain("/private/secret");
  });

  it("enables v0.7.12 folder + SPA fallback on a stable two-route listener", async () => {
    const folder = makeDataDir();
    writeFileSync(join(folder, "index.html"), "ok");
    const dataDir = makeDataDir();
    const bridge = new FakeBridge();
    const svc = service(dataDir, bridge);
    await svc.start();
    const status = await svc.publish({
      artifactId: B,
      title: "Static site",
      source: { kind: "folder", path: folder, spaFallback: "/index.html" },
    });
    expect(status.status).toBe("active");
    expect(bridge.last()[0]).toMatchObject({
      name: `artifact:${B}`,
      listenPort: artifactPortCandidate(B),
      target: { kind: "dir", path: realpathSync(folder), fallback: "/index.html" },
      tls: true,
    });
    expect(bridge.last()[0]!.listenPort).not.toBe(0);

    await expect(
      svc.publish({
        artifactId: C,
        title: "Missing",
        source: { kind: "folder", path: join(folder, "missing") },
      }),
    ).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { code: "STATIC_ROOT_INVALID" },
    });
  });

  it("never carries local source details in list/status projection", async () => {
    const folder = makeDataDir();
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    const status = await svc.publish({
      artifactId: A,
      title: "Private source",
      source: { kind: "folder", path: folder },
      allow: ["secret-user@example.com"],
    });
    const wire = JSON.stringify(status);
    expect(wire).not.toContain(folder);
    expect(wire).not.toContain("secret-user");
    expect(status).not.toHaveProperty("source");
    expect(status).not.toHaveProperty("listenPort");
    expect(status).not.toHaveProperty("allow");
  });

  it("writes only the known proxy source fields from a tolerant mutation shape", async () => {
    const dataDir = makeDataDir();
    const svc = service(dataDir, new FakeBridge());
    await svc.start();
    await svc.publish({
      ...proxy(),
      source: {
        ...proxy().source,
        futureField: "must-not-enter-private-intent",
      },
    });
    expect(intentFile(dataDir).artifacts[0]).toMatchObject({
      source: { kind: "proxy", port: 3_000, scheme: "http" },
    });
    expect(JSON.stringify(intentFile(dataDir))).not.toContain("futureField");
  });

  it("rejects malformed Go path.Match allow globs before writing intent", async () => {
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    await expect(svc.publish(proxy(A, { allow: ["[z-a]"] }))).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    expect(bridge.last()).toEqual([]);
  });

  it("reserves around live listeners and returns RESOURCE_EXHAUSTED for a full range", async () => {
    const bridge = new FakeBridge();
    const first = artifactPortCandidate(A);
    bridge.observedOverride = [
      { serveId: "other", name: "other", listenPort: first, url: "https://unit.ts.net" },
    ];
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    await svc.publish(proxy());
    expect(bridge.last()[0]!.listenPort).toBe(
      first === ARTIFACT_LIMITS.LISTEN_PORT_MAX ? ARTIFACT_LIMITS.LISTEN_PORT_MIN : first + 1,
    );

    const fullBridge = new FakeBridge();
    fullBridge.observedOverride = Array.from(
      { length: ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1 },
      (_, offset) => ({
        serveId: `occupied-${offset}`,
        name: `occupied-${offset}`,
        listenPort: ARTIFACT_LIMITS.LISTEN_PORT_MIN + offset,
      }),
    );
    const exhausted = service(makeDataDir(), fullBridge);
    await exhausted.start();
    await expect(exhausted.publish(proxy(B))).rejects.toMatchObject({
      kind: "RESOURCE_EXHAUSTED",
    });
  });

  it("does not add or mutate memory when the durable intent write fails", async () => {
    const bridge = new FakeBridge();
    let previewPreparations = 0;
    const svc = service(makeDataDir(), bridge, {
      writeIntent: () => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
      ensurePreviewDir: () => {
        previewPreparations += 1;
      },
    });
    await svc.start();
    await expect(svc.publish(proxy())).rejects.toMatchObject({ kind: "INTERNAL" });
    expect(svc.statuses()).toEqual([]);
    expect(svc.health()).toMatchObject({ count: 0, storage: "failed" });
    expect(bridge.last()).toEqual([]);
    expect(bridge.native.size).toBe(0);
    expect(previewPreparations).toBe(0);
  });

  it("keeps absent intent as the durable retry record until preview cleanup succeeds", async () => {
    const dataDir = makeDataDir();
    let failCleanup = true;
    const svc = service(dataDir, new FakeBridge(), {
      removePreviewDir: (path) => {
        if (failCleanup) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        rmSync(path, { recursive: true, force: true });
      },
    });
    await svc.start();
    await svc.publish(proxy());

    await svc.unpublish({ artifactId: A });
    expect(svc.statuses()[0]).toMatchObject({
      artifactId: A,
      status: "removing",
      error: "artifact preview cleanup is retrying",
    });
    expect(intentFile(dataDir).artifacts[0]).toMatchObject({
      artifactId: A,
      desired: "absent",
      retiringServeIds: [],
    });

    failCleanup = false;
    await svc.unpublish({ artifactId: A });
    expect(svc.statuses()).toEqual([]);
    expect(intentFile(dataDir).artifacts).toEqual([]);
  });

  it("migrates C6 intent once, retires the old listener, and preserves evidence", async () => {
    const dataDir = makeDataDir();
    const registryDir = join(dataDir, "registries");
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(
      join(registryDir, "field.artifacts.v1.json"),
      `${JSON.stringify({
        v: 1,
        artifacts: [
          {
            name: "web",
            target: { kind: "port", port: 3_000 },
            allow: ["*@EXAMPLE.COM"],
            publishedAt: 42,
          },
        ],
      })}\n`,
    );
    const bridge = new FakeBridge();
    bridge.native.set("artifact-web", {
      name: "artifact-web",
      target: { kind: "port", port: 3_000 },
      listenPort: 3_000,
      status: "active",
      url: "http://old.ts.net:3000",
    });
    const svc = service(dataDir, bridge);
    await svc.start();

    expect(bridge.removeAttempts[0]).toBe("artifact-web");
    expect(bridge.last()[0]).toMatchObject({
      name: expect.stringMatching(/^artifact:01/),
      target: { kind: "port", port: 3_000, scheme: "http" },
      tls: true,
    });
    expect(bridge.last()[0]!.listenPort).toBeGreaterThanOrEqual(ARTIFACT_LIMITS.LISTEN_PORT_MIN);
    await until(() => svc.statuses()[0]?.status === "active");
    expect(svc.statuses()[0]).toMatchObject({ name: "web", title: "web", status: "active" });
    const names = readdirSync(registryDir);
    expect(names).toContain(ARTIFACT_INTENT_FILE);
    expect(names.some((name) => name.startsWith("field.artifacts.v1.json.migrated-"))).toBe(true);
  });

  it("drops one malformed legacy row without rejecting migration or daemon startup", async () => {
    const dataDir = makeDataDir();
    const registryDir = join(dataDir, "registries");
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(
      join(registryDir, "field.artifacts.v1.json"),
      `${JSON.stringify({
        v: 1,
        artifacts: [
          {
            name: "bad",
            target: { kind: "port", port: 3_001 },
            allow: ["[z-a]"],
            publishedAt: 41,
          },
          {
            name: "good",
            target: { kind: "port", port: 3_000 },
            allow: ["*@example.com"],
            publishedAt: 42,
          },
        ],
      })}\n`,
    );
    const svc = service(dataDir, new FakeBridge());
    await expect(svc.start()).resolves.toBeUndefined();
    expect(svc.statuses()).toHaveLength(1);
    expect(svc.statuses()[0]).toMatchObject({ title: "good", name: "good" });
    expect(intentFile(dataDir).artifacts).toHaveLength(1);
  });

  it("rejects queued mutations once disposal starts and resolves after accepted work drains", async () => {
    let releaseProbe: ((ready: boolean) => void) | undefined;
    const probe = new Promise<boolean>((resolve) => {
      releaseProbe = resolve;
    });
    const dataDir = makeDataDir();
    const svc = service(dataDir, new FakeBridge(), { probe: async () => await probe });
    await svc.start();

    const accepted = svc.publish(proxy(A));
    await until(() => svc.statuses().some((status) => status.artifactId === A));
    const queued = svc.publish(proxy(B));
    const drained = svc.dispose();
    releaseProbe!(true);

    await accepted;
    await expect(queued).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    await drained;
    expect(intentFile(dataDir).artifacts).toHaveLength(1);
    expect(intentFile(dataDir).artifacts[0]).toMatchObject({ artifactId: A });
  });

  it("quarantines unreadable v2 evidence and keeps boot alive", async () => {
    const dataDir = makeDataDir();
    const path = join(dataDir, "registries", ARTIFACT_INTENT_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    const svc = service(dataDir, new FakeBridge());
    await svc.start();
    expect(svc.statuses()).toEqual([]);
    expect(
      readdirSync(dirname(path)).some((name) => name.startsWith(`${ARTIFACT_INTENT_FILE}.bad-`)),
    ).toBe(true);
  });

  it("quarantines an intent file with the wrong version", async () => {
    const dataDir = makeDataDir();
    const path = join(dataDir, "registries", ARTIFACT_INTENT_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ v: 3, artifacts: [] })}\n`);
    const svc = service(dataDir, new FakeBridge());
    await svc.start();
    expect(svc.statuses()).toEqual([]);
    expect(
      readdirSync(dirname(path)).some((name) => name.startsWith(`${ARTIFACT_INTENT_FILE}.bad-`)),
    ).toBe(true);
  });

  it("drops one invalid persisted entry without losing a valid sibling", async () => {
    const dataDir = makeDataDir();
    const path = join(dataDir, "registries", ARTIFACT_INTENT_FILE);
    mkdirSync(dirname(path), { recursive: true });
    const valid = LocalArtifactIntent.parse({
      artifactId: A,
      title: "Valid",
      source: { kind: "proxy", port: 3_000, scheme: "http" },
      listenPort: artifactPortCandidate(A),
      allow: [],
      publicTls: true,
      desired: "published",
      retiringServeIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    writeFileSync(
      path,
      `${JSON.stringify({
        v: 2,
        artifacts: [valid, { ...valid, artifactId: B, allow: ["[z-a]"] }],
      })}\n`,
    );
    const svc = service(dataDir, new FakeBridge());
    await svc.start();
    expect(svc.statuses().map((status) => status.artifactId)).toEqual([A]);
  });
});

describe("ArtifactService (AH-2 catalog)", () => {
  it("pins the hostile URL and whole-slice cap vectors", () => {
    const vector = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../contracts/fixtures/artifact-catalog-hostile.vector.json"),
        "utf8",
      ),
    ) as {
      owner: string;
      poisonedUrls: string[];
      oversizePaddingBytes: number;
      overCount: number;
    };
    for (const url of vector.poisonedUrls) {
      const parsed = parseCatalogSlice(vector.owner, {
        v: 1,
        artifacts: [catalogEntry(vector.owner, A, { url })],
      });
      expect(parsed).toMatchObject({ ok: true, entries: [], dropped: 1 });
    }
    expect(
      parseCatalogSlice(vector.owner, {
        v: 1,
        artifacts: [],
        padding: "x".repeat(vector.oversizePaddingBytes),
      }),
    ).toMatchObject({ ok: false, issue: "encoded slice exceeds limit" });
    expect(
      parseCatalogSlice(vector.owner, {
        v: 1,
        artifacts: Array.from({ length: vector.overCount }, () => null),
      }),
    ).toMatchObject({ ok: false, issue: "entry count exceeds limit" });
  });

  it("publishes a narrow whole self-slice and republishes it after store replay", async () => {
    const dataDir = makeDataDir();
    const bridge = new FakeBridge();
    const catalog = new FakeCatalog();
    const svc = service(dataDir, bridge, { catalog });
    await svc.start();
    const initialWrites = catalog.publishes.length;

    await svc.publish(proxy(A, { allow: ["*@example.com"] }));
    await until(() => catalog.publishes.at(-1)?.artifacts[0]?.artifactId === A);
    const slice = catalog.publishes.at(-1)!;
    expect(slice.artifacts[0]).toMatchObject({
      artifactId: A,
      originDeviceId: "dev-self",
      originBootId: "boot-self",
      advertisedAvailability: "active",
      url: `https://unit.ts.net:${artifactPortCandidate(A)}`,
    });
    expect(JSON.stringify(slice)).not.toMatch(/source|scheme|allow|3000/);
    expect(svc.artifacts()[0]).toMatchObject({
      artifactKey: `dev-self:${A}`,
      availability: "active",
      editable: true,
      openable: true,
    });

    const beforeReplay = catalog.publishes.length;
    catalog.replay();
    await until(() => catalog.publishes.length > beforeReplay);
    expect(catalog.publishes.at(-1)).toEqual(slice);
    expect(catalog.publishes.length).toBeGreaterThan(initialWrites);
  });

  it("coalesces a store burst into one catalog emission and one async cache checkpoint", async () => {
    const catalog = new FakeCatalog();
    let cacheWrites = 0;
    const svc = service(makeDataDir(), new FakeBridge(), {
      catalog,
      writeCatalogCache: async () => {
        cacheWrites += 1;
      },
    });
    await svc.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const emissions: ArtifactView[][] = [];
    svc.onCatalogChanged((artifacts) => emissions.push(artifacts));

    catalog.push("peer-a", { v: 1, artifacts: [catalogEntry("peer-a", A)] });
    catalog.push("peer-b", { v: 1, artifacts: [catalogEntry("peer-b", B)] });
    catalog.push("peer-c", { v: 1, artifacts: [catalogEntry("peer-c", C)] });

    await until(() => cacheWrites > 0 && emissions.at(-1)?.length === 3);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cacheWrites).toBe(1);
    expect(emissions).toHaveLength(1);
    await svc.dispose();
    expect(catalog.event).toBeNull();
  });

  it("admits 256 remote origins in addition to the local self slice", async () => {
    const catalog = new FakeCatalog();
    catalog.slices[catalog.deviceId] = { data: { v: 1, artifacts: [] } };
    for (let index = 0; index < 256; index += 1) {
      const owner = `peer-${index.toString().padStart(3, "0")}`;
      catalog.slices[owner] = {
        data: { v: 1, artifacts: [catalogEntry(owner, A)] },
      };
    }
    const svc = service(makeDataDir(), new FakeBridge(), { catalog });
    await svc.start();
    expect(svc.artifacts()).toHaveLength(256);
  });

  it("ignores a forged self cache row without consuming a remote-origin slot", async () => {
    const dataDir = makeDataDir();
    const slices: Record<string, unknown> = {
      "dev-self": { v: 1, artifacts: [catalogEntry("dev-self", A)] },
    };
    for (let index = 0; index < 256; index += 1) {
      const owner = `peer-${index.toString().padStart(3, "0")}`;
      slices[owner] = { v: 1, artifacts: [catalogEntry(owner, A)] };
    }
    const registryDir = join(dataDir, "registries");
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(
      join(registryDir, "field.artifact-catalog-cache.v1.json"),
      JSON.stringify({ v: 1, slices }),
    );

    const svc = service(dataDir, new FakeBridge(), { catalog: new FakeCatalog() });
    await svc.start();

    expect(svc.artifacts()).toHaveLength(256);
    expect(svc.artifacts().some((artifact) => artifact.originDeviceId === "dev-self")).toBe(false);
  });

  it("isolates poisoned entries, binds URLs, and keeps colliding origin ids distinct", async () => {
    const catalog = new FakeCatalog();
    const self = catalog.deviceRows[0]!;
    catalog.deviceRows = [
      self,
      deviceInfo("peer-a", {
        bootId: "boot-peer-a",
        tailnetDnsName: "peer-a.tailnet.ts.net",
      }),
      deviceInfo("peer-b", {
        bootId: "boot-peer-b",
        tailnetDnsName: "peer-b.tailnet.ts.net",
      }),
      deviceInfo("peer-c", { bootId: "boot-peer-c" }), // host binding unavailable
    ];
    const svc = service(makeDataDir(), new FakeBridge(), { catalog });
    await svc.start();

    catalog.push("peer-a", {
      v: 1,
      artifacts: [
        {
          ...catalogEntry("peer-a", A),
          source: { kind: "folder", path: "/private/secret" },
          allow: ["*"],
          nativeError: "bind failed at /private/secret",
        },
        catalogEntry("peer-a", B, { url: "https://evil.tailnet.ts.net:17180" }),
        catalogEntry("peer-a", C, { url: undefined }),
      ],
    });
    catalog.push("peer-b", { v: 1, artifacts: [catalogEntry("peer-b", A)] });
    catalog.push("peer-c", { v: 1, artifacts: [catalogEntry("peer-c", A)] });
    catalog.push("peer-d", {
      v: 1,
      artifacts: [],
      padding: "x".repeat(ARTIFACT_LIMITS.SLICE_BYTES),
    });

    await until(() => svc.artifacts().length === 3);
    const views = svc.artifacts();
    expect(views.map((view) => view.artifactKey).sort()).toEqual([
      `peer-a:${A}`,
      `peer-b:${A}`,
      `peer-c:${A}`,
    ]);
    expect(JSON.stringify(views)).not.toMatch(/private\/secret|nativeError|"allow"|"source"/);
    expect(views.find((view) => view.originDeviceId === "peer-a")).toMatchObject({
      url: "https://peer-a.tailnet.ts.net:17180",
      openable: true,
    });
    const unbound = views.find((view) => view.originDeviceId === "peer-c")!;
    expect(unbound.openable).toBe(false);
    expect(unbound.url).toBeUndefined();

    catalog.setDevices(
      catalog.deviceRows.map((device) =>
        device.deviceId === "peer-a" ? { ...device, online: false } : device,
      ),
    );
    await until(
      () =>
        svc.artifacts().find((view) => view.originDeviceId === "peer-a")?.availability ===
        "offline",
    );
    const offline = svc.artifacts().find((view) => view.originDeviceId === "peer-a")!;
    expect(offline.openable).toBe(true); // authenticated binding survives liveness lag

    catalog.setDevices(
      catalog.deviceRows.map((device) =>
        device.deviceId === "peer-b" ? { ...device, bootId: "new-boot" } : device,
      ),
    );
    await until(
      () =>
        svc.artifacts().find((view) => view.originDeviceId === "peer-b")?.availability ===
        "unknown",
    );
    catalog.remove("peer-a");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(svc.artifacts().some((view) => view.originDeviceId === "peer-a")).toBe(true);
    expect(svc.artifacts().some((view) => view.originDeviceId === "peer-d")).toBe(false);
  });

  it("retains last-known safe metadata across peer removal and a fieldd restart", async () => {
    const dataDir = makeDataDir();
    const firstCatalog = new FakeCatalog();
    firstCatalog.deviceRows.push(
      deviceInfo("peer-a", {
        bootId: "boot-peer-a",
        tailnetDnsName: "peer-a.tailnet.ts.net",
      }),
    );
    const first = service(dataDir, new FakeBridge(), { catalog: firstCatalog });
    await first.start();
    firstCatalog.push("peer-a", { v: 1, artifacts: [catalogEntry("peer-a", A)] });
    await until(() => first.artifacts().some((view) => view.originDeviceId === "peer-a"));
    firstCatalog.remove("peer-a");
    await first.dispose();

    const secondCatalog = new FakeCatalog();
    const second = service(dataDir, new FakeBridge(), { catalog: secondCatalog });
    await second.start();
    const retained = second.artifacts().find((view) => view.originDeviceId === "peer-a");
    expect(retained).toMatchObject({
      artifactId: A,
      availability: "offline",
      openable: false,
    });
    expect(retained?.url).toBeUndefined();
  });
});

describe("Artifact Hub over a real daemon", () => {
  async function boot(dataDir: string, configure?: (mock: MockMgmtServer) => void) {
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
    configure?.(mock);
    await mock.start();
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    return { mock, daemon };
  }

  async function localSource(): Promise<{ server: Server; port: number }> {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("ok");
    });
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("source did not bind");
    cleanup.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    return { server, port: address.port };
  }

  async function rpcFor(port: number, token: string): Promise<WsRpc> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolveOpen, reject) => {
      ws.once("open", () => resolveOpen());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await helloAs(rpc, token, "shell-main");
    return rpc;
  }

  function relayDevice(from: MockMgmtServer, to: MockMgmtServer, originDeviceId: string): void {
    const slice = structuredClone(from.storeWrites.at(-1));
    to.storeSlices.set(originDeviceId, slice);
    to.pushStoreDelta({ kind: "peerUpdated", deviceId: originDeviceId, data: slice, version: 1 });
  }

  function relayArtifacts(from: MockMgmtServer, to: MockMgmtServer, originDeviceId: string): void {
    const slice = structuredClone(lastArtifactSlice(from));
    to.artifactStoreSlices.set(originDeviceId, slice);
    to.pushArtifactStoreDelta({
      kind: "peerUpdated",
      deviceId: originDeviceId,
      data: slice,
      version: 1,
    });
  }

  function lastArtifactSlice(mock: MockMgmtServer): ArtifactCatalogSlice {
    const slice = mock.artifactStoreWrites.at(-1) as ArtifactCatalogSlice | undefined;
    if (slice === undefined) throw new Error("artifact store has not been written");
    return slice;
  }

  it("mediates add-time and explicit preview capture without image bytes on ProductAPI", async () => {
    const dataDir = makeDataDir();
    const source = await localSource();
    const { mock, daemon } = await boot(dataDir);
    cleanup.push(() => mock.stop());
    cleanup.push(() => daemon.stop());
    const shell = await rpcFor(daemon.controlPort, daemon.shellToken);
    await shell.call("shell.provider.register", { methods: [...SHELL_PROVIDER_METHODS] });

    await shell.call("artifact.publish", {
      artifactId: A,
      title: `localhost:${source.port}`,
      source: { kind: "proxy", port: source.port, scheme: "http" },
    });
    await until(
      () =>
        shell.notifications.filter((notification) => notification.method === "shell.provider.call")
          .length === 1,
    );
    const first = ShellProviderCallParams.parse(
      shell.notifications.find((notification) => notification.method === "shell.provider.call")
        ?.params,
    );
    expect(first).toMatchObject({
      method: "shell.webcontents.captureArtifactPreview",
      params: {
        artifactId: A,
        url: `https://mock.ts.net:${artifactPortCandidate(A)}`,
      },
      caller: { kind: "local-token", clientKind: "fieldd" },
    });
    expect(JSON.stringify(first)).not.toContain("thumbnail.jpg");
    await shell.call("shell.provider.resolve", {
      callId: first.callId,
      outcome: { result: { captured: true, title: "Captured app" } },
    });
    await until(() => daemon.artifacts.statuses()[0]?.previewRevision === 1);

    const refresh = shell.call("artifact.refreshPreview", { artifactId: A });
    await until(
      () =>
        shell.notifications.filter((notification) => notification.method === "shell.provider.call")
          .length === 2,
    );
    const second = ShellProviderCallParams.parse(
      shell.notifications.filter((notification) => notification.method === "shell.provider.call")[1]
        ?.params,
    );
    await shell.call("shell.provider.resolve", {
      callId: second.callId,
      outcome: { result: { captured: true, title: "Ignored after refinement" } },
    });
    await expect(refresh).resolves.toEqual({
      artifactId: A,
      captured: true,
      previewRevision: 2,
    });
    const listed = (await shell.call("artifact.list", {})) as { artifacts: ArtifactView[] };
    expect(listed.artifacts[0]).toMatchObject({
      title: "Captured app",
      previewRevision: 2,
      thumbnailUrl: `https://mock.ts.net:${artifactPortCandidate(A)}/.vibefield/preview/thumbnail.jpg?v=2`,
    });
    await daemon.stop();
    const previewOutcomes = (await auditRecords(dataDir)).filter(
      (record) => record.action === "artifact.preview.capture" && record.phase === "outcome",
    );
    expect(previewOutcomes).toHaveLength(2);
    expect(previewOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: { kind: "system", id: "fieldd" },
          target: { kind: "artifact", id: A },
          outcome: "succeeded",
        }),
      ]),
    );
    const persistedAudit = readdirSync(join(dataDir, "audit"))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => readFileSync(join(dataDir, "audit", name), "utf8"))
      .join("\n");
    expect(persistedAudit).not.toContain(`https://mock.ts.net:${artifactPortCandidate(A)}`);
    expect(persistedAudit).not.toContain("thumbnail.jpg");
  }, 30_000);

  it("does not open a remote URL from a DeviceSlice-authored DNS claim", async () => {
    const dataDir = makeDataDir();
    const started = await boot(dataDir, (mock) => {
      mock.meshPeers = [
        { id: "node-peer", deviceId: "dev-peer", online: true }, // no authenticated DNS
      ];
      mock.storeSlices.set("dev-peer", {
        deviceId: "dev-peer",
        name: "peer",
        platform: "linux",
        headless: false,
        fielddVersion: "0.1.0",
        contractsVersion: CONTRACTS_VERSION,
        capabilities: { terminalHost: false, docHost: true, push: false },
        bootId: "boot-peer",
        publishedAt: 1,
        tailnetDnsName: "evil.example.com",
      });
      mock.artifactStoreSlices.set("dev-peer", {
        v: 1,
        artifacts: [
          catalogEntry("dev-peer", A, {
            url: "https://evil.example.com:17180",
            originBootId: "boot-peer",
          }),
        ],
      });
    });
    cleanup.push(() => started.daemon.stop());
    cleanup.push(() => started.mock.stop());

    await until(() => started.daemon.artifacts.artifacts().length === 1);
    expect(started.daemon.devices.get("dev-peer")?.tailnetDnsName).toBeUndefined();
    expect(started.daemon.artifacts.artifacts()[0]).toMatchObject({
      originDeviceId: "dev-peer",
      openable: false,
    });
    expect(started.daemon.artifacts.artifacts()[0]?.url).toBeUndefined();
  });

  it("publishes an exact artifact URL, keeps the product secret separate, replays, and removes", async () => {
    const dataDir = makeDataDir();
    const source = await localSource();
    const first = await boot(dataDir);
    cleanup.push(() => first.mock.stop()); // mock field-native outlives both fieldd boots
    const rpc = await rpcFor(first.daemon.controlPort, first.daemon.shellToken);
    const published = (await rpc.call("artifact.publish", {
      artifactId: A,
      title: "Live app",
      source: { kind: "proxy", port: source.port, scheme: "http" },
    })) as ArtifactStatus;
    expect(published.status).toBe("active");
    expect(published.url).toBe(`https://mock.ts.net:${artifactPortCandidate(A)}`);

    const health = first.daemon.health();
    const artifactHealth = health.mesh.serves.find((serve) => serve.name === `artifact:${A}`);
    const productHealth = health.mesh.serves.find((serve) => serve.name === "product");
    expect(artifactHealth?.url).toBe(published.url);
    expect(artifactHealth?.url).not.toContain("/t/");
    expect(productHealth?.url).toContain("/t/");
    expect(health.artifacts).toMatchObject({
      count: 1,
      storage: "ready",
      sources: { ready: 1, unavailable: 0, pending: 0 },
    });

    await first.daemon.stop();
    const second = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => second.stop());
    await until(() => second.artifacts.statuses()[0]?.status === "active", 8_000);
    const rpc2 = await rpcFor(second.controlPort, second.shellToken);
    const listed = (await rpc2.call("artifact.list", {})) as { artifacts: ArtifactView[] };
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.artifacts[0]).toMatchObject({
      artifactId: A,
      title: "Live app",
      availability: "active",
      url: published.url,
    });
    expect(JSON.stringify(listed)).not.toContain(String(source.port));

    await rpc2.call("artifact.unpublish", { artifactId: A });
    expect(second.health().mesh.serves.map((serve) => serve.name)).not.toContain(`artifact:${A}`);
    expect(second.health().mesh.serves.map((serve) => serve.name)).toContain("product");
  }, 30_000);

  it("lets workspace.read list but rejects mutation scope and every device-routed mutation", async () => {
    const dataDir = makeDataDir();
    const { mock, daemon } = await boot(dataDir);
    cleanup.push(() => mock.stop());
    cleanup.push(() => daemon.stop());
    const shell = await rpcFor(daemon.controlPort, daemon.shellToken);

    const routed = await shell.callErr("artifact.publish", {
      ...proxy(),
      device: "foreign-device",
    });
    expect(routed.data?.kind).toBe("PRECONDITION_FAILED");

    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["workspace.read"],
      label: "observer",
    })) as { token: string };
    const observer = await rpcFor(daemon.controlPort, minted.token);
    const denied = await observer.callErr("artifact.publish", proxy());
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect((await observer.call("artifact.list", {})) as { artifacts: unknown[] }).toEqual({
      artifacts: [],
    });
  }, 30_000);

  it("converges add, collision, update, status, subscription, and removal across two daemon stacks", async () => {
    const source = await localSource();
    const a = await boot(makeDataDir(), (mock) => {
      mock.meshDeviceId = "dev-a";
      mock.storeSlices.clear();
      mock.meshPeers = [
        {
          id: "node-b",
          deviceId: "dev-b",
          online: true,
          whois: { login: "me@example.com", deviceName: "MOCK.TS.NET." },
        },
      ];
    });
    const b = await boot(makeDataDir(), (mock) => {
      mock.meshDeviceId = "dev-b";
      mock.storeSlices.clear();
      mock.meshPeers = [
        {
          id: "node-a",
          deviceId: "dev-a",
          online: true,
          whois: { login: "me@example.com", deviceName: "mock.ts.net" },
        },
      ];
    });
    cleanup.push(() => a.daemon.stop());
    cleanup.push(() => b.daemon.stop());
    cleanup.push(() => a.mock.stop());
    cleanup.push(() => b.mock.stop());
    relayDevice(a.mock, b.mock, "dev-a");
    relayDevice(b.mock, a.mock, "dev-b");
    await until(
      () =>
        a.daemon.devices.get("dev-b")?.tailnetDnsName === "mock.ts.net" &&
        b.daemon.devices.get("dev-a")?.tailnetDnsName === "mock.ts.net",
    );

    const rpcA = await rpcFor(a.daemon.controlPort, a.daemon.shellToken);
    const rpcB = await rpcFor(b.daemon.controlPort, b.daemon.shellToken);
    const subscription = (await rpcB.call("artifact.subscribe", {})) as {
      subId: string;
      snapshot: ArtifactView[];
    };
    expect(subscription.snapshot).toEqual([]);

    await rpcA.call("artifact.publish", {
      artifactId: A,
      title: "A workbench",
      source: { kind: "proxy", port: source.port, scheme: "http" },
    });
    await until(() => lastArtifactSlice(a.mock).artifacts[0]?.advertisedAvailability === "active");
    relayArtifacts(a.mock, b.mock, "dev-a");
    await until(() =>
      b.daemon.artifacts.artifacts().some((view) => view.artifactKey === `dev-a:${A}`),
    );
    expect(b.daemon.artifacts.artifacts()[0]).toMatchObject({
      artifactKey: `dev-a:${A}`,
      availability: "active",
      openable: true,
      editable: false,
    });

    // Same artifactId is legal in another origin slice; the global identity is
    // composite and neither writer overwrites the other.
    await rpcB.call("artifact.publish", {
      artifactId: A,
      title: "B workbench",
      source: { kind: "proxy", port: source.port, scheme: "http" },
    });
    await until(() => b.daemon.artifacts.artifacts().length === 2);
    expect(
      b.daemon.artifacts
        .artifacts()
        .map((view) => view.artifactKey)
        .sort(),
    ).toEqual([`dev-a:${A}`, `dev-b:${A}`]);

    await rpcA.call("artifact.update", { artifactId: A, title: "A renamed" });
    await until(() => lastArtifactSlice(a.mock).artifacts[0]?.title === "A renamed");
    relayArtifacts(a.mock, b.mock, "dev-a");
    await until(
      () =>
        b.daemon.artifacts.artifacts().find((view) => view.artifactKey === `dev-a:${A}`)?.title ===
        "A renamed",
    );

    const closedPort = await new Promise<number>((resolvePort, reject) => {
      const reservation = createServer();
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", () => {
        const address = reservation.address();
        if (address === null || typeof address === "string") {
          reject(new Error("reservation did not bind"));
          return;
        }
        reservation.close(() => resolvePort(address.port));
      });
    });
    await rpcA.call("artifact.update", {
      artifactId: A,
      source: { kind: "proxy", port: closedPort, scheme: "http" },
    });
    await until(
      () => lastArtifactSlice(a.mock).artifacts[0]?.advertisedAvailability === "source-unavailable",
    );
    relayArtifacts(a.mock, b.mock, "dev-a");
    await until(
      () =>
        b.daemon.artifacts.artifacts().find((view) => view.artifactKey === `dev-a:${A}`)
          ?.availability === "source-unavailable",
    );
    expect(
      rpcB.notifications.some(
        (notification) =>
          notification.method === "artifact.delta" &&
          notification.params.subId === subscription.subId,
      ),
    ).toBe(true);

    await rpcA.call("artifact.unpublish", { artifactId: A });
    await until(() => lastArtifactSlice(a.mock).artifacts.length === 0);
    relayArtifacts(a.mock, b.mock, "dev-a");
    await until(
      () => !b.daemon.artifacts.artifacts().some((view) => view.artifactKey === `dev-a:${A}`),
    );
    expect(b.daemon.artifacts.artifacts().map((view) => view.artifactKey)).toEqual([`dev-b:${A}`]);
  }, 30_000);
});
