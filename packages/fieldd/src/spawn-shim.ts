import { statSync } from "node:fs";
import { win32 } from "node:path";

// WIN-3 (thinking-windows-port §4.5) — the `.cmd`/`.bat` door, one helper for
// both of fieldd's spawn seams (ProcessService and the MCP stdio spawner).
// Node refuses to spawn a batch file without a shell since CVE-2024-27980, and
// libuv's own PATH walk only ever appends `.com`/`.exe` — so on Windows the
// practical MCP config (`npx`, `uvx`, anything in `node_modules\.bin`) fails
// before the child exists. The fix is NOT `shell: true`: that hands
// attacker-influenced argv to a command interpreter. It is to invoke
// `cmd.exe /d /s /c` ourselves with every token escaped — the recipe cross-spawn
// has carried in production for a decade (derivation: qntm.org/cmd).
//
// Two halves, both platform-parameterized so a unix machine can prove them:
//   - DETECTION — does this command resolve to a batch file? An explicit
//     `.cmd`/`.bat` suffix answers yes without touching the disk; a bare name
//     needs the PATH+PATHEXT walk below, because `npx` IS `npx.cmd` and nothing
//     in the name says so.
//   - QUOTING — `^`-escape the command token, quote-and-`^`-escape every
//     argument, wrap the payload in one more pair of quotes for `/s`, and tell
//     node the argv is already escaped (`windowsVerbatimArguments`).
//
// Anything that does not resolve to a batch file passes through UNCHANGED on
// every platform: libuv's own resolution stays authoritative for the normal
// case, so unix behavior is byte-for-byte what it was.

/** What to hand `child_process.spawn` — the shim is transparent when unneeded. */
export interface ShimmedCommand {
  command: string;
  args: string[];
  /** true when `args` are pre-escaped and node must not re-quote them */
  windowsVerbatimArguments: boolean;
}

export interface ShimContext {
  /** The env the CHILD will resolve with: libuv searches PATH out of the child's
   * env block, so detection reads PATH/PATHEXT from here to see what the child
   * would see. */
  env?: NodeJS.ProcessEnv;
  /** The child's cwd — searched first for a bare name, exactly as cmd.exe does. */
  cwd?: string;
  /** The shim HOST comes from the DAEMON's env, never the child's: plugin params
   * may write the child env, and which interpreter we re-enter is our decision. */
  comSpec?: string;
  /** test seam — the default is a real file stat */
  exists?: (candidate: string) => boolean;
}

const BATCH_EXTS = [".cmd", ".bat"];
/** cmd.exe's default when PATHEXT is unset. The ORDER is load-bearing: `.EXE`
 * before `.CMD` means a directory holding both runs the exe, unshimmed. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";
/** npm's shims re-enter cmd.exe a second time, so their meta chars need a second
 * round of `^` (cross-spawn's `needsDoubleEscapeMetaChars`). */
const CMD_SHIM_RE = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;
/** everything cmd.exe would otherwise interpret */
const META_CHARS = /[()\][%!^"`<>&|;, *?]/g;

const isBatch = (target: string): boolean =>
  BATCH_EXTS.includes(win32.extname(target).toLowerCase());

/** Windows env keys are case-insensitive; a child env assembled elsewhere may
 * carry any casing. */
const lookup = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const wanted = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key.toUpperCase() === wanted) return value;
  }
  return undefined;
};

const statFile = (candidate: string): boolean => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

/** libuv's rule, mirrored: a name "has an extension" when a dot appears in the
 * BASE name with something after it — `foo.` does not count, since Windows drops
 * a trailing dot. Only then is the literal name tried before the PATHEXT list. */
const hasExtension = (name: string): boolean => {
  const start = Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/"), name.lastIndexOf(":")) + 1;
  const base = name.slice(start);
  const dot = base.indexOf(".");
  return dot !== -1 && dot < base.length - 1;
};

/** A name carrying its own location — a separator, or a drive prefix (`C:foo` is
 * relative to that drive's working directory, not to PATH). */
const hasDirectory = (name: string): boolean => /[\\/]/.test(name) || /^[A-Za-z]:/.test(name);

/** The file a win32 spawn of `executable` would land on, or undefined when
 * nothing resolves — in which case the caller passes the name through and lets
 * the real spawn produce the honest ENOENT. Search order mirrors cmd.exe: a name
 * carrying a directory or drive is looked up only there; a bare name walks the
 * cwd first, then each PATH entry in order; and inside every directory the
 * literal name comes first (when it has an extension), then each PATHEXT suffix. */
export function resolveWin32Target(executable: string, ctx: ShimContext = {}): string | undefined {
  if (executable.length === 0) return undefined;
  const exists = ctx.exists ?? statFile;
  const env = ctx.env ?? {};
  const exts = (lookup(env, "PATHEXT") ?? DEFAULT_PATHEXT)
    .split(";")
    .map((ext) => ext.trim())
    .filter((ext) => ext.startsWith("."));
  const names = [
    ...(hasExtension(executable) ? [executable] : []),
    ...exts.map((ext) => executable + ext),
  ];
  const dirs: readonly (string | undefined)[] = hasDirectory(executable)
    ? [undefined] // the name carries its own location — PATH is not consulted
    : [
        ...(ctx.cwd !== undefined ? [ctx.cwd] : []),
        // PATH entries may be quoted on Windows; empty ones are shell accidents
        ...(lookup(env, "PATH") ?? "")
          .split(";")
          .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
          .filter((entry) => entry.length > 0),
      ];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = dir === undefined ? name : win32.join(dir, name);
      const probe =
        ctx.cwd === undefined || win32.isAbsolute(candidate)
          ? candidate
          : win32.join(ctx.cwd, candidate);
      if (exists(probe)) return probe;
    }
  }
  return undefined;
}

/** A command token: only the meta chars are escaped — the token keeps its own
 * quoting, exactly as cross-spawn does for the executable half. */
const escapeCommand = (token: string): string => token.replace(META_CHARS, "^$&");

/** One argument, per qntm.org/cmd: double every backslash run that precedes a
 * quote (or the end of the string, which is about to become one), escape the
 * quote itself, wrap the whole argument, then `^`-escape what cmd.exe would
 * still interpret inside those quotes. */
const escapeArgument = (arg: string, doubleEscape: boolean): string => {
  const escaped = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`.replace(
    META_CHARS,
    "^$&",
  );
  return doubleEscape ? escaped.replace(META_CHARS, "^$&") : escaped;
};

/** Route a spawn through `cmd.exe` when — and only when — its target is a batch
 * file on win32. Every other case, and every unix case, is a passthrough. */
export function shimSpawn(
  executable: string,
  args: readonly string[],
  platform = process.platform,
  ctx: ShimContext = {},
): ShimmedCommand {
  const passthrough: ShimmedCommand = {
    command: executable,
    args: [...args],
    windowsVerbatimArguments: false,
  };
  if (platform !== "win32") return passthrough;
  const target = isBatch(executable) ? executable : resolveWin32Target(executable, ctx);
  if (target === undefined || !isBatch(target)) return passthrough;
  const doubleEscape = CMD_SHIM_RE.test(target);
  const payload = [
    escapeCommand(win32.normalize(executable)),
    ...args.map((arg) => escapeArgument(arg, doubleEscape)),
  ].join(" ");
  return {
    command: ctx.comSpec ?? process.env["COMSPEC"] ?? "cmd.exe",
    // /d — no AutoRun scripts (a per-machine registry hook we never want in the
    // path of a supervised child) · /s + the outer quote pair — cmd strips
    // exactly one pair and takes the rest verbatim · /c — run, then exit.
    args: ["/d", "/s", "/c", `"${payload}"`],
    windowsVerbatimArguments: true,
  };
}
