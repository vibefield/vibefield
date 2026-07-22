import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFielddSupervisor, tryAdopt } from "../src/index";
import { createHarness, FIXTURE_READY, type Harness } from "./helpers";

// §12.2 ownership distinction + stop-owned vs leave-running + "no adopted
// process is ever killed". The law: the shell never terminates what it did not
// spawn — adopted stopOwned()/dispose() leave the daemon answering; a SPAWNED
// child obeys the shutdown policy.

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function spawnReady(
  root: string,
  port: number,
  token: string,
  policy: "leave-running" | "stop-owned",
) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_READY);
  const sup = h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: { CV: CONTRACTS_VERSION, TEST_PRODUCT_PORT: String(port), SHELL_TOKEN: token },
      shutdownPolicy: policy,
      adoptProbeMs: 300,
      readinessDeadlineMs: 3000,
    }),
  );
  const handle = await sup.ensure();
  return { sup, handle };
}

describe("ownership: adopted daemons are never killed", () => {
  it("stopOwned() on an adopted handle is a no-op — the daemon keeps answering", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token });
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "stop-owned",
        adoptProbeMs: 800,
        readinessDeadlineMs: 3000,
      }),
    );

    const handle = await sup.ensure();
    expect(handle.ownership).toBe("adopted");
    await handle.stopOwned(); // must NOT tear anything down
    // the in-test "daemon" still answers on the same client
    await expect(handle.client.request("system.health")).resolves.toMatchObject({ ok: true });
  });

  it("dispose(stop-owned) on an adopted handle still leaves the daemon alive", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token });
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "stop-owned",
        adoptProbeMs: 800,
        readinessDeadlineMs: 3000,
      }),
    );

    const handle = await sup.ensure();
    expect(handle.ownership).toBe("adopted");
    await sup.dispose(); // closes our client, but must not kill the daemon

    // a FRESH probe still adopts it — the server is up (adopted, never killed)
    const reprobe = await tryAdopt(root, 800);
    expect(reprobe.ok).toBe(true);
    if (reprobe.ok) reprobe.client.close();
  });
});

describe("ownership: a spawned child obeys the shutdown policy", () => {
  it("stop-owned dispose() SIGKILLs the spawned child", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const { sup, handle } = await spawnReady(root, port, token, "stop-owned");
    const pid = handle.childPid;
    expect(pid).toBeGreaterThan(0);
    expect(alive(pid as number)).toBe(true);

    await sup.dispose();
    expect(alive(pid as number)).toBe(false); // stop-owned tore the child down
  });

  it("leave-running dispose() leaves the spawned child alive", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const { sup, handle } = await spawnReady(root, port, token, "leave-running");
    const pid = handle.childPid as number;
    h.trackPid(pid); // cleanup kills it — dispose won't
    expect(alive(pid)).toBe(true);

    await sup.dispose();
    expect(alive(pid)).toBe(true); // the two-plane law: daemon outlives the shell
  });
});
