import { describe, expect, it } from "vitest";
import { resolveShellIdentity } from "../src/main/login-shell";

// GT-D10: the workspace spawns every pane with `platform.defaultShell`, so this
// ladder decides what the user's terminal actually IS. The tombstone these
// tests stand over is `sh-3.2$` — a `/bin/sh` pane, from a placeholder nobody
// meant to be reachable.

const HOME = { shell: "/bin/fish", homedir: "/Users/pat" };

describe("resolveShellIdentity", () => {
  it("prefers $SHELL — the shell the user is actually running", () => {
    expect(resolveShellIdentity({ SHELL: "/opt/homebrew/bin/fish" }, HOME, "darwin")).toEqual({
      defaultShell: "/opt/homebrew/bin/fish",
      home: "/Users/pat",
    });
  });

  it("falls back to the passwd entry when $SHELL is absent", () => {
    // The case that matters on macOS: an app launched from Finder or a
    // LaunchAgent inherits no login shell environment, so `SHELL` is simply
    // not there — but the passwd entry still knows.
    expect(resolveShellIdentity({}, HOME, "darwin").defaultShell).toBe("/bin/fish");
  });

  it("treats an empty or blank $SHELL as absent rather than as a shell", () => {
    expect(resolveShellIdentity({ SHELL: "" }, HOME, "linux").defaultShell).toBe("/bin/fish");
    expect(resolveShellIdentity({ SHELL: "   " }, HOME, "linux").defaultShell).toBe("/bin/fish");
  });

  it("ends at a real shell, never at /bin/sh, when everything is silent", () => {
    const identity = resolveShellIdentity({}, { shell: null, homedir: "/Users/pat" }, "darwin");
    expect(identity.defaultShell).toBe("/bin/zsh");
    expect(identity.defaultShell).not.toBe("/bin/sh");
  });

  it("reads COMSPEC on win32, where $SHELL means nothing", () => {
    expect(
      resolveShellIdentity(
        { SHELL: "/bin/bash", COMSPEC: "C:\\WINDOWS\\system32\\cmd.exe" },
        { shell: null, homedir: "C:\\Users\\pat" },
        "win32",
      ),
    ).toEqual({ defaultShell: "C:\\WINDOWS\\system32\\cmd.exe", home: "C:\\Users\\pat" });
  });

  it("falls back to powershell when win32 has no COMSPEC", () => {
    expect(
      resolveShellIdentity({}, { shell: null, homedir: "C:\\Users\\pat" }, "win32").defaultShell,
    ).toBe("powershell.exe");
  });

  it("answers a home even when the passwd entry has none — it becomes initialCwd", () => {
    expect(
      resolveShellIdentity({ HOME: "/Users/pat" }, { shell: null, homedir: "" }, "darwin"),
    ).toEqual({ defaultShell: "/bin/zsh", home: "/Users/pat" });
    // A cwd of "/" is a poor home and an honest one; the workspace passes it to
    // a real `chdir`, so an empty string would be the only unusable answer.
    expect(resolveShellIdentity({}, { shell: null, homedir: "" }, "darwin").home).toBe("/");
  });
});
