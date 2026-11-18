// Item 502 (2026-11-18) — the door a run came through, as its start line (`fieldd.agents.session_started`) says
// it: the launch (`spawn`, `resume`, or fieldd's own `resume-when-idle`), the caller's principal KIND and, for a
// call a peer forwarded, the forwarded client's KIND. Kinds alone (EL7): never a token, a token id, a login, a
// device, window or session id, an environment value or a path. The audit keeps the whole actor; this is the
// system log's witness beside it, and it is never recorded.
import { ClientKind, type ForwardedFor, type Principal } from "@vibefield/contracts";
import type { GrantPrincipal } from "./terminal-grants";

/** Every principal kind the contracts name: a Record over their union, so a kind added there and missing here,
 * or one here that is not there, is a type error. */
const CALLER_KINDS: Record<Principal["kind"], true> = {
  "local-token": true,
  "shell-main": true,
  tailnet: true,
  "tailnet-guest": true,
  "mcp-agent": true,
  "peer-fieldd": true,
  plugin: true,
};

/** A caller the line may name: a principal kind, fieldd's own `system`, or `unknown` for any other string. */
export type StartedCaller = Principal["kind"] | "system" | "unknown";

/** A forwarded client the line may name: a client kind the contracts name, or `unknown`. */
export type StartedOnBehalfOf = ClientKind | "unknown";

export interface StartedThrough {
  door: "spawn" | "resume" | "resume-when-idle";
  caller: StartedCaller;
  onBehalfOf?: StartedOnBehalfOf | undefined;
}

function isPrincipalKind(kind: string): kind is Principal["kind"] {
  return Object.hasOwn(CALLER_KINDS, kind);
}

/** The door facts of a launch called by `principal`, forwarded for `forwardedFor` when a peer forwarded it. The
 * forwarded client's kind is a value the PEER sent (read tolerantly, a bounded string), so it is written only when
 * it is one the contracts name; anything else is the fixed word `unknown`, and no peer writes text of its own
 * choosing into this machine's system log. */
export function startedThrough(
  door: "spawn" | "resume",
  principal: GrantPrincipal,
  forwardedFor: ForwardedFor | undefined,
): StartedThrough {
  const client =
    forwardedFor !== undefined ? ClientKind.safeParse(forwardedFor.clientKind) : undefined;
  return {
    door,
    caller: isPrincipalKind(principal.kind) ? principal.kind : "unknown",
    ...(client !== undefined ? { onBehalfOf: client.success ? client.data : "unknown" } : {}),
  };
}

/** A resume-when-idle is fieldd's own act, as the audit's system actor says it. */
export const RESUMED_WHEN_IDLE: StartedThrough = { door: "resume-when-idle", caller: "system" };
