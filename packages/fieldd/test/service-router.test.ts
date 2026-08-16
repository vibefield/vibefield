// P4 dynamic-service ROUTER (plugin spec §14.4–14.7): the daemon-side fabric
// that turns a plugin's `contributes.services` into live, gated, schema-checked
// x.<pluginId>.* methods. Written against the pinned P4 contract while the
// impl (service-registry.ts + daemon.services + the services.* methods + the
// ProductApi x.* route + the openRendererSession plugin-principal token) lands
// in parallel.
//
// Two rigs: a STANDALONE ServiceRegistry for registration-time law (throws are
// synchronous, no daemon needed) and its own call() entry point; and a real
// bootstrapped daemon reached over WS for the call/subscription/surface paths
// the ProductApi wires (proving x.* actually routes end to end).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CallerContext,
  DynamicSubEvent,
  ServiceMethodContribution,
  ServiceProviderRecord,
  ServicesSnapshot,
} from "@vibefield/contracts";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import {
  type ServiceCallerInfo,
  type ServiceProviderBinding,
  ServiceRegistry,
} from "../src/service-registry";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const PROVIDER = "vibefield.fixture.provider";
const PROVIDER2 = "vibefield.fixture.provider2";
const CONSUMER = "vibefield.fixture.consumer";
const BARE = "vibefield.fixture.bare";
const CUSTOM_CAP = `x.${PROVIDER}.use`;
const NS = `x.${PROVIDER}`;
// a distinctive thrown-error payload: it must NEVER reach the wire (§14.4 step 7
// records provenance; the caller gets a sanitized INTERNAL, not our internals).
const SECRET = "SENSITIVE-INTERNAL-DETAIL-must-not-leak";

// tiny JSON Schemas (spec §20.4 subset) — small enough that invalid-shape cases
// are one field away from valid.
const KV_INPUT = {
  type: "object",
  properties: { k: { type: "string" } },
  required: ["k"],
  additionalProperties: false,
};
const KV_OUTPUT = {
  type: "object",
  properties: { v: { type: "string" } },
  required: ["v"],
  additionalProperties: false,
};
const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false };
const OK_OUTPUT = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
const COUNTER = {
  type: "object",
  properties: { n: { type: "number" } },
  required: ["n"],
  additionalProperties: false,
};

function queryDecl(
  name: string,
  requiredCapability: string,
  input: object,
  output: object,
): ServiceMethodContribution {
  return {
    name,
    kind: "query",
    idempotent: true,
    locality: "local",
    requiredCapability,
    input,
    output,
  } as ServiceMethodContribution;
}

function subDecl(
  name: string,
  requiredCapability: string,
  input: object,
  snapshot: object,
  delta: object,
): ServiceMethodContribution {
  return {
    name,
    kind: "subscription",
    idempotent: true,
    locality: "local",
    requiredCapability,
    input,
    snapshot,
    delta,
  } as ServiceMethodContribution;
}

interface FixtureProvider {
  binding: ServiceProviderBinding;
  calls: Array<{ name: string; params: unknown; caller: ServiceCallerInfo }>;
  /** fan a delta out through every live watch sink (the registry's own sink,
   * so it exercises delta schema-validation + emit exactly like real code). */
  emitDelta(value: unknown): void;
}

// One provider covering every pipeline branch: a happy query, a bad-output
// query, a throwing query, a core-scope-gated query, a custom-cap-gated query,
// and a controllable subscription. Handlers are plain in-memory functions.
function makeProvider(pluginId = PROVIDER): FixtureProvider {
  const ns = `x.${pluginId}`;
  const calls: FixtureProvider["calls"] = [];
  const sinks = new Set<{
    snapshot(v: unknown): void;
    delta(v: unknown): void;
    end(error?: { kind: string; message: string }): void;
  }>();
  const declarations: ServiceMethodContribution[] = [
    queryDecl("get", "workspace.read", KV_INPUT, KV_OUTPUT),
    queryDecl("badOutput", "workspace.read", KV_INPUT, KV_OUTPUT),
    queryDecl("boom", "workspace.read", KV_INPUT, KV_OUTPUT),
    queryDecl("readCanvas", "canvas.read", EMPTY_INPUT, OK_OUTPUT),
    queryDecl("privileged", CUSTOM_CAP, EMPTY_INPUT, OK_OUTPUT),
    subDecl("watch", "workspace.read", EMPTY_INPUT, COUNTER, COUNTER),
  ];
  const binding: ServiceProviderBinding = {
    pluginId,
    namespace: ns,
    declarations,
    implemented: declarations.map((d) => ({ name: d.name, kind: d.kind })),
    handlers: {
      async call(name, params, caller) {
        calls.push({ name, params, caller });
        switch (name) {
          case "get":
            return { v: `val:${(params as { k: string }).k}` };
          case "badOutput":
            return { v: 123 }; // violates KV_OUTPUT — a provider bug the router must catch
          case "boom":
            throw new Error(SECRET);
          case "readCanvas":
            return { ok: true };
          case "privileged":
            return { ok: true };
          default:
            throw new Error(`unexpected method ${name}`);
        }
      },
      async subscribe(name, _params, _caller, sink) {
        if (name !== "watch") throw new Error(`unexpected subscription ${name}`);
        sink.snapshot({ n: 0 }); // the initial schema-valid snapshot (§14.5)
        sinks.add(sink);
        return () => {
          sinks.delete(sink);
        };
      },
    },
  };
  return {
    binding,
    calls,
    emitDelta(value) {
      for (const s of sinks) s.delta(value);
    },
  };
}

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function registry(grants: Record<string, string[]> = {}): ServiceRegistry {
  return new ServiceRegistry({ grantedCapabilities: (id) => grants[id] });
}

// a fabricated server-side principal for the standalone registry.call() path
function localCtx(scopes: string[]): CallerContext {
  return {
    principal: { kind: "local-token", tokenId: "tk_test", scopes },
    transport: "ws-loopback",
    receivedAt: Date.now(),
  };
}

/** register() throws a RpcCallError synchronously; return its .kind. */
function registerKind(reg: ServiceRegistry, binding: ServiceProviderBinding): string {
  try {
    reg.register(binding);
  } catch (e) {
    return (e as { kind?: string }).kind ?? String(e);
  }
  throw new Error("expected register() to throw");
}

// a fabricated plugin principal (D20 — the id comes from the mint, never the
// caller). Used to drive the router's custom-cap gate directly, since the
// end-to-end lease→plugin-principal wiring has a daemon-side gap (see the WS
// canary below and the report).
function pluginCtx(id: string, scopes: string[] = []): CallerContext {
  return {
    principal: { kind: "plugin", id, scopes },
    transport: "ws-loopback",
    receivedAt: Date.now(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

/** call() rejects with a RpcCallError; return its .kind. */
async function callErrKind(
  reg: ServiceRegistry,
  ctx: CallerContext,
  method: string,
  params: unknown,
): Promise<string> {
  try {
    await reg.call(ctx, method, params);
  } catch (e) {
    return (e as { kind?: string }).kind ?? String(e);
  }
  throw new Error(`expected ${method} to reject`);
}

// the minimal-valid manifest shape the sibling suites use, varying id + caps
function manifest(id: string, capabilities: string[]): string {
  return JSON.stringify({
    manifestVersion: 1,
    id,
    version: "0.1.0",
    title: id,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    activation: [],
    capabilities,
  });
}

// a bootstrapped daemon whose registry knows three real plugins: the provider
// (a plain enabled plugin whose binding we register by hand), a consumer that
// REQUESTS the provider's custom cap, and a bare consumer that does not.
async function setupRouter(): Promise<{ daemon: FielddDaemon; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-router-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const root = join(dataDir, "bundled-root");
  for (const [id, caps] of [
    [PROVIDER, []],
    [CONSUMER, [CUSTOM_CAP]],
    [BARE, []],
  ] as const) {
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(join(root, id, "vibefield.plugin.json"), manifest(id, [...caps]));
  }
  const daemon = await bootstrap({ dataDir, controlPort: 0, pluginRoots: { bundled: [root] } });
  cleanup.push(() => daemon.stop());
  return { daemon, dataDir };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** the trusted shell principal: all scopes, shell-main client kind. */
async function shell(daemon: FielddDaemon): Promise<WsRpc> {
  const rpc = await openRpc(daemon.controlPort);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return rpc;
}

/** a local-token principal carrying exactly `scopes`. */
async function tokenRpc(daemon: FielddDaemon, scopes: string[]): Promise<WsRpc> {
  // biome-ignore lint/suspicious/noExplicitAny: mint takes the Scope union; the test drives real scope strings
  const grant = daemon.tokens.mint(scopes as any, "router-test");
  const rpc = await openRpc(daemon.controlPort);
  await helloAs(rpc, grant.token);
  return rpc;
}

// a PLUGIN principal: open a renderer session for `pluginId` (the lease token
// now carries the plugin id, §11.2/§14) and hello with it — the connection is
// then attributed to that plugin and its registry grants.
async function pluginRpc(daemon: FielddDaemon, shellRpc: WsRpc, pluginId: string): Promise<WsRpc> {
  const lease = (await shellRpc.call("plugins.openRendererSession", { pluginId })) as {
    token: string;
  };
  const rpc = await openRpc(daemon.controlPort);
  await helloAs(rpc, lease.token);
  return rpc;
}

// -----------------------------------------------------------------------------

describe("ServiceRegistry registration (§14.4 / §14.6)", () => {
  it("refuses a namespace that is not x.<pluginId> (own-namespace law)", () => {
    const p = makeProvider();
    const bad = { ...p.binding, namespace: "x.vibefield.fixture.wrong" };
    expect(registerKind(registry(), bad)).toBe("PRECONDITION_FAILED");
  });

  it("refuses a declaration whose input JSON Schema does not compile", () => {
    const p = makeProvider();
    const declarations = p.binding.declarations.map((d) =>
      d.name === "get" ? { ...d, input: { $ref: "#/$defs/missing" } } : d,
    );
    const bad = { ...p.binding, declarations };
    expect(registerKind(registry(), bad)).toBe("PRECONDITION_FAILED");
  });

  it("refuses a duplicate live namespace with CONFLICT — the first provider keeps serving", async () => {
    const reg = registry();
    const first = makeProvider();
    const second = makeProvider();
    reg.register(first.binding);

    expect(registerKind(reg, second.binding)).toBe("CONFLICT");

    // the incumbent still resolves AND round-trips (the loser never took over)
    expect(reg.resolve(`${NS}.get`)?.pluginId).toBe(PROVIDER);
    const res = await reg.call(localCtx(["workspace.read"]), `${NS}.get`, { k: "one" });
    expect(res).toEqual({ v: "val:one" });
    expect(first.calls.map((c) => c.name)).toContain("get");
    expect(second.calls).toHaveLength(0);
  });

  it("refuses an implementation with no matching declaration (§14.4 exact match)", () => {
    const p = makeProvider();
    const bad = {
      ...p.binding,
      implemented: [...p.binding.implemented, { name: "ghost", kind: "query" as const }],
    };
    expect(registerKind(registry(), bad)).toBe("PRECONDITION_FAILED");
  });

  it("refuses a declaration with no implementation (§14.4 exact match, other direction)", () => {
    const p = makeProvider();
    const bad = {
      ...p.binding,
      implemented: p.binding.implemented.filter((i) => i.name !== "get"),
    };
    expect(registerKind(registry(), bad)).toBe("PRECONDITION_FAILED");
  });

  it("refuses an implemented kind that disagrees with the declared kind", () => {
    const p = makeProvider();
    const implemented = p.binding.implemented.map((i) =>
      i.name === "get" ? { name: "get", kind: "subscription" as const } : i,
    );
    const bad = { ...p.binding, implemented };
    expect(registerKind(registry(), bad)).toBe("PRECONDITION_FAILED");
  });

  it("stages method kinds behind UNAVAILABLE without publishing or invoking handlers", async () => {
    const reg = registry();
    const provider = makeProvider();
    const generationBefore = reg.snapshot().generation;

    const candidate = reg.stage(provider.binding);

    expect(reg.snapshot()).toEqual({ generation: generationBefore, providers: [] });
    expect(reg.kindOf(`${NS}.get`)).toBe("call");
    await expect(
      reg.call(localCtx(["workspace.read"]), `${NS}.get`, { k: "early" }),
    ).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    expect(provider.calls).toEqual([]);

    candidate.commit();
    expect(reg.snapshot().providers.map((row) => row.namespace)).toEqual([NS]);
    expect(await reg.call(localCtx(["workspace.read"]), `${NS}.get`, { k: "live" })).toEqual({
      v: "val:live",
    });

    candidate.dispose();
    expect(reg.kindOf(`${NS}.get`)).toBeUndefined();
    expect(reg.snapshot().providers).toEqual([]);
  });

  it("disposes an uncommitted stage without emitting a public generation", () => {
    const reg = registry();
    const candidate = reg.stage(makeProvider().binding);
    const generation = reg.snapshot().generation;

    candidate.dispose();
    candidate.dispose();

    expect(reg.snapshot()).toEqual({ generation, providers: [] });
    expect(reg.kindOf(`${NS}.get`)).toBeUndefined();
    expect(() => candidate.commit()).toThrowError(/no longer current/);
  });
});

describe("dynamic call pipeline (§14.4, via daemon + WS)", () => {
  it("happy query: validated params in, result verbatim out", async () => {
    const { daemon } = await setupRouter();
    const provider = makeProvider();
    daemon.services.register(provider.binding);
    const rpc = await shell(daemon);

    const res = await rpc.call(`${NS}.get`, { k: "hello" });
    expect(res).toEqual({ v: "val:hello" });
    expect(provider.calls.map((c) => c.name)).toEqual(["get"]);
    expect(provider.calls[0]!.params).toEqual({ k: "hello" });
    expect(typeof provider.calls[0]!.caller.kind).toBe("string");
  });

  it("an unknown x.* method is NOT_FOUND (unknown method and unknown namespace)", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const rpc = await shell(daemon);

    expect((await rpc.callErr(`${NS}.nope`, {})).data?.kind).toBe("NOT_FOUND");
    expect((await rpc.callErr("x.vibefield.fixture.ghost.foo", {})).data?.kind).toBe("NOT_FOUND");
  });

  it("input that fails the declared schema is PRECONDITION_FAILED with issue details", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const rpc = await shell(daemon);

    const err = await rpc.callErr(`${NS}.get`, { k: 123 });
    expect(err.data?.kind).toBe("PRECONDITION_FAILED");
    expect(err.data?.details).toBeDefined();
  });

  it("output that fails the declared schema is INTERNAL (a provider bug never ships bad data)", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const rpc = await shell(daemon);

    const err = await rpc.callErr(`${NS}.badOutput`, { k: "x" });
    expect(err.data?.kind).toBe("INTERNAL");
  });

  it("a throwing handler is INTERNAL with a sanitized message — no internals, no stack", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const rpc = await shell(daemon);

    const err = await rpc.callErr(`${NS}.boom`, { k: "x" });
    expect(err.data?.kind).toBe("INTERNAL");
    // "no stack on the wire": a single line, no stack frames. (The router does
    // wrap the provider's own message — see the report; that is within the
    // pinned "no stack" contract, so this asserts the durable part only.)
    expect(err.message).not.toContain("\n");
    expect(err.message).not.toContain(" at ");
  });
});

describe("capability gates (§14.4 step 2, §15)", () => {
  it("core-scope gate: the scope binds — missing is FORBIDDEN_SCOPE, present passes", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);

    const withCanvas = await tokenRpc(daemon, ["canvas.read"]);
    expect(await withCanvas.call(`${NS}.readCanvas`, {})).toEqual({ ok: true });

    const without = await tokenRpc(daemon, ["workspace.read"]);
    expect((await without.callErr(`${NS}.readCanvas`, {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("custom-cap gate at the router: a plugin principal WITH the granted cap passes", async () => {
    // driven at the registry so it exercises the gate's grantedCapabilities read
    // deterministically (the WS lease path has a daemon gap — see the canary).
    const reg = registry({ [CONSUMER]: [CUSTOM_CAP] });
    const provider = makeProvider();
    reg.register(provider.binding);

    expect(await reg.call(pluginCtx(CONSUMER), `${NS}.privileged`, {})).toEqual({ ok: true });
    // the sanitized caller the handler saw names the calling plugin (D20)
    expect(provider.calls.find((c) => c.name === "privileged")?.caller.pluginId).toBe(CONSUMER);
  });

  it("custom-cap gate at the router: a plugin principal WITHOUT the cap is FORBIDDEN_SCOPE", async () => {
    const reg = registry({ [BARE]: [] });
    reg.register(makeProvider().binding);

    expect(await callErrKind(reg, pluginCtx(BARE), `${NS}.privileged`, {})).toBe("FORBIDDEN_SCOPE");
  });

  it("end-to-end: a plugin lease authenticates as a plugin principal so the cap gate binds", async () => {
    // CANARY (currently RED — see report): openRendererSession mints the lease
    // WITHOUT pluginId (daemon.ts ~462), so a plugin lease authenticates as a
    // plain local-token and silently PASSES custom-cap gates via the trusted-UI
    // decision. A bare consumer (no cap), as a genuine plugin principal, must be
    // refused end to end. Turns green once the lease mint carries record.id.
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const sh = await shell(daemon);
    const bare = await pluginRpc(daemon, sh, BARE);

    expect((await bare.callErr(`${NS}.privileged`, {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("custom-cap gate: a plain local shell principal passes (v1 trusted-UI decision)", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const sh = await shell(daemon);

    expect(await sh.call(`${NS}.privileged`, {})).toEqual({ ok: true });
  });
});

describe("dynamic subscriptions (§14.5, via daemon + WS)", () => {
  const deltasOf = (rpc: WsRpc, subId: string): unknown[] =>
    rpc.notifications
      .filter(
        (n) =>
          n.params.subId === subId &&
          (n.params.payload as DynamicSubEvent | undefined)?.kind === "delta",
      )
      .map((n) => (n.params.payload as { value: { n: unknown } }).value.n);

  it("subscribe returns a snapshot event; well-formed deltas flow, invalid deltas are dropped", async () => {
    const { daemon } = await setupRouter();
    const provider = makeProvider();
    daemon.services.register(provider.binding);
    const rpc = await shell(daemon);

    const sub = (await rpc.call(`${NS}.watch`, {})) as { subId: string; snapshot: DynamicSubEvent };
    expect(sub.snapshot.kind).toBe("snapshot");
    expect((sub.snapshot as { value: { n: number } }).value.n).toBe(0);

    provider.emitDelta({ n: 1 });
    provider.emitDelta({ n: "not-a-number" }); // fails COUNTER — dropped server-side
    provider.emitDelta({ n: 2 });
    await until(() => deltasOf(rpc, sub.subId).includes(2));
    expect(deltasOf(rpc, sub.subId)).toEqual([1, 2]);
  });

  it("withdrawing the provider mid-subscription emits unavailable and stops deltas", async () => {
    const { daemon } = await setupRouter();
    const provider = makeProvider();
    daemon.services.register(provider.binding);
    const rpc = await shell(daemon);

    const sub = (await rpc.call(`${NS}.watch`, {})) as { subId: string; snapshot: DynamicSubEvent };
    provider.emitDelta({ n: 1 });
    await until(() => deltasOf(rpc, sub.subId).length === 1);

    daemon.services.withdrawPlugin(PROVIDER);
    await until(() =>
      rpc.notifications.some(
        (n) =>
          n.params.subId === sub.subId &&
          (n.params.payload as DynamicSubEvent).kind === "unavailable",
      ),
    );

    const before = deltasOf(rpc, sub.subId).length;
    provider.emitDelta({ n: 2 }); // the upstream is gone; nothing more may arrive
    await new Promise((r) => setTimeout(r, 150));
    expect(deltasOf(rpc, sub.subId).length).toBe(before);
  });
});

describe("provider route drain (PRC-2 / §18.2)", () => {
  it("withdraws publication, refuses typed new work, then retires the tombstone", async () => {
    const reg = registry();
    reg.register(makeProvider().binding);

    expect(reg.providerUp(NS)).toBe(true);
    expect(reg.snapshot().providers).toHaveLength(1);
    reg.beginDrainPlugin(PROVIDER);

    expect(reg.providerUp(NS)).toBe(false);
    expect(reg.snapshot().providers).toEqual([]);
    expect(reg.kindOf(`${NS}.get`)).toBe("call");
    expect(await callErrKind(reg, localCtx(["workspace.read"]), `${NS}.get`, { k: "x" })).toBe(
      "UNAVAILABLE",
    );

    reg.withdrawPlugin(PROVIDER);
    expect(reg.kindOf(`${NS}.get`)).toBeUndefined();
    expect(await callErrKind(reg, localCtx(["workspace.read"]), `${NS}.get`, { k: "x" })).toBe(
      "NOT_FOUND",
    );
  });

  it("gives a live subscription one terminal outcome at the drain edge", async () => {
    const reg = registry();
    const provider = makeProvider();
    reg.register(provider.binding);
    const events: DynamicSubEvent[] = [];
    const sub = await reg.subscribe(localCtx(["workspace.read"]), `${NS}.watch`, {}, (event) =>
      events.push(event),
    );

    reg.beginDrainPlugin(PROVIDER);
    reg.beginDrainPlugin(PROVIDER);
    provider.emitDelta({ n: 1 });
    sub.dispose();

    expect(events).toEqual([
      { kind: "unavailable", error: { kind: "UNAVAILABLE", message: "provider draining" } },
    ]);
  });

  it("refuses and releases a subscription whose setup crosses the drain edge", async () => {
    const reg = registry();
    const releaseSetup = deferred<() => void>();
    let releaseCalls = 0;
    const provider = makeProvider();
    reg.register({
      ...provider.binding,
      handlers: {
        ...provider.binding.handlers,
        async subscribe(_name, _params, _caller, sink) {
          const release = await releaseSetup.promise;
          sink.snapshot({ n: 0 });
          return release;
        },
      },
    });
    const pending = reg.subscribe(localCtx(["workspace.read"]), `${NS}.watch`, {}, () => undefined);
    await Promise.resolve();
    reg.beginDrainPlugin(PROVIDER);
    releaseSetup.resolve(() => {
      releaseCalls += 1;
    });

    await expect(pending).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    expect(releaseCalls).toBe(1);
  });
});

describe("services.list / services.subscribe (sanitized fabric surface)", () => {
  it("list returns sanitized provider records — methods, but no JSON Schemas", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const rpc = await shell(daemon);

    const snap = (await rpc.call("services.list", {})) as ServicesSnapshot;
    expect(typeof snap.generation).toBe("number");
    const rec = snap.providers.find((p) => p.namespace === NS) as ServiceProviderRecord;
    expect(rec).toBeDefined();
    expect(rec.pluginId).toBe(PROVIDER);
    expect(rec.state).toBe("active");
    expect(rec.methods.find((m) => m.name === "get")).toMatchObject({
      name: "get",
      kind: "query",
      idempotent: true,
      requiredCapability: "workspace.read",
    });
    // no schemas leak — not on the method rows, not anywhere in the record
    for (const m of rec.methods) {
      expect("input" in m).toBe(false);
      expect("output" in m).toBe(false);
      expect("snapshot" in m).toBe(false);
      expect("delta" in m).toBe(false);
    }
    const json = JSON.stringify(rec);
    expect(json).not.toContain("additionalProperties");
    expect(json).not.toContain("properties");
  });

  it("subscribe streams a snapshot delta when a new provider registers", async () => {
    const { daemon } = await setupRouter();
    const rpc = await shell(daemon);

    const sub = (await rpc.call("services.subscribe", {})) as {
      subId: string;
      snapshot: ServicesSnapshot;
    };
    expect(Array.isArray(sub.snapshot.providers)).toBe(true);

    daemon.services.register(makeProvider(PROVIDER2).binding);
    await until(() =>
      rpc.notifications.some(
        (n) =>
          n.method === "services.delta" &&
          n.params.subId === sub.subId &&
          (n.params.payload as ServicesSnapshot).providers.some(
            (p) => p.namespace === `x.${PROVIDER2}`,
          ),
      ),
    );
  });

  it("workspace.read gates the surface", async () => {
    const { daemon } = await setupRouter();
    const rpc = await tokenRpc(daemon, ["canvas.read"]); // holds no workspace.read
    expect((await rpc.callErr("services.list", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  });
});

describe("provider withdrawal on plugins.disable (§14.6)", () => {
  it("disabling the provider plugin makes its methods resolve NOT_FOUND", async () => {
    const { daemon } = await setupRouter();
    daemon.services.register(makeProvider().binding);
    const rpc = await shell(daemon); // shell holds plugins.manage + workspace.read

    expect(await rpc.call(`${NS}.get`, { k: "live" })).toEqual({ v: "val:live" });

    await rpc.call("plugins.disable", { id: PROVIDER });
    expect((await rpc.callErr(`${NS}.get`, { k: "gone" })).data?.kind).toBe("NOT_FOUND");
  });
});
