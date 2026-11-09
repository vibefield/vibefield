import type { SparkId } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import {
  AGENT_BRIEFING_FIELDS,
  type AgentRunBriefing,
  type HostIngress,
} from "@vibefield/puppeteer-core";

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

// OB-3d — A RUN'S HELPER, NAMED TO THE FLOOR. Codex's app-server and a Grok leader of a run's own start the run's MCP
// servers outside the terminal, and a door names its caller by kernel ancestry, so the floor must hold the helper's pid
// before its first MCP-bearing request. puppeteer tells the host through `HostIngress.onHelperProcess`, awaited, and a
// hook that throws refuses the launch. So this hook never throws: a floor that refuses or is down costs the run its
// door, never its start, and the line in the log says so.

/** One run's helper process, as puppeteer names it. `startedAtMs` is the adapter's clock, a hint: the floor reads the
 * kernel's own start. */
export interface RunHelperProcess {
  readonly pid: number;
  readonly startedAtMs: number;
}

/** The ingress with puppeteer's hook. The installed puppeteer-core's `HostIngress` does not declare it yet, so it is
 * typed here and nowhere else; a pin that declares it needs this adapter no longer. An adapter from a pin without the
 * hook never reads the field, and its run simply has no root. */
type IngressWithHelper = HostIngress & {
  onHelperProcess?: (helper: RunHelperProcess) => void | Promise<void>;
};

export function withHelperProcess(
  ingress: HostIngress,
  onHelperProcess: (helper: RunHelperProcess) => Promise<void>,
): HostIngress {
  const named: IngressWithHelper = { ...ingress, onHelperProcess };
  return named;
}

/** The floor's two doors for a helper root (`native.door.roots.set`, `.clear`). */
export interface HelperRootFloor {
  set(rootId: string, pid: number): Promise<unknown>;
  clear(rootId: string): Promise<unknown>;
}

/** The helper roots this fieldd named, by attempt (item 124's retry makes each attempt its own process). */
export class RunHelperRoots {
  readonly #named = new Map<string, { readonly spark?: SparkId }>();

  constructor(
    private readonly opts: {
      readonly floor?: HelperRootFloor | undefined;
      readonly logger: Logger;
    },
  ) {}

  /** The hook for one attempt's ingress. An adapter that never calls it holds no root. It never throws or rejects,
   * whatever the floor or the log does: puppeteer refuses a launch whose hook does, and a plain launch is never refused
   * for the door's sake. */
  announce(rootId: string, spark?: SparkId): (helper: RunHelperProcess) => Promise<void> {
    return (helper) => this.#name(rootId, spark, helper).catch(() => undefined);
  }

  async #name(rootId: string, spark: SparkId | undefined, helper: RunHelperProcess): Promise<void> {
    try {
      if (this.opts.floor === undefined) throw new Error("no floor to tell");
      await this.opts.floor.set(rootId, helper.pid);
      this.#named.set(rootId, spark !== undefined ? { spark } : {});
    } catch (err) {
      this.opts.logger.warn(
        "fieldd.agents.helper_root_refused",
        "The floor did not take a run's helper; the run starts and holds nothing at the door",
        { rootId, pid: helper.pid, reason: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /** The attempt's birth, while the floor holds its helper. */
  birth(rootId: string): { readonly entering: true; readonly spark?: SparkId } | undefined {
    const named = this.#named.get(rootId);
    return named === undefined ? undefined : { entering: true, ...named };
  }

  /** The attempt's run ended, or the attempt failed: the floor forgets its helper. */
  end(rootId: string): void {
    if (!this.#named.delete(rootId)) return;
    this.opts.floor?.clear(rootId).catch((err: unknown) => {
      this.opts.logger.warn(
        "fieldd.agents.helper_root_clear_failed",
        "The floor did not hear a helper root's end; it drops the root when the process goes",
        { rootId, reason: (err as Error).message },
      );
    });
  }
}

// PU-J — A TYPED LAUNCH GETS THE DOOR A SPAWNED ONE GETS. puppeteer's `prepareInvocation` takes a briefing and
// `briefingRefusal: "withhold"`, and answers a receipt `briefing: {applied, withheld}`. A person's own command must never
// fail for a host's addition, so a typed launch always withholds. The installed pin does not declare these and forwards
// only the fields it names, so on it the briefing goes nowhere: harmless, and typed here and nowhere else.

/** A typed launch's options with the briefing under `withhold`, or as they were when there is nothing to carry. */
export function withTypedBriefing<T extends object>(options: T, briefing: AgentRunBriefing): T {
  if (!carriesDoor(briefing)) return options;
  const briefed: T & AgentRunBriefing & { briefingRefusal: "withhold" } = {
    ...options,
    ...briefing,
    briefingRefusal: "withhold",
  };
  return briefed;
}

/** What a typed launch's receipt says it went ahead without, each as `field (code)`; none on a pin with no receipt. */
export function briefingWithheld(answer: unknown): readonly string[] {
  const withheld = (answer as { briefing?: { withheld?: unknown } } | null | undefined)?.briefing
    ?.withheld;
  if (!Array.isArray(withheld)) return [];
  return withheld.flatMap((entry: { field?: unknown; code?: unknown }) =>
    typeof entry?.field === "string" ? [`${entry.field} (${String(entry.code)})`] : [],
  );
}
