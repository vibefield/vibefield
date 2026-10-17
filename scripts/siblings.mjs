#!/usr/bin/env node
// AR-0 sibling mode — the one reader of siblings.lock.json.
//
// puppeteer (the agent runtime) and rosetta (agent history) were unpublished, so
// this repo consumed them as SIBLING CHECKOUTS: their packages entered through
// `link:` rows in pnpm-workspace.yaml and rosettad is built from the sibling's
// source. Since RD-5a (2026-10-14) rosetta's packages are exact registry pins and
// its entry is a `cargo` key alone — the checkout serves rosettad's build until
// RD-D7 ships it as a release asset. Three consumers need the same facts about those checkouts and must
// never derive them twice: preflight (verify the pins), Nx (invalidate caches
// when a sibling changes — a `link:` records no content hash in the lockfile,
// so without this a sibling edit would never miss a cached typecheck), and the
// dev runner (hand fieldd the rosettad binary). This module is that one
// derivation; the CLI below is its command form.
//
// RFC 025 window (2026-09-16): truffle joins them for the duration of a
// petition window, and it is consumed in two more ways — a cargo
// `[patch.crates-io]` row (the `patch` block; Cargo.toml's own comment carries
// the window's terms and its exit) and a GO binary built beside field-native
// (the `go` block). One lock, three kinds of consumption, one reader.
//
// The revision pin is the truffle-era machinery (cb652e0a, retired 7fcdfd2c)
// revived for two siblings: the lock records a SHA per checkout, preflight
// fails on drift, and `pnpm siblings:pin` is the deliberate upgrade event
// (EL8). A dirty sibling only WARNs — co-developing it is the normal state;
// the pin is about the base revision.
//
// RD-1 (2026-10-15, thinking-release-deps.md §2 — one lock, two coordinates, two shapes): an entry may carry a
// `release` block beside its checkout coordinate — the PROD coordinate per plane (`npm`: the exact version every
// one of its `packages` is pinned at). A plane with a release is committed in prod shape (exact rows); a plane
// without one is committed in dev shape (link: rows, path patches) until RD-5 records its release. `render --prod`
// writes the committed rows from the lock (on today's tree a no-op — the committed tree IS its output), and the
// pre-commit hook asks it to check the STAGED tree. The dev OVERLAY links a released sibling's checkout back in,
// locally: generated under .vibefield/dev/ (ignored), never a committed file. RD-2 proves how pnpm installs it.
//
// Usage: node scripts/siblings.mjs <status|use [NAME...|--none]|render --prod [--check] [--staged]|render --dev|
//                                   pin [--skip-typecheck] [NAME...]|stamp|fetch NAME|install-js|build-js|build|bin>
//   status  the shape first (as preflight prints it), then each sibling's path, HEAD, pin, dirtiness and release
//           coordinate (never fails)
//   use     link the named RELEASED siblings over their prod coordinate in a local overlay (adds to the overlay);
//           `use --none` removes the overlay — the tree is its committed shape, which is what CI sees; bare `use`
//           prints it
//   render  `--prod`: write the committed sibling rows (pnpm-workspace.yaml overrides, Cargo.toml
//           [patch.crates-io]) from the lock; `--check` writes nothing and exits 1 on a difference; `--staged`
//           checks the index instead of the working tree (the pre-commit hook). `--dev`: re-render the overlay files
//           from the lock for the siblings `use` recorded
//   pin     record the named siblings' current HEADs (all when omitted), build
//           rosettad at it (a no-op when fresh), prove the agent catalog
//           against the new pins (wall R23, the rosetta half REQUIRED), then
//           typecheck the consumers at them (`pnpm typecheck`, since
//           2026-10-04; `--skip-typecheck` for the deliberate case, said when
//           used). Every checkout must match its resulting pin before the
//           build/gate; any red after the pin is recorded KEEPS it and exits 1.
//   stamp   one line naming each sibling's HEAD + a hash of its working-tree
//           state — the Nx `sharedGlobals` runtime input
//   fetch   clone a named sibling at its pin; never reset an existing checkout
//   install-js  frozen npm workspace installs for source-linked dist packages
//   build-js    build those workspaces in the lock's dependency order
//   build   the JavaScript packages above and every sibling's binary:
//           `cargo build --release -p <crate>` in the
//           cargo sibling, `go build -o <repo>/target/debug/<binary>` in the go
//           sibling's module
//   bin     print the built rosettad path (exit 1 when it is not built)

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_FILE = "siblings.lock.json";

/** The parsed lock, or null when the file is absent. Shape: `{ siblings: {
 * <name>: { path, sha, packages?: { <npm name>: <dir inside the checkout> },
 * patch?: { <crate name>: <dir inside the checkout> },
 * cargo?: { crate, profile }, go?: { module, binary }, repository?: string,
 * javascript?: { workspaces: string[] } } } }`. Every block is
 * one KIND of consumption, and a sibling may carry several: `packages` is the
 * npm half (link: rows), `patch` the cargo half ([patch.crates-io] rows),
 * `cargo` a crate this repo builds from the sibling for its own use, `go` a Go
 * binary the floor looks for beside itself. */
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

/** The `[patch.crates-io]` path a lock entry declares for a crate: that crate's
 * directory inside the pinned checkout, spelled relative to the workspace root
 * exactly as the lock spells the checkout path — cargo resolves a patch path
 * against the manifest that declares it, which is the workspace root. The npm
 * half of the same idea is `linkRow`. */
export function patchPath(entry, crateDir) {
  return `${entry.path}/${crateDir}`;
}

/** The root Cargo.toml's `[patch.crates-io]` section as `{ rows: Map<crate,
 * path|null>, unreadable: string[] }` — the path is null for a row that patches
 * by something other than a path (a git patch pins itself; this lock has
 * nothing to verify there). Read line by line rather than parsed: node ships no
 * TOML reader and the section is one screen long. A line inside the section
 * this reader cannot recognise goes to `unreadable` rather than being skipped,
 * so an unfamiliar shape FAILS the gate instead of quietly escaping the
 * all-or-nothing rule. */
export function cargoPatchRows(root = REPO_ROOT) {
  const rows = new Map();
  const unreadable = [];
  let text;
  try {
    text = readFileSync(join(root, "Cargo.toml"), "utf8");
  } catch {
    return { rows, unreadable };
  }
  let inSection = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inSection = line === "[patch.crates-io]";
      continue;
    }
    if (!inSection || line.length === 0 || line.startsWith("#")) continue;
    const named = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    // A table that opens on this line must close on it: cargo accepts a
    // multi-line row, this reader does not, and the difference has to be loud.
    if (named === null || (named[2].includes("{") && !named[2].includes("}"))) {
      unreadable.push(line);
      continue;
    }
    const path = named[2].match(/\bpath\s*=\s*"([^"]+)"/);
    rows.set(named[1], path === null ? null : path[1]);
  }
  return { rows, unreadable };
}

// --- RD-1: two coordinates, two shapes ------------------------------------------

/** Where the dev overlay lives: under the dev runner's isolated state, ignored by git. */
export const OVERLAY_DIR = ".vibefield/dev";
export const OVERLAY_STATE = `${OVERLAY_DIR}/siblings.json`;
/** The overlay's pnpmfile is the ROOT `.pnpmfile.cjs` (gitignored): pnpm 11 loads it by default for every command —
 * install, run, exec — so the overlay needs no environment and survives `verify-deps-before-run` (RD-2). */
export const OVERLAY_PNPMFILE = ".pnpmfile.cjs";
/** The dev lockfile (RD-2): the overlay's resolution, never the committed pnpm-lock.yaml. */
export const OVERLAY_LOCKFILE = `${OVERLAY_DIR}/pnpm-lock.yaml`;

/** The overlay's cargo half (RD-3): a generated, gitignored ROOT `.cargo/config.toml` whose `[patch.crates-io]` rows point
 * a released cargo plane's crates back at the checkout — cargo applies a configuration file's patch over the manifest's
 * for the same crate. Written by `use`, removed by `use --none`, and only ever a file that carries this header. */
export const OVERLAY_CARGO = ".cargo/config.toml";
const OVERLAY_CARGO_HEADER = "# GENERATED by `node scripts/siblings.mjs use` (RD-3)";

/** The cargo plane of an entry: `none` (no patch), `dev` (committed as path patches — no release yet) or `prod`
 * (committed as the `release.cargo` git + rev patch, RD-D5's coordinate for a fork line). */
export function cargoPlane(entry) {
  if (Object.keys(entry.patch ?? {}).length === 0) return "none";
  return entry.release?.cargo?.git && entry.release?.cargo?.rev ? "prod" : "dev";
}

/** The Swift plane of an entry: `none`, `dev` (the committed path package — no release yet) or `prod` (the exact
 * `release.swift` version, rendered into the manifest's `let <name>Release` line). The overlay links a released Swift
 * plane by rendering that same line nil in the working tree — the manifest's own contents, because SwiftPM caches a
 * manifest's evaluation keyed on its contents plus its environment, never a file it reads (thinking-release-deps §3). */
export function swiftPlane(entry) {
  if (!entry.swift) return "none";
  return typeof entry.release?.swift === "string" ? "prod" : "dev";
}

/** Does this entry have a plane the overlay can link back (released, with a checkout coordinate)? */
export function overlayable(entry) {
  return npmPlane(entry) === "prod" || cargoPlane(entry) === "prod" || swiftPlane(entry) === "prod";
}

/** The manifest line a Swift plane's release is rendered into: `let <name>Release: Version? = nil` (committed dev) or
 * `= "<version>"` (prod). Rewritten in place; a manifest without the line is MISSING, never appended to. */
export function applySwiftRelease(text, name, version) {
  const re = new RegExp(`^let ${escapeRe(name)}Release: Version\\? = (nil|"[^"]*")$`, "m");
  const m = text.match(re);
  if (m === null) return { text, changed: [], missing: [`${name}Release`] };
  const to = version === undefined ? "nil" : `"${version}"`;
  if (m[1] === to) return { text, changed: [], missing: [] };
  return {
    text: text.replace(re, `let ${name}Release: Version? = ${to}`),
    changed: [{ pkg: `${name}Release`, from: m[1], to }],
    missing: [],
  };
}

/** The overlay's cargo config source. Absolute paths: a config file's relative path resolves against the directory that
 * holds `.cargo/`, and an absolute one cannot be misread. */
export function overlayCargoConfig(rows) {
  return `${OVERLAY_CARGO_HEADER} — the local dev overlay's cargo half: path patches over the committed git + rev rows.
# Never committed (.gitignore names it); \`use --none\` deletes it. Cargo applies a configuration file's [patch] over the
# manifest's for the same crate, so \`cargo build\` here builds the linked checkout.
[patch.crates-io]
${[...rows].map(([crate, dir]) => `${crate} = { path = ${JSON.stringify(dir)} }`).join("\n")}
`;
}

/** The npm plane of an entry: `none` (no packages), `dev` (committed as link: rows — no release yet) or `prod`
 * (committed as the exact `release.npm` version). */
export function npmPlane(entry) {
  if (Object.keys(entry.packages ?? {}).length === 0) return "none";
  return typeof entry.release?.npm === "string" ? "prod" : "dev";
}

/** The row a lock package carries in the COMMITTED overrides block: the release version when its sibling's npm
 * plane is released, else the link: row into the pinned checkout. One rule, three askers: `render --prod` writes
 * it, the pre-commit hook and preflight check it. */
export function committedNpmRow(entry, pkg) {
  return npmPlane(entry) === "prod" ? entry.release.npm : linkRow(entry, entry.packages[pkg]);
}

/** The row a lock crate carries in the COMMITTED [patch.crates-io] section: a `git`+`rev` patch when the sibling's
 * cargo plane is released (RD-D5's prod coordinate for a fork line), else the path into the pinned checkout. */
export function committedCargoRow(entry, crate) {
  const release = entry.release?.cargo;
  if (release?.git && release?.rev) return `{ git = "${release.git}", rev = "${release.rev}" }`;
  return `{ path = "${patchPath(entry, entry.patch[crate])}" }`;
}

/** The siblings the local overlay links, as `use` recorded them (`[]` when there is no overlay). */
export function readOverlay(root = REPO_ROOT) {
  try {
    const state = JSON.parse(readFileSync(join(root, OVERLAY_STATE), "utf8"));
    return Array.isArray(state.linked) ? state.linked.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/** Every npm package LINKED in this tree right now, `Map<pkg, { sibling, dir, via }>`: the committed dev rows
 * (`via: "committed"`) and the overlay's links over a released sibling (`via: "overlay"`). The question the
 * single-copy guard and the shape both ask — never `entry.packages` alone, which since RD-1 also names a released
 * sibling's packages (the overlay's link targets) that this tree installs from the registry. */
export function linkedPackages(
  root = REPO_ROOT,
  lock = readLock(root),
  overlay = readOverlay(root),
) {
  const out = new Map();
  for (const [name, entry] of Object.entries(lock?.siblings ?? {})) {
    const plane = npmPlane(entry);
    const via =
      plane === "dev" ? "committed" : plane === "prod" && overlay.includes(name) ? "overlay" : null;
    if (via === null) continue;
    for (const [pkg, packageDir] of Object.entries(entry.packages)) {
      out.set(pkg, { sibling: name, dir: join(siblingDir(root, entry), packageDir), via });
    }
  }
  return out;
}

/** The dependency SHAPE (RD-D10): what each sibling reaches this tree as, plane by plane, with the overlay
 * marked. `mode` is `prod` only when no plane is a checkout. One function, printed by preflight, `status` and
 * `use` in the same words. */
export function siblingShape(root = REPO_ROOT, lock = readLock(root), overlay = readOverlay(root)) {
  const parts = [];
  let dev = false;
  for (const [name, entry] of Object.entries(lock?.siblings ?? {})) {
    const planes = [];
    const linked = Object.keys(entry.packages ?? {}).length;
    const npm = npmPlane(entry);
    if (npm === "dev") {
      planes.push(`npm link ×${linked}`);
      dev = true;
    } else if (npm === "prod" && overlay.includes(name)) {
      planes.push(`npm link ×${linked} (overlay over ${entry.release.npm})`);
      dev = true;
    } else if (npm === "prod") {
      planes.push(`npm exact ${entry.release.npm} ×${linked}`);
    }
    if (entry.cargo) {
      planes.push(`${entry.cargo.crate} built from the checkout`);
      dev = true;
    }
    const patched = Object.keys(entry.patch ?? {}).length;
    const cargo = cargoPlane(entry);
    if (cargo === "dev") {
      planes.push(`cargo patch ×${patched}`);
      dev = true;
    } else if (cargo === "prod") {
      // the rev is named only when it is not the checkout's own revision (the entry's `@ sha` already says that one)
      const rev = entry.release.cargo.rev;
      const own = rev === entry.sha;
      if (overlay.includes(name)) {
        planes.push(
          `cargo patch ×${patched} (overlay over git${own ? "" : ` ${rev.slice(0, 7)}`})`,
        );
        dev = true;
      } else {
        planes.push(`cargo git patch ×${patched}${own ? "" : ` @ ${rev.slice(0, 7)}`}`);
      }
    }
    const swift = swiftPlane(entry);
    if (swift === "dev") {
      planes.push("swift path package");
      dev = true;
    } else if (swift === "prod" && overlay.includes(name)) {
      planes.push(`swift path package (overlay over ${entry.release.swift})`);
      dev = true;
    } else if (swift === "prod") {
      planes.push(`swift exact ${entry.release.swift}`);
    }
    if (entry.go) {
      planes.push(`${entry.go.binary} built from the checkout`);
      dev = true;
    }
    parts.push(`${name} ${planes.join(" + ") || "checkout"} @ ${entry.sha.slice(0, 7)}`);
  }
  const line = dev
    ? `shape: dev — ${parts.join(" · ")}`
    : parts.length > 0
      ? `shape: prod — ${parts.join(" · ")}`
      : "shape: prod — no sibling checkout in the build";
  return { mode: dev ? "dev" : "prod", parts, overlay, line };
}

/** The `overrides:` block of pnpm-workspace.yaml as a line range `[start, end)` (start = the first row after the
 * key), or null when the file has none. A row is only ever rewritten inside it: the same package name also appears
 * in `minimumReleaseAgeExclude`, as a list item this must never touch. */
function overridesRange(lines) {
  const start = lines.findIndex((l) => /^overrides:\s*$/.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end].length === 0 || /^\s/.test(lines[end]))) end += 1;
  return [start + 1, end];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Rewrite the overrides rows named in `rows` (`Map<pkg, value>`) in place, keeping each line's indentation, key
 * quoting and value quoting. `{ text, changed: [{pkg, from, to}], missing: [pkg] }` — a row the block does not
 * carry is MISSING, never appended: where a row sits (under which comment) is a human's choice, made once. */
export function applyNpmRows(text, rows) {
  const lines = text.split("\n");
  const range = overridesRange(lines);
  const changed = [];
  const missing = [];
  for (const [pkg, value] of rows) {
    const re = new RegExp(
      `^(\\s+)(['"]?)${escapeRe(pkg)}\\2(\\s*:\\s*)(['"]?)([^\\s'"#]+)\\4(.*)$`,
    );
    let hit = false;
    if (range !== null) {
      for (let i = range[0]; i < range[1]; i += 1) {
        const m = lines[i].match(re);
        if (m === null) continue;
        hit = true;
        if (m[5] !== value) {
          changed.push({ pkg, from: m[5], to: value });
          lines[i] = `${m[1]}${m[2]}${pkg}${m[2]}${m[3]}${m[4]}${value}${m[4]}${m[6]}`;
        }
        break;
      }
    }
    if (!hit) missing.push(pkg);
  }
  return { text: lines.join("\n"), changed, missing };
}

/** The cargo half of `applyNpmRows`: rows inside `[patch.crates-io]`, one per line (the shape `cargoPatchRows`
 * reads), rewritten as `crate = <row>`. */
export function applyCargoRows(text, rows) {
  const lines = text.split("\n");
  const changed = [];
  const missing = [];
  for (const [crate, row] of rows) {
    let inSection = false;
    let hit = false;
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("[")) {
        inSection = trimmed === "[patch.crates-io]";
        continue;
      }
      if (!inSection) continue;
      const m = lines[i].match(
        new RegExp(`^(\\s*)${escapeRe(crate)}(\\s*=\\s*)(\\{.*\\})(\\s*(?:#.*)?)$`),
      );
      if (m === null) continue;
      hit = true;
      if (m[3] !== row) {
        changed.push({ pkg: crate, from: m[3], to: row });
        lines[i] = `${m[1]}${crate}${m[2]}${row}${m[4]}`;
      }
      break;
    }
    if (!hit) missing.push(crate);
  }
  return { text: lines.join("\n"), changed, missing };
}

/** A file as the index holds it (`git show :<rel>`), or null when the index has no such path. */
function stagedText(root, rel) {
  try {
    return execFileSync("git", ["show", `:${rel}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
  } catch {
    return null;
  }
}

/** `render --prod`: the committed sibling rows written (or, with `check`, compared) from the lock. `staged` reads
 * the lock and both manifests from the git index — the pre-commit hook's question: does the commit about to be
 * made carry exactly the shape its own lock renders? Returns the exit code; every difference is said in words. */
export function renderProd(root = REPO_ROOT, { check = false, staged = false } = {}) {
  const read = (rel) => {
    if (staged) return stagedText(root, rel);
    try {
      return readFileSync(join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const lockText = read(LOCK_FILE);
  const lock = lockText === null ? null : JSON.parse(lockText);
  const npmRows = new Map();
  const cargoRows = new Map();
  for (const entry of Object.values(lock?.siblings ?? {})) {
    for (const pkg of Object.keys(entry.packages ?? {}))
      npmRows.set(pkg, committedNpmRow(entry, pkg));
    for (const crate of Object.keys(entry.patch ?? {}))
      cargoRows.set(crate, committedCargoRow(entry, crate));
  }
  const where = staged ? " (staged)" : "";
  const problems = [];
  const writes = [];
  const swiftLines = new Map();
  // the working tree carries the overlay's line for a linked Swift plane (nil — the path package); the index, which is
  // what a commit carries, always the lock's
  const overlay = staged ? [] : readOverlay(root);
  for (const [name, entry] of Object.entries(lock?.siblings ?? {})) {
    if (!entry.swift) continue;
    if (!swiftLines.has(entry.swift.manifest)) swiftLines.set(entry.swift.manifest, new Map());
    const linked = overlay.includes(name) && swiftPlane(entry) === "prod";
    swiftLines.get(entry.swift.manifest).set(name, linked ? undefined : entry.release?.swift);
  }
  const applySwift = (text, rows) => {
    let out = text;
    const changed = [];
    const missing = [];
    for (const [name, version] of rows) {
      const r = applySwiftRelease(out, name, version);
      out = r.text;
      changed.push(...r.changed);
      missing.push(...r.missing);
    }
    return { text: out, changed, missing };
  };
  for (const [rel, rows, apply] of [
    ["pnpm-workspace.yaml", npmRows, applyNpmRows],
    ["Cargo.toml", cargoRows, applyCargoRows],
    ...[...swiftLines].map(([manifest, rows]) => [manifest, rows, applySwift]),
  ]) {
    if (rows.size === 0) continue;
    const text = read(rel);
    if (text === null) {
      problems.push(
        `${rel}${where} is absent but ${LOCK_FILE} renders ${rows.size} row(s) into it`,
      );
      continue;
    }
    const result = apply(text, rows);
    for (const pkg of result.missing) {
      problems.push(
        `${rel}${where} has no row for ${pkg} — ${LOCK_FILE} renders "${rows.get(pkg) ?? "nil"}"; add the row once (where it sits is a human's choice), render keeps it`,
      );
    }
    for (const { pkg, from, to } of result.changed) {
      const how = check
        ? `${rel}${where}: ${pkg} reads ${from} but ${LOCK_FILE} renders ${to}`
        : `render: ${rel}: ${pkg} ${from} → ${to}`;
      (check ? problems : writes).push(how);
    }
    if (!check && result.changed.length > 0) writeFileSync(join(root, rel), result.text);
  }
  if (staged) {
    const hidden = [
      "Cargo.lock",
      ...[...swiftLines.keys()].map((manifest) => join(dirname(manifest), "Package.resolved")),
    ].filter((rel) => lockHidden(root, rel) === true);
    for (const rel of hidden) {
      problems.push(
        `${rel} is skip-worktree — an overlay is active (\`pnpm siblings use\`), so this commit could not carry a real lock change; \`pnpm siblings use --none\` first`,
      );
    }
  }
  for (const line of writes) console.log(line);
  for (const line of problems) console.error(`siblings:render FAIL: ${line}`);
  if (problems.length > 0) {
    if (staged) {
      console.error(
        "siblings:render: the commit would carry a sibling shape its own lock does not render — a dev overlay that leaked, or a hand-edited row. Fix the row (`node scripts/siblings.mjs render --prod`) or move the pin in the lock (EL8); SKIP_SHAPE=1 bypasses, said in the commit.",
      );
    }
    return 1;
  }
  if (check || writes.length === 0) {
    console.log(
      `siblings:render: the committed rows${where} are the lock's (${npmRows.size} npm, ${cargoRows.size} cargo, ${[...swiftLines.values()].reduce((n, m) => n + m.size, 0)} swift)`,
    );
  }
  return 0;
}

/** The overlay's pnpmfile source (RD-1, measured at RD-2 against pnpm 11.13.1). `updateConfig` does the linking:
 * pnpm applies the workspace's `overrides` AFTER a pnpmfile's readPackage (createReadPackageHook pushes
 * createVersionsOverrider last), so the committed exact row would win over a readPackage link: — the overrides are
 * rewritten when pnpm loads its config instead — and with them `lockfileDir` (the dev lock under .vibefield/dev: any
 * pnpmfile writes its checksum into the lock it installs with, so the committed lock is never the overlay's) and
 * `virtualStoreDir` (this tree's one store — under a moved lockfile directory pnpm would build a second). pnpm resolves
 * a relative `link:` override against the LOCKFILE directory, so every relative link: row (the committed dev siblings)
 * is made absolute against the workspace root here. `readPackage` gives the workspace root manifest the linked
 * packages' own `dependencies`: pnpm never installs a link:'s dependencies, so the host installs them once, and
 * `alignOverlay` links them into the checkout — one copy of each, this tree's (the FS-1b hostPeers recipe, for
 * dependencies as well as peers). Generated, never edited. */
export function overlayPnpmfile({ root, rootName, links, hostDeps }) {
  const json = (value) => JSON.stringify(value, null, 2);
  return `// GENERATED by \`node scripts/siblings.mjs use\` (RD-1/RD-2) — the local dev overlay over the committed prod shape.
// Never committed (.gitignore names it); \`use --none\` deletes it. pnpm loads a root .pnpmfile.cjs by default, so every
// pnpm command in this tree — install, run, exec — sees the overlay; the dev lockfile lives under .vibefield/dev.
const path = require("node:path");
const ROOT = ${json(root)};
const ROOT_NAME = ${json(rootName)};
const LINKS = ${json(Object.fromEntries(links))};
const HOST_DEPS = ${json(Object.fromEntries(hostDeps))};
function readPackage(pkg) {
  if (pkg.name === ROOT_NAME) pkg.dependencies = { ...HOST_DEPS, ...(pkg.dependencies ?? {}) };
  return pkg;
}
function updateConfig(config) {
  const overrides = {};
  for (const [name, value] of Object.entries(config.overrides ?? {})) {
    overrides[name] =
      typeof value === "string" && value.startsWith("link:") && !path.isAbsolute(value.slice(5))
        ? \`link:\${path.resolve(ROOT, value.slice(5))}\`
        : value;
  }
  for (const [name, dir] of Object.entries(LINKS)) overrides[name] = \`link:\${dir}\`;
  // the dev resolution goes to the dev lockfile, never the committed one; the virtual store stays this tree's ONE store
  return {
    ...config,
    overrides,
    lockfileDir: path.join(ROOT, ${json(OVERLAY_DIR)}),
    virtualStoreDir: path.join(ROOT, "node_modules", ".pnpm"),
  };
}
module.exports = { hooks: { readPackage, updateConfig } };
`;
}

/** Is the committed Cargo.lock marked skip-worktree (the cargo overlay is active)? null when git cannot say. */
export function cargoLockHidden(root = REPO_ROOT) {
  return lockHidden(root, "Cargo.lock");
}

/** Is a committed lock file (`rel`) marked skip-worktree? null when git cannot say. */
export function lockHidden(root, rel) {
  try {
    return execFileSync("git", ["ls-files", "-v", "--", rel], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .startsWith("S ");
  } catch {
    return null;
  }
}

/** RD-3's lock rule: stable cargo has no lockfile path of its own (`-Z lockfile-path` is nightly), so a build through the
 * overlay's path patches rewrites the committed Cargo.lock's git sources as path entries. While the cargo overlay is
 * active the committed Cargo.lock is marked skip-worktree — `git status` stays the committed shape, and the pre-commit
 * check refuses any commit (a real lock change cannot be committed from dev shape); removing the overlay clears the
 * mark and restores the committed lock. */
function hideCargoLock(root, hide) {
  hideLock(root, "Cargo.lock", hide);
}

/** The lock rule for any committed lock an overlay's resolution rewrites (Cargo.lock; a Swift manifest's
 * Package.resolved, whose URL row a path overlay drops): skip-worktree while the overlay stands, restored after. */
function hideLock(root, rel, hide) {
  const tracked = execFileSync("git", ["ls-files", "--", rel], {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  if (tracked.length === 0) return;
  if (hide) {
    execFileSync("git", ["update-index", "--skip-worktree", "--", rel], { cwd: root });
    return;
  }
  if (lockHidden(root, rel) !== true) return;
  execFileSync("git", ["update-index", "--no-skip-worktree", "--", rel], { cwd: root });
  execFileSync("git", ["checkout", "--", rel], { cwd: root });
}

/** Write the overlay's cargo config for `crates` (`Map<crate, absDir>`), or remove it when empty — and NEVER touch a
 * `.cargo/config.toml` this verb did not write (a developer's own is refused, said in words). */
function writeOverlayCargo(root, crates) {
  const file = join(root, OVERLAY_CARGO);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (existing !== null && !existing.startsWith(OVERLAY_CARGO_HEADER)) {
    if (crates.size === 0) return;
    throw new Error(
      `siblings:use: ${OVERLAY_CARGO} exists and was not written by this verb — move it aside, then \`use\` again`,
    );
  }
  if (crates.size === 0) {
    if (existing !== null) {
      rmSync(file, { force: true });
      // the directory too, when the generated config was all it held (a developer's own files keep it)
      try {
        if (readdirSync(dirname(file)).length === 0) rmdirSync(dirname(file));
      } catch {}
    }
    hideCargoLock(root, false);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, overlayCargoConfig(crates));
  hideCargoLock(root, true);
}

/** The Swift half of the overlay: each released Swift plane's `let <name>Release` line rendered in the working tree's
 * manifest — nil while the sibling is linked (the path package), the lock's version otherwise. A line rewrite, never a
 * checkout, so any other edit to the manifest survives; the manifest stays VISIBLE as modified while the overlay stands
 * (hand-written source — hiding it would hide a real edit), and the manifest's Package.resolved, whose URL row the path
 * package drops, is hidden by the lock rule. Returns the lines rendered nil, as `manifest: <name>Release`. */
function writeOverlaySwift(root, lock, linked) {
  const byManifest = new Map();
  for (const [name, entry] of Object.entries(lock?.siblings ?? {})) {
    if (swiftPlane(entry) !== "prod") continue;
    if (!byManifest.has(entry.swift.manifest)) byManifest.set(entry.swift.manifest, []);
    byManifest.get(entry.swift.manifest).push([name, entry.release.swift]);
  }
  const rendered = [];
  for (const [manifest, rows] of byManifest) {
    const file = join(root, manifest);
    let text = readFileSync(file, "utf8");
    let any = false;
    for (const [name, version] of rows) {
      const on = linked.includes(name);
      const r = applySwiftRelease(text, name, on ? undefined : version);
      if (r.missing.length > 0) {
        throw new Error(
          `siblings:use: ${manifest} has no \`let ${name}Release: Version? = …\` line — add it once (render keeps it)`,
        );
      }
      text = r.text;
      if (on) {
        any = true;
        rendered.push(`${manifest}: ${name}Release`);
      }
    }
    if (text !== readFileSync(file, "utf8")) writeFileSync(file, text);
    hideLock(root, join(dirname(manifest), "Package.resolved"), any);
  }
  return rendered;
}

/** `render --dev`: the overlay files for the siblings `linked` names (each must be a released sibling), written
 * under .vibefield/dev — or removed when `linked` is empty. Returns `{ links: Map<pkg, absDir> }`. */
export function renderOverlay(root, linked, lock = readLock(root)) {
  const links = new Map();
  const crates = new Map();
  for (const name of linked) {
    const entry = lock?.siblings?.[name];
    if (entry === undefined) throw new Error(`siblings:use: unknown sibling ${name}`);
    if (cargoPlane(entry) === "prod") {
      for (const [crate, crateDir] of Object.entries(entry.patch)) {
        crates.set(crate, join(siblingDir(root, entry), crateDir));
      }
    }
    if (npmPlane(entry) !== "prod") continue;
    for (const [pkg, packageDir] of Object.entries(entry.packages)) {
      links.set(pkg, join(siblingDir(root, entry), packageDir));
    }
  }
  writeOverlayCargo(root, crates);
  const swift = writeOverlaySwift(root, lock, linked);
  const state = join(root, OVERLAY_STATE);
  const pnpmfile = join(root, OVERLAY_PNPMFILE);
  if (linked.length === 0) {
    rmSync(state, { force: true });
    writeOverlayCargo(root, new Map());
    writeOverlaySwift(root, lock, []);
    rmSync(pnpmfile, { force: true });
    rmSync(join(root, OVERLAY_LOCKFILE), { force: true });
    rmSync(join(root, OVERLAY_DIR, "node_modules"), { recursive: true, force: true });
    return { links, crates, swift };
  }
  mkdirSync(join(root, OVERLAY_DIR), { recursive: true });
  writeFileSync(
    state,
    `${JSON.stringify(
      {
        linked: [...linked].sort(),
        lock: createHash("sha256")
          .update(readFileSync(join(root, LOCK_FILE)))
          .digest("hex")
          .slice(0, 16),
      },
      null,
      2,
    )}\n`,
  );
  if (links.size > 0) {
    const hostDeps = new Map();
    for (const dir of links.values()) {
      let manifest = {};
      try {
        manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      } catch {
        manifest = {};
      }
      for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
        if (!links.has(dep) && !hostDeps.has(dep)) hostDeps.set(dep, range);
      }
    }
    const rootName = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
    writeFileSync(pnpmfile, overlayPnpmfile({ root, rootName, links, hostDeps }));
  } else rmSync(pnpmfile, { force: true });
  return { links, crates, swift };
}

/** The overlay's last step, after its install (RD-2): every dependency and peer a LINKED package declares is linked
 * into the checkout's own node_modules from this tree's virtual store (its hidden hoist, `node_modules/.pnpm/
 * node_modules`), so the checkout's code resolves exactly the copies this tree resolves — the single-copy law in
 * dev shape. Only generated node_modules links change in the checkout; its sources and lock stay at the pin. A name
 * the store does not hold is returned, never guessed. */
export function alignOverlay(root, lock = readLock(root), overlay = readOverlay(root)) {
  const hoist = join(root, "node_modules", ".pnpm", "node_modules");
  const missing = [];
  for (const [pkg, { dir, via }] of linkedPackages(root, lock, overlay)) {
    if (via !== "overlay") continue;
    // pnpm keeps the store's copy in its hidden hoist after the overlay's install, where a package inside the store
    // that reaches this name by hoisting would still find the registry copy — the second copy the single-copy law
    // forbids. Point the hoist at the checkout too; the way back's frozen install re-hoists the store's copy.
    const hoisted = join(hoist, pkg);
    mkdirSync(dirname(hoisted), { recursive: true });
    rmSync(hoisted, { recursive: true, force: true });
    symlinkSync(dir, hoisted, process.platform === "win32" ? "junction" : "dir");
    let manifest = {};
    try {
      manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      manifest = {};
    }
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    for (const name of names) {
      let source;
      try {
        source = realpathSync(join(hoist, name));
      } catch {
        missing.push(`${pkg} → ${name}`);
        continue;
      }
      const destination = join(dir, "node_modules", name);
      mkdirSync(dirname(destination), { recursive: true });
      rmSync(destination, { recursive: true, force: true });
      symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
    }
  }
  return missing;
}

/** The environment a shape install runs under (RD-2): the caller's, minus any `pnpm_config_*` key that would pick a
 * pnpmfile, a lockfile directory or a virtual store of its own. The overlay is the root .pnpmfile.cjs alone — an
 * exported `pnpm_config_pnpmfile` would make pnpm skip the default pnpmfile (11.13.1: `tryLoadDefaultPnpmfile` is
 * `pnpmfile == null`), and a stray lockfile or store directory would install the wrong shape quietly. */
export function shapeInstallEnv(base = process.env) {
  const env = { ...base };
  for (const key of [
    "pnpm_config_pnpmfile",
    "pnpm_config_lockfile_dir",
    "pnpm_config_virtual_store_dir",
  ]) {
    delete env[key];
  }
  return env;
}

/** The committed lock rewritten as the dev lock's starting point: its importer keys rebased from the workspace root
 * to the lockfile directory (`.` → `../..`), so pnpm reuses every resolution and re-resolves only what the overlay
 * changed — a dev lock resolved from nothing would let unrelated versions drift from the committed ones. */
export function seedDevLock(committed, prefix = "../..") {
  const lines = committed.split("\n");
  let inImporters = false;
  return lines
    .map((line) => {
      if (/^\S/.test(line)) inImporters = line === "importers:";
      if (!inImporters) return line;
      const m = line.match(/^ {2}(['"]?)([^'"\s:][^'"]*|\.)\1:$/);
      if (m === null) return line;
      return `  ${m[2] === "." ? prefix : `${prefix}/${m[2]}`}:`;
    })
    .join("\n");
}

/** Install the tree in its shape: through the overlay (the dev lock seeded from the committed one, then the
 * checkout's dependencies aligned) when one is recorded, else the committed lock, frozen. The exit code. */
export function installShape(root, overlay = readOverlay(root), previous = []) {
  if (overlay.length > 0) {
    writeFileSync(
      join(root, OVERLAY_LOCKFILE),
      seedDevLock(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")),
    );
  }
  const args = overlay.length > 0 ? ["install"] : ["install", "--frozen-lockfile"];
  console.log(
    `siblings:use: pnpm ${args.join(" ")}${overlay.length > 0 ? ` (the overlay ${OVERLAY_PNPMFILE}; the dev lock ${OVERLAY_LOCKFILE})` : " (the committed lock)"}`,
  );
  const run = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    env: shapeInstallEnv(),
    shell: process.platform === "win32",
  });
  if (run.error) throw run.error;
  if (run.status !== 0) return run.status ?? 1;
  if (overlay.length === 0 && previous.length > 0) {
    const lock = readLock(root);
    const packages = previous.flatMap((name) =>
      Object.keys(lock?.siblings?.[name]?.packages ?? {}),
    );
    for (const line of unalignOverlay(root, packages, lock)) console.log(`siblings:use: ${line}`);
  }
  const electron = ensureElectronBinary(root);
  if (electron !== null) console.log(`siblings:use: ${electron}`);
  if (overlay.length > 0) {
    const missing = alignOverlay(root, readLock(root), overlay);
    if (missing.length > 0) {
      console.error(
        `siblings:use FAIL: the installed store holds no copy of ${missing.join(", ")} — a linked package's dependency the host did not install`,
      );
      return 1;
    }
  }
  return 0;
}

/** The way back's last step (RD-2): pnpm's frozen install of the committed shape does not re-hoist a name whose
 * hoist entry the overlay re-pointed, so the hidden hoist would still lead into the checkout — a second copy in prod
 * shape. Each package the overlay linked gets its hoist entry pointed back at the store's copy of its release, or
 * removed when the store holds none (said, never guessed). */
export function unalignOverlay(root, packages, lock = readLock(root)) {
  const store = join(root, "node_modules", ".pnpm");
  const said = [];
  for (const pkg of packages) {
    const hoisted = join(store, "node_modules", pkg);
    let target = null;
    try {
      target = realpathSync(hoisted);
    } catch {
      target = null;
    }
    if (target?.startsWith(`${realpathSync(store)}/`)) continue;
    const entry = Object.values(lock?.siblings ?? {}).find((e) => e.packages?.[pkg]);
    const version = entry?.release?.npm;
    const prefix = `${pkg.replace("/", "+")}@${version}`;
    const copy =
      version === undefined
        ? undefined
        : readdirSync(store)
            .filter((d) => d === prefix || d.startsWith(`${prefix}_`))
            .map((d) => join(store, d, "node_modules", pkg))
            .find((d) => existsSync(join(d, "package.json")));
    rmSync(hoisted, { recursive: true, force: true });
    if (copy !== undefined) {
      symlinkSync(copy, hoisted, process.platform === "win32" ? "junction" : "dir");
      said.push(`${pkg} → the store's ${version}`);
    } else {
      said.push(`${pkg} → hoist entry removed (no store copy of ${version ?? "its release"})`);
    }
  }
  return said;
}

/** A shape switch's last step (RD-2): pnpm re-creates a package's store directory when a switch moves it (the dev
 * resolution dropped Electron's optional `supports-color` peer, so Electron moves between two directories), and
 * Electron's binary — `dist/` and `path.txt`, written by its own `install.js` from the download cache — is not in the
 * content store, nor re-run by pnpm on re-creation (no switch's log shows Electron's postinstall). So this tree's
 * Electron gets its binary here when `path.txt` is missing, as a fresh lane does. Returns what it did. */
export function ensureElectronBinary(root = REPO_ROOT) {
  // THIS tree's Electron only — the desktop's own node_modules, then the root's — never Node's search beyond the root
  // (a parent directory's or a global folder's Electron is not the one the desktop runs)
  const found = [
    join(root, "apps", "desktop", "node_modules", "electron"),
    join(root, "node_modules", "electron"),
  ].find((candidate) => existsSync(join(candidate, "package.json")));
  if (found === undefined) return "no Electron resolvable from apps/desktop";
  const dir = realpathSync(found);
  if (existsSync(join(dir, "path.txt"))) return null;
  const run = spawnSync(process.execPath, [join(dir, "install.js")], {
    cwd: dir,
    stdio: "inherit",
  });
  if (run.status !== 0 || !existsSync(join(dir, "path.txt"))) {
    throw new Error(
      `siblings:use: Electron's binary is missing at ${dir} and its install.js did not restore it (exit ${run.status}) — run \`node install.js\` there`,
    );
  }
  return `Electron's binary installed at ${relative(realpathSync(root), dir)} (the store directory was re-created)`;
}

/** `use NAME…` / `use --none` / `use`: the per-sibling switch (RD-D2). Only a sibling with a released plane can be
 * overlaid — one committed in dev shape is linked already, and saying so is the answer, not an error. */
export function useSiblings(root, args) {
  const lock = readLock(root);
  if (lock === null) {
    console.error(`siblings:use FAIL: ${LOCK_FILE} is absent — nothing to link`);
    return 1;
  }
  const install = !args.includes("--no-install");
  args = args.filter((a) => a !== "--no-install");
  const current = readOverlay(root);
  if (args.length === 0) {
    console.log(siblingShape(root, lock, current).line);
    console.log(
      current.length > 0 ? `overlay: ${current.join(", ")}` : "overlay: none — the committed shape",
    );
    return 0;
  }
  let next;
  if (args.includes("--none")) {
    if (args.length > 1) {
      console.error("siblings:use FAIL: --none takes no sibling names");
      return 2;
    }
    next = [];
  } else {
    const unknown = args.filter((n) => n.startsWith("--") || !Object.hasOwn(lock.siblings, n));
    if (unknown.length > 0) {
      console.error(
        `siblings:use FAIL: unknown sibling ${unknown.join(" ")} — the lock names ${Object.keys(lock.siblings).join(", ")}`,
      );
      return 2;
    }
    next = [...new Set(current)];
    for (const name of args) {
      const entry = lock.siblings[name];
      if (overlayable(entry)) {
        if (!next.includes(name)) next.push(name);
        continue;
      }
      console.log(
        `siblings:use: ${name} is committed in dev shape already (no release coordinate in ${LOCK_FILE}) — its checkout is what this tree builds; RD-5 records its release`,
      );
    }
  }
  const { links, crates, swift } = renderOverlay(root, next, lock);
  // pnpm installs only when the overlay's npm half changed (RD-3): a cargo or Swift plane links through its own file,
  // which cargo and SwiftPM read at their next build — an npm install for it would be churn at best
  const npmOf = (names) =>
    names.filter((name) => lock.siblings[name] && npmPlane(lock.siblings[name]) === "prod");
  const nextNpm = npmOf(next);
  const previousNpm = npmOf(current);
  const npmChanged =
    nextNpm.length !== previousNpm.length || nextNpm.some((name) => !previousNpm.includes(name));
  if (install && npmChanged) {
    const installed = installShape(
      root,
      nextNpm,
      previousNpm.filter((name) => !nextNpm.includes(name)),
    );
    if (installed !== 0) return installed;
  }
  console.log(siblingShape(root, lock, next).line);
  if (next.length === 0) {
    console.log(
      `overlay: none — the committed shape, which is what CI sees${install ? "" : " (not installed: --no-install)"}`,
    );
  } else {
    const halves = [];
    if (links.size > 0) {
      halves.push(
        `${links.size} npm package(s) linked from their checkouts${install ? "" : " (written, not installed: --no-install)"}`,
      );
    }
    if (crates.size > 0) halves.push(`${crates.size} crate(s) patched through ${OVERLAY_CARGO}`);
    for (const line of swift) {
      halves.push(`${line} rendered nil (the path package; the manifest shows modified)`);
    }
    console.log(`overlay: ${next.join(", ")} — ${halves.join(" · ") || "nothing to link"}`);
  }
  return 0;
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

/** The newest mtime (ms) among a Go module's own sources — `*.go` plus
 * `go.mod`/`go.sum` — or null when the directory holds none. Same question as
 * `newestSourceMtime` asks of cargo, for the same reason: "is the built binary
 * older than a source it was built from" is answerable and stable, where "is it
 * older than HEAD's commit time" nags forever after a build that preceded its
 * own commit. Unlike cargo, `go build` has no fingerprint of its own to ask, so
 * this IS the freshness check rather than a hint before one. */
export function newestGoSourceMtime(moduleDir) {
  let newest = null;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "testdata" || entry.name === "vendor" || entry.name.startsWith(".")) {
        continue;
      }
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.go$/.test(entry.name) && entry.name !== "go.mod" && entry.name !== "go.sum") {
        continue;
      }
      try {
        const time = statSync(full).mtimeMs;
        if (newest === null || time > newest) newest = time;
      } catch {
        // vanished mid-walk: not a source we could build from anyway
      }
    }
  };
  walk(moduleDir);
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

/** Every sibling's stamp on one line — the Nx runtime input. A go sibling also
 * stamps its BUILT binary's mtime (or `absent`): the checkout hash above covers
 * what the sidecar would be built FROM, and this covers what is actually beside
 * the floor right now, which is the thing a run sees. */
export function stamp(root = REPO_ROOT) {
  const lock = readLock(root);
  if (lock === null) return "no-siblings-lock";
  const sidecar = goSidecar(root);
  // RD-1: the overlay is part of what a run builds — a cache filled with a sibling linked must never answer for the
  // committed shape, and the reverse (thinking-release-deps.md §2, "the Nx sibling stamp reads the mode").
  const overlay = readOverlay(root);
  const mode = overlay.length > 0 ? ` overlay:${[...overlay].sort().join(",")}` : "";
  return `${Object.entries(lock.siblings)
    .map(([name, entry]) => {
      const base = `${name}@${siblingStamp(siblingDir(root, entry))}`;
      if (sidecar === null || sidecar.name !== name) return base;
      let built = "absent";
      try {
        built = String(Math.floor(statSync(sidecar.path).mtimeMs));
      } catch {
        built = "absent";
      }
      return `${base}+${sidecar.binary}:${built}`;
    })
    .join(" ")}${mode}`;
}

const targetDirCache = new Map();

/** The environment every cargo call into a sibling runs under: the caller's,
 * minus a target-directory override. A lane exports CARGO_TARGET_DIR for ITS
 * OWN workspace (field-native, the fieldd suite's cargo); inherited here it
 * would move the sibling's build too — `cargo metadata` would name a directory
 * the sibling's build never wrote, and every reader of the lock's rosettad
 * (preflight, the dev runner, wall R23) would call the binary missing, or read
 * another one. The sibling's build is where its OWN configuration puts it, so
 * both spellings of the override (CARGO_TARGET_DIR, CARGO_BUILD_TARGET_DIR)
 * are removed — case-insensitively on win32, where the environment is. */
export function siblingCargoEnv(base = process.env, platform = process.platform) {
  const env = { ...base };
  const dropped = new Set(["CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR"]);
  for (const key of Object.keys(env)) {
    if (dropped.has(platform === "win32" ? key.toUpperCase() : key)) delete env[key];
  }
  return env;
}

/** Where cargo puts artifacts for the checkout — asked of cargo itself, so the
 * sibling's own `.cargo/config.toml` `target-dir` (rosetta keeps its target on
 * the SSD that way, gitignored) is honoured rather than guessed, and a lane's
 * override is not (`siblingCargoEnv`). Null when cargo cannot answer (not
 * installed, checkout missing). Cached per process: the dev runner asks on
 * every Electron restart. */
export function cargoTargetDir(dir) {
  if (targetDirCache.has(dir)) return targetDirCache.get(dir);
  let result = null;
  try {
    const meta = execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
      cwd: dir,
      env: siblingCargoEnv(),
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

/** The sibling entry that carries a `go` block, with the path this repo expects
 * its binary at: `<repo>/target/debug/<binary>`.
 *
 * That location is not a convention — it is where the floor LOOKS. The mesh
 * unit's `resolve_sidecar` (packages/field-native/src/services/mesh.rs) searches
 * the directory of the RUNNING field-native executable first, before any
 * machine-wide install path, so a sidecar built here is the one a dev stack
 * picks up on its next restart with no env var and no override. In this repo
 * `target` is a symlink to the cargo target directory, so "beside the floor
 * binary" and "under target/debug" name one directory; in a worktree that
 * exports its own CARGO_TARGET_DIR they are two, and the symlinks that make
 * repo-relative paths work are what joins them again.
 *
 * Null when the lock names no go sibling. Existence is the caller's question:
 * `build` creates it, preflight WARNs about it (a missing sidecar is a Degraded
 * mesh the floor reports honestly, never a broken gate). */
export function goSidecar(root = REPO_ROOT, platform = process.platform) {
  const lock = readLock(root);
  if (lock === null) return null;
  for (const [name, entry] of Object.entries(lock.siblings)) {
    if (!entry.go) continue;
    const dir = siblingDir(root, entry);
    const binary = platform === "win32" ? `${entry.go.binary}.exe` : entry.go.binary;
    return {
      name,
      dir,
      module: entry.go.module,
      moduleDir: join(dir, entry.go.module),
      binary,
      path: join(root, "target", "debug", binary),
    };
  }
  return null;
}

/** The built go sidecar's state against the sources it was built from:
 * `none` (the lock declares no go sibling), `missing`, `stale` or `fresh`.
 * ONE rule, three consumers — preflight WARNs on it, `pnpm siblings` prints it,
 * and the packaged stage REFUSES on it — because a freshness rule spelled three
 * times is a freshness rule that will disagree with itself. `go build` keeps no
 * fingerprint of its own, so source mtimes are the whole of the question. */
export function goSidecarState(root = REPO_ROOT, platform = process.platform) {
  const sidecar = goSidecar(root, platform);
  if (sidecar === null) return { sidecar: null, state: "none" };
  if (!existsSync(sidecar.moduleDir)) return { sidecar, state: "missing" };
  if (!existsSync(sidecar.path)) return { sidecar, state: "missing" };
  const newest = newestGoSourceMtime(sidecar.moduleDir);
  if (newest !== null && statSync(sidecar.path).mtimeMs < newest)
    return { sidecar, state: "stale" };
  return { sidecar, state: "fresh" };
}

/** WHICH truffle sidecar a PACKAGE must stage, and why — the packaging half of
 * the window (scripts/stage-package.mjs is the caller).
 *
 * The floor resolves its sidecar beside its own executable FIRST, and the stage
 * puts one there, so this decision is what a packaged desktop will actually
 * run. While the window is open the two candidates are not interchangeable: the
 * registry package is the RELEASED sidecar, and a node started gated (UA-P-4
 * passes `login_allow`) refuses to come up against one below protocol 5 —
 * truffle's own words, surfaced by the floor as Degraded. Shipping the released
 * binary beside a floor built from the window would therefore degrade every
 * linked desktop at bring-up, which is why there is no silent fallback here.
 *
 * - `{ source: "npm" }` — no window: the registry package, exactly as before.
 * - `{ source: "window", from }` — window open, binary fresh; `from` is
 *   repo-relative so a stage PLAN row carries it verbatim.
 * - `{ source: "refuse", reason }` — window open, binary missing or stale. The
 *   caller must FAIL: falling back to the registry package would ship a
 *   mismatched pair under a green build. */
export function sidecarStagingSource(root = REPO_ROOT, platform = process.platform) {
  const { sidecar, state } = goSidecarState(root, platform);
  if (state === "none") return { source: "npm" };
  if (state === "fresh") return { source: "window", from: relative(root, sidecar.path), sidecar };
  return {
    source: "refuse",
    sidecar,
    reason:
      `the ${LOCK_FILE} window declares ${sidecar.name}'s ${sidecar.binary} but the built binary is ` +
      `${state} (${sidecar.path}) — run \`pnpm siblings:build\`. Staging the registry sidecar ` +
      "instead would pair a released binary with a floor built from the window, and a gated node " +
      "refuses to start against a sidecar below protocol 5",
  };
}

/** WHICH truffle sidecar a DEVELOPMENT floor runs (`pnpm dev`): the dev half of
 * the decision above, by the same rule (2026-10-17, the truffle bump).
 *
 * A packaged floor finds its sidecar beside itself, where the stage put the
 * pinned one. A debug floor does not: `target/debug` is cargo's, and on a machine
 * whose `~/.cargo/config.toml` shares one target dir across checkouts it holds
 * whatever `sidecar-slim` any checkout's truffle build last dropped there. On
 * 2026-10-17 that was a tailscale v1.104.1 egress-era binary of unknown
 * provenance, with a Jul 16 pre-RFC-025 `~/.config/truffle/bin/sidecar-slim`
 * behind it. A dev floor left to search would run one of those, so the dev
 * runner hands the floor this answer as `FIELD_NATIVE_SIDECAR_PATH`
 * (`tooling/dev-runner/src/electron-stack.mjs`), the way it hands fieldd the
 * lock's rosettad.
 *
 * - `{ source: "npm", path }` — no window: the registry package `apps/desktop`
 *   installs at the EL8 pin (`@vibecook/truffle-sidecar-<platform>-<arch>`);
 *   `path` is null until `pnpm install` has put it on disk.
 * - `{ source: "window", path }` — a window is open and its sidecar is fresh.
 * - `{ source: "window", path: null, reason }` — a window is open and its
 *   sidecar is missing or stale. The floor must not quietly run the registry
 *   binary beside a window build (the staging refusal's reason). With no
 *   answer the floor's own search order decides, and the reason says what to
 *   run.
 *
 * `path: null` means "set nothing". It is never a path to nothing, because the
 * floor treats `FIELD_NATIVE_SIDECAR_PATH` as authoritative and would report
 * the mesh Degraded rather than search. */
export function devSidecar(root = REPO_ROOT, platform = process.platform, arch = process.arch) {
  const staging = sidecarStagingSource(root, platform);
  if (staging.source === "window") return { source: "window", path: staging.sidecar.path };
  if (staging.source === "refuse") return { source: "window", path: null, reason: staging.reason };
  const binary = platform === "win32" ? "sidecar-slim.exe" : "sidecar-slim";
  const path = join(
    root,
    "apps",
    "desktop",
    "node_modules",
    "@vibecook",
    `truffle-sidecar-${platform}-${arch}`,
    "bin",
    binary,
  );
  return { source: "npm", path: existsSync(path) ? path : null };
}

// --- CLI ---------------------------------------------------------------------

/** Fetch only absent checkouts. Existing developer trees, including dirty trees,
 * are never checked out or reset; the revision must already match the pin. */
export function fetchSibling(root, name) {
  const entry = readLock(root)?.siblings[name];
  if (!entry?.repository || !/^[a-f0-9]{40}$/.test(entry.sha)) {
    throw new Error(
      `siblings:fetch: ${name} needs a repository URL and full revision in ${LOCK_FILE}`,
    );
  }
  const dir = siblingDir(root, entry);
  if (!existsSync(dir)) {
    execFileSync("git", ["clone", "--no-checkout", "--", entry.repository, dir], {
      cwd: root,
      stdio: "inherit",
    });
    execFileSync("git", ["checkout", "--detach", entry.sha], { cwd: dir, stdio: "inherit" });
  }
  if (siblingHead(dir) !== entry.sha) {
    throw new Error(
      `siblings:fetch: ${dir} exists but is not at ${entry.sha}; refusing to change it`,
    );
  }
  console.log(`siblings:fetch: ${name} @ ${entry.sha} → ${dir}`);
  return 0;
}

function runNpm(dir, args) {
  console.log(`siblings: npm ${args.join(" ")}  (in ${dir})`);
  const run = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (run.error) throw run.error;
  return run.status ?? 1;
}

/** These packages export generated dist files. Installing VibeField's link:
 * dependencies neither installs the sibling's tools nor builds those files. */
/** A source-linked UI uses the host's peers, just as its renderer does.
 * Only generated node_modules links change; upstream manifests and locks stay
 * at their pin. Re-run after the sibling's frozen install and before building. */
export function alignHostPeers(root, entry) {
  const peers = entry.pnpm?.hostPeers;
  if (!peers) return;
  for (const folder of ["", ...Object.values(entry.packages ?? {})]) {
    for (const name of peers.names) {
      const source = realpathSync(join(root, peers.from, "node_modules", name));
      const destination = join(siblingDir(root, entry), folder, "node_modules", name);
      mkdirSync(dirname(destination), { recursive: true });
      rmSync(destination, { recursive: true, force: true });
      symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
    }
  }
}

function runPnpm(dir, args) {
  const env = { ...process.env };
  if (env.CARGO_TARGET_DIR) env.CARGO_TARGET_DIR = join(env.CARGO_TARGET_DIR, "siblings", "mille");
  const run = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: dir,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (run.error) throw run.error;
  return run.status ?? 1;
}

export function installJavaScript(root, names = []) {
  for (const [name, entry] of Object.entries(readLock(root)?.siblings ?? {})) {
    if (names.length > 0 && !names.includes(name)) continue;
    if (entry.pnpm) {
      const result = runPnpm(siblingDir(root, entry), ["install", "--frozen-lockfile"]);
      if (result !== 0) return result;
      alignHostPeers(root, entry);
    }
    if (!entry.javascript) continue;
    const result = runNpm(siblingDir(root, entry), [
      "ci",
      "--include=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--include-workspace-root=false",
      ...entry.javascript.workspaces.map((name) => `--workspace=${name}`),
    ]);
    if (result !== 0) return result;
  }
  return 0;
}

export function buildJavaScript(root, names = []) {
  let result = null;
  for (const [name, entry] of Object.entries(readLock(root)?.siblings ?? {})) {
    if (names.length > 0 && !names.includes(name)) continue;
    if (entry.pnpm) {
      alignHostPeers(root, entry);
      result = runPnpm(siblingDir(root, entry), entry.pnpm.build);
      if (result !== 0) return result;
      if (entry.pnpm.afterBuild) result = runPnpm(siblingDir(root, entry), entry.pnpm.afterBuild);
      if (result !== 0) return result;
      alignHostPeers(root, entry);
    }
    if (!entry.javascript) continue;
    for (const workspace of entry.javascript.workspaces) {
      result = runNpm(siblingDir(root, entry), ["run", "build", `--workspace=${workspace}`]);
      if (result !== 0) return result;
    }
  }
  return result;
}

function status(root) {
  const lock = readLock(root);
  if (lock === null) {
    console.log(`${LOCK_FILE}: absent (registry mode — no siblings)`);
    return 0;
  }
  // RD-1: the shape first, in preflight's words, then the overlay — the mode is a fact, never a secret (RD-D10).
  const overlay = readOverlay(root);
  console.log(siblingShape(root, lock, overlay).line);
  console.log(
    overlay.length > 0 ? `overlay: ${overlay.join(", ")} (${OVERLAY_PNPMFILE})` : "overlay: none",
  );
  for (const [name, entry] of Object.entries(lock.siblings)) {
    const dir = siblingDir(root, entry);
    const release = entry.release
      ? ` · release ${Object.entries(entry.release)
          .map(
            ([plane, value]) =>
              `${plane} ${typeof value === "string" ? value : JSON.stringify(value)}`,
          )
          .join(", ")}`
      : "";
    if (!existsSync(dir)) {
      console.log(
        `${name.padEnd(10)} MISSING at ${dir} (pinned ${entry.sha.slice(0, 12)})${release}`,
      );
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
    const built = [entry.cargo?.crate, entry.go?.binary].filter(Boolean).join(" + ");
    console.log(`${name.padEnd(10)} ${dir}  ${rev}${tree}${built ? ` · ${built}` : ""}${release}`);
    for (const [pkg, packageDir] of Object.entries(entry.packages ?? {})) {
      const committed = committedNpmRow(entry, pkg);
      const overlaid = npmPlane(entry) === "prod" && overlay.includes(name);
      console.log(
        `           ${pkg} → ${committed}${overlaid ? `  (overlay: ${linkRow(entry, packageDir)})` : ""}`,
      );
    }
    for (const [crate, crateDir] of Object.entries(entry.patch ?? {})) {
      console.log(`           ${crate} → [patch.crates-io] path = "${patchPath(entry, crateDir)}"`);
    }
    if (entry.swift) {
      // The SwiftPM window's identity link, with what it currently resolves to:
      // a dangling or re-pointed link is the one part of the window no manifest
      // states, which is why the lock carries it and preflight verifies it.
      let target = "MISSING";
      try {
        target = realpathSync(join(root, entry.swift.link));
      } catch {
        target = "MISSING";
      }
      console.log(`           ${entry.swift.link} → ${target}`);
    }
  }
  const bin = rosettadBinary(root);
  if (bin?.path) {
    console.log(
      `rosettad   ${bin.path}${existsSync(bin.path) ? "" : "  (NOT BUILT — pnpm siblings:build)"}`,
    );
  }
  const { sidecar, state } = goSidecarState(root);
  if (sidecar !== null) {
    const note =
      state === "missing"
        ? "  (NOT BUILT — pnpm siblings:build)"
        : state === "stale"
          ? "  (STALE — pnpm siblings:build)"
          : "";
    console.log(`${sidecar.binary.padEnd(10)} ${sidecar.path}${note}`);
  }
  return 0;
}

export function pinSiblingHeads(root, names = []) {
  const lock = readLock(root);
  if (lock === null) {
    console.error(
      `siblings:pin FAIL: ${LOCK_FILE} is absent — sibling mode is declared there first`,
    );
    return 1;
  }
  const selected = names.length > 0 ? new Set(names) : new Set(Object.keys(lock.siblings));
  for (const name of selected) {
    if (!Object.hasOwn(lock.siblings, name)) {
      console.error(`siblings:pin FAIL: unknown sibling ${name}`);
      return 1;
    }
  }
  for (const [name, entry] of Object.entries(lock.siblings)) {
    if (!selected.has(name)) continue;
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
      // Name the checkout's OWN origin rather than a repo this file guesses at:
      // the siblings live under different accounts (truffle is vibecook-dev's),
      // and a warning that states a locator it did not read is the class of
      // claim this repo makes at its source or not at all.
      let origin = "";
      try {
        origin = git(dir, ["remote", "get-url", "origin"]);
      } catch {
        origin = "";
      }
      console.warn(
        `siblings:pin WARN: ${name} @ ${head.slice(0, 12)} is on no remote branch — push it before relying on CI${origin ? ` (the clone step fetches the pin from ${origin})` : " (this checkout has no origin remote)"}`,
      );
    }
  }
  writeFileSync(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  return 0;
}

function pin(root, names, { skipTypecheck = false } = {}) {
  const pinned = pinSiblingHeads(root, names);
  if (pinned !== 0) return pinned;
  // A named upgrade leaves other pins intact, but the build and catalog gate
  // read the available checkouts. Never report their HEADs as proof of a
  // different recorded revision. As with a red catalog gate, keep the new pin
  // and fail loudly; changing an unrelated checkout or pin is not ours to do.
  const lock = readLock(root);
  let revisionsMatch = true;
  for (const [name, entry] of Object.entries(lock.siblings)) {
    const dir = siblingDir(root, entry);
    const head = siblingHead(dir);
    if (head === null) {
      console.error(`siblings:pin FAIL: ${name} is not a git checkout at ${dir}`);
      revisionsMatch = false;
    } else if (head !== entry.sha) {
      console.error(
        `siblings:pin FAIL: ${name} HEAD ${head.slice(0, 12)} differs from pin ${entry.sha.slice(0, 12)}`,
      );
      revisionsMatch = false;
    } else if (siblingDirty(dir)) {
      console.warn(
        `siblings:pin WARN: ${name} working tree is dirty — the catalog gate uses uncommitted edits`,
      );
    }
  }
  if (!revisionsMatch) {
    console.error(
      `siblings:pin: the selected pins ARE recorded in ${LOCK_FILE}, but a checkout differs from its resulting pin — build and wall R23 not run; sync it to the pin or deliberately include it in pnpm siblings:pin NAME...`,
    );
    return 1;
  }
  // Wall R23 (AC-2; thinking-ar-agent-catalog.md §6): a pin is the upgrade event
  // at which a catalog decision is owed, so the catalog is proved against the
  // new pins here, with the rosetta half REQUIRED (AC-D10). A red KEEPS the new
  // SHAs — the pin did move — and exits 1 so the event is loud: the
  // maintainer's next act is a row (or an amended one) in
  // packages/contracts/src/agent-catalog.ts, then
  // `pnpm --filter @vibefield/contracts gen:schema`.
  //
  // rosettad is built FIRST (AC-7): the rosetta half asks the lock's own
  // build, and the build on disk predates the pin whenever rosetta moved — a
  // kind the new revision registers, or a data_root it moved, would be
  // invisible to it, and the pin would pass on the old registry. cargo decides
  // freshness itself, so an unmoved rosetta costs a no-op build.
  console.log(
    "siblings:pin: building rosettad at the new pin before wall R23 (a no-op when cargo finds it fresh)",
  );
  const built = buildCargo(root);
  if (built !== null && built !== 0) {
    console.error(
      `siblings:pin: the new pins ARE recorded in ${LOCK_FILE}, but rosettad did not build at them — wall R23 not run (its rosetta half would read a binary that predates the pin); fix the build and re-run pnpm siblings:pin`,
    );
    return 1;
  }
  // The lock's rosettad as buildCargo just resolved it (cached per process),
  // handed over so the checker does not ask cargo a second time.
  const lockRosettad = rosettadBinary(root)?.path ?? null;
  const gate = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./check-agent-catalog.mjs", import.meta.url)),
      "--enforce",
      "--require-rosetta",
      ...(lockRosettad === null ? [] : ["--rosettad", lockRosettad]),
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (gate.status !== 0) {
    // A spawn that failed or a checker killed by a signal printed nothing above.
    const how =
      gate.error !== undefined
        ? `could not run (${gate.error.message})`
        : gate.signal !== null
          ? `was killed by ${gate.signal}`
          : "is red above";
    console.error(
      `siblings:pin: the new pins ARE recorded in ${LOCK_FILE}, and wall R23 ${how} — settle it before relying on them (a missing decision is a row in packages/contracts/src/agent-catalog.ts; declined is a decision)`,
    );
    return 1;
  }
  // The consumers' typecheck (2026-10-04, AR-8c's follow-up). Wall R23 proves
  // the catalog against the new pins, not that a sibling's SOURCE compiles
  // under THIS repo's lib and flags — and a `link:` sibling's TypeScript is
  // compiled here, from source. rosetta's client used the DOM-only
  // `HeadersInit` (2026-10-03, pin ee6724e): its own tsc (the DOM lib on) and
  // R23 were green, fieldd's typecheck (lib ES2022 + @types/node) red, found a
  // gate later. So the pin runs the workspace typecheck the way the gate does
  // (`pnpm typecheck`; Nx keys its cache on the sibling stamp, which a moved
  // checkout changes, so it runs), and a red is R23's red: the new SHAs STAY
  // recorded — the pin did move — and the exit is 1 so the event is loud.
  // `--skip-typecheck` is the deliberate case (a pin whose consumer change
  // follows in the same lane), said when used.
  if (skipTypecheck) {
    console.warn(
      "siblings:pin WARN: --skip-typecheck — the consumers were NOT typechecked at the new pins; run pnpm typecheck before relying on them",
    );
    return 0;
  }
  console.log(
    "siblings:pin: typechecking the consumers at the new pins (pnpm typecheck, the gate's own step)",
  );
  const typecheck = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["typecheck"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (typecheck.status !== 0) {
    const how =
      typecheck.error !== undefined
        ? `could not run (${typecheck.error.message})`
        : typecheck.signal !== null
          ? `was killed by ${typecheck.signal}`
          : "is red above";
    console.error(
      `siblings:pin: the new pins ARE recorded in ${LOCK_FILE}, but the consumers do not typecheck at them — pnpm typecheck ${how}; a sibling's source can compile under its own tsc and not under this repo's lib and flags (the HeadersInit class, 2026-10-03): fix it upstream or in the consumer, then re-run pnpm typecheck`,
    );
    return 1;
  }
  return 0;
}

function buildCargo(root) {
  const bin = rosettadBinary(root);
  if (bin === null) return null; // no cargo sibling: nothing owed here
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
  // rustup picks the sibling's own rust-toolchain.toml from the cwd; the build
  // lands where `cargo metadata` said it would, because both run under the
  // same environment (`siblingCargoEnv`: no lane target-dir override).
  const run = spawnSync("cargo", args, { cwd: bin.dir, stdio: "inherit", env: siblingCargoEnv() });
  if (run.status !== 0) return run.status ?? 1;
  if (!existsSync(bin.path)) {
    console.error(`siblings:build FAIL: cargo succeeded but ${bin.path} does not exist`);
    return 1;
  }
  console.log(`siblings:build: ${bin.path}`);
  return 0;
}

function buildGo(root) {
  const sidecar = goSidecar(root);
  if (sidecar === null) return null; // no go sibling: nothing owed here
  if (!existsSync(sidecar.moduleDir)) {
    console.error(
      `siblings:build FAIL: ${sidecar.name}'s go module is not at ${sidecar.moduleDir} — is the checkout present and at the pin?`,
    );
    return 1;
  }
  const lock = readLock(root);
  const head = siblingHead(sidecar.dir);
  const pinned = lock.siblings[sidecar.name].sha;
  if (head !== null && head !== pinned) {
    console.warn(
      `siblings:build WARN: ${sidecar.name} HEAD ${head.slice(0, 12)} ≠ pin ${pinned.slice(0, 12)} — building an unpinned revision (pnpm siblings:pin to accept it)`,
    );
  }
  mkdirSync(dirname(sidecar.path), { recursive: true });
  console.log(`siblings:build: go build -o ${sidecar.path} .  (in ${sidecar.moduleDir})`);
  // GOTOOLCHAIN=auto: the module names an exact toolchain in its go.mod, which
  // this machine may not have installed — auto lets the go command fetch the one
  // the sibling asks for instead of refusing. The toolchain is the sibling's
  // choice, the same way rustup takes the cargo sibling's rust-toolchain.toml.
  const run = spawnSync("go", ["build", "-o", sidecar.path, "."], {
    cwd: sidecar.moduleDir,
    stdio: "inherit",
    env: { ...process.env, GOTOOLCHAIN: "auto" },
  });
  if (run.error !== undefined) {
    console.error(
      `siblings:build FAIL: could not run go (${run.error.message}) — is Go installed?`,
    );
    return 1;
  }
  if (run.status !== 0) return run.status ?? 1;
  if (!existsSync(sidecar.path)) {
    console.error(`siblings:build FAIL: go succeeded but ${sidecar.path} does not exist`);
    return 1;
  }
  console.log(`siblings:build: ${sidecar.path}`);
  return 0;
}

function build(root) {
  if (readLock(root) === null) {
    console.error(`siblings:build FAIL: ${LOCK_FILE} is absent (registry mode — nothing to build)`);
    return 1;
  }
  // Report all declared builds even when one fails; return the first failure.
  const results = [buildJavaScript(root), buildCargo(root), buildGo(root)];
  if (results.every((r) => r === null)) {
    console.error(`siblings:build FAIL: no javascript, cargo or go sibling in ${LOCK_FILE}`);
    return 1;
  }
  return results.find((r) => r !== null && r !== 0) ?? 0;
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
    use: (root) => useSiblings(root, process.argv.slice(3)),
    align: (root) => {
      // the root postinstall (RD-2): after ANY install, a recorded overlay's checkouts are aligned again; no overlay,
      // nothing to do — so CI and a prod install pay one node start
      if (readOverlay(root).length === 0) return 0;
      const missing = alignOverlay(root);
      if (missing.length > 0) {
        console.error(`siblings:align: the installed store holds no copy of ${missing.join(", ")}`);
        return 1;
      }
      console.log(`siblings:align: overlay ${readOverlay(root).join(", ")} aligned`);
      return 0;
    },
    render: (root) => {
      const args = process.argv.slice(3);
      const known = new Set(["--prod", "--dev", "--check", "--staged"]);
      const unknown = args.filter((arg) => !known.has(arg));
      const prod = args.includes("--prod");
      const dev = args.includes("--dev");
      if (unknown.length > 0 || prod === dev || (dev && args.length > 1)) {
        console.error(
          "usage: node scripts/siblings.mjs render --prod [--check] [--staged] | render --dev (re-renders the overlay `use` recorded)",
        );
        return 2;
      }
      if (dev) {
        const linked = readOverlay(root);
        const { links } = renderOverlay(root, linked);
        console.log(
          linked.length > 0
            ? `siblings:render: overlay ${linked.join(", ")} re-rendered (${links.size} npm package(s))`
            : "siblings:render: no overlay recorded — nothing to render (`use NAME` records one)",
        );
        return 0;
      }
      return renderProd(root, {
        check: args.includes("--check"),
        staged: args.includes("--staged"),
      });
    },
    pin: (root) => {
      const args = process.argv.slice(3);
      const flags = args.filter((arg) => arg.startsWith("--"));
      const unknown = flags.filter((flag) => flag !== "--skip-typecheck");
      if (unknown.length > 0) {
        console.error(
          `siblings:pin FAIL: unknown flag ${unknown.join(" ")} — the one flag is --skip-typecheck; nothing was pinned`,
        );
        return 2;
      }
      return pin(
        root,
        args.filter((arg) => !arg.startsWith("--")),
        { skipTypecheck: flags.includes("--skip-typecheck") },
      );
    },
    stamp: (root) => {
      console.log(stamp(root));
      return 0;
    },
    build,
    fetch: (root) => fetchSibling(root, process.argv[3]),
    "install-js": (root) => installJavaScript(root, process.argv.slice(3)),
    "build-js": (root) => buildJavaScript(root, process.argv.slice(3)) ?? 0,
    bin: printBin,
  };
  const handler = handlers[command];
  if (handler === undefined) {
    console.error(
      "usage: node scripts/siblings.mjs <status|use [NAME...|--none]|render --prod [--check] [--staged]|render --dev|pin [--skip-typecheck] [NAME...]|stamp|fetch NAME|install-js|build-js|build|bin>",
    );
    process.exit(2);
  }
  try {
    process.exit(handler(REPO_ROOT));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
