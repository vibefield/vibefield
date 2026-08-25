// Track A product surface, against the mock mgmt server (no cargo): run files
// (shell bootstrap contract), window-token minting rules, product-side
// subscriptions, and the health aggregator's honest link-down/up stream.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKETS } from "@vibefield/contracts";
import {
  currentWindowsAccount,
  MULTI_USER_PRINCIPALS,
  readWindowsAcl,
} from "@vibefield/logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, type FielddHealth } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
const rendererParticipant = (suffix: string) => ({
  participantId: `renderer:desktop-test:window-${suffix}`,
  incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
});
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function setup(): Promise<{ dataDir: string; mock: MockMgmtServer; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-prod-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { dataDir, mock, daemon };
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

describe("bootstrap lifecycle", () => {
  it("rejects when takeover happens before the fatal listener is attached", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-startup-race-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    mock.supersedeAfterSubscribe = true;
    let fatal = "";

    await expect(
      bootstrap({ dataDir, controlPort: 0, onFatal: (reason) => (fatal = reason) }),
    ).rejects.toThrow(/superseded/);
    expect(fatal).toContain("superseded");
  });
});

describe("run files (shell bootstrap contract)", () => {
  it("writes a 0600 shell.token + product.json, and removes them on stop", async () => {
    const { dataDir, daemon } = await setup();
    const runDir = join(dataDir, "fieldd", "run");
    const tokenPath = join(runDir, "shell.token");
    const productPath = join(runDir, "product.json");

    expect(readFileSync(tokenPath, "utf8")).toBe(daemon.shellToken);
    // POSIX mode bits are a no-op on Windows (WIN-D4); each platform therefore
    // asserts "private at rest" in its own true terms.
    if (process.platform !== "win32") {
      expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    } else {
      // shell.token grants FULL daemon adoption, and `mode` on Windows sets the
      // read-only attribute and nothing else — so the credential's privacy is a
      // DACL or it is nothing. The run dir breaks inheritance and grants this
      // account alone; both run files are private BECAUSE they inherit it.
      // Red before that call site: a plain mkdir under the user temp dir
      // inherits SYSTEM, BUILTIN\Administrators and the machine's app SIDs, so
      // "exactly one account" is the load-bearing row here — the named
      // principals below can pass unfixed under a per-user %TEMP% and are
      // asserted anyway, so the threat stays visible in the test.
      const account = currentWindowsAccount().toLowerCase();
      for (const path of [runDir, tokenPath, productPath]) {
        const accounts = (await readWindowsAcl(path)).map((ace) => ace.account.toLowerCase());
        expect(accounts).toEqual([account]);
        for (const principal of MULTI_USER_PRINCIPALS)
          expect(accounts).not.toContain(principal.toLowerCase());
      }
      // Inheritance is broken at the run dir and ONLY there. product.json is
      // the discovery contract rather than a secret and gets no ACL of its own;
      // this row is what proves the directory's single grant actually reached
      // it — and, for shell.token, that the daemon can still read and delete
      // its own credential (an empty DACL would read as "no ACL" and throw).
      expect((await readWindowsAcl(runDir)).some((ace) => ace.inherited)).toBe(false);
      for (const path of [tokenPath, productPath])
        expect((await readWindowsAcl(path)).every((ace) => ace.inherited)).toBe(true);
    }

    const product = JSON.parse(readFileSync(productPath, "utf8"));
    expect(product.port).toBe(daemon.controlPort);
    expect(product.pid).toBe(process.pid);
    expect(product.bootId).toBe(daemon.bootId);
    expect(Number.isInteger(product.startedAt)).toBe(true);
    expect(product.buildId).toBeNull();

    await daemon.stop();
    expect(existsSync(tokenPath)).toBe(false);
    expect(existsSync(productPath)).toBe(false);
  });

  it("records the development build identity when one is supplied", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-prod-build-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({ dataDir, controlPort: 0, buildId: "dev-test-build" });
    cleanup.push(() => daemon.stop());

    const product = JSON.parse(
      readFileSync(join(dataDir, "fieldd", "run", "product.json"), "utf8"),
    );
    expect(product.buildId).toBe("dev-test-build");
  });
});

describe("system.mintWindowToken", () => {
  it("shell mints a subset window token that works but cannot mint further", async () => {
    const { daemon } = await setup();
    const shell = await openRpc(daemon.controlPort);
    await helloAs(shell, daemon.shellToken, "shell-main");

    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "window-1",
      rendererParticipant: rendererParticipant("1"),
    })) as { token: string; scopes: string[] };
    expect(minted.scopes).toEqual(["canvas.read"]);
    expect(daemon.tokens.verify(minted.token)?.rendererParticipant).toEqual(
      rendererParticipant("1"),
    );

    // the window token authenticates…
    const win = await openRpc(daemon.controlPort);
    await helloAs(win, minted.token);
    const health = (await win.call("system.health", {})) as FielddHealth;
    expect(health.nativeConnected).toBe(true);
    expect(health.pluginRuntime.serviceHost).toMatchObject({ disposed: false });
    expect(health.pluginRuntime.serviceRegistry).toMatchObject({
      subscriptions: 0,
      disposed: false,
    });
    expect(health.pluginRuntime.diagnostics).toMatchObject({
      flushScheduled: false,
      disposed: false,
    });
    expect(JSON.parse(JSON.stringify(health.pluginRuntime))).toEqual(health.pluginRuntime);

    // …but lacks tokens.mint: the registry scope gate refuses it
    const denied = await win.callErr("system.mintWindowToken", { scopes: [], label: "nope" });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("refuses escalation beyond the caller's own grant and unknown scopes", async () => {
    const { daemon } = await setup();
    // a caller that can mint but holds nothing else
    const narrow = daemon.tokens.mint(["tokens.mint"], "narrow", { shellMain: true });
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, narrow.token, "shell-main");

    const unbound = await rpc.callErr("system.mintWindowToken", {
      scopes: [],
      label: "unbound-window",
    });
    expect(unbound.data?.kind).toBe("PRECONDITION_FAILED");

    const escalate = await rpc.callErr("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "w",
      rendererParticipant: rendererParticipant("escalate"),
    });
    expect(escalate.data?.kind).toBe("FORBIDDEN_SCOPE");

    const junk = await rpc.callErr("system.mintWindowToken", {
      scopes: ["not.a.scope"],
      label: "w",
      rendererParticipant: rendererParticipant("junk"),
    });
    expect(junk.data?.kind).toBe("PRECONDITION_FAILED");

    const malformed = await rpc.callErr("system.mintWindowToken", { label: 42 });
    expect(malformed.data?.kind).toBe("PRECONDITION_FAILED");
  });

  it("revokes exact and stale window grants, including their authenticated sockets", async () => {
    const { daemon } = await setup();
    const shell = await openRpc(daemon.controlPort);
    await helloAs(shell, daemon.shellToken, "shell-main");
    const unrelated = daemon.tokens.mint(["canvas.read"], "not-a-window");

    const first = (await shell.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "window-1",
      rendererParticipant: rendererParticipant("1"),
    })) as { token: string; tokenId: string };
    const second = (await shell.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "window-2",
      rendererParticipant: rendererParticipant("2"),
    })) as { token: string; tokenId: string };
    const firstWindow = await openRpc(daemon.controlPort);
    await helloAs(firstWindow, first.token);

    await expect(
      shell.call("system.revokeWindowToken", { tokenId: first.tokenId }),
    ).resolves.toMatchObject({ revoked: true, droppedConnections: 1 });
    await until(() => firstWindow.closed);
    expect(daemon.tokens.verify(first.token)).toBeNull();
    expect(daemon.tokens.verify(unrelated.token)).not.toBeNull();

    await expect(shell.call("system.revokeStaleWindowTokens", {})).resolves.toMatchObject({
      revoked: 1,
    });
    expect(daemon.tokens.verify(second.token)).toBeNull();
    expect(daemon.tokens.verify(unrelated.token)).not.toBeNull();
    await expect(
      shell.call("system.revokeWindowToken", { tokenId: second.tokenId }),
    ).resolves.toMatchObject({ revoked: false });
  });

  it("keeps window-token lifecycle authority on the loopback shell client", async () => {
    const { daemon } = await setup();
    const narrow = daemon.tokens.mint(["tokens.mint"], "not-shell-main");
    const renderer = await openRpc(daemon.controlPort);
    await helloAs(renderer, narrow.token, "renderer");

    const denied = await renderer.callErr("system.revokeStaleWindowTokens", {});
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");

    const claimedShell = await openRpc(daemon.controlPort);
    await helloAs(claimedShell, narrow.token, "shell-main");
    const claimed = await claimedShell.callErr("system.mintWindowToken", {
      scopes: [],
      label: "forged-shell-kind",
    });
    expect(claimed.data?.kind).toBe("FORBIDDEN_SCOPE");
  });
});

describe("system.health.subscribe (aggregated stream)", () => {
  it("streams native deltas, link-down flips, link-up recovery — and unsubscribes cleanly", async () => {
    const { mock, daemon } = await setup();
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");

    const sub = (await rpc.call("system.health.subscribe", {})) as {
      subId: string;
      snapshot: FielddHealth;
    };
    expect(sub.snapshot.nativeConnected).toBe(true);
    expect(sub.snapshot.native).toEqual({ n: 0 });

    const payloads = (): FielddHealth[] =>
      rpc.notifications
        .filter((n) => n.method === "system.health.delta" && n.params.subId === sub.subId)
        .map((n) => n.params.payload as FielddHealth);

    // native-plane delta flows through the aggregator
    mock.pushDelta("health.subscribe", { n: 7 });
    await until(() => payloads().some((p) => (p.native as { n?: number } | null)?.n === 7));

    // link down → an honest nativeConnected:false delta, immediately
    mock.killClients();
    await until(() => payloads().some((p) => p.nativeConnected === false));

    // link back (mock still listening) → reconnect + fresh snapshot → true again
    await until(() => {
      const ps = payloads();
      const lastDown = ps.map((p) => p.nativeConnected).lastIndexOf(false);
      return ps.slice(lastDown + 1).some((p) => p.nativeConnected === true);
    }, 6000);

    // unsubscribe stops the stream
    const removed = (await rpc.call("system.unsubscribe", { subId: sub.subId })) as {
      removed: boolean;
    };
    expect(removed.removed).toBe(true);
    const countAfter = payloads().length;
    mock.pushDelta("health.subscribe", { n: 99 });
    await new Promise((r) => setTimeout(r, 200));
    expect(payloads().length).toBe(countAfter);

    const again = (await rpc.call("system.unsubscribe", { subId: sub.subId })) as {
      removed: boolean;
    };
    expect(again.removed).toBe(false);
  });
});

describe("plugins.* (PLUG-P2 registry surface)", () => {
  // a self-contained bundled root: one minimal-valid plugin, written inline
  async function setupWithPlugins() {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-plug-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const root = join(dataDir, "bundled-root");
    mkdirSync(join(root, "alpha"), { recursive: true });
    writeFileSync(
      join(root, "alpha", "vibefield.plugin.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "vibefield.fixture.alpha",
        version: "0.1.0",
        title: "Alpha Fixture",
        engines: { app: ">=0.0.0", contracts: "^0.1.0" },
        activation: [],
        capabilities: [],
      }),
    );
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      pluginRoots: { bundled: [root] },
    });
    cleanup.push(() => daemon.stop());
    return { daemon };
  }

  it("lists and subscribes; enable/disable round-trips as deltas; health folds counts", async () => {
    const { daemon } = await setupWithPlugins();
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");

    const list = (await rpc.call("plugins.list", {})) as {
      generation: number;
      plugins: Array<{ id: string; state: string; enabled: boolean }>;
      problems: unknown[];
    };
    expect(list.generation).toBeGreaterThanOrEqual(1);
    expect(list.problems).toEqual([]);
    expect(list.plugins.map((p) => p.id)).toEqual(["vibefield.fixture.alpha"]);
    expect(list.plugins[0]!.state).toBe("enabled");

    const health = (await rpc.call("system.health", {})) as FielddHealth;
    expect(health.plugins).toEqual({ count: 1, enabled: 1, invalid: 0 });

    const sub = (await rpc.call("plugins.subscribe", {})) as {
      subId: string;
      snapshot: { generation: number };
    };
    const disabled = (await rpc.call("plugins.disable", { id: "vibefield.fixture.alpha" })) as {
      state: string;
      enabled: boolean;
    };
    expect(disabled.state).toBe("disabled");
    expect(disabled.enabled).toBe(false);
    await until(() =>
      rpc.notifications.some(
        (n) =>
          n.method === "plugins.delta" &&
          n.params.subId === sub.subId &&
          (n.params.payload as { plugins: Array<{ state: string }> }).plugins[0]?.state ===
            "disabled",
      ),
    );

    // the flag persists in install records — a reload keeps it disabled
    const reloaded = (await rpc.call("plugins.reload", {})) as {
      plugins: Array<{ state: string }>;
    };
    expect(reloaded.plugins[0]!.state).toBe("disabled");

    const missing = await rpc.callErr("plugins.get", { id: "vibefield.fixture.ghost" });
    expect(missing.data?.kind).toBe("NOT_FOUND");
  });

  it("gates writes behind plugins.manage while reads ride plugins.read", async () => {
    const { daemon } = await setupWithPlugins();
    const readOnly = daemon.tokens.mint(["plugins.read"], "reader");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, readOnly.token);

    const list = (await rpc.call("plugins.list", {})) as { plugins: unknown[] };
    expect(list.plugins.length).toBe(1);

    const denied = await rpc.callErr("plugins.disable", { id: "vibefield.fixture.alpha" });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("composes the authenticated renderer update lane and orderly identity-derived leave", async () => {
    const { daemon } = await setupWithPlugins();
    const shell = await openRpc(daemon.controlPort);
    await helloAs(shell, daemon.shellToken, "shell-main");
    const identity = rendererParticipant("update-lane");
    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["plugins.read"],
      label: "update-lane",
      rendererParticipant: identity,
    })) as { token: string };
    const renderer = await openRpc(daemon.controlPort);
    await helloAs(renderer, minted.token, "renderer");

    const subscription = (await renderer.call("plugins.update.subscribe", {
      pluginId: "vibefield.fixture.alpha",
    })) as {
      subId: string;
      snapshot: {
        pluginId: string;
        status: string;
        artifact: { pluginId: string } | null;
        pendingCommand: unknown;
      };
    };
    expect(subscription.snapshot).toMatchObject({
      pluginId: "vibefield.fixture.alpha",
      status: "live",
      artifact: { pluginId: "vibefield.fixture.alpha" },
      pendingCommand: null,
    });

    const forged = await renderer.callErr("plugins.update.leave", {
      pluginId: "vibefield.fixture.alpha",
      participantId: identity.participantId,
    });
    expect(forged.data?.kind).toBe("PRECONDITION_FAILED");
    await expect(
      renderer.call("plugins.update.leave", { pluginId: "vibefield.fixture.alpha" }),
    ).resolves.toEqual({ retired: true });
    await expect(
      renderer.call("system.unsubscribe", { subId: subscription.subId }),
    ).resolves.toEqual({ removed: true });
  });
});
