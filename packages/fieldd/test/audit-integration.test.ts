import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, verifyAuditSegment } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function openRpc(
  daemon: FielddDaemon,
  token = daemon.shellToken,
  clientKind = "shell-main",
): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, token, clientKind);
  return rpc;
}

describe("LOG-L6 product audit policy", () => {
  it("audits real shell/token/plugin actions and fails a mutation closed on writer loss", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-audit-product-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const native = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
    await native.start();
    cleanup.push(() => native.stop());

    const pluginRoot = join(dataDir, "bundled");
    const pluginId = "vibefield.audit.fixture";
    mkdirSync(join(pluginRoot, "fixture"), { recursive: true });
    writeFileSync(
      join(pluginRoot, "fixture", "vibefield.plugin.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: pluginId,
        version: "1.0.0",
        title: "Audit fixture",
        engines: { app: "*", contracts: "*" },
        activation: [],
        capabilities: [],
      }),
    );

    let failWrites = false;
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      pluginRoots: { bundled: [pluginRoot] },
      auditTestHooks: {
        beforeWrite: () => {
          if (failWrites) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
      },
    });
    const shellToken = daemon.shellToken;
    cleanup.push(() => daemon.stop());
    const shell = await openRpc(daemon);

    await shell.call("audit.append", {
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_product_01" },
      phase: "attempt",
      operationId: "bundle_product_01",
      actor: { kind: "system", id: "forged" },
    });
    await shell.call("audit.append", {
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_product_01" },
      phase: "outcome",
      outcome: "cancelled",
      reasonCode: "USER_CANCELLED",
      operationId: "bundle_product_01",
    });

    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "audit-window",
    })) as { token: string; tokenId: string };
    await shell.call("plugins.disable", { id: pluginId });
    expect(daemon.plugins.get(pluginId)?.enabled).toBe(false);

    failWrites = true;
    const refused = await shell.callErr("plugins.enable", { id: pluginId });
    expect(refused.data).toMatchObject({
      kind: "AUDIT_UNAVAILABLE",
      retryable: true,
      details: {
        service: "audit",
        state: "degraded",
        operation: "write",
        code: "ENOSPC",
        actionApplied: false,
      },
    });
    expect(daemon.plugins.get(pluginId)?.enabled).toBe(false);
    await vi.waitFor(() => expect(daemon.health().audit.state).toBe("degraded"));

    failWrites = false;
    await shell.call("plugins.enable", { id: pluginId });
    expect(daemon.plugins.get(pluginId)?.enabled).toBe(true);

    const narrow = daemon.tokens.mint(["audit.append"], "not-the-shell");
    const renderer = await openRpc(daemon, narrow.token, "renderer");
    expect(
      await renderer.callErr("audit.append", {
        action: "support.bundle.export",
        target: { kind: "support-bundle", id: "bundle_refused" },
        phase: "attempt",
        operationId: "bundle_refused",
      }),
    ).toMatchObject({ data: { kind: "FORBIDDEN_SCOPE" } });

    await daemon.stop();
    const auditRoot = join(dataDir, "audit");
    const paths = readdirSync(auditRoot)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(auditRoot, name));
    const records: AuditRecordV1[] = [];
    for (const path of paths) {
      const verified = await verifyAuditSegment(path);
      expect(verified.valid, `${path}: ${verified.reason}`).toBe(true);
      records.push(...verified.records);
    }
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "token.shell.mint",
          actor: { kind: "system", id: "fieldd" },
        }),
        expect.objectContaining({
          action: "token.window.mint",
          target: { kind: "token", id: minted.tokenId },
        }),
        expect.objectContaining({
          action: "plugin.disable",
          target: expect.objectContaining({ id: pluginId }),
          phase: "outcome",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          action: "plugin.enable",
          target: expect.objectContaining({ id: pluginId }),
          phase: "outcome",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          action: "support.bundle.export",
          actor: { kind: "shell-main", id: expect.any(String) },
          phase: "outcome",
          outcome: "cancelled",
        }),
      ]),
    );
    const persisted = paths.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(persisted).not.toContain(shellToken);
    expect(persisted).not.toContain(minted.token);
    expect(persisted).not.toContain('"id":"forged"');
  });
});
