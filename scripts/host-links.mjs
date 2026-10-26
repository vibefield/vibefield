#!/usr/bin/env node
// BP-1b's gate (2026-10-26; LANDED "BP-1b"; VF-PM 03:14Z and 03:48Z) — a packaged Mach-O loads only what every Mac
// has (`/usr/lib`, `/System`) or what the bundle carries (`@rpath`, `@loader_path`, `@executable_path`). A dependency
// anywhere else, such as Homebrew's `/opt/homebrew` or `/usr/local`, or a build machine's own path, loads on the build
// host alone. Under a signed build's hardened runtime (no library-validation exception) it loads nowhere. The package's
// field-native once linked Homebrew's harfbuzz this way: harfbuzz-sys 0.5.0's build.rs prefers a pkg-config host
// library. No release step noticed, because none loads field-native.
//
// The load commands are read from the file's own headers: LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB,
// LC_LAZY_LOAD_DYLIB and LC_LOAD_UPWARD_DYLIB, in every architecture of a fat file. Never LC_ID_DYLIB, a dylib's OWN
// install name, which `otool -L` prints first. A build path there is harmless, and reading it as a dependency was this
// finding's own false positive (mille's .node). Not through otool either: it takes `name(member)` for an archive member,
// so Electron's "VibeField Helper (GPU)" cannot be named to it.
//
// The launch check runs each named native binary with `--version`. dyld resolves every load command before `main`, so a
// binary that cannot load fails there, and one that can says its name and exits 0.
//
// Usage: node scripts/host-links.mjs (--app <VibeField.app> | --dir <dir>) [--launch <bin dir>]   (exit 1 on any; the
// launch check needs macOS)
import { spawnSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The load commands that make a dependency, by number (never LC_ID_DYLIB, 0xd: a dylib's own name). */
export const DEPENDENCY_COMMANDS = new Map([
  [0xc, "LC_LOAD_DYLIB"],
  [0x80000018, "LC_LOAD_WEAK_DYLIB"],
  [0x8000001f, "LC_REEXPORT_DYLIB"],
  [0x20, "LC_LAZY_LOAD_DYLIB"],
  [0x80000023, "LC_LOAD_UPWARD_DYLIB"],
]);
/** Where a shipped dependency may live: on every Mac, or inside the bundle. */
export const ALLOWED_PREFIXES = [
  "/usr/lib/",
  "/System/",
  "@rpath/",
  "@loader_path/",
  "@executable_path/",
];
/** The packaged native binaries the launch check runs (the stage's NATIVE_BINARIES, each with `--version`). */
export const LAUNCHED = ["field-native", "field-terminal-host"];

/** One thin image's dependency load commands, from a buffer holding its header and load commands (either byte order). */
export function imageCommands(buf) {
  const magicLE = buf.readUInt32LE(0);
  const le = magicLE === 0xfeedface || magicLE === 0xfeedfacf;
  if (!le && magicLE !== 0xcefaedfe && magicLE !== 0xcffaedfe)
    throw new Error("not a thin Mach-O image");
  const u32 = (at) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const ncmds = u32(16);
  let at = u32(0) === 0xfeedfacf ? 32 : 28;
  const out = [];
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = u32(at);
    const size = u32(at + 4);
    if (size < 8 || at + size > buf.length)
      throw new Error(`load command ${i} runs past the headers`);
    const kind = DEPENDENCY_COMMANDS.get(cmd);
    if (kind !== undefined) {
      const from = at + u32(at + 8);
      const nul = buf.indexOf(0, from);
      out.push({
        cmd: kind,
        name: buf.toString("utf8", from, nul === -1 || nul > at + size ? at + size : nul),
      });
    }
    at += size;
  }
  return out;
}

/** A Mach-O file's dependency load commands: its one image, or every architecture of a fat file. */
export function dependencyCommandsOf(file) {
  const fd = openSync(file, "r");
  try {
    const read = (pos, len) => {
      const b = Buffer.alloc(len);
      return b.subarray(0, readSync(fd, b, 0, len, pos));
    };
    const magic = read(0, 4).readUInt32BE(0);
    const bases = [];
    if (magic === 0xcafebabe || magic === 0xcafebabf) {
      const wide = magic === 0xcafebabf;
      const n = read(4, 4).readUInt32BE(0);
      const table = read(8, n * (wide ? 32 : 20));
      for (let i = 0; i < n; i += 1)
        bases.push(
          wide ? Number(table.readBigUInt64BE(i * 32 + 8)) : table.readUInt32BE(i * 20 + 8),
        );
    } else bases.push(0);
    const out = [];
    for (const base of bases) {
      const head = read(base, 32);
      const le = head.readUInt32LE(0) === 0xfeedface || head.readUInt32LE(0) === 0xfeedfacf;
      const wide = (le ? head.readUInt32LE(0) : head.readUInt32BE(0)) === 0xfeedfacf;
      const sizeofcmds = le ? head.readUInt32LE(20) : head.readUInt32BE(20);
      out.push(...imageCommands(read(base, (wide ? 32 : 28) + sizeofcmds)));
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

/** The dependencies outside the allowed prefixes. */
export function hostLinks(commands) {
  return commands.filter((c) => !ALLOWED_PREFIXES.some((p) => c.name.startsWith(p)));
}

const MACH_O_MAGIC = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xcafebabf, 0xbebafeca,
]);

/** Whether a file is Mach-O (thin either byte order, or fat), by its first bytes. `0xcafebabe` is a Java class file's
 * magic too: a fat header's next word counts its architectures (a handful), a class file's is its version (45 and up). */
export function isMachO(file) {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(8);
    const read = readSync(fd, head, 0, 8, 0);
    if (read < 4) return false;
    const magic = head.readUInt32BE(0);
    if (!MACH_O_MAGIC.has(magic)) return false;
    if (magic === 0xcafebabe && read === 8) return head.readUInt32BE(4) < 30;
    return true;
  } finally {
    closeSync(fd);
  }
}

/** Every regular Mach-O file under `root` (symlinks are not followed: a bundle's framework links point inside it). */
export function machOFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && lstatSync(path).size >= 4 && isMachO(path)) out.push(path);
    }
  };
  walk(root);
  return out.sort();
}

/** The gate over a tree: one line per host link (`HOST LINK  <file>: <cmd> <path>`) or unreadable Mach-O, each file
 * named relative to `root`. */
export function auditHostLinks(root, commandsOf = dependencyCommandsOf) {
  const problems = [];
  for (const file of machOFiles(root)) {
    let commands;
    try {
      commands = commandsOf(file);
    } catch (error) {
      problems.push(
        `UNREADABLE  ${relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const c of hostLinks(commands))
      problems.push(`HOST LINK  ${relative(root, file)}: ${c.cmd} ${c.name}`);
  }
  return problems;
}

/** The launch check: each of LAUNCHED in `binDir` runs `--version`, exits 0 and names itself; one line per failure. */
export function launchCheck(binDir) {
  const problems = [];
  for (const name of LAUNCHED) {
    const run = spawnSync(join(binDir, name), ["--version"], {
      encoding: "utf8",
      env: {},
      timeout: 15_000,
    });
    const said = (run.stdout ?? "").trim();
    if (run.error !== undefined) problems.push(`${name}: did not run (${run.error.message})`);
    else if (run.status !== 0 || !said.startsWith(`${name} `))
      problems.push(
        `${name}: --version exited ${run.status ?? run.signal}${said === "" ? "" : `, said ${JSON.stringify(said)}`}` +
          `${(run.stderr ?? "").trim() === "" ? "" : ` — ${(run.stderr ?? "").trim().split("\n")[0]}`}`,
      );
  }
  return problems;
}

function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const app = at("--app");
  const root =
    app !== undefined ? resolve(app) : at("--dir") !== undefined ? resolve(at("--dir")) : undefined;
  if (root === undefined)
    throw new Error("usage: --app <VibeField.app> | --dir <dir> [--launch <bin dir>]");
  const launchDir =
    at("--launch") ?? (app !== undefined ? join(root, "Contents", "Resources", "bin") : undefined);
  const files = machOFiles(root);
  const problems = auditHostLinks(root);
  if (launchDir !== undefined && process.platform === "darwin")
    problems.push(...launchCheck(resolve(launchDir)).map((p) => `LAUNCH  ${p}`));
  for (const p of problems) console.error(p);
  console.log(
    `host-links: ${files.length} Mach-O file(s) under ${root}; ${problems.length === 0 ? "no host link" : `${problems.length} problem(s)`}` +
      `${launchDir === undefined || process.platform !== "darwin" ? "" : `; launched ${LAUNCHED.join(", ")} --version`}`,
  );
  return problems.length === 0 ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`host-links: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
