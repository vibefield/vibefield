#!/usr/bin/env node
// Build the standalone fieldd executable — a Node single-executable application.
//
// Specs: electron-distribution-and-tray.md EDP-14 (production fieldd is a standalone
// sidecar, never ELECTRON_RUN_AS_NODE), EDP-15 (the SEA is built with the Node major the
// repo pins — dev and release may not straddle majors), EDP-16 (a failed conformance gate
// blocks release; it never licenses falling back to RunAsNode) and §8.2 (the SEA
// configuration + acceptance list). electron-security-packaging.md §9.3 condition 1 — the
// artifact this script produces is what lets RunAsNode be disabled at all.
//
// The mechanics below are not invented here: probe P-A (implementation plan §7, F-9…F-13)
// established them empirically on Node 26 / macOS arm64 — blob → copy node → postject with
// the SEA sentinel fuse → ad-hoc codesign, two sidecars that cannot be embedded, ~145 MB.
// This script is that probe made reproducible and assertable.
//
// Usage:
//   node apps/desktop/packaging/build-fieldd-sea.mjs [--out <dir>] [--verify]
//                                                    [--timestamp <iso8601|epoch-seconds>]
//
// Node >=26 ESM. Depends only on builtins plus `postject`, resolved from apps/desktop's
// node_modules — a build step that reaches the network (npx) is not reproducible.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { constants as osConstants, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { FLOOR_BINARIES } from "../../../scripts/native-floor.mjs";
// Item 178 — the sidecars are ONE table with the stager's (it spreads these rows into its PLAN).
import { AGENT_SHIM_BUNDLE, MILLE_NATIVE, SIDECARS } from "./fieldd-sidecars.mjs";

const root = resolve(import.meta.dirname, "..", "..", "..");
const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const outDir = resolve(root, argValue("--out") ?? join("apps", "desktop", "build", "fieldd-sea"));
const wantVerify = args.includes("--verify");

const FIELDD_DIST = join(root, "packages", "fieldd", "dist");
const BUNDLE = join(FIELDD_DIST, "bin.cjs");
const BUILD_CMD = "pnpm --filter @vibefield/fieldd build";
const EXE_NAME = "fieldd";
const MANIFEST_NAME = "fieldd.sea.manifest.json";

// F-10: none of the sidecars can live inside the blob, and each resolves against the EXECUTABLE'S directory (F-11:
// __dirname in a SEA is the executable's dir, not the cwd), so whatever stages the package must copy them beside the
// binary. Their table, with each one's why, is fieldd-sidecars.mjs; the manifest below re-states it off the artifact.

// The executable's closed roles (packages/fieldd/src/roles.ts, spelled again here: this
// script imports no TypeScript). bin.ts dispatches on the FIRST argument alone.
const FILES_HOST_ROLE_ARG = "--vibefield-role=files-host";
const TRANSCRIPT_HOST_ROLE_ARG = "--vibefield-role=transcript-host";
const FLOWS_HOST_ROLE_ARG = "--vibefield-role=flows-host";
const AGENT_SHIM_ROLE_ARG = "--vibefield-role=agent-shim";
// RV #1 (item 203; rv-forwarder-role at its lean A) — the agents' forwarder: what a packaged agent's command hooks and
// status lines run (fieldd agent-forwarder.ts lends it to puppeteer). Probe G runs it.
const AGENT_FORWARDER_ROLE_ARG = "--vibefield-role=agent-forwarder";

// AR-7j (electron-security-packaging.md §9.3, fuse-matrix.mjs's RunAsNode row) — the role makes
// this executable the program every typed agent's launcher runs, in a pane whose environment a
// same-uid process may have shaped. A SEA never parses its command line as Node's (every argument
// is the blob's), so two ways into a plain Node remain past a closed RunAsNode fuse:
//  - a Node option from the environment. Closed in the blob: `NODE_OPTIONS` is ignored (Node
//    26's `execArgvExtension: "none"`; the blob takes no execArgv of its own).
//  - SIGUSR1, which opens an inspector. NOT closed in the blob: `--disable-sigusr1` as the blob's
//    execArgv leaves SIGUSR1 BLOCKED for the whole process, and the agent-shim role execs the
//    agent in place, which keeps the mask — every typed agent, and what it starts without
//    resetting its mask, would be born deaf to SIGUSR1, unlike under `pnpm dev` (measured on
//    Node 26.5.0). So the four processes that stay (the daemon, the files worker, the transcript
//    worker and the flow host) take SIGUSR1 from the inspector with a listener of their own from
//    their first statement (bin.ts `refuseInspectorSignal`); what remains is the executable's
//    start before that statement, and the agent-shim role, which leaves SIGUSR1 to Node and holds
//    nothing a process of the same uid lacks.
// --verify probes each: NODE_OPTIONS and the agent's SIGUSR1 at probe D; the daemon's SIGUSR1 at
// probe A, the files worker's at C, the transcript worker's at C2 and the flow host's at C3.
const SEA_EXEC_ARGV_EXTENSION = "none";

// postject's SEA contract. The sentinel fuse and the Mach-O segment name are Node's, not
// postject's defaults — injecting under the default names produces a binary that runs as a
// plain Node REPL, which is the confusing failure mode P-A hit first.
const SEA_RESOURCE = "NODE_SEA_BLOB";
const SEA_SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const SEA_MACHO_SEGMENT = "NODE_SEA";

const fail = (msg) => {
  console.error(`build-fieldd-sea FAIL: ${msg}`);
  process.exit(1);
};

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const rel = (path) => relative(root, path).split(sep).join("/");
const describe = (path) => ({ path: rel(path), bytes: statSync(path).size, sha256: sha256(path) });
// Decimal MB on purpose: F-13 and the distribution spec's installer-size budget (§13.8)
// both talk in decimal, and a MiB figure here would read as an unexplained 5% shrink.
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

// --- 1. the Node major, asserted (EDP-15, decision D-node) --------------------
// EL8's lockstep law applied to the runtime itself: the SEA embeds whichever Node is
// running this script, so a developer on a different major silently ships a different
// runtime than the one the repo tests against. .nvmrc is the single source of that number
// — this refuses rather than records the drift.
function assertNodeMajor() {
  const nvmrcPath = join(root, ".nvmrc");
  if (!existsSync(nvmrcPath)) fail(`no .nvmrc at ${rel(nvmrcPath)} — EDP-15 has nothing to pin to`);
  const pinned = readFileSync(nvmrcPath, "utf8").trim();
  const pinnedMajor = Number(pinned.replace(/^v/, "").split(".")[0]);
  if (!Number.isInteger(pinnedMajor)) {
    fail(`.nvmrc says "${pinned}", which names no Node major — EDP-15 needs a concrete version`);
  }
  const running = process.versions.node;
  const runningMajor = Number(running.split(".")[0]);
  if (runningMajor !== pinnedMajor) {
    console.error(
      [
        `build-fieldd-sea FAIL: Node major mismatch — running ${running}, .nvmrc pins ${pinned}.`,
        "",
        "EDP-15 forbids dev and release straddling Node majors: this executable EMBEDS the",
        "running Node binary, so building it here would ship a runtime the repo never tests.",
        `Switch first (\`nvm use\` / \`fnm use\` reads .nvmrc), then re-run.`,
      ].join("\n"),
    );
    process.exit(1);
  }
  return { version: running, major: runningMajor, pinned };
}

// --- 2. the inputs, asserted present and fresh --------------------------------
// "Never build a SEA from a stale or missing bundle" is not pedantry: the artifact is
// opaque once injected, and a stale blob produces a 145 MB binary that looks perfect and
// runs last week's daemon. Cheapest honest check is mtime against the sources esbuild
// actually consumes — fieldd's own src plus the workspace packages it declares.
function workspaceSourceDirs() {
  const fieldd = JSON.parse(readFileSync(join(root, "packages", "fieldd", "package.json"), "utf8"));
  const wanted = new Set(
    Object.entries(fieldd.dependencies ?? {})
      .filter(([, spec]) => String(spec).startsWith("workspace:"))
      .map(([name]) => name),
  );
  const dirs = [join(root, "packages", "fieldd", "src")];
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJson = join(root, "packages", entry.name, "package.json");
    if (!existsSync(pkgJson)) continue;
    const { name } = JSON.parse(readFileSync(pkgJson, "utf8"));
    // Directory names and package names disagree (plugin-build lives in plugin-runtime),
    // so match on the declared name rather than guessing the path.
    if (wanted.has(name) && existsSync(join(root, "packages", entry.name, "src"))) {
      dirs.push(join(root, "packages", entry.name, "src"));
    }
  }
  return dirs;
}

function newestSourceFile(dirs) {
  let newest = { path: undefined, mtimeMs: 0 };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx|mjs|cjs|js|json|wasm)$/.test(entry.name)) {
        const { mtimeMs } = statSync(p);
        if (mtimeMs > newest.mtimeMs) newest = { path: p, mtimeMs };
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return newest;
}

function assertInputs() {
  const missing = [BUNDLE, ...SIDECARS.map((s) => join(FIELDD_DIST, s.name))].filter(
    (p) => !existsSync(p),
  );
  if (missing.length > 0) {
    console.error(
      [
        `build-fieldd-sea FAIL: fieldd's build output is incomplete — missing ${missing
          .map(rel)
          .join(", ")}.`,
        "",
        `Produce it first:  ${BUILD_CMD}`,
      ].join("\n"),
    );
    process.exit(1);
  }
  const bundleMtime = statSync(BUNDLE).mtimeMs;
  const newest = newestSourceFile(workspaceSourceDirs());
  if (newest.path !== undefined && newest.mtimeMs > bundleMtime) {
    console.error(
      [
        `build-fieldd-sea FAIL: ${rel(BUNDLE)} is older than ${rel(newest.path)}.`,
        "",
        "A SEA is opaque once injected — a stale bundle ships as a binary that looks correct.",
        `Rebuild first:  ${BUILD_CMD}`,
      ].join("\n"),
    );
    process.exit(1);
  }
}

// --- 3. build ------------------------------------------------------------------
function run(cmd, cmdArgs, what, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: ["ignore", "inherit", "inherit"], ...opts });
  if (r.error) fail(`${what}: ${r.error.message}`);
  if (r.status !== 0) fail(`${what} exited ${r.status ?? `on ${r.signal}`}`);
}

function buildSea() {
  mkdirSync(outDir, { recursive: true });
  const exe = join(outDir, EXE_NAME);
  const blob = join(outDir, "fieldd.blob");
  const cfg = join(outDir, "sea-config.json");

  // RELATIVE paths, generated from inside outDir — not a style choice. Node's SEA
  // blob RECORDS the main script's path verbatim, so an absolute `main` ships the
  // build machine's home directory inside a 145 MB binary. stage-package's §13.2
  // leak check caught exactly that on the first real build; with a bare `bin.cjs`
  // the recorded string is `bin.cjs` and nothing else. The bundle is copied in
  // rather than referenced so the relative name resolves.
  const localBundle = join(outDir, "bin.cjs");
  copyFileSync(BUNDLE, localBundle);

  // useCodeCache/useSnapshot stay off: both bake V8 state tied to the exact Node build,
  // and neither is needed to meet the cold-start budget today. Turning either on is a
  // deliberate change with its own conformance evidence, not a default.
  writeFileSync(
    cfg,
    `${JSON.stringify(
      {
        main: "bin.cjs",
        output: "fieldd.blob",
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        execArgvExtension: SEA_EXEC_ARGV_EXTENSION,
      },
      null,
      2,
    )}\n`,
  );
  run(process.execPath, ["--experimental-sea-config", "sea-config.json"], "sea-config", {
    cwd: outDir,
  });
  rmSync(localBundle, { force: true });

  // Copy the CURRENT Node binary — this is the runtime the .nvmrc guard above just
  // asserted, so the artifact and the repo's test runtime are the same build.
  copyFileSync(process.execPath, exe);
  chmodSync(exe, 0o755);

  // macOS: injection rewrites the Mach-O, which invalidates the signature Node ships with;
  // Apple Silicon refuses to execute an unsigned Mach-O at all, so the signature has to be
  // removed before and re-applied (ad-hoc) after. Real Developer ID signing is WP10's job.
  const darwin = process.platform === "darwin";
  if (darwin) run("codesign", ["--remove-signature", exe], "codesign --remove-signature");

  const require = createRequire(join(root, "apps", "desktop", "package.json"));
  const { inject } = require("postject");
  return { exe, blob, cfg, darwin, inject };
}

async function injectAndSign({ exe, blob, darwin, inject }) {
  await inject(exe, SEA_RESOURCE, readFileSync(blob), {
    sentinelFuse: SEA_SENTINEL,
    machoSegmentName: SEA_MACHO_SEGMENT,
    overwrite: true,
  });
  if (darwin) run("codesign", ["--sign", "-", exe], "codesign --sign -");
}

// --- 4. the manifest -----------------------------------------------------------
// Small, beside the artifact, and read BY the stager rather than duplicated in it: it
// names the sidecars that must travel with the executable and records what §8.2 asks
// release metadata to carry (Node version + bundle hash).
function resolveTimestamp() {
  const raw = argValue("--timestamp") ?? process.env["SOURCE_DATE_EPOCH"];
  if (raw === undefined) return new Date().toISOString();
  const epoch = Number(raw);
  const d = Number.isFinite(epoch) ? new Date(epoch * 1000) : new Date(raw);
  if (Number.isNaN(d.getTime())) fail(`--timestamp "${raw}" is neither ISO-8601 nor epoch seconds`);
  return d.toISOString();
}

function writeManifest({ exe, blobSha256, node }) {
  const manifest = {
    "//": "Standalone fieldd SEA (EDP-14/15, §8.2). Generated by apps/desktop/packaging/build-fieldd-sea.mjs — do not hand-edit.",
    kind: "fieldd-sea",
    builtAt: resolveTimestamp(),
    platform: process.platform,
    arch: process.arch,
    node: { version: node.version, major: node.major, nvmrc: node.pinned },
    source: describe(BUNDLE),
    output: { name: EXE_NAME, ...describe(exe) },
    // The stager copies these BESIDE the executable. They are not optional and they are
    // not embeddable (F-10); a package missing either boots into a bare ENOENT.
    sidecars: SIDECARS.map((s) => ({
      name: s.name,
      ...describe(join(FIELDD_DIST, s.name)),
      why: s.why,
    })),
    sea: {
      resourceName: SEA_RESOURCE,
      sentinelFuse: SEA_SENTINEL,
      machoSegmentName: SEA_MACHO_SEGMENT,
      blobSha256,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: SEA_EXEC_ARGV_EXTENSION,
      // AR-7j — not the blob's: bin.ts's own listener, in each of the four processes that stay
      sigusr1Inspector:
        "refused by each staying process's own listener: the daemon, the files worker, the transcript worker and the flow host, asked at --verify's probes A, C, C2 and C3",
    },
    signature: process.platform === "darwin" ? "adhoc" : "none",
  };
  const path = join(outDir, MANIFEST_NAME);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, path };
}

// --- 5. --verify: does it boot, and does it stay off the filesystem? -----------
// Both claims are made by RUNNING the artifact, never by reasoning about it. §8.2 asks for
// "proves zero filesystem node_modules resolution" — absence of node_modules proves only
// that nothing was there to find, so the second sandbox plants a hostile one.

/** Walk to the filesystem root asserting no ancestor could supply a node_modules. */
function ancestorsWithNodeModules(dir) {
  const hits = [];
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, "node_modules"))) hits.push(cur);
    const parent = dirname(cur);
    if (parent === cur) return hits;
    cur = parent;
  }
}

/**
 * Boot the executable and wait for fieldd's readiness line. There is no `timeout` binary on
 * this macOS, so the deadline is a timer over a child process. `atReady`, when given, is asked
 * of the READY daemon before it is stopped (`{ child, stderr }`), and what it answers is the
 * result's `atReady`.
 */
function bootProbe({ exe, cwd, env, deadlineMs = 30_000, atReady }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(exe, [], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    // while `atReady` is asked, an exit is the ask's answer (read after it), not an early one
    let asking = false;
    const gone = () => child.exitCode !== null || child.signalCode !== null;
    const finish = async (result) => {
      if (settled || asking) return;
      clearTimeout(timer);
      if (result.ok === true && atReady !== undefined) {
        asking = true;
        let answer;
        try {
          answer = await atReady({ child, stderr: () => stderr });
        } catch (e) {
          answer = { failed: e instanceof Error ? e.message : String(e) };
        }
        asking = false;
        result = { ...result, atReady: answer };
        if (settled) return;
        if (gone()) {
          // the ask ended the daemon: said as it happened, never as a shutdown
          settled = true;
          done({
            ...result,
            stdout,
            stderr,
            endedByAsk: String(child.signalCode ?? child.exitCode),
          });
          return;
        }
      }
      if (settled) return;
      settled = true;
      // SIGTERM first — bin.ts installs a handler and shuts the daemon down; a process
      // that needs SIGKILL is itself a finding (§8.2 "bounded shutdown").
      const termAt = Date.now();
      let reported = false;
      const report = () => {
        if (reported) return;
        reported = true;
        clearTimeout(hard);
        done({ ...result, stdout, stderr, shutdownMs: Date.now() - termAt });
      };
      child.once("exit", report);
      child.kill("SIGTERM");
      const hard = setTimeout(() => child.kill("SIGKILL"), 5_000);
      if (gone()) report();
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: `no readiness line within ${deadlineMs} ms` }),
      deadlineMs,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready === true) finish({ ok: true, ready: msg, bootMs: Date.now() - started });
        } catch {
          // partial line; the next chunk completes it
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (e) => finish({ ok: false, reason: `spawn failed: ${e.message}` }));
    child.once("exit", (code, signal) => {
      if (settled || asking) return;
      settled = true;
      clearTimeout(timer);
      done({ ok: false, reason: `exited early (${signal ?? code})`, stdout, stderr });
    });
  });
}

/** AR-7j (ESP §9.3) — asked of a READY process that stays (the daemon at probe A; the files
 * worker, the transcript worker and the flow host at probes C, C2 and C3): SIGUSR1, which on a
 * plain Node opens an inspector on 127.0.0.1:9229 and says "Debugger listening" on stderr. The
 * process's own listener (bin.ts `refuseInspectorSignal`) makes it nothing: no inspector, and
 * the process still running. */
async function sigusr1Ask({ child, stderr }) {
  const before = stderr().length;
  child.kill("SIGUSR1");
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  const said = stderr().slice(before);
  return {
    inspector: /Debugger listening/u.test(said),
    alive: child.exitCode === null && child.signalCode === null,
  };
}

/** AR-7j — the --verify row for a role's sigusr1Ask answer (probes C, C2 and C3), as `say`'s
 * arguments: green only when SIGUSR1 opened no inspector and the host still ran. No answer is a
 * host that ended before the ask could read it. */
function sigusr1Row(role, answer) {
  if (answer === undefined)
    return [false, `${role} role: SIGUSR1 never answered (the host ended first)`];
  const ok = answer.inspector === false && answer.alive === true;
  return [
    ok,
    `${role} role: SIGUSR1 ${answer.inspector ? "OPENED AN INSPECTOR" : "opened no inspector"}, the host ${answer.alive ? "still running" : "ENDED by it"}${ok ? " (its own listener, bin.ts refuseInspectorSignal)" : ""}`,
  ];
}

/**
 * AR-7j — run the executable as a packaged launcher runs it (the kit's `launcherScript`):
 * `<exe> --vibefield-role=agent-shim <home>/lib/agent-shim.cjs <the agent's arguments…>`, the
 * launcher's variables set. The home holds no rendezvous, so the SEALED shim finds nothing to
 * manage and execs the program in place — what it does for a name no gateway offers — which
 * makes the stub's own record the witness of what the role handed on. The home's copy is
 * POISONED (run, it would say so and leave 99), NODE_OPTIONS names a file that says so if it
 * is ever loaded, and fieldd's own variables name a data directory that must not appear.
 */
function agentShimProbe({ exe, root, deadlineMs = 30_000 }) {
  const home = join(root, "home");
  const programs = join(root, "programs");
  mkdirSync(join(home, "lib"), { recursive: true });
  mkdirSync(programs, { recursive: true });
  const said = join(root, "stub-said");
  const usr1 = join(root, "stub-usr1");
  const marks = {
    homeCopy: join(root, "HOME-COPY-RAN"),
    nodeOptions: join(root, "NODE-OPTIONS-RAN"),
  };
  const name = "vf-shim-probe";
  // the program a person typed: its pid (the role execs in place: ONE pid), then each argument
  // it was given, one a line in brackets, and it leaves 7 — so the role's status is the agent's.
  // Before it leaves it asks what SIGUSR1 does to a shell it starts: a shell born with the signal
  // unblocked dies by it (128 + SIGUSR1), one born with it blocked lives on (0) — the mask the
  // agent was handed, which the exec in place keeps
  const stub = join(programs, name);
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      `echo "pid=$$" > '${said}'`,
      `for argument in "$@"; do printf '[%s]\\n' "$argument"; done >> '${said}'`,
      `usr1=$( /bin/sh -c 'kill -USR1 $$' 2>/dev/null; echo $? ) 2>/dev/null`,
      `echo "$usr1" > '${usr1}'`,
      "exit 7",
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
  const homeCopy = join(home, "lib", AGENT_SHIM_BUNDLE);
  writeFileSync(
    homeCopy,
    `require("node:fs").writeFileSync(${JSON.stringify(marks.homeCopy)}, "ran");\nprocess.exit(99);\n`,
  );
  const injected = join(root, "node-options.cjs");
  writeFileSync(
    injected,
    `require("node:fs").writeFileSync(${JSON.stringify(marks.nodeOptions)}, "ran");\n`,
  );
  const data = join(root, "data");
  // a typed agent's own arguments, a role's word among them: the agent's, never a role
  const agentArgs = [
    "--model",
    "two words",
    "",
    FILES_HOST_ROLE_ARG,
    TRANSCRIPT_HOST_ROLE_ARG,
    FLOWS_HOST_ROLE_ARG,
    AGENT_SHIM_ROLE_ARG,
  ];
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(exe, [AGENT_SHIM_ROLE_ARG, homeCopy, ...agentArgs], {
      cwd: "/",
      env: {
        PATH: `${programs}:/usr/bin:/bin`,
        HOME: home,
        PUPPETEER_SHIM_NAME: name,
        PUPPETEER_SHIM_HOME: home,
        PUPPETEER_SHIM_STRICT: "0",
        PUPPETEER_SHIM_STRIP: "",
        PUPPETEER_SHIM_LABEL: "VibeField",
        NODE_OPTIONS: `--require ${injected}`,
        FIELDD_DATA_DIR: data,
        FIELDD_USER_ROOT: join(data, "users", "1"),
        FIELDD_CONTROL_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
    const report = (code, signal, error) => {
      clearTimeout(timer);
      const text = existsSync(said) ? readFileSync(said, "utf8") : undefined;
      const lines = text === undefined ? [] : text.split("\n").filter((line) => line !== "");
      done({
        error,
        code,
        signal,
        ms: Date.now() - started,
        stdout,
        stderr,
        pid: child.pid,
        stubPid: lines[0]?.startsWith("pid=") ? Number(lines[0].slice(4)) : undefined,
        stubArgs: text === undefined ? undefined : lines.slice(1),
        wantArgs: agentArgs.map((argument) => `[${argument}]`),
        // what SIGUSR1 did to a shell the program started (`usr1` above), and what it does to one
        // born as under a plain Node: unblocked, so it dies by the signal
        usr1Status: existsSync(usr1) ? readFileSync(usr1, "utf8").trim() : undefined,
        usr1Want: String(128 + osConstants.signals.SIGUSR1),
        homeCopyRan: existsSync(marks.homeCopy),
        nodeOptionsRan: existsSync(marks.nodeOptions),
        dataTouched: existsSync(data),
      });
    };
    child.once("error", (e) => report(null, null, e.message));
    // `close`, not `exit`: what the program said is all read only once its stdio has closed
    child.once("close", (code, signal) => report(code, signal));
  });
}

/** AR-7j — a launcher the executable cannot run: the agent-shim role beside NO sealed shim (a
 * damaged install), or `roleArg` naming a role this build does not have (a launcher another
 * build wrote). One line in the person's words and the kit's cannot-run status; the home's
 * copy, poisoned, never runs, and no daemon makes the data directory fieldd's variables name. */
function agentShimMissingProbe({ exe, root, roleArg = AGENT_SHIM_ROLE_ARG, deadlineMs = 30_000 }) {
  const home = join(root, "home");
  mkdirSync(join(home, "lib"), { recursive: true });
  const ran = join(root, "HOME-COPY-RAN");
  const data = join(root, "data");
  const homeCopy = join(home, "lib", AGENT_SHIM_BUNDLE);
  writeFileSync(
    homeCopy,
    `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "ran");\nprocess.exit(99);\n`,
  );
  return new Promise((done) => {
    const child = spawn(exe, [roleArg, homeCopy, "--resume", "x"], {
      cwd: "/",
      env: {
        PATH: "/usr/bin:/bin",
        HOME: home,
        PUPPETEER_SHIM_NAME: "vf-shim-probe",
        FIELDD_DATA_DIR: data,
        FIELDD_CONTROL_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
    const report = (code, signal, error) => {
      clearTimeout(timer);
      done({
        error,
        code,
        signal,
        stdout,
        stderr,
        homeCopyRan: existsSync(ran),
        dataTouched: existsSync(data),
      });
    };
    child.once("error", (e) => report(null, null, e.message));
    // `close`, not `exit`: what the program said is all read only once its stdio has closed
    child.once("close", (code, signal) => report(code, signal));
  });
}

/** RV #1 (item 203) — an argument the executable does not take, handed over as Claude Code's hook
 * command hands puppeteer 0.3's staged forwarder to the program it takes for Node: `<exe>
 * <dir>/<id>.hooks.mjs <endpoint> <variable> <ms>`. The daemon takes no argument, so one line and
 * the cannot-run status; the script, poisoned, never runs, and no daemon makes the data directory
 * fieldd's variables name. */
function strayArgumentProbe({ exe, root, deadlineMs = 30_000 }) {
  mkdirSync(root, { recursive: true });
  const ran = join(root, "SCRIPT-RAN");
  const data = join(root, "data");
  const script = join(root, "X.hooks.mjs");
  writeFileSync(
    script,
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(ran)}, "ran");`,
      "process.exit(99);",
      "",
    ].join("\n"),
  );
  const endpoint = "http://127.0.0.1:1/hooks";
  return new Promise((done) => {
    const child = spawn(exe, [script, endpoint, "PUPPETEER_HOOK_TOKEN", "5000"], {
      cwd: "/",
      env: {
        PATH: "/usr/bin:/bin",
        HOME: root,
        FIELDD_DATA_DIR: data,
        FIELDD_CONTROL_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
    const report = (code, signal, error) => {
      clearTimeout(timer);
      done({
        error,
        code,
        signal,
        stdout,
        stderr,
        scriptRan: existsSync(ran),
        dataTouched: existsSync(data),
      });
    };
    child.once("error", (e) => report(null, null, e.message));
    // `close`, not `exit`: what the program said is all read only once its stdio has closed
    child.once("close", (code, signal) => report(code, signal));
  });
}

/** RV #1 (item 203) — run the executable as a packaged agent's hooks and status lines run it: `<exe>
 * --vibefield-role=agent-forwarder <word> <word's arguments…>`, the agent's document on its input. The role runs the
 * forwarder sealed beside it (puppeteer's builtin entry), which relays the document to a loopback sink standing in
 * for the session's bridge, with the bearer its variable names: (i) a SessionStart hook (`claude.hook.v1`), and (ii)
 * a status line (`claude.statusline.v1`) whose delegate prints a word. The words are puppeteer's protocol, spelled
 * here only to drive it. fieldd's own variables name a data directory that must not appear; what the sink heard is
 * kept as facts (the path, whether the bearer and the document arrived whole), never the token. */
async function agentForwarderProbe({ exe, root, deadlineMs = 30_000 }) {
  mkdirSync(root, { recursive: true });
  const data = join(root, "data");
  const token = randomBytes(16).toString("hex");
  const heard = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      heard.push({ path: request.url, bearer: request.headers.authorization, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise((listening) => server.listen(0, "127.0.0.1", listening));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const once = (words, variables, input) =>
    new Promise((done) => {
      const from = heard.length;
      const child = spawn(exe, [AGENT_FORWARDER_ROLE_ARG, ...words], {
        cwd: "/",
        env: {
          PATH: "/usr/bin:/bin",
          HOME: root,
          FIELDD_DATA_DIR: data,
          FIELDD_CONTROL_PORT: "0",
          VF_PROBE_TOKEN: token,
          ...variables,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const started = Date.now();
      const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
      const report = (code, signal, error) => {
        clearTimeout(timer);
        const got = heard.slice(from);
        done({
          error,
          code,
          signal,
          ms: Date.now() - started,
          stdout,
          stderr,
          heard: got.map((each) => ({
            path: each.path,
            bearer: each.bearer === `Bearer ${token}`,
            whole: each.body === input,
          })),
        });
      };
      child.once("error", (e) => report(null, null, e.message));
      // `close`, not `exit`: what the program said is all read only once its stdio has closed
      child.once("close", (code, signal) => report(code, signal));
      // a role that leaves without reading its input closes the pipe under the write
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
  const sessionStart = JSON.stringify({
    session_id: "probe-g",
    cwd: root,
    hook_event_name: "SessionStart",
    source: "startup",
  });
  try {
    const hook = await once(
      ["claude.hook.v1", `${origin}/hooks`, "VF_PROBE_TOKEN", "5000"],
      {},
      sessionStart,
    );
    const status = await once(
      ["claude.statusline.v1"],
      {
        PUPPETEER_STATUSLINE_ENDPOINT: `${origin}/statusline`,
        PUPPETEER_STATUSLINE_DELEGATE: "printf hi",
        PUPPETEER_STATUSLINE_TOKEN_ENV_VAR: "VF_PROBE_TOKEN",
        // the relay's own bound, at the most the forwarder takes, as (i) hands its own: its 250 ms
        // default is a loaded build host's to miss, and a late relay is dropped in silence
        PUPPETEER_STATUSLINE_TIMEOUT_MS: "5000",
      },
      JSON.stringify({ session_id: "probe-g", cwd: root }),
    );
    return { hook, status, dataTouched: existsSync(data) };
  } finally {
    await new Promise((closed) => server.close(closed));
  }
}

/** TH-1 — run the executable as fieldd runs its transcript worker: the role argument, an IPC pipe, the folder and
 * its key on the pipe (never the environment), then one ticket registered and a shutdown. */
function transcriptHostProbe({ exe, folder, deadlineMs = 30_000 }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(exe, [TRANSCRIPT_HOST_ROLE_ARG], {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    let settled = false;
    const result = {};
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.send({ t: "shutdown" });
      } catch {
        // already gone
      }
      let reported = false;
      const report = () => {
        if (reported) return;
        reported = true;
        clearTimeout(hard);
        done({ ...result, ...outcome, stderr });
      };
      const hard = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", report);
      if (child.exitCode !== null || child.signalCode !== null) report();
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: `no answer within ${deadlineMs} ms` }),
      deadlineMs,
    );
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("message", (m) => {
      if (m?.t === "ready") {
        result.readyMs = Date.now() - started;
        result.port = m.port;
        // AR-7j — the ready worker is sent SIGUSR1 first (sigusr1Ask), as probe A asks the daemon;
        // the ticket is then asked of the worker that heard it
        void sigusr1Ask({ child, stderr: () => stderr }).then((answer) => {
          result.sigusr1 = answer;
          if (settled) return;
          child.send({
            t: "req",
            id: 1,
            op: "registerTicket",
            args: {
              ticket: randomBytes(32).toString("base64url"),
              spark: "sp-probe00",
              clientId: "probe",
              expiresAt: Date.now() + 60_000,
            },
          });
        });
      } else if (m?.t === "res" && m.id === 1) {
        if (!m.ok) return finish({ ok: false, reason: `ticket refused: ${m.error?.message}` });
        finish({ ok: m.value?.port === result.port, ticketPort: m.value?.port });
      } else if (m?.t === "fatal") {
        finish({ ok: false, reason: `fatal: ${m.reason}` });
      }
    });
    child.once("error", (e) => finish({ ok: false, reason: `spawn failed: ${e.message}` }));
    child.once("exit", (code, signal) => {
      if (!settled) finish({ ok: false, reason: `exited early (${signal ?? code})` });
    });
    child.send({
      t: "init",
      key: randomBytes(32).toString("base64"),
      dir: folder,
      allowedOrigins: [],
      generation: 1,
    });
  });
}

/** CP-4a2a — run the executable as fieldd runs a run's flow host: the role argument, its pipe on fd 3 (one JSON message
 * a line) and an environment of PATH alone, then one script (already rewritten, as fieldd's module-script.ts hands it) that makes one call and
 * reports whether the realm is locked down, its call answered, its end read, and a shutdown. The script runs in the
 * host's worker (4A2-Q7 (b)), so its `done` is also the witness that the packaged executable starts that worker from
 * the bundle beside it. */
function flowsHostProbe({ exe, deadlineMs = 30_000 }) {
  const script = [
    '(async () => {const meta = { name: "Probe" };',
    "const __vibefieldFlowDefault = async function () {",
    '  return [await agent("probe"), Object.isFrozen(Array.prototype), typeof process];',
    "};",
    "return __vibefieldFlowDefault;",
    "})()",
  ].join("\n");
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(exe, [FLOWS_HOST_ROLE_ARG], {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "ignore", "pipe", "pipe"],
    });
    const pipe = child.stdio[3];
    const tell = (message) => {
      if (pipe.writable) pipe.write(`${JSON.stringify(message)}\n`);
    };
    pipe.on("error", () => {
      // the child left: its exit says how
    });
    let stderr = "";
    let settled = false;
    const result = {};
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tell({ t: "shutdown" });
      let reported = false;
      const report = () => {
        if (reported) return;
        reported = true;
        clearTimeout(hard);
        done({ ...result, ...outcome, stderr });
      };
      const hard = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", report);
      if (child.exitCode !== null || child.signalCode !== null) report();
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: `no answer within ${deadlineMs} ms` }),
      deadlineMs,
    );
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const heard = (m) => {
      if (m?.t === "ready") {
        result.readyMs = Date.now() - started;
        // AR-7j — the ready host is sent SIGUSR1 first (sigusr1Ask), as probe A asks the daemon; the
        // run is then asked of the host that heard it
        void sigusr1Ask({ child, stderr: () => stderr }).then((answer) => {
          result.sigusr1 = answer;
          if (settled) return;
          tell({
            t: "run",
            script,
            input: {},
            limits: {
              callMaxBytes: 64 * 1024,
              logMaxChars: 200,
              heapMb: 128,
              rssMb: 512,
              argsDepthMax: 32,
            },
          });
        });
      } else if (m?.t === "call") {
        result.call = m.what;
        tell({ t: "answer", id: m.id, ok: true, value: "answered" });
      } else if (m?.t === "done") {
        const [answer, frozen, processKind] = Array.isArray(m.value) ? m.value : [];
        result.value = m.value;
        finish({ ok: answer === "answered" && frozen === true && processKind === "undefined" });
      } else if (m?.t === "threw" || m?.t === "fatal" || m?.t === "memory") {
        finish({
          ok: false,
          reason: `${m.t}: ${m.message ?? m.reason ?? "its worker passed its heap"}`,
        });
      }
    };
    let buffered = "";
    pipe.setEncoding("utf8");
    pipe.on("data", (chunk) => {
      buffered += chunk;
      for (let i = buffered.indexOf("\n"); i >= 0; i = buffered.indexOf("\n")) {
        const line = buffered.slice(0, i);
        buffered = buffered.slice(i + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          finish({ ok: false, reason: "the host's pipe carried a line that is not JSON" });
          return;
        }
        heard(m);
      }
    });
    child.once("error", (e) => finish({ ok: false, reason: `spawn failed: ${e.message}` }));
    child.once("exit", (code, signal) => {
      if (!settled) finish({ ok: false, reason: `exited early (${signal ?? code})` });
    });
  });
}

/** FS-1a — run the executable as fieldd runs its files worker: the role argument,
 * an IPC pipe, the engine's explicit path, then one list and a shutdown. */
function filesHostProbe({ exe, native, folder, deadlineMs = 30_000 }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(exe, [FILES_HOST_ROLE_ARG], {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    let settled = false;
    const result = {};
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.send({ t: "shutdown" });
      } catch {
        // already gone
      }
      let reported = false;
      const report = () => {
        if (reported) return;
        reported = true;
        clearTimeout(hard);
        done({ ...result, ...outcome, stderr });
      };
      const hard = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", report);
      if (child.exitCode !== null || child.signalCode !== null) report();
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: `no answer within ${deadlineMs} ms` }),
      deadlineMs,
    );
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("message", (m) => {
      if (m?.t === "ready") {
        result.readyMs = Date.now() - started;
        result.mille = m.mille?.packageVersion;
        // AR-7j — the ready worker is sent SIGUSR1 first (sigusr1Ask), as probe A asks the daemon;
        // the list is then asked of the worker that heard it
        void sigusr1Ask({ child, stderr: () => stderr }).then((answer) => {
          result.sigusr1 = answer;
          if (settled) return;
          child.send({
            t: "req",
            id: 1,
            op: "list",
            args: { rootPath: folder, segments: [], offset: 0, limit: 50, kinds: "all" },
          });
        });
      } else if (m?.t === "res" && m.id === 1) {
        if (!m.ok) return finish({ ok: false, reason: `list refused: ${m.error?.message}` });
        result.listed = m.value.entries.length;
        child.send({ t: "req", id: 2, op: "stats", args: {} });
      } else if (m?.t === "res" && m.id === 2) {
        finish({ ok: true, rss: m.value?.rss ?? 0 });
      } else if (m?.t === "fatal") {
        finish({ ok: false, reason: `fatal: ${m.reason}` });
      }
    });
    child.once("error", (e) => finish({ ok: false, reason: `spawn failed: ${e.message}` }));
    child.once("exit", (code, signal) => {
      if (!settled) finish({ ok: false, reason: `exited early (${signal ?? code})` });
    });
    child.send({ t: "init", milleNative: native });
  });
}

/** Everything fieldd is allowed to see: no NODE_*, no inherited FIELD_*, no ambient PATH. */
function sandboxEnv(home, dataDir, nativeBin) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: home,
    // Ephemeral ports: a developer's real daemon may already hold the registered ones,
    // and a port collision would look exactly like a boot failure.
    FIELDD_DATA_DIR: dataDir,
    FIELDD_CONTROL_PORT: "0",
    FIELDD_DATA_PORT: "0",
    // Two planes: fieldd's bootstrap blocks on field-native's pairing file, so "it boots"
    // is only answerable with a native plane present. Pointing at a copy in the sandbox
    // keeps the executable's own directory pristine and gives §8.2's "launches the paired
    // field-native binary" a real answer instead of a mocked one.
    FIELDD_NATIVE_BIN: nativeBin,
  };
}

// TC-S2 + F1 — field-native's siblings (its terminal cell, its freeway host), spawned by the floor
// beside itself (`native-floor.mjs`). No `.exe` variant: this probe is unix-only throughout (it
// execs /usr/bin/pkill and pins PATH to /usr/bin:/bin), so a win32 name here would be the only
// ported line in the file.
const FLOOR_SIBLINGS = FLOOR_BINARIES.slice(1);

/** The release field-native, or the debug one; `--native-bin` overrides both. */
function findNativeBin() {
  const override = argValue("--native-bin");
  const candidates =
    override !== undefined
      ? [resolve(root, override)]
      : [
          join(root, "target", "release", "field-native"),
          join(root, "target", "debug", "field-native"),
        ];
  return candidates.find((p) => existsSync(p));
}

/**
 * field-native is spawned DETACHED and outlives fieldd by design (two planes) — the probe
 * must reap the copy it made, or every verify run leaks a daemon holding a sandbox that is
 * about to be deleted. Matching on the sandbox path keeps a developer's real one untouched.
 */
function reapNative(nativePath) {
  spawnSync("/usr/bin/pkill", ["-f", nativePath], { stdio: "ignore" });
}

function stageSandbox(dir, exe) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(exe, join(dir, EXE_NAME));
  chmodSync(join(dir, EXE_NAME), 0o755);
  for (const s of SIDECARS) copyFileSync(join(FIELDD_DIST, s.name), join(dir, s.name));
  return join(dir, EXE_NAME);
}

/** A node_modules that screams if it is ever consulted. */
function plantPoison(dir, marker) {
  for (const name of ["loro-crdt", "ws", "ajv"]) {
    const pkg = join(dir, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, version: "0.0.0-poison" }));
    writeFileSync(
      join(pkg, "index.js"),
      [
        "// Planted by build-fieldd-sea.mjs --verify. Loading this file at all means the",
        "// executable resolved a dependency from the filesystem, which EDP §8.2 forbids.",
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name)});`,
        `throw new Error("filesystem node_modules was consulted for ${name}");`,
      ].join("\n"),
    );
  }
}

async function verify({ exe, manifest }) {
  const problems = [];
  const say = (ok, line) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${line}`);
    if (!ok) problems.push(line);
  };
  console.log("verify — the artifact, exercised");

  // The manifest is evidence only if it describes THIS file.
  say(sha256(exe) === manifest.output.sha256, `manifest sha256 matches ${rel(exe)}`);

  const nativeSource = findNativeBin();
  if (nativeSource === undefined) {
    console.error(
      [
        "build-fieldd-sea FAIL: --verify needs a field-native binary — fieldd's bootstrap",
        "waits for the native plane's pairing file and exits without one.",
        "",
        "Produce it first:  pnpm --filter @vibefield/desktop build:native-release   (or pass --native-bin <path>)",
      ].join("\n"),
    );
    process.exit(1);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "fieldd-sea-verify-"));
  const nativeBin = join(sandbox, "native", "field-native");
  mkdirSync(dirname(nativeBin), { recursive: true });
  copyFileSync(nativeSource, nativeBin);
  chmodSync(nativeBin, 0o755);
  // TC-S2 + F1 — the floor booted here is a REAL floor: its terminal unit spawns the cell, and its
  // freeway unit the host on fieldd's first declaration, each resolved as its own sibling. Copying
  // them from the floor's own directory reproduces that resolution law in the sandbox instead of
  // booting a floor that could only report them missing; taking them from `dirname(nativeSource)`
  // also keeps the set matched, so a release floor is never paired with a debug sibling.
  for (const name of FLOOR_SIBLINGS) {
    const source = join(dirname(nativeSource), name);
    const present = existsSync(source);
    if (present) {
      const bin = join(dirname(nativeBin), name);
      copyFileSync(source, bin);
      chmodSync(bin, 0o755);
    }
    say(
      present,
      present
        ? `${name} staged beside the floor — ${rel(source)}`
        : `no ${name} beside ${rel(nativeSource)}; that floor can only report it missing. ` +
            "Build the set: pnpm --filter @vibefield/desktop build:native-release",
    );
  }
  try {
    const ancestors = ancestorsWithNodeModules(sandbox);
    say(
      ancestors.length === 0,
      `sandbox has no node_modules ancestor${ancestors.length > 0 ? ` (found: ${ancestors.join(", ")})` : ""}`,
    );

    // Probe A — a directory holding the executable and its sidecars, nothing else.
    // cwd is `/` deliberately: F-11's claim is that __dirname follows the EXECUTABLE, so
    // booting from an unrelated cwd is the claim, not a detail.
    const clean = join(sandbox, "clean");
    const cleanExe = stageSandbox(clean, exe);
    const entries = readdirSync(clean).sort();
    say(
      entries.length === 1 + SIDECARS.length && entries.includes(EXE_NAME),
      `staged dir holds exactly the executable + ${SIDECARS.length} sidecars (${entries.join(", ")})`,
    );
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    const a = await bootProbe({
      exe: cleanExe,
      cwd: "/",
      // Data dirs stay terse: field-native's mgmt socket lives under them, and a unix
      // socket path over SUN_LEN (~104 bytes) fails as "path must be shorter than SUN_LEN".
      env: sandboxEnv(home, join(sandbox, "dA"), nativeBin),
      // AR-7j — before it is stopped, the ready daemon is sent SIGUSR1 (sigusr1Ask)
      atReady: sigusr1Ask,
    });
    reapNative(nativeBin);
    say(
      a.ok === true,
      a.ok
        ? `boots from a node_modules-free tree with cwd=/ — ready in ${a.bootMs} ms on control port ${a.ready.port}, bootId ${a.ready.bootId}`
        : `boot: ${a.reason}${a.stderr ? ` — stderr: ${a.stderr.trim().split("\n").slice(-3).join(" / ")}` : ""}`,
    );
    // The PluginHost worker is the F-11 claim in practice: it is `new Worker(join(__dirname,
    // "service-harness.mjs"))`, so a booted daemon whose harness sits beside the executable
    // proves the sidecar resolved against the EXECUTABLE'S directory, not the cwd.
    if (a.ok) {
      say(
        !/service-harness|Cannot find module|ENOENT/.test(a.stderr),
        "no missing-sidecar complaint on stderr (worker harness resolved from the executable's dir)",
      );
    }
    // AR-7j (ESP §9.3) — the daemon's own SIGUSR1 listener: no debugger by a signal, and no crash either
    if (a.ok) {
      say(
        a.atReady?.inspector === false,
        a.atReady?.failed !== undefined
          ? `SIGUSR1 could not be asked: ${a.atReady.failed}`
          : "SIGUSR1 opened no inspector (the daemon's own listener, bin.ts refuseInspectorSignal)",
      );
      say(
        a.atReady?.alive === true,
        a.endedByAsk === undefined
          ? "SIGUSR1 left the daemon running"
          : `SIGUSR1 ENDED the daemon (${a.endedByAsk})`,
      );
    }
    if (a.ok && a.endedByAsk === undefined) {
      say(a.shutdownMs < 5_000, `SIGTERM shutdown in ${a.shutdownMs} ms (no SIGKILL)`);
    }

    // Probe C (FS-1a, L1) — the executable in its files-host ROLE: the worker loads
    // the bundle and mille's engine staged beside it, says ready on its IPC pipe and
    // lists a folder. This is the packaged half of the files service, exercised.
    const c = await filesHostProbe({
      exe: cleanExe,
      native: join(clean, MILLE_NATIVE),
      folder: sandbox,
    });
    say(
      c.ok === true,
      c.ok
        ? `files-host role: ready in ${c.readyMs} ms (mille ${c.mille}), listed ${c.listed} entries of the sandbox, rss ${(c.rss / 1e6).toFixed(1)} MB`
        : `files-host role: ${c.reason}${c.stderr ? ` — stderr: ${c.stderr.trim().split("\n").slice(-3).join(" / ")}` : ""}`,
    );
    // AR-7j (ESP §9.3) — the files worker's own SIGUSR1 listener, asked once it said ready
    if (c.readyMs !== undefined) say(...sigusr1Row("files-host", c.sigusr1));

    // Probe C2 (TH-1) — the executable in its transcript-host ROLE: the mille-free worker loads
    // its bundle staged beside it, takes the folder and its key on its IPC pipe, says ready with
    // its loopback port and holds a ticket. The packaged half of the spark's transcript.
    const c2 = await transcriptHostProbe({ exe: cleanExe, folder: sandbox });
    say(
      c2.ok === true,
      c2.ok
        ? `transcript-host role: ready in ${c2.readyMs} ms on 127.0.0.1:${c2.port}, a ticket held`
        : `transcript-host role: ${c2.reason ?? `the ticket's port ${c2.ticketPort} is not the listener's ${c2.port}`}${c2.stderr ? ` — stderr: ${c2.stderr.trim().split("\n").slice(-3).join(" / ")}` : ""}`,
    );
    // AR-7j (ESP §9.3) — the transcript worker's own SIGUSR1 listener, asked once it said ready
    if (c2.readyMs !== undefined) say(...sigusr1Row("transcript-host", c2.sigusr1));

    // Probe C3 (CP-4a2a) — the executable in its flows-host ROLE: the host loads its bundle staged beside it, says
    // ready on its pipe (fd 3, one JSON message a line), starts the script's worker from the same bundle, which locks
    // its realm down, runs one script whose one call fieldd answers, and reports the realm frozen and no `process` in
    // the compartment. The packaged half of a run's host.
    const c3 = await flowsHostProbe({ exe: cleanExe });
    say(
      c3.ok === true,
      c3.ok
        ? `flows-host role: ready in ${c3.readyMs} ms, one ${c3.call} call answered, the realm frozen, no process in the compartment`
        : `flows-host role: ${c3.reason ?? `the script said ${JSON.stringify(c3.value)}`}${c3.stderr ? ` — stderr: ${c3.stderr.trim().split("\n").slice(-3).join(" / ")}` : ""}`,
    );
    // AR-7j (ESP §9.3) — the flow host's own SIGUSR1 listener, asked once it said ready
    if (c3.readyMs !== undefined) say(...sigusr1Row("flows-host", c3.sigusr1));

    // Probe D (AR-7j, LP-D1) — the executable in its agent-shim ROLE, exactly as every
    // packaged launcher execs it: the SEALED shim beside it runs (never the home's poisoned
    // copy), hands the typed program the agent's arguments exactly and execs it in place, with
    // SIGUSR1 as a plain Node hands it on; no daemon, no readiness line, no Node option from
    // the environment.
    const d = await agentShimProbe({ exe: cleanExe, root: join(sandbox, "shim") });
    const dTail = d.stderr ? ` — stderr: ${d.stderr.trim().split("\n").slice(-3).join(" / ")}` : "";
    say(
      d.error === undefined && d.code === 7,
      d.error !== undefined
        ? `agent-shim role: spawn failed: ${d.error}`
        : `agent-shim role: the typed program's own status came back (${d.signal ?? d.code}; the stub leaves 7) in ${d.ms} ms${dTail}`,
    );
    say(
      d.stubPid !== undefined && d.stubPid === d.pid,
      `agent-shim role: the sealed shim exec'd the program IN PLACE — one pid (role ${d.pid}, program ${d.stubPid ?? "never ran"})`,
    );
    say(
      JSON.stringify(d.stubArgs) === JSON.stringify(d.wantArgs),
      `agent-shim role: the agent's arguments passed on exactly, a role's word among them — ${JSON.stringify(d.stubArgs ?? null)}`,
    );
    say(
      !d.homeCopyRan,
      "agent-shim role: the shim home's copy (poisoned) never ran — argv[3] dropped unread",
    );
    say(
      !d.nodeOptionsRan,
      `agent-shim role: NODE_OPTIONS from the environment ignored (execArgvExtension "${SEA_EXEC_ARGV_EXTENSION}")`,
    );
    say(
      d.usr1Status === d.usr1Want,
      d.usr1Status === "0"
        ? "agent-shim role: the agent was born with SIGUSR1 BLOCKED — a shell it started lived through `kill -USR1 $$`; a plain Node hands it on unblocked"
        : `agent-shim role: the agent was born with SIGUSR1 as under a plain Node — a shell it started died by it (${d.usr1Status ?? "never asked"}, want ${d.usr1Want})`,
    );
    say(
      d.stdout === "" && d.stderr === "",
      `agent-shim role: no readiness line and nothing said${d.stdout || d.stderr ? ` (stdout ${JSON.stringify(d.stdout.slice(0, 200))}, stderr ${JSON.stringify(d.stderr.slice(0, 200))})` : ""}`,
    );
    say(
      !d.dataTouched,
      "agent-shim role: no daemon ran — the FIELDD_* data directory was never made",
    );

    // Probe E (AR-7j) — the same executable with NO sealed shim beside it (a damaged install):
    // a hard link of the clean copy, alone in its directory, so its sidecars are not beside it.
    const bare = join(sandbox, "no-shim");
    mkdirSync(bare, { recursive: true });
    const bareExe = join(bare, EXE_NAME);
    try {
      linkSync(cleanExe, bareExe);
    } catch {
      // a sandbox that takes no hard link: the copy it would have been
      copyFileSync(cleanExe, bareExe);
      chmodSync(bareExe, 0o755);
    }
    const e = await agentShimMissingProbe({ exe: bareExe, root: join(sandbox, "no-shim-run") });
    say(
      e.error === undefined &&
        e.code === 127 &&
        e.stdout === "" &&
        /^VibeField: vf-shim-probe was not started: .+ Reinstall VibeField\.\n$/u.test(e.stderr),
      e.error !== undefined
        ? `agent-shim role without its sealed shim: spawn failed: ${e.error}`
        : `agent-shim role without its sealed shim: one line in the person's words and the kit's cannot-run status (${e.signal ?? e.code}, want 127) — ${JSON.stringify(e.stderr.trim())}`,
    );
    say(!e.homeCopyRan, "agent-shim role without its sealed shim: the home's copy still never ran");

    // Probe F (AR-7j) — a role this build does not have, as a launcher another build wrote would
    // ask for it: refused in one line with the kit's cannot-run status, never the daemon.
    const f = await agentShimMissingProbe({
      exe: cleanExe,
      root: join(sandbox, "no-role-run"),
      roleArg: "--vibefield-role=no-such-role",
    });
    say(
      f.error === undefined &&
        f.code === 127 &&
        f.stdout === "" &&
        /^VibeField: vf-shim-probe was not started: .+ Open VibeField, then try again\.\n$/u.test(
          f.stderr,
        ) &&
        !f.homeCopyRan &&
        !f.dataTouched,
      f.error !== undefined
        ? `a role this build does not have: spawn failed: ${f.error}`
        : `a role this build does not have: one line, the kit's cannot-run status, no daemon (${f.signal ?? f.code}, want 127; data directory ${f.dataTouched ? "MADE" : "untouched"}) — ${JSON.stringify(f.stderr.trim())}`,
    );

    // Probe F2 (RV #1, item 203) — an argument the executable does not take: a script's path, as
    // Claude Code's hook command hands puppeteer 0.3's staged forwarder to the program it takes for
    // Node. The daemon takes none, so it is refused in one line with the cannot-run status: never
    // the daemon, and the script never run.
    const f2 = await strayArgumentProbe({ exe: cleanExe, root: join(sandbox, "stray-run") });
    say(
      f2.error === undefined &&
        f2.code === 127 &&
        f2.stdout === "" &&
        /^VibeField: this program takes no arguments; nothing was started\.\n$/u.test(f2.stderr) &&
        !f2.scriptRan &&
        !f2.dataTouched,
      f2.error !== undefined
        ? `an argument it does not take: spawn failed: ${f2.error}`
        : `an argument it does not take (a forwarder's script): one line, the cannot-run status, no daemon (${f2.signal ?? f2.code}, want 127; data directory ${f2.dataTouched ? "MADE" : "untouched"}; the script ${f2.scriptRan ? "RAN" : "never ran"}) — ${JSON.stringify(f2.stderr.trim())}`,
    );

    // Probe G (RV #1, item 203) — the executable in its agent-forwarder ROLE, as a packaged agent's command hooks and
    // status lines run it: the forwarder sealed beside it relays (i) a SessionStart hook's document and (ii) a status
    // line's, each with its bearer, to the probe's own loopback sink, and the status line's delegate is printed. No
    // daemon, no readiness line, no data directory.
    const g = await agentForwarderProbe({ exe: cleanExe, root: join(sandbox, "forwarder-run") });
    const relayed = (run, path) =>
      run.heard.length === 1 &&
      run.heard[0].path === path &&
      run.heard[0].bearer &&
      run.heard[0].whole;
    const gTail = (run) =>
      run.stderr ? ` — stderr: ${run.stderr.trim().split("\n").slice(-3).join(" / ")}` : "";
    say(
      g.hook.error === undefined &&
        g.hook.code === 0 &&
        g.hook.stdout === "" &&
        g.hook.stderr === "" &&
        relayed(g.hook, "/hooks"),
      g.hook.error !== undefined
        ? `agent-forwarder role, a hook: spawn failed: ${g.hook.error}`
        : `agent-forwarder role, a hook: ${g.hook.signal ?? g.hook.code} in ${g.hook.ms} ms (want 0), the sink heard ${JSON.stringify(g.hook.heard)} (want one /hooks, its bearer and its document whole), stdout ${JSON.stringify(g.hook.stdout.slice(0, 200))}${gTail(g.hook)}`,
    );
    say(
      g.status.error === undefined &&
        g.status.code === 0 &&
        g.status.stdout === "hi" &&
        relayed(g.status, "/statusline"),
      g.status.error !== undefined
        ? `agent-forwarder role, a status line: spawn failed: ${g.status.error}`
        : `agent-forwarder role, a status line: ${g.status.signal ?? g.status.code} in ${g.status.ms} ms (want 0), printed ${JSON.stringify(g.status.stdout.slice(0, 200))} (want "hi", its delegate's), the sink heard ${JSON.stringify(g.status.heard)}${gTail(g.status)}`,
    );
    say(
      !g.dataTouched,
      "agent-forwarder role: no daemon ran — the FIELDD_* data directory was never made",
    );

    // Probe B — the same files, plus a node_modules that would break the daemon if it
    // were ever read, and cwd set to that directory so both resolution roots are hostile.
    const poisoned = join(sandbox, "poisoned");
    const poisonedExe = stageSandbox(poisoned, exe);
    const marker = join(sandbox, "POISON-TOUCHED");
    plantPoison(poisoned, marker);
    const b = await bootProbe({
      exe: poisonedExe,
      cwd: poisoned,
      env: sandboxEnv(home, join(sandbox, "dB"), nativeBin),
    });
    reapNative(nativeBin);
    say(
      b.ok === true,
      b.ok
        ? `boots with a hostile node_modules beside it and as cwd (ready in ${b.bootMs} ms)`
        : `poisoned boot: ${b.reason}${b.stderr ? ` — stderr: ${b.stderr.trim().split("\n").slice(-3).join(" / ")}` : ""}`,
    );
    say(
      !existsSync(marker),
      existsSync(marker)
        ? `filesystem node_modules WAS consulted (${readFileSync(marker, "utf8")})`
        : "no filesystem node_modules resolution — loro-crdt, ws and ajv all came from the blob",
    );
  } finally {
    reapNative(nativeBin);
    rmSync(sandbox, { recursive: true, force: true });
  }
  return problems;
}

// --- main ----------------------------------------------------------------------
const node = assertNodeMajor();
assertInputs();
console.log(
  `build-fieldd-sea — node ${node.version} (.nvmrc ${node.pinned}) · ${process.platform}-${process.arch}`,
);
console.log(`  source ${rel(BUNDLE)} (${mb(statSync(BUNDLE).size)})`);

const built = buildSea();
// Hash the blob HERE, while it exists: injection consumes it, so hashing after
// injectAndSign reads a path that is already gone (the first real re-run of this
// script failed exactly that way). Its digest is what ties this executable to
// that bundle, and it is 1.4 MB of intermediate nothing should ship.
const blobSha256 = sha256(built.blob);
await injectAndSign(built);
rmSync(built.blob, { force: true });

const { manifest, path: manifestPath } = writeManifest({ ...built, blobSha256, node });
console.log(`  ${rel(built.exe)} — ${mb(manifest.output.bytes)}`);
console.log(`  ${rel(manifestPath)}`);
for (const s of manifest.sidecars) console.log(`  stage beside it: ${s.name} (${mb(s.bytes)})`);

if (wantVerify) {
  const problems = await verify({ exe: built.exe, manifest });
  if (problems.length > 0) {
    console.error(`build-fieldd-sea FAIL: ${problems.length} verification claim(s) did not hold`);
    process.exit(1);
  }
  console.log(
    "verify OK — boots standalone, resolves nothing from the filesystem, and each role runs only its sealed bundle",
  );
}
console.log(`build-fieldd-sea OK — ${basename(built.exe)}`);
