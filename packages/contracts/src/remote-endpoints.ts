import { z } from "zod";

// SP-3 (thinking-sync-planes.md §1.4, §5.4, §6; design-06 §6) — THE TICKET
// TEMPLATE, its first half: where a client dials.
//
// A ticketed data plane (L2) hands a client two things: one tailnet URL per
// LEG of a served process, and the GRANTS the far door verifies. The cell was
// the first (TM-2): its legs are `control` and `frames`, and its grants are the
// two MAC'd envelopes `TerminalOpenTicket` carries BESIDE its set
// (`transportGrant`, `attachGrant` — TP-D21: authority is the grant in the
// first frame). rosettad's direct plane is the second: one leg, `session`, and
// one string grant rosetta verifies at the upgrade (RO-10).
//
// So the template generalizes the URLs and leaves the grants to each door's
// ticket, because the doors verify differently — a cell reads a JSON envelope
// in the first frame; rosetta reads `Authorization: Rosetta-Grant <grant>` or
// the subprotocol pair `rosetta`, `rosetta.grant.<grant>` at the upgrade. A
// ticket is therefore `{endpoints: <an instance of this template>, ...the
// door's grants}` — the anatomy the cell's ticket already had.
//
// THE SPELLING IS THE CELL'S, which is why its wire did not move: a leg named
// `control` is the member `controlUrl`. Every `*Url` member of a set is a leg;
// anything else rides along untouched (the tolerant reader).
//
// THE HOST RULE IS D36's: a remote set never names loopback. That is what keeps
// it disjoint from `CellEndpointSet` (the window's loopback pair) without a
// discriminator on the wire — and it holds for every instance, not just the
// cell's. No query and no fragment, ever: a token in a URL is a token in a log.

/** A leg's name: lowercase-first camel, so `<leg>Url` reads as a member. */
export const REMOTE_ENDPOINT_LEG = /^[a-z][A-Za-z0-9]*$/;

/** The member a leg becomes. */
const LEG_MEMBER = /^[a-z][A-Za-z0-9]*Url$/;

/** The host half of every remote door URL: anything that is not loopback.
 * Spelled as an exclusion rather than a pattern because the host CLASS is the
 * discriminator (TM-2 wrote it this way first, for the cell). */
const REMOTE_DOOR_HOST = String.raw`(?!127\.0\.0\.1(?::|\/|$))(?!\[::1\](?::|\/|$))(?!localhost(?::|\/|$))[^/?#\s]+`;

/** A remote door URL pattern: `<scheme>://<a non-loopback host><path>`, the
 * path a regex SOURCE fragment written by the instance (its own routes).
 * Neither half admits `?` or `#`. */
export function remoteDoorUrl(schemes: string, path: string): RegExp {
  return new RegExp(`^(?:${schemes}):\\/\\/${REMOTE_DOOR_HOST}${path}$`);
}

/** What any leg of any instance may be: a ws/wss or http/https door on a
 * non-loopback host, with a path and no query or fragment. */
const ANY_REMOTE_DOOR = remoteDoorUrl("wss?|https?", String.raw`(?:\/[^?#\s]*)?`);

/** The members `legs` become, typed: `["control", "frames"]` → `{controlUrl,
 * framesUrl}`. */
export type RemoteEndpointLegs<L extends string> = { [K in L as `${K}Url`]: z.ZodString };

/**
 * SP-3 — one served process's remote endpoint set: a `<leg>Url` member per
 * leg, each a tailnet URL the instance's own pattern admits. The cell's pair is
 * `remoteEndpointSet(["control", "frames"], …)` (terminal-pipeline.ts) and
 * rosettad's `remoteEndpointSet(["session"], …)` (agent-index.ts).
 *
 * Members appear in leg order, so an instance writes its set back in the order
 * it always did (the cell's `controlUrl` before `framesUrl`).
 */
export function remoteEndpointSet<const L extends string>(
  legs: readonly [L, ...L[]],
  url: RegExp,
  message: string,
): z.ZodObject<RemoteEndpointLegs<L>, "passthrough"> {
  const shape: Record<string, z.ZodString> = {};
  for (const leg of legs) {
    if (!REMOTE_ENDPOINT_LEG.test(leg))
      throw new Error(
        `a remote endpoint leg must be lowercase-first camel: ${JSON.stringify(leg)}`,
      );
    if (Object.hasOwn(shape, `${leg}Url`))
      throw new Error(`a remote endpoint leg is named twice: ${leg}`);
    shape[`${leg}Url`] = z.string().regex(url, message);
  }
  return z.object(shape).passthrough() as unknown as z.ZodObject<
    RemoteEndpointLegs<L>,
    "passthrough"
  >;
}

/**
 * The template's own reader: what EVERY instance's set satisfies — at least
 * one leg, every `*Url` member a remote door URL. A reader that handles any
 * process's set (a rewriter, a budget, a log line) parses with this; a door's
 * client parses with its instance, which also pins the paths.
 */
export const RemoteEndpointSet = z.record(z.string(), z.unknown()).superRefine((set, ctx) => {
  const legs = Object.keys(set).filter((member) => LEG_MEMBER.test(member));
  if (legs.length === 0)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a remote endpoint set names a leg" });
  for (const member of legs) {
    const value = set[member];
    if (typeof value !== "string" || !ANY_REMOTE_DOOR.test(value))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [member],
        message: "a tailnet door URL without query/fragment",
      });
  }
});
export type RemoteEndpointSet = z.infer<typeof RemoteEndpointSet>;

/** How a leg is dialled. `ws`: a WebSocket upgrade — the cell's `control` and
 * `frames`, rosetta's `session`. `http`: a plain request — SP-D9's upload `put`
 * (ruled 2026-10-01 12:38: the template admits an http/https leg beside the
 * WebSocket ones). Either way the scheme's TLS half is the SERVE's, never the
 * leg's: plain inside WireGuard, or TLS where the serve terminates it. */
export type RemoteLegTransport = "ws" | "http";

/** One leg's path, and how it is dialled: a bare path is a WebSocket leg (every
 * leg until SP-D9's), `{path, transport}` says so explicitly. */
export type RemoteLegPath =
  | string
  | { readonly path: string; readonly transport: RemoteLegTransport };

/** The origin a leg dials, from a serve's own base URL (truffle's
 * `ProxyInfo.url`, e.g. `http://host.ts.net:9422`) — THE place the serve's
 * scheme becomes a leg's (`http→ws`, `https→wss` for a WebSocket leg; itself
 * for an HTTP leg), for every instance. `undefined` when the base is not a
 * usable http(s) origin. */
function remoteDoorOrigin(serveBaseUrl: string, transport: RemoteLegTransport): string | undefined {
  let base: URL;
  try {
    base = new URL(serveBaseUrl);
  } catch {
    return undefined;
  }
  const tls = base.protocol === "https:" ? true : base.protocol === "http:" ? false : undefined;
  if (tls === undefined) return undefined;
  const scheme = transport === "ws" ? (tls ? "wss:" : "ws:") : tls ? "https:" : "http:";
  return `${scheme}//${base.host}`;
}

/**
 * Compose an instance's set from its serve's base URL and one path per leg
 * (keyed by the leg's NAME; a bare path is a WebSocket leg, `{path, transport:
 * "http"}` an HTTP one). `undefined` — never a URL nothing can dial — when the
 * base is unusable, a leg has no path, or the instance refuses what was built
 * (a loopback base, a foreign path, a WebSocket URL for an HTTP door). A path
 * for a leg the instance does not have is ignored.
 */
export function composeRemoteEndpoints<T extends z.ZodRawShape>(
  set: z.ZodObject<T, "passthrough">,
  serveBaseUrl: string,
  paths: Readonly<Record<string, RemoteLegPath>>,
): z.infer<z.ZodObject<T, "passthrough">> | undefined {
  const built: Record<string, string> = {};
  for (const member of Object.keys(set.shape)) {
    if (!LEG_MEMBER.test(member)) continue; // not a leg: nothing a URL can fill
    const leg = paths[member.slice(0, -"Url".length)];
    if (leg === undefined) return undefined;
    const { path, transport } =
      typeof leg === "string" ? { path: leg, transport: "ws" as const } : leg;
    const origin = remoteDoorOrigin(serveBaseUrl, transport);
    if (origin === undefined) return undefined;
    built[member] = `${origin}${path}`;
  }
  const parsed = set.safeParse(built);
  return parsed.success ? parsed.data : undefined;
}
