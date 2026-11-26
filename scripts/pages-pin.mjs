// EY-1 (2026-11-24): the ONE reader of the pages engine's pin, as scripts/siblings.mjs is the one reader of
// siblings.lock.json. agent-browser, the pages engine, is an exact `dependencies` row in apps/desktop's manifest; its
// record is contracts' PAGES_ENGINE_RECORD (`pages-record.ts`, EY-0), which the lab's converter writes. preflight holds
// the install to the record here: the manifest's row, the lock's entry and its integrity, the installed version, and
// this host's binary by its SHA-256. No other script names where the installed binary sits (wall R33).
//
// The record names TWO identities (the release binary's stream port, 2026-11-24). The installed package's binary is
// the RELEASE: it always opens a loopback port that relays any command to the engine, so nothing starts it, and the
// helpers that place it (`pagesEngineBinary`, `pagesEnginePackageDir`) serve preflight's hold alone. What `pnpm dev`
// hands main is a copy of the SOURCE BUILD (`pagesEngineDevCopy`), a file whoever launches the runner names in
// PAGES_ENGINE_SOURCE_ENV, held to the record's source build before it is copied. There is no fallback from one to the
// other.
//
// A root .mjs never imports TypeScript (check-agent-catalog.mjs), so the record is read as TEXT, in the converter's
// shape. Any other shape throws; it is never guessed at.
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

/** The record, by its path from the repository's root. */
export const PAGES_RECORD_FILE = "packages/contracts/src/pages-record.ts";
/** The one importer that may name the engine, under its `dependencies`. */
export const PAGES_ENGINE_IMPORTER = "apps/desktop";
/** Which of the record's identities may be started (contracts' PAGES_ENGINE_STARTS): the source build, no other. */
export const PAGES_ENGINE_STARTS = "sourceBuild";
/** The variable whoever launches the dev runner names the source build's file in: an absolute path. It is the
 * runner's alone. The runner never hands it on to Electron, and its VIBEFIELD_ prefix keeps it out of every child
 * fieldd makes. */
export const PAGES_ENGINE_SOURCE_ENV = "VIBEFIELD_DEV_PAGES_ENGINE_SOURCE";

function notTheShape(what) {
  return new Error(`${PAGES_RECORD_FILE}: ${what} (not the converter's shape)`);
}

function field(head, name) {
  const match = head.match(new RegExp(`\\n\\s*${name}:\\s*"([^"\\n]+)",`));
  if (match === null) throw notTheShape(`PAGES_ENGINE_RECORD has no ${name}`);
  return match[1];
}

/** A `binarySha256: { "<platform>": "<64 hex>", … }` map in `text`, or null when it holds none. */
function sumsByPlatform(text) {
  const map = text.match(/(?:^|[\s{,])binarySha256:\s*\{([^}]*)\}/);
  if (map === null) return null;
  const sums = {};
  for (const [, platform, sha256] of map[1].matchAll(/"([a-z0-9_-]+)":\s*"([0-9a-f]{64})"/g)) {
    sums[platform] = sha256;
  }
  return sums;
}

/** The record's `sourceBuild` block: its own text (to set aside, so no top-level read sees a nested name) and what it
 * holds. A source build may name no platform: no host has an engine then. */
function sourceBuildOf(head) {
  const block = head.match(/\n\s*sourceBuild:\s*\{((?:[^{}]|\{[^{}]*\})*)\},/);
  if (block === null) throw notTheShape("PAGES_ENGINE_RECORD has no sourceBuild");
  const nested = (name) => {
    const match = block[1].match(new RegExp(`(?:^|[\\s{,])${name}:\\s*"([^"\\n]+)"`));
    if (match === null) throw notTheShape(`sourceBuild has no ${name}`);
    return match[1];
  };
  const binarySha256 = sumsByPlatform(block[1]);
  if (binarySha256 === null) throw notTheShape("sourceBuild has no binarySha256");
  return {
    text: block[0],
    sourceBuild: {
      tagCommit: nested("tagCommit"),
      patchSha256: nested("patchSha256"),
      binarySha256,
    },
  };
}

/** The pin as the record holds it: the package, its version, the tag, the npm integrity, the RELEASE binaries'
 * SHA-256 by platform, the source build (its tag, its patch's SHA-256, its binaries' SHA-256 by platform), which
 * identity may be started, and the script set's engine version. */
export function readPagesPin(root) {
  const text = readFileSync(join(root, PAGES_RECORD_FILE), "utf8");
  const start = text.indexOf("export const PAGES_ENGINE_RECORD");
  const end = start === -1 ? -1 : text.indexOf("\n  core: [", start);
  if (start === -1 || end === -1) throw notTheShape("no PAGES_ENGINE_RECORD head");
  const whole = text.slice(start, end);
  const source = sourceBuildOf(whole);
  // the record's own fields are read with the source build's block set aside: its tag and its sums are another's
  const head = whole.replace(source.text, "");
  const binarySha256 = sumsByPlatform(head);
  if (binarySha256 === null) throw notTheShape("PAGES_ENGINE_RECORD has no binarySha256");
  if (Object.keys(binarySha256).length === 0) throw notTheShape("binarySha256 names no platform");
  const set = text.match(
    /export const PAGES_SCRIPT_SET\b[^=]*=\s*\{\s*v:\s*1,\s*engineVersion:\s*"([^"\n]+)",/,
  );
  if (set === null) throw notTheShape("PAGES_SCRIPT_SET has no engineVersion");
  return {
    package: field(head, "package"),
    version: field(head, "version"),
    tagCommit: field(head, "tagCommit"),
    npmIntegrity: field(head, "npmIntegrity"),
    binarySha256,
    sourceBuild: source.sourceBuild,
    starts: field(head, "starts"),
    engineVersion: set[1],
  };
}

/** Where the record disagrees with itself, as preflight FAILs it (contracts' schema refuses the same): the script
 * set's engine version, which identity is started, the source build's commit, and a source build that is a release
 * binary's bytes. */
export function pagesRecordProblems(pin) {
  const problems = [];
  if (pin.engineVersion !== pin.version) {
    problems.push(
      `${PAGES_RECORD_FILE}: PAGES_SCRIPT_SET's engineVersion ${pin.engineVersion} is not PAGES_ENGINE_RECORD's version ${pin.version}`,
    );
  }
  if (pin.starts !== PAGES_ENGINE_STARTS) {
    problems.push(
      `${PAGES_RECORD_FILE}: the record says main starts ${JSON.stringify(pin.starts)}; only the source build may be started`,
    );
  }
  if (pin.sourceBuild.tagCommit !== pin.tagCommit) {
    problems.push(
      `${PAGES_RECORD_FILE}: the source build is of commit ${pin.sourceBuild.tagCommit}, and the pin's tag is ${pin.tagCommit}`,
    );
  }
  const released = new Set(Object.values(pin.binarySha256));
  for (const [platform, sha256] of Object.entries(pin.sourceBuild.binarySha256)) {
    if (released.has(sha256)) {
      problems.push(
        `${PAGES_RECORD_FILE}: the source build for ${platform} is a release binary's bytes`,
      );
    }
  }
  return problems;
}

/** This host as the record names its binaries: `darwin-arm64`. */
export function pagesEnginePlatform(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/** The installed package for the importer (pnpm's link), or null when it is not installed. */
export function pagesEnginePackageDir(root, pin) {
  const dir = join(root, PAGES_ENGINE_IMPORTER, "node_modules", pin.package);
  return existsSync(join(dir, "package.json")) ? dir : null;
}

/** This host's RELEASE binary in the installed package (`path` null when the package is not installed) and the SHA-256
 * the record names for it; null when the record names no binary for this host. For preflight's hold of the install
 * alone: the release binary is never started, and nothing copies it (a row in tooling/dev-runner/test holds that). */
export function pagesEngineBinary(root, pin, platform = pagesEnginePlatform()) {
  const sha256 = pin.binarySha256[platform];
  if (sha256 === undefined) return null;
  const dir = pagesEnginePackageDir(root, pin);
  const name = `${pin.package}-${platform}${platform.startsWith("win32-") ? ".exe" : ""}`;
  return { path: dir === null ? null : join(dir, "bin", name), sha256 };
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** EY-1 1b (2026-11-19): where contracts spells the variable the dev runner hands main the engine's copy in
 * (`VIBEFIELD_DEV_PAGES_ENGINE_ENV`). Read as TEXT, like the record, so its one spelling is contracts'. */
export const PAGES_ENGINE_ENV_FILE = "packages/contracts/src/registries.ts";

/** The variable's name, from registries.ts; throws when the file holds no such literal. */
export function readPagesEngineEnv(root) {
  const text = readFileSync(join(root, PAGES_ENGINE_ENV_FILE), "utf8");
  const match = text.match(
    /^export const VIBEFIELD_DEV_PAGES_ENGINE_ENV = "([A-Z][A-Z0-9_]*)"(?: as const)?;$/m,
  );
  if (match === null) {
    throw new Error(`${PAGES_ENGINE_ENV_FILE}: no VIBEFIELD_DEV_PAGES_ENGINE_ENV literal`);
  }
  return match[1];
}

/** The engine's own file name wherever VibeField keeps a copy of it (the dev runner's; a package's `bin/`): the
 * package's name, `.exe` on Windows, never the platform suffix the installed file carries. */
export function pagesEngineFileName(pin, platform = pagesEnginePlatform()) {
  return `${pin.package}${platform.startsWith("win32-") ? ".exe" : ""}`;
}

/** The dev runner's engine copies, `<devRoot>/pages-engine/<sum, first 16>/<file>`: every file outside `keep` loses its
 * execute bits, and how many did is answered. A copy an earlier pin, or a runner from before 2026-11-24, left there is
 * the release binary's: it stays on disk (nothing is removed) and can no longer be started by its old path. Never
 * throws: a folder it cannot read holds nothing it can change. */
function holdOtherCopies(devRoot, keep) {
  if (process.platform === "win32") return 0;
  const copies = join(devRoot, "pages-engine");
  let held = 0;
  let folders;
  try {
    folders = readdirSync(copies, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const folder of folders) {
    const dir = join(copies, folder.name);
    if (!folder.isDirectory() || dir === keep) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = join(dir, entry.name);
        const mode = statSync(file).mode & 0o777;
        if ((mode & 0o111) === 0) continue;
        chmodSync(file, mode & ~0o111);
        held += 1;
      }
    } catch {
      // unreadable: nothing here was changed
    }
  }
  return held;
}

/**
 * EY-1 1b (2026-11-19), and the release binary's stream port (2026-11-24): the dev runner's own copy of this host's
 * engine, which `pnpm dev` hands main. It is a copy of the pin's SOURCE BUILD, the file `source` names (the launcher's
 * PAGES_ENGINE_SOURCE_ENV), and of nothing else: the installed package's binary is the release, which opens a loopback
 * command port, and this function never reads it. The named file is held to the record's source build BEFORE anything
 * is copied, at every launch; the copy is content-addressed, `<devRoot>/pages-engine/<the source build's SHA-256, first
 * 16>/<file>`, made once per sum with an explicit 0755, and held to the record again after it is written. Every other
 * copy under `<devRoot>/pages-engine` loses its execute bits (`held` counts them).
 *
 * Answers `{ path, sha256, held }`, or `{ path: null, warning, held }` when there is no engine to hand main: the
 * variable is unset, it names no regular file by an absolute path, the file's bytes are not the record's source build
 * (the release binary is said by name), or the record names no source build for this host. The warning is one line,
 * for the runner's log. Main then has no engine, and pages answer not-installed.
 */
export function pagesEngineDevCopy(
  root,
  devRoot,
  { platform = pagesEnginePlatform(), source } = {},
) {
  let pin;
  try {
    pin = readPagesPin(root);
  } catch (error) {
    return {
      path: null,
      warning: error instanceof Error ? error.message : String(error),
      held: holdOtherCopies(devRoot, null),
    };
  }
  const none = (warning) => ({ path: null, warning, held: holdOtherCopies(devRoot, null) });
  if (pin.starts !== PAGES_ENGINE_STARTS) {
    return none(
      `${PAGES_RECORD_FILE} says main starts ${JSON.stringify(pin.starts)}; only the source build may be started: main has no engine`,
    );
  }
  const wanted = pin.sourceBuild.binarySha256[platform];
  if (wanted === undefined) {
    return none(
      `the record names no source build of ${pin.package} for ${platform}: main has no engine there`,
    );
  }
  if (source === undefined || source === "") {
    return none(
      `${PAGES_ENGINE_SOURCE_ENV} is not set, so main has no engine: it names the source build of ${pin.package} for ${platform} (SHA-256 ${wanted}); the npm package's binary is never started`,
    );
  }
  if (!isAbsolute(source)) {
    return none(`${PAGES_ENGINE_SOURCE_ENV} must be an absolute path: main has no engine`);
  }
  let found;
  try {
    if (!statSync(source).isFile()) {
      return none(`${PAGES_ENGINE_SOURCE_ENV} names no regular file: main has no engine`);
    }
    found = sha256File(source);
  } catch (error) {
    return none(
      `${PAGES_ENGINE_SOURCE_ENV} names no readable file (${error?.code ?? "an unknown error"}): main has no engine`,
    );
  }
  if (found !== wanted) {
    return none(
      Object.values(pin.binarySha256).includes(found)
        ? `${PAGES_ENGINE_SOURCE_ENV} names the RELEASE binary of ${pin.package} (SHA-256 ${found}), which opens a loopback command port and is never started; the record's source build is ${wanted}. main has no engine`
        : `${PAGES_ENGINE_SOURCE_ENV} names a file with SHA-256 ${found}, and the record's source build is ${wanted}: main has no engine`,
    );
  }
  const dir = join(devRoot, "pages-engine", wanted.slice(0, 16));
  const copy = join(dir, pagesEngineFileName(pin, platform));
  const held = holdOtherCopies(devRoot, dir);
  if (existsSync(copy) && sha256File(copy) === wanted) {
    if ((statSync(copy).mode & 0o777) !== 0o755) chmodSync(copy, 0o755);
    return { path: copy, sha256: wanted, held };
  }
  mkdirSync(dir, { recursive: true });
  const partial = `${copy}.${process.pid}.partial`;
  copyFileSync(source, partial);
  chmodSync(partial, 0o755);
  renameSync(partial, copy);
  const written = sha256File(copy);
  if (written !== wanted) {
    // bytes that are not the record's are left where they fell, without their execute bits
    try {
      chmodSync(copy, 0o644);
    } catch {
      // the next launch writes the copy again
    }
    return {
      path: null,
      warning: `the copy at ${copy} has SHA-256 ${written}, and the record's source build is ${wanted}: main has no engine`,
      held,
    };
  }
  return { path: copy, sha256: wanted, held };
}

/** The lock's importer blocks: each importer's name and the lines under it. */
function importerBlocks(lock) {
  const blocks = new Map();
  let inImporters = false;
  let current = null;
  for (const line of lock.split("\n")) {
    if (/^\S/.test(line)) {
      inImporters = line === "importers:";
      current = null;
      continue;
    }
    if (!inImporters) continue;
    const key = line.match(/^ {2}(\S[^:]*):$/);
    if (key !== null) {
      current = [];
      blocks.set(key[1].replace(/^'(.*)'$/, "$1"), current);
    } else if (current !== null) {
      current.push(line);
    }
  }
  return blocks;
}

/** Every row of one importer block that names `name`: its section, specifier and version. */
function importerRows(block, name) {
  const rows = [];
  let section = null;
  for (let index = 0; index < block.length; index += 1) {
    const heading = block[index].match(/^ {4}(\w+):$/);
    if (heading !== null) {
      section = heading[1];
      continue;
    }
    const key = block[index].match(/^ {6}('?)(.+)\1:$/);
    if (key === null || key[2] !== name) continue;
    rows.push({
      section,
      specifier: block[index + 1]?.match(/^ {8}specifier: (.+)$/)?.[1],
      version: block[index + 2]?.match(/^ {8}version: (.+)$/)?.[1],
    });
  }
  return rows;
}

/** The `packages:` entries of `name`, with each one's version and resolution integrity. */
function packageEntries(lock, name) {
  const lines = lock.split("\n");
  const entries = [];
  let section = null;
  for (let index = 0; index < lines.length; index += 1) {
    const top = lines[index].match(/^(\w+):/);
    if (top !== null) {
      section = top[1];
      continue;
    }
    if (section !== "packages") continue;
    const key = lines[index].match(/^ {2}'?([^\s']+)'?:$/);
    if (key === null || !key[1].startsWith(`${name}@`)) continue;
    entries.push({
      key: key[1],
      version: key[1].slice(name.length + 1),
      integrity: lines[index + 1]?.match(/^ {4}resolution: \{integrity: ([^,}\s]+)/)?.[1],
    });
  }
  return entries;
}

/**
 * The install held to the record: what preflight FAILs (`problems`) and WARNs (`warnings`) on.
 *  - the record agrees with itself (`pagesRecordProblems`): the script set's engine version is the record's version,
 *    the source build is the identity that is started, it is of the pin's own tag, and it is no release binary;
 *  - the manifest: apps/desktop's `dependencies` row is the record's version, and no other section names it;
 *  - the lock: ONE `packages:` entry, at the record's version, with the record's integrity, and apps/desktop's
 *    `dependencies` row the only importer row that names it;
 *  - the installed copy, when there is one: its version, and this host's RELEASE binary by the record's SHA-256. None
 *    installed is a WARN, as a missing rosettad is. The installed binary is held, never started: the engine main runs
 *    is the source build, which no install brings, so a host the record names no source build for WARNs too.
 */
export function pagesInstallProblems(root, pin, { platform = pagesEnginePlatform() } = {}) {
  const problems = pagesRecordProblems(pin);
  const warnings = [];
  if (pin.sourceBuild.binarySha256[platform] === undefined) {
    warnings.push(
      `the record names no source build of ${pin.package} for ${platform}: the pages engine is UNAVAILABLE on this host`,
    );
  }

  const manifestFile = `${PAGES_ENGINE_IMPORTER}/package.json`;
  const manifest = JSON.parse(readFileSync(join(root, manifestFile), "utf8"));
  const row = manifest.dependencies?.[pin.package];
  if (row !== pin.version) {
    problems.push(
      `${manifestFile}: dependencies["${pin.package}"] is ${row === undefined ? "absent" : JSON.stringify(row)}, and the record says ${pin.version}: the install and the record move in ONE EL8 event`,
    );
  }
  for (const section of ["devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (manifest[section]?.[pin.package] !== undefined) {
      problems.push(
        `${manifestFile}: ${pin.package} is under ${section}; a shipped engine is a dependencies row alone (pnpm audit --prod reads those)`,
      );
    }
  }

  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const entries = packageEntries(lock, pin.package);
  const blocks = importerBlocks(lock);
  if (entries.length === 0) {
    problems.push(
      `pnpm-lock.yaml has no ${pin.package}@${pin.version}: the EL8's one install writes it`,
    );
  } else if (entries.length > 1 || entries[0].version !== pin.version) {
    problems.push(
      `pnpm-lock.yaml resolves ${entries.map((entry) => entry.key).join(", ")}, and the record says ${pin.package}@${pin.version} alone`,
    );
  } else if (entries[0].integrity !== pin.npmIntegrity) {
    problems.push(
      `pnpm-lock.yaml's ${pin.package}@${pin.version} has integrity ${entries[0].integrity ?? "(none)"}, and the record's npmIntegrity is ${pin.npmIntegrity}`,
    );
  }
  let importerRow = false;
  for (const [importer, block] of blocks) {
    for (const found of importerRows(block, pin.package)) {
      if (
        importer === PAGES_ENGINE_IMPORTER &&
        found.section === "dependencies" &&
        found.specifier === pin.version &&
        found.version === pin.version
      ) {
        importerRow = true;
        continue;
      }
      problems.push(
        `pnpm-lock.yaml: importer ${importer} names ${pin.package} under ${found.section} (${found.specifier} → ${found.version}); only ${PAGES_ENGINE_IMPORTER}'s dependencies may, at ${pin.version}`,
      );
    }
  }
  if (entries.length > 0 && !importerRow) {
    problems.push(
      `pnpm-lock.yaml: importer ${PAGES_ENGINE_IMPORTER} has no dependencies row for ${pin.package} at ${pin.version}`,
    );
  }

  const dir = pagesEnginePackageDir(root, pin);
  if (dir === null) {
    warnings.push(
      `${PAGES_ENGINE_IMPORTER} has no ${pin.package} installed: its release binary was not held to the record (no install brings the engine main starts, the source build)`,
    );
    return { problems, warnings };
  }
  const installed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  if (installed !== pin.version) {
    problems.push(
      `the installed ${pin.package} is ${installed}, and the record says ${pin.version}: run an install`,
    );
  }
  const binary = pagesEngineBinary(root, pin, platform);
  if (binary === null) {
    warnings.push(
      `the record names no release binary of ${pin.package} for ${platform}: the install has none to hold on this host`,
    );
  } else if (binary.path === null || !existsSync(binary.path)) {
    problems.push(`the installed ${pin.package} holds no binary for ${platform}`);
  } else {
    const actual = sha256File(binary.path);
    if (actual !== binary.sha256) {
      problems.push(
        `the installed ${pin.package} binary for ${platform} has SHA-256 ${actual}, and the record says ${binary.sha256}`,
      );
    }
  }
  return { problems, warnings };
}
