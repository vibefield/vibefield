// AR-7b × AR-7d — a name typed in a pane that was BORN integrated, on the REAL
// floor. The rows of agent-gateway.test.ts make the launchers lead a pane's
// PATH by typing an `export`; these are born as a person's pane is —
// `terminal.create {}`, the login shell — and nothing is typed for it: the
// daemon's own gateway hands the shell lane's seam (`shellIntegrationRef`,
// daemon.ts) the kit's integration once its home is written, and the shell
// is born with the launchers first on its PATH, or a row here is red.
//
// The floor is a PERSON's (`person: true`): a throwaway HOME whose startup
// files only say they ran, so no shell born here reads the machine owner's,
// and the test process's ZDOTDIR is set aside (the born shell restores
// fieldd's). The agent is the scripted one (agent-gateway-fixture.ts) — no
// vendor's binary runs — and a person's typing is done the only way a test
// may do it: the floor's automation door into a PTY the test birthed.
//
// A launcher reached from OUTSIDE our panes (rows 9 and 13) is run by this
// process under `script(1)`, which lends it a terminal of the test's own: the
// launch is interactive, and its ancestors reach no shell of ours.
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RETRY_MS,
  readRendezvous,
  readTerminals,
  SPAWN_THROUGH_EXIT_REFUSED,
} from "@vibecook/puppeteer-runtime/spawn-through";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AGENT_GATEWAY_HOST_LABEL } from "../src/agent-gateway";
import { linesOf, TYPED_COMMAND, TYPED_PROVIDER } from "./agent-gateway-fixture";
import {
  adopted,
  answers,
  auditActs,
  auditEntries,
  auditText,
  bornPane,
  END_OF_INPUT,
  FLOOR_BUDGET_MS,
  FLOOR_WAIT_MS,
  floor,
  isAlive,
  key,
  processOf,
  quiet,
  readRecord,
  rowOf,
  screenOf,
  statusOf,
  teardownFloors,
  type,
  typedRow,
  poll as until,
  ZSH,
} from "./agent-gateway-floor";
import { bundleAgentShim } from "./agent-shim-bundle";

/** A loaded host takes seconds to start a process: no row here asserts speed
 * except where the row is ABOUT not waiting, and then against a wait that is
 * minutes long. */
const PROCESS_BUDGET_MS = 60_000;

let bundleDir: string;
let shimScript: string;
beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), "vf-shim-panes-"));
  shimScript = await bundleAgentShim(bundleDir);
}, PROCESS_BUDGET_MS);
afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});
afterEach(async () => {
  await teardownFloors();
}, PROCESS_BUDGET_MS);

/** The ledger's word on one born shell. */
const birthOf = (box: Awaited<ReturnType<typeof floor>>, sessionId: string) =>
  auditActs(box.dataDir, "terminal.session.create").find(
    (act) => act.outcome?.attrs?.["sessionId"] === sessionId,
  )?.outcome?.attrs;

/** Every act of the fold's own on a typed run, whatever its outcome. */
const foldActs = (dataDir: string): string[] =>
  auditEntries(dataDir)
    .map((entry) => entry.action)
    .filter((action) => action.startsWith("agent.session."));

/** How a command line left, as the pane wrote it: `status=<n>` in `path`. */
async function statusIn(path: string): Promise<number> {
  const text = await until(
    () => (existsSync(path) ? readFileSync(path, "utf8").trim() || undefined : undefined),
    FLOOR_WAIT_MS,
    `the status in ${path}`,
  );
  return Number(text.replace("status=", ""));
}

/** Run the launcher from THIS process, under a terminal of the test's own, and
 * read how it left and how long it took. */
function launcherFromOutside(
  box: Awaited<ReturnType<typeof floor>>,
  args: readonly string[],
): Promise<{ code: number | null; ms: number; output: string }> {
  const launcher = join(box.shimDirectory, TYPED_COMMAND);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("script", ["-q", "/dev/null", launcher, ...args], {
      cwd: box.work,
      env: { ...process.env, PUPPETEER_SHIM_DIR: box.shimDirectory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("close", (code) => resolve({ code, ms: Date.now() - started, output }));
  });
}

const skipped =
  ZSH === undefined
    ? process.platform === "win32"
      ? " — SKIPPED on win32: the spawn-through shim is POSIX only"
      : " — SKIPPED: no zsh on this host's PATH, and a born pane needs a real one"
    : "";

describe.skipIf(ZSH === undefined)(
  `a name typed in a pane BORN integrated — the REAL floor (AR-7b × AR-7d)${skipped}`,
  () => {
    it(
      "born integrated, end to end: the create's outcome says so, at the first prompt the name resolves to the launcher with nothing typed for it, and typed it becomes a managed run in that pane — the fold's row, the signed record, the ledger's adoption",
      async () => {
        const box = await floor({ bundle: shimScript, person: true });
        const pane = await bornPane(box);
        // the daemon's own word: born with the integration's variables
        expect(pane.integrated).toBe(true);
        expect(birthOf(box, pane.sessionId)).toEqual({
          sessionId: pane.sessionId,
          integrated: true,
        });
        // the throwaway person's own startup files ran — never the machine owner's
        const ran = await until(
          () => {
            const file = join(box.personHome as string, "ran");
            return existsSync(file) ? readFileSync(file, "utf8") : undefined;
          },
          FLOOR_WAIT_MS,
          "the person's startup files",
        );
        expect(ran).toContain(".zshenv");
        expect(ran).toContain(".zshrc");
        if (pane.login) expect(ran).toContain(".zprofile");

        // at the first prompt the name IS the launcher, and the launchers lead
        const resolved = join(box.root, "resolved");
        await type(box, pane, `command -v ${TYPED_COMMAND} > '${resolved}'`);
        await until(
          () => (existsSync(resolved) ? readFileSync(resolved, "utf8").trim() : undefined),
          FLOOR_WAIT_MS,
          "the name resolving",
        ).then((path) => expect(path).toBe(join(box.shimDirectory, TYPED_COMMAND)));
        const path = join(box.root, "path");
        await type(box, pane, `printf '%s' "$PATH" > '${path}'`);
        const led = await until(
          () => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
          FLOOR_WAIT_MS,
          "the pane's PATH",
        );
        expect(led.split(":")[0]).toBe(box.shimDirectory);
        expect(led.split(":").filter((entry) => entry === box.shimDirectory).length).toBe(1);

        // typed, it is a managed run in this pane
        await type(box, pane, TYPED_COMMAND);
        const row = await adopted(box, pane);
        expect(row).toMatchObject({
          spawnedBy: "user-shell",
          tier: "managed",
          kind: TYPED_PROVIDER,
          terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
          continuation: { persisted: true, resumable: false },
        });
        // no profile: a persona's sign-out has nothing of this run's to stop
        expect(row.profileId).toBeUndefined();
        const record = readRecord(box.dataDir, row.runtimeRunId);
        expect(record).toMatchObject({
          provider: TYPED_PROVIDER,
          spawnedBy: "user-shell",
          terminalSessionId: pane.sessionId,
          cwd: box.work,
        });
        expect(record.signature).toMatch(/^[0-9a-f]{64}$/u);
        expect(box.records.verifies(record)).toBe(true);
        expect(record.profileId).toBeUndefined();
        // one pid from the prompt to the agent, the born shell its parent
        const process_ = record.process;
        if (process_ === undefined) throw new Error("the record carries no process");
        const running = await until(
          async () => {
            const seen = await processOf(process_.pid);
            return seen?.command.endsWith("cat") === true ? seen : undefined;
          },
          FLOOR_WAIT_MS,
          "the recipe running in the launcher's pid",
        );
        expect(running.parentPid).toBe(pane.pid);
        await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));
        expect(linesOf(box.script.realLog)).toEqual([]);
        // the ledger: the adoption, and no refusal
        const acts = await until(() => {
          const found = auditActs(box.dataDir, "agent.session.adopt");
          return found.length > 0 && found[0]?.outcome !== undefined ? found : undefined;
        });
        expect(acts.length).toBe(1);
        expect(acts[0]?.attempt).toMatchObject({
          actor: { kind: "system" },
          target: { kind: "agent-session", id: row.runtimeRunId },
          attrs: { provider: TYPED_PROVIDER, sessionId: pane.sessionId, spawnedBy: "user-shell" },
        });
        expect(acts[0]?.outcome).toMatchObject({ outcome: "succeeded" });
        expect(auditActs(box.dataDir, "agent.session.adopt_refused")).toEqual([]);
        // the born shell is listed for the launchers, by its pid
        expect((await readTerminals(box.home))?.map((shell) => shell.pid)).toContain(pane.pid);

        // the agent ends; the pane is the person's shell still
        await key(box, pane, END_OF_INPUT);
        await until(() => (typedRow(box, pane) === undefined ? true : undefined));
        await answers(box, pane, "after-the-agent");
      },
      FLOOR_BUDGET_MS,
    );

    it(
      "a daemon whose gateway offers nothing births the shell bare — and once the gateway stops, the next birth is bare",
      async () => {
        // an adapter that does not classify: no launcher, nothing written
        const bare = await floor({
          bundle: shimScript,
          person: true,
          launchers: false,
          provider: { classifies: false },
        });
        // the gateway's start is the daemon's own; a row waits for it to have done
        await bare.daemon.agentGateway?.start();
        expect(bare.daemon.agentGateway?.state().names).toEqual([]);
        const pane = await bornPane(bare);
        expect(pane.integrated).toBe(false);
        expect(birthOf(bare, pane.sessionId)).toEqual({
          sessionId: pane.sessionId,
          integrated: false,
        });
        const path = join(bare.root, "path");
        await type(bare, pane, `printf '%s|%s' "$PATH" "$PUPPETEER_SHIM_DIR" > '${path}'`);
        const seen = await until(
          () => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
          FLOOR_WAIT_MS,
          "the bare pane's PATH",
        );
        expect(seen.split(":")).not.toContain(bare.shimDirectory);
        expect(seen.endsWith("|")).toBe(true);
        // and the name is nobody's
        const status = await statusOf(bare, pane, `command -v ${TYPED_COMMAND}`, "nobody");
        expect(status).not.toBe(0);

        // a gateway that offered, stopped
        const box = await floor({ bundle: shimScript, person: true });
        const before = await bornPane(box);
        expect(before.integrated).toBe(true);
        await box.daemon.agentGateway?.stop();
        const after = await bornPane(box);
        expect(after.integrated).toBe(false);
        expect(birthOf(box, after.sessionId)).toEqual({
          sessionId: after.sessionId,
          integrated: false,
        });
        // the shell born before the stop keeps its own integration
        expect(isAlive(before.pid)).toBe(true);
        const kept = join(box.root, "kept");
        await type(box, before, `printf '%s' "$PATH" > '${kept}'`);
        const led = await until(
          () => (existsSync(kept) ? readFileSync(kept, "utf8") : undefined),
          FLOOR_WAIT_MS,
          "the earlier pane's PATH",
        );
        expect(led.split(":")[0]).toBe(box.shimDirectory);
      },
      FLOOR_BUDGET_MS,
    );

    it(
      "row 9 — a process in no terminal of ours asks the gateway: the launcher run by this process, under a terminal of its own, runs the real executable although the host is strict and a pane of ours is open — with no argument and with one that cannot be carried — and leaves no row and nothing refused in the ledger",
      async () => {
        const box = await floor({ bundle: shimScript, person: true });
        expect(await readRendezvous(box.home)).toMatchObject({ strict: true });
        // a pane of ours is open, listed for the launchers: the outsider is
        // not in it, and must not be placed in it
        const pane = await bornPane(box);
        await until(
          async () =>
            (await readTerminals(box.home))?.some((shell) => shell.pid === pane.pid) === true
              ? true
              : undefined,
          FLOOR_WAIT_MS,
          "the pane listed for the launchers",
        );
        const plain = await launcherFromOutside(box, []);
        expect(plain.code).toBe(0);
        await until(() => (linesOf(box.script.realLog).length === 1 ? true : undefined));
        const bogus = await launcherFromOutside(box, ["--bogus"]);
        expect(bogus.code).toBe(0);
        await until(() => (linesOf(box.script.realLog).length === 2 ? true : undefined));
        expect(linesOf(box.script.realLog)).toEqual(["RUN ", "RUN --bogus"]);
        // nothing was said to the person: it ran, as typed
        for (const ran of [plain, bogus]) {
          expect(ran.output).not.toContain("was not started");
          expect(ran.output).not.toContain("waiting for");
        }
        // it was not ours to refuse: no row, no preparation, no record, nothing in the ledger
        await quiet(1_000);
        expect(box.daemon.agents.list().sessions).toEqual([]);
        expect(box.script.prepared).toEqual([]);
        expect(box.records.list()).toEqual([]);
        expect(linesOf(box.script.managedLog)).toEqual([]);
        expect(foldActs(box.dataDir)).toEqual([]);
        expect(box.daemon.agentGateway?.counts().get("outside-host-terminals")).toBe(2);
        expect(typedRow(box, pane)).toBeUndefined();
        await answers(box, pane, "untouched");
      },
      FLOOR_BUDGET_MS,
    );

    it(
      "row 11 — fieldd stops, the pane lives: the name run in the still-living shell says once that it is waiting, then is refused — after the kit's own wait when the stop withdrew the rendezvous, after fieldd's short wait when a fieldd that died left it — and the real executable never runs",
      async () => {
        const retryMs = 2_000;
        const box = await floor({ bundle: shimScript, person: true, retryMs });
        const pane = await bornPane(box, { recorded: true });
        const rendezvous = join(box.home, "gateway.json");
        const kept = join(box.root, "gateway.json.kept");
        copyFileSync(rendezvous, kept);
        // typed while fieldd is up and held at a gate until it is gone: no test
        // reaches the floor's input door without a fieldd, and the launcher
        // cannot tell — the pane's shell starts it, on the pane's terminal
        const gates = [join(box.root, "go-1"), join(box.root, "go-2")];
        const statuses = [join(box.root, "status-1"), join(box.root, "status-2")];
        await type(
          box,
          pane,
          gates
            .map(
              (gate, at) =>
                `until [ -e '${gate}' ]; do sleep 0.2; done; ${TYPED_COMMAND}; echo "status=$?" > '${statuses[at]}'`,
            )
            .join("; "),
        );
        await box.daemon.stop();
        expect(await readRendezvous(box.home)).toBeUndefined();
        expect((await readTerminals(box.home))?.map((shell) => shell.pid)).toContain(pane.pid);
        expect(isAlive(pane.pid)).toBe(true);

        // (a) the stop withdrew the rendezvous: the launcher has only its own
        // word (strict) and the kit's own wait
        let shown = screenOf(pane).length;
        writeFileSync(gates[0] as string, "");
        expect(await statusIn(statuses[0] as string)).toBe(SPAWN_THROUGH_EXIT_REFUSED);
        let said = screenOf(pane).slice(shown);
        expect(said.split(`waiting for ${AGENT_GATEWAY_HOST_LABEL}`).length - 1).toBe(1);
        expect(said).toContain(
          `${AGENT_GATEWAY_HOST_LABEL} did not answer within ${Math.round(DEFAULT_RETRY_MS / 1_000)} s`,
        );
        expect(linesOf(box.script.realLog)).toEqual([]);

        // (b) a fieldd that DIED leaves its rendezvous, port and all: the
        // launcher is given fieldd's own wait
        copyFileSync(kept, rendezvous);
        expect(await readRendezvous(box.home)).toMatchObject({ retryMs, strict: true });
        shown = screenOf(pane).length;
        writeFileSync(gates[1] as string, "");
        expect(await statusIn(statuses[1] as string)).toBe(SPAWN_THROUGH_EXIT_REFUSED);
        said = screenOf(pane).slice(shown);
        expect(said.split(`waiting for ${AGENT_GATEWAY_HOST_LABEL}`).length - 1).toBe(1);
        expect(said).toContain(
          `${AGENT_GATEWAY_HOST_LABEL} did not answer within ${Math.round(retryMs / 1_000)} s`,
        );
        expect(linesOf(box.script.realLog)).toEqual([]);
        expect(linesOf(box.script.managedLog)).toEqual([]);
        expect(box.records.list()).toEqual([]);
      },
      FLOOR_BUDGET_MS,
    );

    it(
      "row 12 — fieldd comes back while a launch waits: the name run while fieldd is down waits in the pane, a second fieldd on the same root rewrites the rendezvous, and the WAITING launch is adopted by it — the fold's row, the record, the adoption in the new daemon's ledger",
      async () => {
        const retryMs = 120_000;
        const first = await floor({ bundle: shimScript, person: true, retryMs });
        const pane = await bornPane(first, { recorded: true });
        const rendezvous = join(first.home, "gateway.json");
        const kept = join(first.root, "gateway.json.kept");
        copyFileSync(rendezvous, kept);
        const before = await readRendezvous(first.home);
        const gate = join(first.root, "go");
        const status = join(first.root, "status");
        await type(
          first,
          pane,
          `until [ -e '${gate}' ]; do sleep 0.2; done; ${TYPED_COMMAND}; echo "status=$?" > '${status}'`,
        );
        await first.daemon.stop();
        // the fieldd that died: its rendezvous still on disk, nobody on its port
        copyFileSync(kept, rendezvous);
        const shown = screenOf(pane).length;
        writeFileSync(gate, "");
        await until(
          () =>
            screenOf(pane).slice(shown).includes(`waiting for ${AGENT_GATEWAY_HOST_LABEL}`)
              ? true
              : undefined,
          FLOOR_WAIT_MS,
          "the launch waiting in the pane",
        );
        expect(existsSync(status)).toBe(false);

        const second = await floor({ bundle: shimScript, person: true, retryMs, restartOf: first });
        const after = await readRendezvous(second.home);
        expect(after?.token).not.toBe(before?.token);
        expect(after?.pid).toBe(process.pid);
        const row = await adopted(second, pane);
        expect(row).toMatchObject({
          spawnedBy: "user-shell",
          kind: TYPED_PROVIDER,
          terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
        });
        await until(() => (linesOf(second.script.managedLog).length === 1 ? true : undefined));
        expect(linesOf(second.script.realLog)).toEqual([]);
        const record = readRecord(second.dataDir, row.runtimeRunId);
        expect(record).toMatchObject({
          spawnedBy: "user-shell",
          terminalSessionId: pane.sessionId,
        });
        expect(second.records.verifies(record)).toBe(true);
        expect(isAlive(record.process?.pid as number)).toBe(true);
        const acts = await until(() => {
          const found = auditActs(second.dataDir, "agent.session.adopt");
          return found.length > 0 && found[0]?.outcome !== undefined ? found : undefined;
        });
        expect(acts.length).toBe(1);
        expect(acts[0]?.outcome).toMatchObject({ outcome: "succeeded" });
        expect(auditActs(second.dataDir, "agent.session.adopt_refused")).toEqual([]);
        // said once that it was waiting; no refusal, no second wait
        const said = screenOf(pane).slice(shown);
        expect(said.split(`waiting for ${AGENT_GATEWAY_HOST_LABEL}`).length - 1).toBe(1);
        expect(said).not.toContain("not started");
        expect(existsSync(status)).toBe(false);

        // the agent ends under the new daemon; the pane is the person's still.
        // The row is gone by its id: while the run is closing its summary
        // already names no terminal, and the record is stamped before the
        // row is dropped, never before the summary changes.
        await key(second, pane, END_OF_INPUT);
        await until(() => (rowOf(second, row.runtimeRunId) === undefined ? true : undefined));
        expect(await statusIn(status)).toBe(0);
        expect(readRecord(second.dataDir, row.runtimeRunId).exited).toMatchObject({
          reason: "process-exited",
        });
      },
      FLOOR_BUDGET_MS,
    );

    it(
      "row 13 — fieldd is down and the launcher is reached from outside our panes: the real executable runs AT ONCE — without the rendezvous, and with a dead fieldd's rendezvous whose wait is minutes long — and nobody is told to wait",
      async () => {
        const retryMs = 120_000;
        const box = await floor({ bundle: shimScript, person: true, retryMs });
        const rendezvous = join(box.home, "gateway.json");
        const kept = join(box.root, "gateway.json.kept");
        copyFileSync(rendezvous, kept);
        await box.daemon.stop();
        expect(await readRendezvous(box.home)).toBeUndefined();

        const withdrawn = await launcherFromOutside(box, ["-p", "x"]);
        expect(withdrawn.code).toBe(0);
        await until(() => (linesOf(box.script.realLog).length === 1 ? true : undefined));
        expect(withdrawn.output).not.toContain("waiting for");
        expect(withdrawn.output).not.toContain("not started");

        copyFileSync(kept, rendezvous);
        expect(await readRendezvous(box.home)).toMatchObject({ retryMs });
        const stale = await launcherFromOutside(box, []);
        expect(stale.code).toBe(0);
        await until(() => (linesOf(box.script.realLog).length === 2 ? true : undefined));
        expect(stale.output).not.toContain("waiting for");
        expect(stale.output).not.toContain("not started");
        // far under the wait a launch in one of our panes would have made
        expect(stale.ms).toBeLessThan(retryMs / 3);
        expect(linesOf(box.script.realLog)).toEqual(["RUN -p x", "RUN "]);
        expect(linesOf(box.script.managedLog)).toEqual([]);
      },
      FLOOR_BUDGET_MS,
    );

    it(
      "row 14 — what is not a session runs as typed, in the pane: the version flag, the one-shot flag, and the output sent to a file each run the real executable with exactly that argv — no row, no record, no preparation, nothing in the ledger",
      async () => {
        const box = await floor({ bundle: shimScript, person: true });
        const pane = await bornPane(box);
        expect(await statusOf(box, pane, `${TYPED_COMMAND} --version`, "version")).toBe(0);
        expect(await statusOf(box, pane, `${TYPED_COMMAND} -p x`, "one-shot")).toBe(0);
        const out = join(box.root, "out");
        expect(await statusOf(box, pane, `${TYPED_COMMAND} > '${out}'`, "redirected")).toBe(0);
        expect(existsSync(out)).toBe(true);
        expect(linesOf(box.script.realLog)).toEqual(["RUN --version", "RUN -p x", "RUN "]);
        await quiet(1_000);
        expect(typedRow(box, pane)).toBeUndefined();
        expect(box.daemon.agents.list().sessions).toEqual([]);
        expect(box.records.list()).toEqual([]);
        expect(box.script.prepared).toEqual([]);
        expect(box.script.preparing.count).toBe(0);
        expect(linesOf(box.script.managedLog)).toEqual([]);
        expect(foldActs(box.dataDir)).toEqual([]);
        const counts = box.daemon.agentGateway?.counts();
        expect(counts?.get("passthrough")).toBe(2);
        expect(counts?.get("not-interactive")).toBe(1);
        // the pane is the person's shell throughout
        await answers(box, pane, "still-mine");
      },
      FLOOR_BUDGET_MS,
    );

    it(
      "row 15 — what cannot be carried is refused, in the pane: the refusal's sentence on the pane's screen names the argument, nothing ran, no row, and the ledger has the refusal by its code — and the pane is free for the name typed plain",
      async () => {
        const box = await floor({ bundle: shimScript, person: true });
        const pane = await bornPane(box, { recorded: true });
        const status = await statusOf(box, pane, `${TYPED_COMMAND} --bogus`, "bogus");
        expect(status).toBe(SPAWN_THROUGH_EXIT_REFUSED);
        const sentence = `${TYPED_COMMAND} was not started: a managed session cannot carry --bogus (the scripted agent has no managed form for it). Run ${TYPED_COMMAND} without it.`;
        await until(
          () => (screenOf(pane).includes(sentence) ? true : undefined),
          FLOOR_WAIT_MS,
          "the refusal on the pane's screen",
        );
        expect(screenOf(pane).split(sentence).length - 1).toBe(1);
        expect(screenOf(pane)).not.toContain("waiting for");
        // nothing ran, nothing was prepared, nothing is held
        expect(linesOf(box.script.realLog)).toEqual([]);
        expect(linesOf(box.script.managedLog)).toEqual([]);
        expect(box.script.prepared).toEqual([]);
        expect(typedRow(box, pane)).toBeUndefined();
        expect(box.records.list()).toEqual([]);
        const refused = await until(() => {
          const found = auditActs(box.dataDir, "agent.session.adopt_refused");
          return found.length > 0 && found[0]?.outcome !== undefined ? found : undefined;
        });
        expect(refused.length).toBe(1);
        expect(refused[0]?.attempt).toMatchObject({
          actor: { kind: "system" },
          reasonCode: "REJECTED_ARGUMENT",
          target: { kind: "agent-session", id: "pending" },
          attrs: { provider: TYPED_PROVIDER, code: "rejected-argument", sessionId: pane.sessionId },
        });
        expect(refused[0]?.outcome).toMatchObject({
          outcome: "denied",
          reasonCode: "REJECTED_ARGUMENT",
        });
        expect(auditActs(box.dataDir, "agent.session.adopt")).toEqual([]);
        // the argument is the person's: never in the ledger
        expect(auditText(box.dataDir)).not.toContain("--bogus");

        // the pane is free: the name typed plain is a managed run
        await type(box, pane, TYPED_COMMAND);
        const row = await adopted(box, pane);
        expect(row.spawnedBy).toBe("user-shell");
        await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));
        await key(box, pane, END_OF_INPUT);
        await until(() => (typedRow(box, pane) === undefined ? true : undefined));
        expect(linesOf(box.script.realLog)).toEqual([]);
      },
      FLOOR_BUDGET_MS,
    );
  },
);
