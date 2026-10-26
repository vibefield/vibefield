// AR-7d over the REAL floor, in a REAL zsh: a shell VibeField births is born
// integrated. TerminalService is handed puppeteer's spawn-through zsh
// integration exactly as the daemon hands it (`shellIntegration`, answered by
// the kit's `shellIntegrationEnvironment`), over a shim home this file
// materializes with the kit's own `materializeShims`: one launcher, `vf-probe`,
// exec'ing a stub "shim" under this process's node. The shell is driven the way
// the agent runtime drives a pane (`TerminalService.automate`), and every result
// is read from a FILE the typed command wrote — never from the screen.
//
// No shell born here reads the person's own startup files. A floor's shells
// inherit the FLOOR's environment, so each floor runs with a throwaway HOME,
// and ZDOTDIR is either absent or a throwaway too — the two cases the
// integration must give back. The launcher rows carry their own controls: the
// person's .zshrc puts a REAL `vf-probe` first (a version manager's shape), and
// the typed `export PATH=…` leads with it again, so "the launcher leads" can
// only be the precmd hook's doing, never an accident of which directory holds
// the name. A shell is born the way a pane's is — the DEFAULT login shell
// (`-l`: macOS's /etc/zprofile runs path_helper, and the person's .zprofile
// runs) — and, once, as an explicit zsh, the other birth `create` integrates.
// Skipped, with the reason in the title, where there is no zsh.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import {
  materializeShims,
  shellIntegrationEnvironment,
} from "@vibefield/puppeteer-runtime/spawn-through";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NativeLink } from "../src/index";
import { TerminalService } from "../src/terminal-service";
import {
  type FloorScene,
  killDaemonTree,
  nativeBinPath,
  nativeEndpoint,
  removeTempRoot,
  shortTmpRoot,
  waitForMgmtEndpoint,
  waitWithEvidence,
} from "./native-harness";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);
/** The one launcher this file materializes. */
const NAME = "vf-probe";
/** Generous: every shell here runs compinit on a host that may be very loaded. */
const RESULT_MS = 45_000;

/** A zsh on this host's PATH. win32 has none to integrate: the kit's shim
 * execs in place (execve), which is POSIX only. */
function findZsh(): string | undefined {
  if (process.platform === "win32") return undefined;
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "zsh");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}
const ZSH = findZsh();

/** One integrated zsh on its own floor, and everything a row reads. */
interface Box {
  root: string;
  /** the throwaway HOME the floor — and so the shell — runs with */
  home: string;
  /** `${ZDOTDIR:-$HOME}` as the PERSON has it: their startup files, their history */
  dotdir: string;
  /** which throwaway's startup files are the person's ("home" or "zdot") */
  tag: "home" | "zdot";
  shims: string;
  launcher: string;
  /** holds a REAL `vf-probe`, which the person's files put first on PATH */
  real: string;
  out: string;
  service: TerminalService;
  sessionId: string;
}

/** A throwaway person's startup files in `dir`, each leaving a marker (a
 * login shell alone reads .zprofile). The .zshrc is the brief's (history in
 * `${ZDOTDIR:-$HOME}`, appended as typed) plus compinit — whose dump is the
 * other file fact 2 is about — and a PATH edit that puts a real `vf-probe`
 * first, recording what led at that moment. */
function writeStartupFiles(dir: string, tag: string, out: string, real: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".zshenv"), `print -r -- ran > ${join(out, `${tag}-zshenv`)}\n`);
  writeFileSync(join(dir, ".zprofile"), `print -r -- ran > ${join(out, `${tag}-zprofile`)}\n`);
  writeFileSync(
    join(dir, ".zshrc"),
    [
      `HISTFILE=\${ZDOTDIR:-$HOME}/.zsh_history`,
      "setopt INC_APPEND_HISTORY",
      "autoload -Uz compinit && compinit -i",
      `path=(${real} $path)`,
      `whence -p ${NAME} > ${join(out, "rc-whence.tmp")}; mv ${join(out, "rc-whence.tmp")} ${join(out, "rc-whence")}`,
      `print -r -- ran > ${join(out, `${tag}-rc`)}`,
      "",
    ].join("\n"),
  );
}

/** The environment the floor runs with — and so every shell it births
 * (`inherit`) — and the environment the integration is told the shell is born
 * with: this process's, minus what would make a born shell look already
 * integrated or reach outside the box (a ZDOTDIR or HISTFILE of the person's,
 * a terminal app's session hooks), plus the throwaway HOME and, in the one
 * case, a throwaway ZDOTDIR. */
function shellEnvironment(home: string, zdotdir: string | undefined): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name === "ZDOTDIR" || name === "HISTFILE") continue;
    if (name.startsWith("TERM_") || name.startsWith("PUPPETEER_")) continue;
    environment[name] = value;
  }
  environment["HOME"] = home;
  if (zdotdir !== undefined) environment["ZDOTDIR"] = zdotdir;
  return environment;
}

/** Item 68 — the floor and the link this suite drives (no daemon: `NativeLink` and `TerminalService` directly), for
 * every wait's evidence; set once the link connects. */
let scene: FloorScene | undefined;

/** Every wait in this suite (item 68): at its deadline it says what was awaited, what the row last `seen`, and the
 * floor's log with the link view (`waitWithEvidence`). The budgets are the rows' own. */
async function poll<T>(
  fn: (seen: (value: unknown) => void) => T | undefined,
  ms: number,
  what: string,
): Promise<T> {
  return await waitWithEvidence(what, fn, ms, () => scene);
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** A command line whose output lands in `<out>/<name>` whole: written beside
 * it, then renamed, so a poll never reads half of it. */
function into(box: Box, name: string, command: string): string {
  const tmp = join(box.out, `${name}.tmp`);
  return `{ ${command}; } > ${tmp} 2>&1; mv ${tmp} ${join(box.out, name)}`;
}

/** Type one line at the prompt — paste and submit, the runtime's own input. */
async function type(box: Box, line: string): Promise<void> {
  const answer = await box.service.automate(box.sessionId, {
    kind: "paste",
    text: line,
    submit: true,
  });
  expect(answer).toEqual({ accepted: true });
}

async function read(box: Box, name: string): Promise<string> {
  const path = join(box.out, name);
  return await poll(
    () => (existsSync(path) ? readFileSync(path, "utf8").trimEnd() : undefined),
    RESULT_MS,
    `${name} from the shell`,
  );
}

const skipped =
  ZSH === undefined
    ? process.platform === "win32"
      ? " — SKIPPED on win32: the spawn-through shim is POSIX only"
      : " — SKIPPED: no zsh on this host's PATH, and these rows need a real one"
    : "";

describe.skipIf(ZSH === undefined)(
  `AR-7d — a zsh VibeField births is born integrated (real field-native, real zsh)${skipped}`,
  () => {
    describe.each([
      {
        environment: "names no ZDOTDIR",
        birth: "the default login shell",
        zdotdir: false,
        login: true,
      },
      {
        environment: "names a ZDOTDIR",
        birth: "the default login shell",
        zdotdir: true,
        login: true,
      },
      { environment: "names no ZDOTDIR", birth: "an explicit zsh", zdotdir: false, login: false },
    ])("the daemon's environment $environment — $birth", ({ zdotdir, login }) => {
      let box: Box;
      const teardown: Array<() => void | Promise<void>> = [];
      let floor: ChildProcess | undefined;

      beforeAll(async () => {
        const zsh = ZSH as string;
        // the short-root rule (the floor binds sockets under it) is the harness's
        const root = shortTmpRoot("vf-zi-");
        teardown.push(() => removeTempRoot(root));
        const dataDir = join(root, "data");
        const home = join(root, "home");
        const shims = join(root, "shims");
        const real = join(root, "real");
        const out = join(root, "out");
        const personZdot = zdotdir ? join(root, "zdot") : undefined;
        for (const dir of [join(dataDir, ...LAYOUT.NATIVE_RUN_DIR), real, out]) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(join(real, NAME), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        // HOME's files exist in both cases; with a ZDOTDIR they must NOT run
        writeStartupFiles(home, "home", out, real);
        if (personZdot !== undefined) writeStartupFiles(personZdot, "zdot", out, real);

        // the shim home, by the kit: the stub "shim" says it ran, and as whom
        const stub = join(root, "stub-shim.cjs");
        const launched = join(out, "launched.json");
        writeFileSync(
          stub,
          [
            'const fs = require("node:fs");',
            `fs.writeFileSync(${JSON.stringify(`${launched}.tmp`)}, JSON.stringify({ argv: process.argv.slice(2), name: process.env.PUPPETEER_SHIM_NAME ?? null }));`,
            `fs.renameSync(${JSON.stringify(`${launched}.tmp`)}, ${JSON.stringify(launched)});`,
            "",
          ].join("\n"),
        );
        const materialized = await materializeShims({
          home: shims,
          names: [NAME],
          script: stub,
          runtime: { command: process.execPath },
        });

        const environment = shellEnvironment(home, personZdot);
        const floorSpawnedAt = Date.now();
        floor = spawn(BIN, [], {
          env: {
            ...environment,
            FIELD_NATIVE_DATA_DIR: dataDir,
            FIELD_LOG_DIR: join(dataDir, "logs"),
            FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
          },
          stdio: "ignore",
        });
        const child = floor;
        // reaped before the root is removed (teardown runs in reverse)
        teardown.push(() => killDaemonTree(child));
        await waitForMgmtEndpoint(dataDir, 30_000);

        const link = new NativeLink({
          socketPath: nativeEndpoint(dataDir, SOCKETS.MGMT),
          pairingFile: join(dataDir, ...LAYOUT.PAIRING_FILE),
          bootId: "ar7d-shell-integration",
        });
        teardown.push(() => link.close());
        await link.connect();
        scene = { dataDir, spawnedAt: floorSpawnedAt, link };
        const service = new TerminalService({
          link,
          // the person's login shell, as the daemon reads it: the zsh under test
          defaultShell: () => zsh,
          // the daemon's getter, answered the way the gateway service will
          // answer it: the kit's integration over the shim home, for the
          // environment the shell is really born with (the floor's)
          shellIntegration: (shell) =>
            shellIntegrationEnvironment({ home: shims, shell, environment }),
        });
        teardown.push(() => service.dispose());
        await service.ensureStarted();
        // born as a pane is (`terminal.create {}`: the login shell, `-l`), or by name
        const created = await service.create(login ? { cwd: home } : { shell: zsh, cwd: home });
        teardown.push(async () => {
          await service.terminate(created.sessionId);
        });
        expect(created.integrated).toBe(true);
        box = {
          root,
          home,
          dotdir: personZdot ?? home,
          tag: zdotdir ? "zdot" : "home",
          shims,
          launcher: join(materialized.shimDirectory, NAME),
          real,
          out,
          service,
          sessionId: created.sessionId,
        };
      }, 120_000);

      afterAll(async () => {
        for (const fn of teardown.reverse()) {
          try {
            await fn();
          } catch {
            // a floor already gone, a session already closed: fine
          }
        }
      }, 60_000);

      it("at the first prompt the launcher leads PATH — though the person's .zshrc put a real vf-probe first — and typing its name runs it", async () => {
        // the control: when the person's .zshrc ended, the real one led
        expect(await read(box, "rc-whence")).toBe(join(box.real, NAME));
        await type(box, into(box, "first-whence", `whence -p ${NAME}`));
        expect(await read(box, "first-whence")).toBe(box.launcher);
        await type(box, `${NAME} one two`);
        expect(JSON.parse(await read(box, "launched.json"))).toEqual({
          argv: ["one", "two"],
          name: NAME,
        });
      }, 120_000);

      it("the hook runs before every prompt: a PATH the person reorders is led by the launcher again at the next prompt", async () => {
        await type(
          box,
          `export PATH=${box.real}:/usr/bin:$PATH; ${into(box, "during-whence", `whence -p ${NAME}`)}`,
        );
        // the control: within that one line, the person's order stood
        expect(await read(box, "during-whence")).toBe(join(box.real, NAME));
        await type(box, into(box, "next-whence", `whence -p ${NAME}`));
        expect(await read(box, "next-whence")).toBe(box.launcher);
      }, 120_000);

      it(zdotdir
        ? "ZDOTDIR is the person's own again: the one the daemon's environment named"
        : "ZDOTDIR is the person's own again: unset, as the daemon's environment had it", async () => {
        await type(
          box,
          into(box, "zdotdir", `print -r -- \${ZDOTDIR-unset} \${PUPPETEER_ORIGINAL_ZDOTDIR-gone}`),
        );
        expect(await read(box, "zdotdir")).toBe(`${zdotdir ? box.dotdir : "unset"} gone`);
      }, 120_000);

      it("the person's own .zshenv, .zprofile (a login shell's alone) and .zshrc ran — and no one else's", async () => {
        expect(await read(box, `${box.tag}-zshenv`)).toBe("ran");
        expect(await read(box, `${box.tag}-rc`)).toBe("ran");
        // a login shell reads it after /etc/zprofile (path_helper); no other shell reads it
        if (login) expect(await read(box, `${box.tag}-zprofile`)).toBe("ran");
        else expect(existsSync(join(box.out, `${box.tag}-zprofile`))).toBe(false);
        if (zdotdir) {
          // with a ZDOTDIR, zsh reads startup files from there, never $HOME
          for (const marker of ["home-zshenv", "home-zprofile", "home-rc"]) {
            expect(existsSync(join(box.out, marker))).toBe(false);
          }
        }
      }, 120_000);

      it("a typed command lands in the person's own history file — and compinit's dump beside it — never under the shim home", async () => {
        const witness = `vf-history-witness-${randomBytes(4).toString("hex")}`;
        await type(box, `: ${witness}`);
        const history = join(box.dotdir, ".zsh_history");
        await poll(
          () =>
            existsSync(history) && readFileSync(history, "utf8").includes(witness)
              ? true
              : undefined,
          RESULT_MS,
          `the witness in ${history}`,
        );
        expect(existsSync(join(box.dotdir, ".zcompdump"))).toBe(true);
        const underShims = filesUnder(box.shims);
        expect(underShims.filter((path) => /zsh_history|zcompdump/.test(path))).toEqual([]);
        for (const path of underShims) expect(readFileSync(path, "utf8")).not.toContain(witness);
      }, 120_000);

      it("a nested non-interactive zsh finds the launcher through the PATH it inherits — and registers no hook of its own", async () => {
        await type(
          box,
          into(
            box,
            "nested",
            `${ZSH} -c 'whence -p ${NAME}; print -r -- \${+functions[_puppeteer_shim_path]}'`,
          ),
        );
        expect((await read(box, "nested")).split("\n")).toEqual([box.launcher, "0"]);
      }, 120_000);
    });
  },
);
