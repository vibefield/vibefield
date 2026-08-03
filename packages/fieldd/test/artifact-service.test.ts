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
  type ArtifactSource,
  type ArtifactStatus,
  LocalArtifactIntent,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  type ArtifactServeBridge,
  ArtifactService,
  artifactPortCandidate,
  artifactServeId,
  canonicalArtifactServingConfig,
  canonicalJson,
} from "../src/artifact-service";
import { bootstrap } from "../src/index";
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

function service(
  dataDir: string,
  bridge: FakeBridge,
  options: {
    probe?: (source: ArtifactSource) => Promise<boolean>;
    writeIntent?: (path: string, body: string) => void;
  } = {},
): ArtifactService {
  return new ArtifactService({
    dataDir,
    bridge,
    maintenanceMs: false,
    probe: options.probe ?? (async () => true),
    ...(options.writeIntent !== undefined ? { writeIntent: options.writeIntent } : {}),
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
    first.dispose();

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
    first.dispose();

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
    const svc = service(makeDataDir(), bridge, {
      writeIntent: () => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
    });
    await svc.start();
    await expect(svc.publish(proxy())).rejects.toMatchObject({ kind: "INTERNAL" });
    expect(svc.statuses()).toEqual([]);
    expect(svc.health()).toMatchObject({ count: 0, storage: "failed" });
    expect(bridge.last()).toEqual([]);
    expect(bridge.native.size).toBe(0);
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

describe("Artifact Hub over a real daemon", () => {
  async function boot(dataDir: string) {
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
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
    const listed = (await rpc2.call("artifact.list", {})) as { artifacts: ArtifactStatus[] };
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.artifacts[0]).toMatchObject({
      artifactId: A,
      title: "Live app",
      status: "active",
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
});
