import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// AO-2 — the Setup Assistant's ledger through its doors (design-03 §4.3's
// `setup.*`): a window answers a step and hides Finish setting up, every
// subscriber hears the change, the answer is on disk under the user's root, a
// malformed answer is refused in words, and only a trusted desktop caller gets
// in — the app preferences' posture (app-preferences.integration.test.ts).

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

async function fixture(): Promise<{ daemon: FielddDaemon; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-setup-ledger-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  cleanup.push(() => native.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, dataDir };
}

async function connect(
  daemon: FielddDaemon,
  token: string,
  clientKind: "shell-main" | "renderer" | "debug",
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

describe("the setup ledger's doors (AO-2)", () => {
  it("answers, hides and streams, and keeps the answer under the user's root", async () => {
    const { daemon, dataDir } = await fixture();
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    const sub = (await shell.call("setup.subscribe", {})) as {
      subId: string;
      snapshot: unknown;
    };
    expect(sub.snapshot).toEqual({ format: 1, steps: {}, hidden: false });

    const window = await connect(
      daemon,
      daemon.tokens.mint(["settings.manage"], "test-window").token,
      "renderer",
    );
    const answered = (await window.call("setup.answer", {
      step: "devices",
      state: "later",
    })) as { steps: Record<string, { state: string }> };
    expect(answered.steps.devices?.state).toBe("later");
    await until(() =>
      shell.notifications.some(
        (notification) =>
          notification.method === "setup.delta" &&
          notification.params.subId === sub.subId &&
          (notification.params.payload as { steps?: Record<string, unknown> } | undefined)?.steps
            ?.devices !== undefined,
      ),
    );

    await window.call("setup.hide", { hidden: true });
    expect(await shell.call("setup.get", {})).toMatchObject({
      hidden: true,
      steps: { devices: { state: "later" } },
    });
    const file = join(dataDir, ...LAYOUT.SETUP_LEDGER_FILE);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      hidden: true,
      steps: { devices: { state: "later" } },
    });

    // a step or a state this build does not know is refused in words
    const refused = await window.callErr("setup.answer", { step: "skills", state: "later" });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(refused.message).toContain("agents|profiles|history|devices");

    // AO-6b (AO-D15) — a moment's Not now, beside the steps, in the same file
    const retired = await window.call("setup.moment", { moment: "limit", state: "retired" });
    expect(retired).toMatchObject({ moments: { limit: { state: "retired" } } });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      moments: { limit: { state: "retired" } },
    });
    // TS-D18 — a keyed moment: one record per name and key, the key as written
    const joined = "device-joined:01JB8ZQ4N7M2X5K9T3V6W8Y0RC";
    await window.call("setup.moment", { moment: joined, state: "retired" });
    expect(JSON.parse(readFileSync(file, "utf8")).moments).toMatchObject({
      limit: { state: "retired" },
      [joined]: { state: "retired" },
    });
    const malformed = await window.callErr("setup.moment", { moment: "Limit", state: "retired" });
    expect(malformed.data?.kind).toBe("PRECONDITION_FAILED");
  });

  it("requires both the local scope and a trusted desktop client kind", async () => {
    const { daemon } = await fixture();
    const debug = await connect(daemon, daemon.shellToken, "debug");
    expect((await debug.callErr("setup.get", {})).data?.kind).toBe("FORBIDDEN_SCOPE");

    const pluginGrant = daemon.tokens.mint(["settings.manage"], "hostile-plugin", {
      pluginId: "vibefield.hostile",
    });
    const plugin = await connect(daemon, pluginGrant.token, "renderer");
    expect(
      (await plugin.callErr("setup.answer", { step: "history", state: "answered" })).data?.kind,
    ).toBe("FORBIDDEN_SCOPE");
  });
});
