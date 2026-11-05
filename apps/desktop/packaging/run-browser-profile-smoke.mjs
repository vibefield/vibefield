// BP-D7 (thinking-browser-profile.md §3·6; VF-PM 01:32Z, the two-phase row) — `pnpm smoke:profile` (desk-gates row 31):
// ESP-11's witness. A cookie a PAGE set in the PACKAGED app is encrypted at rest by the OS (the EnableCookieEncryption
// fuse), in that app's own profile directory, with its key in a keychain made for the run.
//
// Not to be confused with `smoke-profile.mjs`, which is a smoke's own Electron profile (DK-5). This is the desk BROWSER's
// profile (PT-4 ruling 3).
//
//   A  the harness, UNPACKAGED (`run-smoke.mjs --smoke-canvas --profile-seed=<url>`): one browser pane laid on the desk
//      and pointed at this row's fixture (whose response sets the witness cookie), live, saved, LEFT on the board. Its
//      smoke HOME is kept whole (`VF_SMOKE_KEEP_ROOT`): BP-1c's one directory that is both its Electron userData and its
//      data root, so the desk profile lies inside userData and its cookies reach the disk. This run writes the
//      UNPACKAGED profile directory with the fuse off: the plaintext control, by construction (BP-D6), nested the same
//      way as phase B.
//   B  the PACKAGED app on that HOME as production runs (BP-1c, BP-D9 (a)): `--user-data-dir` and FIELDD_DATA_DIR are the
//      one directory, as a packaged app's `appData/VibeField` is both, so its desk profile lies inside userData. Its HOME
//      (the OS user's, `HOME`) is the run's own, holding a login keychain created for the run (never the person's; never
//      `--use-mock-keychain`). The board it reopens is the only driver: no smoke trigger is in the asar (EDP §13.5), and
//      no input reaches it. Its pane's page asks the fixture again, and the fixture sets the cookie in the PACKAGED
//      profile directory, a fresh one (BP-D6's packaged name).
//      *(Until BP-1c, 2026-11-05: phase B had a `--user-data-dir` of its own beside phase A's root, and phase A's profile
//      was outside its userData too, so neither wrote a `Cookies` database; the row was RED, saying why (§3·8).)*
//   judge  after the app's graceful quit:
//      - in the packaged directory's `Cookies`, the witness has an empty `value` and an `encrypted_value` that begins
//        `v10`, and the witness's bytes appear nowhere in the file;
//      - the unpackaged directory holds the same witness in plaintext;
//      - "VibeField Safe Storage" is in the RUN keychain;
//      - the shell's own profile (the home's default session, both phases') holds no cookie of the fixture's.
//
// The four unknowns VF-PM ruled measured first, each said in the run's output:
//   U1  the packaged app takes its pane live unaided (the fixture hears it). If it does not, that is a product finding,
//       never a reason to inject input.
//   U2  a login keychain created in the run HOME answers os_crypt with no "keychain not found" dialog. A dialog is the
//       live display's to see; the run says whether the key is in the run keychain. Every `security` call runs under
//       the run HOME (`securityIn`), and the person's search list is digested before and after: the run stops if it
//       moved.
//   U3  the board phase A wrote is the one the packaged window opens (U1's request is the evidence).
//   U4  phase B shows a REAL window: the interaction class (the mini at James's unlock, HID idle ≥ 120 s; this Mac only
//       by the PM's word while he is away). Both phases run on ONE host: phase B opens phase A's data root.
//
// usage: node packaging/run-browser-profile-smoke.mjs --app <VibeField.app | the nightly's .zip> [--keep]
//   The harness's build must exist (`pnpm build:all`; smoke:canvas's). A DEV-keyed package (a local `package:dir`) is
//   launched with --allow-dev-trust and SAID so: the cookie fact holds, and the release-keyed row is the signed nightly's.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { leftByRun, listRunProcesses, SMOKE_RUN_ENV } from "./smoke-daemons.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The witness cookie's name. */
export const WITNESS = "vf_bp_witness";
/** The desk's profile ref (contracts' `BROWSER_DESK_PROFILE_REF`; a unit row holds the two equal). */
export const DESK_REF = "desk";
/** The row's numbers. */
export const ROW = {
  /** phase A's whole run (a smoke:canvas boot and the seed) */
  seedBoundMs: 300_000,
  /** how long the packaged app has to take its pane live (U1): its boot, the daemons', the board's restore, a load */
  liveBoundMs: 120_000,
  /** after the fixture heard the packaged page: the cookie written, the store flushed by a graceful quit */
  settleMs: 5_000,
  quitBoundMs: 20_000,
};
/** Secrets and overrides that never reach the packaged app's environment (EL7; run-update-smoke's list). */
const STRIP_ENV = [
  "VIBEFIELD_SMOKE_BUNDLED_SECRET",
  "VIBEFIELD_BUNDLED_INDEX_SECRET",
  "VIBEFIELD_RELEASE_SECRET",
  "VIBEFIELD_REGISTRY_SECRET",
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "FIELD_LOG_DIR",
  "FIELDD_PLUGIN_DEV_ROOTS",
  "VF_SMOKE_KEEP_ROOT",
];

const say = (tag, value) => console.log(`${tag} ${JSON.stringify(value)}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A desk profile's directory name, as `browserSurfaceProfileName` names it (browser-security.ts; BP-D6): a digest of the
 * mode and ref, plus `packaged` for a packaged shell. A unit row holds this equal to the shell's own. */
export function profileDirName(packaged, ref = DESK_REF) {
  const hash = createHash("sha256").update("persistent").update("\0").update(ref);
  if (packaged) hash.update("\0packaged");
  return hash.digest("hex").slice(0, 40);
}

/** The row's fixture: `/seed?v=<value>` answers a page and SETS the witness cookie to `<value>`; every request is logged
 * with its time, its user agent and the Cookie header it came with. */
export async function serveFixture() {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture.invalid");
    requests.push({
      at: Date.now(),
      path: url.pathname,
      v: url.searchParams.get("v"),
      ua: String(req.headers["user-agent"] ?? ""),
      cookie: String(req.headers.cookie ?? ""),
    });
    if (url.pathname !== "/seed") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not here");
      return;
    }
    const v = url.searchParams.get("v") ?? "";
    if (!/^[0-9a-f]{16,64}$/.test(v)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad value");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `${WITNESS}=${v}; Path=/; Max-Age=31536000; SameSite=Lax`,
    });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>BP witness</title><body style="background:#fff;font:16px system-ui">BP-D7 witness page</body>`,
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Where Chromium keeps a profile's cookie database: `Network/Cookies` since its network service moved it, `Cookies`
 * before. The first that exists, else the newer path (read as absent). */
export function cookiesDbOf(profileDir) {
  const network = join(profileDir, "Network", "Cookies");
  if (existsSync(network)) return network;
  const old = join(profileDir, "Cookies");
  return existsSync(old) ? old : network;
}

/** The witness's rows of one `Cookies` database, read from a COPY (the app's file is never opened in place). */
export function readWitness(cookiesDb, scratch) {
  if (!existsSync(cookiesDb)) return { db: cookiesDb, present: false, rows: [] };
  mkdirSync(scratch, { recursive: true });
  const copy = join(scratch, `cookies-${randomBytes(4).toString("hex")}.db`);
  writeFileSync(copy, readFileSync(cookiesDb));
  const sql = `select host_key as host, name, value, length(value) as vlen, hex(substr(encrypted_value, 1, 3)) as eprefix, length(encrypted_value) as elen from cookies where name = '${WITNESS}'`;
  const run = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", copy, sql], {
    encoding: "utf8",
  });
  if (run.status !== 0) return { db: cookiesDb, present: true, rows: [], error: run.stderr.trim() };
  return {
    db: cookiesDb,
    present: true,
    rows: run.stdout.trim() === "" ? [] : JSON.parse(run.stdout),
  };
}

/** The row's verdict from what it read. Pure: every problem said in words. */
export function judge({
  value,
  packaged,
  unpackaged,
  packagedBytesHoldValue,
  keychainHasItem,
  shellRows,
  heard,
}) {
  const problems = [];
  if (!heard.seed)
    problems.push("phase A: the fixture never heard the unpackaged page (the seed did not load)");
  if (!heard.packaged)
    problems.push(
      "U1: the packaged app never asked the fixture: its pane did not go live unaided (a product finding, never a reason to inject input)",
    );
  const p = packaged.rows.find((r) => r.name === WITNESS);
  if (p === undefined)
    problems.push(`the packaged profile holds no ${WITNESS} cookie (${packaged.db})`);
  else {
    if (p.vlen !== 0)
      problems.push(`the packaged cookie's value is PLAINTEXT (${p.vlen} bytes) — ESP-11 broken`);
    if (p.eprefix !== "763130")
      problems.push(`the packaged cookie's encrypted_value begins ${p.eprefix}, not v10`);
    if (!(p.elen > 3)) problems.push("the packaged cookie's encrypted_value is empty");
  }
  if (packagedBytesHoldValue)
    problems.push(
      "the witness's bytes appear in the packaged Cookies file — not encrypted at rest",
    );
  const u = unpackaged.rows.find((r) => r.name === WITNESS);
  if (u === undefined)
    problems.push(`the unpackaged control holds no ${WITNESS} cookie (${unpackaged.db})`);
  else if (u.value !== value)
    problems.push(
      "the unpackaged control's cookie is not the plaintext witness (the control did not hold)",
    );
  if (!keychainHasItem)
    problems.push(
      'U2: the run keychain holds no "VibeField Safe Storage" item — os_crypt did not use the run\'s keychain',
    );
  if (shellRows.length > 0)
    problems.push(
      "the packaged shell's own profile holds the fixture's cookie (PT-4's row broken)",
    );
  return { ok: problems.length === 0, problems };
}

/** The app's environment: this process's, minus every secret and override, with the run's HOME, root and mark. */
export function appEnv(base, { home, fieldd, mark }) {
  const env = { ...base };
  for (const name of STRIP_ENV) delete env[name];
  return { ...env, HOME: home, FIELDD_DATA_DIR: fieldd, [SMOKE_RUN_ENV]: mark };
}

/** A path as the filesystem names it (`/tmp` is `/private/tmp` on macOS), or resolved when it is not there. */
function realOrResolved(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Whether `child` lies inside `parent`, or is it (main's `liesWithin`, live-surfaces/browser-profiles-placement.ts). */
export function liesWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * BP-1c — phase A's smoke HOME, as its output names it: main kept the root (`SMOKE_ROOT_KEPT {root, home}`) and the
 * launcher kept the home whole for it (`SMOKE_PROFILE_REMOVED`'s `kept: "asked"`), and the desk profiles under the user
 * root lie inside it (BP-D9 (a): phase A's plaintext control writes its cookies only there). `{ home, userRoot }`, or
 * `{ problem }` in words.
 */
export function phaseAHome(kept, settled, real = realOrResolved) {
  if (kept === null || typeof kept.home !== "string" || typeof kept.root !== "string")
    return { problem: "phase A named no kept root (SMOKE_ROOT_KEPT)" };
  if (
    settled === null ||
    settled.kept !== "asked" ||
    typeof settled.userData !== "string" ||
    real(settled.userData) !== real(kept.home)
  )
    return {
      problem: `phase A's launcher did not keep its home whole for the row (SMOKE_PROFILE_REMOVED ${JSON.stringify(settled)})`,
    };
  if (!liesWithin(kept.home, join(kept.root, "browser", "profiles")))
    return {
      problem: `phase A's desk profiles do not lie inside its userData (${kept.home}): BP-D9's law broken`,
    };
  return { home: kept.home, userRoot: kept.root };
}

/** BP-1c — phase B's launch on phase A's HOME, as production runs: the packaged app's userData IS its data root (a
 * packaged app's `appData/VibeField` is both), so its desk profile lies inside userData. A dev-keyed package is
 * launched with `--allow-dev-trust`, said by the row. */
export function phaseBLaunch({ home, keyClass }) {
  return {
    args: [`--user-data-dir=${home}`, ...(keyClass === "release" ? [] : ["--allow-dev-trust"])],
    fieldd: home,
  };
}

/** The `security` CLI under the run HOME. The Security framework reads its user domain (the search list, the default
 * keychain) from HOME, so a keychain created and made default here never enters the person's list (measured 2026-10-26
 * on this Mac: under a fresh HOME the user list is empty and no default keychain exists; a create there leaves the
 * person's list byte for byte). The packaged app gets the same HOME (`appEnv`), so its os_crypt finds this keychain. */
function securityIn(home, args) {
  return execFileSync("security", args, { env: { ...process.env, HOME: home }, encoding: "utf8" });
}

/** A digest of the person's keychain search list (paths only, never an item): the row's proof it left the list alone. */
function personsSearchList() {
  return createHash("sha256")
    .update(execFileSync("security", ["list-keychains", "-d", "user"]))
    .digest("hex");
}

/** A child run to its end (SIGTERM past `boundMs`), its stdout and stderr kept in the order they arrived — and THIS
 * process's event loop free meanwhile: the fixture answers phase A's page from here. A `spawnSync` blocked the loop, so the
 * page's request sat unanswered until the harness had given up (the mini, 2026-10-26 02:51Z and 02:58Z: a face `starting`,
 * `loading: 0.5`, and a fixture that heard nothing). */
function runChild(command, args, { cwd, env, boundMs }) {
  return new Promise((done) => {
    const out = [];
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => out.push(c));
    const timer = setTimeout(() => child.kill("SIGTERM"), boundMs);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      done({ status, signal, output: Buffer.concat(out).toString("utf8") });
    });
  });
}

function line(out, tag) {
  const hit = out
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(`${tag} `));
  return hit === undefined ? null : JSON.parse(hit.slice(tag.length + 1));
}

async function main(argv) {
  if (process.platform !== "darwin")
    throw new Error("smoke:profile is macOS's (the keychain, the fuse's os_crypt)");
  const appArg = argv[argv.indexOf("--app") + 1];
  if (!argv.includes("--app") || appArg === undefined)
    throw new Error("usage: --app <VibeField.app | .zip>");
  const keep = argv.includes("--keep");
  const run = mkdtempSync(join(tmpdir(), "vf-bp-"));
  const home = join(run, "home");
  const scratch = join(run, "scratch");
  for (const dir of [home, scratch]) mkdirSync(dir, { recursive: true });
  say("SMOKE_PROFILE_RUN", { run });

  // ── the app: unzipped into the run (ditto keeps the signature), or the given .app ──
  let app = resolve(appArg);
  if (app.endsWith(".zip")) {
    execFileSync("ditto", ["-x", "-k", app, join(run, "app")]);
    app = join(
      run,
      "app",
      readdirSync(join(run, "app")).find((n) => n.endsWith(".app")) ?? "VibeField.app",
    );
  }
  const exe = join(app, "Contents", "MacOS", "VibeField");
  const identity = JSON.parse(
    readFileSync(join(app, "Contents", "Resources", "identity", "release-identity.json"), "utf8"),
  );
  const keyClass = identity.keyClass ?? identity.fields?.keyClass?.value ?? "unknown";
  const sig = spawnSync("codesign", ["-dv", "--verbose=2", app], { encoding: "utf8" });
  say("SMOKE_PROFILE_APP", {
    app,
    keyClass,
    // a quarantined copy may raise Gatekeeper's first-launch sheet on the live display: said, never cleared here
    quarantined:
      spawnSync("xattr", ["-p", "com.apple.quarantine", app], { stdio: "ignore" }).status === 0,
    signature: sig.stderr
      .split("\n")
      .filter((l) => /^(Authority|TeamIdentifier|Identifier|Signature)/.test(l)),
  });

  // ── the run keychain (U2): a login keychain created in the run HOME; the person's is never touched ──
  const keychain = join(home, "Library", "Keychains", "login.keychain-db");
  mkdirSync(dirname(keychain), { recursive: true });
  const listBefore = personsSearchList();
  securityIn(home, ["create-keychain", "-p", "", keychain]);
  securityIn(home, ["default-keychain", "-d", "user", "-s", keychain]);
  securityIn(home, ["unlock-keychain", "-p", "", keychain]);
  securityIn(home, ["set-keychain-settings", keychain]);
  if (personsSearchList() !== listBefore)
    throw new Error(
      "the person's keychain search list changed when the run keychain was made — the run stops before any app starts (restore it with `security list-keychains -d user -s …`)",
    );

  const fixture = await serveFixture();
  const value = randomBytes(16).toString("hex");
  const url = `${fixture.origin}/seed?v=${value}`;
  let verdict = { ok: false, problems: ["the row did not reach its judge"] };
  try {
    // ── PHASE A: the harness lays and points the pane, keeps its root ──
    const seedStart = Date.now();
    const seed = await runChild(
      process.execPath,
      [join(desktop, "packaging", "run-smoke.mjs"), "--smoke-canvas", `--profile-seed=${url}`],
      { cwd: desktop, env: { ...process.env, VF_SMOKE_KEEP_ROOT: "1" }, boundMs: ROW.seedBoundMs },
    );
    const seedOut = seed.output;
    writeFileSync(join(run, "phase-a.log"), seedOut);
    const seeded = line(seedOut, "PROFILE_SEED");
    const kept = line(seedOut, "SMOKE_ROOT_KEPT");
    const settled = line(seedOut, "SMOKE_PROFILE_REMOVED");
    const phaseA = phaseAHome(kept, settled);
    say("SMOKE_PROFILE_PHASE_A", {
      exit: seed.status,
      signal: seed.signal,
      ms: Date.now() - seedStart,
      seeded,
      kept,
      settled,
      nested: phaseA.problem === undefined,
    });
    // what the fixture heard in phase A: whether the unpackaged page ever asked (a pane that never loads is said apart from
    // one that loads and is not seen live)
    say("SMOKE_PROFILE_FIXTURE_A", {
      requests: fixture.requests.map((r) => ({
        path: r.path,
        afterMs: r.at - seedStart,
        withCookie: r.cookie !== "",
      })),
    });
    if (seed.status !== 0 || seeded === null)
      throw new Error(
        `phase A did not seed (exit ${seed.status ?? seed.signal}; see ${join(run, "phase-a.log")})`,
      );
    if (phaseA.problem !== undefined)
      throw new Error(`${phaseA.problem} (see ${join(run, "phase-a.log")})`);
    // BP-1c — the HOME is phase B's userData and its data root, both
    const dataRoot = phaseA.home;
    const userRoot = phaseA.userRoot;

    // ── PHASE B: the packaged app on that root; the board it reopens is the only driver ──
    const mark = `vf-bp-${randomBytes(4).toString("hex")}`;
    const bStart = Date.now();
    const launch = phaseBLaunch({ home: dataRoot, keyClass });
    const out = [];
    const child = spawn(exe, launch.args, {
      env: appEnv(process.env, { home, fieldd: launch.fieldd, mark }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => out.push(c));
    let exited = null;
    child.on("exit", (code, signal) => {
      exited = { code, signal };
    });
    const packagedHeard = () => fixture.requests.find((r) => r.at >= bStart && r.path === "/seed");
    while (
      exited === null &&
      packagedHeard() === undefined &&
      Date.now() - bStart < ROW.liveBoundMs
    )
      await sleep(250);
    const heardB = packagedHeard();
    say("SMOKE_PROFILE_U1", {
      heard: heardB !== undefined,
      afterMs: heardB === undefined ? null : heardB.at - bStart,
      ua: heardB?.ua ?? null,
      cookieSent: heardB?.cookie ?? null,
    });
    if (heardB !== undefined) await sleep(ROW.settleMs);
    if (exited === null) {
      child.kill("SIGTERM");
      const until = Date.now() + ROW.quitBoundMs;
      while (exited === null && Date.now() < until) await sleep(100);
      if (exited === null) child.kill("SIGKILL");
    }
    writeFileSync(join(run, "phase-b.log"), Buffer.concat(out));
    const daemons = await leftByRun(mark);
    const still = listRunProcesses(mark);
    say("SMOKE_DAEMONS", {
      ...daemons,
      expected: "production leaves fieldd and the floor running; the row stops them",
    });

    // ── the judge ──
    const profiles = join(userRoot, "browser", "profiles");
    const packagedDb = cookiesDbOf(join(profiles, profileDirName(true)));
    const unpackagedDb = cookiesDbOf(join(profiles, profileDirName(false)));
    const packaged = readWitness(packagedDb, scratch);
    const unpackaged = readWitness(unpackagedDb, scratch);
    const packagedBytesHoldValue =
      existsSync(packagedDb) && readFileSync(packagedDb).includes(Buffer.from(value));
    const keychainHasItem =
      spawnSync("security", ["find-generic-password", "-s", "VibeField Safe Storage", keychain], {
        env: { ...process.env, HOME: home },
        stdio: "ignore",
      }).status === 0;
    // the shell's own sessions: the HOME's default session, which both phases' shells used (BP-1c)
    const shellRows = readWitness(cookiesDbOf(dataRoot), scratch).rows;
    say("SMOKE_PROFILE_READ", {
      packaged,
      unpackaged: {
        ...unpackaged,
        rows: unpackaged.rows.map((r) => ({
          ...r,
          value: r.value === value ? "<the witness>" : "<other>",
        })),
      },
      packagedBytesHoldValue,
      keychainHasItem,
      shellRows: shellRows.length,
    });
    verdict = judge({
      value,
      packaged,
      unpackaged,
      packagedBytesHoldValue,
      keychainHasItem,
      shellRows,
      heard: {
        seed: fixture.requests.some((r) => r.at < bStart && r.path === "/seed"),
        packaged: heardB !== undefined,
      },
    });
    if (still.length > 0) {
      verdict.ok = false;
      verdict.problems.push(`${still.length} process(es) of the packaged run outlived the reap`);
    }
    verdict.keyClass = keyClass;
    verdict.dataRoot = dataRoot;
    if (!keep && verdict.ok) rmSync(dataRoot, { recursive: true, force: true });
  } finally {
    await fixture.close();
  }
  say("SMOKE_PROFILE", verdict);
  if (!keep && verdict.ok) {
    securityIn(home, ["delete-keychain", keychain]);
    rmSync(run, { recursive: true, force: true });
  } else say("SMOKE_PROFILE_KEPT", { run });
  return verdict.ok ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`smoke:profile: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
