import type { ShellMode } from "./modes";

// The PURE security policy (ESR §5.2.3–5.2.4) — no Electron import, unit-tested
// directly. security.ts wires these decisions into Electron.

/** Every non-dev CSP admits the daemon's loopback WebSockets by HOST, with the
 * port left open. Dev returns null — the Vite dev server needs its HMR inline
 * preamble. 'wasm-unsafe-eval' admits WebAssembly compilation ONLY (loro's
 * inlined base64 wasm — B1 finding); plain 'unsafe-eval' stays banned.
 *
 * The port is deliberately NOT enumerated, and this is a correction (2026-08-11):
 * production used to name `PORTS.FIELDD_WS_CONTROL`/`_DATA`, and the old comment
 * here justified that with "possible before daemon readiness only because
 * production ports are pinned (§5.2.4; ESR-8)". **That premise died at UA-D12/UA-5**,
 * where every pair began binding an EPHEMERAL port (`main/fieldd.ts` passes
 * `controlPort: 0, dataPort: 0`; registries.ts calls 9410/9411 a legacy
 * documentation default) and `product.json` became the only discovery. The
 * renderer therefore dialled a port this policy refused: Chromium blocked the
 * socket, FielddClient reconnect-looped without ever rejecting `ready()`, and the
 * first request — `doc.list` — timed out at 8 s into a degraded docs session.
 * Only production ever took the pinned branch, so dev and every smoke mode
 * (already on this wildcard) stayed green and the fault reached the first real
 * launch. It was NEVER Windows-specific.
 *
 * Naming the real port here is not merely awkward, it is structurally impossible:
 * this policy is installed before the first window exists (ESP §6.2 — no renderer
 * may outrun its own policy) and the window deliberately does not wait for the
 * daemon (design-03 §4.3 — the splash is the honest face while the pair comes up),
 * so at CSP-build time there is no port to name. A per-response rebuild would
 * still be wrong: a document's CSP is fixed at load, while recovery and the UA-5
 * user switch both replace the pair — and its port — under a live document.
 *
 * The honest bound: this admits a WebSocket to any loopback port, so a
 * compromised renderer could reach another local service. What it does NOT widen
 * is the wall that actually holds — fieldd binds 127.0.0.1 only, refuses an
 * unknown `Origin` with a 1008 close, and requires a bearer token per surface
 * (EL7). `script-src 'self'` means no remote code can arrive to exploit the
 * aperture in the first place. */
export function buildCsp(mode: ShellMode): string | null {
  if (mode === "dev") return null;
  return (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https://*.ts.net:*; connect-src ws://127.0.0.1:*; " +
    "base-uri 'none'; object-src 'none'"
  );
}

/** Deny-by-default navigation: the field is a single document that never
 * navigates. Dev allows same-origin only (Vite full-reload). */
export function decideNavigation(mode: ShellMode, currentUrl: string, targetUrl: string): boolean {
  if (mode !== "dev") return false;
  try {
    return new URL(targetUrl).origin === new URL(currentUrl).origin;
  } catch {
    return false;
  }
}

export interface WindowOpenDecision {
  action: "deny";
  /** https URLs leave through the system browser — the interim
   * shell.openExternal (design-03 §5.1; ESR-15). Everything else just dies. */
  openExternal?: string;
}

export function decideWindowOpen(url: string): WindowOpenDecision {
  try {
    if (new URL(url).protocol === "https:") return { action: "deny", openExternal: url };
  } catch {
    /* malformed → plain deny */
  }
  return { action: "deny" };
}

/** Chromium permissions the shell session grants. EMPTY BY LAW (ESP §7.4): a
 * VibeField capability grant never implies a Chromium permission — they are two
 * gates, and this one is closed. The set is data, not control flow, so the first
 * legitimate grant is a one-line change that its own test must justify (declared
 * in contracts · origin + gesture validated · decided at BOTH handlers).
 * Camera and microphone arrive as "media"; screen capture as "display-capture". */
const SHELL_GRANTED_PERMISSIONS: ReadonlySet<string> = new Set<string>();

/** Deny-by-default for both `setPermissionCheckHandler` and
 * `setPermissionRequestHandler` — one decision, so a check can never disagree
 * with a request (the pair is how an ambient capability slips in). */
export function decidePermission(permission: string): boolean {
  return SHELL_GRANTED_PERMISSIONS.has(permission);
}
