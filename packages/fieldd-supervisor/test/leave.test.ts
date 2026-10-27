import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFielddSupervisor } from "../src/index";
import { createHarness, type Harness } from "./helpers";

// AL-7 (`draft/thinking-app-lifecycle.md` §8.1) — a shell that leaves a pair running ON PURPOSE says why on the client
// it holds, before that client closes (`system.shell.leave`), so the pair records a planned exit; a dispose with
// nothing to say says nothing, and the pair reads the close as unplanned.

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

async function adoptedPair() {
  const product = await h.startProduct({ scopes: ["native.admin"] });
  const heard: unknown[] = [];
  product.api.register("system.shell.leave", (_ctx, params) => {
    heard.push(params);
    return { noted: true };
  });
  const root = h.mkRoot();
  h.writeRunFiles(root, {
    port: product.port,
    pid: process.pid,
    token: product.token,
    bootId: "boot-a",
  });
  const sup = h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: ["-e", "process.exit(9)"] },
      environment: { CV: CONTRACTS_VERSION },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 1500,
    }),
  );
  const handle = await sup.ensure();
  expect(handle.ownership).toBe("adopted");
  return { sup, handle, heard, product };
}

describe("dispose says why the shell leaves (AL-7)", () => {
  it("a dispose with a reason says it on the held client, then closes it", async () => {
    const { sup, handle, heard } = await adoptedPair();
    await sup.dispose({ leave: "restart" });
    expect(heard).toEqual([{ why: "restart" }]);
    expect(handle.client.status).toBe("closed");
  });

  it("a dispose with nothing to say says nothing (the pair reads the close as unplanned)", async () => {
    const { sup, heard } = await adoptedPair();
    await sup.dispose();
    expect(heard).toEqual([]);
  });

  it("a pair already gone hears no leave, and the dispose does not wait on it", async () => {
    const { sup, handle, product } = await adoptedPair();
    product.api.close(); // the pair stopped (a quit's consented stop) before the shell disposed
    await vi.waitFor(() => expect(handle.client.status).not.toBe("ready"));
    const started = Date.now();
    await sup.dispose({ leave: "quit" });
    expect(Date.now() - started).toBeLessThan(500);
  });
});
