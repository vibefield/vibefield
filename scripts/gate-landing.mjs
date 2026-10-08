#!/usr/bin/env node
// DK-18 — THE LANDING GATE, VibeField's `gate:landing` by ICE's example (ICE's `pnpm run gate:landing`: the oracle, the stills,
// every rig and the pack audit — required at every landing, kept out of `ci` because it needs a GPU). The gates `pnpm verify`
// cannot carry need THIS host's GPU: `pnpm still` (Dawn on Metal, `webgpu` 0.4.0, `@napi-rs/canvas`'s darwin-arm64 binary) and
// every desktop smoke (Electron with the GPU kept, a window on the screen). They run here in order, ONE AT A TIME, each a fresh
// process with Nx's cache and daemon off (`NX_SKIP_NX_CACHE=true NX_DAEMON=false`); every smoke on its own temporary profile
// (`apps/desktop/packaging/run-smoke.mjs`, smoke:studio's `run-studio-smoke.mjs`), its run's daemons stopped by its own
// teardown and held gone by the launcher's row (`SMOKE_DAEMONS`). One verdict line per gate; exit 1 on any red.
// `docs/desk-gates.md` is the list: what each gate proves, where it runs, and its verdict at the landing SHA.
//
// Usage: node scripts/gate-landing.mjs [--with-stages] [--only a,b] [--from name] [--logs <dir>] [--list]
//   --with-stages   first `pnpm verify`'s chain stage by stage, each alone and EVERY one even after a red — `verify` stops at
//                   its first red, and preflight is red in every worktree by a sibling, so a worktree's grade runs them so;
//                   a red stage that is MAIN's known row is said so (`red — main's: …`), and still counts as red;
//   --only a,b      just these gates, by name; --from name: the list from this gate on;
//   --logs <dir>    where each gate's whole output goes (default: a fresh directory under the OS temp, named first);
//   --list          print the list and exit.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

const pnpm = (...args) => ["pnpm", ...args];

/** `pnpm verify`'s chain, stage by stage (package.json `verify`), each with what a red of MAIN's own looks like. */
export const STAGES = [
  { name: "preflight", run: pnpm("preflight"), main: preflightSiblingsOnly },
  { name: "check:walls", run: pnpm("check:walls") },
  { name: "check:deps", run: pnpm("check:deps"), main: secondCopiesOutside },
  { name: "check:retired", run: pnpm("check:retired") },
  { name: "check:ios-fixtures", run: pnpm("check:ios-fixtures") },
  { name: "icons:check", run: pnpm("icons:check") },
  { name: "typecheck", run: pnpm("typecheck") },
  { name: "lint", run: pnpm("lint") },
  { name: "fmt", run: ["cargo", "fmt", "--check"] },
  { name: "lint:rust", run: pnpm("lint:rust") },
  { name: "bundle:assert", run: pnpm("bundle:assert") },
  { name: "test", run: pnpm("test"), main: onlyAr7b },
  { name: "test:rust", run: pnpm("test:rust") },
  { name: "gen:check", run: pnpm("gen:check") },
];

/** The landing-only gates — this host's GPU — in order: the GPU-less canvas modes reuse smoke:canvas's build. */
export const LANDING = [
  { name: "still", run: pnpm("still") },
  { name: "smoke", run: pnpm("smoke") },
  { name: "smoke:canvas", run: pnpm("smoke:canvas") },
  { name: "smoke:canvas:no-gpu", run: pnpm("smoke:canvas:no-gpu") },
  { name: "smoke:canvas:no-webgpu", run: pnpm("smoke:canvas:no-webgpu") },
  { name: "smoke:kind-faults", run: pnpm("smoke:kind-faults") },
  { name: "smoke:plugin-restart", run: pnpm("smoke:plugin-restart") },
  { name: "smoke:plugin", run: pnpm("smoke:plugin") },
  { name: "smoke:godview", run: pnpm("smoke:godview") },
  { name: "smoke:terminal-door", run: pnpm("smoke:terminal-door") },
  { name: "smoke:terminal-direct", run: pnpm("smoke:terminal-direct") },
  { name: "smoke:studio", run: pnpm("smoke:studio") },
];

/** A terminal's colour codes, which vitest and nx print, left out of what a reading reads. */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");
const plain = (out) => out.replace(COLOUR, "");

/** preflight red by nothing but siblings off their pins (`preflight FAIL: <sibling> is at … but siblings.lock.json pins …`). */
export function preflightSiblingsOnly(out) {
  const fails = plain(out)
    .split("\n")
    .filter((l) => l.startsWith("preflight FAIL:"));
  return fails.length > 0 && fails.every((l) => /is at \S+ but siblings\.lock\.json pins/u.test(l))
    ? `a sibling off its pin: ${fails.map((l) => l.slice("preflight FAIL: ".length).split(" ")[0]).join(", ")}`
    : null;
}

/** check:deps red by second copies that all live OUTSIDE this checkout (main's FS-1b mille sibling links its host peers
 * absolutely into the checkout that ran `siblings:build`; plan addendum (84)) — every copy here one. */
export function secondCopiesOutside(text, root = ROOT) {
  const out = plain(text);
  if (!out.includes("single-copy law violated")) return null;
  const copies = out.split("\n").filter((l) => /^\s+\S+\s+←/u.test(l));
  const outside = copies.filter((l) => !l.includes(root) && /←\s+\//u.test(l));
  const here = copies.filter((l) => !outside.includes(l));
  const blocks = (out.match(/distinct .* copies are resolvable/gu) ?? []).length;
  return blocks > 0 && here.length === blocks && outside.length === blocks
    ? `the second copies all outside this checkout (${[...new Set(outside.map((l) => (/←\s+(\S+?)\/node_modules/u.exec(l) ?? [])[1]).filter(Boolean))].join(", ")})`
    : null;
}

/** test red by fieldd's agent-gateway AR-7b row alone (main's own). */
export function onlyAr7b(text) {
  const out = plain(text);
  const failedTasks = [...out.matchAll(/^\s*-\s+(@vibefield\/\S+):test\s*$/gmu)].map((m) => m[1]);
  const failedTests = out
    .split("\n")
    .filter((l) => /^\s*FAIL\s+test\//u.test(l) && l.includes(">"));
  return failedTasks.length === 1 &&
    failedTasks[0] === "@vibefield/fieldd" &&
    failedTests.length > 0 &&
    failedTests.every((l) => l.includes("agent-gateway.test.ts") && l.includes("AR-7b"))
    ? "fieldd's agent-gateway AR-7b row alone"
    : null;
}

/** The lines a verdict quotes: the run's own words for its result. */
const SAYS = [
  /^\s*Tests\s+\d+.*$/u,
  /^\s*Test Files\s+.*$/u,
  /Successfully ran target \S+ for \d+ projects/u,
  /^Checked \d+ files.*$/u,
  /^Found \d+ (?:error|warning)s?.*$/u,
  /check-import-boundaries: clean|self-test: all passed/u,
  /check-retired-names: .*$/u,
  /check-single-copy: .*$|single-copy law violated/u,
  /bundle assert OK.*$/u,
  /^preflight (?:FAIL|ok).*$/u,
  /test result: .*$/u,
  /^SMOKE_DAEMONS .*$/u,
  /^SMOKE_\w*failed.*$|^\w+ failed: .*$/u,
  /^STUDIO_PHYSICAL .*$/u,
  /^icons current.*$|^ios (?:fixtures|pins): .*$/u,
];

export function said(out) {
  const lines = plain(out).split("\n");
  const keep = [];
  for (const re of SAYS) {
    const hit = lines.filter((l) => re.test(l)).at(-1);
    if (hit !== undefined && !keep.includes(hit.trim())) keep.push(hit.trim());
  }
  return keep.map((l) => (l.length > 220 ? `${l.slice(0, 220)}…` : l));
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function choose() {
  let list = process.argv.includes("--with-stages") ? [...STAGES, ...LANDING] : [...LANDING];
  const only = argValue("--only");
  if (only !== undefined) {
    const names = only.split(",");
    const unknown = names.filter((n) => ![...STAGES, ...LANDING].some((g) => g.name === n));
    if (unknown.length > 0) throw new Error(`no such gate: ${unknown.join(", ")}`);
    list = [...STAGES, ...LANDING].filter((g) => names.includes(g.name));
  }
  const from = argValue("--from");
  if (from !== undefined) {
    const at = list.findIndex((g) => g.name === from);
    if (at < 0) throw new Error(`no such gate in the list: ${from}`);
    list = list.slice(at);
  }
  return list;
}

function runGate(gate, logPath) {
  return new Promise((done) => {
    const log = createWriteStream(logPath);
    const t0 = Date.now();
    const child = spawn(gate.run[0], gate.run.slice(1), {
      cwd: ROOT,
      env: { ...process.env, NX_SKIP_NX_CACHE: "true", NX_DAEMON: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("close", (code, signal) => {
      log.end(() => done({ code: code ?? 128, signal, ms: Date.now() - t0 }));
    });
  });
}

const load = () =>
  loadavg()
    .map((v) => v.toFixed(0))
    .join("/");

async function main() {
  const list = choose();
  if (process.argv.includes("--list")) {
    for (const g of list) process.stdout.write(`${g.name}\t${g.run.join(" ")}\n`);
    return 0;
  }
  const logs = argValue("--logs") ?? mkdtempSync(join(tmpdir(), "vf-gate-landing-"));
  mkdirSync(logs, { recursive: true });
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout.trim();
  process.stdout.write(
    `GATE_LANDING ${JSON.stringify({ sha: head, gates: list.length, logs, at: new Date().toISOString(), load: load() })}\n`,
  );
  // the Mac kept awake for as long as this runs (macOS's own tool; elsewhere nothing to do)
  if (process.platform === "darwin")
    spawn("caffeinate", ["-i", "-w", String(process.pid)], {
      stdio: "ignore",
      detached: true,
    }).unref();
  const verdicts = [];
  for (const [i, gate] of list.entries()) {
    const logPath = join(
      logs,
      `${String(i + 1).padStart(2, "0")}-${gate.name.replaceAll(":", "_")}.log`,
    );
    const before = load();
    const { code, ms } = await runGate(gate, logPath);
    const out = readFileSync(logPath, "utf8");
    const mains = code === 0 || gate.main === undefined ? null : gate.main(out);
    const verdict = code === 0 ? "ok" : mains !== null ? "red — main's" : "RED";
    verdicts.push({ gate: gate.name, verdict, code, main: mains });
    process.stdout.write(
      `GATE ${gate.name} ${verdict} exit=${code} ${(ms / 1000).toFixed(0)}s load ${before}→${load()}${mains === null ? "" : ` (main's: ${mains})`}\n`,
    );
    for (const line of said(out)) process.stdout.write(`    ${line}\n`);
    process.stdout.write(`    log ${logPath}\n`);
  }
  const red = verdicts.filter((v) => v.code !== 0);
  process.stdout.write(
    `GATE_LANDING_DONE ${JSON.stringify({ sha: head, ok: red.length === 0, red: red.map((v) => `${v.gate}${v.main === null ? "" : " (main's)"}`), at: new Date().toISOString() })}\n`,
  );
  return red.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(
        `gate-landing: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(2);
    },
  );
