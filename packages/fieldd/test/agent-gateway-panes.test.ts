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
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RETRY_MS,
  readRendezvous,
  readTerminals,
  SPAWN_THROUGH_EXIT_REFUSED,
  spawnThroughLayout,
} from "@vibecook/puppeteer-runtime/spawn-through";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AGENT_GATEWAY_HOST_LABEL } from "../src/agent-gateway";
import { linesOf, TYPED_COMMAND, TYPED_PROVIDER } from "./agent-gateway-fixture";
import {
  adopted,
  answers,
  auditActs,
  auditEntries,
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
  },
);

// what the rows below read but the rows above do not: kept named so a row
// that reaches for them is not a red on an import
void copyFileSync;
void readRendezvous;
void DEFAULT_RETRY_MS;
void SPAWN_THROUGH_EXIT_REFUSED;
void spawnThroughLayout;
void AGENT_GATEWAY_HOST_LABEL;
void quiet;
void screenOf;
void launcherFromOutside;
void foldActs;
