// NF-3 end-to-end over the REAL floor: fieldd (TypeScript) against the real
// field-native (Rust) — the pairing hello delivers the endpoints, a free shell
// is born over the product plane, the observed inventory carries it back, a D6
// ticket attaches an external ghosttea client, the epoch path accepts
// automation input, and terminate runs the real ladder. This is the seam half
// of the spec's §9 NF-3 gate; the kill matrix proper is NF-4.
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import type { TerminalInfo, TerminalTicket } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap } from "../src/index";
import { nativeBinPath, shortTmpRoot, waitForMgmtEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);

let children: ChildProcess[] = [];
let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  // error-isolated: a rejecting cleanup must not leak the daemons behind it
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already-stopped is fine */
    }
  }
  for (const c of children) c.kill("SIGKILL");
  children = [];
});

async function spawnNative(): Promise<string> {
  // the short-root rule (and why unix keeps /tmp) lives in native-harness.ts
  const dir = shortTmpRoot("vf-seam-");
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const child = spawn(BIN, [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dir,
      FIELD_LOG_DIR: join(dir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  children.push(child);
  await waitForMgmtEndpoint(dir, 15_000);
  return dir;
}

async function poll<T>(fn: () => Promise<T | undefined>, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Windows terminal hosting is WIN-6 (ConPTY) — thinking-windows-port §6; the mesh/health surface is covered elsewhere
describe.skipIf(process.platform === "win32")("the terminal seam (NF-3, real field-native)", () => {
  it("create → observe → ticket-attach → automate → terminate, one authority", async () => {
    const dataDir = await spawnNative();
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "seam-test");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    cleanup.push(() => ws.close());
    const rpc = new WsRpc(ws);
    await helloAs(rpc, grant.token);

    // the free-shell door (an explicit program: quiet, portable, no login shell)
    const created = (await rpc.call("terminal.create", { shell: "/bin/cat" })) as {
      sessionId: string;
    };
    expect(created.sessionId).toBeTruthy();

    // the observed inventory carries it back within the backstop (<2s law)
    const row = await poll(async () => {
      const { terminals } = (await rpc.call("terminal.list", {})) as {
        terminals: TerminalInfo[];
      };
      return terminals.find((t) => t.sessionId === created.sessionId);
    });
    expect(row.pid).toBeGreaterThan(0);

    // D6 ticket → an EXTERNAL ghosttea client attaches to the same authority
    const ticket = (await rpc.call("terminal.openTicket", {
      sessionId: created.sessionId,
    })) as TerminalTicket;
    const client = new GhostteaAutomationClient(
      { controlSocket: ticket.controlSocket, authToken: ticket.token },
      { clientBuild: "vibefield-seam-test" },
    );
    cleanup.push(() => client.dispose());
    await client.connect();
    const sessions = await client.listSessions();
    expect(sessions.map((s) => s.id)).toContain(created.sessionId);

    // the epoch path accepts automation input (paste+submit is one atomic op)
    const input = await client.pasteAndSubmit(created.sessionId, "hello-floor");
    expect(input.accepted).toBe(true);

    // terminate over the product plane: the real ladder runs on the floor
    const term = (await rpc.call("terminal.terminate", {
      sessionId: created.sessionId,
    })) as { terminated: boolean };
    expect(term.terminated).toBe(true);
    await poll(async () => {
      const { terminals } = (await rpc.call("terminal.list", {})) as {
        terminals: TerminalInfo[];
      };
      return terminals.some((t) => t.sessionId === created.sessionId) ? undefined : true;
    }, 10_000);

    // terminate is idempotent: the gone session is the normal race, not an error
    const again = (await rpc.call("terminal.terminate", {
      sessionId: created.sessionId,
    })) as { terminated: boolean };
    expect(again.terminated).toBe(false);
  }, 60_000);

  it("create answers with a ticket that attaches immediately — no observe window (GT-1)", async () => {
    const dataDir = await spawnNative();
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "seam-test");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    cleanup.push(() => ws.close());
    const rpc = new WsRpc(ws);
    await helloAs(rpc, grant.token);

    const created = (await rpc.call("terminal.create", { shell: "/bin/cat" })) as {
      sessionId: string;
      ticket: TerminalTicket;
    };
    // NOT polled, NOT retried: the very next statement attaches. GT-0 measured
    // this window at 62-117ms of NOT_FOUND from openTicket, and the retry loop
    // that hid it is deleted — if the mint ever goes back through the observed
    // inventory, this test fails on the first run rather than flaking later.
    const client = new GhostteaAutomationClient(
      { controlSocket: created.ticket.controlSocket, authToken: created.ticket.token },
      { clientBuild: "vibefield-seam-test" },
    );
    cleanup.push(() => client.dispose());
    await client.connect();
    const sessions = await client.listSessions();
    expect(sessions.map((s) => s.id)).toContain(created.sessionId);

    // fieldd's OWN inventory has not necessarily caught up yet — that is the
    // whole asymmetry, and openTicket still honestly refuses what it has not
    // seen. Both answers are correct at the same instant.
    const observedNow = ((await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] })
      .terminals;
    if (!observedNow.some((t) => t.sessionId === created.sessionId)) {
      const refused = await rpc.call("terminal.openTicket", { sessionId: created.sessionId }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).not.toBeNull();
    }

    // and once observed, the attach-to-existing door works as it always did
    await poll(async () => {
      const { terminals } = (await rpc.call("terminal.list", {})) as {
        terminals: TerminalInfo[];
      };
      return terminals.some((t) => t.sessionId === created.sessionId) ? true : undefined;
    });
    const attach = (await rpc.call("terminal.openTicket", {
      sessionId: created.sessionId,
    })) as TerminalTicket;
    expect(attach).toEqual(created.ticket);

    await rpc.call("terminal.terminate", { sessionId: created.sessionId });
  }, 60_000);
});
