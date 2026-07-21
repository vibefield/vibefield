// MeshClient (C2): declarative serve replay-set + honest UNAVAILABLE handling,
// against the scripted mock (no cargo, no tailnet).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MeshClient } from "../src/mesh-client";
import { NativeLink } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: timeout");
    await sleep(25);
  }
}

async function setup(): Promise<{ mock: MockMgmtServer; link: NativeLink; mesh: MeshClient }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-mesh-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dir, "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({
    socketPath: join(dir, "mgmt.sock"),
    pairingFile: join(dir, "pairing"),
    bootId: "b",
  });
  cleanup.push(() => link.close());
  const mesh = new MeshClient(link);
  await link.connect();
  return { mock, link, mesh };
}

describe("MeshClient", () => {
  it("declares serves through the facade and captures URLs", async () => {
    const { mock, mesh } = await setup();
    const states = await mesh.setServes([
      { name: "site", target: { kind: "dir", path: "/tmp/site" } },
      { name: "api", target: { kind: "port", port: 3000 } },
    ]);
    expect(states.map((s) => s.status)).toEqual(["active", "active"]);
    expect(states[0]!.url).toBe("https://mock.ts.net/site");
    expect(mock.meshAddCalls).toBe(2);

    // dropping one from the desired set removes it at the node
    await mesh.setServes([{ name: "api", target: { kind: "port", port: 3000 } }]);
    expect(mock.meshRemoveCalls).toBe(1);
    expect(mock.meshServes.has("site")).toBe(false);
  });

  it("re-serving is re-creating: a fresh node gets the desired set replayed", async () => {
    const { mock, mesh } = await setup();
    mock.clearServesOnDisconnect = true; // serves live in the node; node dies with the conn
    await mesh.setServes([{ name: "site", target: { kind: "dir", path: "/tmp/site" } }]);
    expect(mock.meshAddCalls).toBe(1);

    mock.killClients(); // native restart
    await until(() => mock.meshAddCalls === 2, 6000); // reconnect → reconcile → re-add
    expect(mock.meshServes.has("site")).toBe(true);
    expect(mesh.serves()[0]!.status).toBe("active");
  });

  it("mesh UNAVAILABLE marks serves pending and emits, not throws", async () => {
    const { mock, mesh } = await setup();
    mock.meshUnavailable = true;
    let details: unknown = null;
    mesh.on("unavailable", (d) => (details = d));
    const states = await mesh.setServes([
      { name: "site", target: { kind: "dir", path: "/tmp/site" } },
    ]);
    expect(states[0]!.status).toBe("pending");
    expect((details as { state?: string } | null)?.state).toBe("starting");
  });

  it("store passthrough returns the slice snapshot", async () => {
    const { mesh } = await setup();
    const snap = (await mesh.openStore("field.docs.v1")) as {
      storeId: string;
      slices: Record<string, unknown>;
    };
    expect(snap.storeId).toBe("field.docs.v1");
    expect(Object.keys(snap.slices)).toEqual(["dev-self"]);
  });
});
