import { PORTS } from "@vibefield/contracts";
import type { ShellMode } from "./modes";

// The PURE security policy (ESR §5.2.3–5.2.4) — no Electron import, unit-tested
// directly. security.ts wires these decisions into Electron.

/** Production CSP enumerates the REGISTRY loopback ports — possible before
 * daemon readiness only because production ports are pinned (§5.2.4; ESR-8).
 * Smoke-like modes keep the loopback wildcard: their daemons bind ephemeral
 * test ports and their builds are never packaged. Dev returns null — the Vite
 * dev server needs its HMR inline preamble. 'wasm-unsafe-eval' admits
 * WebAssembly compilation ONLY (loro's inlined base64 wasm — B1 finding);
 * plain 'unsafe-eval' stays banned. */
export function buildCsp(mode: ShellMode): string | null {
  if (mode === "dev") return null;
  const connect =
    mode === "production"
      ? `ws://127.0.0.1:${PORTS.FIELDD_WS_CONTROL} ws://127.0.0.1:${PORTS.FIELDD_WS_DATA}`
      : "ws://127.0.0.1:*";
  return (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
    `img-src 'self' data:; connect-src ${connect}; base-uri 'none'; object-src 'none'`
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
