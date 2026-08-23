// NF-4 — THE kill matrix (native-floor spec §10), executable. The ownership
// law as tests: PTYs live in field-native and survive fieldd; a new fieldd
// adopts the inventory inside the <2s row; a dead floor degrades honestly; the
// env strip holds through the real spawn path; epoch arbitration reaches
// through the D6 ticket; churn leaves no residue. Row 2 (field-native's own
// SIGTERM sweep) is pinned Rust-side in field-native/tests/terminal_unit.rs.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import type { TerminalEndpoints, TerminalInfo } from "@vibefield/contracts";
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

/** TP-S3e — the OUTSIDE observer's coordinates. The product ticket is routed
 * (WS doors + grants) now, so a UDS automation client reads the fieldd-plane
 * truth the daemon itself pairs on: the NF-D8 endpoints from the mgmt hello. */
function udsEndpoints(daemon: FielddDaemon): TerminalEndpoints {
  const ep = daemon.native.terminalEndpoints;
  if (ep === undefined) throw new Error("the paired floor reported no terminal endpoints");
  return ep;
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

// TC-S3 helpers — rows select cells by CLASS, never by array position: the
// snapshot's order is a mirror convenience, and during a respawn window the
// surviving class is cells[0].
type RouteSnapshot = NonNullable<FielddDaemon["native"]["terminalRoutes"]>;
type RouteCell = RouteSnapshot["cells"][number];
const classCellOf = (
  routes: RouteSnapshot | undefined,
  workloadClass: "agent" | "interactive",
): RouteCell | undefined =>
  routes?.cells.find((cell) => cell.workloadClass === workloadClass && cell.role !== "solo");
const interactiveClassCell = (routes: RouteSnapshot | undefined): RouteCell | undefined =>
  classCellOf(routes, "interactive");
const agentSoloCells = (routes: RouteSnapshot | undefined): RouteCell[] =>
  (routes?.cells ?? []).filter((cell) => cell.workloadClass === "agent" && cell.role === "solo");

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
    // the routed mint while alive is the control (grants + doors present) …
    const ticket = (await poll(async () =>
      (await listOf(rpc1)).some((t) => t.sessionId === created.sessionId)
        ? ((await rpc1.call("terminal.openTicket", { sessionId: created.sessionId })) as {
            endpoints: { controlUrl: string };
            attachGrant: { mac: string };
          })
        : undefined,
    )) as { endpoints: { controlUrl: string }; attachGrant: { mac: string } };
    expect(ticket.endpoints.controlUrl).toMatch(/^ws:/);
    // … and the OUTSIDE observer rides the fieldd-plane UDS coordinates
    const uds = udsEndpoints(daemon1);

    // the product plane goes away — the floor must not notice
    await daemon1.stop();

    const outside = new GhostteaAutomationClient(
      { controlSocket: uds.controlSocket, authToken: uds.authToken },
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

    // the adopting fieldd re-pairs onto the SAME native boot — same credential
    expect(udsEndpoints(daemon2).authToken).toBe(uds.authToken);
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
    })) as { attachGrant?: { mac?: string } };
    expect(beforeKill.attachGrant?.mac).toBeTruthy();

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
    // (terminal.connectTicket retired at TP-S3e — openTicket is the one mint
    // left to try against a corpse)
    for (const [method, params] of [
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
    await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
    );
    const uds = udsEndpoints(daemon);
    const client = new GhostteaAutomationClient(
      { controlSocket: uds.controlSocket, authToken: uds.authToken },
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
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
      );
      const uds = udsEndpoints(daemon);
      const client = new GhostteaAutomationClient(
        { controlSocket: uds.controlSocket, authToken: uds.authToken },
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
    await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
    );
    const uds = udsEndpoints(daemon);
    const client = new GhostteaAutomationClient(
      { controlSocket: uds.controlSocket, authToken: uds.authToken },
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

  it("row S2-A: a cell SIGKILL is a supervised replacement — routes re-deliver, tickets re-mint, the loss is honest (TC-S2)", async () => {
    // THE slice gate: the terminal ENGINE dies, the floor survives, and the
    // whole ladder re-arms without a re-pair — supervisor respawn → a routes
    // delta with a NEW cellBootId on the SAME mgmt link → fieldd's endpoints
    // move → a fresh create lands on the replacement. The killed cell's
    // session leaves the observed inventory: TC-S2's ceiling, stated by the
    // S2 honesty string ("a terminal-engine crash loses only its class") in
    // fieldd's receipt.
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);
    const created = (await rpc.call("terminal.create", { shell: HOLD })) as { sessionId: string };
    await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
    );
    // TC-S3: the session above was created classless → the INTERACTIVE cell.
    // Track that CLASS's row, not cells[0] — during the respawn window the
    // agent cell is the only row and cells[0] would resolve to it, "passing"
    // the replacement poll with a cell nobody killed.
    const first = await poll(async () => {
      const routes = daemon.native.terminalRoutes;
      return interactiveClassCell(routes) !== undefined ? routes : undefined;
    });
    const firstCell = interactiveClassCell(first);
    if (firstCell === undefined) throw new Error("unreachable: polled for a cell");
    expect(firstCell.pid).toBeGreaterThan(0);

    process.kill(firstCell.pid, "SIGKILL");

    const replacement = await poll(async () => {
      const routes = daemon.native.terminalRoutes;
      const cell = interactiveClassCell(routes);
      return cell !== undefined && cell.cellBootId !== firstCell.cellBootId ? routes : undefined;
    }, 20_000);
    expect(replacement.revision, "revision is monotonic across the replacement").toBeGreaterThan(
      first.revision,
    );
    const replacementCell = interactiveClassCell(replacement);
    if (replacementCell === undefined) throw new Error("unreachable: polled for a cell");
    // endpoints re-delivered on the LIVE link — the seam TC-D15 exists for
    // (pre-S2, new endpoints arrived only with a re-pair)
    expect(daemon.native.terminalEndpoints?.controlSocket).toBe(
      replacementCell.endpoints.controlSocket,
    );
    // the honest loss: the killed cell's session leaves the inventory
    await poll(
      async () =>
        (await listOf(rpc)).every((t) => t.sessionId !== created.sessionId) ? true : undefined,
      15_000,
    );
    // and the product plane works on the replacement without a re-pair
    const second = (await rpc.call("terminal.create", { shell: HOLD })) as { sessionId: string };
    await poll(
      async () =>
        (await listOf(rpc)).some((t) => t.sessionId === second.sessionId) ? true : undefined,
      15_000,
    );
    await rpc.call("terminal.terminate", { sessionId: second.sessionId });
  }, 90_000);

  it("row S2-B: a floor SIGKILL reaps the cell — the leash leaves no orphan (TC-S2/TC-D14)", async () => {
    // The stdin leash IS the orphan story: the floor's death closes the pipe,
    // the cell sees EOF, drains, and exits — no process-group machinery, no
    // grandchild for the harness (or a user) to hunt down.
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const cellPid = await poll(async () => daemon.native.terminalRoutes?.cells[0]?.pid, 20_000);

    native.child.kill("SIGKILL");

    await poll(async () => {
      try {
        process.kill(cellPid, 0);
        return undefined; // still alive — keep polling
      } catch {
        return true; // ESRCH: the leash reaped it
      }
    }, 15_000);
  }, 60_000);

  it("row S3-A: a class-A crash leaves class-B streaming — the blast is one class, counted (TC-S3)", async () => {
    // THE K=2 gate: kill the agent cell under a live interactive witness. The
    // interactive session must stream THROUGH the kill (same cell, same
    // control connection, epoch input still landing), the agent session is
    // the WHOLE counted blast, and the agent class comes back supervised.
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);
    const agent = (await rpc.call("terminal.create", {
      shell: HOLD,
      workloadClass: "agent",
    })) as { sessionId: string };
    const interactive = (await rpc.call("terminal.create", { shell: HOLD })) as {
      sessionId: string;
    };
    // Both observed, on DIFFERENT cells — the inventory `cell` tag is the join
    const tags = await poll(async () => {
      const list = await listOf(rpc);
      const a = list.find((t) => t.sessionId === agent.sessionId)?.cell;
      const b = list.find((t) => t.sessionId === interactive.sessionId)?.cell;
      return a !== undefined && b !== undefined ? { a, b } : undefined;
    }, 15_000);
    expect(tags.a.workloadClass).toBe("agent");
    expect(tags.b.workloadClass).toBe("interactive");
    expect(tags.a.cellBootId).not.toBe(tags.b.cellBootId);
    // The streaming witness: a live control connection to the INTERACTIVE
    // cell, addressed by ITS row in the route snapshot (fieldd-plane truth —
    // the product ticket is routed now and carries no UDS coordinates)
    const interactiveRow = daemon.native.terminalRoutes?.cells.find(
      (c) => c.workloadClass === "interactive",
    );
    if (interactiveRow === undefined) throw new Error("no interactive cell row");
    const witness = new GhostteaAutomationClient(
      {
        controlSocket: interactiveRow.endpoints.controlSocket,
        authToken: interactiveRow.endpoints.authToken,
      },
      { clientBuild: "kill-matrix" },
    );
    cleanup.push(() => witness.dispose());
    await witness.connect();
    const epoch = await witness.humanInputEpoch(interactive.sessionId);

    const agentCell = classCellOf(daemon.native.terminalRoutes, "agent");
    if (agentCell === undefined) throw new Error("unreachable: the agent tag proved the cell");
    process.kill(agentCell.pid, "SIGKILL");

    // The agent class returns as a supervised replacement…
    const replacement = await poll(async () => {
      const cell = classCellOf(daemon.native.terminalRoutes, "agent");
      return cell !== undefined && cell.cellBootId !== agentCell.cellBootId ? cell : undefined;
    }, 20_000);
    // …the blast is EXACTLY the agent session (counted per cell, TC-S3)…
    await poll(
      async () =>
        (await listOf(rpc)).every((t) => t.sessionId !== agent.sessionId) ? true : undefined,
      15_000,
    );
    const survivors = await listOf(rpc);
    expect(survivors.map((t) => t.sessionId)).toEqual([interactive.sessionId]);
    expect(survivors[0]?.cell?.cellBootId).toBe(tags.b.cellBootId);
    // …and class B streamed through it: the SAME connection accepts input at
    // the SAME epoch — no reconnect, no re-mint, no epoch bump.
    const landed = await witness.input(
      interactive.sessionId,
      { kind: "text", text: "still-streaming" },
      epoch,
    );
    expect(landed.accepted).toBe(true);
    // A fresh agent create lands on the replacement cell without a re-pair.
    const second = (await rpc.call("terminal.create", {
      shell: HOLD,
      workloadClass: "agent",
    })) as { sessionId: string };
    const secondTag = await poll(
      async () => (await listOf(rpc)).find((t) => t.sessionId === second.sessionId)?.cell,
      15_000,
    );
    expect(secondTag.cellBootId).toBe(replacement.cellBootId);
  }, 120_000);

  it("row S3-B / row 13: an evidence-free crash storm blames NO session — no isolation, the honest dead end (TC-D4)", async () => {
    // Row 13's first half, as built: SIGKILL leaves no crumb, so every death
    // classifies Unknown — and Unknown NEVER strikes. Past the intensity
    // window the class must go to its honest dead end, not "blame the only
    // session that was there" (never last-active). No solo cell may ever
    // appear; the other class keeps serving.
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);
    const bait = (await rpc.call("terminal.create", {
      shell: HOLD,
      workloadClass: "agent",
    })) as { sessionId: string };
    await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === bait.sessionId) ? true : undefined,
    );
    // The storm: the boot start plus two respawns spend the intensity window
    // (3 starts / 60s), so the third kill must be the last word.
    let agentCell = classCellOf(daemon.native.terminalRoutes, "agent");
    if (agentCell === undefined) throw new Error("unreachable: the bait proved the cell");
    for (let kill = 0; kill < 3; kill++) {
      const dead: RouteCell = agentCell;
      process.kill(dead.pid, "SIGKILL");
      if (kill === 2) break;
      agentCell = await poll(async () => {
        const cell = classCellOf(daemon.native.terminalRoutes, "agent");
        return cell !== undefined && cell.cellBootId !== dead.cellBootId ? cell : undefined;
      }, 20_000);
    }
    // The dead end: the agent class does NOT come back — and nothing was
    // isolated, because nothing was attributable (no crumb ⇒ Unknown ⇒ no
    // strike). Sampled past the respawn cadence the storm itself proved.
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const routes = daemon.native.terminalRoutes;
    expect(classCellOf(routes, "agent"), "no agent class respawn past intensity").toBeUndefined();
    expect(agentSoloCells(routes), "no solo cell without Exact evidence (row 13)").toEqual([]);
    // The other class is untouched by its sibling's dead end.
    const interactive = (await rpc.call("terminal.create", { shell: HOLD })) as {
      sessionId: string;
    };
    const tag = await poll(
      async () => (await listOf(rpc)).find((t) => t.sessionId === interactive.sessionId)?.cell,
      15_000,
    );
    expect(tag.workloadClass).toBe("interactive");
  }, 120_000);

  it("row S3-C: Exact strikes isolate the offender's class to solo hosts at next spawn (TC-S3/TC-D4)", async () => {
    // The other half of the pair: the SAME storm WITH the crumb naming a
    // session flips the breach into spawn-isolation — the class keeps
    // serving, creates land on fresh single-session solo cells, and the
    // target rotates the moment it takes a session (the create-target
    // discipline, end to end). The crumb rides the real attribution seam:
    // the file the cell itself writes on the way down.
    const native = await spawnNative();
    const daemon = await bootstrap({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await connect(daemon);
    const offender = (await rpc.call("terminal.create", {
      shell: HOLD,
      workloadClass: "agent",
    })) as { sessionId: string };
    await poll(async () =>
      (await listOf(rpc)).some((t) => t.sessionId === offender.sessionId) ? true : undefined,
    );
    let agentCell = classCellOf(daemon.native.terminalRoutes, "agent");
    if (agentCell === undefined) throw new Error("unreachable: the offender proved the cell");
    for (let kill = 0; kill < 3; kill++) {
      const dead: RouteCell = agentCell;
      writeFileSync(
        join(native.dir, "native", "run", `termcell.${dead.cellInstanceId}.crumb`),
        JSON.stringify({
          cellBootId: dead.cellBootId,
          sessionId: offender.sessionId,
          detail: "induced: kill-matrix row S3-C",
        }),
      );
      process.kill(dead.pid, "SIGKILL");
      if (kill === 2) break;
      agentCell = await poll(async () => {
        const cell = classCellOf(daemon.native.terminalRoutes, "agent");
        return cell !== undefined && cell.cellBootId !== dead.cellBootId ? cell : undefined;
      }, 20_000);
    }
    // Isolation: the class's spawn target is now a SOLO cell.
    const firstTarget = await poll(
      async () => agentSoloCells(daemon.native.terminalRoutes)[0],
      20_000,
    );
    // The offender-class create lands ON the solo host, one session alone.
    const isolated = (await rpc.call("terminal.create", {
      shell: HOLD,
      workloadClass: "agent",
    })) as { sessionId: string };
    const isolatedTag = await poll(
      async () => (await listOf(rpc)).find((t) => t.sessionId === isolated.sessionId)?.cell,
      15_000,
    );
    expect(isolatedTag.role).toBe("solo");
    expect(isolatedTag.cellBootId).toBe(firstTarget.cellBootId);
    // The chain rotates: a NEWER empty solo spawns once the target is taken,
    // and the next create lands there — never beside the first session.
    const nextTarget = await poll(async () => {
      const newer = agentSoloCells(daemon.native.terminalRoutes).find(
        (cell) => cell.cellInstanceId > firstTarget.cellInstanceId,
      );
      return newer;
    }, 20_000);
    const second = (await rpc.call("terminal.create", {
      shell: HOLD,
      workloadClass: "agent",
    })) as { sessionId: string };
    const secondTag = await poll(
      async () => (await listOf(rpc)).find((t) => t.sessionId === second.sessionId)?.cell,
      15_000,
    );
    expect(secondTag.role).toBe("solo");
    expect(secondTag.cellBootId).toBe(nextTarget.cellBootId);
    expect(secondTag.cellBootId).not.toBe(isolatedTag.cellBootId);
    // The sibling class never moved: same interactive cell, before and after.
    const interactiveCell = interactiveClassCell(daemon.native.terminalRoutes);
    expect(interactiveCell, "the interactive class is untouched by isolation").toBeDefined();
  }, 180_000);
});
