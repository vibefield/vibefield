// Item 502 (2026-11-18) — the door a run came through, as its start line (`fieldd.agents.session_started`) says
// it. Its first shape: the facts as they arrive, unmapped. The next commit holds them to kinds alone and threads
// them onto the line.
import type { ForwardedFor } from "@vibefield/contracts";
import type { GrantPrincipal } from "./terminal-grants";

export interface StartedThrough {
  door: "spawn" | "resume" | "resume-when-idle";
  caller: string;
  onBehalfOf?: string | undefined;
}

export function startedThrough(
  door: "spawn" | "resume",
  principal: GrantPrincipal,
  forwardedFor: ForwardedFor | undefined,
): StartedThrough {
  return {
    door,
    caller: principal.kind,
    ...(forwardedFor !== undefined ? { onBehalfOf: forwardedFor.clientKind } : {}),
  };
}

export const RESUMED_WHEN_IDLE: StartedThrough = { door: "resume-when-idle", caller: "system" };
