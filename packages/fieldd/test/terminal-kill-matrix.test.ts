// NF-4 — THE kill matrix (native-floor spec §10), executable. The ownership
// law as tests: PTYs live in field-native and survive fieldd; a new fieldd
// adopts the inventory inside the <2s row; a dead floor degrades honestly; the
// env strip holds through the real spawn path; epoch arbitration reaches
// through the D6 ticket; churn leaves no residue. Row 2 (field-native's own
// SIGTERM sweep) is pinned Rust-side in field-native/tests/terminal_unit.rs.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import type { TerminalInfo, TerminalTicket } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { nativeBinPath, shortTmpRoot, waitForMgmtEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);
// WIN-6: on Windows both roles collapse to cmd.exe (the ConPTY shell). On unix
// they stay distinct — /bin/cat holds the PTY open, /bin/sh runs a command.
const WIN = process.platform === "win32";
const CMD = process.env["COMSPEC"] ?? "C:\\Windows\\System32\\cmd.exe";
const HOLD = WIN ? CMD : "/bin/cat";
const SH = WIN ? CMD : "/bin/sh";

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

interface NativeHandle {
  dir: string;
  child: ChildProcess;
}

async function spawnNative(dir?: string): Promise<NativeHandle> {
  const dataDir = dir ?? shortTmpRoot("vf-km-");
  if (dir === undefined) cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const child = spawn(BIN, [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: join(dataDir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
      // §8 — the smuggle bait: these ride field-native's OWN environment and
      // must NEVER appear inside a PTY (the strip is service-side, so even
      // environment:{mode:"inherit"} spawns must lose them).
      FIELD_SMUGGLE: "leak-me",
      FIELDD_SMUGGLE: "leak-me-too",
      // WIN-6 / G13 bait: a CASE-VARIANT of a stripped prefix. On unix this is a
      // genuinely different (non-FIELD_) var; on Windows env is case-insensitive,
      // so it IS a FIELD_ var — and ghosttea's case-sensitive `starts_with` strip
      // may miss it. Whether it leaks is asserted (empirically) below.
      Field_Native_Case_Probe: "CASE_LEAK_WITNESS",
    },
    stdio: "ignore",
  });
  children.push(child);
  await waitForMgmtEndpoint(dataDir, 15_000);
  return { dir: dataDir, child };
}

async function connect(daemon: FielddDaemon): Promise<WsRpc> {
  const grant = daemon.tokens.mint(["terminal.attach"], "kill-matrix");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanup.push(() => ws.close());
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return rpc;
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

const listOf = async (rpc: WsRpc): Promise<TerminalInfo[]> =>
  ((await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] }).terminals;

// WIN-6: ConPTY terminal hosting is live on Windows (the Rust kill matrix runs on
// the box in field-native/tests/terminal_unit.rs), so this NF-4 matrix runs on
// both platforms — the two-plane crash/adopt/re-arm rows are cross-process.
describe("the kill matrix (NF-4, real field-native)", () => {
  it("row 1: the PTY survives fieldd; the next fieldd adopts it inside 2s", async () => {
    const native = await spawnNative();
    const daemon1 = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    // registered even though the test stops it mid-flow: a failure BEFORE that
    // stop must not leak a live fieldd (the afterEach tolerates double-stop)
    cleanup.push(() => daemon1.stop());
    const rpc1 = await connect(daemon1);
    const created = (await rpc1.call("terminal.create", { shell: HOLD })) as {
      sessionId: string;
    };
    const ticket = (await poll(async () =>
      (await listOf(rpc1)).some((t) => t.sessionId === created.sessionId)
        ? ((await rpc1.call("terminal.openTicket", { sessionId: created.sessionId })) as
            | TerminalTicket
            | undefined)
        : undefined,
    )) as TerminalTicket;

    // the product plane goes away — the floor must not notice
    await daemon1.stop();

    const outside = new GhostteaAutomationClient(
      { controlSocket: ticket.controlSocket, authToken: ticket.token },
      { clientBuild: "kill-matrix" },
    );
    cleanup.push(() => outside.dispose());
    await outside.connect();
    expect((await outside.listSessions()).map((s) => s.id)).toContain(created.sessionId);

    // a NEW product plane pairs and adopts — the spec's <2s row measured from
    // ready, not from process birth
    const daemon2 = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon2.stop());
    const rpc2 = await connect(daemon2);
    const adoptedAt = Date.now();
    await poll(
      async () =>
        (await listOf(rpc2)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
      2_000,
    );
    expect(Date.now() - adoptedAt).toBeLessThan(2_000);

    // a fresh ticket from the adopting fieldd drives the SAME session
    const ticket2 = (await rpc2.call("terminal.openTicket", {
      sessionId: created.sessionId,
    })) as TerminalTicket;
    expect(ticket2.token).toBe(ticket.token); // same native boot, same credential
    const term = (await rpc2.call("terminal.terminate", {
      sessionId: created.sessionId,
    })) as { terminated: boolean };
    expect(term.terminated).toBe(true);
  }, 60_000);

  it("rows 3+6: a dead floor refuses honestly; a replacement boot empties the inventory and re-arms", async () => {
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);
    const created = (await rpc.call("terminal.create", { shell: HOLD })) as {
      sessionId: string;
    };
    await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
    );

    // a ticket minted while the floor is ALIVE is the control: it proves the
    // refusals below are the kill talking and not a door that never worked
    const beforeKill = (await rpc.call("terminal.openTicket", {
      sessionId: created.sessionId,
    })) as TerminalTicket;
    expect(beforeKill.token).toBeTruthy();

    // crash the floor: sessions die with it (the honest ceiling) and the seam
    // must refuse interactive ops rather than pretend
    native.child.kill("SIGKILL");
    await poll(async () => {
      const err = await rpc.callErr("terminal.create", { shell: HOLD });
      return err.data?.kind === "UNAVAILABLE" ? true : undefined;
    }, 10_000);

    // GT-5b — the hole this row never checked. `create` was the only op
    // re-tested after the kill, and the TICKET doors were the ones that had
    // gone wrong: `terminalEndpoints` was captured on the pairing hello and
    // cleared nowhere, so both of these kept answering with socket paths that
    // no longer existed plus the dead boot's token, audited as successful
    // grants. Floor-died-AFTER-hello had no coverage anywhere, and this is
    // where it surfaces.
    // Polled, not asserted once: `create` can reach UNAVAILABLE through the
    // dead CONTROL socket a beat before the mgmt link's close clears the
    // endpoints, and it is the cleared endpoints these two doors read.
    for (const [method, params] of [
      ["terminal.connectTicket", {}],
      ["terminal.openTicket", { sessionId: created.sessionId }],
    ] as const) {
      const kind = await poll(async () => {
        const err = await rpc.callErr(method, params);
        return err.data?.kind === "UNAVAILABLE" ? err.data.kind : undefined;
      }, 10_000).catch(() => "MINTED-FOR-A-CORPSE");
      expect(kind, `${method} must not mint for a corpse`).toBe("UNAVAILABLE");
    }

    // a replacement native on the SAME data dir: re-pair re-delivers fresh
    // endpoints (new token), the observed snapshot honestly EMPTIES (no
    // phantom sessions), and the create path works again
    await spawnNative(native.dir);
    await poll(async () => ((await listOf(rpc)).length === 0 ? true : undefined), 20_000);
    const reborn = await poll(async () => {
      try {
        return (await rpc.call("terminal.create", { shell: HOLD })) as {
          sessionId: string;
        };
      } catch {
        return undefined;
      }
    }, 20_000);
    expect(reborn.sessionId).toBeTruthy();
    expect(reborn.sessionId).not.toBe(created.sessionId);
  }, 60_000);

  it("row 6: the env strip holds through the real spawn path (EL7)", async () => {
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);

    const created = (await rpc.call("terminal.create", { shell: SH })) as {
      sessionId: string;
    };
    const ticket = (await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === created.sessionId)
        ? ((await rpc.call("terminal.openTicket", { sessionId: created.sessionId })) as
            | TerminalTicket
            | undefined)
        : undefined,
    )) as TerminalTicket;
    const client = new GhostteaAutomationClient(
      { controlSocket: ticket.controlSocket, authToken: ticket.token },
      { clientBuild: "kill-matrix" },
    );
    cleanup.push(() => client.dispose());
    await client.connect();

    const out = join(native.dir, "smuggle.txt");
    // dump the child env: `env` on unix, cmd's `set` on Windows.
    const input = await client.pasteAndSubmit(
      created.sessionId,
      WIN ? `set > ${out}` : `env > ${out}`,
    );
    expect(input.accepted).toBe(true);
    const env = await poll(async () => {
      try {
        const text = readFileSync(out, "utf8");
        return text.length > 0 ? text : undefined;
      } catch {
        return undefined;
      }
    });
    // the bait planted in field-native's own environment never reaches a PTY;
    // ordinary vars do (inherit-minus-strip, NF-D6). SCOPE HONESTY (review):
    // this proves the PREFIX classes (FIELD_/FIELDD_/GHOSTTEA_/...) — the
    // upstream strip is an exact-prefix list, so a NON-prefixed secret in the
    // daemon's env would pass into inherit-mode shells. That is spec-sanctioned
    // (EL7 registers prefixes precisely so secrets are namable), not proof
    // that arbitrary secrets can't ride the daemon env.
    expect(env).not.toContain("FIELD_SMUGGLE");
    expect(env).not.toContain("FIELDD_SMUGGLE");
    expect(env).not.toContain("GHOSTTEA_");
    // an ordinary (non-prefixed) var survives the strip: HOME on unix, the user
    // profile path on Windows (the strip is exact-prefix, so both are untouched).
    expect(env).toContain(WIN ? "USERPROFILE=" : "HOME=");
  }, 60_000);

  // WIN-6 / G13: the exact-case prefixes are stripped (row 6). This probes the
  // CASE gap ghosttea's case-sensitive `starts_with` opened on Windows'
  // case-insensitive env — CONFIRMED to leak on the box (a `Field_Native_*`
  // variant survived). field-native sets its OWN secrets exact-case, so those
  // were always stripped; the gap was defense-in-depth. G13 landed in ghosttea
  // 0.10.1 (2026-08-18: the strip folds ASCII case under Windows; unix stays
  // case-sensitive, where a case variant is a genuinely different var) — so
  // this row is a LIVE pass on the box now, `.fails` dropped exactly as the
  // sentence that used to end this comment said to. Still skipped on unix:
  // the scenario does not exist there.
  const caseGapWitness = WIN ? it : it.skip;
  caseGapWitness(
    "row 6b: a case-variant of a stripped prefix must not leak (EL7, G13)",
    async () => {
      const native = await spawnNative();
      const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);
      const created = (await rpc.call("terminal.create", { shell: SH })) as { sessionId: string };
      const ticket = (await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === created.sessionId)
          ? ((await rpc.call("terminal.openTicket", { sessionId: created.sessionId })) as
              | TerminalTicket
              | undefined)
          : undefined,
      )) as TerminalTicket;
      const client = new GhostteaAutomationClient(
        { controlSocket: ticket.controlSocket, authToken: ticket.token },
        { clientBuild: "kill-matrix" },
      );
      cleanup.push(() => client.dispose());
      await client.connect();

      const out = join(native.dir, "case-smuggle.txt");
      const input = await client.pasteAndSubmit(created.sessionId, `set > ${out}`);
      expect(input.accepted).toBe(true);
      const env = await poll(async () => {
        try {
          const text = readFileSync(out, "utf8");
          return text.length > 0 ? text : undefined;
        } catch {
          return undefined;
        }
      });
      expect(env).not.toContain("CASE_LEAK_WITNESS");
    },
    60_000,
  );

  it("epoch arbitration reaches through the ticket path", async () => {
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);
    const created = (await rpc.call("terminal.create", { shell: HOLD })) as {
      sessionId: string;
    };
    const ticket = (await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === created.sessionId)
        ? ((await rpc.call("terminal.openTicket", { sessionId: created.sessionId })) as
            | TerminalTicket
            | undefined)
        : undefined,
    )) as TerminalTicket;
    const client = new GhostteaAutomationClient(
      { controlSocket: ticket.controlSocket, authToken: ticket.token },
      { clientBuild: "kill-matrix" },
    );
    cleanup.push(() => client.dispose());
    await client.connect();

    const epoch = await client.humanInputEpoch(created.sessionId);
    const stale = await client.input(
      created.sessionId,
      { kind: "text", text: "never-lands" },
      epoch + 1,
    );
    expect(stale.accepted).toBe(false);
    expect(stale.reason).toBe("human-input-conflict");
    const fresh = await client.input(created.sessionId, { kind: "text", text: "lands" }, epoch);
    expect(fresh.accepted).toBe(true);
  }, 60_000);

  it("churn leaves no residue (bounded soak; the 24h variant is a named CI gate)", async () => {
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);

    for (let i = 0; i < 10; i++) {
      const { sessionId } = (await rpc.call("terminal.create", { shell: HOLD })) as {
        sessionId: string;
      };
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === sessionId) ? true : undefined,
      );
      await rpc.call("terminal.terminate", { sessionId });
    }
    await poll(async () => ((await listOf(rpc)).length === 0 ? true : undefined), 15_000);
  }, 120_000);
});
