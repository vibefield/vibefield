import { PORTS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { ShellMode } from "../src/main/modes";
import {
  buildCsp,
  decideNavigation,
  decidePermission,
  decideWindowOpen,
} from "../src/main/security-policy";

// The PURE security policy (ESR §5.2.3–5.2.4).
//
// These rows read the POLICY, not its spelling: `connectSrc` parses the
// directive and `admitsLoopbackWs` answers the only question that matters —
// would the renderer's real socket be allowed? The two rows this replaced
// asserted the spelling ("enumerates EXACTLY the two registry loopback ports"
// and "never widens connect-src to the loopback wildcard") and so PINNED THE
// DEFECT: they were green for four days while production refused every socket
// the pair actually bound (see buildCsp's own note; UA-D12 made ports
// ephemeral and nothing here noticed). A test that spells out the answer
// cannot catch the answer going stale.

const SMOKE_LIKE: readonly ShellMode[] = ["smoke", "smoke-canvas", "smoke-godview", "spike-loro"];
const NON_DEV: readonly ShellMode[] = ["production", ...SMOKE_LIKE];

/** The connect-src sources, in order, exactly as written. */
function connectSrc(csp: string): string[] {
  const directive = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("connect-src "));
  return directive === undefined ? [] : directive.split(/\s+/).slice(1);
}

/** Would this policy admit the renderer's loopback WebSocket on `port`? A
 * source admits it by naming the port exactly or by wildcarding the port. */
function admitsLoopbackWs(csp: string, port: number): boolean {
  return connectSrc(csp).some((s) => s === `ws://127.0.0.1:${port}` || s === "ws://127.0.0.1:*");
}

describe("buildCsp", () => {
  it("returns null in dev so Vite's HMR inline preamble is permitted", () => {
    expect(buildCsp("dev")).toBeNull();
  });

  describe("production", () => {
    const csp = buildCsp("production");

    it("is a concrete policy string, not null", () => {
      expect(typeof csp).toBe("string");
    });

    it("admits the EPHEMERAL port the pair actually binds (UA-D12)", () => {
      // The regression pin. `main/fieldd.ts` passes controlPort/dataPort 0, so
      // the real port is OS-assigned and cannot be known when this policy is
      // built — the window loads before the daemon is ready by design. Sampling
      // the ephemeral range is the assertion whose absence cost a launch.
      for (const port of [49152, 51234, 60999]) {
        expect(admitsLoopbackWs(csp as string, port)).toBe(true);
      }
    });

    it("still admits the legacy registry ports, which it no longer names", () => {
      // Wall R7 (no port literals) is satisfied by naming NO port at all; the
      // registry values must keep working for a pair pinned back to them.
      expect(admitsLoopbackWs(csp as string, PORTS.FIELDD_WS_CONTROL)).toBe(true);
      expect(admitsLoopbackWs(csp as string, PORTS.FIELDD_WS_DATA)).toBe(true);
    });

    it("opens exactly ONE connect source, and it is loopback — no fan-out", () => {
      // The surviving half of the row this replaced: the aperture widened by a
      // port, never by a host. Nothing off-device may be dialled.
      expect(connectSrc(csp as string)).toEqual(["ws://127.0.0.1:*"]);
    });

    it("admits wasm compilation only and keeps plain unsafe-eval banned", () => {
      expect(csp).toContain("'wasm-unsafe-eval'");
      // Careful substring wall: 'wasm-unsafe-eval' DOES contain "unsafe-eval",
      // but the bare token "'unsafe-eval'" (with its own leading quote) must be
      // absent. Asserting the quoted form is what distinguishes the two.
      expect(csp).not.toContain("'unsafe-eval'");
    });
  });

  describe.each(SMOKE_LIKE)("%s (smoke-like)", (mode) => {
    const csp = buildCsp(mode);

    it("keeps the loopback wildcard for ephemeral test ports", () => {
      expect(csp).toContain("ws://127.0.0.1:*");
    });

    it("still admits wasm compilation only, never plain unsafe-eval", () => {
      expect(csp).toContain("'wasm-unsafe-eval'");
      expect(csp).not.toContain("'unsafe-eval'");
    });
  });

  it.each(NON_DEV)("%s admits only image loading from custom-port MagicDNS hosts", (mode) => {
    const csp = buildCsp(mode) as string;
    expect(csp).toContain("img-src 'self' data: https://*.ts.net:*");
    expect(csp).not.toContain("frame-src");
    expect(csp).not.toContain("connect-src https://");
  });
});

describe("decideNavigation", () => {
  describe.each(NON_DEV)("%s denies by default", (mode) => {
    it("denies same-origin navigation (the field never navigates)", () => {
      expect(decideNavigation(mode, "http://localhost:5173/a", "http://localhost:5173/b")).toBe(
        false,
      );
    });

    it("denies cross-origin navigation", () => {
      expect(decideNavigation(mode, "http://localhost:5173/a", "https://evil.example/x")).toBe(
        false,
      );
    });
  });

  describe("dev", () => {
    it("allows same-origin navigation (Vite full reload)", () => {
      expect(decideNavigation("dev", "http://localhost:5173/a", "http://localhost:5173/b")).toBe(
        true,
      );
    });

    it("denies a different origin", () => {
      expect(decideNavigation("dev", "http://localhost:5173/a", "http://evil.example/b")).toBe(
        false,
      );
    });

    it("denies a malformed target url", () => {
      expect(decideNavigation("dev", "http://localhost:5173/a", ":::not a url")).toBe(false);
    });
  });
});

describe("decideWindowOpen", () => {
  it("routes an https url out through openExternal (the interim shell.openExternal)", () => {
    const url = "https://login.tailscale.com/a/0123456789abcdef";
    expect(decideWindowOpen(url)).toEqual({ action: "deny", openExternal: url });
  });

  // Everything that is not https just dies: a plain deny with NO openExternal key.
  const plainDeny: readonly string[] = [
    "http://example.com/",
    "file:///etc/passwd",
    "mailto:someone@example.com",
    "javascript:alert(1)",
    "not a url at all",
    "",
  ];

  describe.each(plainDeny)("denies %j with no openExternal", (url) => {
    it("returns a bare deny decision", () => {
      const decision = decideWindowOpen(url);
      expect(decision).toStrictEqual({ action: "deny" });
      expect("openExternal" in decision).toBe(false);
    });
  });
});

describe("decidePermission", () => {
  // Electron's permission vocabulary as of the pinned major, enumerated rather
  // than sampled: ESP §7.4 denies the shell session everything, so a Chromium
  // upgrade that ADDS a permission must show up here as a deliberate row —
  // never as an untested string that quietly takes the default path.
  const CHROMIUM_PERMISSIONS: readonly string[] = [
    "media", // camera + microphone
    "display-capture",
    "geolocation",
    "notifications",
    "midi",
    "midiSysex",
    "hid",
    "serial",
    "usb",
    "bluetooth",
    "fileSystem",
    "pointerLock",
    "keyboardLock",
    "fullscreen",
    "openExternal",
    "clipboard-read",
    "clipboard-sanitized-write",
    "storage-access",
    "top-level-storage-access",
    "idle-detection",
    "speaker-selection",
    "window-management",
    "unknown",
  ];

  describe.each(CHROMIUM_PERMISSIONS)("denies %s", (permission) => {
    it("returns false — the shell session grants no Chromium permission", () => {
      expect(decidePermission(permission)).toBe(false);
    });
  });

  it("denies a permission string Chromium has not shipped yet", () => {
    // The allowlist is a Set membership test, so an unknown future permission
    // fails closed by construction rather than by an updated match arm.
    expect(decidePermission("some-future-capability")).toBe(false);
  });

  it("denies the empty permission", () => {
    expect(decidePermission("")).toBe(false);
  });
});
