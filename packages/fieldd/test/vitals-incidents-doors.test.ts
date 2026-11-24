import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import { VitalsIncidentV1, VitalsSnapshotV1 } from "@vibefield/contracts/vitals";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

// VT-4b (track VT, 2026-11-24) — incidents on a real fieldd over a scripted floor: the previous fieldd's crash note
// becomes a kept incident at boot, Electron main's report is kept and read back whole, and the doors answer the
// shell alone. The keeper's own rules are `vitals-incidents.test.ts`.

interface Fixture {
  root: string;
  dataDir: string;
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

async function setup(before?: (dataDir: string) => void): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "vf-incidents-doors-"));
  const dataDir = join(root, "data");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  before?.(dataDir);
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  const daemon = await bootstrap({
    dataDir,
    logRoot: join(root, "logs"),
    controlPort: 0,
    dataPort: 0,
  });
  const fixture = { root, dataDir, daemon, native, sockets: [] };
  fixtures.push(fixture);
  return fixture;
}

async function rpc(
  fixture: Fixture,
  token = fixture.daemon.shellToken,
  clientKind = "shell-main",
): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${fixture.daemon.controlPort}`);
  fixture.sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new WsRpc(socket);
  await helloAs(client, token, clientKind);
  return client;
}

async function snapshotOf(client: WsRpc): Promise<VitalsSnapshotV1> {
  const result = (await client.call("vitals.subscribe", {})) as { snapshot: unknown };
  return VitalsSnapshotV1.parse(result.snapshot);
}

const T0 = 1_795_478_530_000;

describe("VT-4b — incidents on a real fieldd", () => {
  it("keeps the previous fieldd's crash as an incident at boot, beside the log line VT-4a says", async () => {
    const fixture = await setup((dataDir) => {
      const note = join(dataDir, ...LAYOUT.FIELDD_CRASH_NOTE);
      mkdirSync(join(note, ".."), { recursive: true });
      writeFileSync(
        note,
        JSON.stringify({
          v: 1,
          at: Date.now() - 60_000,
          pid: 39_999,
          bootId: "the-last-boot",
          origin: "uncaughtException",
          name: "RangeError",
          message: "Maximum call stack size exceeded",
          stack: "RangeError: Maximum call stack size exceeded\n    at /a/folder/fieldd.js:1:1",
        }),
      );
    });
    const main = await rpc(fixture);
    const snapshot = await snapshotOf(main);
    expect(snapshot.incidents).toHaveLength(1);
    const [crash] = snapshot.incidents ?? [];
    expect(crash).toMatchObject({
      kind: "crash",
      subject: { group: "fieldd", role: "fieldd", pid: 39_999 },
      detail: { errorName: "RangeError", message: "Maximum call stack size exceeded" },
    });
    const whole = VitalsIncidentV1.parse(
      await main.call("vitals.incidents.get", { id: crash?.id }),
    );
    expect(JSON.stringify(whole)).not.toContain("/a/folder");
    // one file, under the layout's folder
    expect(readdirSync(join(fixture.dataDir, ...LAYOUT.VITALS_INCIDENTS_DIR))).toEqual([
      `${crash?.id}.json`,
    ]);
  });

  it("keeps what main reports, reads it back whole, and answers the shell alone", async () => {
    const fixture = await setup();
    const main = await rpc(fixture);
    const reported = (await main.call("vitals.incident.report", {
      kind: "unresponsive",
      role: "window",
      pid: 3911,
      at: T0,
    })) as { accepted: boolean; id: string };
    expect(reported.accepted).toBe(true);
    expect(
      await main.call("vitals.incident.report", {
        kind: "responsive",
        role: "window",
        pid: 3911,
        at: T0 + 4_200,
      }),
    ).toEqual({ accepted: true, id: reported.id });
    const whole = VitalsIncidentV1.parse(
      await main.call("vitals.incidents.get", { id: reported.id }),
    );
    expect(whole).toMatchObject({
      kind: "unresponsive",
      at: T0,
      endedAt: T0 + 4_200,
      subject: { group: "shell", role: "window", pid: 3911 },
    });
    expect((await snapshotOf(main)).incidents?.map((summary) => summary.id)).toEqual([reported.id]);

    // a window's token may read one, as it may read the census, and may not report even holding the scope
    const windowGrant = fixture.daemon.tokens.mint(
      ["vitals.read", "vitals.report"],
      "vitals-window",
    );
    const window = await rpc(fixture, windowGrant.token, "renderer");
    expect(
      VitalsIncidentV1.parse(await window.call("vitals.incidents.get", { id: reported.id })).id,
    ).toBe(reported.id);
    expect(
      (await window.callErr("vitals.incident.report", { kind: "exit", role: "gpu", at: T0 })).data
        ?.kind,
    ).toBe("FORBIDDEN_SCOPE");

    // a token without the scope never reaches the door
    const narrow = fixture.daemon.tokens.mint(["workspace.read"], "no-vitals");
    const outsider = await rpc(fixture, narrow.token, "renderer");
    expect((await outsider.callErr("vitals.incidents.get", { id: reported.id })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    // and main's report of a role that is not the shell's is refused
    expect(
      (await main.callErr("vitals.incident.report", { kind: "exit", role: "rosettad", at: T0 }))
        .data?.kind,
    ).toBe("PRECONDITION_FAILED");
  });
});
