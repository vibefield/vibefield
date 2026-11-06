import { z } from "zod";
import { MadeAppReachHost } from "./artifacts";
import {
  MADE_APP_SERVE_POLICY,
  MADE_APP_VIEW,
  SERVE_HEADER_FORBIDDEN,
  SERVE_HEADER_LIMITS,
} from "./registries";

// ── DR-1a — a made app's network policy, its serve's headers and its view (`draft/thinking-drive.md` v0.2, RULED
// 2026-11-06: DR-D2 (a), DR-D3 (a), DR-D11 (a); the wave-0 plan's DR-1 (A) and its critic) ──
//
// A made app is confined by its serve's policy, never by its page's bytes (DR-L7). truffle's serve sets these headers
// on every response of the app's origin (T-1), and the stored page keeps its bytes and its digest. Each app has its own
// network policy (DR-D3 (a)): a captured page's hosts come from where it was captured, a built app's from its own
// manifest, and the person widens or narrows either later (an intent, at DR-2). The hosts and the theme are INPUTS to
// everything here: VibeField's code names no platform's hosts and no platform's theme (AR-L1, MA-L9).
//
// Nothing here serves or writes. fieldd composes the headers at an open (DR-1 (B), after T-1's EL8), the files worker
// writes the view (VF-VIEW), and field-native carries the headers to truffle.

/** The file a built app declares itself in, at its folder's root (DR-D3 (a)). DR-5's reader reads it from a published
 * folder or build. */
export const VIBEFIELD_APP_MANIFEST_FILE = "vibefield.app.json";

/** A fetch directive a policy names hosts for (`MADE_APP_SERVE_POLICY.FETCH`'s keys). */
export type MadeAppFetchDirective = (typeof MADE_APP_SERVE_POLICY.FETCH)[number]["key"];

/** A host a made app's policy admits: a `MadeAppReachHost` (a bare public DNS name in canonical form, so never a
 * scheme, a port, a wildcard, an IP literal or a tailnet name) of at most MADE_APP_SERVE_POLICY.HOST_BYTES, and never a
 * name under MADE_APP_SERVE_POLICY.HOST_PRIVATE_SUFFIXES, which resolve to this device or its own network. The grammar
 * is ASCII, so its length is its bytes. */
export const MadeAppNetworkHost = MadeAppReachHost.refine(isPolicyHost, "a public policy host");
export type MadeAppNetworkHost = z.infer<typeof MadeAppNetworkHost>;

function isPolicyHost(host: string): boolean {
  if (host.length > MADE_APP_SERVE_POLICY.HOST_BYTES) return false;
  const under = (suffix: string) => host === suffix || host.endsWith(`.${suffix}`);
  return !MADE_APP_SERVE_POLICY.HOST_PRIVATE_SUFFIXES.some(under);
}

const DirectiveHosts = z.array(MadeAppNetworkHost);

/** A made app's outside hosts, per fetch directive (`MADE_APP_SERVE_POLICY.FETCH`): what its page may load from or
 * call besides its own origin. A directive it does not name admits no outside host. A directive this build does not
 * know passes through and admits nothing. Each list is bounded by the policy's union (`MadeAppNetworkPolicy`), and its
 * order and repeats are not meaning: the serve's header sorts each list and names a host once. */
export const MadeAppNetworkHosts = z
  .object({
    script: DirectiveHosts.optional(),
    style: DirectiveHosts.optional(),
    img: DirectiveHosts.optional(),
    font: DirectiveHosts.optional(),
    media: DirectiveHosts.optional(),
    connect: DirectiveHosts.optional(),
  })
  .passthrough();
export type MadeAppNetworkHosts = z.infer<typeof MadeAppNetworkHosts>;

/** Where an app's policy came from (DR-D3 (a)).
 *  - captured: a captured agent page's, from its capture. Who supplies its hosts is open: R-1's answer names none
 *    today, and the source is James's call before R-1 is filed (the wave-0 critic's first gap).
 *  - manifest: a built app's own `vibefield.app.json` (`madeAppPolicyFromManifest`).
 * The person's own widening or narrowing joins as a third source at DR-2, an intent in the drive's document. */
export const MADE_APP_NETWORK_SOURCES = ["captured", "manifest"] as const;
export const MadeAppNetworkSource = z.enum(MADE_APP_NETWORK_SOURCES);
export type MadeAppNetworkSource = z.infer<typeof MadeAppNetworkSource>;

const MadeAppNetworkPolicyShape = z
  .object({ source: MadeAppNetworkSource, hosts: MadeAppNetworkHosts })
  .passthrough();

/** One made app's network policy (DR-D3 (a)): where it came from, and its hosts per directive, at most
 * MADE_APP_SERVE_POLICY.UNION_HOSTS distinct hosts across all of them. The union, not each list, is the bound: it is
 * what keeps the worst policy's CSP inside one header value. */
export const MadeAppNetworkPolicy = MadeAppNetworkPolicyShape.refine(
  withinUnionCap,
  "a policy names at most MADE_APP_SERVE_POLICY.UNION_HOSTS hosts across its directives",
);
export type MadeAppNetworkPolicy = z.infer<typeof MadeAppNetworkPolicy>;

function withinUnionCap(policy: { hosts: MadeAppNetworkHosts }): boolean {
  return policyUnion(policy.hosts).length <= MADE_APP_SERVE_POLICY.UNION_HOSTS;
}

/** Every host the policy names, across its known directives, once each and sorted. */
function policyUnion(hosts: MadeAppNetworkHosts): string[] {
  return canonical(MADE_APP_SERVE_POLICY.FETCH.flatMap(({ key }) => hosts[key] ?? []));
}

/** A list of hosts as the header names them: once each, in byte order (the grammar is ASCII). */
function canonical(hosts: readonly string[]): string[] {
  return [...new Set(hosts)].sort();
}

/** The policy's hosts across every directive, once each and sorted: the open answer's `reach` and the capture's
 * `allowHosts` (MA-L7). A policy holds at most UNION_HOSTS = MADE_APP_LIMITS.REACH_HOSTS of them, so this is always a
 * `MadeAppReach`. */
export function madeAppReachOf(policy: MadeAppNetworkPolicy): MadeAppNetworkHost[] {
  return policyUnion(policy.hosts);
}

// ── vibefield.app.json ──

/** `vibefield.app.json`, a built app's own declaration (DR-D3 (a)). Only `network` is read today: the outside hosts the
 * app loads from or calls, one flat list that every fetch directive admits (`madeAppPolicyFromManifest`). The reader is
 * tolerant and never refuses the manifest for it:
 *  - an entry it cannot read as a policy host (`MadeAppNetworkHost`: a scheme, a port, a wildcard, an IP literal, a
 *    tailnet or private name, a host past HOST_BYTES, anything not a string) is STRIPPED, never rewritten;
 *  - a repeat is dropped, and past MADE_APP_SERVE_POLICY.UNION_HOSTS readable hosts the rest are dropped in the
 *    manifest's order;
 *  - a `network` that is not a list, or holds more than MADE_APP_SERVE_POLICY.MANIFEST_ENTRIES entries, costs the
 *    field.
 * Every other field is the app's and passes through. */
export const VibefieldAppManifest = z
  .object({
    network: z
      .array(z.unknown())
      .max(MADE_APP_SERVE_POLICY.MANIFEST_ENTRIES)
      .transform(readableHosts)
      .optional()
      .catch(undefined),
  })
  .passthrough();
export type VibefieldAppManifest = z.infer<typeof VibefieldAppManifest>;

function readableHosts(entries: unknown[]): string[] {
  const hosts: string[] = [];
  for (const entry of entries) {
    if (hosts.length === MADE_APP_SERVE_POLICY.UNION_HOSTS) break;
    const read = MadeAppNetworkHost.safeParse(entry);
    if (read.success && !hosts.includes(read.data)) hosts.push(read.data);
  }
  return hosts;
}

/** A built app's policy, from its manifest (DR-D3 (a)): its one list in every fetch directive, since a flat list cannot
 * say which the app needs. A manifest with no readable `network` is a policy that admits no outside host. The lists
 * keep the manifest's order; the header sorts them. */
export function madeAppPolicyFromManifest(manifest: VibefieldAppManifest): MadeAppNetworkPolicy {
  const read = VibefieldAppManifest.safeParse(manifest);
  const network = read.success ? (read.data.network ?? []) : [];
  if (network.length === 0) return { source: "manifest", hosts: {} };
  const list = (): string[] => [...network];
  return {
    source: "manifest",
    hosts: {
      script: list(),
      style: list(),
      img: list(),
      font: list(),
      media: list(),
      connect: list(),
    },
  };
}

// ── the serve's headers ──

/** A response header name a made app's serve may set: letters, digits and `-` (RFC 9110's token, narrowed), at most
 * SERVE_HEADER_LIMITS.NAME_BYTES, and never one SERVE_HEADER_FORBIDDEN names, compared ASCII case-insensitively. It is
 * truffle T-1's rule as a belt and a superset of it: what this admits, truffle's serve admits. */
export const ServeHeaderName = z
  .string()
  .min(1)
  .max(SERVE_HEADER_LIMITS.NAME_BYTES)
  .regex(/^[A-Za-z0-9-]+$/)
  .refine(isAllowedHeaderName, "a header name a serve may set");

function isAllowedHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  const names: readonly string[] = SERVE_HEADER_FORBIDDEN.NAMES;
  if (names.includes(lower)) return false;
  return !SERVE_HEADER_FORBIDDEN.PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** A response header value: VCHAR, SP and HTAB only (never a line break, a NUL, DEL or a byte past ASCII), no space or
 * tab at either edge, 1..SERVE_HEADER_LIMITS.VALUE_BYTES. ASCII, so its length is its bytes. */
export const ServeHeaderValue = z
  .string()
  .min(1)
  .max(SERVE_HEADER_LIMITS.VALUE_BYTES)
  .regex(/^[\x21-\x7e](?:[\x21-\x7e \t]*[\x21-\x7e])?$/);

/** One response header a serve sets: T-1's `{name, value}` (truffle's `ProxyHeader`). */
export const ServeHeader = z
  .object({ name: ServeHeaderName, value: ServeHeaderValue })
  .passthrough();
export type ServeHeader = z.infer<typeof ServeHeader>;

/** One serve's headers: at most SERVE_HEADER_LIMITS.COUNT, a name once (ASCII case-insensitively), and at most
 * SERVE_HEADER_LIMITS.LIST_BYTES of names and values together. */
export const ServeHeaders = z
  .array(ServeHeader)
  .max(SERVE_HEADER_LIMITS.COUNT)
  .refine(namesOnce, "a header name appears once")
  .refine(withinListBytes, "the list's names and values fit SERVE_HEADER_LIMITS.LIST_BYTES");
export type ServeHeaders = z.infer<typeof ServeHeaders>;

function namesOnce(headers: readonly { name: string }[]): boolean {
  return new Set(headers.map((header) => header.name.toLowerCase())).size === headers.length;
}

function withinListBytes(headers: readonly { name: string; value: string }[]): boolean {
  const bytes = headers.reduce((sum, header) => sum + header.name.length + header.value.length, 0);
  return bytes <= SERVE_HEADER_LIMITS.LIST_BYTES;
}

/** Why `madeAppServeHeaders` composed nothing (MADE_APP_SERVE_POLICY's REFUSED_* words). */
export type MadeAppServeRefusal =
  | typeof MADE_APP_SERVE_POLICY.REFUSED_POLICY
  | typeof MADE_APP_SERVE_POLICY.REFUSED_HOSTS_OVER_CAP
  | typeof MADE_APP_SERVE_POLICY.REFUSED_HEADERS;

export type MadeAppServeHeadersAnswer =
  | { ok: true; headers: ServeHeader[] }
  | { ok: false; refused: MadeAppServeRefusal };

/** A made app's serve headers, from its policy (DR-D2 (a), DR-D11 (a)), in a fixed order: the CSP, then
 * MADE_APP_SERVE_POLICY.FIXED_HEADERS. The CSP is `default-src 'self'`, each fetch directive with its own sources and
 * the policy's hosts for it (sorted, once, `https://` and in connect-src `wss://` beside it), then the fixed
 * directives. It never names `sandbox`. Pinned by `fixtures/made-app-headers.vector.json`.
 * The policy's hosts are its input, and the only hosts it names. It refuses, honestly and with nothing composed, a
 * policy it cannot read (REFUSED_POLICY) and one past UNION_HOSTS (REFUSED_HOSTS_OVER_CAP). REFUSED_HEADERS is the
 * belt behind the two bounds: no policy that passes them composes a list SERVE_HEADER_LIMITS refuses. */
export function madeAppServeHeaders(policy: MadeAppNetworkPolicy): MadeAppServeHeadersAnswer {
  const read = MadeAppNetworkPolicyShape.safeParse(policy);
  if (!read.success) return { ok: false, refused: MADE_APP_SERVE_POLICY.REFUSED_POLICY };
  if (!withinUnionCap(read.data)) {
    return { ok: false, refused: MADE_APP_SERVE_POLICY.REFUSED_HOSTS_OVER_CAP };
  }
  const headers: ServeHeader[] = [
    { name: MADE_APP_SERVE_POLICY.CSP_HEADER, value: contentSecurityPolicy(read.data.hosts) },
    ...MADE_APP_SERVE_POLICY.FIXED_HEADERS.map(({ name, value }) => ({ name, value })),
  ];
  if (!ServeHeaders.safeParse(headers).success) {
    return { ok: false, refused: MADE_APP_SERVE_POLICY.REFUSED_HEADERS };
  }
  return { ok: true, headers };
}

function contentSecurityPolicy(hosts: MadeAppNetworkHosts): string {
  const widened = MADE_APP_SERVE_POLICY.FETCH.map(({ key, directive, sources, schemes }) => {
    const each: readonly string[] = schemes;
    const sourced = (host: string) => each.map((scheme) => `${scheme}://${host}`);
    return [directive, sources, ...canonical(hosts[key] ?? []).flatMap(sourced)].join(" ");
  });
  const fixed: readonly string[] = MADE_APP_SERVE_POLICY.FIXED_DIRECTIVES;
  return [`default-src ${MADE_APP_SERVE_POLICY.DEFAULT_SRC}`, ...widened, ...fixed].join("; ");
}

// ── the view ──

/** The color schemes a view declares on its root. */
export const MADE_APP_VIEW_COLOR_SCHEMES = ["light", "dark", "light dark"] as const;

/** A theme variable's name: a CSS custom property, `--` then lowercase letters, digits and `-`, at most
 * MADE_APP_VIEW.VARIABLE_NAME_BYTES in all. */
export const MadeAppViewVariableName = z
  .string()
  .max(MADE_APP_VIEW.VARIABLE_NAME_BYTES)
  .regex(/^--[a-z0-9-]+$/);

/** A theme variable's value, in a grammar that cannot leave its declaration: ASCII letters and digits, space and
 * `# % ( ) , . / + _ -`, its parentheses balanced, no space at either edge, 1..MADE_APP_VIEW.VALUE_BYTES. So never
 * `<` (no `</style>`), `;`, `{`, `}`, `:`, a quote, a backslash, `*` (no comment) or a line break: a color, a length, a
 * function of them, or a font stack of bare names. */
export const MadeAppViewVariableValue = z
  .string()
  .min(1)
  .max(MADE_APP_VIEW.VALUE_BYTES)
  .regex(/^[A-Za-z0-9#%(),./+_-](?:[A-Za-z0-9#%(),./+_ -]*[A-Za-z0-9#%(),./+_-])?$/)
  .refine(parenthesesBalanced, "balanced parentheses");

function parenthesesBalanced(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** The theme a desktop builds a made app's view with (DR-D11 (a)): its color scheme and its variables, in order, each
 * named once, at most MADE_APP_VIEW.VARIABLES. Its values are an INPUT, never VibeField's for any platform (AR-L1,
 * MA-L9); whose values they are is still James's call (the wave-0 critic's second gap). */
export const MadeAppViewTheme = z
  .object({
    colorScheme: z.enum(MADE_APP_VIEW_COLOR_SCHEMES),
    variables: z
      .array(z.tuple([MadeAppViewVariableName, MadeAppViewVariableValue]))
      .max(MADE_APP_VIEW.VARIABLES)
      .refine(variablesOnce, "a variable is named once"),
  })
  .passthrough();
export type MadeAppViewTheme = z.infer<typeof MadeAppViewTheme>;

function variablesOnce(variables: readonly (readonly [string, string])[]): boolean {
  return new Set(variables.map(([name]) => name)).size === variables.length;
}

export type MadeAppViewHeadAnswer =
  | { ok: true; head: string }
  | { ok: false; refused: typeof MADE_APP_VIEW.REFUSED_THEME };

const VIEW_HEAD_OPEN = [
  "<!doctype html><html><head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
].join("");

/** What follows the page's bytes in a made app's view. */
export const MADE_APP_VIEW_TAIL = "</body></html>";

/** The head of a made app's view (DR-D11 (a)): a document, its charset and viewport, and one style rule that sets the
 * theme on `:root` (`color-scheme`, then each variable in order), then `<body>`. The view is this head, the stored
 * page's bytes, then MADE_APP_VIEW_TAIL, written by the files worker (VF-VIEW). Pinned by
 * `fixtures/made-app-view.vector.json`.
 * The page sits inside the view's `<body>`. A whole document still parses there (rosetta's room shell has always run
 * pages so), but its own `<meta http-equiv="Content-Security-Policy">` is no longer in a head and the browser ignores
 * it: the serve's header is the page's one policy (the wave-0 critic). The inline style needs style-src
 * 'unsafe-inline', which every made app's policy carries.
 * It refuses a theme it cannot read (REFUSED_THEME), so no value ever reaches the bytes unchecked. */
export function madeAppViewHead(theme: MadeAppViewTheme): MadeAppViewHeadAnswer {
  const read = MadeAppViewTheme.safeParse(theme);
  if (!read.success) return { ok: false, refused: MADE_APP_VIEW.REFUSED_THEME };
  const declarations = [
    `color-scheme:${read.data.colorScheme}`,
    ...read.data.variables.map(([name, value]) => `${name}:${value}`),
  ];
  const style = `<style>:root{${declarations.join(";")}}</style>`;
  return { ok: true, head: `${VIEW_HEAD_OPEN}${style}</head><body>` };
}
