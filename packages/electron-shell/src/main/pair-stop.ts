import { type NativeRestartReason, SystemShutdownResult } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import {
  CENSUS_BOUND_MS,
  type CensusSnapshot,
  censusOf,
  plainCensusOf,
  type StopOutcome,
} from "./updates/apply";

type FielddClient = FielddHandle["client"];

// The two halves of a consented stop, ONE copy for every caller (AL-3; the update's apply port, the quit gate): the
// census a person consents to, and the stop that carries that consent to fieldd, which re-checks it against its own
// live set (`system.shutdown {reason, native: {stop, sessions}}`; design-00 EL1's consented exceptions). A refusal
// stops nothing; a refusal that names the live set (`live`) means a session was born after the census.
// Item 192 (RV #6, gap3-1): fieldd's own stop (a release that leaves field-native alone) has the same two halves —
// fieldd's census of the agent runs it ends (`system.shutdown.census`), and the stop that names them
// (`system.shutdown {reason, agents: {runs}}`), which fieldd re-checks the same way.

/** ONE census read, bounded as a whole — reaching the client included: anything but an answer inside
 * `CENSUS_BOUND_MS` is unknown. */
async function bounded(read: () => Promise<CensusSnapshot>): Promise<CensusSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unknown: CensusSnapshot = { known: false };
  const answer = await Promise.race([
    read().catch(() => unknown),
    new Promise<CensusSnapshot>((resolve) => {
      timer = setTimeout(() => resolve(unknown), CENSUS_BOUND_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return answer;
}

/** `terminal.list` over one pair's client as ONE census snapshot of the floor's stop: anything but a current list
 * inside `CENSUS_BOUND_MS` is unknown. */
export function readCensus(
  client: () => FielddClient | Promise<FielddClient>,
): Promise<CensusSnapshot> {
  return bounded(async () =>
    censusOf(await (await client()).request("terminal.list", {}, { timeoutMs: CENSUS_BOUND_MS })),
  );
}

/** Item 192 (RV #6) — `system.shutdown.census` over one pair's client as ONE census snapshot of fieldd's OWN stop:
 * the agent runs it ends, by run id. Anything but a parsed answer inside `CENSUS_BOUND_MS` is unknown — an older
 * fieldd's METHOD_NOT_FOUND and a fieldd still re-attaching hold, never proceed. */
export function readPlainCensus(
  client: () => FielddClient | Promise<FielddClient>,
): Promise<CensusSnapshot> {
  return bounded(async () =>
    plainCensusOf(
      await (await client()).request("system.shutdown.census", {}, { timeoutMs: CENSUS_BOUND_MS }),
    ),
  );
}

/** The consented stop. `native: true` stops the floor too, and only on an exact match of its sessions; `native: false`
 * asks fieldd's own stop (the floor and its terminal sessions live on — the update's B3 branch), and only on an exact
 * match of the agent runs it ends (`sessions` are then run ids; Item 192, RV #6). */
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
          : { reason: stop.reason, agents: { runs: [...stop.sessions] } },
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
