// DS-4e (2026-10-01) — why an ask for ANOTHER desktop's session was not a
// ticket, read from what fieldd SAID (its kind, its `{service, state}`, its
// `retryable`), never from its words. The words are the pane's own
// (`godview/pane-faces.ts`); the refusing plane's sentence rides along whole as
// `reason`, the provenance a state line carries (DESIGN.md §8, §9).
//
// The rule the routed host keeps with it (`host.ts`): a refusal that may heal
// WAITS — the host asks again once, when the roster's row for that desktop
// next flips (the device subscription the monitor already holds), never on a
// timer; one that no second ask changes is final — said, and the activation
// ends unavailable.

export type RemoteRefusalState =
  /** this desktop has no road to the owner's terminal cells yet: fieldd
   * could make no egress route (`terminal` `egress_unavailable`), its mesh
   * failed the dial closed (`mesh`), or the owner answered doors only its own
   * machine can dial (`terminal` `doors_not_published`) */
  | "no-road"
  /** the tailnet lists the owner offline (`peer-link` `offline`) */
  | "asleep"
  /** the owner did not answer: its daemon unreachable (`peer-link`
   * `unreachable`), an outcome-unknown the one retry could not resolve, or any
   * other refusal fieldd says may be answered later */
  | "not-answering"
  /** the owner does not list the session (`NOT_FOUND`) */
  | "gone"
  /** a refusal no second ask changes (`FORBIDDEN_SCOPE`, `INCOMPATIBLE`, a
   * link this daemon disposed, a ticket the parse refused …) */
  | "refused";

export interface RemoteRefusal {
  /** the owner's roster id — a pane names it by the roster's NAME */
  readonly device: string;
  readonly state: RemoteRefusalState;
  /** the refusing plane's own words, carried whole */
  readonly reason: string;
  /** asking again may be answered: the host waits for the owner's next roster
   * flip and asks once more; false — said, and never asked again */
  readonly waits: boolean;
}

const NO_ROAD_TERMINAL_STATES: ReadonlySet<unknown> = new Set([
  "egress_unavailable",
  "doors_not_published",
]);

export function remoteRefusalOf(cause: unknown, device: string): RemoteRefusal {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const { kind, retryable, details } =
    cause !== null && typeof cause === "object"
      ? (cause as { kind?: unknown; retryable?: unknown; details?: unknown })
      : {};
  const said =
    details !== null && typeof details === "object" && !Array.isArray(details)
      ? (details as { service?: unknown; state?: unknown })
      : {};
  const refusal = (state: RemoteRefusalState, waits: boolean): RemoteRefusal => ({
    device,
    state,
    reason,
    waits,
  });
  if (kind === "UNAVAILABLE" && retryable === true) {
    if (said.service === "terminal" && NO_ROAD_TERMINAL_STATES.has(said.state)) {
      return refusal("no-road", true);
    }
    if (said.service === "mesh") return refusal("no-road", true);
    if (said.service === "peer-link" && said.state === "offline") return refusal("asleep", true);
    return refusal("not-answering", true);
  }
  if (kind === "NOT_FOUND") return refusal("gone", false);
  return refusal("refused", false);
}
