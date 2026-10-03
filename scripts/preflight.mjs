#!/usr/bin/env node
// Environment preflight: tool versions + the import-boundary walls. Hard-fails
// on missing pieces, warns on version drift. Run: `pnpm preflight`.
//
// AR-0 sibling mode (2026-09-12): puppeteer and rosetta are consumed as SIBLING
// CHECKOUTS pinned by revision in siblings.lock.json (the truffle-era machinery
// of cb652e0a, retired 7fcdfd2c when truffle graduated to a registry pin, revived
// for two siblings). scripts/siblings.mjs is the one reader of that lock; this
// file verifies what it says against the checkouts and against the overrides
// block. A path dependency without a SHA pin makes verify unreplayable.
//
// RFC 025 petition window (2026-09-16): truffle rejoins them, and the machinery
// it seeded now verifies its own two extra shapes — the cargo [patch.crates-io]
// row (all-or-nothing against the lock, exactly as the npm family rule works)
// and the Go sidecar built beside field-native (missing or stale WARNs; the
// floor reports a missing sidecar as Degraded honestly, so it is not a gate).
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  cargoPatchRows,
  goSidecarState,
  LOCK_FILE,
  linkRow,
  newestSourceMtime,
  patchPath,
  readLock,
  rosettadBinary,
  siblingDir,
  siblingDirty,
  siblingHead,
} from "./siblings.mjs";

const root = resolve(import.meta.dirname, "..");
const problems = [];
const warnings = [];

// --- cargo-typify (contracts gen; gen:check diffs are version-sensitive) -----
const TYPIFY_EXPECTED = "cargo-typify 0.7.0";
try {
  const v = execSync("cargo typify --version", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
  if (v !== TYPIFY_EXPECTED) {
    warnings.push(
      `${v} installed but contracts.rs was generated with ${TYPIFY_EXPECTED} — gen:check may diff spuriously`,
    );
  }
} catch {
  problems.push(
    "cargo-typify not installed (needed by pnpm gen / gen:check): cargo install cargo-typify",
  );
}

// --- EL8 registry pins (the native-floor NF-0 pin event) ---------------------
// Pins are deliberate upgrade events (EL8); drift or deletion fails HERE, not as
// an Arc<Node> type split or a resolver surprise three slices later. Bumping a
// pin means editing the pin AND this table in one commit — that is the ritual.
// GT-4 (2026-08-05): ghosttea-truffle joins the table at the same version as
// ghosttea — it depends on that crate by path upstream, so a split would put two
// ghosttea revisions in one graph. It also carries truffle-core, which is why the
// truffle-core row and ghosttea's must agree with what upstream's own manifest
// names; when they did not, the resolver refused outright (GT-4a) rather than
// silently splitting the Arc<Node> type. That refusal is this table's whole point,
// enforced one layer earlier.
// This table asserts what the manifests SAY. The runtime half — what Node will
// actually RESOLVE — is `pnpm check:deps` (scripts/check-single-copy.mjs), which
// runs beside this in `verify`. Both are needed: an override can read correctly
// and still be inert (pnpm >=10 ignores a `pnpm` key in package.json, which is
// how upstream strata's loro override went silently unapplied for a window).
// @vibecook/ice was absent from this table until 2026-08-16 — the one pin that
// drags loro-crdt AND strata-ecs behind it was the one nothing here checked.
const PIN_EXPECTATIONS = [
  // A REGISTRY pin again since 2026-09-16 (UA-P-X): truffle 0.7.14 shipped RFC
  // 025's login-scoped nodes, so the requirement names a crates.io version
  // rather than the sibling checkout's 0.7.13 that the petition window needed.
  // Cargo.toml's closure note carries what that window was and every place its
  // exit touched.
  { file: "Cargo.toml", re: /^truffle-core\s*=\s*"=0\.7\.14"/m, label: 'truffle-core = "=0.7.14"' },
  // An exact PRERELEASE since DK-3 (0.15.0-desk.N on `next`, DK-D12): anchored to
  // the line's end, so `0.15.0-desk.1` never passes for a later `…desk.10`.
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ice":\s*0\.15\.0-desk\.1\s*$/m,
    label: '"@vibecook/ice": 0.15.0-desk.1',
  },
  { file: "Cargo.toml", re: /^ghosttea\s*=\s*"=0\.12\.0"/m, label: 'ghosttea = "=0.12.0"' },
  // TM-1 (2026-09-14): the ghosttea-truffle row is GONE with the crate — the TSP1
  // adapter left the floor (`thinking-terminal-mesh-cells.md`, TM-D1 ruled T), so
  // there is no second ghosttea consumer to keep in lockstep; the ghosttea row
  // alone carries truffle-core's version agreement now.
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-client":\s*0\.12\.0/,
    label: '"@vibecook/ghosttea-client": 0.12.0',
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-electron":\s*0\.12\.0/,
    label: '"@vibecook/ghosttea-electron": 0.12.0',
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-react":\s*0\.12\.0/,
    label: '"@vibecook/ghosttea-react": 0.12.0',
    package: "@vibecook/ghosttea-react",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-protocol":\s*0\.12\.0/,
    label: '"@vibecook/ghosttea-protocol": 0.12.0',
  },
];
// A petition window's [patch.crates-io] row is part of its pin: without it the
// exact version is a registry version again and the window is quietly shut. That
// expectation was CONDITIONAL on the lock entry precisely so that CLOSING a
// window — delete the entry, delete the row, pin the released version — would
// pass this table rather than fight it, which is what it did on 2026-09-16 when
// truffle 0.7.14 closed the RFC 025 window; no row is pushed here today because
// no lock entry declares a patch. OPENING one has to edit this table, which is
// the ritual the comment above describes.
//
// The NEGATIVE half is deliberately NOT spelled here. The sibling block below
// derives both directions from the lock — every lock patch owes a row, and every
// row owes a lock entry — so a leftover path patch is caught there with the
// revision-pin message that says why, and spelling it twice is how two places
// drift apart. Its registry-mode branch carries the same rule for the one case
// this table could not see anyway: a patch row still standing after the LAST
// lock entry goes (W-D8), when there is no lock left to derive anything from.
for (const { file, re, label, package: packageName } of PIN_EXPECTATIONS) {
  // A co-development window replaces this registry pin with a revision-backed
  // link. The sibling checks below verify the exact path and checkout revision.
  if (
    packageName &&
    Object.values(readLock(root)?.siblings ?? {}).some((entry) => entry.packages?.[packageName])
  ) {
    continue;
  }
  try {
    const text = readFileSync(resolve(root, file), "utf8");
    if (!re.test(text)) problems.push(`EL8 pin missing or drifted in ${file}: expected ${label}`);
  } catch {
    problems.push(`EL8 pin check could not read ${file}`);
  }
}
// --- AR-0 sibling mode: siblings.lock.json vs the checkouts and the overrides ---
// Two siblings, two kinds of consumption. Every lock package must have a `link:`
// row pointing INTO the pinned checkout, and the family rule says all-or-nothing:
// every @vibecook/puppeteer-* or @rosetta/* override is either a lock-backed
// link: row or (registry mode, W-D8) an exact version — a mixed family is the
// drift class a per-line table would miss. Revision drift FAILS with the
// sync-or-repin choice spelled out; a dirty tree only WARNs (co-developing the
// sibling is the normal state — the pin is about the base revision). The
// rosettad binary is a WARN when absent: fieldd reports the agent index
// UNAVAILABLE honestly until `pnpm siblings:build` runs.
{
  const lock = readLock(root);
  let yaml = "";
  try {
    yaml = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
  } catch {
    problems.push("sibling check could not read pnpm-workspace.yaml");
  }
  // Keys and values may be bare, double- or single-quoted (pnpm rewrites the
  // file in its own style when it edits overrides) — match all three.
  const unquote = (s) => s.replace(/^(['"])(.*)\1$/, "$2");
  const declaredPackages = new Set(
    Object.values(lock?.siblings ?? {}).flatMap((entry) => Object.keys(entry.packages ?? {})),
  );
  const family = [...yaml.matchAll(/^\s*['"]?(@[a-z-]+\/[a-z-]+)['"]?:\s*(\S+)/gm)]
    .map(([line, name, value]) => [line, name, unquote(value)])
    .filter(
      ([, name, value]) =>
        /^@vibecook\/puppeteer-|^@rosetta\//.test(name) ||
        declaredPackages.has(name) ||
        value.startsWith("link:"),
    );
  if (lock === null) {
    // Registry mode: no link: row may exist without a lock behind it.
    for (const [, name, value] of family) {
      if (value.startsWith("link:")) {
        problems.push(
          `${name} is a link: override but ${LOCK_FILE} is absent — a path dependency needs a pin (pnpm siblings:pin after declaring the sibling)`,
        );
      }
    }
    // …and no [patch.crates-io] row either, for the same reason and with the
    // same words. The cargo half of the family rule lived only in the sibling
    // branch below until 2026-09-16 (UA-P-X), which left registry mode able to
    // carry an unpinned path patch silently — the exact shape CLAUDE.md forbids
    // ("never leave a path patch unpinned") and the one cb652e0a created this
    // machinery for. Closing the RFC 025 window is what surfaced it: with the
    // last window entry gone the lock still exists here (puppeteer, rosetta), so
    // the branch below still guards this tree — but W-D8 deletes the file, and a
    // rule that stops applying when the last sibling leaves is not a rule.
    for (const [crate, path] of cargoPatchRows(root).rows) {
      problems.push(
        `Cargo.toml patches ${crate}${path === null ? "" : ` with path "${path}"`} but ${LOCK_FILE} is absent — a path patch needs a revision pin (declare the sibling, then \`pnpm siblings:pin\`), never a bare working tree`,
      );
    }
  } else {
    const lockPackages = new Map();
    for (const [name, entry] of Object.entries(lock.siblings)) {
      const dir = siblingDir(root, entry);
      for (const [pkg, packageDir] of Object.entries(entry.packages ?? {})) {
        lockPackages.set(pkg, linkRow(entry, packageDir));
      }
      if (!existsSync(dir)) {
        problems.push(
          `${name} checkout missing at ${dir} — clone it beside this repo and check out ${entry.sha.slice(0, 12)} (${LOCK_FILE})`,
        );
        continue;
      }
      const head = siblingHead(dir);
      if (head === null) {
        warnings.push(`${name}: not a git checkout at ${dir} — revision pin unverifiable`);
      } else if (head !== entry.sha) {
        problems.push(
          `${name} is at ${head.slice(0, 12)} but ${LOCK_FILE} pins ${entry.sha.slice(0, 12)} — ` +
            "sync the sibling to the pin, or accept the new revision deliberately: `pnpm siblings:pin` (EL8)",
        );
      }
      if (siblingDirty(dir) === true) {
        warnings.push(`${name} working tree is dirty — verify runs against unpinned edits`);
      }
    }
    for (const [pkg, expected] of lockPackages) {
      const row = family.find(([, name]) => name === pkg);
      if (row === undefined) {
        problems.push(
          `sibling mode: ${pkg} is in ${LOCK_FILE} but has no override row in pnpm-workspace.yaml (expected ${expected})`,
        );
      } else if (row[2] !== expected) {
        problems.push(
          `sibling mode: ${pkg} override reads ${row[2]} but ${LOCK_FILE} expects ${expected}`,
        );
      }
    }
    for (const [, name, value] of family) {
      if (!lockPackages.has(name)) {
        problems.push(
          `sibling family rule: ${name} (${value}) is not in ${LOCK_FILE} — the family is ALL lock-backed link: rows or ALL exact versions, never mixed`,
        );
      }
    }
    // The CARGO half of the family rule (RFC 025 window). Every crate a lock
    // entry declares under `patch` must have a [patch.crates-io] row naming that
    // exact path, and every row in that section must be backed by such an entry.
    // All-or-nothing for the same reason the npm family is: a path patch with no
    // revision behind it makes a green verify unreplayable (the finding that
    // created this machinery, cb652e0a), and a pin with no patch behind it is a
    // checkout the build never reads while the docs say it does.
    const { rows: patchRows, unreadable } = cargoPatchRows(root);
    for (const line of unreadable) {
      problems.push(
        `Cargo.toml [patch.crates-io] carries a row this checker cannot read (\`${line}\`) — keep one row per line so the pin rule can see it`,
      );
    }
    const lockPatches = new Map();
    for (const [name, entry] of Object.entries(lock.siblings)) {
      for (const [crate, crateDir] of Object.entries(entry.patch ?? {})) {
        lockPatches.set(crate, {
          sibling: name,
          path: patchPath(entry, crateDir),
          manifest: resolve(siblingDir(root, entry), crateDir, "Cargo.toml"),
        });
      }
    }
    for (const [crate, expected] of lockPatches) {
      const row = patchRows.get(crate);
      if (row === undefined) {
        problems.push(
          `sibling mode: ${LOCK_FILE} patches ${crate} from ${expected.sibling} but Cargo.toml has no [patch.crates-io] row for it (expected path = "${expected.path}") — the pin is declared and the build ignores it`,
        );
      } else if (row !== expected.path) {
        problems.push(
          `sibling mode: Cargo.toml patches ${crate} with path "${row}" but ${LOCK_FILE} expects "${expected.path}" — the patched path must be INSIDE the pinned checkout`,
        );
      } else if (!existsSync(expected.manifest)) {
        problems.push(
          `sibling mode: the ${crate} patch path has no manifest at ${expected.manifest} — the crate is not where ${LOCK_FILE} says it is`,
        );
      }
    }
    for (const [crate, path] of patchRows) {
      if (lockPatches.has(crate)) continue;
      problems.push(
        `sibling family rule: Cargo.toml patches ${crate}${path === null ? "" : ` with path "${path}"`} but no ${LOCK_FILE} entry declares it — a path patch needs a revision pin (\`pnpm siblings:pin\`), never a bare working tree`,
      );
    }
    // The SWIFT half of the window. SwiftPM has no [patch.crates-io] and no
    // mirror that can take a worktree, so the override is a path package reached
    // through a SYMLINK whose NAME is the package identity — Package.swift
    // carries the why. Both halves are derived from the lock rather than spelled
    // twice: the link must resolve to the pinned checkout, and the manifest must
    // name it by the path a manifest would use. Without this the Apple plane
    // would be the one plane with no pin at all: a path package writes no
    // revision into Package.resolved, which is why that row's ABSENCE is the
    // window's shape and this entry is where its pin lives.
    for (const [name, entry] of Object.entries(lock.siblings)) {
      if (!entry.swift) continue;
      const dir = siblingDir(root, entry);
      const link = resolve(root, entry.swift.link);
      let target = null;
      try {
        target = realpathSync(link);
      } catch {
        target = null;
      }
      if (target === null) {
        problems.push(
          `sibling mode: ${name}'s SwiftPM identity link is missing or dangling (${entry.swift.link}) — it is what gives the checkout the package identity the manifest names; recreate it pointing at ${dir}`,
        );
      } else if (existsSync(dir) && target !== realpathSync(dir)) {
        problems.push(
          `sibling mode: ${name}'s SwiftPM identity link resolves to ${target} but ${LOCK_FILE} pins the checkout at ${dir}`,
        );
      }
      const manifest = resolve(root, entry.swift.manifest);
      const row = `.package(path: "${relative(dirname(manifest), link)}")`;
      let text = null;
      try {
        text = readFileSync(manifest, "utf8");
      } catch {
        problems.push(
          `sibling mode: could not read ${entry.swift.manifest} (${name}'s SwiftPM window)`,
        );
      }
      if (text !== null && !text.includes(row)) {
        problems.push(
          `sibling mode: ${entry.swift.manifest} does not name the window's path package (expected \`${row}\`) — ${LOCK_FILE} declares a SwiftPM window the manifest does not open`,
        );
      }
    }
    const bin = rosettadBinary(root);
    if (bin !== null) {
      if (bin.path === null) {
        warnings.push(
          `${bin.name}: cargo cannot resolve its target directory — rosettad path unknown`,
        );
      } else if (!existsSync(bin.path)) {
        warnings.push(
          `${bin.name}: rosettad is not built (${bin.path}) — run \`pnpm siblings:build\`; fieldd reports the agent index UNAVAILABLE until then`,
        );
      } else {
        const newest = newestSourceMtime(bin.dir);
        if (newest !== null && statSync(bin.path).mtimeMs < newest) {
          warnings.push(
            `${bin.name}: a Rust source is newer than the built rosettad — run \`pnpm siblings:build\` (a no-op when cargo agrees it is fresh)`,
          );
        }
      }
    }
    // The go sibling's binary: the truffle mesh sidecar, built beside
    // field-native because that is where the floor's resolve_sidecar looks
    // first. WARN, never FAIL: a floor with no sidecar reports the mesh
    // UNAVAILABLE/Degraded honestly (the tolerant-reader law), so a missing one
    // is a degraded dev stack, not a broken tree — and every TS gate runs
    // without it. `go build` keeps no fingerprint of its own, so the source
    // mtimes are the freshness question, as they are for cargo above.
    const { sidecar, state: sidecarState } = goSidecarState(root);
    if (sidecarState === "missing") {
      warnings.push(
        `mesh sidecar not built (${sidecar.path}) — pnpm siblings:build; the floor reports the mesh Degraded until then`,
      );
    } else if (sidecarState === "stale") {
      warnings.push(
        `mesh sidecar stale — pnpm siblings:build (a source in ${sidecar.name}/${sidecar.module} is newer than ${sidecar.path})`,
      );
    }
  }
}

// --- import-boundary self-test (the checker's own fixtures) ------------------
// A rotten rule table makes --enforce meaningless — the 2026-07-23 review found
// the self-test red (stale R4-pending expectations) with nothing running it.
try {
  execSync("node scripts/check-import-boundaries.mjs --self-test", {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
  if (detail) console.error(detail);
  problems.push(
    "import-boundary self-test failed (node scripts/check-import-boundaries.mjs --self-test)",
  );
}

// --- import-boundary walls (spec §8.3; a hard gate since slice 2) ------------
// Enforce mode exits 1 on enforce-true violations. Quiet on success; on failure
// the checker's report (owning rule + file path) is surfaced alongside the
// problem.
try {
  execSync("node scripts/check-import-boundaries.mjs --enforce", {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
  if (detail) console.error(detail);
  problems.push(
    "import-boundary walls failed (node scripts/check-import-boundaries.mjs --enforce)",
  );
}

// --- wall R23: the agent catalog is honoured by the pins (AC-2) --------------
// thinking-ar-agent-catalog.md §4. The walls' shape, the walls' lesson: the
// self-test must pass on its rotten fixtures before a verdict may speak, since a
// broken checker's green is no green — and since AC-7 the checker enforces that
// itself (every mode runs its self-test in-process first and refuses to judge
// while it is red), so one call carries both walls: --enforce proves every
// catalog row against the pinned puppeteer (through fieldd's R20 door) and the
// lock's rosettad; --literals is R23b (no agent id literal in product code).
// Its WARN lines are lifted into this report. The rosetta half WARNs
// UNVERIFIED without a built rosettad (AC-D10) and is REQUIRED in CI — the
// workflow builds the binary and exports FIELDD_ROSETTAD_BIN before this runs,
// which the checker accepts only because it IS the lock's build — as it is at
// `pnpm siblings:pin`, which passes the same flag itself.
{
  const inCi = ["true", "1"].includes(String(process.env.CI ?? "").toLowerCase());
  // The lock's rosettad as this preflight already resolved it above (siblings.mjs
  // caches cargo's answer per process), handed over so the checker does not
  // ask cargo a second time.
  const lockRosettad = rosettadBinary(root)?.path ?? null;
  const args = [
    "--enforce",
    ...(inCi ? ["--require-rosetta"] : []),
    ...(lockRosettad === null ? [] : ["--rosettad", lockRosettad]),
    "--literals",
  ];
  const run = spawnSync(process.execPath, ["scripts/check-agent-catalog.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  for (const line of output.split("\n")) {
    if (line.startsWith("WARN ")) warnings.push(line.slice("WARN ".length));
  }
  if (run.status !== 0) {
    if (output.trim()) console.error(output.trim());
    // A spawn that failed or a checker killed by a signal prints nothing of its
    // own: say which, never a bare red.
    const how =
      run.error !== undefined
        ? `could not run: ${run.error.message}`
        : run.signal !== null
          ? `killed by ${run.signal}`
          : `exit ${run.status}; the report above names the part — the checker's own self-test, the projection, R23 or R23b`;
    problems.push(
      `agent catalog walls R23/R23b failed (node scripts/check-agent-catalog.mjs ${args.join(" ")}) — ${how}`,
    );
  }
}

// --- installed desktop identity ---------------------------------------------
// The ledger, electron-builder and runtime AUMID are three consumers of one
// frozen identity. Run both the rule proof and the live comparison in the
// ordinary gate so drift cannot wait until packaging CI to be discovered.
for (const command of [
  "node scripts/check-release-identity.mjs --self-test",
  "node scripts/check-release-identity.mjs --enforce",
]) {
  try {
    execSync(command, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    if (detail) console.error(detail);
    problems.push(`release identity check failed (${command})`);
  }
}

// --- tracked filenames stay whitespace-free ----------------------------------
// The dev-runner's Nx watch bridge (tooling/dev-runner/src/nx-watch-event.mjs)
// receives changed paths via NX_FILE_CHANGES, which Nx delimits with
// whitespace. A tracked path containing whitespace would fragment into
// phantom entries and silently mis-target affected typechecks, so the repo
// forbids the class here rather than guessing at reassembly there.
try {
  const tracked = execSync("git ls-files -z", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .split("\0")
    .filter(Boolean);
  const withWhitespace = tracked.filter((path) => /\s/.test(path));
  if (withWhitespace.length > 0) {
    problems.push(
      `tracked filenames contain whitespace (breaks the Nx watch event protocol): ${withWhitespace
        .slice(0, 5)
        .join(", ")}${withWhitespace.length > 5 ? ", …" : ""}`,
    );
  }
} catch {
  warnings.push("could not enumerate tracked files (git ls-files failed)");
}

// --- report ------------------------------------------------------------------
for (const w of warnings) console.warn(`preflight WARN: ${w}`);
for (const p of problems) console.error(`preflight FAIL: ${p}`);
if (problems.length > 0) process.exit(1);
console.log(warnings.length > 0 ? `preflight OK (${warnings.length} warning(s))` : "preflight OK");
