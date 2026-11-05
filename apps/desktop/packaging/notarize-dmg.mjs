#!/usr/bin/env node
// LP-1 (the 0.9 launch's rails) — the DMG a stranger downloads is SIGNED, NOTARIZED and STAPLED.
//
// What electron-builder 26.15.7 does, read in node_modules (2026-11-05): `mac.notarize` sends the .app to notarytool
// (@electron/notarize) and staples the .app BEFORE the dmg and zip targets are built; `dmg.sign` would only run codesign
// on the DMG (no --timestamp, no notarization; dmg-builder `dmg.js` signDmg); nothing notarizes or staples the DMG. So
// nightly-20261028's DMG read "not signed at all", carried no ticket, and `spctl -a -t open --context
// context:primary-signature` rejected it ("no usable signature") while the .app inside was accepted. Apple's rule: sign
// the disk image with the Developer ID Application identity, notarize only the outermost container, staple it.
//
// This runs after electron-builder, inside package:mac:release (run-macos-release.mjs) — the one place the Apple
// credentials already are, on the release workflow's signed step and on James's Mac alike:
//   1. sign the DMG with the team's Developer ID Application identity and a secure timestamp. electron-builder's
//      temporary keychain is deleted when its build ends (app-builder-lib `macPackager.js`: disposeOnBuildFinish →
//      removeKeychain), so CSC_LINK / CSC_KEY_PASSWORD are imported again into a keychain of this run's own, deleted
//      after, and the user's keychain search list restored; with no CSC_LINK (a release cut on James's Mac) the identity
//      comes from the login keychain, as the preflight's `localTeamIdentity` found it;
//   2. submit it to notarytool with the ONE credential mode the preflight accepted (the App Store Connect API key in
//      CI), wait for the verdict, and print Apple's log on anything but Accepted (never retried);
//   3. staple it;
//   4. assess it: codesign --verify --strict; the team, a Developer ID Application authority and a secure timestamp on
//      the signature; stapler validate; Gatekeeper's `spctl -a -t open --context context:primary-signature`;
//   5. re-read the feed's DMG entry (sha512, size) from the stapled bytes and drop the DMG's blockmap
//      (scripts/release-assets.mjs says why) — before anything downstream hashes the DMG.
// A transient network failure (NSURLErrorDomain -1005 failed run 41726990250's staple on 2026-11-03) is retried a bounded
// number of times (`RETRIES`); the release workflow also routes Apple's ticket traffic over TCP before this step, and
// before converge's `--validate-only` (862e2e5da's rule, one copy: `.github/actions/apple-tickets-over-tcp`).
//
// usage: node packaging/notarize-dmg.mjs --dir <electron-builder output dir>       (the signed path: steps 1–5)
//        node packaging/notarize-dmg.mjs --dir <dir> --unsigned        (no Apple credentials: says so, signs nothing,
//                                                                       re-reads the feed's DMG entry, drops the blockmap)
//        node packaging/notarize-dmg.mjs --dir <dir> --validate-only   (step 4 alone, on every DMG in <dir>: converge)
//
// EL7: no command line is ever printed, and every captured output is scrubbed of the credentials' values (and this run's
// keychain password) before it reaches the log.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dmgOfFeed,
  ReleaseAssetsError,
  refreshFeedEntry,
  sha512Base64OfFile,
} from "../../../scripts/release-assets.mjs";

/** The frozen team (run-macos-release.mjs `expectedTeamId`, electron-builder.release.yml `identity`). */
export const TEAM_ID = "9F79X9D26S";
export const MAC_FEED = "latest-mac.yml";
const SECURITY = "/usr/bin/security";
const CODESIGN = "/usr/bin/codesign";
const XCRUN = "/usr/bin/xcrun";
const SPCTL = "/usr/sbin/spctl";

/** Bounded retries on a TRANSIENT failure: the delays (ms) between attempts, so attempts = delays + 1. */
export const RETRIES = {
  codesign: [15_000, 30_000],
  submit: [30_000, 60_000],
  wait: [30_000, 60_000],
  staple: [15_000, 30_000, 60_000, 120_000],
  assess: [15_000, 30_000],
};

/** The environment values that never reach the log. */
const SECRET_ENV = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY_P8",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_KEYCHAIN_PROFILE",
];

export class NotarizeDmgError extends Error {}
const refuse = (message) => {
  throw new NotarizeDmgError(message);
};
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

const NETWORK = [
  /NSURLErrorDomain/i,
  /network connection was lost/i,
  /request timed out/i,
  /could not connect to the server/i,
  /internet connection appears to be offline/i,
  /\b(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EPIPE)\b/,
  /HTTP status code:? 5\d\d\b/i,
  /\b(?:Service Unavailable|Bad Gateway|Gateway Timeout)\b/i,
  /timestamp service is not available/i,
];

/** Is this failure's output a transient network failure, worth a bounded retry? `kind` names the step: stapler's
 * "Record not found" right after an Accepted verdict is CloudKit still propagating the ticket, so it retries too. An
 * Invalid verdict, a refused credential or a rejected signature never matches. */
export function isTransient(text, kind) {
  if (NETWORK.some((pattern) => pattern.test(text))) return true;
  return kind === "staple" && /Record not found/i.test(text);
}

/** The real runner: argv only (never a shell), output captured. */
export function systemExec(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) return { code: 127, stdout: "", stderr: result.error.message };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A scrubber over the credentials' values in `env` plus `extra` (this run's own secrets). */
export function scrubberOf(env, extra = []) {
  return (text) => {
    const values = [...SECRET_ENV.map((name) => env[name]), ...extra].filter(
      (value) => nonempty(value) && value.trim().length >= 4,
    );
    let out = text;
    for (const value of values) out = out.split(value.trim()).join("***");
    return out;
  };
}

/** notarytool's arguments for the ONE complete credential mode — the rule run-macos-release.mjs's preflight states:
 * the App Store Connect API key (CI), an Apple ID with an app-specific password and the frozen team, or a keychain
 * profile. Refuses a partial or a second mode before anything is signed. */
export function notaryCredentials(env) {
  const api = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
  const appleId = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD"];
  const apiPresent = api.filter((name) => nonempty(env[name])).length;
  const appleIdPresent = appleId.filter((name) => nonempty(env[name])).length;
  if (apiPresent > 0 && apiPresent !== api.length)
    refuse("APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER must be supplied together");
  if (appleIdPresent > 0 && appleIdPresent !== appleId.length)
    refuse("APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD must be supplied together");
  const modes = [];
  if (apiPresent === api.length)
    modes.push({
      mode: "app-store-connect-api-key",
      args: [
        "--key",
        env.APPLE_API_KEY,
        "--key-id",
        env.APPLE_API_KEY_ID,
        "--issuer",
        env.APPLE_API_ISSUER,
      ],
    });
  if (appleIdPresent === appleId.length) {
    if (env.APPLE_TEAM_ID !== TEAM_ID)
      refuse(`APPLE_TEAM_ID must be the frozen team ${TEAM_ID} with Apple ID notarization`);
    modes.push({
      mode: "apple-id",
      args: [
        "--apple-id",
        env.APPLE_ID,
        "--password",
        env.APPLE_APP_SPECIFIC_PASSWORD,
        "--team-id",
        TEAM_ID,
      ],
    });
  }
  if (nonempty(env.APPLE_KEYCHAIN_PROFILE))
    modes.push({
      mode: "keychain-profile",
      args: [
        "--keychain-profile",
        env.APPLE_KEYCHAIN_PROFILE,
        ...(nonempty(env.APPLE_KEYCHAIN) ? ["--keychain", env.APPLE_KEYCHAIN] : []),
      ],
    });
  if (modes.length !== 1) refuse("configure exactly one complete notarization credential mode");
  return modes[0];
}

/** notarytool's `--output-format json` answer (`{id, status, message}`), or null when it printed none. */
export function notaryResult(stdout) {
  const text = stdout.trim();
  const candidates = [
    text,
    ...text
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .reverse(),
  ];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // not JSON: the next candidate
    }
  }
  return null;
}

/** The first VALID Developer ID Application identity of `teamId` in `security find-identity -v` output, as
 * `{hash, name}` (electron-builder picks the first match too), or null. */
export function developerIdIdentity(text, teamId = TEAM_ID) {
  for (const line of text.split(/\r?\n/)) {
    const match =
      /^\s*\d+\)\s+([0-9A-F]{40})\s+"(Developer ID Application: .+ \(([A-Z0-9]{10})\))"/.exec(line);
    if (match !== null && match[3] === teamId) return { hash: match[1], name: match[2] };
  }
  return null;
}

/** `security list-keychains -d user` output → the paths, unquoted. */
export function keychainList(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^"(.*)"$/, "$1"));
}

/** CSC_LINK's bytes, read as electron-builder reads it (builder-util `decodeCscLinkBase64`, `resolveCscLinkPath`): base64
 * when it has a `data:…;base64,` prefix, is longer than 2048 or ends in `=`; else a path (`~/`, `file://`, absolute, or
 * relative to `cwd`). An https link is refused: nothing here downloads a certificate. */
export function decodeCscLink(link, cwd) {
  const trimmed = link.trim();
  if (trimmed.startsWith("https://"))
    refuse("CSC_LINK is an https link: give the DMG signer its base64 or a path");
  const mime = /^data:.*;base64,/.exec(trimmed);
  if (mime !== null || trimmed.length > 2048 || trimmed.endsWith("="))
    return Buffer.from(trimmed.slice(mime?.[0].length ?? 0), "base64");
  let path = trimmed;
  if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
  else if (path.startsWith("file://")) path = path.slice("file://".length);
  if (!isAbsolute(path)) path = resolve(cwd, path);
  if (!existsSync(path)) refuse("CSC_LINK names a certificate file that does not exist");
  return readFileSync(path);
}

function runnerOf({ exec, sleep, log, scrub }) {
  const tail = (result) =>
    scrub(`${result.stdout}\n${result.stderr}`.trim()).split("\n").slice(-40).join("\n");
  /** Once; a non-zero exit refuses, naming the step — never its command line. */
  const must = (label, command, args) => {
    const result = exec(command, args);
    if (result.code !== 0) refuse(`${label} failed (exit ${result.code}):\n${tail(result)}`);
    return result;
  };
  /** With bounded retries on a transient failure. `accept` may read a result past its exit code. */
  const retrying = (label, kind, command, args, delays, accept = (result) => result.code === 0) => {
    for (let attempt = 1; ; attempt++) {
      const result = exec(command, args);
      if (accept(result)) return result;
      const delay = delays[attempt - 1];
      if (delay === undefined || !isTransient(`${result.stdout}\n${result.stderr}`, kind))
        refuse(
          `${label} failed (exit ${result.code}, attempt ${attempt} of ${delays.length + 1}):\n${tail(result)}`,
        );
      log(
        `notarize-dmg: ${label} met a transient network failure (attempt ${attempt} of ${delays.length + 1}); again in ${delay / 1000}s`,
      );
      sleep(delay);
    }
  };
  return { exec, tail, must, retrying };
}

/** The signing identity, and the keychain it lives in for this run (deleted by `close`). */
export function openSigningKeychain({ env, cwd, scratch, runner, onSecret }) {
  if (!nonempty(env.CSC_LINK)) {
    const found = developerIdIdentity(
      runner.must("security find-identity", SECURITY, ["find-identity", "-v", "-p", "codesigning"])
        .stdout,
    );
    if (found === null)
      refuse(`no valid Developer ID Application identity for team ${TEAM_ID}, and no CSC_LINK`);
    return { identity: found, keychain: null, close: () => {} };
  }
  const dir = mkdtempSync(join(scratch, "vf-dmg-sign-"));
  const keychain = join(dir, "dmg-sign.keychain-db");
  const password = randomBytes(24).toString("base64url");
  onSecret(password);
  const before = keychainList(
    runner.must("security list-keychains", SECURITY, ["list-keychains", "-d", "user"]).stdout,
  );
  let created = false;
  let listed = false;
  const close = () => {
    if (listed) runner.exec(SECURITY, ["list-keychains", "-d", "user", "-s", ...before]);
    if (created) runner.exec(SECURITY, ["delete-keychain", keychain]);
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const p12 = join(dir, "identity.p12");
    writeFileSync(p12, decodeCscLink(env.CSC_LINK, cwd), { mode: 0o600 });
    runner.must("security create-keychain", SECURITY, [
      "create-keychain",
      "-p",
      password,
      keychain,
    ]);
    created = true;
    runner.must("security set-keychain-settings", SECURITY, [
      "set-keychain-settings",
      "-lut",
      "21600",
      keychain,
    ]);
    runner.must("security unlock-keychain", SECURITY, [
      "unlock-keychain",
      "-p",
      password,
      keychain,
    ]);
    runner.must("security import", SECURITY, [
      "import",
      p12,
      "-k",
      keychain,
      "-f",
      "pkcs12",
      "-P",
      env.CSC_KEY_PASSWORD ?? "",
      "-T",
      CODESIGN,
    ]);
    rmSync(p12); // the key lives in the keychain alone from here
    runner.must("security set-key-partition-list", SECURITY, [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      password,
      keychain,
    ]);
    runner.must("security list-keychains", SECURITY, [
      "list-keychains",
      "-d",
      "user",
      "-s",
      keychain,
      ...before,
    ]);
    listed = true;
    const found = developerIdIdentity(
      runner.must("security find-identity", SECURITY, [
        "find-identity",
        "-v",
        "-p",
        "codesigning",
        keychain,
      ]).stdout,
    );
    if (found === null)
      refuse(`CSC_LINK holds no valid Developer ID Application identity for team ${TEAM_ID}`);
    return { identity: found, keychain, close };
  } catch (error) {
    close();
    throw error;
  }
}

/** Step 2: submit, wait, and refuse anything but Accepted with Apple's own log. Returns the submission id. */
function notarize(path, credentials, runner, log) {
  const submitted = runner.retrying(
    "notarytool submit",
    "submit",
    XCRUN,
    ["notarytool", "submit", path, "--output-format", "json", ...credentials.args],
    RETRIES.submit,
    (result) => result.code === 0 && typeof notaryResult(result.stdout)?.id === "string",
  );
  const id = notaryResult(submitted.stdout).id;
  log(`notarize-dmg: submitted ${basename(path)} (submission ${id}); waiting for Apple's verdict`);
  const waited = runner.retrying(
    "notarytool wait",
    "wait",
    XCRUN,
    ["notarytool", "wait", id, "--timeout", "45m", "--output-format", "json", ...credentials.args],
    RETRIES.wait,
    (result) => typeof notaryResult(result.stdout)?.status === "string",
  );
  const verdict = notaryResult(waited.stdout);
  if (verdict.status !== "Accepted") {
    const appleLog = runner.exec(XCRUN, ["notarytool", "log", id, ...credentials.args]);
    refuse(
      `Apple's notary service answered ${verdict.status} for ${basename(path)} (submission ${id}): ${verdict.message ?? ""}\n${runner.tail(appleLog)}`,
    );
  }
  log(`notarize-dmg: Accepted (submission ${id})`);
  return id;
}

/** Step 4: the DMG as a stranger's Mac meets it. */
export function assessDmg(path, runner, log) {
  const name = basename(path);
  runner.must("codesign --verify", CODESIGN, ["--verify", "--strict", "--verbose=2", path]);
  const shown = runner.must("codesign --display", CODESIGN, ["--display", "--verbose=4", path]);
  const text = `${shown.stdout}\n${shown.stderr}`;
  if (!text.includes(`TeamIdentifier=${TEAM_ID}`))
    refuse(`${name} is not signed by team ${TEAM_ID}`);
  if (!/^Authority=Developer ID Application: /m.test(text))
    refuse(`${name} is not signed by a Developer ID Application identity`);
  if (!/^Timestamp=/m.test(text)) refuse(`${name}'s signature carries no secure timestamp`);
  runner.retrying(
    "stapler validate",
    "assess",
    XCRUN,
    ["stapler", "validate", "-v", path],
    RETRIES.assess,
  );
  const gate = runner.retrying(
    "spctl --assess",
    "assess",
    SPCTL,
    ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", path],
    RETRIES.assess,
  );
  const verdict = `${gate.stdout}\n${gate.stderr}`;
  if (/override=security disabled/.test(verdict)) {
    // a host with Gatekeeper's assessments off accepts anything: say so, and stand on codesign and the ticket above
    log(
      `::warning title=Gatekeeper is off on this host::spctl accepted ${name} only because assessments are disabled here; the signature, team, timestamp and stapled ticket checked above are the evidence`,
    );
  } else if (!/: accepted/.test(verdict) || !/source=Notarized Developer ID/.test(verdict)) {
    refuse(
      `Gatekeeper does not accept ${name} as a notarized Developer ID disk image:\n${runner.tail(gate)}`,
    );
  }
}

/** The whole step (see the header). `mode`: "signed" | "unsigned" | "validate-only". Injectable `exec`, `sleep` and
 * `log` so the tests drive every branch without Apple. */
export function finalizeDmg({
  dir,
  mode = "signed",
  env = process.env,
  exec = systemExec,
  sleep = sleepSync,
  log = (line) => console.log(line),
  cwd = process.cwd(),
  scratch = tmpdir(),
}) {
  const ownSecrets = [];
  const scrub = scrubberOf(env, ownSecrets);
  const runner = runnerOf({ exec, sleep, log, scrub });
  if (mode === "validate-only") {
    const dmgs = readdirSync(dir)
      .filter((name) => name.endsWith(".dmg"))
      .sort();
    if (dmgs.length === 0) refuse(`no DMG in ${dir}`);
    for (const name of dmgs) {
      assessDmg(join(dir, name), runner, log);
      log(`notarize-dmg: ${name} — Developer ID (${TEAM_ID}), notarized, stapled, accepted`);
    }
    return { mode, dmgs };
  }
  if (mode !== "signed" && mode !== "unsigned") refuse(`unknown mode "${mode}"`);
  const feedPath = join(dir, MAC_FEED);
  if (!existsSync(feedPath))
    refuse(
      `${feedPath} is missing: electron-builder writes it beside the DMG (the publish provider names it)`,
    );
  const dmg = dmgOfFeed(readFileSync(feedPath, "utf8"));
  const path = join(dir, dmg);
  if (!existsSync(path)) refuse(`${dmg}, the feed's DMG, is not in ${dir}`);
  let submission = null;
  if (mode === "unsigned") {
    log(
      "::warning title=Unsigned DMG::no Apple credentials (J4): the DMG is not signed, notarized or stapled, and Gatekeeper refuses it on a stranger's Mac",
    );
  } else {
    const credentials = notaryCredentials(env); // a bad mode refuses before anything is signed
    if (exec(CODESIGN, ["--display", path]).code === 0)
      refuse(
        `${dmg} is already signed: this step signs the DMG electron-builder just wrote (rebuild it)`,
      );
    const signing = openSigningKeychain({
      env,
      cwd,
      scratch,
      runner,
      onSecret: (secret) => ownSecrets.push(secret),
    });
    try {
      runner.retrying(
        "codesign the DMG",
        "codesign",
        CODESIGN,
        [
          "--sign",
          signing.identity.hash,
          "--timestamp",
          ...(signing.keychain !== null ? ["--keychain", signing.keychain] : []),
          path,
        ],
        RETRIES.codesign,
      );
    } finally {
      signing.close();
    }
    log(`notarize-dmg: signed ${dmg} as "${signing.identity.name}", with a secure timestamp`);
    submission = notarize(path, credentials, runner, log);
    runner.retrying(
      "stapler staple",
      "staple",
      XCRUN,
      ["stapler", "staple", "-v", path],
      RETRIES.staple,
    );
    log(`notarize-dmg: stapled ${dmg}`);
    assessDmg(path, runner, log);
  }
  // step 5 — after the last write to the DMG, and before anything downstream hashes it
  const blockmap = join(dir, `${dmg}.blockmap`);
  const hadBlockmap = existsSync(blockmap);
  rmSync(blockmap, { force: true });
  const sha512 = sha512Base64OfFile(path);
  const size = statSync(path).size;
  writeFileSync(
    feedPath,
    refreshFeedEntry(readFileSync(feedPath, "utf8"), { url: dmg, sha512, size }),
  );
  log(
    `notarize-dmg: ${MAC_FEED} names ${dmg} by its ${mode === "signed" ? "stapled " : ""}bytes (${size} bytes)${hadBlockmap ? `; ${dmg}.blockmap dropped` : ""}`,
  );
  return { mode, dmg, sha512, size, submission };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    let dir;
    const modes = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--dir") dir = argv[++i];
      else if (argv[i] === "--unsigned") modes.push("unsigned");
      else if (argv[i] === "--validate-only") modes.push("validate-only");
      else refuse(`unexpected argument "${argv[i]}"`);
    }
    if (!dir) refuse("--dir is required");
    if (modes.length > 1) refuse("--unsigned and --validate-only are two different steps");
    const mode = modes[0] ?? "signed";
    if (process.platform !== "darwin" && mode !== "unsigned")
      refuse("signing, notarizing and assessing a DMG runs on macOS");
    finalizeDmg({ dir: resolve(dir), mode });
  } catch (error) {
    const known = error instanceof NotarizeDmgError || error instanceof ReleaseAssetsError;
    console.error(`notarize-dmg: ${known ? error.message : error.stack}`);
    process.exit(1);
  }
}
