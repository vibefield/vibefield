#!/usr/bin/env node
// Environment preflight: tool versions + the import-boundary walls. Hard-fails
// on missing pieces, warns on version drift. Run: `pnpm preflight`.
//
// AR-0 sibling mode (2026-09-12): puppeteer and rosetta are consumed as SIBLING
// CHECKOUTS pinned by revision in siblings.lock.json (the truffle-era machinery
// of cb652e0a, retired 7fcdfd2c when truffle graduated to a registry pin, revived
// for two siblings). scripts/siblings.mjs is the one reader of that lock; this
// file verifies what it says against the checkouts and against the overrides
// block. A path dependency without a SHA pin makes verify unreplayable. Both
// went exact since (rosetta's packages at RD-5a, 2026-10-14; puppeteer's on
// 2026-10-26, 0.2.3); their entries stay as the dev overlay's coordinates, and
// rosettad is still built from rosetta's checkout.
//
// RFC 025 petition window (2026-09-16): truffle rejoins them, and the machinery
// it seeded now verifies its own two extra shapes — the cargo [patch.crates-io]
// row (all-or-nothing against the lock, exactly as the npm family rule works)
// and the Go sidecar built beside field-native (missing or stale WARNs; the
// floor reports a missing sidecar as Degraded honestly, so it is not a gate).
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  applySwiftRelease,
  cargoLockHidden,
  cargoPatchRows,
  cargoPlane,
  cargoRelease,
  cargoRequirements,
  committedNpmRow,
  goSidecarState,
  LOCK_FILE,
  linkedPackages,
  lockHidden,
  needsCheckout,
  npmPlane,
  OVERLAY_CARGO,
  OVERLAY_PNPMFILE,
  OVERLAY_STATE,
  overlayable,
  overlayCargoDrift,
  patchPath,
  readLock,
  readOverlay,
  rosettadBinary,
  rosettadState,
  siblingDir,
  siblingDirty,
  siblingHead,
  siblingShape,
  swiftPlane,
} from "./siblings.mjs";

const root = resolve(import.meta.dirname, "..");
const problems = [];
const warnings = [];
// The dependency SHAPE is printed on every run (RD-5a, 2026-10-14; RD-D10's "preflight prints the shape"): what
// each sibling reaches this tree as, and since RD-1 (2026-10-15) the local overlay over it — one derivation,
// `siblingShape` in scripts/siblings.mjs, which `pnpm siblings` and `use` print in the same words.

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

// --- rustc, clippy, rustfmt (EL8: the compiler is pinned like any dependency) --------------------------------------
// rust-toolchain.toml is the ONE declaration; this row reads its channel — never a second copy of the number — and
// holds the three tools to it (2026-10-21: CI's floating stable reached 1.99.1 and its clippy found 16 errors this Mac's
// 1.97.1 did not). RUSTUP_AUTO_INSTALL=0: a missing toolchain or component is NAMED here, never downloaded behind the
// check. clippy and rustfmt print a longer hash of the same commit, so they are matched by rustc's as a prefix.
const RUST_CHANNEL = readFileSync(join(root, "rust-toolchain.toml"), "utf8").match(
  /^\s*channel\s*=\s*"([^"]+)"/m,
)?.[1];
if (!RUST_CHANNEL || !/^\d+\.\d+\.\d+$/.test(RUST_CHANNEL)) {
  problems.push(
    `rust-toolchain.toml must name an exact Rust release as its channel (EL8), not ${RUST_CHANNEL ?? "nothing"}`,
  );
} else {
  const rustTool = (command) => {
    try {
      return execSync(command, {
        cwd: root,
        env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" },
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return null;
    }
  };
  const rustc = rustTool("rustc --version");
  const build = rustc?.match(/^rustc (\S+) \(([0-9a-f]+) /);
  if (!build) {
    problems.push(
      `rustc ${RUST_CHANNEL} (rust-toolchain.toml) is not installed: rustup toolchain install (in this checkout)`,
    );
  } else if (build[1] !== RUST_CHANNEL) {
    problems.push(
      `${rustc} answers here but rust-toolchain.toml pins ${RUST_CHANNEL} — a rustc that is not rustup's, or RUSTUP_TOOLCHAIN set`,
    );
  } else {
    for (const [tool, command] of [
      ["clippy", "cargo clippy --version"],
      ["rustfmt", "rustfmt --version"],
    ]) {
      const version = rustTool(command);
      if (!version) {
        problems.push(
          `${tool} is missing from rustc ${RUST_CHANNEL}: rustup toolchain install (rust-toolchain.toml lists it)`,
        );
      } else if (!version.match(/\(([0-9a-f]+) /)?.[1].startsWith(build[2])) {
        problems.push(`${version} is not from rustc ${RUST_CHANNEL}'s build (${build[2]})`);
      }
    }
  }
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
  // 0.7.14 → 0.7.19 on 2026-10-17 (the truffle bump, ruling B): egress, T6 and
  // sidecar protocol 8, the crate and the five npm sidecars in one EL8 event.
  // 0.7.19 → 0.7.22 on 2026-10-25, in ONE EL8 event with ghosttea 0.13.4 (ghosttea through 0.13.3 declares
  // truffle-core =0.7.19): sidecar protocols 9 and 10, the crate and the five npm sidecars together again.
  // Cargo.toml's closure note carries every event and every place they touched.
  { file: "Cargo.toml", re: /^truffle-core\s*=\s*"=0\.7\.22"/m, label: 'truffle-core = "=0.7.22"' },
  // The FINAL 0.16.0 on `latest` since PORTALS PT-6b (M24 LT1–LT5; LT5 — I52 — the reference
  // kinds' drivers idle unless their own object is in hand). Before it, prereleases on `next`
  // from PT-2 (0.16.0-portals.2 — LT1 + LT2, the live face and the hand's input; PT-3:
  // 0.16.0-portals.3, LT3's render half contained; PT-5a: 0.16.0-portals.4, LT4 — the asks
  // PORTALS found); DK-18 had pinned 0.15.0 FINAL, the cutover's release. Anchored to the
  // line's end, so `0.16.0` never passes for a later `0.16.0-…` or `0.16.01`.
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ice":\s*0\.16\.0\s*$/m,
    label: '"@vibecook/ice": 0.16.0',
  },
  // The EL8 to ghosttea 0.13.1 (2026-10-22/23): the five ghosttea rows move together, and since this event each is
  // anchored to the line's end like ice's, so a later `0.13.1-…` never passes for the release. The cargo row and the
  // react row are also RENDERED from siblings.lock.json's `release` (thinking-release-deps.md §13; preflight checks
  // them against the lock below); this table holds the manifests to the event in one more place, as for ice.
  // 0.13.1 → 0.13.4 on 2026-10-25/26 (the EL8 with truffle 0.7.22): the same six rows, the same anchors.
  { file: "Cargo.toml", re: /^ghosttea\s*=\s*"=0\.13\.4"\s*$/m, label: 'ghosttea = "=0.13.4"' },
  // TM-1 (2026-09-14): the ghosttea-truffle row is GONE with the crate — the TSP1
  // adapter left the floor (`thinking-terminal-mesh-cells.md`, TM-D1 ruled T), so
  // there is no second ghosttea consumer to keep in lockstep; the ghosttea row
  // alone carries truffle-core's version agreement now.
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-client":\s*0\.13\.4\s*$/m,
    label: '"@vibecook/ghosttea-client": 0.13.4',
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-electron":\s*0\.13\.4\s*$/m,
    label: '"@vibecook/ghosttea-electron": 0.13.4',
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-react":\s*0\.13\.4\s*$/m,
    label: '"@vibecook/ghosttea-react": 0.13.4',
    package: "@vibecook/ghosttea-react",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-protocol":\s*0\.13\.4\s*$/m,
    label: '"@vibecook/ghosttea-protocol": 0.13.4',
  },
  // The EL8 to 0.13.1 (2026-10-22/23): terminal-perf's frame reader joins the event (it had no row; the lock held 0.10.1).
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-frame":\s*0\.13\.4\s*$/m,
    label: '"@vibecook/ghosttea-frame": 0.13.4',
  },
  // RD-5a (2026-10-14): rosetta's TypeScript packages are exact registry pins,
  // published from the revision the lock still pins for rosettad's build. Anchored
  // to the line's end like ice's row, so a prerelease never passes for the release.
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/rosetta-protocol":\s*0\.1\.1\s*$/m,
    label: '"@vibefield/rosetta-protocol": 0.1.1',
    package: "@vibefield/rosetta-protocol",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/rosetta-room":\s*0\.1\.1\s*$/m,
    label: '"@vibefield/rosetta-room": 0.1.1',
    package: "@vibefield/rosetta-room",
  },
  // RD-5's exit for puppeteer's npm plane (2026-10-26): the seven rows are exact `@vibefield/puppeteer-*` 0.2.3,
  // published from the tag v0.2.3 (ee785ec1), the revision the lock pins. Anchored to the line's end like rosetta's.
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/puppeteer-runtime":\s*0\.2\.3\s*$/m,
    label: '"@vibefield/puppeteer-runtime": 0.2.3',
    package: "@vibefield/puppeteer-runtime",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/puppeteer-builtin-providers":\s*0\.2\.3\s*$/m,
    label: '"@vibefield/puppeteer-builtin-providers": 0.2.3',
    package: "@vibefield/puppeteer-builtin-providers",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/puppeteer-core":\s*0\.2\.3\s*$/m,
    label: '"@vibefield/puppeteer-core": 0.2.3',
    package: "@vibefield/puppeteer-core",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/puppeteer-record":\s*0\.2\.3\s*$/m,
    label: '"@vibefield/puppeteer-record": 0.2.3',
    package: "@vibefield/puppeteer-record",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/puppeteer-monitor":\s*0\.2\.3\s*$/m,
    label: '"@vibefield/puppeteer-monitor": 0.2.3',
    package: "@vibefield/puppeteer-monitor",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/puppeteer-view-sdk":\s*0\.2\.3\s*$/m,
    label: '"@vibefield/puppeteer-view-sdk": 0.2.3',
    package: "@vibefield/puppeteer-view-sdk",
  },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibefield\/puppeteer-views":\s*0\.2\.3\s*$/m,
    label: '"@vibefield/puppeteer-views": 0.2.3',
    package: "@vibefield/puppeteer-views",
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
  // Since RD-1 a lock entry also names a RELEASED sibling's packages (the overlay's link targets), so the window is
  // the committed dev plane only: a released package keeps its exact row, and this table still holds it.
  if (
    packageName &&
    Object.values(readLock(root)?.siblings ?? {}).some(
      (entry) => entry.packages?.[packageName] && npmPlane(entry) === "dev",
    )
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
// every override of one sibling's packages is either a lock-backed link: row or
// (registry mode, W-D8) an exact version — a mixed family is the drift class a
// per-line table would miss. The rule is asked PER SIBLING since RD-5a
// (2026-10-14), when rosetta's packages went exact while puppeteer's stayed
// linked; each family is matched under every scope it has carried, and a
// retired scope is named as retired: `@rosetta/*` (RL5), and since puppeteer went
// exact (2026-10-26) `@vibecook/puppeteer-*`. Revision drift FAILS with the
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
  const SIBLING_FAMILIES = [
    {
      sibling: "puppeteer",
      test: /^@(?:vibecook|vibefield)\/puppeteer-/,
      retired: /^@vibecook\/puppeteer-/,
      retiredWhy:
        "the @vibecook/puppeteer-* scope is retired (RL5; puppeteer went exact 2026-10-26) — puppeteer publishes as @vibefield/puppeteer-*",
    },
    {
      sibling: "rosetta",
      test: /^@rosetta\/|^@vibefield\/rosetta-/,
      retired: /^@rosetta\//,
      retiredWhy:
        "the @rosetta scope is retired (RL5, RD-5a) — rosetta publishes as @vibefield/rosetta-*",
    },
  ];
  const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  const familyOf = (name) => SIBLING_FAMILIES.find((f) => f.test.test(name));
  const family = [...yaml.matchAll(/^\s*['"]?(@[a-z-]+\/[a-z-]+)['"]?:\s*(\S+)/gm)]
    .map(([line, name, value]) => [line, name, unquote(value)])
    .filter(
      ([, name, value]) =>
        familyOf(name) !== undefined || declaredPackages.has(name) || value.startsWith("link:"),
    );
  for (const [, name] of family) {
    const of = familyOf(name);
    if (of?.retired?.test(name)) problems.push(`${name}: ${of.retiredWhy}`);
  }
  if (lock === null) {
    // Registry mode: no link: row may exist without a lock behind it.
    for (const [, name, value] of family) {
      if (value.startsWith("link:")) {
        problems.push(
          `${name} is a link: override but ${LOCK_FILE} is absent — a path dependency needs a pin (pnpm siblings:pin after declaring the sibling)`,
        );
      } else if (!EXACT_VERSION.test(value)) {
        problems.push(
          `sibling family rule: ${name} reads ${value} — a published sibling is an EXACT version (EL8), never a range`,
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
    const linkedNow = readOverlay(root);
    for (const [name, entry] of Object.entries(lock.siblings)) {
      const dir = siblingDir(root, entry);
      // RD-1: the committed row is what the lock RENDERS — the release version on a released npm plane, the
      // link: row into the pinned checkout on a dev one (`render --prod` writes exactly this).
      for (const pkg of Object.keys(entry.packages ?? {})) {
        lockPackages.set(pkg, committedNpmRow(entry, pkg));
      }
      // 2026-10-22 (the ghosttea 0.13.0 EL8): a sibling whose every plane is released builds nothing from its
      // checkout — the checkout is only the overlay's coordinate — so it may be absent, and one standing at another
      // revision is said, never failed: nothing here reads it until `use NAME` links it.
      if (!needsCheckout(entry, linkedNow.includes(name))) {
        const head = existsSync(dir) ? siblingHead(dir) : null;
        if (head !== null && head !== entry.sha) {
          warnings.push(
            `${name}: every plane is released, so nothing builds from ${dir} — but it is at ${head.slice(0, 12)}, not the release's revision ${entry.sha.slice(0, 12)}; \`pnpm siblings use ${name}\` would link it as it stands`,
          );
        }
        continue;
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
      if (lockPackages.has(name)) continue; // its link: row is checked above
      const sibling = familyOf(name)?.sibling;
      if (value.startsWith("link:")) {
        problems.push(
          `sibling family rule: ${name} (${value}) is a link: row ${LOCK_FILE} does not declare — a path dependency needs a revision pin (declare it, then \`pnpm siblings:pin\`)`,
        );
      } else if (lock.siblings[sibling] && npmPlane(lock.siblings[sibling]) === "dev") {
        problems.push(
          `sibling family rule: ${name} (${value}) is not in ${LOCK_FILE} while ${sibling}'s other packages are link: rows — the family is ALL lock-backed link: rows or ALL exact versions, never mixed`,
        );
      } else if (!EXACT_VERSION.test(value)) {
        problems.push(
          `sibling family rule: ${name} reads ${value} — a published sibling is an EXACT version (EL8), never a range`,
        );
      }
    }
    // RD-1: the local overlay names only lock siblings with a RELEASED plane — a hand-edited state file that
    // names anything else would link what the lock never declared — and it is rendered from the lock it was
    // written under (a pin move since then leaves it pointing at the old revision's packages).
    const overlay = readOverlay(root);
    for (const name of overlay) {
      const entry = lock.siblings[name];
      if (entry === undefined || !overlayable(entry)) {
        problems.push(
          `the dev overlay (${OVERLAY_STATE}) links ${name}, which ${LOCK_FILE} does not declare as a released sibling — \`node scripts/siblings.mjs use --none\`, then \`use\` the siblings again`,
        );
      }
    }
    // RD-2: the overlay IS the root .pnpmfile.cjs (pnpm loads it for every command), so the two must agree — a stray
    // one with no overlay recorded silently changes every install of this tree; an overlay recorded with no pnpmfile
    // or not installed is a tree that is not the shape `pnpm siblings` says.
    // RD-3: the cargo half the same way — a generated `.cargo/config.toml` with no overlay recorded patches every build
    // of this tree; one missing while a released cargo plane is linked builds the git rev the overlay said it replaced.
    const cargoConfig = resolve(root, OVERLAY_CARGO);
    const cargoGenerated =
      existsSync(cargoConfig) &&
      readFileSync(cargoConfig, "utf8").startsWith(
        "# GENERATED by `node scripts/siblings.mjs use`",
      );
    if (existsSync(cargoConfig) && !cargoGenerated) {
      warnings.push(
        `${OVERLAY_CARGO} stands at the root and was NOT written by \`pnpm siblings use\` — cargo applies it to every build here (gitignored, so \`git status\` will not show it); \`use\` refuses to overwrite it and never deletes it`,
      );
    }
    if (overlay.length === 0 && cargoGenerated) {
      problems.push(
        `${OVERLAY_CARGO} was written by \`pnpm siblings use\` but no overlay is recorded — cargo applies it to every build; \`pnpm siblings use --none\` removes it`,
      );
    }
    const cargoHidden = cargoLockHidden(root);
    if (cargoHidden === true && !cargoGenerated) {
      problems.push(
        "Cargo.lock is marked skip-worktree but no cargo overlay is active — `git update-index --no-skip-worktree Cargo.lock` (or `pnpm siblings use --none`)",
      );
    } else if (cargoHidden === true) {
      warnings.push(
        "Cargo.lock is skip-worktree while the cargo overlay is active (its path patches rewrite the lock's registry sources) — commits are refused until `pnpm siblings use --none`",
      );
    }
    const cargoLinked = overlay.filter(
      (name) => lock.siblings[name] && cargoPlane(lock.siblings[name]) === "prod",
    );
    if (cargoLinked.length > 0 && !cargoGenerated) {
      warnings.push(
        `the dev overlay links ${cargoLinked.join(", ")}'s cargo plane but ${OVERLAY_CARGO} is missing — \`pnpm siblings use ${cargoLinked.join(" ")}\``,
      );
    }
    // RD-3: the Swift half is the manifest's own `let <name>Release` line (SwiftPM caches a manifest by its contents plus
    // its environment, never a file it reads): the lock's version in the committed shape, nil while the overlay links the
    // sibling — the manifest then shows modified, and its Package.resolved is hidden by the lock rule.
    // Package.resolved is the MANIFEST's, so its state is said once per manifest, however many siblings render into it
    // (two since the EL8 to ghosttea 0.13.0, 2026-10-22: ghosttea and truffle share the kit's).
    const resolvedSaid = new Set();
    for (const [name, entry] of Object.entries(lock.siblings)) {
      if (!entry.swift) continue;
      const linked = overlay.includes(name) && swiftPlane(entry) === "prod";
      const manifestRel = entry.swift.manifest;
      const resolvedRel = join(dirname(manifestRel), "Package.resolved");
      let manifestText = null;
      try {
        manifestText = readFileSync(resolve(root, manifestRel), "utf8");
      } catch {}
      if (manifestText !== null) {
        const expected = linked ? undefined : entry.release?.swift;
        const r = applySwiftRelease(manifestText, name, expected);
        if (r.missing.length > 0) {
          problems.push(
            `${manifestRel} has no \`let ${name}Release: Version? = …\` line — ${LOCK_FILE} renders ${name}'s Swift coordinate into it (\`node scripts/siblings.mjs render --prod\` keeps it once it exists)`,
          );
        } else if (r.changed.length > 0) {
          const { from, to } = r.changed[0];
          problems.push(
            linked
              ? `${manifestRel}: ${name}Release reads ${from} but the dev overlay links ${name} — the overlay renders it nil; \`pnpm siblings use ${name}\` again`
              : `${manifestRel}: ${name}Release reads ${from} but ${LOCK_FILE} renders ${to}${overlay.length > 0 ? ` (the dev overlay does not link ${name})` : ""} — \`node scripts/siblings.mjs render --prod\``,
          );
        }
      }
      if (linked) {
        warnings.push(
          `${manifestRel} shows modified while the Swift overlay links ${name}: its ${name}Release line is the overlay's nil (the path package) over the lock's ${entry.release.swift} — \`pnpm siblings use --none\` renders it back`,
        );
      }
      const anyLinked = Object.entries(lock.siblings).some(
        ([other, e]) =>
          e.swift?.manifest === manifestRel && overlay.includes(other) && swiftPlane(e) === "prod",
      );
      if (!resolvedSaid.has(resolvedRel) && lockHidden(root, resolvedRel) === true) {
        resolvedSaid.add(resolvedRel);
        if (anyLinked) {
          warnings.push(
            `${resolvedRel} is skip-worktree while the Swift overlay stands (the path package drops its URL row) — commits are refused until \`pnpm siblings use --none\``,
          );
        } else {
          problems.push(
            `${resolvedRel} is marked skip-worktree but no Swift overlay stands — \`git update-index --no-skip-worktree ${resolvedRel}\` (or \`pnpm siblings use --none\`)`,
          );
        }
      }
    }
    const pnpmfileExists = existsSync(resolve(root, OVERLAY_PNPMFILE));
    if (overlay.length === 0 && pnpmfileExists) {
      problems.push(
        `${OVERLAY_PNPMFILE} exists but no dev overlay is recorded (${OVERLAY_STATE}) — pnpm loads it for every install; \`pnpm siblings use --none\` removes it`,
      );
    }
    // only an overlay with a released npm half writes the pnpmfile; a cargo or Swift plane links through its own file
    const npmLinked = overlay.filter(
      (name) => lock.siblings[name] && npmPlane(lock.siblings[name]) === "prod",
    );
    if (npmLinked.length > 0 && !pnpmfileExists) {
      warnings.push(
        `the dev overlay links ${npmLinked.join(", ")}'s npm packages but ${OVERLAY_PNPMFILE} is missing — \`pnpm siblings use ${overlay.join(" ")}\``,
      );
    }
    for (const [pkg, { dir, via }] of linkedPackages(root, lock, overlay)) {
      if (via !== "overlay") continue;
      let installed = null;
      try {
        installed = realpathSync(resolve(root, "node_modules", ".pnpm", "node_modules", pkg));
      } catch {
        installed = null;
      }
      if (installed !== realpathSync(dir)) {
        warnings.push(
          `the dev overlay links ${pkg} but this tree has ${installed === null ? "no copy of it" : installed} installed — \`pnpm siblings use ${overlay.join(" ")}\` (or \`use --none\`)`,
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
    const releasedCrates = new Set();
    const registryCrates = new Map();
    for (const [name, entry] of Object.entries(lock.siblings)) {
      // 2026-10-22 (the ghosttea 0.13.0 EL8): a cargo plane released on the REGISTRY is committed with no patch row at
      // all — the manifest's exact dependency row is the whole pin — so a row for one of its crates is a leak (a dev
      // patch committed, or a hand-edit); the overlay's patches live in the generated .cargo/config.toml instead.
      if (cargoPlane(entry) === "prod" && cargoRelease(entry).registry) {
        for (const crate of Object.keys(entry.patch ?? {})) {
          registryCrates.set(crate, { sibling: name, version: cargoRelease(entry).registry });
        }
        continue;
      }
      // RD-3: a RELEASED cargo plane is committed as `git` + `rev` rows, which `render --prod --check` verifies exactly;
      // the path expectation below is the unreleased plane's (and a released one's rows are still lock-backed).
      if (cargoPlane(entry) === "prod") {
        for (const crate of Object.keys(entry.patch ?? {})) releasedCrates.add(crate);
        continue;
      }
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
      const released = registryCrates.get(crate);
      if (released !== undefined) {
        problems.push(
          `sibling mode: Cargo.toml patches ${crate}${path === null ? "" : ` with path "${path}"`} but ${LOCK_FILE} releases ${released.sibling}'s crates on the registry (${released.version}) — the committed shape carries no patch row (\`node scripts/siblings.mjs render --prod\` removes it); the overlay's patches live in ${OVERLAY_CARGO}`,
        );
        continue;
      }
      if (lockPatches.has(crate) || releasedCrates.has(crate)) continue;
      problems.push(
        `sibling family rule: Cargo.toml patches ${crate}${path === null ? "" : ` with path "${path}"`} but no ${LOCK_FILE} entry declares it — a path patch needs a revision pin (\`pnpm siblings:pin\`), never a bare working tree`,
      );
    }
    // thinking-release-deps.md §13 (2026-10-22): one version, stated once — a registry release's [workspace.dependencies]
    // rows are what the lock renders (`=<release.cargo>`), as the npm rows above are.
    let cargoManifest = "";
    try {
      cargoManifest = readFileSync(resolve(root, "Cargo.toml"), "utf8");
    } catch {
      cargoManifest = "";
    }
    for (const [name, entry] of Object.entries(lock.siblings)) {
      const release = cargoPlane(entry) === "prod" ? cargoRelease(entry) : null;
      if (!release?.registry) continue;
      const required = cargoRequirements(cargoManifest, Object.keys(entry.patch));
      if (required.size === 0) {
        problems.push(
          `sibling mode: Cargo.toml declares none of ${name}'s crates in [workspace.dependencies] — ${LOCK_FILE} releases them on the registry at ${release.registry} (\`node scripts/siblings.mjs render --prod\` writes the row once it exists)`,
        );
      }
      for (const [crate, req] of required) {
        if (req !== `=${release.registry}`) {
          problems.push(
            `sibling mode: Cargo.toml requires ${crate} "${req}" but ${LOCK_FILE} releases ${name}'s crates at ${release.registry} — the row is rendered as "=${release.registry}" (\`node scripts/siblings.mjs render --prod\`; a pin moves in the lock, EL8)`,
          );
        }
      }
    }
    // §13's hazard, MEASURED 2026-10-22 (cargo 1.99.1): a [patch] whose version does not satisfy the requirement "was not
    // used in the crate graph", and cargo builds the registry's crate — while the overlay links a cargo plane, every
    // linked crate's checkout must be at the version the tree requires, or the build is silently not the checkout.
    for (const { sibling, crate, version, expected } of overlayCargoDrift(root, lock, linkedNow)) {
      problems.push(
        `the dev overlay links ${sibling}'s ${crate} from its checkout at ${version ?? "an unreadable version"}, but this tree requires =${expected} — cargo uses a [patch] only when its version satisfies the requirement ("patch \`${crate} v${version ?? "?"} (…)\` was not used in the crate graph"), so the build would be the registry's ${expected}, not the checkout; move the checkout to the release's revision, or move the pin (EL8)`,
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
    // 2026-10-22 (the ghosttea 0.13.0 EL8, G28's exit): once a Swift plane is RELEASED the committed coordinate is the
    // exact URL row, and the identity link is only the overlay's — so it is resolved only while `use NAME` links it.
    // That is what makes `../truffle-rfc025` unnecessary for the iOS plane. The manifest must still name the path
    // package (the overlay's nil line selects it), so that half is checked in both shapes.
    for (const [name, entry] of Object.entries(lock.siblings)) {
      if (!entry.swift) continue;
      const dir = siblingDir(root, entry);
      const link = resolve(root, entry.swift.link);
      const linkRead = swiftPlane(entry) === "dev" || linkedNow.includes(name);
      let target = null;
      try {
        target = realpathSync(link);
      } catch {
        target = null;
      }
      if (!linkRead) {
        // released and not linked: nothing resolves the link
      } else if (target === null) {
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
    // rosettad against cargo's own record of what it was built from (its
    // dep-info) — item 56: a walk of the checkout counted `#[cfg(test)]` files
    // a release build never reads, and warned on a binary cargo called fresh.
    const rosettad = rosettadState(root);
    const { bin } = rosettad;
    if (rosettad.state === "unresolved") {
      warnings.push(
        `${bin.name}: cargo cannot resolve its target directory — rosettad path unknown`,
      );
    } else if (rosettad.state === "missing") {
      warnings.push(
        `${bin.name}: rosettad is not built (${bin.path}) — run \`pnpm siblings:build\`; fieldd reports the agent index UNAVAILABLE until then`,
      );
    } else if (rosettad.state === "stale") {
      const source = relative(bin.dir, rosettad.source);
      warnings.push(
        rosettad.gone
          ? `${bin.name}: ${source}, a source cargo built rosettad from, is gone — run \`pnpm siblings:build\``
          : `${bin.name}: ${source} is newer than the built rosettad — run \`pnpm siblings:build\``,
      );
    } else if (rosettad.state === "unrecorded") {
      warnings.push(
        `${bin.name}: cargo left no record of what rosettad was built from (no dep-info beside ${bin.path}) — run \`pnpm siblings:build\`, which writes it`,
      );
    }
    // The go sibling's binary: the truffle mesh sidecar, built beside
    // field-native because that is where the floor's resolve_sidecar looks
    // first. WARN, never FAIL: a floor with no sidecar reports the mesh
    // UNAVAILABLE/Degraded honestly (the tolerant-reader law), so a missing one
    // is a degraded dev stack, not a broken tree — and every TS gate runs
    // without it. `go build` keeps no record of what it compiled, so the
    // module's own source mtimes are the freshness question — where cargo's
    // record, above, names rosettad's.
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
// TD-0 (2026-10-14): the trust-root's keygen proves its own refusals here too —
// the overwrite, the secret on a non-terminal or in the repository, the role
// confusion, the rotation and the embedding — with keys that never leave a
// temporary directory.
for (const command of [
  "node scripts/check-release-identity.mjs --self-test",
  "node scripts/check-release-identity.mjs --enforce",
  "node scripts/trust-keygen.mjs --self-test",
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
{
  const { line, overlay } = siblingShape(root);
  console.log(line);
  if (overlay.length > 0)
    console.log(
      `overlay: ${overlay.join(", ")} (${OVERLAY_PNPMFILE}) — linked locally over the committed shape`,
    );
}
if (problems.length > 0) process.exit(1);
console.log(warnings.length > 0 ? `preflight OK (${warnings.length} warning(s))` : "preflight OK");
