// Scripted mgmt-channel mock (exported at @vibefield/fieldd/testing): lets
// fieldd's own concurrency regressions AND fieldd-client integration tests run
// the full product spine without a cargo build. Speaks just enough of the mgmt
// protocol: hello, *.subscribe → {subId, snapshot}, everything else → {}.
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { isPipeEndpoint, LOG_STREAMS, STORES } from "@vibefield/contracts";
import { computeAckMac } from "../pairing";

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
  /** UA-P-0j — the floor's mesh POSTURE, modelled only for a suite that opts
   * in; `undefined` (the default) keeps the scripted node every older row
   * expects. `null` is a floor holding NO posture — the real floor's boot
   * default, so a respawn is `meshPosture = null` plus `killClients()` — and
   * then every `native.mesh.*` call but `start` answers UNAVAILABLE with the
   * real floor's word for it, `disabled`. `native.mesh.start` records what it
   * was asked for, and `native.mesh.self` answers as that node. */
  meshPosture: { mode: string; login?: string } | null | undefined = undefined;
  /** Every `native.mesh.start` this floor was asked, with its params, in order. */
  readonly meshStarts: Array<Record<string, unknown>> = [];
  /** UA-P-0k — the real floor answers `native.mesh.self` from its AGGREGATED
   * health, which its own task refreshes after `start` has set the unit
   * (field-native `lib.rs` `health_refresh`), so the boot default can outlive
   * the `start` that ended it. With `meshPosture` opted in, this many
   * `native.mesh.self` calls after a `start` from NO posture still answer
   * `disabled`; `meshStaleAnswers` counts the ones given. */
  meshHealthLag = 0;
  meshStaleAnswers = 0;
  private meshStaleLeft = 0;
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
  /** TM-2 — every serve.add's FULL params, in order. `meshServes` projects a
   * serve the way `serve.list` does (which deliberately omits routes), so a
   * test that asserts WHAT WAS DECLARED — the cell prefixes, their loopback
   * targets, the allow gate — has to read the request, not the projection. */
  readonly meshAddParams: Array<Record<string, unknown>> = [];
  /** TM-2 — every serve.remove's serveId, in order: the remove-then-add dance
   * a route change costs is only visible as a SEQUENCE. */
  readonly meshRemovedServeIds: string[] = [];
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
  /** TC-D15 (TC-S2) — when set, the hello ack carries this route snapshot AND
   * native.lifecycle.terminal.routes.subscribe answers it; null = a pre-TC-S2
   * floor, which says neither (and whose routes subscribe falls through to the
   * generic `{n:0}` handler — the payload fieldd must read as "not a snapshot",
   * tolerantly, rather than as a floor with no cells). Set it beside
   * `helloTerminal`, the legacy mirror a real floor keeps in lockstep. */
  terminalRoutes: unknown = null;
  /** MF-2i — what the ROUTES SUBSCRIPTION answers when it must DIFFER from the
   * hello's `terminalRoutes`. `undefined` (the default) is the lockstep a
   * well-formed floor keeps: the subscription answers exactly what the ack
   * carried. Set it to script the floor that predates the disclosure rule —
   * the mesh-flagged in-process serve QA met on 2026-09-13, whose hello
   * withheld its unrevised snapshot (and supplied `helloTerminal` instead)
   * while its subscription answered `{revision: 0, cells: []}` anyway. */
  routesSubscribeSnapshot: unknown = undefined;
  /** TM-1 (MF-1l) — the floor's word that its terminal doors are PUBLISHED on
   * the tailnet, carried on the hello ack. `null` = a floor that predates the
   * field and says nothing, which every consumer must read as NO (a tappable
   * card for a session nothing can attach to is the failure it prevents). */
  helloTerminalMesh: boolean | null = null;
  /** GT-2d — the build label the hello ack carries; null = a floor predating
   * GT-2d, which fieldd must surface as "it did not say", never as a guess. */
  helloNativeBuild: string | null = null;
  /** WIN-10 — the secret this mock proves possession of. Every suite writes
   * "ab" x 32 as its pairing file, so that is the default; a test with a
   * different file must set this to match or the client will refuse it. */
  pairingSecretHex = "ab".repeat(32);
  /** WIN-10 — set false to answer WITHOUT a proof, i.e. to impersonate a
   * pre-WIN-10 field-native (or a squatter that simply omits it). The client
   * must refuse: accepting absence is the downgrade the nonce exists to stop. */
  proveServerIdentity = true;
  /** WIN-10 — answer with THIS proof instead of the correct one: a squatter
   * that holds the endpoint but not the pairing secret. */
  forgedServerMac: string | null = null;
  /** NF-3 — when set, native.lifecycle.observed.subscribe answers this snapshot
   * (an ObservedState); null falls through to the generic `{n:0}` handler,
   * which the fieldd side must read as "no inventory" (tolerant reader). */
  observedState: unknown = null;
  // RETIRED 2026-09-14 (TM-3): `mirrorWriteCapability` and `mirrorWriteAsks`,
  // the scripted MF-2a floor secret and the ask counter that proved the grant
  // door never cached it. The verb they answered is deleted on the floor.
  /** MF-1 — the agent-field slices written into `field.agents.v1`, in order. */
  readonly agentFieldWrites: unknown[] = [];
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
  /** Every `native.mesh.*` method asked of this floor, in order — the facade's
   * own log, since it is dispatched ahead of the generic subscribe recorder
   * above. UA-P-0a needs it: a desktop with no account declares NO serve, so
   * "the reconcile ran" can no longer be inferred from a serve appearing. */
  readonly meshCalls: string[] = [];
  /** UA-P-0f — every `native.mesh.lane.open` this floor was asked for, in
   * order. The outbound half of "documents sync only within one account" is a
   * decision about WHICH PEERS get a lane, so the witness is the list of lanes
   * asked for, not the bytes on them. */
  readonly meshLaneOpens: Array<{ peer: string; protocol: string; docId?: string }> = [];

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
      // WIN-10 — answer the client's challenge, exactly as field-native does:
      // a client that offered a nonce REFUSES an ack without a valid proof, so
      // a mock that skipped this would fail every pairing in the suite. The
      // three knobs below let a test drive the refusal paths deliberately.
      const cred = (msg.params ?? {}) as { credential?: { bootId?: unknown; nonce?: unknown } };
      const nonce = cred.credential?.nonce;
      const bootId = cred.credential?.bootId;
      let serverMac: string | undefined;
      if (this.proveServerIdentity && typeof nonce === "string" && typeof bootId === "string") {
        serverMac = this.forgedServerMac ?? computeAckMac(this.pairingSecretHex, nonce, bootId);
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
            ...(this.helloTerminalMesh !== null ? { terminalMesh: this.helloTerminalMesh } : {}),
            ...(this.helloTerminal !== null ? { terminal: this.helloTerminal } : {}),
            ...(this.terminalRoutes !== null ? { terminalRoutes: this.terminalRoutes } : {}),
            ...(serverMac !== undefined ? { serverMac } : {}),
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
    if (msg.method === "native.lifecycle.terminal.routes.subscribe") {
      const snapshot =
        this.routesSubscribeSnapshot !== undefined
          ? this.routesSubscribeSnapshot
          : this.terminalRoutes;
      // A floor that says nothing at all still falls through to the generic
      // `{n:0}` handler — the pre-TC-S2 payload fieldd must read tolerantly.
      if (snapshot !== null) {
        // Recorded like every other subscribe, so a test can assert the stream
        // was armed (and re-armed) rather than infer it from a payload.
        this.subscriptionRequests.push(msg.method);
        const subId = `s${this.nextSub++}`;
        this.issued.push({ sock, subId, method: msg.method });
        sock.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { subId, snapshot },
          })}\n`,
        );
        return;
      }
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
    // Recorded before anything is decided about the call, `meshUnavailable`
    // included: a test asking "did fieldd get that far?" wants the ASK, not the
    // answer. (`subscriptionRequests` never sees these — the mesh facade is
    // dispatched ahead of the generic `*.subscribe` recorder.)
    this.meshCalls.push(msg.method);
    if (msg.method === "native.mesh.lane.open") {
      const p = msg.params ?? {};
      this.meshLaneOpens.push({
        peer: String(p["peer"]),
        protocol: String(p["protocol"]),
        ...(typeof p["docId"] === "string" ? { docId: p["docId"] } : {}),
      });
    }
    const reply = (body: object) =>
      sock.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body }) + "\n");
    const notUp = (state: string) =>
      reply({
        error: {
          code: -32006,
          message: "mesh node not up",
          data: {
            kind: "UNAVAILABLE",
            retryable: true,
            details: { service: "mesh-gateway", state },
          },
        },
      });
    if (msg.method === "native.mesh.start") this.meshStarts.push({ ...(msg.params ?? {}) });
    if (this.meshPosture !== undefined) {
      const p = msg.params ?? {};
      if (msg.method === "native.mesh.start") {
        const mode = String(p["mode"]);
        if (this.meshPosture === null) this.meshStaleLeft = this.meshHealthLag;
        this.meshPosture = {
          mode,
          ...(typeof p["login"] === "string" ? { login: p["login"] } : {}),
        };
        reply({ result: { mode, started: true } });
        return;
      }
      if (msg.method === "native.mesh.self" && this.meshStaleLeft > 0) {
        this.meshStaleLeft -= 1;
        this.meshStaleAnswers += 1;
        // its own write, after the `start` answer — as the floor's writer task
        // sends them — so the client has settled the ask before this arrives
        setTimeout(() => {
          if (!sock.destroyed) notUp("disabled");
        }, 10);
        return;
      }
      if (this.meshPosture === null) {
        notUp("disabled");
        return;
      }
      if (msg.method === "native.mesh.self") {
        const login = this.meshPosture.login;
        reply({
          result: {
            deviceId: "mock-device",
            ...(login !== undefined ? { login } : {}),
            loginAllow: login !== undefined && this.meshPosture.mode === "linked" ? [login] : [],
          },
        });
        return;
      }
    }
    if (this.meshUnavailable) {
      notUp("starting");
      return;
    }
    const p = msg.params ?? {};
    switch (msg.method) {
      case "native.mesh.serve.list":
        reply({ result: { serves: [...this.meshServes.values()] } });
        return;
      case "native.mesh.serve.add": {
        this.meshAddCalls += 1;
        this.meshAddParams.push({ ...p });
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
        this.meshRemovedServeIds.push(serveId);
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
      case "native.mesh.peers.subscribe": {
        // UA-P-0e — the peer registry's stream. Recorded in `issued` like every
        // other subscription so `pushPeersDelta` can target it; the snapshot is
        // the same list `peers.list` answers with, which is what the real
        // forwarder sends.
        const subId = `s${this.nextSub++}`;
        this.issued.push({ sock, subId, method: msg.method });
        reply({ result: { subId, snapshot: { peers: [...this.meshPeers] } } });
        return;
      }
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
        // MF-1 — every agent-field slice this daemon published, in order: the
        // witness that the DAEMON wired its publisher (the publisher's own
        // suite builds one by hand and can say nothing about the wiring).
        if (storeId === STORES.AGENT_FIELD) this.agentFieldWrites.push(p["data"]);
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

  /** TC-D15 — push a FULL route snapshot as a delta (state transfer, never
   * edges: a delta on this stream IS a whole snapshot). The stored snapshot
   * moves with it, so a reconnect re-reads the state this pushed rather than
   * the one the floor started with — which is what a real floor does. */
  pushRoutesDelta(snapshot: unknown): void {
    this.terminalRoutes = snapshot;
    this.pushDelta("terminal.routes.subscribe", snapshot);
  }

  /** E-F1 — the floor's node arriving AFTER the hello, scripted.
   *
   * A real floor answers `HelloAck.terminalMesh` at a moment it is predictably
   * false (its mesh node is installed by a spawned bring-up task that returns
   * before the node exists) and then pushes the correction on the routes
   * stream, because nothing re-hellos. This is that push: the CURRENT snapshot,
   * unchanged and at its existing revision, under a new boolean — which is
   * exactly what the floor emits, and what a reader keyed only on `revision`
   * would silently drop. */
  pushTerminalMeshPublished(published: boolean): void {
    const snapshot = (this.terminalRoutes ?? { revision: 1, cells: [] }) as Record<string, unknown>;
    this.pushRoutesDelta({ ...snapshot, terminalMesh: published });
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
  /** UA-P-0e — push a peer-registry delta to every live peers subscription.
   * `meshPeers` is the list a subsequent `peers.list` answers with; set it
   * first, then push, the way a real registry moves. */
  pushPeersDelta(payload: unknown): void {
    this.pushDelta("mesh.peers.subscribe", payload);
  }

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
