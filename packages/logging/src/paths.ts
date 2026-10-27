import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { LAYOUT, LOG_STREAMS, type LogStream } from "@vibefield/contracts";

/** Item 78 — the streams a user's daemon PAIR writes, under that user's `pairLogRoot`; every other registered stream
 * is the Electron application's own and stays at the platform root (LOG §6.5, §7.1). */
export const PAIR_LOG_STREAMS: readonly LogStream[] = [
  LOG_STREAMS.SYSTEM_FIELDD,
  LOG_STREAMS.SYSTEM_FIELD_NATIVE,
  LOG_STREAMS.PLUGINS_SERVICE,
];

export function isPairLogStream(stream: LogStream): boolean {
  return PAIR_LOG_STREAMS.includes(stream);
}

/** A fuid as the user root spells it: the decimal `String(record.fuid)` of users-file.ts `userRootFor`. */
const FUID = /^[1-9][0-9]*$/;

/**
 * Item 78 (UA-D16 reversed 2026-10-27, James's O1; LOG §6.5, §7.1) — the log root of ONE VibeField user's daemon
 * pair: the platform (or override) root, then `users/<fuid>`, the fuid read off the pair's USER ROOT, whose shape is
 * `<VibeField root>/users/<fuid>` (`userRootFor`). DERIVED, never configured: whoever launches a pair (the shell's
 * supervisor, a standalone fieldd, field-native's own resolver in Rust) lands it in the same place, and two users'
 * pairs never contend for one stream under LOG's one-writer-per-file rule. A data dir of any other shape (a test's
 * temporary root, an injected root) logs at `platformRoot`, as every pair did before this.
 */
export function pairLogRoot(
  platformRoot: string,
  userRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const path = platform === "win32" ? win32 : posix;
  const trimmed = userRoot.replace(platform === "win32" ? /[\\/]+$/ : /\/+$/, "");
  const fuid = path.basename(trimmed);
  if (!FUID.test(fuid)) return platformRoot;
  // Walk the registry's own segments back from the fuid, as field-native's twin does (config.rs `pair_log_root`).
  let candidate = path.dirname(trimmed);
  for (const segment of [...LAYOUT.USERS_DIR].reverse()) {
    if (path.basename(candidate) !== segment) return platformRoot;
    candidate = path.dirname(candidate);
  }
  return path.join(platformRoot, ...LAYOUT.USERS_DIR, fuid);
}

/** Every user's pair log root under one platform root, for the readers that span users (support bundles, doctor):
 * `users/<fuid>` directories only, in fuid order. An absent `users/` is no users, not an error. */
export async function pairLogRoots(
  platformRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<Array<{ fuid: string; root: string }>> {
  const path = platform === "win32" ? win32 : posix;
  const users = path.join(platformRoot, ...LAYOUT.USERS_DIR);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(users, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && FUID.test(entry.name))
    .map((entry) => ({ fuid: entry.name, root: path.join(users, entry.name) }))
    .sort((a, b) => Number(a.fuid) - Number(b.fuid));
}

export interface ResolveLogRootOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** FIELD_LOG_DIR is a development/test override, never ambient production
   * configuration. Callers must make that mode decision explicitly. */
  allowOverride?: boolean;
}

export function resolvePlatformLogRoot(options: ResolveLogRootOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  if (options.allowOverride === true && env["FIELD_LOG_DIR"]) {
    const override = env["FIELD_LOG_DIR"];
    const absolute = platform === "win32" ? win32.isAbsolute(override) : posix.isAbsolute(override);
    if (!absolute) throw new Error("FIELD_LOG_DIR must be absolute");
    return override;
  }

  if (platform === "win32") {
    const localAppData = env["LOCALAPPDATA"] ?? win32.join(home, "AppData", "Local");
    return win32.join(localAppData, "VibeField", "Logs");
  }
  if (platform === "darwin") return posix.join(home, "Library", "Logs", "VibeField");

  const stateHome = env["XDG_STATE_HOME"] ?? posix.join(home, ".local", "state");
  return posix.join(stateHome, "vibefield", "logs");
}
