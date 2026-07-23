import { homedir } from "node:os";
import { posix, win32 } from "node:path";

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
