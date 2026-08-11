import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_STREAMS, SOCKETS } from "@vibefield/contracts";
import type {
  DiagnosticLeaseListV1,
  DiagnosticLeaseV1,
  DiagnosticLogDeltaV1,
  DiagnosticLogSnapshotV1,
} from "@vibefield/contracts/diagnostics";
import type { LogRecordV1 } from "@vibefield/contracts/logging";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

interface Fixture {
  root: string;
  daemon: FielddDaemon;
  native: MockMgmtServer;
  sockets: WebSocket[];
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    for (const socket of fixture.sockets) socket.close();
    await fixture.daemon.stop();
    await fixture.native.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

async function setup(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "vf-diagnostics-"));
  const dataDir = join(root, "data");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  const daemon = await bootstrap({
    dataDir,
    logRoot: join(root, "logs"),
    controlPort: 0,
    dataPort: 0,
  });
  const fixture = { root, daemon, native, sockets: [] };
  fixtures.push(fixture);
  return fixture;
}

async function rpc(fixture: Fixture, token = fixture.daemon.shellToken): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${fixture.daemon.controlPort}`);
  fixture.sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new WsRpc(socket);
  await helloAs(client, token, "shell-main");
  return client;
}

function nativeRecord(
  fixture: Fixture,
  event: string,
  seq: number,
  message = "native diagnostic",
): LogRecordV1 {
  return {
    v: 1,
    time: Date.now(),
    level: 30,
    severity: "INFO",
    event,
    msg: message,
    service: "field-native",
    role: "daemon",
    component: "native.diagnostics",
    pid: 42,
    bootId: fixture.native.diagnosticBootId,
    instanceId: fixture.native.diagnosticBootId,
    seq,
  };
}

describe("LOG-L5 privileged diagnostics surface", () => {
  it("merges bounded local/native rings with history metadata and enforces the read scope", async () => {
    const fixture = await setup();
    fixture.daemon.logging?.logger.info("fieldd.diagnostics.local_record", "local diagnostic", {
      safe: true,
    });
    fixture.native.diagnosticCursor = 1;
    fixture.native.diagnosticRecords = [
      nativeRecord(fixture, "field_native.diagnostics.native_record", 1),
    ];
    const historicalNative = {
      ...nativeRecord(fixture, "field_native.diagnostics.historical_record", 7),
      time: Date.now() - 5_000,
      bootId: "prior-native-boot",
      instanceId: "prior-native-boot",
    };
    const nativeStreamName = LOG_STREAMS.SYSTEM_FIELD_NATIVE.split("/").at(-1);
    expect(nativeStreamName).toBeDefined();
    writeFileSync(
      join(fixture.root, "logs", "system", `${nativeStreamName}.ndjson`),
      `${JSON.stringify(historicalNative)}\n`,
      { mode: 0o600 },
    );

    const client = await rpc(fixture);
    const snapshot = (await client.call("diagnostics.query", {
      sources: [LOG_STREAMS.SYSTEM_FIELDD, LOG_STREAMS.SYSTEM_FIELD_NATIVE],
      text: "diagnostic",
      limit: 100,
    })) as DiagnosticLogSnapshotV1;
    expect(snapshot.producers.map((producer) => producer.stream)).toEqual(
      expect.arrayContaining(["system/fieldd", "system/field-native"]),
    );
    expect(snapshot.records.map((record) => record.event)).toEqual(
      expect.arrayContaining([
        "fieldd.diagnostics.local_record",
        "field_native.diagnostics.native_record",
        "field_native.diagnostics.historical_record",
      ]),
    );
    expect(snapshot.nextCursor.length).toBeGreaterThan(0);
    expect(snapshot.history).toMatchObject({
      scannedSegments: expect.any(Number),
      parseFailures: 0,
    });

    const narrow = fixture.daemon.tokens.mint(["workspace.read"], "no-diagnostics");
    const deniedClient = await rpc(fixture, narrow.token);
    const denied = await deniedClient.callErr("diagnostics.query", {
      sources: ["system/fieldd"],
      limit: 10,
    });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");

    const malformed = await client.callErr("diagnostics.query", {
      sources: [],
      limit: 100_000,
    });
    expect(malformed.data?.kind).toBe("PRECONDITION_FAILED");
  });

  it("streams at most ten batches per second, disposes cleanly, and resnapshots native reboot", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    const local = (await client.call("diagnostics.subscribe", {
      sources: ["system/fieldd"],
      limit: 100,
    })) as { subId: string; snapshot: DiagnosticLogSnapshotV1 };

    fixture.daemon.logging?.logger.info("fieldd.diagnostics.live_record", "live diagnostic");
    await until(() =>
      client.notifications.some(
        (notification) =>
          notification.method === "diagnostics.delta" &&
          notification.params.subId === local.subId &&
          (notification.params.payload as DiagnosticLogDeltaV1).records.some(
            (record) => record.event === "fieldd.diagnostics.live_record",
          ),
      ),
    );

    const removed = (await client.call("system.unsubscribe", { subId: local.subId })) as {
      removed: boolean;
    };
    expect(removed.removed).toBe(true);
    const count = client.notifications.length;
    fixture.daemon.logging?.logger.info("fieldd.diagnostics.after_unsubscribe", "must not stream");
    await new Promise((resolve) => setTimeout(resolve, 175));
    expect(client.notifications).toHaveLength(count);

    const native = (await client.call("diagnostics.subscribe", {
      sources: ["system/field-native"],
      limit: 100,
    })) as { subId: string; snapshot: DiagnosticLogSnapshotV1 };
    fixture.native.diagnosticBootId = "mock-native-reboot";
    fixture.native.diagnosticCursor = 1;
    fixture.native.diagnosticRecords = [
      nativeRecord(fixture, "field_native.diagnostics.after_reboot", 1),
    ];
    fixture.native.pushDiagnosticSnapshot();
    await until(() =>
      client.notifications.some(
        (notification) =>
          notification.method === "diagnostics.snapshot" &&
          notification.params.subId === native.subId &&
          (notification.params.payload as DiagnosticLogSnapshotV1).producers.some(
            (producer) => producer.bootId === "mock-native-reboot",
          ),
      ),
    );
  });

  it("creates, lists, revokes, and producer-enforces bounded diagnostic leases", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    const lease = (await client.call("diagnostics.lease.create", {
      selector: { kind: "component", service: "fieldd", component: "diagnostics.test" },
      level: "debug",
      duration: "15m",
    })) as DiagnosticLeaseV1;
    expect(lease.expiresAt - lease.createdAt).toBe(15 * 60 * 1_000);
    expect(fixture.daemon.logging?.health().activeLeaseCount).toBe(1);

    const target = fixture.daemon.logging?.logger.child({ component: "diagnostics.test" });
    target?.debug("fieldd.diagnostics.leased_debug", "debug admitted by lease");
    expect(
      fixture.daemon.logging
        ?.recent()
        .records.some((record) => record.event === "fieldd.diagnostics.leased_debug"),
    ).toBe(true);

    const list = (await client.call("diagnostics.lease.list", {})) as DiagnosticLeaseListV1;
    expect(list.leases.map((entry) => entry.leaseId)).toContain(lease.leaseId);
    expect(await client.call("diagnostics.lease.revoke", { leaseId: lease.leaseId })).toEqual({
      revoked: true,
    });
    expect(fixture.daemon.logging?.health().activeLeaseCount).toBe(0);

    target?.debug("fieldd.diagnostics.revoked_debug", "debug rejected after revoke");
    expect(
      fixture.daemon.logging
        ?.recent()
        .records.some((record) => record.event === "fieldd.diagnostics.revoked_debug"),
    ).toBe(false);

    const nativeLease = (await client.call("diagnostics.lease.create", {
      selector: { kind: "service", service: "field-native" },
      level: "debug",
      duration: "15m",
    })) as DiagnosticLeaseV1;
    expect(fixture.native.diagnosticLeases.has(nativeLease.leaseId)).toBe(true);
    const withNative = (await client.call("diagnostics.lease.list", {})) as DiagnosticLeaseListV1;
    expect(withNative.leases).toContainEqual(nativeLease);
    expect(await client.call("diagnostics.lease.revoke", { leaseId: nativeLease.leaseId })).toEqual(
      { revoked: true },
    );
    expect(fixture.native.diagnosticLeases.has(nativeLease.leaseId)).toBe(false);

    const nativeComponent = await client.callErr("diagnostics.lease.create", {
      selector: {
        kind: "component",
        service: "field-native",
        component: "native.mesh",
      },
      level: "debug",
      duration: "15m",
    });
    expect(nativeComponent.data?.kind).toBe("PRECONDITION_FAILED");

    const wrongOwner = await client.callErr("diagnostics.lease.create", {
      selector: { kind: "service", service: "renderer" },
      level: "debug",
      duration: "15m",
    });
    expect(wrongOwner.data?.kind).toBe("PRECONDITION_FAILED");

    const pluginGrant = fixture.daemon.tokens.mint(["diagnostics.manage"], "hostile-plugin", {
      pluginId: "vibefield.test.plugin",
    });
    const plugin = await rpc(fixture, pluginGrant.token);
    const pluginDenied = await plugin.callErr("diagnostics.lease.create", {
      selector: { kind: "service", service: "fieldd" },
      level: "debug",
      duration: "15m",
    });
    expect(pluginDenied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });
});
