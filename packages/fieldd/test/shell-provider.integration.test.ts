import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHELL_PROVIDER_METHODS, ShellProviderCallParams, SOCKETS } from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, verifyAuditSegment } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

async function setup(): Promise<{ dataDir: string; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-shell-provider-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  cleanup.push(() => native.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { dataDir, daemon };
}

async function openRpc(
  daemon: FielddDaemon,
  token: string,
  clientKind: string,
): Promise<{ rpc: WsRpc; socket: WebSocket }> {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, token, clientKind);
  return { rpc, socket };
}

function providerCalls(rpc: WsRpc): ShellProviderCallParams[] {
  return rpc.notifications
    .filter((notification) => notification.method === "shell.provider.call")
    .map((notification) => ShellProviderCallParams.parse(notification.params));
}

async function readAuditRecords(dataDir: string): Promise<AuditRecordV1[]> {
  const records: AuditRecordV1[] = [];
  const root = join(dataDir, "audit");
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const verified = await verifyAuditSegment(join(root, name));
    expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
    records.push(...verified.records);
  }
  return records;
}

describe("AH-3 shell provider ProductAPI boundary", () => {
  it("binds authority to Electron main, brokers exact calls, audits safely, and fails on loss", async () => {
    const { dataDir, daemon } = await setup();
    const claimedShellGrant = daemon.tokens.mint([], "claimed-shell");
    const { rpc: claimedShell } = await openRpc(daemon, claimedShellGrant.token, "shell-main");
    expect(
      await claimedShell.callErr("shell.provider.register", {
        methods: [...SHELL_PROVIDER_METHODS],
      }),
    ).toMatchObject({ data: { kind: "FORBIDDEN_SCOPE" } });

    const { rpc: shell, socket: shellSocket } = await openRpc(
      daemon,
      daemon.shellToken,
      "shell-main",
    );
    await expect(
      shell.call("shell.provider.register", {
        methods: [...SHELL_PROVIDER_METHODS],
      }),
    ).resolves.toEqual({
      registered: [...SHELL_PROVIDER_METHODS],
    });

    const pluginGrant = daemon.tokens.mint(
      ["shell.dialog", "shell.open"],
      "browser-provider-test",
      { pluginId: "vibefield.browser" },
    );
    const { rpc: plugin } = await openRpc(daemon, pluginGrant.token, "renderer");
    expect(
      await plugin.callErr("shell.webcontents.captureArtifactPreview", {
        artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        url: "https://artifact-host.example.ts.net:12000/",
      }),
    ).toMatchObject({ data: { kind: "NOT_FOUND" } });

    const externalUrl = "https://artifact-host.example.ts.net:12000/private-page";
    const opened = plugin.call("shell.openExternal", { url: externalUrl });
    await until(() => providerCalls(shell).length === 1);
    const openCall = providerCalls(shell)[0]!;
    expect(openCall).toMatchObject({
      method: "shell.openExternal",
      params: { url: externalUrl },
      caller: {
        kind: "plugin",
        pluginId: "vibefield.browser",
        clientKind: "renderer",
      },
    });
    expect(openCall.deadlineAt).toBeGreaterThan(Date.now());
    await expect(
      shell.call("shell.provider.resolve", {
        callId: openCall.callId,
        outcome: { result: { opened: true } },
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(opened).resolves.toEqual({ opened: true });

    const callCount = providerCalls(shell).length;
    expect(
      await plugin.callErr("shell.openExternal", {
        url: "http://artifact-host.example.ts.net:12000/",
      }),
    ).toMatchObject({ data: { kind: "PRECONDITION_FAILED" } });
    expect(providerCalls(shell)).toHaveLength(callCount);

    const privatePath = "/Users/james/Private Sites/unreleased";
    const picked = plugin.call("shell.dialog.pickFolder", {
      purpose: "artifact.publish",
    });
    await until(() => providerCalls(shell).length === callCount + 1);
    const folderCall = providerCalls(shell).at(-1)!;
    expect(folderCall).toMatchObject({
      method: "shell.dialog.pickFolder",
      params: { purpose: "artifact.publish" },
      caller: { kind: "plugin", pluginId: "vibefield.browser" },
      deadlineAt: Number.MAX_SAFE_INTEGER,
    });
    await shell.call("shell.provider.resolve", {
      callId: folderCall.callId,
      outcome: { result: { canceled: false, path: privatePath } },
    });
    await expect(picked).resolves.toEqual({ canceled: false, path: privatePath });

    const abandoned = plugin
      .call("shell.openExternal", {
        url: "https://provider-loss.example.ts.net:12000/",
      })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    await until(() => providerCalls(shell).length === callCount + 2);
    shellSocket.close();
    await until(() => shell.closed);
    await expect(abandoned).resolves.toMatchObject({
      error: { rpc: { data: { kind: "UNAVAILABLE", retryable: true } } },
    });

    await daemon.stop();
    const records = await readAuditRecords(dataDir);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "shell.open.external",
          actor: { kind: "plugin", id: "vibefield.browser" },
          target: { kind: "shell-operation", id: "system-browser" },
          phase: "outcome",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          action: "shell.dialog.pick_folder",
          actor: { kind: "plugin", id: "vibefield.browser" },
          target: { kind: "shell-operation", id: "artifact-folder-picker" },
          phase: "outcome",
          outcome: "succeeded",
        }),
      ]),
    );
    const persisted = readdirSync(join(dataDir, "audit"))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => readFileSync(join(dataDir, "audit", name), "utf8"))
      .join("\n");
    expect(persisted).not.toContain(externalUrl);
    expect(persisted).not.toContain(privatePath);
    expect(persisted).not.toContain(pluginGrant.token);
  });
});
