// LP-6b (item 170, 2026-11-05) — no build-machine path in a binary we ship: THE release switch, the remap every shipped
// cargo build carries under it, and the door each build takes it through. The gate that keeps it so is
// scripts/host-links.mjs (its counts, its one exception).
//
// THE SWITCH: `VIBEFIELD_REMAP_BUILD_PATHS=1`, set by release.yml's build job and by nothing else in the tree. rustflags
// are part of every unit's fingerprint, and the remap names the checkout it builds in, so a remapped build in James's
// SHARED target directory (`~/.cargo/config.toml` `target-dir`, every checkout and lane) would rebuild the whole graph
// for every checkout in turn. Unset, every build here is exactly what it was before item 170 — a development build keeps
// its cache — and the packaged app's gate refuses what it makes (a local package remaps with the switch exported).
//
// THE REMAP (`remapFlags`): `--remap-path-prefix` for the checkout (→ /vibefield, /rosetta, /mille), its cargo target
// directory (→ /target: a build script's OUT_DIR), CARGO_HOME (→ /cargo: the registry and git checkouts) and RUSTUP_HOME
// (→ /rustup: the toolchain, its rust-src) — each as given and as its real path, shortest prefix first (rustc applies the
// last mapping that matches). Cargo's own `trim-paths` profile option would say this in one line, but it is UNSTABLE at
// every pinned toolchain: cargo 1.99.1 (this repo's rust-toolchain.toml) and 1.97.1 (rosetta-pin's and mille-pin's) both
// list it among their unstable features ("Enable the `trim-paths` option in profiles", reference/unstable.html
// #profile-trim-paths-option — read from the cargo binaries on disk, 2026-11-05; the minimal profile ships no HTML docs),
// and a stable toolchain refuses `cargo-features`. So the flag rustc has stabilized since 1.0 it is.
//
// THE DOORS — appended, never clobbering. cargo takes rustflags from the FIRST of: CARGO_ENCODED_RUSTFLAGS, RUSTFLAGS,
// every matching `target.<triple|cfg>.rustflags` (or CARGO_TARGET_<TRIPLE>_RUSTFLAGS), `build.rustflags` (config files,
// `--config`, CARGO_BUILD_RUSTFLAGS — config ARRAYS join across those). An environment variable REPLACES every config
// file's rustflags; `--config` arrays merge.
//   - `cargoRemap`, a cargo WE run (field-native's release build, rosettad's): flags already in the environment → ours are
//     appended there (CARGO_ENCODED_RUSTFLAGS; cargo reads that first and was ignoring the config files anyway); else
//     `--config build.rustflags=[…]`, which cargo joins after any config file's build.rustflags. Target rustflags — a
//     config's `target.….rustflags` (a table, a dotted key, an inline table) or CARGO_TARGET_<TRIPLE>_RUSTFLAGS — would
//     make cargo ignore every build.rustflags, ours too: refused by name, never built quietly.
//   - `napiRemapEnv`, mille's napi build: napi runs cargo itself and composes RUSTFLAGS (`RUSTFLAGS ?? CARGO_BUILD_RUSTFLAGS`,
//     then its own musl/strip flags; @napi-rs/cli 3.6.2 `setEnvs`), so RUSTFLAGS is the only door that keeps napi's own
//     composition: ours are appended to what napi would read, a flag with whitespace is refused (RUSTFLAGS splits on it),
//     and a config file's rustflags or a CARGO_TARGET_<TRIPLE>_RUSTFLAGS is refused (RUSTFLAGS would replace it) — the
//     config files cargo reads from the directory napi runs it in, the PACKAGE's (`pnpm --filter … build` runs there, and
//     napi spawns cargo with that cwd; cargo discovers config from its cwd, never from the manifest). CARGO_ENCODED_RUSTFLAGS
//     already set → appended there, since cargo reads it before napi's RUSTFLAGS.
// Read 2026-11-05, read-only: neither ~/.cargo/config.toml (target-dir alone), ../rosetta-pin/.cargo/config.toml (target-dir
// alone) nor ../mille-pin (no .cargo/) sets any rustflags, and the release job's runner has no user config — so today
// every door is a pure append; the refusals are for the day one of them does.
//
// The pinned checkouts (../rosetta-pin, ../mille-pin; W-D10, FS-1b) are never edited: their builds are reached only
// through these flags in the environment and the arguments OUR scripts pass.
//
// MILLE'S INSTALL NAME (`setInstallName`, the stage's step on macOS): a cdylib's LC_ID_DYLIB is the path the linker wrote
// it to (`…/target/aarch64-apple-darwin/release/deps/libmille_binding.dylib`), which no rustflag reaches, and napi copies
// the file as it is. The stage rewrites it to `@rpath/<file>` and re-signs the file ad hoc, every stage and with or
// without the switch: the name is never read (fieldd's worker dlopens the explicit path), so the rewrite costs nothing.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** THE release switch: release.yml's build job sets it to "1"; unset (or "0", or empty) is a development build. */
export const REMAP_SWITCH = "VIBEFIELD_REMAP_BUILD_PATHS";

/** Whether this build remaps its paths. Any value but "1", "0" or empty is refused, so a typo never ships unremapped. */
export function remapRequested(env = process.env) {
  const value = env[REMAP_SWITCH];
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error(
    `${REMAP_SWITCH}=${JSON.stringify(value)} — the switch is "1" (a release build remaps its paths) or unset`,
  );
}

/** The neutral prefix each build-host directory is written as. */
export const REMAP_TARGETS = {
  repo: "/vibefield",
  target: "/target",
  cargoHome: "/cargo",
  rustupHome: "/rustup",
};

function realpathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The `--remap-path-prefix` flags for this build host: `roots` ([dir, neutral] pairs — the checkout, its target
 * directory; a null dir is skipped), then CARGO_HOME and RUSTUP_HOME, each as given and as its real path when that
 * differs. rustc applies the LAST mapping that matches, so the list runs from the shortest prefix to the longest: a
 * directory nested in another (CI's target inside its checkout) is written by its own, more specific mapping. */
export function remapFlags({
  roots = [],
  env = process.env,
  home = homedir(),
  realpath = realpathOrNull,
} = {}) {
  const sources = [
    ...roots,
    [env.CARGO_HOME || join(home, ".cargo"), REMAP_TARGETS.cargoHome],
    [env.RUSTUP_HOME || join(home, ".rustup"), REMAP_TARGETS.rustupHome],
  ];
  const byPrefix = new Map();
  for (const [given, target] of sources) {
    if (typeof given !== "string") continue;
    for (const path of [given, realpath(given)]) {
      if (typeof path !== "string" || path === "" || path === "/") continue;
      const prefix = path.replace(/\/+$/u, "");
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, target);
    }
  }
  return [...byPrefix]
    .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1))
    .map(([prefix, target]) => `--remap-path-prefix=${prefix}=${target}`);
}

/** The index of the first `char` in `line` from `start` that stands outside a TOML string ('literal' or "basic", the
 * latter with its backslash escapes), or -1. A dotted key's quoted segment may hold `=` or `]`
 * (`target.'cfg(target_os = "macos")'.rustflags`), and an array's strings may hold `=` (`"link-arg=-fuse-ld=lld"`). */
function outsideQuotes(line, char, start = 0) {
  let quote = null;
  for (let i = start; i < line.length; i += 1) {
    const c = line[i];
    if (quote === '"' && c === "\\") i += 1;
    else if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === char) return i;
  }
  return -1;
}

/** A key as the classifier compares it: whitespace outside its quoted segments dropped (inside them it is kept as written,
 * so `'cfg(target_os = "macos")'` stays one segment). */
function keyText(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      out += c;
      if (quote === '"' && c === "\\") {
        i += 1;
        out += text[i] ?? "";
      } else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (!/\s/u.test(c)) out += c;
  }
  return out;
}

const RUSTFLAGS_KEY = /(^|\.)(rustflags|"rustflags"|'rustflags')$/u;
const INLINE_RUSTFLAGS = /[{,]\s*(rustflags|"rustflags"|'rustflags')\s*=/u;

/** The rustflags a cargo config file's text sets: under `build` (cargo joins them with ours) or under a `target` table
 * (which makes cargo ignore every `build.rustflags`). Read as TOML's table headers, dotted keys and one-line inline tables
 * — `[target.'cfg(…)']`, `target.'cfg(target_os = "macos")'.rustflags = […]`, `[target]` then
 * `aarch64-apple-darwin = { rustflags = […] }`, `build = { rustflags = […] }` — line by line, the `=` and `]` that matter
 * found outside quotes: a question about two keys, not a TOML parser. */
export function configRustflags(text) {
  const found = { build: false, target: false };
  const mark = (key) => {
    if (key === "build" || key.startsWith("build.")) found.build = true;
    else if (key === "target" || key.startsWith("target.")) found.target = true;
  };
  let table = "";
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[[")) {
      table = "";
      continue;
    }
    if (line.startsWith("[")) {
      const close = outsideQuotes(line, "]", 1);
      table = close === -1 ? "" : keyText(line.slice(1, close));
      continue;
    }
    const eq = outsideQuotes(line, "=");
    if (eq === -1) continue;
    const key = [table, keyText(line.slice(0, eq))].filter(Boolean).join(".");
    // the key names rustflags, or its value is an inline table that does at any depth (`{ x = { rustflags = … } }`)
    if (RUSTFLAGS_KEY.test(key) || INLINE_RUSTFLAGS.test(line.slice(eq + 1))) mark(key);
  }
  return found;
}

/** The environment's own target rustflags — `CARGO_TARGET_<TRIPLE>_RUSTFLAGS`, cargo's environment form of
 * `target.<triple>.rustflags`, which (like the config's) makes cargo ignore every `build.rustflags`, and which RUSTFLAGS
 * replaces. Their names, sorted. */
export function envTargetRustflags(env) {
  return Object.keys(env)
    .filter((key) => /^CARGO_TARGET_[A-Z0-9_]+_RUSTFLAGS$/u.test(key))
    .sort();
}

function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Every cargo config file a build run in `cwd` reads that sets rustflags, in cargo's discovery order: `.cargo/config.toml`
 * (or the legacy `.cargo/config`) in `cwd` and each directory above it, then CARGO_HOME's. Each as
 * `{ file, build, target }`. */
export function readConfigRustflags(
  cwd,
  { env = process.env, home = homedir(), read = readTextOrNull } = {},
) {
  const files = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    files.push(join(dir, ".cargo", "config.toml"), join(dir, ".cargo", "config"));
    if (dirname(dir) === dir) break;
  }
  const cargoHome = env.CARGO_HOME || join(home, ".cargo");
  files.push(join(cargoHome, "config.toml"), join(cargoHome, "config"));
  const out = [];
  for (const file of new Set(files)) {
    const text = read(file);
    if (text === null) continue;
    const found = configRustflags(text);
    if (found.build || found.target) out.push({ file, ...found });
  }
  return out;
}

/** The rustflags cargo takes from the environment, in its own precedence (CARGO_ENCODED_RUSTFLAGS, 0x1f-separated, then
 * RUSTFLAGS, whitespace-split), or null when neither is set and cargo reads its config files instead. */
export function envRustflags(env) {
  if (env.CARGO_ENCODED_RUSTFLAGS !== undefined)
    return env.CARGO_ENCODED_RUSTFLAGS.split("\x1f").filter((flag) => flag !== "");
  if (env.RUSTFLAGS !== undefined) return env.RUSTFLAGS.split(/\s+/u).filter((flag) => flag !== "");
  return null;
}

/** The remap through a cargo WE run: `{ args, env, door }`, `args` and `env` the ones to run it with (never mutated).
 *  - the environment carries rustflags → `flags` appended to them as CARGO_ENCODED_RUSTFLAGS (RUSTFLAGS folded in as
 *    cargo splits it, then dropped); cargo was ignoring every config file's already;
 *  - otherwise `--config build.rustflags=[…]` before the subcommand: cargo joins it after any config's build.rustflags;
 *  - target rustflags with no environment flags — a config's `target.….rustflags` (in `configs`, readConfigRustflags's
 *    answer) or the environment's `CARGO_TARGET_<TRIPLE>_RUSTFLAGS` — are REFUSED: cargo would ignore build.rustflags,
 *    ours with it, and build unremapped. */
export function cargoRemap({ args, env, flags, configs = [] }) {
  const existing = envRustflags(env);
  if (existing !== null) {
    const next = { ...env, CARGO_ENCODED_RUSTFLAGS: [...existing, ...flags].join("\x1f") };
    delete next.RUSTFLAGS;
    return { args: [...args], env: next, door: "CARGO_ENCODED_RUSTFLAGS" };
  }
  const targeted = [
    ...configs.filter((config) => config.target).map((config) => config.file),
    ...envTargetRustflags(env),
  ];
  if (targeted.length > 0)
    throw new Error(
      `${targeted.join(", ")} sets target rustflags, so cargo would ignore the remap's build.rustflags — ` +
        "export those flags with the remap in CARGO_ENCODED_RUSTFLAGS, or move them to [build]",
    );
  return {
    args: ["--config", `build.rustflags=${JSON.stringify(flags)}`, ...args],
    env: { ...env },
    door: "--config build.rustflags",
  };
}

/** The remap through napi's build (napi composes RUSTFLAGS and runs cargo itself): `{ env, door }`.
 *  - CARGO_ENCODED_RUSTFLAGS set → appended there (cargo reads it before RUSTFLAGS);
 *  - else RUSTFLAGS = what napi would read (`RUSTFLAGS ?? CARGO_BUILD_RUSTFLAGS`) + `flags`, napi appending its own after;
 *    a flag holding whitespace is refused (RUSTFLAGS splits on it), and so is any config file's rustflags (`configs`)
 *    or the environment's `CARGO_TARGET_<TRIPLE>_RUSTFLAGS`, which RUSTFLAGS would replace. */
export function napiRemapEnv({ env, flags, configs = [] }) {
  if (env.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    const existing = env.CARGO_ENCODED_RUSTFLAGS.split("\x1f").filter((flag) => flag !== "");
    return {
      env: { ...env, CARGO_ENCODED_RUSTFLAGS: [...existing, ...flags].join("\x1f") },
      door: "CARGO_ENCODED_RUSTFLAGS",
    };
  }
  const spaced = flags.filter((flag) => /\s/u.test(flag));
  if (spaced.length > 0)
    throw new Error(
      `${spaced.join(" ")} holds whitespace, which RUSTFLAGS (napi's door) splits on — build from a path without it`,
    );
  const replaced = [...configs.map((config) => config.file), ...envTargetRustflags(env)];
  if (replaced.length > 0)
    throw new Error(
      `${replaced.join(", ")} sets rustflags, which napi's RUSTFLAGS would replace — ` +
        "export them with the remap in CARGO_ENCODED_RUSTFLAGS",
    );
  const existing = (env.RUSTFLAGS ?? env.CARGO_BUILD_RUSTFLAGS ?? "")
    .split(/\s+/u)
    .filter((flag) => flag !== "");
  return { env: { ...env, RUSTFLAGS: [...existing, ...flags].join(" ") }, door: "RUSTFLAGS" };
}

function runTool(command, args) {
  execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"] });
}

/** A staged dylib's OWN install name (LC_ID_DYLIB) rewritten to `id`, then the file re-signed ad hoc. The rewrite changes
 * signed bytes, and arm64 refuses to load code whose signature is invalid. This Mac's install_name_tool (Command Line
 * Tools) regenerates a linker-signed signature by itself (measured 2026-11-05 on a scratch dylib: `codesign --verify`
 * passes straight after `-id`, flags still `adhoc,linker-signed`), but that is the tool's courtesy, not a contract: the
 * explicit ad hoc signature makes the file loadable whichever cctools ran. `run(command, args)` throws on a failure
 * (execFileSync's error carries the tool's stderr). On the signed path the Developer ID signing re-signs it again. */
export function setInstallName(file, id, { run = runTool } = {}) {
  run("install_name_tool", ["-id", id, file]);
  run("codesign", ["--force", "--sign", "-", file]);
}
