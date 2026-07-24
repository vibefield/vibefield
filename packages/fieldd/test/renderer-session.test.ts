// plugins.openRendererSession (plugin spec §11.2): the renderer principal lease.
// A window/renderer principal trades a registered, enabled, hash-matched plugin
// id for a short-lived plugin-principal token whose scopes are the plugin's
// granted CORE capabilities — an attributable connection, never a shared one.
// Written against the pinned contract while the handler lands in parallel; the
// TTL describe is the one spot that pins a TokenService detail (mint ttlMs).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, TokenService } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, WsRpc } from "./ws-rpc";

const ALPHA = "vibefield.fixture.alpha";
const BETA = "vibefield.fixture.beta";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

// the exact minimal-valid manifest shape product-surface uses, varying only id
// + capabilities so token-scope derivation is observable. entries.renderer is
// load-bearing since P6: §15.2 entry-kind eligibility grants nothing to a
// manifest with no entries (no runtime, no grant) — a renderer entry makes
// these fixtures realistic lease consumers (the module is never loaded here).
function manifest(id: string, capabilities: string[]): string {
  return JSON.stringify({
    manifestVersion: 1,
    id,
    version: "0.1.0",
    title: id,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./renderer.js" },
    activation: [],
    capabilities,
  });
}

// a self-contained bundled root: alpha grants two real core scopes, beta none
async function setupWithPlugins(): Promise<{ daemon: FielddDaemon; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-rsession-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  const root = join(dataDir, "bundled-root");
  mkdirSync(join(root, "alpha"), { recursive: true });
  mkdirSync(join(root, "beta"), { recursive: true });
  writeFileSync(
    join(root, "alpha", "vibefield.plugin.json"),
    // the custom x.* capability must be granted registry-side yet NEVER become
    // a bearer-token scope (daemon core-scope filter — §15.1 custom caps ride
    // the service fabric, not tokens)
    manifest(ALPHA, ["canvas.read", "doc.read", `x.${ALPHA}.probe`]),
  );
  writeFileSync(join(root, "beta", "vibefield.plugin.json"), manifest(BETA, []));
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

// a §11.2 principal: a minted token AND a client-kind hello. Scope alone is
// insufficient — both halves ride the same connection, so both live here.
async function principal(
  daemon: FielddDaemon,
  scopes: Scope[],
  clientKind = "renderer",
): Promise<WsRpc> {
  const grant = daemon.tokens.mint(scopes, "lease-caller");
  const rpc = await openRpc(daemon.controlPort);
  await helloAs(rpc, grant.token, clientKind);
  return rpc;
}

describe("plugins.openRendererSession (renderer principal lease, §11.2)", () => {
  it("mints a lease whose token verifies with the plugin's real-scope grants", async () => {
    const { daemon } = await setupWithPlugins();
    const rpc = await principal(daemon, ["plugins.read"]);

    const res = (await rpc.call("plugins.openRendererSession", { pluginId: ALPHA })) as {
      token: string;
      scopes: string[];
      pluginId: string;
      expiresAt: number;
    };
    const now = Date.now();

    // the lease is a real, attributable principal — it verifies server-side, and
    // its scopes are exactly the plugin's granted CORE capabilities
    const verified = daemon.tokens.verify(res.token);
    expect(verified).not.toBeNull();
    expect(verified?.scopes).toEqual(["canvas.read", "doc.read"]);
    expect(verified?.label).toContain(ALPHA);

    // the result mirrors that grant and names the plugin
    expect(res.scopes).toEqual(["canvas.read", "doc.read"]);
    expect(res.pluginId).toBe(ALPHA);

    // short-lived: in the future, no more than 15 minutes out
    expect(res.expiresAt - now).toBeGreaterThan(0);
    expect(res.expiresAt - now).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("mints a zero-scope but attributable principal for a capability-less plugin", async () => {
    const { daemon } = await setupWithPlugins();
    const rpc = await principal(daemon, ["plugins.read"]);

    const res = (await rpc.call("plugins.openRendererSession", { pluginId: BETA })) as {
      token: string;
      scopes: string[];
    };

    const verified = daemon.tokens.verify(res.token);
    expect(verified).not.toBeNull();
    expect(verified?.scopes).toEqual([]);
    expect(res.scopes).toEqual([]);
  });

  it("NOT_FOUND for an unknown plugin id", async () => {
    const { daemon } = await setupWithPlugins();
    const rpc = await principal(daemon, ["plugins.read"]);

    const err = await rpc.callErr("plugins.openRendererSession", {
      pluginId: "vibefield.fixture.ghost",
    });
    expect(err.data?.kind).toBe("NOT_FOUND");
  });

  it("PRECONDITION_FAILED (PLUGIN_DISABLED) once the plugin is disabled", async () => {
    const { daemon } = await setupWithPlugins();
    const rpc = await principal(daemon, ["plugins.read", "plugins.manage"]);

    await rpc.call("plugins.disable", { id: ALPHA });
    const err = await rpc.callErr("plugins.openRendererSession", { pluginId: ALPHA });
    expect(err.data?.kind).toBe("PRECONDITION_FAILED");
    expect((err.data?.details as { pluginKind?: string })?.pluginKind).toBe("PLUGIN_DISABLED");
  });

  it("CONFLICT (PLUGIN_ARTIFACT_MISMATCH) on a stale hash; the true hash succeeds", async () => {
    const { daemon } = await setupWithPlugins();
    const rpc = await principal(daemon, ["plugins.read"]);

    const bogus = `sha256:${"0".repeat(64)}`;
    const err = await rpc.callErr("plugins.openRendererSession", {
      pluginId: ALPHA,
      manifestHash: bogus,
    });
    expect(err.data?.kind).toBe("CONFLICT");
    expect((err.data?.details as { pluginKind?: string })?.pluginKind).toBe(
      "PLUGIN_ARTIFACT_MISMATCH",
    );

    // the record's own hash is honored
    const rec = (await rpc.call("plugins.get", { id: ALPHA })) as { manifestHash: string };
    const ok = (await rpc.call("plugins.openRendererSession", {
      pluginId: ALPHA,
      manifestHash: rec.manifestHash,
    })) as { token: string };
    expect(daemon.tokens.verify(ok.token)).not.toBeNull();
  });

  it("FORBIDDEN_SCOPE for a non-window principal even carrying plugins.read", async () => {
    const { daemon } = await setupWithPlugins();
    // §11.2: scope alone is insufficient — an agent principal is refused. "agent"
    // is not a ClientKind member; "mcp-agent" is the enum's agent principal.
    const rpc = await principal(daemon, ["plugins.read"], "mcp-agent");

    const err = await rpc.callErr("plugins.openRendererSession", { pluginId: ALPHA });
    expect(err.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("FORBIDDEN_SCOPE for a token lacking plugins.read (the registry gate)", async () => {
    const { daemon } = await setupWithPlugins();
    const rpc = await principal(daemon, []);

    const err = await rpc.callErr("plugins.openRendererSession", { pluginId: ALPHA });
    expect(err.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("does not persist the lease — no token reaches the records file", async () => {
    const { daemon, dataDir } = await setupWithPlugins();
    const rpc = await principal(daemon, ["plugins.read", "plugins.manage"]);

    const res = (await rpc.call("plugins.openRendererSession", { pluginId: ALPHA })) as {
      token: string;
    };

    // force the install-records file to exist, then confirm the lease left no trace
    await rpc.call("plugins.disable", { id: BETA });
    await daemon.stop();
    const onDisk = readFileSync(join(dataDir, "fieldd", "plugins", "install-records.json"), "utf8");
    expect(onDisk).not.toContain(res.token);
    expect(onDisk.toLowerCase()).not.toContain("token");
  });
});

describe("TokenService lease TTL (openRendererSession expiry, §11.2)", () => {
  it("verify returns null once the ttl elapses", async () => {
    const tokens = new TokenService();
    const grant = tokens.mint([], "ttl-probe", { ttlMs: 50 });
    expect(tokens.verify(grant.token)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    expect(tokens.verify(grant.token)).toBeNull();
  });
});
