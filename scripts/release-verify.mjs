#!/usr/bin/env node
// WP12-D8 (build-wp12-updater.md, L3a) — the sign step's twin: verify a release directory OFFLINE with the SHELL'S OWN
// verifier (`verifyUpdateChain`, the chain the UpdateProvider runs before any download), as a client on `--channel`
// would meet it if this release were the newest one. It runs after the sign step and again in the converge step, on
// the assets about to be published; a refusal names its TD §4 state and fails the run.
//
// Every `latest*.yml` in the directory is walked through the whole chain (trust-root by the EMBEDDED root keys →
// channels.json → this channel's head → the newest release's policy → the feed), and `release-manifest.json`, when
// present, is checked against the trust-root's `release` keys too. A directory with no `latest*.yml` is an UNSIGNED
// release (the sign step ran without the secret): it verifies trivially, and says so.
//
// usage: node scripts/release-verify.mjs --dir <release dir> --tag <tag> --channel <nightly|beta|stable>
//          [--root-keys <comma-separated base64 keys>] [--now <ms>]
//        (without --root-keys: the frozen ledger's trustRootKeys, apps/desktop/packaging/release-identity.json)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The workspace's TypeScript runs as plugin-build's bin runs it: Node strips the types, and an extensionless relative
// import is retried as `.ts` (bundled-plugins.mjs's recipe, one answer in the repo). The chain's two workspace imports
// resolve to their sources by name, so the release workflow's sign and converge jobs install `@vibefield/contracts`
// alone (zod), with no lifecycle scripts, rather than the whole workspace in the job holding the release key.
const WORKSPACE_SOURCES = {
  "@vibefield/contracts": "packages/contracts/src/index.ts",
  "@vibefield/trust": "packages/trust/src/index.ts",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = WORKSPACE_SOURCES[specifier];
    if (source !== undefined)
      return { url: pathToFileURL(join(repo, source)).href, shortCircuit: true };
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const chain = await load("packages/electron-shell/src/main/updates/verify-chain.ts");
const trust = await load("packages/trust/src/index.ts");

/** A stand-in origin: the chain only ever builds URLs under it, and the fetch below maps them onto the directory. */
export const VERIFY_ORIGIN = "https://release-verify.invalid/releases";
const isFeed = (name) => /^latest.*\.yml$/.test(name);

export class ReleaseVerifyError extends Error {}

/** Verify `dir` as the newest release `tag` on `channel`. Resolves to the verified feeds; throws on any refusal. */
export async function verifyReleaseDir({ dir, tag, channel, rootKeys, now = Date.now() }) {
  const feeds = readdirSync(dir).filter(isFeed);
  // an UNSIGNED release (D8: no secret, no metadata) has nothing to verify, so it needs no anchor — before TD-1 freezes
  // the ledger's root keys, that is every release, and it must not fail here
  if (feeds.length === 0) return { unsigned: true, verified: [] };
  rootKeys ??= frozenRootKeys();
  const base = `${VERIFY_ORIGIN}/download/${encodeURIComponent(tag)}/`;
  const atom = `<?xml version="1.0"?><feed><entry><link rel="alternate" href="${VERIFY_ORIGIN}/tag/${encodeURIComponent(tag)}"/></entry></feed>`;
  const fetch = async (url) => {
    if (url === `${VERIFY_ORIGIN}.atom`) return Buffer.from(atom);
    if (!url.startsWith(base)) return null; // any other release: this directory holds only one
    const path = join(dir, decodeURIComponent(url.slice(base.length)));
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  };
  const verified = [];
  for (const feedFile of feeds) {
    const result = await chain.verifyUpdateChain({
      origin: VERIFY_ORIGIN,
      channel,
      rootKeys,
      remembered: chain.NOTHING_REMEMBERED,
      now,
      feedFile,
      fetch,
    });
    if (!result.ok)
      throw new ReleaseVerifyError(
        `${feedFile}: UNAVAILABLE {service: "updates", state: "${result.state}"} — ${result.detail}`,
      );
    if (result.head !== tag)
      throw new ReleaseVerifyError(
        `${feedFile}: the ${channel} head is ${result.head}, not ${tag}`,
      );
    verified.push(feedFile);
  }
  // The expected metadata (D4, D5, D8): EVERY channel's policy and the heads, signed by the release key — the chain
  // above walked only this channel's; a release missing another channel's policy would strand that channel's kill
  // switch. And the root-signed trust-root rides unchanged (the chain verified it by the root keys).
  const root = JSON.parse(readFileSync(join(dir, "trust-root.json"), "utf8"));
  for (const name of [
    "channels.json",
    "update-policy.nightly.json",
    "update-policy.beta.json",
    "update-policy.stable.json",
  ]) {
    const path = join(dir, name);
    if (
      !existsSync(path) ||
      !existsSync(`${path}.sig`) ||
      !trust.verifySignedBytes(
        readFileSync(path),
        readFileSync(`${path}.sig`, "utf8"),
        root.roles.release,
      )
    )
      throw new ReleaseVerifyError(
        `${name}: missing, or not signed by the trust-root's release key`,
      );
  }
  const manifest = join(dir, "release-manifest.json");
  if (existsSync(manifest)) {
    const sig = `${manifest}.sig`;
    if (
      !existsSync(sig) ||
      !trust.verifySignedBytes(
        readFileSync(manifest),
        readFileSync(sig, "utf8"),
        root.roles.release,
      )
    )
      throw new ReleaseVerifyError(
        "release-manifest.json: not signed by the trust-root's release key",
      );
    verified.push("release-manifest.json");
  }
  return { unsigned: false, verified };
}

function frozenRootKeys() {
  const ledger = JSON.parse(
    readFileSync(join(repo, "apps/desktop/packaging/release-identity.json"), "utf8"),
  );
  // the stager's own reading (bundled-plugins.mjs `frozenRootKeys`): only a FROZEN field is an anchor
  const field = ledger.fields?.trustRootKeys;
  const keys = field?.status === "frozen" ? field.value : null;
  if (!Array.isArray(keys) || keys.length === 0)
    throw new ReleaseVerifyError(
      "the ledger's trustRootKeys is not frozen (TD-1): pass --root-keys to verify a DEV-keyed release",
    );
  return keys;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new ReleaseVerifyError(`unexpected argument "${key}"`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const a = args(process.argv.slice(2));
    if (!a.dir || !a.tag || !a.channel)
      throw new ReleaseVerifyError("--dir, --tag and --channel are required");
    const result = await verifyReleaseDir({
      dir: a.dir,
      tag: a.tag,
      channel: a.channel,
      rootKeys: a["root-keys"] ? a["root-keys"].split(",") : undefined,
      now: a.now ? Number(a.now) : Date.now(),
    });
    console.log(
      result.unsigned
        ? "release-verify: no latest*.yml — an UNSIGNED release (no update metadata); nothing to verify"
        : `release-verify: ${result.verified.join(", ")} verified as the newest ${a.channel} release ${a.tag}`,
    );
  } catch (error) {
    console.error(
      `release-verify: ${error instanceof ReleaseVerifyError ? error.message : error.stack}`,
    );
    process.exit(1);
  }
}
