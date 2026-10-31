import { AGENT_BRIEFING_FIELDS, type AgentRunBriefing } from "@vibefield/puppeteer-core";

// ITEM 124 (2026-10-31; VF-PM's ruling 06:07Z) — A BIRTH WHOSE EXECUTABLE TAKES NO DOOR.
//
// Every briefed birth hands puppeteer the door: a plain run's (MT-0, the tool plane's `mcpServers` and `allowTools`)
// and a spark's (CP-1d, its `instructions` too). puppeteer's adapter probes the executable itself (Claude's
// `--help`) and refuses a launch whose briefing carries a field the binary does not advertise: the spawn or resume
// fails `AGENT_LAUNCH_REFUSED` with the refusal `UNSUPPORTED_LAUNCH_FIELD`, before any process starts. fieldd cannot
// ask that probe first (the runtime exposes none, and walls R20–R22 keep it off the adapter), so from MT-0 a Claude
// older than `--mcp-config` started no agent at all.
//
// Such a birth is made ONCE more with no briefing — a fresh attempt, so a fresh creation request — and says so: the
// row's `door: "off"`, the ledger's `tools.door.withheld`, and puppeteer's own sentence in the log. A second refusal
// is the launch's own and surfaces as before; nothing loops.

/** puppeteer's refusal code for a launch field the executable does not advertise (puppeteer-core's launch service). */
export const UNSUPPORTED_LAUNCH_FIELD = "UNSUPPORTED_LAUNCH_FIELD";

/** A briefing that carries any field an executable could refuse. */
export function carriesDoor(briefing: AgentRunBriefing): boolean {
  return AGENT_BRIEFING_FIELDS.some((field) => briefing[field] !== undefined);
}

/** A spawn's or resume's failure that is that refusal, read by its codes and never by its words. */
export function refusedTheDoor(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const error = (result as { error?: { code?: unknown; refusal?: { code?: unknown } } }).error;
  return error?.code === "AGENT_LAUNCH_REFUSED" && error.refusal?.code === UNSUPPORTED_LAUNCH_FIELD;
}

export interface DoorBirth<T> {
  readonly born: T;
  /** the briefing was withheld: this process holds no door */
  readonly withheld: boolean;
}

/**
 * A briefed birth: `launch` with the briefing and, refused for the door, once more with none. `launch` runs once per
 * attempt, so each is its own creation request; `refused` reads an attempt's answer. `withholding` hears the refusal
 * and wraps the second attempt (the ledger's line is written around it); its answer is that attempt's.
 */
export async function birthWithDoor<T>(
  briefing: AgentRunBriefing,
  launch: (briefing: AgentRunBriefing) => Promise<T>,
  refused: (attempt: T) => boolean,
  withholding: (refusal: T, again: () => Promise<T>) => Promise<T>,
): Promise<DoorBirth<T>> {
  const first = await launch(briefing);
  if (!carriesDoor(briefing) || !refused(first)) return { born: first, withheld: false };
  return { born: await withholding(first, () => launch({})), withheld: true };
}
