import { describe, expect, it, vi } from "vitest";
import { bundlePathOf, classifyLocation, readAppLocation } from "../../src/main/updates/location";

// AU-7 (AU-G8; LC-10; main-process.md §8.1) — where the bundle runs, as a table: App Translocation and a folder this
// user cannot write (a mounted disk image, a shared volume) are `read-only`, the one hold that changes the act;
// Applications is `applications`; any writable folder else is `elsewhere`, which updates as usual. Off macOS nothing
// is said.

const EXEC = "Contents/MacOS/VibeField";

describe("classifyLocation — the table", () => {
  it.each([
    ["Applications", "/Applications/VibeField.app", true, true, "applications"],
    [
      "the person's own Applications",
      "/Users/me/Applications/VibeField.app",
      true,
      true,
      "applications",
    ],
    ["Downloads, writable", "/Users/me/Downloads/VibeField.app", false, true, "elsewhere"],
    ["a writable external volume", "/Volumes/Work/Apps/VibeField.app", false, true, "elsewhere"],
    [
      "App Translocation (opened where it was downloaded)",
      "/private/var/folders/x1/abc/T/AppTranslocation/0F2A-11/d/VibeField.app",
      false,
      false,
      "read-only",
    ],
    [
      "App Translocation, whatever Electron says of Applications",
      "/private/var/folders/x1/abc/T/AppTranslocation/0F2A-11/d/VibeField.app",
      true,
      true,
      "read-only",
    ],
    ["a mounted disk image", "/Volumes/VibeField/VibeField.app", false, false, "read-only"],
    [
      "a folder this user cannot write",
      "/Users/Shared/Tools/VibeField.app",
      false,
      false,
      "read-only",
    ],
  ] as const)("%s", (_name, bundlePath, inApplications, parentWritable, expected) => {
    expect(classifyLocation({ bundlePath, inApplications, parentWritable })).toBe(expected);
  });
});

describe("readAppLocation — the Electron edge", () => {
  const app = (answer: boolean | Error) => ({
    isInApplicationsFolder: vi.fn(() => {
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  });

  it("finds the bundle from the executable, and asks whether its PARENT is writable", () => {
    expect(bundlePathOf(`/Users/me/Downloads/VibeField.app/${EXEC}`)).toBe(
      "/Users/me/Downloads/VibeField.app",
    );
    const isWritable = vi.fn(() => true);
    expect(
      readAppLocation(app(false), {
        platform: "darwin",
        execPath: `/Users/me/Downloads/VibeField.app/${EXEC}`,
        isWritable,
      }),
    ).toBe("elsewhere");
    expect(isWritable).toHaveBeenCalledWith("/Users/me/Downloads");
  });

  it("reads a disk image and Applications", () => {
    expect(
      readAppLocation(app(false), {
        platform: "darwin",
        execPath: `/Volumes/VibeField/VibeField.app/${EXEC}`,
        isWritable: () => false,
      }),
    ).toBe("read-only");
    expect(
      readAppLocation(app(true), {
        platform: "darwin",
        execPath: `/Applications/VibeField.app/${EXEC}`,
        isWritable: () => false,
      }),
    ).toBe("applications");
  });

  it("a throwing isInApplicationsFolder reads as outside: the parent's writability decides", () => {
    const options = {
      platform: "darwin",
      execPath: `/Applications/VibeField.app/${EXEC}`,
    } as const;
    expect(readAppLocation(app(new Error("no")), { ...options, isWritable: () => true })).toBe(
      "elsewhere",
    );
    expect(readAppLocation(app(new Error("no")), { ...options, isWritable: () => false })).toBe(
      "read-only",
    );
  });

  it("says nothing off macOS, and asks nothing", () => {
    const asked = app(true);
    const isWritable = vi.fn(() => true);
    for (const platform of ["win32", "linux"] as const)
      expect(readAppLocation(asked, { platform, isWritable })).toBeUndefined();
    expect(asked.isInApplicationsFolder).not.toHaveBeenCalled();
    expect(isWritable).not.toHaveBeenCalled();
  });
});
