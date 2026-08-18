import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type PluginUpdateCommand,
  type PluginUpdateParticipantEvent,
  PluginUpdateSourceResult,
  SOCKETS,
} from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const PLUGIN_ID = "vibefield.fixture.renderer-update";
const identity = {
  participantId: "renderer:desktop-test:update-window",
  incarnation: "renderer:desktop-test:update-window:document-1",
};

let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

function releaseRoot(parent: string, version: string): string {
  const root = join(parent, version);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "vibefield.plugin.json"),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        id: PLUGIN_ID,
        version,
        title: "Renderer update fixture",
        engines: { app: ">=0.0.0", contracts: "^0.1.0" },
        entries: { renderer: "./renderer.js" },
        activation: [],
        capabilities: [],
        contributes: {},
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "renderer.js"),
    `export const marker = ${JSON.stringify(version)};\nexport function activate() {}\n`,
  );
  return root;
}

async function setup(): Promise<FielddDaemon> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-renderer-update-data-"));
  const registryDir = mkdtempSync(join(tmpdir(), "vf-renderer-update-registry-"));
  const releasesDir = mkdtempSync(join(tmpdir(), "vf-renderer-update-releases-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  cleanup.push(() => rmSync(registryDir, { recursive: true, force: true }));
  cleanup.push(() => rmSync(releasesDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());

  const oldRoot = releaseRoot(releasesDir, "1.0.0");
  const candidateRoot = releaseRoot(releasesDir, "2.0.0");
  const [oldRelease, candidateRelease] = await Promise.all([
    packVfplugin({ rootDir: oldRoot }),
    packVfplugin({ rootDir: candidateRoot }),
  ]);
  const keys = generateRegistryKeypair();
  buildFixtureRegistry({
    dir: registryDir,
    secretKey: keys.secretKey,
    plugins: [
      { manifestDir: candidateRoot, artifactBytes: candidateRelease.bytes },
      { manifestDir: oldRoot, artifactBytes: oldRelease.bytes },
    ],
  });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    registryUrl: pathToFileURL(join(registryDir, "index.json")).href,
    registryPublicKey: keys.publicKey,
  });
  cleanup.push(() => daemon.stop());
  return daemon;
}

async function openRpc(daemon: FielddDaemon): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

function events(rpc: WsRpc, subId: string): PluginUpdateParticipantEvent[] {
  return rpc.notifications
    .filter(
      (notification) =>
        notification.method === "plugins.update.delta" && notification.params.subId === subId,
    )
    .map((notification) => notification.params.payload as PluginUpdateParticipantEvent);
}

function command(
  rpc: WsRpc,
  subId: string,
  kind: PluginUpdateCommand["kind"],
): PluginUpdateCommand | undefined {
  const event = events(rpc, subId).find(
    (candidate) => candidate.kind === "command" && candidate.command.kind === kind,
  );
  return event?.kind === "command" ? event.command : undefined;
}

describe("coordinated renderer update over the production Product API", () => {
  it("holds the pointer behind prepare/commit acks and retires candidate source authority exactly", {
    timeout: 30_000,
  }, async () => {
    const daemon = await setup();
    const shell = await openRpc(daemon);
    await helloAs(shell, daemon.shellToken, "shell-main");
    const installed = (await shell.call("plugins.install", {
      id: PLUGIN_ID,
      version: "1.0.0",
    })) as { version: string; installRevision: string };
    expect(installed.version).toBe("1.0.0");

    const windowGrant = (await shell.call("system.mintWindowToken", {
      scopes: ["plugins.read"],
      label: "renderer-update-window",
      rendererParticipant: identity,
    })) as { token: string };
    const renderer = await openRpc(daemon);
    await helloAs(renderer, windowGrant.token, "renderer");
    const subscription = (await renderer.call("plugins.update.subscribe", {
      pluginId: PLUGIN_ID,
    })) as {
      subId: string;
      snapshot: { status: string; artifact: { installRevision: string } };
    };
    expect(subscription.snapshot).toMatchObject({
      status: "live",
      artifact: { installRevision: installed.installRevision },
    });

    const updating = shell.call("plugins.install", { id: PLUGIN_ID });
    await until(() => command(renderer, subscription.subId, "prepare") !== undefined);
    const prepare = command(renderer, subscription.subId, "prepare");
    if (prepare?.kind !== "prepare") throw new Error("prepare command was not delivered");
    expect(daemon.plugins.get(PLUGIN_ID)?.version).toBe("1.0.0");

    const rawSource = await renderer.call("plugins.update.source", {
      pluginId: PLUGIN_ID,
      updateId: prepare.updateId,
      purpose: "candidate",
    });
    expect(JSON.stringify(rawSource)).not.toContain("vf-renderer-update-releases-");
    const source = PluginUpdateSourceResult.parse(rawSource);
    expect(source).toMatchObject({
      updateId: prepare.updateId,
      purpose: "candidate",
      artifact: prepare.candidateArtifact,
      record: { version: "2.0.0" },
    });
    const token = source.module.moduleUrl.slice("vibefield-plugin://".length);
    const resolution = (await shell.call("plugins.resolveModule", { token })) as {
      path: string;
    };
    expect(readFileSync(resolution.path, "utf8")).toContain('marker = "2.0.0"');
    expect(daemon.plugins.get(PLUGIN_ID)?.version).toBe("1.0.0");

    const candidateClient = await openRpc(daemon);
    await helloAs(candidateClient, source.lease.token, "renderer");
    expect(daemon.tokens.verify(source.lease.token)?.pluginId).toBe(PLUGIN_ID);

    await renderer.call("plugins.update.ack", {
      kind: "prepared",
      updateId: prepare.updateId,
      pluginId: PLUGIN_ID,
      candidateArtifact: prepare.candidateArtifact,
    });
    await until(() => command(renderer, subscription.subId, "commit") !== undefined);
    const commit = command(renderer, subscription.subId, "commit");
    if (commit?.kind !== "commit") throw new Error("commit command was not delivered");
    expect(daemon.plugins.get(PLUGIN_ID)?.version).toBe("2.0.0");

    await renderer.call("plugins.update.ack", {
      kind: "committed",
      updateId: commit.updateId,
      pluginId: PLUGIN_ID,
      candidateArtifact: commit.candidateArtifact,
      commitEpoch: commit.commitEpoch,
    });
    await expect(updating).resolves.toMatchObject({ version: "2.0.0" });

    await expect(
      renderer.call("plugins.update.source.release", {
        pluginId: PLUGIN_ID,
        updateId: prepare.updateId,
        leaseId: source.lease.leaseId,
      }),
    ).resolves.toEqual({ released: true });
    expect(daemon.tokens.verify(source.lease.token)).toBeNull();
    await until(() => candidateClient.closed);

    await renderer.call("system.unsubscribe", { subId: subscription.subId });
    await expect(renderer.call("plugins.update.leave", { pluginId: PLUGIN_ID })).resolves.toEqual({
      retired: true,
    });
  });
});
