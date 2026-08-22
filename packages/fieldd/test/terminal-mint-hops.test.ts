// TP-S1m — THE MINT'S OWN HOP LADDER, against a real floor. GATED OFF.
//
// TP-S0c published "`ticket` alone is 202–264 ms, i.e. ~57% of the whole cold
// open is minting the ticket". The cold-open trace could not have known that:
// its first station after `open` was `ticket`, so React's commit, the pool's
// claim, the roster read and the mint's round trip all arrived as ONE number.
// TP-S1m split that station (`godview/cold-open.ts`) and this file measures the
// other half — what the DAEMON does with a mint, separated from what the
// renderer spends getting to one.
//
// FOUR ARMS, interleaved inside one daemon pair, order flipped each round
// (§19: this Mac is always loaded; two runs would vary the floor, the fsync
// queue and the host's mood along with the arm):
//
//   fsync       a 200-byte append + fsync to the same volume — the HOST NULL.
//               Every audit append pays one; without it a slow mint and a slow
//               disk are indistinguishable.
//   roster      `terminal.roster` — a control RPC over the same socket: no
//               audit append, no HMAC. The transport's own cost.
//   openTicket  2 audit appends (attempt + outcome) around an in-memory,
//               microsecond mint. `openTicket - roster` IS the audit's cost.
//   create      4 audit appends around a real spawn across the mgmt channel.
//               `create - openTicket` is the spawn plus two more appends.
//
// Gated because it spawns a session per round and takes ~a minute: the gate
// runs the kill matrix, not a benchmark. Run it deliberately:
//
//   VF_MINT_HOPS=1 pnpm --filter @vibefield/fieldd exec vitest run terminal-mint-hops
//
// It asserts ORDER, not milliseconds — the numbers are the artifact and this
// host's numbers are not another host's. Asserting a millisecond budget here
// would make the suite a weather report.
import { type ChildProcess, spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { nativeBinPath, shortTmpRoot, waitForMgmtEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HOLD = process.platform === "win32" ? (process.env["COMSPEC"] ?? "cmd.exe") : "/bin/cat";
const RUNS = Number(process.env["VF_MINT_HOPS_N"] ?? "25");

let children: ChildProcess[] = [];
let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
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

/** The median, as a point estimate. §19 forbids quoting a tail from this host
 * without an interleaved null arm — which is exactly why the fsync arm exists,
 * so p95 is reported beside it rather than suppressed. */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[at] ?? 0;
}

function line(name: string, samples: readonly number[]): string {
  return (
    `| ${name.padEnd(12)} | ${quantile(samples, 0.5).toFixed(2).padStart(8)} ` +
    `| ${quantile(samples, 0.95).toFixed(2).padStart(8)} ` +
    `| ${Math.max(...samples)
      .toFixed(2)
      .padStart(8)} | ${String(samples.length).padStart(4)} |`
  );
}

describe.skipIf(process.env["VF_MINT_HOPS"] !== "1")("the mint hop ladder (TP-S1m)", () => {
  it("separates the audit's fsyncs from the mint, the transport and the spawn", async () => {
    const dataDir = shortTmpRoot("vf-mint-hops-");
    cleanup.push(() => {
      /* the daemon's own stop removes what it owns; the root is /tmp */
    });
    const native = spawn(nativeBinPath(ROOT), [], {
      env: {
        ...process.env,
        FIELD_NATIVE_DATA_DIR: dataDir,
        FIELD_LOG_DIR: join(dataDir, "logs"),
        FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
      },
      stdio: "ignore",
    });
    children.push(native);
    await waitForMgmtEndpoint(dataDir, 20_000);

    const daemon: FielddDaemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const grant = daemon.tokens.mint(["terminal.attach"], "mint-hops");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    cleanup.push(() => ws.close());
    const rpc = new WsRpc(ws);
    await helloAs(rpc, grant.token);

    // The fsync arm writes to the SAME volume the audit ledger is on, because
    // that is the resource being shared — a null on another disk would be a
    // number about a different device.
    const nullFile = await open(join(dataDir, "fsync-null.log"), "a");
    cleanup.push(() => nullFile.close());
    const payload = Buffer.alloc(200, 0x61);

    // THE COLD PATH, SPLIT IN TWO. `create` waits on `awaitClassCell` (the
    // floor publishing this class's cell — the cell PROCESS booting and paying
    // its hello) and then on `connectedClient` (fieldd's own per-cell control
    // dial, taken lazily on first use). Only the second is fieldd's to warm, so
    // the two are measured apart: `cellReady` is the floor's half, and whatever
    // the cold create costs ABOVE the warm arm after that is the dial's.
    const readyStarted = performance.now();
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const routes = daemon.native.terminalRoutes;
      if (routes?.cells.some((cell) => cell.workloadClass === "interactive")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const cellReadyMs = performance.now() - readyStarted;

    // THE FIRST CREATE, timed on its own and reported beside the steady-state
    // arm. It is the one a user actually waits through — a window that has just
    // come up has nothing to rejoin, so its deck reaches the floor through
    // `create`, and this is that call. Folding it into the `create` arm would
    // hide it inside twenty-five warm siblings; leaving it unmeasured is how
    // TP-S0c came to attribute it to "minting the ticket".
    const coldStarted = performance.now();
    const anchor = (await rpc.call("terminal.create", { shell: HOLD })) as { sessionId: string };
    const coldCreateMs = performance.now() - coldStarted;
    cleanup.push(() =>
      rpc.call("terminal.terminate", { sessionId: anchor.sessionId }).then(
        () => undefined,
        () => undefined,
      ),
    );
    // The inventory is a mgmt round trip behind the spawn (GT-1's window) and
    // `openTicket` gates on it, so waiting for the roster to merely ANSWER is
    // not enough — it answers `observed` with an empty list first, and the
    // first measured `openTicket` then fails NOT_FOUND on a session that
    // certainly exists. Wait for the anchor itself to appear.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const seen = (await rpc.call("terminal.roster", {})) as {
          items: Array<{ sessionId: string }>;
        };
        if (seen.items.some((item) => item.sessionId === anchor.sessionId)) break;
      } catch {
        /* unobserved — the refusal is a state, and the next attempt is the wait */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    // Warm-up, unmeasured: the first call of every arm pays for a segment
    // file that does not exist yet, a lazily built control client, and V8.
    for (let i = 0; i < 3; i += 1) {
      await rpc.call("terminal.roster", {});
      await rpc.call("terminal.openTicket", { sessionId: anchor.sessionId });
      const warm = (await rpc.call("terminal.create", { shell: HOLD })) as { sessionId: string };
      await rpc.call("terminal.terminate", { sessionId: warm.sessionId });
      await nullFile.write(payload);
      await nullFile.sync();
    }

    const samples: Record<string, number[]> = {
      fsync: [],
      roster: [],
      openTicket: [],
      create: [],
      createLogin: [],
      dial: [],
    };
    // THE PER-CELL CONTROL DIAL, on its own. fieldd opens one of these to the
    // create target before it can spawn anything, and TP-S1m moved it off the
    // first create's path by opening it when the cell announces itself instead
    // of when the first caller needs it. This arm is that dial and nothing else
    // — the same endpoints, the same client, the same token — so the size of
    // what was moved is measured rather than inferred from one cold create.
    const target = daemon.native.terminalRoutes?.cells.find(
      (cell) => cell.workloadClass === "interactive",
    );
    const timed = async (arm: string, fn: () => Promise<unknown>): Promise<void> => {
      const started = performance.now();
      await fn();
      samples[arm]?.push(performance.now() - started);
    };

    for (let round = 0; round < RUNS; round += 1) {
      const arms: Array<[string, () => Promise<unknown>]> = [
        [
          "fsync",
          async () => {
            await nullFile.write(payload);
            await nullFile.sync();
          },
        ],
        ["roster", () => rpc.call("terminal.roster", {})],
        ["openTicket", () => rpc.call("terminal.openTicket", { sessionId: anchor.sessionId })],
        [
          "create",
          async () => {
            const made = (await rpc.call("terminal.create", { shell: HOLD })) as {
              sessionId: string;
            };
            // Terminated AFTER the timer stops — a round that left its pty
            // behind would walk this machine's system-wide ceiling of 511 up
            // by one per round, which is how the last lab took the box down.
            queueMicrotask(() => {
              void rpc
                .call("terminal.terminate", { sessionId: made.sessionId })
                .catch(() => undefined);
            });
          },
        ],
        [
          "dial",
          async () => {
            if (target === undefined) return;
            const probe = new GhostteaAutomationClient(
              {
                controlSocket: target.endpoints.controlSocket,
                frameSocket: target.endpoints.frameSocket,
                authToken: target.endpoints.authToken,
              },
              { clientBuild: "mint-hops-dial" },
            );
            try {
              await probe.connect();
            } finally {
              probe.dispose();
            }
          },
        ],
        [
          // THE SHAPE THE DECK ACTUALLY ASKS FOR. `createTerminalSession({
          // workloadClass: "interactive" })` sends no `shell`, so fieldd spawns
          // the user's LOGIN shell with `-l` (NF-D6). The arm above spawns an
          // explicit program instead, and the difference between the two is
          // whatever the login flag costs on this machine — a number that
          // belongs to the user's own profile, not to the pipeline, and which
          // no arm using /bin/cat can see.
          "createLogin",
          async () => {
            const made = (await rpc.call("terminal.create", {
              workloadClass: "interactive",
            })) as { sessionId: string };
            queueMicrotask(() => {
              void rpc
                .call("terminal.terminate", { sessionId: made.sessionId })
                .catch(() => undefined);
            });
          },
        ],
      ];
      // Flip the order every round: a fixed order measures position in the
      // round as much as it measures the arm.
      if (round % 2 === 1) arms.reverse();
      for (const [arm, fn] of arms) await timed(arm, fn);
    }

    const rows = [
      "",
      "TP-S1m — the mint hop ladder (ms, one daemon pair, interleaved, order flipped per round)",
      "",
      "| arm          |      p50 |      p95 |      max |    n |",
      "|--------------|---------:|---------:|---------:|-----:|",
      line("fsync null", samples["fsync"] ?? []),
      line("roster", samples["roster"] ?? []),
      line("openTicket", samples["openTicket"] ?? []),
      line("create", samples["create"] ?? []),
      line("create -l", samples["createLogin"] ?? []),
      line("cell dial", samples["dial"] ?? []),
      "",
      `floor's half — bootstrap to an interactive class cell (n=1): ${cellReadyMs.toFixed(1)} ms`,
      `FIRST create AFTER that (n=1, the one a cold open pays): ${coldCreateMs.toFixed(1)} ms`,
      `audit's share of a mint (openTicket - roster): ${(
        quantile(samples["openTicket"] ?? [], 0.5) - quantile(samples["roster"] ?? [], 0.5)
      ).toFixed(2)} ms`,
      `spawn + 2 appends (create - openTicket): ${(
        quantile(samples["create"] ?? [], 0.5) - quantile(samples["openTicket"] ?? [], 0.5)
      ).toFixed(2)} ms`,
      `the dial TP-S1m moves off the first create: ${quantile(samples["dial"] ?? [], 0.5).toFixed(2)} ms`,
      `the login flag's own cost (create -l - create): ${(
        quantile(samples["createLogin"] ?? [], 0.5) - quantile(samples["create"] ?? [], 0.5)
      ).toFixed(2)} ms`,
      "",
    ];
    process.stdout.write(`${rows.join("\n")}\n`);

    // ORDER, never milliseconds. Each arm strictly contains the one above it
    // in work done, and a run that inverted the ladder would mean the
    // instrument — not the daemon — is what moved.
    const p50 = (arm: string): number => quantile(samples[arm] ?? [], 0.5);
    expect(samples["create"]).toHaveLength(RUNS);
    expect(p50("roster")).toBeLessThan(p50("openTicket"));
    expect(p50("openTicket")).toBeLessThan(p50("create"));
  }, 600_000);
});
