import { describe, expect, it, vi } from "vitest";
import {
  parseSimctlSnapshot,
  SimctlService,
  SimctlUnavailableError,
} from "../src/main/live-surfaces/simctl";
import { SimulatorSetupService } from "../src/main/live-surfaces/simulator-setup";

const app = "/Applications/Xcode.app";
const dir = `${app}/Contents/Developer`;
const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
const deviceType = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const name = "iPhone 17 Pro";
function fixture(
  options: {
    vetted?: boolean;
    installed?: string;
    hasSimctl?: boolean;
    runtime?: boolean;
    firstLaunch?: number;
    license?: number;
    platform?: NodeJS.Platform;
  } = {},
) {
  const list = vi.fn(async () =>
    parseSimctlSnapshot(
      JSON.stringify({
        devices: {},
        runtimes: options.runtime
          ? [
              {
                identifier: runtime,
                name: "iOS 26.5",
                supportedDeviceTypes: [{ identifier: deviceType, name }],
              },
            ]
          : [],
      }),
    ),
  );
  const developerDir = vi.fn(async () => {
    if (options.vetted === false) throw new SimctlUnavailableError();
    return dir;
  });
  const run = vi.fn(async (file: string, args: string[]) => {
    if (file.endsWith("/mdfind")) return { code: 0, output: options.installed ?? "" };
    if (args[0] === "-checkFirstLaunchStatus")
      return { code: options.firstLaunch ?? 0, output: "" };
    if (args[0] === "-license") return { code: options.license ?? 0, output: "" };
    if (file.endsWith("/plutil")) return { code: 0, output: "26.6" };
    if (file.endsWith("/open")) return { code: 0, output: "" };
    throw new Error("Unexpected command");
  });
  const exists = (path: string) =>
    path === `${options.installed}/Contents/MacOS/Xcode` ||
    (options.hasSimctl === true &&
      path === `${options.installed}/Contents/Developer/usr/bin/simctl`);
  const setup = new SimulatorSetupService(
    { developerDir, list },
    { platform: options.platform ?? "darwin", run, exists },
  );
  return { setup, run, list, developerDir };
}

describe("local simulator prerequisites", () => {
  it.each([
    [{ vetted: false }, "install-xcode"],
    [{ vetted: false, installed: "/Applications/Xcode-beta.app", hasSimctl: true }, "select-xcode"],
    [{ vetted: false, installed: app }, "finish-xcode"],
    [{ firstLaunch: 1, license: 69 }, "accept-license"],
    [{ license: 69 }, "accept-license"],
    [{ firstLaunch: 1 }, "finish-xcode"],
    [{ firstLaunch: 70 }, "unavailable"],
    [{}, "install-runtime"],
  ] as const)("identifies %o as %s without opening an app", async (options, stage) => {
    const h = fixture(options);
    expect((await h.setup.check()).stage).toBe(stage);
    expect(h.run.mock.calls.some(([file]) => file.endsWith("/open"))).toBe(false);
    if (stage !== "install-runtime") expect(h.list).not.toHaveBeenCalled();
  });

  it("reads the same developer directory and catalog as capture, once for concurrent panes", async () => {
    const h = fixture({ runtime: true, installed: app });
    const expected = {
      stage: "ready",
      xcodeVersion: "26.6",
      configurations: [{ runtime, models: [{ deviceType, name }] }],
    };
    expect(await Promise.all([h.setup.check(), h.setup.check()])).toEqual([expected, expected]);
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledWith(
      `${dir}/usr/bin/xcodebuild`,
      ["-checkFirstLaunchStatus"],
      dir,
    );
    h.list.mockRejectedValueOnce(new Error("CoreSimulator is restarting"));
    expect(await h.setup.check()).toEqual({ stage: "unavailable", xcodeVersion: "26.6" });
    expect(await h.setup.check()).toEqual(expected);
  });

  it("checks a newly installed Xcode immediately without weakening normal probe caching", async () => {
    let installed = false;
    const exec = vi.fn(async () => "/Library/Developer/CommandLineTools");
    const service = new SimctlService({
      exec,
      exists: (path) => installed && path === `${dir}/usr/bin/simctl`,
    });
    await expect(service.developerDir()).rejects.toThrow(SimctlUnavailableError);
    installed = true;
    await expect(service.developerDir()).rejects.toThrow(SimctlUnavailableError);
    expect(await service.developerDir({ refresh: true })).toBe(dir);
    expect(exec).toHaveBeenCalledTimes(2);
    installed = false;
    await expect(service.developerDir({ refresh: true })).rejects.toThrow(SimctlUnavailableError);
    await expect(service.developerDir()).rejects.toThrow(SimctlUnavailableError);
  });

  it("keeps incomplete model metadata distinct from a missing runtime", async () => {
    const h = fixture();
    h.list.mockResolvedValueOnce(
      parseSimctlSnapshot(
        JSON.stringify({
          devices: {},
          runtimes: [{ identifier: runtime, name: "iOS 26.5", supportedDeviceTypes: [] }],
        }),
      ),
    );
    expect((await h.setup.check()).stage).toBe("unavailable");
  });

  it("opens the App Store listing and the same Xcode the simulator uses only on request", async () => {
    const h = fixture({ installed: app });
    await h.setup.open("app-store");
    await h.setup.open("xcode");
    expect(h.run.mock.calls).toEqual([
      [
        "/usr/bin/open",
        ["-b", "com.apple.AppStore", "https://apps.apple.com/app/xcode/id497799835"],
      ],
      ["/usr/bin/open", ["-a", app]],
    ]);
  });

  it("avoids probing or opening apps on other operating systems", async () => {
    const h = fixture({ platform: "linux" });
    expect(await h.setup.check()).toEqual({ stage: "unsupported" });
    await expect(h.setup.open("xcode")).rejects.toThrow();
    expect(h.developerDir).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
  });
});
