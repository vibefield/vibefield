import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { PLUGIN_MODULE_SCHEME } from "@vibefield/contracts";
import { protocol } from "electron";

// The plugin module origin (ESP §8.4). Deliberately a SEPARATE scheme from
// `vibefield-app://shell`, and deliberately the dumbest handler in the process.
//
// §8.4 splits the roles: fieldd validates install records, manifest hashes,
// install revisions, enablement, engine gates and grants, then authorizes an
// opaque token; Electron main "may serve bytes only from a pre-authorized,
// generation-bound mapping" and "MUST NOT discover plugins or decide grants".
// So nothing here knows what a plugin is. There is no plugin root, no id, no
// manifest, and no directory — only `token → bytes`, answered by asking the
// daemon that does know. `app-protocol.ts` says why this file exists at all:
// a `plugin://<id>/<path>` resolver "must never be modelled on" the app one,
// because joining a path onto an id we were handed is the shape that goes
// wrong. Here the token IS the whole address — there is no path to join.
//
// The parse is pure and the refusal classes are named, following the app
// scheme's precedent: the reason is evidence, while every refusal looks
// identical (404) to whoever asked.

export const PLUGIN_SCHEME = PLUGIN_MODULE_SCHEME;

/** A module URL is `vibefield-plugin://<32 hex>` and nothing else. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** Same posture as the app scheme, for the same reasons — `standard` and
 * `secure` so ES modules and fetch behave, `codeCache` because these bytes are
 * modules, and every ambient grant refused. `bypassCSP` false in particular:
 * plugin bytes are subject to the document's policy exactly like ours.
 *
 * `corsEnabled` is the ONE deliberate divergence from the app scheme, and it is
 * load-bearing (P8b-3 probe, 2026-08-13): ES-module fetches are always
 * CORS-mode, and a cors-DISABLED scheme is an illegal CORS destination — the
 * app document's `import("vibefield-plugin://<token>")` network-errors before
 * any response header is consulted, so with `false` here NO plugin module can
 * ever load. The app scheme keeps `false` because nothing cross-origin may
 * call it; this scheme EXISTS to be called from the app origin. Electron does
 * not enforce response CORS headers on cors-enabled custom schemes (probe row
 * G1), so the actual boundary is unchanged by the flip: unguessable
 * generation-bound tokens, `Cross-Origin-Resource-Policy: same-origin` on
 * every response (blocks no-cors embedding), and the handler being installed
 * only on the shell session. */
export const PLUGIN_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  codeCache: true,
  bypassCSP: false,
  corsEnabled: true,
  allowServiceWorkers: false,
  allowExtensions: false,
} as const;

// Registration lives in scheme-registration.ts — ONE registerSchemesAsPrivileged
// call for every shell scheme. This module's own second call is what stripped the
// app origin's secure context at P8b-2 (standard survived, secure did not — the
// probe-dated account is in scheme-registration.ts); it exports only constants now.

/** Why a URL never reached the daemon. Every one of these is refused before a
 * token is sent anywhere, so a malformed probe costs no round trip. */
export type PluginUrlRefusal =
  | "malformed-url"
  | "unsupported-scheme"
  | "credentials-in-url"
  | "bad-token"
  | "path-present"
  | "query-present";

export type PluginUrlResolution =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: PluginUrlRefusal };

/**
 * PURE: a request URL to the token it names, or the reason it names none.
 *
 * The strictness is the design. A module URL carries exactly one datum, so
 * anything else present — a path segment, a query, credentials — means the
 * request is not one we minted, and there is no interpretation of it that we
 * want to be generous about.
 */
export function resolvePluginUrl(requestUrl: string): PluginUrlResolution {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, reason: "malformed-url" };
  }
  if (url.protocol !== `${PLUGIN_SCHEME}:`) return { ok: false, reason: "unsupported-scheme" };
  // `vibefield-plugin://user@token/` is a spoofing shape, refused the way the
  // app scheme refuses it rather than quietly ignored by the URL parser.
  if (url.username !== "" || url.password !== "")
    return { ok: false, reason: "credentials-in-url" };
  if (url.search !== "") return { ok: false, reason: "query-present" };
  // A standard scheme always reports at least "/" — anything BEYOND that means
  // someone tried to address a file rather than a token.
  if (url.pathname !== "" && url.pathname !== "/") return { ok: false, reason: "path-present" };
  if (!TOKEN_PATTERN.test(url.hostname)) return { ok: false, reason: "bad-token" };
  return { ok: true, token: url.hostname };
}

/** What fieldd hands back for an authorized token (contracts
 * `PluginModuleResolution`, narrowed to what serving needs). */
export interface AuthorizedModule {
  readonly path: string;
  readonly contentType: "text/javascript" | "text/css";
}

export interface PluginProtocolOptions {
  /**
   * Ask the AUTHORITY. Returns undefined for a token that is unknown OR whose
   * generation has passed — main never learns which, and never caches the
   * answer: a plugin disabled a moment ago must not still be servable because
   * we remembered it (§8.4's invalidation clause has no staleness budget).
   */
  readonly authorize: (token: string) => Promise<AuthorizedModule | undefined>;
  /** Evidence hook. The URL is attacker-influenced text; a caller that logs it
   * owns escaping it. */
  readonly onRefusal?: (
    reason: PluginUrlRefusal | "unauthorized" | "missing-file",
    url: string,
  ) => void;
  readonly openStream?: (path: string) => ReadableStream<Uint8Array>;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

/** One response for every refusal — a distinguishable failure would let a
 * compromised renderer probe which tokens exist. */
function refusalResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function defaultStream(path: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
}

export async function servePluginRequest(
  requestUrl: string,
  options: PluginProtocolOptions,
): Promise<Response> {
  const parsed = resolvePluginUrl(requestUrl);
  if (!parsed.ok) {
    options.onRefusal?.(parsed.reason, requestUrl);
    return refusalResponse();
  }
  // A throwing authority is a REFUSAL, never an exception escaping the handler:
  // fieldd answers a dead token with an RPC error, and a daemon that is simply
  // unreachable throws too. Both mean the same thing here — nobody authorized
  // this — and letting either propagate would turn "no" into a protocol-handler
  // crash. (Caught in review by the test for it; the production caller catches
  // as well, but the seam must not depend on its caller being careful.)
  let authorized: AuthorizedModule | undefined;
  try {
    authorized = await options.authorize(parsed.token);
  } catch {
    authorized = undefined;
  }
  if (authorized === undefined) {
    options.onRefusal?.("unauthorized", requestUrl);
    return refusalResponse();
  }
  // The daemon named this path; main's only remaining question is whether the
  // bytes are there. It deliberately does NOT re-derive, re-contain, or
  // second-guess the path — containment belongs to the side that knows the
  // plugin root, and main knowing one would be main discovering plugins.
  try {
    if (!statSync(authorized.path).isFile()) throw new Error("not a file");
  } catch {
    options.onRefusal?.("missing-file", requestUrl);
    return refusalResponse();
  }
  return new Response((options.openStream ?? defaultStream)(authorized.path), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type":
        authorized.contentType === "text/css"
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8",
    },
  });
}

/** Wire the scheme into Electron (after ready, before the renderer loads). */
export function installPluginProtocol(options: PluginProtocolOptions): void {
  protocol.handle(PLUGIN_SCHEME, (request) => servePluginRequest(request.url, options));
}
