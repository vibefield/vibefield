// WP12 L4 (WP12f, W9; build-wp12-updater.md §4, §14 — the PM's rulings 2026-10-15 21:41Z) — `pnpm smoke:update`.
//
// A DEV-keyed PACKAGED app (the zip a person downloads, R2) against the fixture update origin (`update-fixture.mjs`), in
// five runs, each judged from OUTSIDE the process — a packaged app hosts no smoke harness (it is kept out of the stage,
// and `NODE_OPTIONS` is fused off): the fixture's own request log, the desktop log, electron-updater's cache.
//
//   build   the run's keys minted in memory → its trust-root (public) → `package:stage --dev-trust-root` with the bundled
//           key in the stager's environment only (R1) → `--mac zip --arm64` into the run's root → W8's audits on it
//   1 staged      the good chain: N downloads; `desktop.update.staged` names N and the signed feed's sha512, which the
//                 cache's `update-info.json` repeats; the zip asked for once. Squirrel's FIRST touch is this moment
//                 (`MacUpdater.js:209-219`); any updater error it raises is said, never hidden (R6)
//   2 forged      the feed's `.sig` a stranger's → `feed-unverified`, no payload
//   3 rollback    policy v2 against a remembered v5 → `policy-rollback`, no payload
//   4 killed      the kill switch, advertising N → `killed`, no payload
//   5 unresolved  nightly-only heads for the beta build → `channel-unresolved`; the nightly's feed never asked for
//   every run     the floor's freeway host runs from the app's own `Contents/Resources/bin` (F1): the floor spawns it on
//                 fieldd's first declaration, which every boot makes — staged, executable, found as the floor's sibling
//
// Each run is held inside its temp root (R5): `HOME` (the production log root and electron-updater's cache follow
// `os.homedir()`), `FIELDD_DATA_DIR`, `--user-data-dir`, `--allow-dev-trust`, a loopback `VIBEFIELD_UPDATE_ORIGIN`.
// What still lands outside it is measured and said (`SMOKE_UPDATE_FOOTPRINT`). The physical apply is W11's (R6): no
// input injection here, the silent path's display clause reads the live display, and EDP §13.5 keeps smoke triggers out
// of the asar. EL7: the run's keys live only in this process (and the stager's environment, for the stage); nothing
// secret is written; the app's environment carries none.
//
// usage: node packaging/run-update-smoke.mjs [--runs staged,forged,…]
//   Every invocation builds its own zip: the package must trust THIS run's keys, which exist only in this process. The
//   build is the row's first ~4 minutes (desk-gates row 30).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leftByRun, listRunProcesses, SMOKE_RUN_ENV } from "./smoke-daemons.mjs";
import {
  buildRun,
  mintKeys,
  serveReleases,
  smokeTrustRoot,
  UPDATE_RUNS,
  writeTrustRoot,
} from "./update-fixture.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../..");

/** The launch check waits this long (`UPDATE_LAUNCH_DELAY_MS`, `index.ts`); R3: no knob, so a run waits it out. */
export const LAUNCH_CHECK_MS = 30_000;
/** A run's verdict must arrive within this (the launch delay, the boot before it, a 256 KiB download). */
export const RUN_BOUND_MS = 120_000;
/** The packaged shell's graceful quit, before a SIGKILL. */
const QUIT_BOUND_MS = 20_000;
/** electron-updater's cache dir name, as the zip build's `app-update.yml` names it (L3b-ii's B8 witness). */
export const UPDATER_CACHE_DIR = "@vibefielddesktop-updater";
/** F1 — the floor spawns its freeway host as `<its own directory>/field-freeway-host --listener-fd 3`. */
export const FREEWAY_HOST_ARGS = "--listener-fd 3";
/** How long after a run's verdict its freeway host may still be coming up. */
const HOST_BOUND_MS = 10_000;
/** Secrets that must never reach the app's environment (EL7). */
const SECRET_ENVS = [
  "VIBEFIELD_SMOKE_BUNDLED_SECRET",
  "VIBEFIELD_BUNDLED_INDEX_SECRET",
  "VIBEFIELD_RELEASE_SECRET",
  "VIBEFIELD_REGISTRY_SECRET",
];

const say = (tag, value) => console.log(`${tag} ${JSON.stringify(value)}`);

/** Every desktop-log record under a run's HOME (the production log root, `logging/src/paths.ts`). */
export function readEvents(home) {
  const dir = join(home, "Library", "Logs", "VibeField", "system");
  if (!existsSync(dir)) return [];
  const records = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith("desktop") || !name.includes(".ndjson") || name.endsWith(".lock"))
      continue;
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        records.push(JSON.parse(line));
      } catch {}
    }
  }
  return records;
}

/** electron-updater's record of a finished download (`DownloadedUpdateHelper.js:59-64`), under a run's HOME. */
export function readCachedUpdate(home) {
  const path = join(home, "Library", "Caches", UPDATER_CACHE_DIR, "pending", "update-info.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * A run's verdict from what it left outside the process. `null` while the run has not spoken yet; otherwise
 * `{ok, saw, …}`. A refusal other than the expected one, or a check that failed, is red at once.
 */
export function judgeRun(run, { events, requests, cached }, { final = false } = {}) {
  const release = run.releases[0];
  const payload = requests.filter((request) => /\.(zip|blockmap)$/.test(request.path));
  const named = (event) => events.filter((record) => record.event === event);
  // bounded codes only (no remote text in the log, EDP §11.1); the run adds electron-updater's own stdout lines
  const updaterErrors = named("desktop.update.updater_error").map(
    (record) => record.attrs?.code ?? "updater error",
  );
  const failed = named("desktop.update.check_failed")[0];
  const refused = named("desktop.update.refused")[0];
  const lever = named("desktop.update.lever")[0];
  const staged = named("desktop.update.staged")[0];
  const base = { payloadRequests: payload.length, requests: requests.length };
  if (failed !== undefined)
    return { ok: false, saw: "check_failed", detail: failed.attrs ?? failed.msg, ...base };
  if (run.expect === "staged") {
    if (refused !== undefined)
      return { ok: false, saw: `refused ${refused.attrs?.state}`, detail: refused.attrs, ...base };
    if (staged === undefined) return null;
    // the cache's record may land a beat after the line: wait for it, and say its absence only at the end
    if (cached === null && !final) return null;
    const problems = [];
    if (staged.attrs?.version !== release.version)
      problems.push(`staged ${staged.attrs?.version}, the feed named ${release.version}`);
    if (staged.attrs?.sha512 !== release.sha512)
      problems.push("the staged line's sha512 is not the signed feed's");
    if (cached?.sha512 !== release.sha512)
      problems.push("the cache's update-info.json sha512 is not the signed feed's");
    if (payload.filter((request) => request.path.endsWith(".zip")).length !== 1)
      problems.push(`the zip was asked for ${payload.length} times, not once`);
    return {
      ok: problems.length === 0,
      saw: "staged",
      version: staged.attrs?.version,
      // R6 — Squirrel's first touch (`setFeedURL` at download completion), said whatever it says
      squirrel: updaterErrors.length === 0 ? "no updater error" : updaterErrors,
      ...(problems.length > 0 ? { problems } : {}),
      ...base,
    };
  }
  const saw =
    run.expect === "killed"
      ? lever?.attrs?.lever === "killed"
        ? "killed"
        : refused !== undefined
          ? `refused ${refused.attrs?.state}`
          : undefined
      : refused !== undefined
        ? refused.attrs?.state
        : lever !== undefined
          ? `lever ${lever.attrs?.lever}`
          : undefined;
  if (saw === undefined) return staged !== undefined ? { ok: false, saw: "staged", ...base } : null;
  const problems = [];
  if (saw !== run.expect) problems.push(`expected ${run.expect}`);
  if (payload.length !== 0) problems.push(`${payload.length} payload request(s); W9 says none`);
  if (
    run.expect === "channel-unresolved" &&
    requests.some((request) => request.path.endsWith("latest-mac.yml"))
  )
    problems.push("the nightly's feed was asked for");
  return { ok: problems.length === 0, saw, ...(problems.length > 0 ? { problems } : {}), ...base };
}

/** R5 — what a packaged run could leave in the REAL home, outside its temp root: the paths, and their newest mtimes. */
export function footprintPaths(home, appId) {
  const lib = join(home, "Library");
  return [
    join(lib, "Logs", "VibeField"),
    join(lib, "Caches", UPDATER_CACHE_DIR),
    join(lib, "Caches", "VibeField"),
    join(lib, "Caches", appId),
    join(lib, "Application Support", "VibeField"),
    join(lib, "Preferences", `${appId}.plist`),
    join(lib, "Saved Application State", `${appId}.savedState`),
    join(lib, "HTTPStorages", appId),
    join(lib, "WebKit", appId),
  ];
}

function newestMtime(path) {
  try {
    const info = statSync(path);
    if (!info.isDirectory()) return info.mtimeMs;
    let newest = info.mtimeMs;
    for (const name of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, name)));
    return newest;
  } catch {
    return null;
  }
}

export function footprintSnapshot(paths) {
  return Object.fromEntries(paths.map((path) => [path, newestMtime(path)]));
}

/** The paths the runs created or touched between two snapshots. */
export function footprintChanged(before, after) {
  return Object.keys(after).filter(
    (path) => after[path] !== null && (before[path] === null || after[path] > before[path]),
  );
}

const realPath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * F1 — the run's freeway host: a process of the run named `field-freeway-host` whose executable IS `hostPath` (the app's
 * `Contents/Resources/bin/field-freeway-host`), with the floor's arguments. Both paths are compared real: `/tmp` is
 * `/private/tmp`, and the floor's own path is whichever it was exec'd by. `null` when the run has none.
 */
export function freewayHostOf(processes, hostPath, real = realPath) {
  const want = real(hostPath);
  const args = ` ${FREEWAY_HOST_ARGS}`;
  return (
    processes.find((p) => {
      if (p.name !== "field-freeway-host" || typeof p.command !== "string") return false;
      const command = p.command.trimEnd();
      return command.endsWith(args) && real(command.slice(0, -args.length)) === want;
    }) ?? null
  );
}

/** The app's environment: this process's, minus every secret and every override the smoke does not mean. */
export function appEnv(base, { home, fieldd, origin, mark }) {
  const env = { ...base };
  for (const name of SECRET_ENVS) delete env[name];
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "NODE_OPTIONS",
    "FIELD_LOG_DIR",
    "FIELDD_PLUGIN_DEV_ROOTS",
  ])
    delete env[name];
  return {
    ...env,
    HOME: home,
    FIELDD_DATA_DIR: fieldd,
    VIBEFIELD_UPDATE_ORIGIN: origin,
    [SMOKE_RUN_ENV]: mark,
  };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function step(label, command, args, options) {
  const started = Date.now();
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  const ms = Date.now() - started;
  say("SMOKE_UPDATE_STEP", { step: label, exit: result.status, ms });
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
  return ms;
}

/** R1 + R2: the zip a person downloads, staged on the run's trust-root, and W8's audits on the app inside it. */
function buildZip(root, keys, trustRoot) {
  const rootPath = writeTrustRoot(join(root, "stage-trust-root", "trust-root.json"), trustRoot);
  const out = join(root, "build-out");
  // the bundled key reaches the stager's environment, and nothing else's
  const stageEnv = { ...process.env, VIBEFIELD_SMOKE_BUNDLED_SECRET: keys.bundled.secretKey };
  delete stageEnv.VIBEFIELD_BUNDLED_INDEX_SECRET;
  delete stageEnv.VIBEFIELD_RELEASE_SECRET;
  const plain = { ...process.env };
  for (const name of SECRET_ENVS) delete plain[name];
  const timing = {};
  timing.native = step(
    "field-native (release)",
    "cargo",
    ["build", "--release", "--locked", "-p", "field-native"],
    {
      cwd: repo,
      env: plain,
    },
  );
  // pnpm appends the arguments to the script's last command, `stage-package.mjs` (which skips the `--`)
  timing.stage = step(
    "package:stage --dev-trust-root",
    "pnpm",
    ["run", "package:stage", "--", "--dev-trust-root", rootPath],
    {
      cwd: desktop,
      env: stageEnv,
    },
  );
  timing.zip = step(
    "electron-builder --mac zip --arm64",
    process.execPath,
    [
      "packaging/run-electron-builder.mjs",
      "--mac",
      "zip",
      "--arm64",
      "--config",
      "packaging/electron-builder.yml",
      `-c.directories.output=${out}`,
    ],
    {
      cwd: desktop,
      env: { ...plain, PATH: `${join(desktop, "node_modules", ".bin")}:${plain.PATH ?? ""}` },
    },
  );
  const app = join(out, "mac-arm64", "VibeField.app");
  const zip = readdirSync(out).find((name) => name.endsWith(".zip"));
  if (zip === undefined) throw new Error(`no zip in ${out}`);
  // W8's remainder, on the app this row runs: app-update.yml (provider, no token), the asar, the fuses
  step(
    "audit-app-update",
    process.execPath,
    [join(repo, "scripts/audit-app-update.mjs"), "--app", app],
    {
      cwd: repo,
      env: plain,
    },
  );
  step(
    "audit-asar",
    process.execPath,
    [
      join(repo, "scripts/audit-asar.mjs"),
      "--app",
      app,
      "--stage-app",
      join(desktop, "build/stage/app"),
    ],
    { cwd: repo, env: plain },
  );
  step("audit-fuses", process.execPath, [join(repo, "scripts/audit-fuses.mjs"), "--app", app], {
    cwd: repo,
    env: plain,
  });
  return { zip: join(out, zip), timing };
}

async function oneRun(name, { root, keys, trustRoot, zip, current }) {
  const runRoot = join(root, name);
  const home = join(runRoot, "home");
  const profile = join(runRoot, "profile");
  const fieldd = join(runRoot, "fieldd");
  for (const dir of [home, profile, fieldd]) mkdirSync(dir, { recursive: true });
  execFileSync("ditto", ["-x", "-k", zip, join(runRoot, "app")]);
  const exe = join(runRoot, "app", "VibeField.app", "Contents", "MacOS", "VibeField");
  const run = buildRun(name, { root: join(runRoot, "fixture"), keys, trustRoot, current });
  if (run.seed !== null) {
    mkdirSync(join(profile, "updates"), { recursive: true });
    writeFileSync(join(profile, "updates", "state.json"), `${JSON.stringify(run.seed)}\n`);
  }
  const server = await serveReleases(run.releases);
  const mark = `${basenameOf(root)}-${name}`;
  const started = Date.now();
  const log = join(runRoot, "app.log");
  const out = [];
  const child = spawn(exe, ["--allow-dev-trust", `--user-data-dir=${profile}`], {
    env: appEnv(process.env, { home, fieldd, origin: server.origin, mark }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => out.push(chunk));
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  let verdict = null;
  while (verdict === null && exited === null && Date.now() - started < RUN_BOUND_MS) {
    await sleep(500);
    verdict = judgeRun(run, {
      events: readEvents(home),
      requests: server.requests,
      cached: readCachedUpdate(home),
    });
  }
  // the run's bound: one last reading, final (what is missing now is said, not waited for)
  if (verdict === null)
    verdict = judgeRun(
      run,
      { events: readEvents(home), requests: server.requests, cached: readCachedUpdate(home) },
      { final: true },
    );
  if (verdict === null)
    verdict = {
      ok: false,
      saw:
        exited !== null
          ? `the app exited (${exited.code ?? exited.signal}) before a verdict`
          : "no verdict",
      payloadRequests: server.payloadRequests().length,
      requests: server.requests.length,
    };
  // F1 — the floor's freeway host, from the app's own Resources/bin, while the app still runs
  const hostPath = join(
    runRoot,
    "app",
    "VibeField.app",
    "Contents",
    "Resources",
    "bin",
    "field-freeway-host",
  );
  let host = null;
  const hostUntil = Date.now() + HOST_BOUND_MS;
  while (exited === null) {
    host = freewayHostOf(listRunProcesses(mark), hostPath);
    if (host !== null || Date.now() >= hostUntil) break;
    await sleep(500);
  }
  if (host === null) {
    verdict.ok = false;
    verdict.problems = [
      ...(verdict.problems ?? []),
      "no field-freeway-host of this run ran from the app's Contents/Resources/bin (F1)",
    ];
  }
  // the shell's graceful quit; production leaves its daemons running by design (`modes.ts:117-126`) — the row reaps them
  if (exited === null) {
    child.kill("SIGTERM");
    const until = Date.now() + QUIT_BOUND_MS;
    while (exited === null && Date.now() < until) await sleep(100);
    if (exited === null) child.kill("SIGKILL");
  }
  await server.close();
  writeFileSync(log, Buffer.concat(out));
  const row = await leftByRun(mark);
  const still = listRunProcesses(mark);
  say("SMOKE_DAEMONS", {
    ...row,
    expected: "production leaves fieldd and the floor running; the row stops them",
  });
  if (still.length > 0) {
    verdict.ok = false;
    verdict.problems = [
      ...(verdict.problems ?? []),
      `${still.length} process(es) outlived the reap`,
    ];
  }
  const said = Buffer.concat(out).toString("utf8");
  const squirrelSays = said
    .split("\n")
    .filter((line) => /squirrel|code ?sign|shipit|setfeedurl/i.test(line))
    .slice(0, 5)
    .map((line) => line.trim().slice(0, 300));
  const result = {
    run: name,
    expect: run.expect,
    ms: Date.now() - started,
    ...verdict,
    freewayHost:
      host === null ? "absent" : `Contents/Resources/bin/field-freeway-host ${FREEWAY_HOST_ARGS}`,
    ...(name === "staged" ? { squirrelSays } : {}),
  };
  say("SMOKE_UPDATE", result);
  if (result.ok) rmSync(runRoot, { recursive: true, force: true });
  else say("SMOKE_UPDATE_KEPT", { run: name, root: runRoot, log });
  return result;
}

const basenameOf = (path) => path.slice(path.lastIndexOf("/") + 1);

async function main(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const runs = (value("--runs") ?? UPDATE_RUNS.join(",")).split(",");
  for (const name of runs)
    if (!UPDATE_RUNS.includes(name))
      throw new Error(`unknown run "${name}" (${UPDATE_RUNS.join(", ")})`);
  if (process.platform !== "darwin") {
    say("SMOKE_UPDATE_SKIPPED", {
      reason: "macOS only: the zip, Squirrel's first touch and the cache are darwin's",
    });
    return 0;
  }
  const root = mkdtempSync(join(tmpdir(), "vf-update-smoke-"));
  const current = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version;
  const appId = JSON.parse(readFileSync(join(desktop, "packaging/release-identity.json"), "utf8"))
    .fields.appId.value;
  say("SMOKE_UPDATE_ROOT", { root, current, runs });
  const keys = mintKeys();
  const trustRoot = smokeTrustRoot(keys);
  const watched = footprintPaths(homedir(), appId);
  const before = footprintSnapshot(watched);
  const results = [];
  let built = null;
  try {
    built = buildZip(root, keys, trustRoot);
    say("SMOKE_UPDATE_BUILT", { zip: built.zip, ...built.timing });
    for (const name of runs)
      results.push(await oneRun(name, { root, keys, trustRoot, zip: built.zip, current }));
  } catch (error) {
    say("SMOKE_UPDATE_FAILED", { error: String(error?.message ?? error) });
    results.push({ run: "build", ok: false });
  }
  const changed = footprintChanged(before, footprintSnapshot(watched));
  // R5 — said whatever it finds (a path James's own app also writes can be touched by it during the window)
  say("SMOKE_UPDATE_FOOTPRINT", { outsideTheRoot: changed });
  const ok = results.length > 0 && results.every((result) => result.ok);
  say("SMOKE_UPDATE_DONE", {
    ok,
    runs: results.map((result) => `${result.run}:${result.ok ? "ok" : "RED"}`),
  });
  if (ok) rmSync(root, { recursive: true, force: true });
  say("SMOKE_UPDATE_ROOT_REMOVED", { root, removed: ok, kept: !ok });
  return ok ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(2);
    },
  );
}
