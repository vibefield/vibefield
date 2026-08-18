// Scripted mgmt-channel mock (exported at @vibefield/fieldd/testing): lets
// fieldd's own concurrency regressions AND fieldd-client integration tests run
// the full product spine without a cargo build. Speaks just enough of the mgmt
// protocol: hello, *.subscribe → {subId, snapshot}, everything else → {}.
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { isPipeEndpoint, LOG_STREAMS, STORES } from "@vibefield/contracts";

export class MockMgmtServer {
  server: Server | null = null;
  sockets = new Set<Socket>();
  connections = 0;
  failNextHello = false;
  /** subscription methods in this set answer a persistent RPC error */
  rejectedSubscriptions = new Set<string>();
  /** TC-D2 — methods in this set are read and NEVER answered (a wedged floor:
   * transport up, control path silent). */
  silentMethods = new Set<string>();
  /** the boot id the ping ack carries (a changed value simulates a floor that
   * restarted underneath a surviving socket) */
  pingBootId = "mock-native-boot";
  /** when set, subscribe responses are followed by a delta IN THE SAME write */
  deltaInSameChunk = false;
  /** send SUPERSEDED immediately after the next subscribe response */
  supersedeAfterSubscribe = false;
  /** when set, every native.mesh.* call answers UNAVAILABLE (node not up) */
  meshUnavailable = false;
  /** scripted node-side serve state (C2/AH-1 reconcile tests), keyed by serveId */
  meshServes = new Map<
    string,
    {
      serveId: string;
      name: string;
      listenPort: number;
      target: unknown;
      url: string;
      allow?: unknown;
      tls?: unknown;
      previewDir?: unknown;
    }
  >();
  meshAddCalls = 0;
  meshRemoveCalls = 0;
  /** one-shot fault seams for crash-safe artifact reconciliation tests */
  failNextServeAdd = false;
  failNextServeRemove = false;
  /** scripted serve RUNTIME snapshot (C3): the ServeEntry[] answered by
   * native.mesh.serve.subscribe; deltas are pushed with pushServeDelta */
  serveSnapshot: unknown[] = [];
  /** simulate serves living in the node: a dropped daemon loses them */
  clearServesOnDisconnect = false;
  /** Native mesh identity answered by store.get and used for own-slice writes. */
  meshDeviceId = "dev-self";
  /** Scripted device-store state: deviceId → RAW slice data. */
  storeSlices = new Map<string, unknown>([["dev-self", { hello: 1 }]]);
  /** Every field.devices.v1 store.set, in order — C4 compatibility seam. */
  storeWrites: unknown[] = [];
  /** AH-2's independent public catalog store and writes. */
  artifactStoreSlices = new Map<string, unknown>();
  artifactStoreWrites: unknown[] = [];
  /** scripted tailnet peers answered by native.mesh.peers.list (default: none) */
  meshPeers: unknown[] = [];
  /** NF-3 — when set, the hello ack carries these terminal endpoints (NF-D8);
   * null = a floor-less native (pre-NF-2, or the unit degraded). */
  helloTerminal: { controlSocket: string; frameSocket: string; authToken: string } | null = null;
  /** GT-2d — the build label the hello ack carries; null = a floor predating
   * GT-2d, which fieldd must surface as "it did not say", never as a guess. */
  helloNativeBuild: string | null = null;
  /** NF-3 — when set, native.lifecycle.observed.subscribe answers this snapshot
   * (an ObservedState); null falls through to the generic `{n:0}` handler,
   * which the fieldd side must read as "no inventory" (tolerant reader). */
  observedState: unknown = null;
  /** Schema-valid field-native ring used by LOG-L5 product projection tests. */
  diagnosticRecords: unknown[] = [];
  diagnosticLeases = new Map<string, unknown>();
  diagnosticBootId = "mock-native-boot";
  diagnosticCursor = 0;
  private storeVersion = 0;
  private nextSub = 1;
  private issued: Array<{ sock: Socket; subId: string; method: string; storeId?: string }> = [];
  /** Historical subscribe requests, retained across scripted reconnects. */
  readonly subscriptionRequests: string[] = [];

  /** `endpoint` is a WIN-D1 endpoint, resolved by the suite (which owns its data
   * root) — a filesystem path on unix, a `\\.\pipe\…` name on win32. Node's
   * `listen`/`createConnection` speak both from the string alone. */
  constructor(public readonly endpoint: string) {}

  async start(): Promise<void> {
    // Unlink a stale inode from a previous bind — a unix-only act: a named pipe
    // has no filesystem presence for `rmSync` to find, and handing it a
    // `\\.\pipe\…` path asks the disk about a namespace it does not own.
    if (!isPipeEndpoint(this.endpoint)) rmSync(this.endpoint, { force: true });
    this.server = createServer((sock) => this.onConn(sock));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.endpoint, resolve);
    });
  }

  private onConn(sock: Socket): void {
    this.connections += 1;
    this.sockets.add(sock);
    sock.on("close", () => {
      this.sockets.delete(sock);
      this.issued = this.issued.filter((e) => e.sock !== sock);
      if (this.clearServesOnDisconnect) this.meshServes.clear();
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: canonical newline-split loop
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) this.onLine(sock, JSON.parse(line));
      }
    });
    sock.on("error", () => {});
  }

  private onLine(
    sock: Socket,
    msg: { id: number; method: string; params?: Record<string, unknown> },
  ): void {
    // TC-D2 tests — a WEDGED floor: the request is read and never answered
    // (the socket stays open; only the reply is missing, exactly the wedge
    // shape the deadline/heartbeat machinery exists to catch).
    if (this.silentMethods.has(msg.method)) return;
    if (msg.method === "native.lifecycle.ping") {
      sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { bootId: this.pingBootId, ts: Date.now() },
        }) + "\n",
      );
      return;
    }
    if (msg.method.startsWith("native.mesh.")) {
      this.onMesh(sock, msg);
      return;
    }
    if (msg.method === "native.lifecycle.hello") {
      if (this.failNextHello) {
        this.failNextHello = false;
        sock.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32001,
              message: "nope",
              data: { kind: "UNAUTHORIZED", retryable: false },
            },
          }) + "\n",
        );
        sock.end();
        return;
      }
      sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            contractsVersion: "0.1.0",
            serverKind: "field-native",
            grantedScopes: [],
            ...(this.helloNativeBuild !== null ? { nativeBuild: this.helloNativeBuild } : {}),
            ...(this.helloTerminal !== null ? { terminal: this.helloTerminal } : {}),
          },
        }) + "\n",
      );
      return;
    }
    if (msg.method === "native.lifecycle.observed.subscribe" && this.observedState !== null) {
      const subId = `s${this.nextSub++}`;
      this.issued.push({ sock, subId, method: msg.method });
      sock.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { subId, snapshot: this.observedState },
        })}\n`,
      );
      return;
    }
    if (msg.method === "native.diagnostics.query") {
      sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: this.diagnosticSnapshot(),
        }) + "\n",
      );
      return;
    }
    if (msg.method === "native.diagnostics.subscribe") {
      const subId = `s${this.nextSub++}`;
      this.issued.push({ sock, subId, method: msg.method });
      sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { subId, snapshot: this.diagnosticSnapshot() },
        }) + "\n",
      );
      return;
    }
    if (msg.method === "native.diagnostics.lease.create") {
      const lease = msg.params?.["lease"];
      const leaseId =
        typeof lease === "object" && lease !== null && "leaseId" in lease
          ? lease.leaseId
          : undefined;
      if (typeof leaseId === "string") this.diagnosticLeases.set(leaseId, lease);
      sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: lease ?? {} })}\n`);
      return;
    }
    if (msg.method === "native.diagnostics.lease.list") {
      sock.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            v: 1,
            observedAt: Date.now(),
            leases: [...this.diagnosticLeases.values()],
          },
        })}\n`,
      );
      return;
    }
    if (msg.method === "native.diagnostics.lease.revoke") {
      const leaseId = msg.params?.["leaseId"];
      const revoked = typeof leaseId === "string" ? this.diagnosticLeases.delete(leaseId) : false;
      sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { revoked } })}\n`);
      return;
    }
    if (msg.method.endsWith(".subscribe")) {
      this.subscriptionRequests.push(msg.method);
      if (this.rejectedSubscriptions.has(msg.method)) {
        sock.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32601,
              message: "subscription rejected",
              data: { kind: "NOT_FOUND", retryable: false },
            },
          }) + "\n",
        );
        return;
      }
      const subId = `s${this.nextSub++}`;
      this.issued.push({ sock, subId, method: msg.method });
      const resp = JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { subId, snapshot: { n: 0 } },
      });
      if (this.supersedeAfterSubscribe) {
        this.supersedeAfterSubscribe = false;
        const superseded = JSON.stringify({
          jsonrpc: "2.0",
          method: "native.lifecycle.superseded",
          params: { reason: "scripted takeover" },
        });
        sock.write(`${resp}\n${superseded}\n`);
      } else if (this.deltaInSameChunk) {
        const delta = JSON.stringify({
          jsonrpc: "2.0",
          method: msg.method.replace(/\.subscribe$/, ".delta"),
          params: { subId, payload: { n: 1 } },
        });
        sock.write(`${resp}\n${delta}\n`); // ONE write, one chunk — the race repro
      } else {
        sock.write(resp + "\n");
      }
      return;
    }
    sock.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\n");
  }

  private onMesh(
    sock: Socket,
    msg: { id: number; method: string; params?: Record<string, unknown> },
  ): void {
    const reply = (body: object) =>
      sock.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body }) + "\n");
    if (this.meshUnavailable) {
      reply({
        error: {
          code: -32006,
          message: "mesh node not up",
          data: {
            kind: "UNAVAILABLE",
            retryable: true,
            details: { service: "mesh-gateway", state: "starting" },
          },
        },
      });
      return;
    }
    const p = msg.params ?? {};
    switch (msg.method) {
      case "native.mesh.serve.list":
        reply({ result: { serves: [...this.meshServes.values()] } });
        return;
      case "native.mesh.serve.add": {
        this.meshAddCalls += 1;
        if (this.failNextServeAdd) {
          this.failNextServeAdd = false;
          reply({
            error: {
              code: -32000,
              message: "scripted serve add failure",
              data: { kind: "INTERNAL", retryable: true },
            },
          });
          return;
        }
        const name = String(p["name"]);
        const serveId = typeof p["serveId"] === "string" ? p["serveId"] : name;
        const target = p["target"] as { port?: unknown } | undefined;
        const listenPort =
          typeof p["listenPort"] === "number"
            ? p["listenPort"]
            : typeof target?.port === "number"
              ? target.port
              : 0;
        const collision = [...this.meshServes.values()].find(
          (entry) => entry.listenPort === listenPort && entry.serveId !== serveId,
        );
        if (collision !== undefined) {
          reply({
            error: {
              code: -32004,
              message: "listener port already in use",
              data: { kind: "CONFLICT", retryable: true },
            },
          });
          return;
        }
        const scheme = p["tls"] === false ? "http" : "https";
        const entry = {
          serveId,
          name,
          listenPort,
          target: p["target"],
          url: `${scheme}://mock.ts.net:${listenPort}`,
          ...(p["allow"] !== undefined ? { allow: p["allow"] } : {}),
          ...(p["tls"] !== undefined ? { tls: p["tls"] } : {}),
          ...(p["previewDir"] !== undefined ? { previewDir: p["previewDir"] } : {}),
        };
        this.meshServes.set(serveId, entry);
        reply({ result: { ...p, serveId, listenPort, url: entry.url } });
        return;
      }
      case "native.mesh.serve.remove": {
        this.meshRemoveCalls += 1;
        if (this.failNextServeRemove) {
          this.failNextServeRemove = false;
          reply({
            error: {
              code: -32000,
              message: "scripted serve removal failure",
              data: { kind: "INTERNAL", retryable: true },
            },
          });
          return;
        }
        const serveId = String(p["serveId"] ?? p["name"]);
        if (!this.meshServes.delete(serveId)) {
          reply({
            error: {
              code: -32003,
              message: "serve not found",
              data: { kind: "NOT_FOUND", retryable: false },
            },
          });
          return;
        }
        reply({ result: { serveId, removed: true } });
        return;
      }
      case "native.mesh.serve.subscribe": {
        // C3 runtime stream: snapshot is `{serves: FullEntry[]}` (the shape the
        // Rust forwarder sends). The sub is recorded in `issued` so pushServeDelta
        // / pushServeSnapshot can target it (as the generic *.subscribe handler
        // does for the lifecycle stream).
        const subId = `s${this.nextSub++}`;
        this.issued.push({ sock, subId, method: msg.method });
        reply({ result: { subId, snapshot: { serves: [...this.serveSnapshot] } } });
        return;
      }
      case "native.mesh.peers.list":
        reply({ result: { peers: [...this.meshPeers] } });
        return;
      case "native.mesh.store.open": {
        const storeId = String(p["storeId"]);
        reply({ result: this.storeSnapshot(storeId) });
        return;
      }
      case "native.mesh.store.get": {
        const storeId = p["storeId"];
        const deviceId = p["deviceId"];
        if (typeof deviceId === "string") {
          // a specific peer's slice (mesh.rs: {storeId, deviceId, slice}) —
          // shape-faithful, though DeviceService only uses the no-deviceId arm.
          const data = this.storeFor(String(storeId)).get(deviceId);
          reply({
            result: { storeId, deviceId, slice: data === undefined ? null : { data, version: 1 } },
          });
        } else {
          // NO deviceId → the node's OWN mesh identity + local slice. This is
          // how DeviceService discovers its device_id (D30); mesh.rs replies
          // {storeId, deviceId: store.device_id(), data: store.local()}.
          reply({
            result: {
              storeId,
              deviceId: this.meshDeviceId,
              data: this.storeFor(String(storeId)).get(this.meshDeviceId) ?? null,
            },
          });
        }
        return;
      }
      case "native.mesh.store.set": {
        // store.set writes the OWN slice only; mesh.rs replies {storeId, version}.
        const storeId = String(p["storeId"]);
        this.storeFor(storeId).set(this.meshDeviceId, p["data"]);
        if (storeId === STORES.DEVICES) this.storeWrites.push(p["data"]);
        if (storeId === STORES.ARTIFACTS) this.artifactStoreWrites.push(p["data"]);
        reply({ result: { storeId, version: ++this.storeVersion } });
        return;
      }
      case "native.mesh.store.subscribe": {
        const storeId = String(p["storeId"]);
        const subId = `s${this.nextSub++}`;
        this.issued.push({ sock, subId, method: msg.method, storeId });
        reply({ result: { subId, snapshot: this.storeSnapshot(storeId) } });
        return;
      }
      default:
        reply({ result: {} });
    }
  }

  /** Push a delta on every live subscription whose method ends with the suffix. */
  pushDelta(methodSuffix: string, payload: unknown, storeId?: string): void {
    for (const e of this.issued) {
      if (
        !e.method.endsWith(methodSuffix) ||
        e.sock.destroyed ||
        (storeId !== undefined && e.storeId !== storeId)
      )
        continue;
      e.sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: e.method.replace(/\.subscribe$/, ".delta"),
          params: { subId: e.subId, payload },
        }) + "\n",
      );
    }
  }

  /** NF-3 — push a fresh ObservedState to every observed subscription. */
  pushObserved(state: unknown): void {
    this.observedState = state;
    this.pushDelta("lifecycle.observed.subscribe", state);
  }

  pushDiagnosticRecord(record: unknown): void {
    this.diagnosticCursor += 1;
    this.diagnosticRecords.push(record);
    if (this.diagnosticRecords.length > 1_000) this.diagnosticRecords.shift();
    this.pushDelta("diagnostics.subscribe", {
      v: 1,
      cursor: `native:${this.diagnosticBootId}:${this.diagnosticCursor}`,
      records: [record],
      droppedSincePrevious: 0,
    });
  }

  pushDiagnosticSnapshot(): void {
    for (const entry of this.issued) {
      if (!entry.method.endsWith("diagnostics.subscribe") || entry.sock.destroyed) continue;
      entry.sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "native.diagnostics.snapshot",
          params: { subId: entry.subId, payload: this.diagnosticSnapshot() },
        }) + "\n",
      );
    }
  }

  /** Push a serve runtime delta — a PARTIAL entry {serveId, status, url?, error?}
   * (native.mesh.serve.subscribe → native.mesh.serve.delta). */
  pushServeDelta(entry: unknown): void {
    this.pushDelta("mesh.serve.subscribe", entry);
  }

  /** Push a FULL serve re-snapshot (the broadcast-lag path) as a
   * native.mesh.serve.snapshot notification — NativeLink routes `.snapshot`
   * notifications to the subscription callback with kind "snapshot". */
  pushServeSnapshot(serves: unknown[]): void {
    for (const e of this.issued) {
      if (!e.method.endsWith("mesh.serve.subscribe") || e.sock.destroyed) continue;
      e.sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "native.mesh.serve.snapshot",
          params: { subId: e.subId, payload: { serves } },
        }) + "\n",
      );
    }
  }

  /** Push a store delta on every live store subscription (mirrors mesh.rs
   * spawn_store_forwarder). Payload kinds: {kind:"peerUpdated", deviceId, data,
   * version} / {kind:"peerRemoved", deviceId} / {kind:"localChanged", deviceId,
   * data}. Routed native.mesh.store.subscribe → native.mesh.store.delta. */
  pushStoreDelta(payload: unknown, storeId: string = STORES.DEVICES): void {
    this.pushDelta("mesh.store.subscribe", payload, storeId);
  }

  pushArtifactStoreDelta(payload: unknown): void {
    this.pushStoreDelta(payload, STORES.ARTIFACTS);
  }

  /** Push a wholesale store re-snapshot (broadcast-lag path) as a
   * native.mesh.store.snapshot notification. `slices` is deviceId → RAW data;
   * each is wrapped {data, version} to match store_snapshot. */
  pushStoreSnapshot(slices: Record<string, unknown>, storeId: string = STORES.DEVICES): void {
    const wrapped: Record<string, unknown> = {};
    for (const [dev, data] of Object.entries(slices)) wrapped[dev] = { data, version: 1 };
    for (const e of this.issued) {
      if (!e.method.endsWith("mesh.store.subscribe") || e.sock.destroyed || e.storeId !== storeId)
        continue;
      e.sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "native.mesh.store.snapshot",
          params: { subId: e.subId, payload: { storeId, slices: wrapped } },
        }) + "\n",
      );
    }
  }

  /** SyncedStore snapshot shape (mesh.rs store_snapshot): {storeId, slices},
   * each slice wrapped {data, version} from the raw storeSlices map. */
  private storeSnapshot(storeId: string): { storeId: string; slices: Record<string, unknown> } {
    const slices: Record<string, unknown> = {};
    for (const [dev, data] of this.storeFor(storeId)) slices[dev] = { data, version: 1 };
    return { storeId, slices };
  }

  private storeFor(storeId: string): Map<string, unknown> {
    return storeId === STORES.ARTIFACTS ? this.artifactStoreSlices : this.storeSlices;
  }

  private diagnosticSnapshot(): unknown {
    const zeroBuffer = {
      records: 0,
      bytes: 0,
      highWaterRecords: 0,
      highWaterBytes: 0,
      capacityRecords: 2_000,
      capacityBytes: 2 * 1024 * 1024,
    };
    const producer = {
      producerId: `field-native:${this.diagnosticBootId}`,
      service: "field-native",
      stream: LOG_STREAMS.SYSTEM_FIELD_NATIVE,
      bootId: this.diagnosticBootId,
      instanceId: this.diagnosticBootId,
      oldestCursor:
        this.diagnosticRecords.length === 0
          ? this.diagnosticCursor
          : Math.max(0, this.diagnosticCursor - this.diagnosticRecords.length + 1),
      newestCursor: this.diagnosticCursor,
      droppedBefore: 0,
      health: {
        v: 1,
        stream: LOG_STREAMS.SYSTEM_FIELD_NATIVE,
        service: "field-native",
        bootId: this.diagnosticBootId,
        instanceId: this.diagnosticBootId,
        writerState: "healthy",
        currentLevel: this.diagnosticLeases.size > 0 ? "debug" : "info",
        activeLeaseCount: this.diagnosticLeases.size,
        activeSegmentBytes: 0,
        queue: { ...zeroBuffer, capacityRecords: 8_192, capacityBytes: 8 * 1024 * 1024 },
        ring: { ...zeroBuffer, records: this.diagnosticRecords.length },
        counters: {
          accepted: this.diagnosticCursor,
          rejected: 0,
          truncated: 0,
          droppedTrace: 0,
          droppedDebug: 0,
          droppedInfo: 0,
          droppedWarn: 0,
          droppedError: 0,
          bytesWritten: 0,
          rotations: 0,
          cleanupDeletions: 0,
          emergencyFallbacks: 0,
        },
      },
    };
    return {
      v: 1,
      producers: [producer],
      records: [...this.diagnosticRecords],
      nextCursor: `native:${this.diagnosticBootId}:${this.diagnosticCursor}`,
      droppedBefore: 0,
    };
  }

  killClients(): void {
    for (const s of this.sockets) s.destroy();
  }

  async stop(): Promise<void> {
    this.killClients();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }
}
