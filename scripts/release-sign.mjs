#!/usr/bin/env node
// WP12-D8 (build-wp12-updater.md, L3a) — the release's SIGN step (TD-3), run in the `release-signing` environment after
// the build matrix and before the draft is published. It writes, beside the release's assets:
//   - `update-policy.<channel>.json` for EVERY channel (D5), from the committed sources in
//     `apps/desktop/packaging/policy/`, stamped `generatedAt`, `expires` (60 days) and `trustRootVersion`;
//   - `channels.json` (D4): the previous release's heads with THIS release's tag as its channel's head;
// and signs the EXACT bytes of every `latest*.yml`, `release-manifest.json`, the three policies and `channels.json` with
// the trust-root's `release` key (`VIBEFIELD_RELEASE_SECRET`). The ROOT-signed `trust-root.json` and its `.sig` are
// attached unchanged (the client verifies them by its embedded root keys). One signature per line, base64 Ed25519 over
// the file's bytes (`@vibefield/trust`'s format).
//
// No secret, no metadata: without `VIBEFIELD_RELEASE_SECRET` the step removes every `latest*.yml` and writes nothing
// update-visible — an unsigned feed would only produce `feed-unverified` on every client (TD-3). The installers stay
// downloadable by hand, and the run says what it lacked (RM-D5, EDP §12.4).
//
// usage: node scripts/release-sign.mjs --dir <release dir> --tag <tag> --channel <nightly|beta|stable> --run <n>
//          [--policies apps/desktop/packaging/policy] [--trust-root apps/desktop/packaging/trust-root.json]
//          [--previous <dir holding the previous release's channels.json and update-policy.*.json>] [--now <ms>]

import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, publicKeyOf, signBytes } from "./trust-keygen.mjs";

export const CHANNELS = ["nightly", "beta", "stable"];
export const SIG = ".sig";
export const CHANNELS_FILE = "channels.json";
export const MANIFEST_FILE = "release-manifest.json";
export const TRUST_ROOT_FILE = "trust-root.json";
export const SECRET_ENV = "VIBEFIELD_RELEASE_SECRET";
/** TRUST_FRESHNESS_DAYS.updatePolicy — the policy's and the heads' freshness */
export const FRESH_DAYS = 60;
export const TAG_PATTERNS = {
  nightly: /^nightly-\d{8}$/,
  beta: /^v\d+\.\d+\.\d+-beta\.\d+$/,
  stable: /^v\d+\.\d+\.\d+$/,
};
export const policyFile = (channel) => `update-policy.${channel}.json`;
const isFeed = (name) => /^latest.*\.yml$/.test(name);

export class ReleaseSignError extends Error {}
const refuse = (message) => {
  throw new ReleaseSignError(message);
};

/** What a version bump protects: the policy minus what the workflow stamps. */
export function policyBody(doc) {
  const { generatedAt: _g, expires: _e, trustRootVersion: _t, ...body } = doc;
  return canonicalJson(body);
}

/** A committed source, checked to `UpdatePolicySource`'s shape (the contract is TS; this is its script-side guard). */
export function readPolicySource(path, channel) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    refuse(`${path}: not JSON (${error.message})`);
  }
  if (!Number.isInteger(doc.version) || doc.version < 1)
    refuse(`${path}: version must be an integer ≥ 1`);
  if (doc.channel !== channel)
    refuse(`${path}: channel is "${doc.channel}", the file is ${channel}'s`);
  if (typeof doc.killSwitch !== "boolean") refuse(`${path}: killSwitch must be a boolean`);
  if (typeof doc.requireUserConfirmation !== "boolean")
    refuse(`${path}: requireUserConfirmation must be a boolean`);
  if (
    doc.yanked !== undefined &&
    !(Array.isArray(doc.yanked) && doc.yanked.every((v) => typeof v === "string"))
  )
    refuse(`${path}: yanked must be a list of versions`);
  for (const stamped of ["generatedAt", "expires", "trustRootVersion"])
    if (stamped in doc) refuse(`${path}: ${stamped} is stamped by the sign step, never committed`);
  return { yanked: [], floors: {}, ...doc };
}

/** D5's refusal: a changed body needs a version bump, and no version goes below the last published one. */
export function checkPolicyBump(source, previous) {
  if (previous === null) return;
  if (source.version < previous.version)
    refuse(
      `${source.channel}: version ${source.version} is below the published ${previous.version} — a rollback every client refuses`,
    );
  if (source.version === previous.version && policyBody(source) !== policyBody(previous))
    refuse(
      `${source.channel}: the policy changed without a version bump (still ${source.version}) — bump it in apps/desktop/packaging/policy/${source.channel}.json`,
    );
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function stampPolicy(source, { now, trustRootVersion }) {
  return {
    ...source,
    generatedAt: now,
    expires: iso(now + FRESH_DAYS * 86_400_000),
    trustRootVersion,
  };
}

/** D4: the previous release's heads, with THIS release as its channel's head; `version` strictly above the previous. */
export function buildChannels({ tag, channel, run, previous, now, trustRootVersion }) {
  if (!TAG_PATTERNS[channel]?.test(tag)) refuse(`"${tag}" is not a ${channel} tag`);
  const heads = { nightly: null, beta: null, stable: null, ...(previous?.heads ?? {}) };
  heads[channel] = tag;
  const version = Math.max(run, (previous?.version ?? 0) + 1);
  return {
    schemaVersion: 1,
    version,
    generatedAt: now,
    expires: iso(now + FRESH_DAYS * 86_400_000),
    trustRootVersion,
    heads,
  };
}

function readJsonOrNull(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** The sign step. Returns what it wrote and signed; throws `ReleaseSignError` on any refusal, before writing anything. */
export function signRelease({
  dir,
  tag,
  channel,
  run,
  policies,
  trustRoot,
  previousDir = null,
  now = Date.now(),
  secret = process.env[SECRET_ENV],
  log = () => {},
}) {
  if (!CHANNELS.includes(channel)) refuse(`unknown channel "${channel}"`);
  if (!Number.isInteger(run) || run < 1) refuse("--run must be the workflow's run number (≥ 1)");
  const feeds = readdirSync(dir).filter(isFeed);
  if (!secret) {
    for (const feed of feeds) rmSync(join(dir, feed));
    log(
      `${SECRET_ENV} is not set: no update metadata is published (removed ${feeds.length} latest*.yml). The installers stay downloadable by hand; clients see no update.`,
    );
    return { unsigned: true, signed: [], written: [] };
  }
  const rootBytes = readFileSync(trustRoot);
  const rootSig = trustRoot + SIG;
  if (!existsSync(rootSig))
    refuse(`${rootSig} is missing — the root-signed trust-root is attached unchanged`);
  const root = JSON.parse(rootBytes.toString("utf8"));
  const releaseKey = publicKeyOf(secret);
  if (!root.roles?.release?.keys?.includes(releaseKey))
    refuse(
      `${SECRET_ENV}'s public half is not a release key of ${trustRoot} (version ${root.version})`,
    );

  // every check before any write
  const sources = CHANNELS.map((ch) => readPolicySource(join(policies, `${ch}.json`), ch));
  for (const source of sources)
    checkPolicyBump(
      source,
      previousDir ? readJsonOrNull(join(previousDir, policyFile(source.channel))) : null,
    );
  const channelsDoc = buildChannels({
    tag,
    channel,
    run,
    previous: previousDir ? readJsonOrNull(join(previousDir, CHANNELS_FILE)) : null,
    now,
    trustRootVersion: root.version,
  });

  const written = [];
  for (const source of sources) {
    const name = policyFile(source.channel);
    writeFileSync(
      join(dir, name),
      canonicalJson(stampPolicy(source, { now, trustRootVersion: root.version })),
    );
    written.push(name);
  }
  writeFileSync(join(dir, CHANNELS_FILE), canonicalJson(channelsDoc));
  written.push(CHANNELS_FILE);
  copyFileSync(trustRoot, join(dir, TRUST_ROOT_FILE));
  copyFileSync(rootSig, join(dir, TRUST_ROOT_FILE + SIG));

  const toSign = [
    ...written,
    ...feeds,
    ...(existsSync(join(dir, MANIFEST_FILE)) ? [MANIFEST_FILE] : []),
  ];
  for (const name of toSign) {
    writeFileSync(join(dir, name + SIG), `${signBytes(readFileSync(join(dir, name)), secret)}\n`);
  }
  log(
    `signed ${toSign.length} documents for ${tag} (${channel}); channels.json version ${channelsDoc.version}`,
  );
  return { unsigned: false, signed: toSign, written };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new ReleaseSignError(`unexpected argument "${key}"`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const a = args(process.argv.slice(2));
    if (!a.dir || !a.tag || !a.channel || !a.run)
      throw new ReleaseSignError("--dir, --tag, --channel and --run are required");
    signRelease({
      dir: a.dir,
      tag: a.tag,
      channel: a.channel,
      run: Number(a.run),
      policies: a.policies ?? join(repo, "apps/desktop/packaging/policy"),
      trustRoot: a["trust-root"] ?? join(repo, "apps/desktop/packaging/trust-root.json"),
      previousDir: a.previous ?? null,
      now: a.now ? Number(a.now) : Date.now(),
      log: (line) => console.log(`release-sign: ${line}`),
    });
  } catch (error) {
    console.error(
      `release-sign: ${error instanceof ReleaseSignError ? error.message : error.stack}`,
    );
    process.exit(1);
  }
}
