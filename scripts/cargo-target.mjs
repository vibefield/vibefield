// Where cargo puts THIS workspace's artifacts — asked of cargo itself (VF-PM's tooling item (a), 2026-10-26).
//
// A reader of a built binary that guesses `<repo>/target` reads the wrong file whenever the target lives elsewhere:
// a lane's CARGO_TARGET_DIR, cargo's other spelling CARGO_BUILD_TARGET_DIR, or a config's `build.target-dir`
// (`~/.cargo/config.toml` sets one shared directory for every checkout on James's Mac). The stage then packaged a
// stale binary, or none at all as a mere warning; the fieldd suites spawned a binary their own build never wrote.
// `cargo metadata`'s `target_directory` is the build's own answer, with cargo's own precedence, so this module
// replicates none of it.
//
// A sibling's build is asked differently: `scripts/siblings.mjs` `cargoTargetDir`, where a lane's override does not
// move the sibling's target. This is the repo's own workspace, whose build the override DOES move.
//
// Node >=22 ESM, builtins only; scripts/cargo-target.d.mts types it for the TypeScript readers.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const cache = new Map();

/** The variables cargo reads a target directory from, as one cache key (Windows names them without regard to case). */
function overrideKey(env, platform) {
  const names = new Set(["CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR", "CARGO_HOME"]);
  return Object.entries(env)
    .filter(([key]) => names.has(platform === "win32" ? key.toUpperCase() : key))
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\0");
}

/** The workspace's target directory as cargo would build into it under `env`. Throws when cargo cannot say (not
 * installed, no workspace at `root`): a reader that does not know where the binary is must not pick a path. Cached
 * per root and per target override. */
export function workspaceTargetDir(root, env = process.env, platform = process.platform) {
  const key = `${root}\0${overrideKey(env, platform)}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  let out;
  try {
    out = execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const said =
      error?.stderr?.toString().trim().split("\n").at(-1) ?? error?.message ?? String(error);
    throw new Error(`cargo could not say where ${root} builds: ${said}`);
  }
  const dir = JSON.parse(out.toString()).target_directory;
  if (typeof dir !== "string" || dir === "") {
    throw new Error(`cargo metadata named no target_directory for ${root}`);
  }
  cache.set(key, dir);
  return dir;
}

/** Each named binary of `profile` (`debug`, `release`) at the path cargo builds it to. The list is the shape: a
 * third binary is one more name. */
export function cargoBinaries(root, profile, names, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const dir = join(workspaceTargetDir(root, env, platform), profile);
  return names.map((name) => {
    const file = platform === "win32" ? `${name}.exe` : name;
    return { name, file, path: join(dir, file) };
  });
}
