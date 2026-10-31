// WP12 L4 (WP12f; build-wp12-updater.md §2 D9, §14 — the PM's rulings 2026-10-15 21:41Z) — the fixture update origin
// `smoke:update` points a DEV-keyed package at.
//
// A loopback HTTP server over release trees built here and signed by the release step itself (`release-sign.mjs`'s
// `signRelease`, the code the workflow's sign job runs), with keys minted in this process for the run. EL7: no secret is
// ever written — the trust-root (public, root-signed) is the only key material that leaves memory, as the stage's
// `--dev-trust-root` input. It serves GitHub's shape as the client reads it (`verify-chain.ts:118-128, 178-191`):
// `<origin>.atom`, newest release first, and `<origin>/download/<tag>/<file>[.sig]`. It counts every request, so a run
// can say how many payload bytes were asked for (W9: none on runs 2–5).
//
// `N` is synthetic and never built: `staged` needs only a payload whose sha512 the signed feed names (electron-updater
// checks it, `httpExecutor.js:468-470`); the bytes are random, and Squirrel's first touch at download completion
// (`MacUpdater.js:209-219`) reads none of them. The physical apply is W11's (§14 R6).

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANNELS, SIG, signRelease, TRUST_ROOT_FILE } from "../../../scripts/release-sign.mjs";
import * as keygen from "../../../scripts/trust-keygen.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const COMMITTED_POLICIES = join(repo, "apps/desktop/packaging/policy");

/** The origin's path: GitHub's `/<owner>/<repo>/releases`, which the atom's `releases/tag/<tag>` links extend. */
export const FIXTURE_PATH = "/vibefield/vibefield/releases";
export const FEED_FILE = "latest-mac.yml";

/** The five runs, in order (§4 WP12f, §14). */
export const UPDATE_RUNS = ["staged", "forged", "rollback", "killed", "unresolved"];

/** AU-5 (LC-29) — runs only a `--runs` names, never the row's default: `quit` sends a PERSON's quit (an Apple Event to
 * the run's pid), whose trigger is unverified unattended (TCC may ask a person first). */
export const OPT_IN_RUNS = ["quit"];

/** The run's keys: TD-1's shape (two root keys, one each for release, bundled and registry), secrets in memory only. */
export function mintKeys() {
  const [rootA, rootB, release, bundled, registry] = Array.from({ length: 5 }, () =>
    keygen.generateKeypair(),
  );
  return { rootA, rootB, release, bundled, registry };
}

/** The trust-root the keys make, signed by its own root: the public document the stage embeds and every release
 * carries unchanged. */
export function smokeTrustRoot(keys, now = Date.now()) {
  const doc = keygen.assembleTrustRoot({
    root: [keys.rootA.publicKey, keys.rootB.publicKey],
    release: [keys.release.publicKey],
    bundled: [keys.bundled.publicKey],
    registry: [keys.registry.publicKey],
    now,
  });
  const bytes = Buffer.from(keygen.canonicalJson(doc));
  return { doc, bytes, sigText: keygen.signTrustRoot(bytes, "", keys.rootA.secretKey) };
}

/** The trust-root as files (`<path>` and `<path>.sig`): public bytes only. */
export function writeTrustRoot(path, trustRoot) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, trustRoot.bytes);
  writeFileSync(path + SIG, trustRoot.sigText);
  return path;
}

const sha512Of = (bytes) => createHash("sha512").update(bytes).digest("base64");
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** The version above N-1 a run offers: the next patch, as a beta (`0.1.0` → `0.1.1-beta.1`), or a nightly of it. */
export function nextVersion(current, channel, now = Date.now()) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (match === null) throw new Error(`"${current}" is not a semver version`);
  const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  return channel === "nightly" ? `${next}-nightly.${ymd(now)}` : `${next}-beta.1`;
}

const tagOf = (version, channel, now) =>
  channel === "nightly" ? `nightly-${ymd(now)}` : `v${version}`;

/**
 * One release directory, signed. The policy sources are the committed ones with this run's levers and version applied
 * to the release's channel; the feed names a payload of random bytes by its sha512 and size.
 *
 * - `levers`: merged into the channel's policy source (`killSwitch`, `requireUserConfirmation`, …)
 * - `policyVersion`: the channel's policy version (run 3 serves one below what the client remembers)
 * - `forgeFeedSig`: the feed's signature is a stranger's (run 2)
 */
export function buildRelease({
  dir,
  keys,
  trustRoot,
  channel,
  current,
  run = 1,
  levers = {},
  policyVersion,
  forgeFeedSig = false,
  payloadSize = 256 * 1024,
  now = Date.now(),
}) {
  const version = nextVersion(current, channel, now);
  const tag = tagOf(version, channel, now);
  const src = `${dir}.src`;
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(src, "policy"), { recursive: true });
  const rootPath = writeTrustRoot(join(src, TRUST_ROOT_FILE), trustRoot);
  for (const ch of CHANNELS) {
    const source = JSON.parse(readFileSync(join(COMMITTED_POLICIES, `${ch}.json`), "utf8"));
    const policy =
      ch === channel
        ? {
            ...source,
            ...levers,
            ...(policyVersion !== undefined ? { version: policyVersion } : {}),
          }
        : source;
    writeFileSync(join(src, "policy", `${ch}.json`), `${JSON.stringify(policy, null, 2)}\n`);
  }
  const zip = `VibeField-${version}-arm64-mac.zip`;
  const payload = randomBytes(payloadSize);
  writeFileSync(join(dir, zip), payload);
  const sha512 = sha512Of(payload);
  writeFileSync(
    join(dir, FEED_FILE),
    [
      `version: ${version}`,
      "files:",
      `  - url: ${zip}`,
      `    sha512: ${sha512}`,
      `    size: ${payload.length}`,
      `path: ${zip}`,
      `sha512: ${sha512}`,
      `releaseDate: '${new Date(now).toISOString()}'`,
      "",
    ].join("\n"),
  );
  signRelease({
    dir,
    tag,
    channel,
    run,
    policies: join(src, "policy"),
    trustRoot: rootPath,
    now,
    secret: keys.release.secretKey,
  });
  if (forgeFeedSig) {
    const stranger = keygen.generateKeypair();
    const feed = readFileSync(join(dir, FEED_FILE));
    writeFileSync(join(dir, FEED_FILE + SIG), `${keygen.signBytes(feed, stranger.secretKey)}\n`);
  }
  return { dir, tag, channel, version, zip, sha512, size: payload.length };
}

/**
 * A run's releases, newest first, and what the client's state file is seeded with (§14's runs):
 * 1. staged — the good chain; `requireUserConfirmation` keeps the silent apply shut
 * 2. forged — the feed's `.sig` is a stranger's: `feed-unverified`, no payload
 * 3. rollback — the beta policy at v2 against a remembered v5: `policy-rollback`
 * 4. killed — the kill switch on beta, advertising N (a lever bites only on a FOUND update)
 * 5. unresolved — nightly-only heads for the beta build: `channel-unresolved`, never the nightly
 * AU-5, opt-in (`OPT_IN_RUNS`):
 * - quit — the good chain with `requireUserConfirmation` off, so a person's quit may install it: `staged` first, then
 *   (`next: "quit-install"`) the quit hands the random bytes to Squirrel after the stop, which refuses them
 */
export function buildRun(name, { root, keys, trustRoot, current, now = Date.now() }) {
  const dir = join(root, name);
  const base = { keys, trustRoot, current, now, channel: "beta" };
  switch (name) {
    case "staged":
      return {
        releases: [buildRelease({ ...base, dir, levers: { requireUserConfirmation: true } })],
        seed: null,
        expect: "staged",
      };
    case "forged":
      return {
        releases: [buildRelease({ ...base, dir, forgeFeedSig: true })],
        seed: null,
        expect: "feed-unverified",
      };
    case "rollback":
      return {
        releases: [buildRelease({ ...base, dir, policyVersion: 2 })],
        seed: {
          schemaVersion: 1,
          remembered: {
            trustRoot: null,
            channels: null,
            policy: { nightly: null, beta: 5, stable: null },
          },
        },
        expect: "policy-rollback",
      };
    case "killed":
      return {
        releases: [buildRelease({ ...base, dir, levers: { killSwitch: true } })],
        seed: null,
        expect: "killed",
      };
    case "unresolved":
      return {
        releases: [buildRelease({ ...base, dir, channel: "nightly" })],
        seed: null,
        expect: "channel-unresolved",
      };
    case "quit":
      return {
        releases: [buildRelease({ ...base, dir, levers: { requireUserConfirmation: false } })],
        seed: null,
        expect: "staged",
        next: "quit-install",
      };
    default:
      throw new Error(`unknown run "${name}" (${[...UPDATE_RUNS, ...OPT_IN_RUNS].join(", ")})`);
  }
}

/** Is this request for payload bytes (the zip, or a differential's blockmap)? */
export const isPayload = (path) => /\.(zip|blockmap)$/.test(path);

/**
 * Serve `releases` (newest first) on loopback. Resolves to `{origin, requests, payloadRequests(), close()}`; `origin` is
 * what `VIBEFIELD_UPDATE_ORIGIN` names, and `requests` records every request's method and path in order.
 */
export function serveReleases(releases, { host = "127.0.0.1", port = 0 } = {}) {
  const requests = [];
  const byTag = new Map(releases.map((release) => [release.tag, release.dir]));
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://fixture").pathname);
    requests.push({ method: req.method, path });
    const send = (status, body, type = "application/octet-stream") => {
      res.writeHead(status, { "Content-Type": type, "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (path === `${FIXTURE_PATH}.atom`) {
      const { port: bound } = server.address();
      const entries = releases
        .map(
          (release) =>
            `<entry><link rel="alternate" type="text/html" href="http://${host}:${bound}${FIXTURE_PATH}/tag/${encodeURIComponent(release.tag)}"/><title>${release.tag}</title></entry>`,
        )
        .join("");
      return send(
        200,
        Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`,
        ),
        "application/atom+xml",
      );
    }
    const prefix = `${FIXTURE_PATH}/download/`;
    if (path.startsWith(prefix)) {
      const [tag, ...rest] = path.slice(prefix.length).split("/");
      const dir = byTag.get(tag);
      const file = rest.join("/");
      if (dir !== undefined && file !== "" && !file.includes("..")) {
        try {
          return send(200, readFileSync(join(dir, file)));
        } catch {}
      }
    }
    return send(404, Buffer.from("not found\n"), "text/plain");
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const { port: bound } = server.address();
      resolveServer({
        origin: `http://${host}:${bound}${FIXTURE_PATH}`,
        requests,
        payloadRequests: () => requests.filter((request) => isPayload(request.path)),
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
