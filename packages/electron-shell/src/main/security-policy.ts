import { createHash } from "node:crypto";
import { PLUGIN_MODULE_SCHEME } from "@vibefield/contracts";
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
 * `importMapHashes` (P8b-3, §11.6): the built index.html carries ONE inline
 * `<script type="importmap">` binding the PA-29 singletons to app-origin
 * chunks. The policy has no inline-script allowance, so the map is admitted by
 * its exact hash — build-deterministic bytes, hashed by main from the very
 * file it serves (self-synchronising; no nonce, no serve-time rewriting). An
 * empty list changes nothing, which is also the dev answer (dev CSP is null). */
export function buildCsp(mode: ShellMode, importMapHashes: readonly string[] = []): string | null {
  if (mode === "dev") return null;
  // TP-S3e (TP-D1 as ratified, terminal-pipeline-v3 §8): `connect-src` admits
  // `ws://127.0.0.1:*` — fieldd's own ephemeral pair (UA-D12, above) and the
  // cells' ephemeral loopback doors — UNCONDITIONALLY. This is the deliberate
  // reversal the rollout gated behind `--terminal-direct-door` through
  // S3a–S3d; the flag and the bridge it selected are gone. The threat
  // statement ratified with it stands: a compromised renderer could attempt
  // ANY loopback WebSocket server; every door of ours is Origin- and
  // token-gated, the sandbox stays, and loopback is potentially-trustworthy
  // (a CSP matter, not mixed content). A fixed front-door port would be the
  // centralization custody refused — and per the correction above, a pinned
  // enumeration would refuse the very sockets the product binds.
  const connect = "ws://127.0.0.1:*";
  // Smoke-like modes may spawn blob: workers (TP-S3a's door probe dials a cell
  // from a worker context built in place); production keeps workers on 'self'
  // — the product's workers are bundled files under the app origin.
  const workers = mode === "production" ? "" : "worker-src 'self' blob:; ";
  // P8b (ESP §8.4): the plugin module origin is admitted EXPLICITLY and only
  // where plugin bytes actually land — modules on script-src, their compiled
  // stylesheet on style-src. It is a separate scheme rather than the app origin
  // precisely so this line can exist: admitting plugin bytes never widens what
  // `'self'` means for the product document, and the policy states which origin
  // may carry plugin code instead of implying it. The scheme is a privileged
  // registration served only from fieldd's generation-bound authorization, so
  // "this origin" is a much narrower claim than a directory would be.
  const pluginModules = `${PLUGIN_MODULE_SCHEME}:`;
  const hashes = importMapHashes.map((h) => ` '${h}'`).join("");
  return (
    `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${pluginModules}${hashes}; ` +
    `style-src 'self' 'unsafe-inline' ${pluginModules}; ` +
    `img-src 'self' data: https://*.ts.net:*; ${workers}connect-src ${connect}; base-uri 'none'; object-src 'none'`
  );
}

/** The CSP source tokens for every inline import map in an HTML document —
 * `'sha256-<base64>'` over the EXACT inner bytes, the way Chromium hashes an
 * inline script. PURE (string → tokens) so the suite can pin the pairing:
 * change one byte of the map and the token moves with it. Matches only
 * `type="importmap"` scripts — this is not a general inline-script amnesty,
 * and a second map or an ordinary inline script stays refused by policy. */
export function importMapHashesFromHtml(html: string): string[] {
  const hashes: string[] = [];
  const pattern = /<script\s+type="importmap"\s*>([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    const body = match[1] ?? "";
    hashes.push(`sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`);
  }
  return hashes;
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
