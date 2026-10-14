#!/usr/bin/env node
// TD-0 — the trust-root's keys and its document (specs/trust-and-distribution.md §2, TD-1, TD-16).
// James mints every key himself (TD-1): the OFFLINE root (two keys, threshold 1) and the three ONLINE
// roles (`release`, `bundled`, `registry`). This script is the only tool that touches a secret, and it
// is built so a secret cannot leak by accident (EL7):
//   - it is PRINTED once, and only to a terminal — when stdout is not a TTY (a pipe, a log, a CI step,
//     an agent's shell) `keygen` refuses unless `--secret-out <file>` names where it goes;
//   - a `--secret-out` file is written 0600, never over an existing file, never inside this repository;
//   - `sign` reads a secret from stdin or a named environment variable, never from argv (argv is in
//     the process list and the shell's history);
//   - a public-key file and a document are never overwritten.
//
// Encoding is the kit's (tooling/plugin-build/src/registry-sign.ts): a public key is base64 SPKI DER, a
// secret base64 PKCS#8 DER; a signature is base64 Ed25519 over a document's EXACT bytes. The document is
// written as canonical JSON (keys sorted, 2-space indent, one trailing newline — the kit's
// `canonicalJson`), and `trust-root.json.sig` holds one signature per line, one line per root key that
// signed; a one-line file is exactly the kit's registry signature. The shape is `TrustRoot` in
// @vibefield/contracts (trust-root.ts); the checks below mirror it with builtins so this script needs no
// build, and tooling/plugin-build's compat test holds the two together.
//
// Usage (TD-1, in James's own terminal):
//   node scripts/trust-keygen.mjs keygen --role root --name root-a --out ~/vibefield-trust
//   node scripts/trust-keygen.mjs keygen --role root --name root-b --out ~/vibefield-trust
//   node scripts/trust-keygen.mjs keygen --role release  --name release-1  --out ~/vibefield-trust
//   node scripts/trust-keygen.mjs keygen --role bundled  --name bundled-1  --out ~/vibefield-trust
//   node scripts/trust-keygen.mjs keygen --role registry --name registry-1 --out ~/vibefield-trust
//   node scripts/trust-keygen.mjs assemble --root A.pub --root B.pub --release R.pub --bundled U.pub \
//        --registry G.pub [--version 1 | --previous old.json] [--expires-days 180] --out trust-root.json
//   security find-generic-password -s vibefield-trust-root-a -w \
//     | node scripts/trust-keygen.mjs sign --doc trust-root.json --key-stdin
//   node scripts/trust-keygen.mjs verify --doc trust-root.json [--trust-doc old.json | --trust A.pub …]
//   node scripts/trust-keygen.mjs embed --doc trust-root.json [--trust-doc old.json]
//   node scripts/trust-keygen.mjs --self-test
// Node >=22 ESM, builtins only.
import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  generateKeyPairSync,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = "apps/desktop/packaging/release-identity.json";
const EMBEDDED = "apps/desktop/packaging/trust-root.json";
const SIG = ".sig";

export const ROLES = ["root", "release", "bundled", "registry"];
/** Where a signing step reads each online role's secret (§2 "Custody"); the root has no variable —
 * its secrets live only in James's keychain, never a repository, never CI. */
export const SECRET_ENV = {
  release: "VIBEFIELD_RELEASE_SECRET",
  bundled: "VIBEFIELD_BUNDLED_INDEX_SECRET",
  registry: "VIBEFIELD_REGISTRY_SECRET",
};
const SPKI_HEADER = Buffer.from("302a300506032b6570032100", "hex");
const DAY_MS = 86_400_000;

class TrustError extends Error {}
const fail = (message) => {
  throw new TrustError(message);
};

// --- keys ------------------------------------------------------------------------------------------

/** true when `value` is an Ed25519 public key in the kit's encoding — and only then (a PKCS#8 secret,
 * an X25519 key or a truncated string is false). */
export function isEd25519Spki(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const der = Buffer.from(value, "base64");
  if (der.length !== 44 || !der.subarray(0, 12).equals(SPKI_HEADER)) return false;
  if (der.toString("base64") !== value) return false;
  try {
    return (
      createPublicKey({ key: der, format: "der", type: "spki" }).asymmetricKeyType === "ed25519"
    );
  } catch {
    return false;
  }
}

export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    secretKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

function privateKeyOf(secret) {
  try {
    const key = createPrivateKey({
      key: Buffer.from(secret.trim(), "base64"),
      format: "der",
      type: "pkcs8",
    });
    if (key.asymmetricKeyType !== "ed25519") fail("the secret is not an Ed25519 key");
    return key;
  } catch (error) {
    if (error instanceof TrustError) throw error;
    return fail("the secret is not a base64 PKCS#8 Ed25519 key");
  }
}

/** The public half of a secret, in the kit's encoding. */
export function publicKeyOf(secret) {
  return createPublicKey(privateKeyOf(secret))
    .export({ type: "spki", format: "der" })
    .toString("base64");
}

export function signBytes(bytes, secret) {
  return edSign(null, bytes, privateKeyOf(secret)).toString("base64");
}

/** Never throws: a malformed key or signature is simply not a verification. */
export function verifyBytes(bytes, signature, publicKey) {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return edVerify(null, bytes, key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// --- the document --------------------------------------------------------------------------------

/** The kit's canonicalJson for plain JSON: keys sorted recursively, 2-space indent, trailing newline. */
export function canonicalJson(value) {
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** The problems with a trust-root document, in words — the builtins mirror of contracts' `TrustRoot`
 * (empty = well-formed). */
export function trustRootProblems(doc) {
  const problems = [];
  if (doc === null || typeof doc !== "object") return ["not a JSON object"];
  if (doc.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (!Number.isInteger(doc.version) || doc.version < 1)
    problems.push("version must be a positive integer");
  if (
    typeof doc.expires !== "string" ||
    !Number.isFinite(Date.parse(doc.expires)) ||
    !/Z$/.test(doc.expires)
  )
    problems.push("expires must be an ISO 8601 UTC instant");
  const owners = new Map();
  for (const role of ROLES) {
    const set = role === "root" ? doc.root : doc.roles?.[role];
    if (set === undefined || set === null || typeof set !== "object") {
      problems.push(`${role}: missing`);
      continue;
    }
    const keys = Array.isArray(set.keys) ? set.keys : [];
    if (keys.length === 0) problems.push(`${role}: names no key`);
    if (!Number.isInteger(set.threshold) || set.threshold < 1)
      problems.push(`${role}: threshold must be ≥ 1`);
    else if (set.threshold > keys.length)
      problems.push(
        `${role}: a threshold of ${set.threshold} cannot be met by ${keys.length} key(s)`,
      );
    for (const key of keys) {
      if (!isEd25519Spki(key))
        problems.push(`${role}: ${String(key).slice(0, 16)}… is not an Ed25519 public key`);
      const owner = owners.get(key);
      if (owner === role) problems.push(`${role}: a key is listed twice`);
      else if (owner !== undefined)
        problems.push(`${role}: a key is also a key of ${owner} — every key belongs to one role`);
      else owners.set(key, role);
    }
  }
  if (doc.root?.keys?.length < 2) problems.push("root: TD-1's root is two keys");
  return problems;
}

/** Assemble a document from public keys. `previous` (an older document) sets the version to one more. */
export function assembleTrustRoot({
  root,
  release,
  bundled,
  registry,
  version,
  previous = null,
  expiresDays = 180,
  rootThreshold = 1,
  now = Date.now(),
}) {
  const nextVersion = version ?? (previous === null ? 1 : previous.version + 1);
  if (previous !== null && nextVersion <= previous.version)
    fail(`version ${nextVersion} is not above the previous document's ${previous.version}`);
  const expires = new Date(now + expiresDays * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const doc = {
    schemaVersion: 1,
    version: nextVersion,
    expires,
    root: { threshold: rootThreshold, keys: root },
    roles: {
      release: { threshold: 1, keys: release },
      bundled: { threshold: 1, keys: bundled },
      registry: { threshold: 1, keys: registry },
    },
  };
  const problems = trustRootProblems(doc);
  if (problems.length > 0) fail(`the document would not be well-formed: ${problems.join("; ")}`);
  return doc;
}

/** Add one signature line for a ROOT key of `docBytes`' document to the existing signature text. */
export function signTrustRoot(docBytes, sigText, secret) {
  const doc = JSON.parse(docBytes.toString("utf8"));
  const problems = trustRootProblems(doc);
  if (problems.length > 0) fail(`refusing to sign a malformed document: ${problems.join("; ")}`);
  if (docBytes.toString("utf8") !== canonicalJson(doc))
    fail("refusing to sign: the document is not in canonical form (assemble writes it so)");
  const pub = publicKeyOf(secret);
  if (!doc.root.keys.includes(pub))
    fail("this key is not a root key of the document — only the root signs it");
  const lines = signatureLines(sigText);
  if (lines.some((line) => verifyBytes(docBytes, line, pub)))
    fail("the document is already signed by this key");
  return [...lines, signBytes(docBytes, secret)].map((line) => `${line}\n`).join("");
}

export function signatureLines(sigText) {
  return (sigText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Verify a trust-root against the root a client ALREADY trusts (`trusted` = {keys, threshold, version}),
 * or — bootstrap, the first embedding — against the document's own root. Returns {ok, reasons, signers}. */
export function verifyTrustRoot(docBytes, sigText, { trusted = null, now = Date.now() } = {}) {
  const reasons = [];
  let doc;
  try {
    doc = JSON.parse(docBytes.toString("utf8"));
  } catch {
    return { ok: false, reasons: ["the document is not JSON"], signers: [] };
  }
  reasons.push(...trustRootProblems(doc));
  const anchor = trusted ?? {
    keys: doc.root?.keys ?? [],
    threshold: doc.root?.threshold ?? 1,
    version: null,
  };
  const lines = signatureLines(sigText);
  const signers = anchor.keys.filter((key) =>
    lines.some((line) => verifyBytes(docBytes, line, key)),
  );
  if (signers.length < anchor.threshold)
    reasons.push(
      `${signers.length} of the trusted root's keys signed it; ${anchor.threshold} must (${lines.length} signature line(s))`,
    );
  if (anchor.version !== null && Number.isInteger(doc.version) && doc.version <= anchor.version)
    reasons.push(
      `version ${doc.version} is not above the trusted document's ${anchor.version} (a rollback or a replay)`,
    );
  if (typeof doc.expires === "string" && Date.parse(doc.expires) <= now)
    reasons.push(`expired at ${doc.expires}`);
  return { ok: reasons.length === 0, reasons, signers, doc };
}

/** TD-1's embedding: the verified document and its signatures beside the packaging config, and the
 * ledger's `trustRootKeys` frozen to its root keys under a revision bump (the identity checker then
 * holds the two equal). A second embedding is a ROTATION and must be verified against the first. */
export function embedTrustRoot(
  repoRoot,
  docBytes,
  sigText,
  { trustedDoc = null, now = Date.now() } = {},
) {
  const ledgerPath = join(repoRoot, LEDGER);
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const field = ledger.fields?.trustRootKeys;
  if (field === undefined) fail(`${LEDGER} declares no trustRootKeys field`);
  if (field.status === "frozen" && trustedDoc === null)
    fail(
      "trustRootKeys is already frozen — a new document is a rotation: pass --trust-doc <the embedded one>",
    );
  const trusted =
    trustedDoc === null
      ? null
      : {
          keys: trustedDoc.root.keys,
          threshold: trustedDoc.root.threshold,
          version: trustedDoc.version,
        };
  const verdict = verifyTrustRoot(docBytes, sigText, { trusted, now });
  if (!verdict.ok) fail(`refusing to embed: ${verdict.reasons.join("; ")}`);
  writeFileSync(join(repoRoot, EMBEDDED), docBytes);
  writeFileSync(
    join(repoRoot, EMBEDDED + SIG),
    signatureLines(sigText)
      .map((l) => `${l}\n`)
      .join(""),
  );
  ledger.fields.trustRootKeys = {
    status: "frozen",
    value: verdict.doc.root.keys,
    format: "ed25519-spki-base64[]",
    note: `Frozen ${new Date(now).toISOString().slice(0, 10)} (TD-1): the root public keys of trust-root v${verdict.doc.version}, embedded as ${EMBEDDED}; the checker holds the two equal. Public keys only — the root secrets live in James's keychain, never here.`,
  };
  ledger.identityRevision += 1;
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return {
    version: verdict.doc.version,
    identityRevision: ledger.identityRevision,
    signers: verdict.signers,
  };
}

// --- files ---------------------------------------------------------------------------------------

/** true when `path` would land inside this repository (its parent resolved through symlinks, so a
 * link into the checkout is caught too). */
function insideRepo(path) {
  let parent = dirname(resolve(path));
  try {
    parent = realpathSync(parent);
  } catch {
    // not created yet: compare it as written
  }
  const rel = relative(realpathSync(REPO_ROOT), parent);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Write a NEW file; an existing one is never replaced (`wx`). */
function writeNew(path, text, mode = 0o644) {
  try {
    writeFileSync(path, text, { flag: "wx", mode });
  } catch (error) {
    if (error.code === "EEXIST") fail(`${path} exists — refusing to overwrite a key or a document`);
    throw error;
  }
}

function readPublicKey(path) {
  const value = readFileSync(path, "utf8").trim();
  if (!isEd25519Spki(value)) fail(`${path} does not hold an Ed25519 public key (base64 SPKI DER)`);
  return value;
}

/** keygen: one keypair. The public half to `<out>/<name>.pub`; the secret printed once to a terminal,
 * or to `secretOut` (0600, never in the repository). Refuses BEFORE generating when it could not keep
 * the secret safely — a public key with no secret saved would be an orphan. */
export function keygen({ role, name, out, secretOut = null, stdoutIsTTY, print = console.log }) {
  if (!ROLES.includes(role)) fail(`--role must be one of ${ROLES.join(", ")}`);
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name ?? ""))
    fail("--name must be a short lowercase name (root-a, release-1)");
  if (!out) fail("--out <dir> names where the public key goes");
  if (secretOut === null && !stdoutIsTTY)
    fail(
      "refusing to print a secret where it could be captured (stdout is not a terminal) — run this in your own terminal, or pass --secret-out <file outside the repository>",
    );
  if (secretOut !== null && insideRepo(secretOut))
    fail("refusing to write a secret inside the repository");
  mkdirSync(out, { recursive: true });
  const pubPath = join(out, `${name}.pub`);
  if (existsSync(pubPath)) fail(`${pubPath} exists — refusing to overwrite a key`);
  if (secretOut !== null && existsSync(secretOut))
    fail(`${secretOut} exists — refusing to overwrite a secret`);
  const pair = generateKeypair();
  if (secretOut !== null) writeNew(secretOut, `${pair.secretKey}\n`, 0o600);
  writeNew(pubPath, `${pair.publicKey}\n`);
  print(`trust-keygen: a ${role} key, ${name}`);
  print(`  public  ${pair.publicKey}`);
  print(`          → ${pubPath}`);
  if (secretOut !== null) print(`  secret  → ${secretOut} (0600)`);
  else {
    print(`  SECRET  ${pair.secretKey}`);
    print("  Store the SECRET now — it is written nowhere and will not be shown again:");
    print(`    security add-generic-password -a vibefield -s vibefield-trust-${name} -w`);
    print("    (paste it at the prompt; the keychain holds it, the shell's history does not)");
  }
  if (role !== "root")
    print(
      `  A signing step reads it from ${SECRET_ENV[role]} (the release-signing environment, or your shell).`,
    );
  return pair.publicKey;
}

// --- self-test: every refusal proven, in a temporary directory, with keys that never leave it ------

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "vf-trust-keygen-"));
  let failures = 0;
  const check = (name, fn) => {
    let ok;
    try {
      ok = fn() === true;
    } catch (error) {
      ok = false;
      console.log(`       threw: ${error.message}`);
    }
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  };
  const refuses = (fn, words) => {
    try {
      fn();
      return false;
    } catch (error) {
      return error instanceof TrustError && error.message.includes(words);
    }
  };
  const quiet = () => {};
  try {
    const now = Date.parse("2026-10-14T00:00:00Z");
    const keys = {};
    for (const [role, name] of [
      ["root", "root-a"],
      ["root", "root-b"],
      ["root", "root-c"],
      ["release", "release-1"],
      ["bundled", "bundled-1"],
      ["registry", "registry-1"],
    ]) {
      keys[name] = keygen({
        role,
        name,
        out: join(dir, "pub"),
        secretOut: join(dir, `${name}.secret`),
        stdoutIsTTY: false,
        print: quiet,
      });
    }
    const secret = (name) => readFileSync(join(dir, `${name}.secret`), "utf8");

    check("keygen refuses to print a secret when stdout is not a terminal", () =>
      refuses(
        () =>
          keygen({
            role: "release",
            name: "x",
            out: join(dir, "pub"),
            stdoutIsTTY: false,
            print: quiet,
          }),
        "not a terminal",
      ),
    );
    check("keygen refuses to overwrite a public key", () =>
      refuses(
        () =>
          keygen({
            role: "root",
            name: "root-a",
            out: join(dir, "pub"),
            secretOut: join(dir, "other.secret"),
            stdoutIsTTY: true,
            print: quiet,
          }),
        "refusing to overwrite",
      ),
    );
    check("keygen refuses to write a secret inside the repository", () =>
      refuses(
        () =>
          keygen({
            role: "root",
            name: "root-z",
            out: join(dir, "pub"),
            secretOut: join(REPO_ROOT, "leak.secret"),
            stdoutIsTTY: false,
            print: quiet,
          }),
        "inside the repository",
      ),
    );
    check(
      "a secret file is 0600 and its public half is the .pub",
      () =>
        (statSync(join(dir, "root-a.secret")).mode & 0o777) === 0o600 &&
        publicKeyOf(secret("root-a")) === keys["root-a"],
    );
    check(
      "a PKCS#8 secret is never an Ed25519 public key",
      () => !isEd25519Spki(secret("root-a").trim()),
    );

    const doc1 = assembleTrustRoot({
      root: [keys["root-a"], keys["root-b"]],
      release: [keys["release-1"]],
      bundled: [keys["bundled-1"]],
      registry: [keys["registry-1"]],
      now,
    });
    const bytes1 = Buffer.from(canonicalJson(doc1));
    check(
      "assemble writes version 1 expiring 180 days on",
      () => doc1.version === 1 && doc1.expires === "2027-04-12T00:00:00Z",
    );
    check("assemble refuses a key shared by two roles", () =>
      refuses(
        () =>
          assembleTrustRoot({
            root: [keys["root-a"], keys["root-b"]],
            release: [keys["root-a"]],
            bundled: [keys["bundled-1"]],
            registry: [keys["registry-1"]],
            now,
          }),
        "every key belongs to one role",
      ),
    );
    check("assemble refuses a single root key (TD-1 is two)", () =>
      refuses(
        () =>
          assembleTrustRoot({
            root: [keys["root-a"]],
            release: [keys["release-1"]],
            bundled: [keys["bundled-1"]],
            registry: [keys["registry-1"]],
            now,
          }),
        "two keys",
      ),
    );
    check("assemble refuses a threshold the keys cannot meet", () =>
      refuses(
        () =>
          assembleTrustRoot({
            root: [keys["root-a"], keys["root-b"]],
            release: [keys["release-1"]],
            bundled: [keys["bundled-1"]],
            registry: [keys["registry-1"]],
            rootThreshold: 3,
            now,
          }),
        "cannot be met",
      ),
    );

    const sig1 = signTrustRoot(bytes1, "", secret("root-a"));
    check(
      "a root key signs, and the document verifies on its own root (bootstrap)",
      () => verifyTrustRoot(bytes1, sig1, { now }).ok,
    );
    check("an online role's key cannot sign the trust-root", () =>
      refuses(() => signTrustRoot(bytes1, "", secret("release-1")), "only the root signs"),
    );
    check("the same root key cannot sign twice", () =>
      refuses(() => signTrustRoot(bytes1, sig1, secret("root-a")), "already signed"),
    );
    check("a document changed by one byte no longer verifies", () => {
      const tampered = Buffer.from(bytes1);
      tampered[tampered.length - 3] ^= 1;
      return !verifyTrustRoot(tampered, sig1, { now }).ok;
    });
    check("an expired document is refused, in words", () =>
      verifyTrustRoot(bytes1, sig1, { now: now + 181 * DAY_MS }).reasons.some((r) =>
        r.startsWith("expired"),
      ),
    );
    check("an unsigned document is refused", () => !verifyTrustRoot(bytes1, "", { now }).ok);

    // Rotation (§2): v2 drops root-b for root-c, signed by an OLD root key and the NEW one; a client
    // holding v1 accepts it, and one holding v1 refuses a v2 signed by the new key alone.
    const doc2 = assembleTrustRoot({
      root: [keys["root-a"], keys["root-c"]],
      release: [keys["release-1"]],
      bundled: [keys["bundled-1"]],
      registry: [keys["registry-1"]],
      previous: doc1,
      now,
    });
    const bytes2 = Buffer.from(canonicalJson(doc2));
    const trusted1 = {
      keys: doc1.root.keys,
      threshold: doc1.root.threshold,
      version: doc1.version,
    };
    const sig2 = signTrustRoot(
      bytes2,
      signTrustRoot(bytes2, "", secret("root-c")),
      secret("root-a"),
    );
    check(
      "a rotation signed by an old and a new root key verifies against the old root",
      () => verifyTrustRoot(bytes2, sig2, { trusted: trusted1, now }).ok && doc2.version === 2,
    );
    check(
      "a rotation signed by the new key alone is refused by the old root",
      () =>
        !verifyTrustRoot(bytes2, signTrustRoot(bytes2, "", secret("root-c")), {
          trusted: trusted1,
          now,
        }).ok,
    );
    check("an older or equal version against the trusted one is refused (rollback)", () =>
      verifyTrustRoot(bytes1, sig1, { trusted: trusted1, now }).reasons.some((r) =>
        r.includes("rollback"),
      ),
    );
    check("a non-canonical document is refused at signing", () =>
      refuses(
        () => signTrustRoot(Buffer.from(JSON.stringify(doc1)), "", secret("root-a")),
        "canonical",
      ),
    );

    // embed into a scratch repository carrying a copy of the ledger with the field still a blocker
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "apps/desktop/packaging"), { recursive: true });
    copyFileSync(join(REPO_ROOT, LEDGER), join(repo, LEDGER));
    const before = JSON.parse(readFileSync(join(repo, LEDGER), "utf8"));
    check(
      "the ledger's trustRootKeys starts as a TD-1 blocker",
      () =>
        before.fields.trustRootKeys?.status === "blocker" &&
        before.fields.trustRootKeys.value === null,
    );
    const embedded = embedTrustRoot(repo, bytes1, sig1, { now });
    const after = JSON.parse(readFileSync(join(repo, LEDGER), "utf8"));
    check(
      "embed freezes trustRootKeys to the root keys and bumps identityRevision",
      () =>
        after.fields.trustRootKeys.status === "frozen" &&
        JSON.stringify(after.fields.trustRootKeys.value) === JSON.stringify(doc1.root.keys) &&
        after.identityRevision === before.identityRevision + 1 &&
        embedded.version === 1 &&
        readFileSync(join(repo, EMBEDDED)).equals(bytes1),
    );
    check("a second embedding without the first as its trust is refused", () =>
      refuses(() => embedTrustRoot(repo, bytes2, sig2, { now }), "rotation"),
    );
    check(
      "a rotation embeds against the embedded document",
      () => embedTrustRoot(repo, bytes2, sig2, { trustedDoc: doc1, now }).version === 2,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures > 0) {
    console.error(`trust-keygen self-test: ${failures} rule(s) did not behave as specified`);
    process.exit(1);
  }
  console.log("trust-keygen self-test OK");
}

// --- CLI -----------------------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  const repeated = new Set(["root", "release", "bundled", "registry", "trust"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    const takesValue = !["key-stdin", "self-test"].includes(name);
    const value = takesValue ? argv[++i] : true;
    if (takesValue && (value === undefined || value.startsWith("--")))
      fail(`--${name} needs a value`);
    if (repeated.has(name)) {
      flags[name] ??= [];
      flags[name].push(value);
    } else if (name in flags) fail(`--${name} given twice`);
    else flags[name] = value;
  }
  return flags;
}

function readSecret(flags) {
  if (flags["key-stdin"] === true) {
    const secret = readFileSync(0, "utf8").trim();
    if (secret.length === 0) fail("--key-stdin read nothing");
    return secret;
  }
  if (typeof flags["key-env"] === "string") {
    const secret = process.env[flags["key-env"]];
    if (!secret) fail(`${flags["key-env"]} is not set in this shell`);
    return secret;
  }
  return fail("name the secret with --key-stdin or --key-env NAME — never on the command line");
}

function readTrusted(flags, doc) {
  if (typeof flags["trust-doc"] === "string") {
    const older = JSON.parse(readFileSync(flags["trust-doc"], "utf8"));
    return { keys: older.root.keys, threshold: older.root.threshold, version: older.version };
  }
  if (Array.isArray(flags.trust))
    return {
      keys: flags.trust.map(readPublicKey),
      threshold: doc.root?.threshold ?? 1,
      version: null,
    };
  return null;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const [command, ...rest] = argv;
  const flags = parseArgs(rest);
  if (command === "keygen") {
    keygen({
      role: flags.role,
      name: flags.name,
      out: flags.out,
      secretOut: flags["secret-out"] ?? null,
      stdoutIsTTY: process.stdout.isTTY === true,
    });
    return;
  }
  if (command === "assemble") {
    if (!flags.out) fail("--out <trust-root.json> names the document");
    const doc = assembleTrustRoot({
      root: (flags.root ?? []).map(readPublicKey),
      release: (flags.release ?? []).map(readPublicKey),
      bundled: (flags.bundled ?? []).map(readPublicKey),
      registry: (flags.registry ?? []).map(readPublicKey),
      version: flags.version === undefined ? undefined : Number(flags.version),
      previous: flags.previous ? JSON.parse(readFileSync(flags.previous, "utf8")) : null,
      expiresDays: flags["expires-days"] === undefined ? 180 : Number(flags["expires-days"]),
    });
    writeNew(flags.out, canonicalJson(doc));
    console.log(`trust-keygen: trust-root v${doc.version}, expires ${doc.expires} → ${flags.out}`);
    console.log(
      `  next: sign it with a root key — ... | node scripts/trust-keygen.mjs sign --doc ${flags.out} --key-stdin`,
    );
    return;
  }
  if (command === "sign") {
    if (!flags.doc) fail("--doc <trust-root.json> names the document");
    const sigPath = flags.doc + SIG;
    const before = existsSync(sigPath) ? readFileSync(sigPath, "utf8") : "";
    const after = signTrustRoot(readFileSync(flags.doc), before, readSecret(flags));
    writeFileSync(sigPath, after);
    console.log(
      `trust-keygen: signed — ${signatureLines(after).length} signature line(s) in ${sigPath}`,
    );
    return;
  }
  if (command === "verify" || command === "embed") {
    if (!flags.doc) fail("--doc <trust-root.json> names the document");
    const bytes = readFileSync(flags.doc);
    const sigText = existsSync(flags.doc + SIG) ? readFileSync(flags.doc + SIG, "utf8") : "";
    if (command === "embed") {
      const trustedDoc = flags["trust-doc"]
        ? JSON.parse(readFileSync(flags["trust-doc"], "utf8"))
        : null;
      const done = embedTrustRoot(REPO_ROOT, bytes, sigText, { trustedDoc });
      console.log(
        `trust-keygen: embedded trust-root v${done.version} as ${EMBEDDED}; ${LEDGER} trustRootKeys frozen, identityRevision ${done.identityRevision}`,
      );
      return;
    }
    const trusted = readTrusted(flags, JSON.parse(bytes.toString("utf8")));
    const verdict = verifyTrustRoot(bytes, sigText, { trusted });
    if (trusted === null)
      console.log("trust-keygen: trusting the document's own root keys (bootstrap)");
    if (!verdict.ok) {
      for (const reason of verdict.reasons) console.error(`trust-keygen FAIL: ${reason}`);
      process.exit(1);
    }
    console.log(
      `trust-keygen: trust-root v${verdict.doc.version} verifies — ${verdict.signers.length} root signature(s), expires ${verdict.doc.expires}`,
    );
    return;
  }
  fail("usage: node scripts/trust-keygen.mjs <keygen|assemble|sign|verify|embed> … | --self-test");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof TrustError)) throw error;
    console.error(`trust-keygen: ${error.message}`);
    process.exit(2);
  }
}
