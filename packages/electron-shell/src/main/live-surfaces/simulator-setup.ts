import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { SimulatorSetupStatus, SimulatorSetupTarget } from "@vibefield/contracts";
import { type SimctlService, SimctlUnavailableError, simulatorConfigurations } from "./simctl";

const DEFAULT_XCODE = "/Applications/Xcode.app";
const XCODE_STORE = "https://apps.apple.com/app/xcode/id497799835";

interface CommandResult {
  code: number | null;
  output: string;
}
type Run = (file: string, args: string[], developerDir?: string) => Promise<CommandResult>;

const runCommand: Run = (file, args, developerDir) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: 8_000,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C", ...(developerDir && { DEVELOPER_DIR: developerDir }) },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : null) : 0,
          output: [stdout, stderr].filter(Boolean).join("\n").trim(),
        }),
    );
  });

interface SetupOptions {
  platform?: NodeJS.Platform;
  run?: Run;
  exists?: (path: string) => boolean;
}

export class SimulatorSetupService {
  private pending: Promise<SimulatorSetupStatus> | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly run: Run;
  private readonly exists: (path: string) => boolean;

  constructor(
    private readonly simctl: Pick<SimctlService, "developerDir" | "list">,
    options: SetupOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? runCommand;
    this.exists = options.exists ?? existsSync;
  }

  check(): Promise<SimulatorSetupStatus> {
    this.pending ??= this.inspect()
      .catch((): SimulatorSetupStatus => ({ stage: "unavailable" }))
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async installedApp(): Promise<string | undefined> {
    if (this.exists(join(DEFAULT_XCODE, "Contents/MacOS/Xcode"))) return DEFAULT_XCODE;
    const result = await this.run("/usr/bin/mdfind", [
      "kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'",
    ]);
    if (result.code !== 0) throw new Error("Cannot locate Xcode");
    return result.output
      .split("\n")
      .find(
        (path) =>
          isAbsolute(path) &&
          path.endsWith(".app") &&
          this.exists(join(path, "Contents/MacOS/Xcode")),
      );
  }

  private async inspect(): Promise<SimulatorSetupStatus> {
    if (this.platform !== "darwin") return { stage: "unsupported" };
    let dir: string;
    try {
      dir = await this.simctl.developerDir({ refresh: true });
    } catch (error) {
      if (!(error instanceof SimctlUnavailableError)) throw error;
      const app = await this.installedApp();
      if (!app) return { stage: "install-xcode" };
      return {
        stage: this.exists(join(app, "Contents/Developer/usr/bin/simctl"))
          ? "select-xcode"
          : "finish-xcode",
      };
    }

    const build = join(dir, "usr/bin/xcodebuild");
    const [firstLaunch, license, version] = await Promise.all([
      this.run(build, ["-checkFirstLaunchStatus"], dir),
      this.run(build, ["-license", "check"], dir),
      this.run("/usr/bin/plutil", [
        "-extract",
        "CFBundleShortVersionString",
        "raw",
        "-o",
        "-",
        join(dirname(dir), "Info.plist"),
      ]),
    ]);
    const installed =
      version.code === 0 && /^\d+(?:\.\d+){0,3}$/.test(version.output)
        ? { xcodeVersion: version.output }
        : {};
    if (
      license.code === 69 ||
      (license.code !== 0 &&
        /(?:not agreed|agree(?:ing)? to|accept).*licen[cs]e/i.test(license.output))
    )
      return { stage: "accept-license", ...installed };
    if (license.code !== 0) return { stage: "unavailable", ...installed };
    if (firstLaunch.code === 1) return { stage: "finish-xcode", ...installed };
    if (firstLaunch.code !== 0) return { stage: "unavailable", ...installed };
    try {
      const snapshot = await this.simctl.list();
      const configurations = simulatorConfigurations(snapshot);
      if (configurations.length) return { stage: "ready", ...installed, configurations };
      // Older or incomplete listings can contain an installed iOS but no usable iPhone pair.
      const hasIos = snapshot.runtimes.some((runtime) =>
        runtime.identifier.includes(".SimRuntime.iOS-"),
      );
      return { stage: hasIos ? "unavailable" : "install-runtime", ...installed };
    } catch {
      return { stage: "unavailable", ...installed };
    }
  }

  async open(target: SimulatorSetupTarget): Promise<void> {
    if (this.platform !== "darwin") throw new Error("Simulator setup requires macOS");
    const args =
      target === "app-store"
        ? ["-b", "com.apple.AppStore", XCODE_STORE]
        : await this.xcodeOpenArgs();
    if ((await this.run("/usr/bin/open", args)).code !== 0)
      throw new Error("Could not open the setup application");
  }

  private async xcodeOpenArgs(): Promise<string[]> {
    try {
      const dir = await this.simctl.developerDir({ refresh: true });
      const app = dirname(dirname(dir));
      if (app.endsWith(".app") && this.exists(join(app, "Contents/MacOS/Xcode")))
        return ["-a", app];
    } catch (error) {
      if (!(error instanceof SimctlUnavailableError)) throw error;
    }
    return ["-b", "com.apple.dt.Xcode"];
  }
}
