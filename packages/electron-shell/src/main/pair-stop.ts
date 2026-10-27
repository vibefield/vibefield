import { type NativeRestartReason, SystemShutdownResult } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import { CENSUS_BOUND_MS, type CensusSnapshot, censusOf, type StopOutcome } from "./updates/apply";

type FielddClient = FielddHandle["client"];

// The two halves of a consented stop, ONE copy for every caller (AL-3; the update's apply port, the quit gate): the
// census a person consents to, and the stop that carries that consent to fieldd, which re-checks it against its own
// live set (`system.shutdown {reason, native: {stop, sessions}}`; design-00 EL1's consented exceptions). A refusal
// stops nothing; a refusal that names the live set (`live`) means a session was born after the census.

/** `terminal.list` over one pair's client as ONE census snapshot, bounded as a whole — reaching the client
 * included: anything but a current list inside `CENSUS_BOUND_MS` is unknown. */
export async function readCensus(
  client: () => FielddClient | Promise<FielddClient>,
): Promise<CensusSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unknown: CensusSnapshot = { known: false };
  const read = (async () =>
    censusOf(
      await (await client()).request("terminal.list", {}, { timeoutMs: CENSUS_BOUND_MS }),
    ))().catch(() => unknown);
  const answer = await Promise.race([
    read,
    new Promise<CensusSnapshot>((resolve) => {
      timer = setTimeout(() => resolve(unknown), CENSUS_BOUND_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return answer;
}

/** The consented stop. `native: false` asks fieldd's plain stop (the floor and its sessions live on — the update's B3
 * branch); otherwise the floor stops too, and only on an exact match. */
export async function requestConsentedStop(
  client: FielddClient,
  stop: {
    readonly reason: NativeRestartReason;
    readonly sessions: readonly string[];
    readonly native: boolean;
    readonly toVersion?: string;
  },
  timeoutMs: number,
): Promise<StopOutcome & { readonly native?: string }> {
  try {
    const answer = SystemShutdownResult.safeParse(
      await client.request(
        "system.shutdown",
        stop.native
          ? {
              reason: stop.reason,
              native: {
                stop: true,
                sessions: [...stop.sessions],
                ...(stop.toVersion !== undefined ? { toVersion: stop.toVersion } : {}),
              },
            }
          : { reason: stop.reason },
        { timeoutMs },
      ),
    );
    if (!answer.success || answer.data.stopping !== true) {
      return { ok: false, reason: "fieldd did not stop" };
    }
    return {
      ok: true,
      ...(answer.data.native !== undefined ? { native: answer.data.native } : {}),
    };
  } catch (error) {
    const details = (error as { details?: { live?: unknown } } | null)?.details;
    const live = Array.isArray(details?.live)
      ? details.live.filter((id): id is string => typeof id === "string")
      : undefined;
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      ...(live !== undefined ? { live } : {}),
    };
  }
}
