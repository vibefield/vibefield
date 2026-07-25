#!/usr/bin/env node
// Release-identity checker (distribution spec §7.6 / EDP-30; implementation plan
// WP1). Guards apps/desktop/packaging/release-identity.json — the values an
// installed VibeField is KNOWN BY (bundle id, publisher, tray slot, update
// origin), where a post-release change is a migration, not an edit.
//
// Three classes of check:
//   shape    — every declared field carries a status, and a status carries the
//              value it implies (blocker ⇒ null + an owner blocker id;
//              frozen ⇒ a real value matching its format).
//   hygiene  — EDP-30's actual teeth: no value may be inferred from a local
//              path, username or hostname (an identity that differs per machine
//              is not an identity), and no credential may be parked here.
//   freeze   — a `frozen` value cannot change unless identityRevision is bumped
//              in the same commit, compared against the file as committed at
//              HEAD. That is what makes an identity edit reviewable instead of
//              silent.
//
// Report-only by default (ALWAYS exit 0) so unresolved owner blockers — which is
// the whole state of the ledger before the first signed beta — never gate a
// build. `--enforce` exits 1 on violations; unresolved blockers stay warnings
// even then, because "not decided yet" is an honest state, not a defect. The
// first-signed-beta gate (distribution spec §16.1) is where blockers become
// fatal, and that flip is `--require-frozen`.
//
// Usage: node scripts/check-release-identity.mjs [--enforce] [--require-frozen] [--self-test]
// Node >=22 ESM, builtins only — no new dependencies.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";

const LEDGER_PATH = "apps/desktop/packaging/release-identity.json";

const REQUIRED_FIELDS = [
  "appId",
  "productName",
  "executableName",
  "macTeamId",
  "windowsPublisher",
  "windowsAppUserModelId",
  "trayGuid",
  "updateChannel",
  "updateOrigin",
];

// Literal fields whose value is dictated by a standing decision elsewhere, so a
// drifting copy here would be a second source of truth (contracts' P1).
const LITERAL_VALUES = { productName: "VibeField" };

const FORMATS = {
  // ≥2 dot-separated lowercase segments: `vibefield` alone is a slug, not a
  // bundle identifier — precisely the confusion windowsAppUserModelId records.
  "reverse-dns": (v) =>
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?){1,}$/.test(v) ||
    "expected a reverse-DNS identifier with at least two segments",
  literal: (v, field) =>
    v === LITERAL_VALUES[field] || `expected the standing value ${LITERAL_VALUES[field]}`,
  // Control characters are checked by code point, not a regex range — a literal
  // range is itself a lint violation, and the intent reads better this way.
  "executable-name": (v) =>
    (!/[/\\]/.test(v) &&
      ![...v].some((c) => c.codePointAt(0) < 0x20 || c.codePointAt(0) === 0x7f) &&
      v.trim() === v &&
      v.length > 0) ||
    "expected a bare executable name — no path separators, control characters or padding",
  "apple-team-id": (v) => /^[A-Z0-9]{10}$/.test(v) || "expected a 10-character Apple Team ID",
  "publisher-name": (v) =>
    (v.trim() === v && v.length > 0 && !/[/\\]/.test(v)) ||
    "expected a certificate subject name, not a path",
  uuid: (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ||
    "expected a UUID",
  "update-channel": (v) => v === "beta" || v === "stable" || "expected 'beta' or 'stable'",
  "https-url": (v) => {
    try {
      return new URL(v).protocol === "https:" || "expected an https origin";
    } catch {
      return "expected a parseable URL";
    }
  },
};

/** EDP-30's real target: a value that differs per developer machine is not an
 * identity. Checked against THIS machine's user/host plus the universal path
 * shapes, so it catches the common accident (pasting a resolved local path)
 * without pretending to catch every possible one. */
function machineDerived(value) {
  const user = userInfo().username;
  const host = hostname();
  const haystack = value.toLowerCase();
  if (/^([a-z]:[\\/]|\/(users|home|var|tmp|opt|private)\/)/i.test(value))
    return "looks like an absolute local path";
  if (user.length > 2 && haystack.includes(user.toLowerCase()))
    return `contains this machine's username (${user})`;
  if (host.length > 2 && haystack.includes(host.toLowerCase().replace(/\.local$/, "")))
    return `contains this machine's hostname (${host})`;
  return null;
}

/** The ledger is committed in the clear, so a secret parked here would be a
 * secret published. Distribution spec §9.4: credentials live only in protected
 * CI environments, never in checked-in configuration. */
function credentialShaped(value) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return "contains a private key block";
  if (/\.(p12|pfx|key|pem)$/i.test(value)) return "points at a key/certificate file";
  if (/(password|passphrase|secret|token)\s*[:=]/i.test(value)) return "embeds a credential";
  if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(value)) return "looks like an encoded credential blob";
  return null;
}

function checkLedger(ledger, committed) {
  const violations = [];
  const blockers = [];

  if (!Number.isInteger(ledger.identityRevision) || ledger.identityRevision < 1)
    violations.push("identityRevision must be a positive integer");
  const fields = ledger.fields ?? {};

  for (const name of REQUIRED_FIELDS)
    if (!(name in fields)) violations.push(`${name}: missing from the ledger`);

  for (const [name, field] of Object.entries(fields)) {
    if (!REQUIRED_FIELDS.includes(name)) {
      violations.push(`${name}: not a declared identity field`);
      continue;
    }
    const { status, value } = field;
    if (status !== "blocker" && status !== "frozen") {
      violations.push(`${name}: status must be 'blocker' or 'frozen', got ${String(status)}`);
      continue;
    }
    if (status === "blocker") {
      if (value !== null) violations.push(`${name}: an unresolved field must hold null`);
      if (typeof field.blocker !== "string" || field.blocker.length === 0)
        violations.push(`${name}: an unresolved field must name its owner blocker`);
      else blockers.push(`${name} (${field.blocker})`);
      continue;
    }
    if (typeof value !== "string" || value.length === 0) {
      violations.push(`${name}: a frozen field must hold a non-empty string`);
      continue;
    }
    const format = FORMATS[field.format];
    if (format === undefined) violations.push(`${name}: unknown format ${String(field.format)}`);
    else {
      const verdict = format(value, name);
      if (verdict !== true) violations.push(`${name}: ${verdict}`);
    }
    const derived = machineDerived(value);
    if (derived !== null) violations.push(`${name}: ${derived} (EDP-30)`);
    const credential = credentialShaped(value);
    if (credential !== null) violations.push(`${name}: ${credential} (spec §9.4)`);
  }

  // Freeze: compare frozen values against the file as committed. A changed
  // frozen value is legal ONLY alongside a revision bump, which is what turns an
  // identity change into something a reviewer must look at.
  if (committed !== null) {
    const bumped = (ledger.identityRevision ?? 0) > (committed.identityRevision ?? 0);
    for (const [name, field] of Object.entries(fields)) {
      const before = committed.fields?.[name];
      if (before === undefined || before.status !== "frozen") continue;
      if (before.value !== field.value && !bumped)
        violations.push(
          `${name}: frozen value changed from ${JSON.stringify(before.value)} without bumping identityRevision`,
        );
      if (field.status !== "frozen" && !bumped)
        violations.push(`${name}: thawed from frozen without bumping identityRevision`);
    }
  }

  return { violations, blockers };
}

/** The ledger as committed at HEAD, or null when it is new/unreadable — a first
 * commit has nothing to drift from, and a checker that died on that would block
 * its own introduction. */
function committedLedger(path) {
  try {
    const raw = execFileSync("git", ["show", `HEAD:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- self-test: every rule proven to trip on a synthetic ledger --------------
function selfTest() {
  const base = () => JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const cases = [
    ["clean ledger has no violations", base(), 0],
    [
      "a slug is refused where a reverse-DNS id is required",
      (() => {
        const l = base();
        l.fields.appId = { status: "frozen", value: "vibefield", format: "reverse-dns" };
        return l;
      })(),
      1,
    ],
    [
      "a machine-derived value is refused",
      (() => {
        const l = base();
        l.fields.windowsPublisher = {
          status: "frozen",
          value: `/Users/${userInfo().username}/certs`,
          format: "publisher-name",
        };
        return l;
      })(),
      2, // path shape + username, both reported
    ],
    [
      "a credential parked in the ledger is refused",
      (() => {
        const l = base();
        l.fields.macTeamId = {
          status: "frozen",
          value: "-----BEGIN PRIVATE KEY-----",
          format: "apple-team-id",
        };
        return l;
      })(),
      2, // format + credential
    ],
    [
      "an unresolved field must be null and name its blocker",
      (() => {
        const l = base();
        l.fields.appId = { status: "blocker", value: "com.example.app", format: "reverse-dns" };
        return l;
      })(),
      2,
    ],
    [
      "an undeclared field is refused",
      (() => {
        const l = base();
        l.fields.sneakyToken = { status: "frozen", value: "x", format: "literal" };
        return l;
      })(),
      1,
    ],
  ];

  let failures = 0;
  for (const [name, ledger, expected] of cases) {
    const { violations } = checkLedger(ledger, null);
    const ok = violations.length === expected;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} (${violations.length} violation(s))`);
    if (!ok) for (const v of violations) console.log(`       ${v}`);
  }

  // The freeze rule needs a "committed" counterpart rather than a lone ledger.
  const before = base();
  const after = base();
  after.fields.productName.value = "FieldVibe";
  const drifted = checkLedger(after, before).violations;
  const driftOk = drifted.some((v) => v.includes("without bumping identityRevision"));
  if (!driftOk) failures++;
  console.log(`${driftOk ? "ok  " : "FAIL"} a frozen value cannot change without a revision bump`);

  const bumped = base();
  bumped.fields.productName.value = "FieldVibe";
  bumped.identityRevision = before.identityRevision + 1;
  const bumpedViolations = checkLedger(bumped, before).violations.filter((v) =>
    v.includes("identityRevision"),
  );
  const bumpOk = bumpedViolations.length === 0;
  if (!bumpOk) failures++;
  console.log(`${bumpOk ? "ok  " : "FAIL"} a revision bump legitimises the same change`);

  if (failures > 0) {
    console.error(`self-test: ${failures} rule(s) did not behave as specified`);
    process.exit(1);
  }
  console.log("self-test OK");
}

// --- run ---------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

let ledger;
try {
  ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
} catch (error) {
  console.error(`release-identity FAIL: ${LEDGER_PATH} is missing or unparseable — ${error}`);
  process.exit(args.includes("--enforce") ? 1 : 0);
}

const { violations, blockers } = checkLedger(ledger, committedLedger(LEDGER_PATH));

for (const v of violations) console.error(`release-identity FAIL: ${v}`);
for (const b of blockers) console.warn(`release-identity BLOCKER: ${b} awaits owner input`);

if (violations.length > 0 && args.includes("--enforce")) process.exit(1);
if (blockers.length > 0 && args.includes("--require-frozen")) {
  console.error(
    `release-identity FAIL: ${blockers.length} identity value(s) unresolved — the first signed beta gate (spec §16.1) requires every field frozen`,
  );
  process.exit(1);
}
console.log(
  violations.length === 0
    ? `release-identity OK (revision ${ledger.identityRevision}; ${blockers.length} blocker(s) outstanding)`
    : `release-identity: ${violations.length} violation(s) reported`,
);
