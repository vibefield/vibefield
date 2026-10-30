import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// TS-6 (track TS, TS-D13 = A; DESIGN.md §8 "The sync question") — the sync
// question is asked at the first new field after connecting, and the fields
// made before stay on this Mac unless the person adds them. Before TS-6 the
// Setup Assistant asked the posture; once it stops, an unset field follows the
// default ("automatic") and a link would carry every earlier field away. So a
// link that LANDS (a sign-in, never a linked boot) keeps each field with no
// answer of its own here and owes the question; a Mac linked before TS-6 keeps
// what it syncs and is never asked (TS-D13, VF-PM 2026-10-29 05:13Z).

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

interface Doc {
  docId: string;
  name: string;
  syncIntent?: string;
}

function dataRoot(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ts6-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  return dataDir;
}

const health = (meshState: string) => ({
  state: "up",
  bootId: "ts6-floor",
  units: [{ unit: "mesh-gateway", state: meshState }],
});

/** a floor that holds nothing until the link act, then a capture (TS-1's) */
async function unlinkedFloor(dataDir: string): Promise<MockMgmtServer> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.meshPosture = null;
  mock.meshCaptureSignIn = { authUrl: "https://login.tailscale.com/a/ts6" };
  mock.healthSnapshot = health("disabled");
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

async function connect(daemon: FielddDaemon, token: string, kind: "shell-main" | "renderer") {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, token, kind);
  return rpc;
}

async function boot(dataDir: string) {
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  const shell = await connect(daemon, daemon.shellToken, "shell-main");
  const window = await connect(
    daemon,
    daemon.tokens.mint(["doc.read", "doc.write", "settings.manage"], "ts6-window").token,
    "renderer",
  );
  return { daemon, shell, window };
}

/** the person signs in: begun from the window, finished in the browser */
async function signIn(mock: MockMgmtServer, shell: WsRpc): Promise<void> {
  await shell.call("user.link.begin", {});
  mock.meshCaptureSignIn = { authUrl: "https://login.tailscale.com/a/ts6", login: TEST_LOGIN };
  mock.pushHealth(health("up"));
  await until(
    () => mock.meshStarts.some((start) => start["mode"] === "linked"),
    5_000,
    "the promotion that follows the captured login",
  );
}

async function docs(window: WsRpc): Promise<Map<string, Doc>> {
  const listed = (await window.call("doc.list", {})) as { docs: Doc[] };
  return new Map(listed.docs.map((doc) => [doc.name, doc]));
}

async function question(window: WsRpc): Promise<unknown> {
  const ledger = (await window.call("setup.get", {})) as { moments?: Record<string, unknown> };
  return ledger.moments?.["sync-question"];
}

describe("TS-6 — the fields made before connecting stay on this Mac (TS-D13)", () => {
  it("keeps each earlier field here when a sign-in lands, and owes the question", async () => {
    const dataDir = dataRoot();
    const mock = await unlinkedFloor(dataDir);
    const { shell, window } = await boot(dataDir);
    await window.call("doc.create", { name: "Sketches" });
    await window.call("doc.create", { name: "Taxes" });

    await signIn(mock, shell);

    const held = await docs(window);
    expect(held.get("Sketches")?.syncIntent).toBe("local");
    expect(held.get("Taxes")?.syncIntent).toBe("local");
    expect(await question(window)).toMatchObject({ state: "owed" });

    // a field made after the link has no answer of its own: the posture decides
    await window.call("doc.create", { name: "After" });
    expect((await docs(window)).get("After")?.syncIntent).toBeUndefined();
  }, 30_000);

  it("leaves a field's own answer alone: one already kept home or sent stays so", async () => {
    const dataDir = dataRoot();
    const mock = await unlinkedFloor(dataDir);
    const { shell, window } = await boot(dataDir);
    const sent = (await window.call("doc.create", { name: "Shared" })) as Doc;
    await window.call("doc.setSyncIntent", { docId: sent.docId, intent: "sync" });

    await signIn(mock, shell);

    expect((await docs(window)).get("Shared")?.syncIntent).toBe("sync");
  }, 30_000);

  it("asks nothing again once answered: a link after the answer keeps no field", async () => {
    const dataDir = dataRoot();
    const mock = await unlinkedFloor(dataDir);
    const { shell, window } = await boot(dataDir);
    await window.call("setup.moment", { moment: "sync-question", state: "retired" });
    await window.call("doc.create", { name: "Sketches" });

    await signIn(mock, shell);

    expect((await docs(window)).get("Sketches")?.syncIntent).toBeUndefined();
    expect(await question(window)).toMatchObject({ state: "retired" });
  }, 30_000);

  it("keeps what a Mac linked before TS-6 syncs, and never asks it", async () => {
    const dataDir = dataRoot();
    const first = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await first.start();
    const before = await boot(dataDir);
    await before.window.call("doc.create", { name: "Sketches" });
    await before.daemon.stop();
    await first.stop();

    // the link was captured by a build before TS-6: this boot reads it from disk
    writeLinkFixture(dataDir);
    const floor = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await floor.start();
    cleanup.push(() => floor.stop());
    const { window } = await boot(dataDir);
    await until(
      () => floor.meshStarts.some((start) => start["mode"] === "linked"),
      5_000,
      "the linked boot's posture",
    );

    expect((await docs(window)).get("Sketches")?.syncIntent).toBeUndefined();
    expect(await question(window)).toBeUndefined();
  }, 30_000);

  it("is fieldd's to owe: a window's `owed` is refused", async () => {
    const dataDir = dataRoot();
    await unlinkedFloor(dataDir);
    const { window } = await boot(dataDir);
    const refused = await window.callErr("setup.moment", {
      moment: "sync-question",
      state: "owed",
    });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(await question(window)).toBeUndefined();
  }, 30_000);
});
