// DS-5c (D3) — UA-P-D5 at the daemon: "a phone never receives a document",
// INBOUND. The unit rows (doc-sync-service.test.ts) prove the gate; this row
// proves the WIRING — that the daemon asks the roster, in the dial keyspace
// lanes are keyed by (`tailscaleId`; feeding the roster ULID here is the T1 §6
// bug class), whether the peer that opened a lane is a desktop that hosts
// documents. Against the mock floor: one self desktop whose slice says
// `docHost`, one self phone that publishes no slice at all.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  encodeMeshDataFrame,
  MESHDATA_FRAME,
  MESHDATA_INBOUND_LANE_ID_BASE,
  MeshDataFrameReader,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/index";
import { systemAccount, systemDocId } from "../src/library-doc";
import { computeAckMac } from "../src/pairing";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** The meshdata bridge field-native would be: it accepts fieldd's HELLO and
 * proves the pairing secret (WIN-10), so the daemon's doc sync starts. */
async function meshDataBridge(dataDir: string): Promise<void> {
  const secretHex = "ab".repeat(32);
  const sockets: Socket[] = [];
  const server = createServer((sock) => {
    sockets.push(sock);
    const reader = new MeshDataFrameReader();
    sock.on("data", (chunk: Buffer) => {
      for (const frame of reader.push(new Uint8Array(chunk))) {
        if (frame.kind !== MESHDATA_FRAME.HELLO) continue;
        const hello = JSON.parse(new TextDecoder().decode(frame.payload)) as {
          bootId: string;
          nonce: string;
        };
        const proof = { serverMac: computeAckMac(secretHex, hello.nonce, hello.bootId) };
        sock.write(
          encodeMeshDataFrame(
            MESHDATA_FRAME.HELLO_OK,
            0,
            new TextEncoder().encode(JSON.stringify(proof)),
          ),
        );
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(nativeEndpoint(dataDir, SOCKETS.MESHDATA), resolve),
  );
  cleanup.push(() => {
    for (const sock of sockets) sock.destroy();
    server.close();
  });
}

describe("D3 — the daemon refuses a phone's doc lane, inbound (UA-P-D5)", () => {
  it("a lane from the account's phone is refused and closed; the same lane from a docHost desktop is claimed", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-admit-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    writeLinkFixture(dataDir); // a linked account: the account gate has a login to compare
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    mock.meshDeviceId = "dev-a";
    // Both peers are THIS account's — the tailnet's WhoIs says so — so the
    // account gate admits both. Only the desktop publishes a slice.
    mock.meshPeers = [
      {
        id: "node-b",
        deviceId: "dev-b",
        name: "desk-b",
        online: true,
        whois: { login: TEST_LOGIN, deviceName: "desk-b.tailnet.ts.net" },
      },
      {
        id: "node-phone",
        deviceId: "dev-phone",
        name: "phone",
        online: true,
        whois: { login: TEST_LOGIN, deviceName: "phone.tailnet.ts.net" },
      },
    ];
    mock.storeSlices.set("dev-b", {
      deviceId: "dev-b",
      name: "desk-b",
      platform: "darwin",
      headless: false,
      fielddVersion: "0.1.0",
      contractsVersion: CONTRACTS_VERSION,
      capabilities: { terminalHost: true, docHost: true, push: false },
      bootId: "boot-b",
      publishedAt: Date.now(),
    });
    await mock.start();
    cleanup.push(() => mock.stop());
    await meshDataBridge(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    // Doc sync is live and the roster is bound: the library's eager lane
    // toward the desktop was asked for.
    const libraryId = systemDocId("library", systemAccount(TEST_LOGIN, undefined));
    await until(
      () =>
        mock.meshLaneOpens.some(
          (lane) =>
            lane.protocol === "doc-sync" && lane.peer === "node-b" && lane.docId === libraryId,
        ),
      8000,
    );

    const closesBefore = mock.meshCalls.filter((m) => m === "native.mesh.lane.close").length;
    // The phone opens a doc lane toward this desktop…
    const phoneDoc = randomUUID();
    mock.pushDelta("lane.subscribe", {
      kind: "peerOpened",
      laneId: MESHDATA_INBOUND_LANE_ID_BASE + 1,
      peer: "node-phone",
      protocol: "doc-sync",
      docId: phoneDoc,
      inbound: true,
    });
    // …and so does the desktop, for another canvas: the CONTROL. A claimed
    // lane is answered by a return lane — the open this floor is asked for.
    const deskDoc = randomUUID();
    mock.pushDelta("lane.subscribe", {
      kind: "peerOpened",
      laneId: MESHDATA_INBOUND_LANE_ID_BASE + 2,
      peer: "node-b",
      protocol: "doc-sync",
      docId: deskDoc,
      inbound: true,
    });
    await until(
      () => mock.meshLaneOpens.some((lane) => lane.peer === "node-b" && lane.docId === deskDoc),
      8000,
    );
    await new Promise((r) => setTimeout(r, 300));
    // The phone got no return lane — so no VERSION, no checkpoint, no update
    // could ever have left toward it — and its lane was closed.
    expect(mock.meshLaneOpens.filter((lane) => lane.peer === "node-phone")).toEqual([]);
    expect(mock.meshCalls.filter((m) => m === "native.mesh.lane.close").length).toBeGreaterThan(
      closesBefore,
    );
  }, 30_000);
});
