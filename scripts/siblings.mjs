#!/usr/bin/env node
// AR-0 sibling mode — the one reader of siblings.lock.json.
//
// puppeteer (the agent runtime) and rosetta (agent history) are unpublished, so
// this repo consumes them as SIBLING CHECKOUTS: their packages enter through
// `link:` rows in pnpm-workspace.yaml and rosettad is built from the sibling's
// source. Three consumers need the same facts about those checkouts and must
// never derive them twice: preflight (verify the pins), Nx (invalidate caches
// when a sibling changes — a `link:` records no content hash in the lockfile,
// so without this a sibling edit would never miss a cached typecheck), and the
// dev runner (hand fieldd the rosettad binary). This module is that one
// derivation; the CLI below is its command form.
//
// The revision pin is the truffle-era machinery (cb652e0a, retired 7fcdfd2c)
// revived for two siblings: the lock records a SHA per checkout, preflight
// fails on drift, and `pnpm siblings:pin` is the deliberate upgrade event
// (EL8). A dirty sibling only WARNs — co-developing it is the normal state;
// the pin is about the base revision.
//
// Usage: node scripts/siblings.mjs <status|pin|stamp|build|bin>
//   status  print each sibling's path, HEAD, pin, and dirtiness (never fails)
//   pin     record every sibling's current HEAD in siblings.lock.json
//   stamp   one line naming each sibling's HEAD + a hash of its working-tree
//           state — the Nx `sharedGlobals` runtime input
//   build   `cargo build --release -p rosettad` in the rosetta checkout
//   bin     print the built rosettad path (exit 1 when it is not built)

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_FILE = "siblings.lock.json";

/** The parsed lock, or null when the file is absent. Shape: `{ siblings: {
 * <name>: { path, sha, packages: { <npm name>: <dir inside the checkout> },
 * cargo?: { crate, profile } } } }`. */
export function readLock(root = REPO_ROOT) {
  const file = join(root, LOCK_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function siblingDir(root, entry) {
  return resolve(root, entry.path);
}

/** The pnpm-workspace.yaml override value a lock package MUST carry: a `link:`
 * to the package directory inside the pinned checkout, spelled relative to the
 * workspace root exactly as the lock spells the checkout path. */
export function linkRow(entry, packageDir) {
  return `link:${entry.path}/${packageDir}`;
}

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

/** HEAD of the checkout, or null when the directory is not a git checkout. */
export function siblingHead(dir) {
  try {
    return git(dir, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/** true/false for a git checkout, null when the status cannot be read. */
export function siblingDirty(dir) {
  try {
    return git(dir, ["status", "--porcelain"]).length > 0;
  } catch {
    return null;
  }
}

/** The newest mtime (ms) among the checkout's Rust sources — `crates/**`,
 * `Cargo.toml`, `Cargo.lock` — or null when nothing is there. This is cargo's
 * own freshness question (source mtimes against the fingerprint), which is why
 * preflight asks it and not "is the binary older than HEAD's commit time": a
 * binary built after the last edit but before the commit is FRESH, and cargo
 * agrees (`Finished … in 0.31s`), so a commit-time check would nag forever. */
export function newestSourceMtime(dir) {
  let newest = null;
  const consider = (file) => {
    try {
      const t = statSync(file).mtimeMs;
      if (newest === null || t > newest) newest = t;
    } catch {
      // vanished mid-walk: not a source we could build from anyway
    }
  };
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "target" || entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) consider(full);
    }
  };
  walk(join(dir, "crates"));
  consider(join(dir, "Cargo.toml"));
  consider(join(dir, "Cargo.lock"));
  return newest;
}

/** A cheap fingerprint of the working tree: HEAD, the tracked diff against it
 * (content, not just paths — `--stat` alone misses a one-character edit that
 * keeps the line counts), and each untracked file's size + mtime. Never throws:
 * a missing checkout stamps as "missing" so Nx still builds a graph. */
export function siblingStamp(dir) {
  const head = siblingHead(dir);
  if (head === null) return existsSync(dir) ? "not-a-checkout" : "missing";
  const hash = createHash("sha256");
  try {
    hash.update(
      execFileSync("git", ["diff", "HEAD", "--no-color", "--no-ext-diff"], {
        cwd: dir,
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
    const untracked = git(dir, ["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean);
    for (const rel of untracked) {
      hash.update(rel);
      try {
        const s = statSync(join(dir, rel));
        hash.update(`${s.size}:${Math.floor(s.mtimeMs)}`);
      } catch {
        hash.update("gone");
      }
    }
  } catch {
    hash.update("unreadable");
  }
  return `${head}+${hash.digest("hex").slice(0, 16)}`;
}

/** Every sibling's stamp on one line — the Nx runtime input. */
export function stamp(root = REPO_ROOT) {
  const lock = readLock(root);
  if (lock === null) return "no-siblings-lock";
  return Object.entries(lock.siblings)
    .map(([name, entry]) => `${name}@${siblingStamp(siblingDir(root, entry))}`)
    .join(" ");
}

const targetDirCache = new Map();

/** Where cargo puts artifacts for the checkout — asked of cargo itself, so the
 * sibling's own `.cargo/config.toml` `target-dir` (rosetta keeps its target on
 * the SSD that way, gitignored) is honoured rather than guessed. Null when
 * cargo cannot answer (not installed, checkout missing). Cached per process:
 * the dev runner asks on every Electron restart. */
export function cargoTargetDir(dir) {
  if (targetDirCache.has(dir)) return targetDirCache.get(dir);
  let result = null;
  try {
    const meta = execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    result = JSON.parse(meta.toString()).target_directory ?? null;
  } catch {
    result = null;
  }
  targetDirCache.set(dir, result);
  return result;
}

/** The sibling entry that carries a `cargo` block, with its resolved binary
 * path — null when the lock names no cargo sibling or cargo cannot say where
 * the target directory is. Existence is the caller's question (`bin`,
 * preflight, and the runner each answer it differently). */
export function rosettadBinary(root = REPO_ROOT, platform = process.platform) {
  const lock = readLock(root);
  if (lock === null) return null;
  for (const [name, entry] of Object.entries(lock.siblings)) {
    if (!entry.cargo) continue;
    const dir = siblingDir(root, entry);
    const target = cargoTargetDir(dir);
    if (target === null) return { name, dir, path: null };
    const file = platform === "win32" ? `${entry.cargo.crate}.exe` : entry.cargo.crate;
    return { name, dir, path: join(target, entry.cargo.profile ?? "release", file) };
  }
  return null;
}

// --- CLI ---------------------------------------------------------------------

function status(root) {
  const lock = readLock(root);
  if (lock === null) {
    console.log(`${LOCK_FILE}: absent (registry mode — no siblings)`);
    return 0;
  }
  for (const [name, entry] of Object.entries(lock.siblings)) {
    const dir = siblingDir(root, entry);
    if (!existsSync(dir)) {
      console.log(`${name.padEnd(10)} MISSING at ${dir} (pinned ${entry.sha.slice(0, 12)})`);
      continue;
    }
    const head = siblingHead(dir);
    const dirty = siblingDirty(dir);
    const rev =
      head === null
        ? "not a git checkout"
        : head === entry.sha
          ? `at pin ${head.slice(0, 12)}`
          : `HEAD ${head.slice(0, 12)} ≠ pin ${entry.sha.slice(0, 12)}`;
    const tree = dirty === null ? "" : dirty ? " · dirty" : " · clean";
    const cargo = entry.cargo ? ` · ${entry.cargo.crate}` : "";
    console.log(`${name.padEnd(10)} ${dir}  ${rev}${tree}${cargo}`);
    for (const [pkg, packageDir] of Object.entries(entry.packages ?? {})) {
      console.log(`           ${pkg} → ${linkRow(entry, packageDir)}`);
    }
  }
  const bin = rosettadBinary(root);
  if (bin?.path) {
    console.log(
      `rosettad   ${bin.path}${existsSync(bin.path) ? "" : "  (NOT BUILT — pnpm siblings:build)"}`,
    );
  }
  return 0;
}

function pin(root) {
  const lock = readLock(root);
  if (lock === null) {
    console.error(
      `siblings:pin FAIL: ${LOCK_FILE} is absent — sibling mode is declared there first`,
    );
    return 1;
  }
  for (const [name, entry] of Object.entries(lock.siblings)) {
    const dir = siblingDir(root, entry);
    const head = siblingHead(dir);
    if (head === null) {
      console.error(`siblings:pin FAIL: ${name} is not a git checkout at ${dir}`);
      return 1;
    }
    const moved = head !== entry.sha;
    entry.sha = head;
    console.log(`pinned ${name} @ ${head}${moved ? "" : " (unchanged)"}`);
    // A pin CI cannot fetch is a pin only this machine can verify: the clone
    // step checks out the SHA from the remote, so an unpushed commit turns the
    // gate red there. Warn — pinning local work mid-development is legitimate,
    // pushing it is the owed step.
    let onRemote = "";
    try {
      onRemote = git(dir, ["branch", "-r", "--contains", head]);
    } catch {
      onRemote = "";
    }
    if (onRemote.length === 0) {
      console.warn(
        `siblings:pin WARN: ${name} @ ${head.slice(0, 12)} is on no remote branch — push it before relying on CI (the clone step fetches the pin from github.com/vibefield/${name})`,
      );
    }
  }
  writeFileSync(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  return 0;
}

function build(root) {
  const bin = rosettadBinary(root);
  if (bin === null) {
    console.error(`siblings:build FAIL: no cargo sibling in ${LOCK_FILE} (nothing to build)`);
    return 1;
  }
  if (bin.path === null) {
    // rosettadBinary answers {path:null} when `cargo metadata` fails in the
    // checkout — cargo missing, or the checkout absent — so name that here
    // rather than after a build that cannot have run.
    console.error(
      `siblings:build FAIL: cargo cannot resolve the target directory of ${bin.dir} — is cargo installed and the checkout present?`,
    );
    return 1;
  }
  const lock = readLock(root);
  const entry = lock.siblings[bin.name];
  const head = siblingHead(bin.dir);
  if (head !== null && head !== entry.sha) {
    console.warn(
      `siblings:build WARN: ${bin.name} HEAD ${head.slice(0, 12)} ≠ pin ${entry.sha.slice(0, 12)} — building an unpinned revision (pnpm siblings:pin to accept it)`,
    );
  }
  const args = ["build", `--${entry.cargo.profile ?? "release"}`, "-p", entry.cargo.crate];
  console.log(`siblings:build: cargo ${args.join(" ")}  (in ${bin.dir})`);
  // rustup picks the sibling's own rust-toolchain.toml from the cwd.
  const run = spawnSync("cargo", args, { cwd: bin.dir, stdio: "inherit" });
  if (run.status !== 0) return run.status ?? 1;
  if (!existsSync(bin.path)) {
    console.error(`siblings:build FAIL: cargo succeeded but ${bin.path} does not exist`);
    return 1;
  }
  console.log(`siblings:build: ${bin.path}`);
  return 0;
}

function printBin(root) {
  const bin = rosettadBinary(root);
  if (bin === null || bin.path === null) {
    console.error("siblings:bin: no cargo sibling (or cargo cannot resolve its target directory)");
    return 1;
  }
  if (!existsSync(bin.path)) {
    console.error(`siblings:bin: ${bin.path} is not built — run \`pnpm siblings:build\``);
    return 1;
  }
  console.log(bin.path);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "status";
  const handlers = {
    status,
    pin,
    stamp: (root) => {
      console.log(stamp(root));
      return 0;
    },
    build,
    bin: printBin,
  };
  const handler = handlers[command];
  if (handler === undefined) {
    console.error("usage: node scripts/siblings.mjs <status|pin|stamp|build|bin>");
    process.exit(2);
  }
  process.exit(handler(REPO_ROOT));
}
