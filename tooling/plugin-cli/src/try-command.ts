// `try` — put a plugin's kinds ON THE DESK, in the product, and say whether each one is DRAWN (DK-10 — the ten-minute
// bar's last step).
//
// Two facts made this command necessary, both found by the bar's first agents (2026-10-05): before the pegboard
// (DK-13) nothing a person can do lays an object of a plugin's kind, so a dev-linked kind sits compiled and unseen; and
// nothing else in the kit COMPILES a kind's WGSL (`check` and the playground READ it — the still that compiles waits on
// ICE's `createStill` at the pin). So `try` does what DK-9's staged smokes do, for one author's plugin: it COPIES the
// plugin's installed bundle into a dev root of its own (`dev-link`'s copy — fieldd keeps only real directories and
// refuses an artifact whose realpath escapes its root), runs the app's `smoke:plugin` from the checkout the kit lives
// in with `FIELDD_PLUGIN_DEV_ROOTS` naming that root alone, and reads its rows: the first board of a fresh profile lays
// ONE object of each kind the manifest declares, alone (field-app's try board, `?deskTry=`), and each is held DRAWN —
// laid, its kind made on the host's device (not refused at create, nor struck), and picked where it lies. The stills
// (the board and each object, by day and by night) and the app's whole log land in the shots directory. Nothing here
// prompts, and nothing touches the network; the app's window shows while it runs.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginManifestV1 } from "@vibefield/contracts";
import { devLink } from "./dev-link";
import { note, pass, refuse, type Verdict } from "./verdict";

/** The checkout this kit runs from (tooling/plugin-cli/src → the repository root): the app `try` launches. */
export const KIT_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The app's script that runs the try board (the root `package.json`'s, forwarding to apps/desktop's). */
export const TRY_SCRIPT = "smoke:plugin";

/** How long one try may take in all: a cold build of the app, then its own budgets (each row is bounded). */
export const TRY_TIMEOUT_MS = 15 * 60_000;

/** Where the stills and the log go unless `--shots` says otherwise: beside the plugin, never in its bundle. */
export const TRY_SHOTS_DIR = ".vibefield-try";

/** One object's row, as the app's smoke said it (`SMOKE_TRY_OBJECT`). */
export interface TryObjectRow {
  readonly type: string;
  readonly census: number;
  readonly faults: readonly { readonly kind?: unknown; readonly reason?: unknown }[];
  readonly picked: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
  readonly stills: Readonly<Record<string, string>> | null;
}

/** What one run of the app said. */
export interface TryOutput {
  readonly rows: readonly TryObjectRow[];
  readonly notes: readonly string[];
  readonly board: Readonly<Record<string, string>> | null;
  /** the smoke's own failure line (`SMOKE_TRY failed: …`), problems joined by " · " */
  readonly failure?: string;
  readonly ok: boolean;
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Read the app's try rows out of its output — every line, whatever else the app logged between them. */
export function readTryOutput(text: string): TryOutput {
  const rows: TryObjectRow[] = [];
  const notes: string[] = [];
  let board: Record<string, string> | null = null;
  let failure: string | undefined;
  let ok = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const at = (prefix: string): string | undefined =>
      line.startsWith(prefix) ? line.slice(prefix.length).trim() : undefined;
    const object = at("SMOKE_TRY_OBJECT ");
    if (object !== undefined) {
      const row = parseJson<TryObjectRow>(object);
      if (row !== undefined && typeof row.type === "string") rows.push(row);
      continue;
    }
    const said = at("SMOKE_TRY_NOTE ");
    if (said !== undefined) {
      notes.push(said);
      continue;
    }
    const stills = at("SMOKE_TRY_STILLS ");
    if (stills !== undefined) {
      board = parseJson<Record<string, string> | null>(stills) ?? null;
      continue;
    }
    const failed = at("SMOKE_TRY failed:");
    if (failed !== undefined) {
      failure = failed;
      continue;
    }
    if (line === "SMOKE_TRY_OK") ok = true;
  }
  return { rows, notes, board, ok, ...(failure !== undefined ? { failure } : {}) };
}

/** The smoke's problems that name `type` (it names each with what it saw). */
function problemsFor(failure: string | undefined, type: string): string[] {
  if (failure === undefined) return [];
  return failure.split(" · ").filter((p) => p.includes(type));
}

/** The verdicts one try says: a row per declared kind, the notes, and the app's own failure when no row explains it. */
export function tryVerdicts(
  types: readonly string[],
  output: TryOutput,
  exitCode: number | null,
  logPath: string,
): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const type of types) {
    const row = output.rows.find((r) => r.type === type);
    if (row === undefined) continue;
    if (row.census < 1) {
      const why = problemsFor(output.failure, type);
      verdicts.push(
        refuse(
          "try",
          "try-not-laid",
          why[0] ?? `${type} was not laid on the try board — the app's log says why: ${logPath}`,
          { pointer: type },
        ),
      );
      continue;
    }
    if (row.faults.length > 0) {
      verdicts.push(
        refuse(
          "try",
          "try-kind-refused",
          `the desk refused ${type}'s kind: ${row.faults.map((f) => String(f.reason)).join(" · ")}`,
          { pointer: type },
        ),
      );
      continue;
    }
    if (row.picked === null) {
      verdicts.push(
        refuse(
          "try",
          "try-not-picked",
          `${type} was laid but not picked on the drawn frame — the desk drew nothing of it where it lies, or its hit() misses what its pass draws${row.stills?.["light"] !== undefined ? ` (still: ${row.stills["light"]})` : ""}`,
          { pointer: type },
        ),
      );
      continue;
    }
    const w = Math.round(row.picked.x1 - row.picked.x0);
    const h = Math.round(row.picked.y1 - row.picked.y0);
    const stills = row.stills === null ? "" : ` — stills: ${Object.values(row.stills).join(" · ")}`;
    verdicts.push(
      pass(
        "try",
        `${type} is on the desk, DRAWN: laid on a fresh board, its kind made on the host's device (its WGSL compiled), picked across ${w} × ${h} CSS px${stills}`,
      ),
    );
  }
  for (const text of output.notes) verdicts.push(note("try", "try-desk-awake", text));
  const explained = verdicts.some((v) => v.level === "refuse");
  const missing = types.filter((type) => !output.rows.some((r) => r.type === type));
  if (!explained && (exitCode !== 0 || !output.ok || missing.length > 0)) {
    verdicts.push(
      refuse(
        "try",
        "try-app-failed",
        `the app's try run ${exitCode === 0 ? "said no row for" : `exited ${String(exitCode)} before it judged`} ${missing.length > 0 ? missing.join(", ") : types.join(", ")}${output.failure !== undefined ? `: ${output.failure}` : ""} — its log: ${logPath}`,
      ),
    );
  }
  if (output.board !== null && Object.keys(output.board).length > 0)
    verdicts.push(
      note("try", "try-stills", `the board: ${Object.values(output.board).join(" · ")}`),
    );
  return verdicts;
}

/** Run one command to completion, its output teed into `logPath`; resolves its exit code and its output. */
export type TryRunner = (opts: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly logPath: string;
  readonly timeoutMs: number;
}) => Promise<{ readonly code: number | null; readonly output: string }>;

/** The real runner: a child in its own process group (the app is a tree), killed whole at the timeout. */
export const spawnRunner: TryRunner = (opts) =>
  new Promise((resolvePromise) => {
    const chunks: string[] = [];
    const child = spawn(opts.command, [...opts.args], {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const take = (data: Buffer): void => {
      chunks.push(data.toString("utf8"));
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      chunks.push(
        `\nvibefield-plugin try: the app ran past ${opts.timeoutMs} ms and was stopped\n`,
      );
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    }, opts.timeoutMs);
    const settle = (code: number | null): void => {
      clearTimeout(timer);
      const output = chunks.join("");
      writeFileSync(opts.logPath, output);
      resolvePromise({ code, output });
    };
    child.once("error", (error) => {
      chunks.push(`\nvibefield-plugin try: ${opts.command} did not start: ${error.message}\n`);
      settle(127);
    });
    child.once("close", (code) => settle(code));
  });

/**
 * Try a plugin's kinds on the desk: the declared object types, the built entry, the app beside the kit; a dev root of
 * its own holding a COPY of the bundle; the app's try board; the verdicts. The dev root goes either way.
 */
export async function tryPlugin(opts: {
  readonly root: string;
  readonly manifest: PluginManifestV1;
  readonly shots?: string;
  readonly repoRoot?: string;
  readonly runner?: TryRunner;
  readonly timeoutMs?: number;
}): Promise<Verdict[]> {
  const types = (opts.manifest.contributes?.objects ?? []).map((row) => row.type);
  if (types.length === 0)
    return [
      refuse(
        "try",
        "try-no-objects",
        `${opts.manifest.id} declares no object kind (contributes.objects) — there is nothing to lay on the desk`,
        { pointer: "/contributes/objects" },
      ),
    ];
  const entry = opts.manifest.entries?.renderer;
  if (entry === undefined || !existsSync(resolve(opts.root, entry)))
    return [
      refuse(
        "try",
        "try-unbuilt",
        `${entry ?? "entries.renderer"} is not on disk — the desk loads the BUILT renderer`,
        { pointer: entry ?? "/entries/renderer" },
      ),
    ];
  const repoRoot = opts.repoRoot ?? KIT_REPO_ROOT;
  if (!hasTryScript(repoRoot))
    return [
      refuse(
        "try",
        "try-app-missing",
        `no app beside this kit: ${repoRoot} has no "${TRY_SCRIPT}" script — try runs the VibeField app from the checkout the kit is installed in`,
      ),
    ];

  const shots = resolve(opts.shots ?? join(opts.root, TRY_SHOTS_DIR));
  mkdirSync(shots, { recursive: true });
  const logPath = join(shots, "try.log");
  const devRoot = mkdtempSync(join(tmpdir(), "vf-try-"));
  try {
    const linked = devLink({
      root: opts.root,
      manifest: opts.manifest,
      devRoot: { root: devRoot, origin: "flag" },
    });
    if (linked.verdicts.some((v) => v.level === "refuse")) return linked.verdicts;
    const run = await (opts.runner ?? spawnRunner)({
      command: "pnpm",
      args: ["--dir", repoRoot, TRY_SCRIPT],
      cwd: repoRoot,
      env: {
        ...process.env,
        FIELDD_PLUGIN_DEV_ROOTS: devRoot,
        VF_SMOKE_TRY: types.join(","),
        VF_SMOKE_SHOT_DIR: shots,
      },
      logPath,
      timeoutMs: opts.timeoutMs ?? TRY_TIMEOUT_MS,
    });
    return [
      pass(
        "try",
        `${opts.manifest.id} staged alone in a dev root of its own (a copy of its bundle) and the app run on a fresh profile — its log: ${logPath}`,
      ),
      ...tryVerdicts(types, readTryOutput(run.output), run.code, logPath),
    ];
  } finally {
    rmSync(devRoot, { recursive: true, force: true });
  }
}

/** Is there an app with the try script at `repoRoot`? */
export function hasTryScript(repoRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return typeof pkg.scripts?.[TRY_SCRIPT] === "string";
  } catch {
    return false;
  }
}
