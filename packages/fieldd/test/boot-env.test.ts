import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isPipeEndpoint, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDataRoot, nativeAlive, nativeMgmtEndpoint, splitPathList } from "../src/boot-env";

// WIN-3 (thinking-windows-port §4.3/§4.4) — the four decisions fieldd's entry
// point makes before anything exists. Each is platform-parameterized rather than
// read off `process.platform`, so this suite proves BOTH shapes from one
// machine: the win32 arms below never run on Windows here, which is exactly the
// point — the bugs they pin were invisible on unix.

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "vf-boot-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const listenOn = async (endpoint: string): Promise<Server> => {
  const server = createServer();
  cleanup.push(() => server.close());
  await new Promise<void>((ready) => server.listen(endpoint, ready));
  return server;
};

/** An address a listener can actually take under a fresh root, resolved by the
 * SAME function the probe dials — so these tests bind what production would.
 * On unix that is a `native/run/` path whose directory is ours to make (no
 * field-native ran here); on win32 it is a pipe name with nothing to create,
 * and `listen()` would refuse a filesystem path outright. */
const bindableEndpoint = (root: string): string => {
  const endpoint = nativeMgmtEndpoint(root);
  if (!isPipeEndpoint(endpoint)) mkdirSync(dirname(endpoint), { recursive: true });
  return endpoint;
};

describe("the data-root default is ONE decision in two planes (UA-0/WIN-D1)", () => {
  it("keeps the unix arms byte-for-byte", () => {
    expect(defaultDataRoot("darwin", {}, "/Users/me")).toBe(
      "/Users/me/Library/Application Support/VibeField",
    );
    expect(defaultDataRoot("linux", {}, "/home/me")).toBe("/home/me/.local/share/VibeField");
  });

  it("win32 lands in %APPDATA%, the root field-native's config.rs also derives", () => {
    expect(defaultDataRoot("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "C:\\x")).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\VibeField",
    );
  });

  it("falls back through the profile when APPDATA is unset, as the Rust twin does", () => {
    expect(defaultDataRoot("win32", {}, "C:\\Users\\me")).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\VibeField",
    );
  });
});

describe("PATH-style env lists split on the platform delimiter (WIN-3)", () => {
  it("keeps drive letters intact on win32", () => {
    expect(splitPathList("C:\\vf\\plugins;D:\\dev\\plugins", ";")).toEqual([
      "C:\\vf\\plugins",
      "D:\\dev\\plugins",
    ]);
  });

  it("pins the bug: the same list shredded on a hardcoded colon", () => {
    // What `split(":")` did to every Windows root — two paths in, four
    // nonexistent fragments out, and an empty plugin registry that blamed
    // discovery. This assertion exists so nobody reintroduces the colon.
    expect(splitPathList("C:\\vf\\plugins;D:\\dev\\plugins", ":")).toEqual([
      "C",
      "\\vf\\plugins;D",
      "\\dev\\plugins",
    ]);
  });

  it("keeps the unix reading unchanged, empties dropped, unset ⇒ empty", () => {
    expect(splitPathList("/a/plugins:/b/plugins", ":")).toEqual(["/a/plugins", "/b/plugins"]);
    expect(splitPathList("::/a::", ":")).toEqual(["/a"]);
    expect(splitPathList(undefined, ":")).toEqual([]);
  });
});

describe("the native mgmt endpoint (WIN-D1)", () => {
  it("is the joined LAYOUT path on unix", () => {
    expect(nativeMgmtEndpoint("/data/vf", "darwin")).toBe("/data/vf/native/run/mgmt.sock");
    expect(nativeMgmtEndpoint("/data/vf", "linux")).toBe("/data/vf/native/run/mgmt.sock");
  });

  it("is the contracts-derived pipe name on win32, carrying no path", () => {
    const root = "C:\\Users\\me\\AppData\\Roaming\\VibeField";
    const endpoint = nativeMgmtEndpoint(root, "win32");
    expect(endpoint).toBe(pipeEndpointFor(root, SOCKETS.MGMT));
    expect(endpoint.startsWith("\\\\.\\pipe\\")).toBe(true);
    // the scope is a hash, so the flat namespace — which every local process may
    // list — never publishes where a user keeps their field
    expect(endpoint).not.toContain("AppData");
  });

  it("gives two data roots two pipes (UA-D10's per-user pairs)", () => {
    expect(nativeMgmtEndpoint("C:\\vf\\a", "win32")).not.toBe(
      nativeMgmtEndpoint("C:\\vf\\b", "win32"),
    );
  });

  it("has no filesystem entry to stat — why the old existsSync gate was fatal", () => {
    // Not a claim about Windows filesystems: the point is that the endpoint
    // STRING the probe dials on win32 cannot satisfy a stat gate, on any
    // platform, so `existsSync(endpoint)` was a hard false and every boot
    // spawned a second field-native.
    expect(existsSync(nativeMgmtEndpoint("C:\\vf\\a", "win32"))).toBe(false);
  });
});

describe("nativeAlive is a connect probe, not a stat (WIN-3)", () => {
  it("a live listener reads alive", async () => {
    const endpoint = bindableEndpoint(tempRoot());
    await listenOn(endpoint);
    expect(await nativeAlive(endpoint)).toBe(true);
  });

  it("a closed listener reads dead", async () => {
    const endpoint = bindableEndpoint(tempRoot());
    const server = await listenOn(endpoint);
    await new Promise<void>((closed) => server.close(() => closed()));
    expect(await nativeAlive(endpoint)).toBe(false);
  });

  it("an fs entry that is not a listener reads dead", async () => {
    // Deliberately a filesystem path on BOTH planes: on unix it is the stale
    // socket inode a dead daemon leaves, and on win32 it is a string outside
    // the pipe namespace entirely — either way the dial answers, not a stat.
    const endpoint = join(tempRoot(), "mgmt.sock");
    writeFileSync(endpoint, "");
    expect(await nativeAlive(endpoint)).toBe(false);
  });

  it("a path that never existed reads dead — the dial IS the probe", async () => {
    expect(await nativeAlive(join(tempRoot(), "absent", "mgmt.sock"))).toBe(false);
  });
});
