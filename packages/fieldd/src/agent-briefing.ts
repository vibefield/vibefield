import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentCatalogReaders,
  NativeDoorInfoResult,
  SparkId,
  SparkRecord,
} from "@vibefield/contracts";
import { SERVED_TOOLS } from "@vibefield/contracts/tools";
import {
  type AgentBriefingCapabilities,
  type AgentRunBriefing,
  AgentRunBriefingSchema,
} from "@vibefield/puppeteer-core";
import { RpcCallError } from "./native-link";

/** The one server every briefing names (MT-L1); a harness allows its tools as `vibefield/<row>` (puppeteer's grammar). */
const SERVER = "vibefield";

/** A plain run's allowance (MT-D7): its served `agent` rows that only read, by name. The acting rows, when they land,
 * stay under the harness's own ask. */
const RUN_ALLOWANCE: readonly string[] = SERVED_TOOLS.filter(
  (t) => t.audience === "agent" && t.annotations.readOnlyHint,
).map((t) => `${SERVER}/${t.name}`);

/** CP-1d, widened by MT-0 (MT-D9) — fieldd's handoff to the agent runtime: the briefing of EVERY process birth,
 * resumes included, rebuilt each time from the current native door.
 * - A spark's (prepare): the door, the whole server's allowance and the spark's brief. It refuses, before anything is
 *   written or ended, when it cannot be delivered (CP-1d), and first when the catalog does not let the agent be a
 *   spark (CP-5a: `spark-not-offered`, before any fact is read).
 * - A plain run's (forRun): the door and the allowance of its read-only `agent` rows, with no instructions; the
 *   server's own paragraph says the rest (the MT lead's ruling 7, provisional on the history room's sentinel eval). It
 *   DEGRADES: an agent that cannot take it, or a door that does not answer, means the run starts with no briefing,
 *   never a refused spawn. Its check comes first, because the runtime refuses the whole launch
 *   (UNSUPPORTED_LAUNCH_FIELD) when a field the agent does not declare is present. It reads no catalog claim. */
export class AgentBriefings {
  constructor(
    private readonly opts: {
      spark(id: SparkId): SparkRecord | undefined;
      /** CP-5a — the catalog's readers: its spark claim is read before any fact */
      catalog: AgentCatalogReaders;
      capabilities(provider: string): AgentBriefingCapabilities | undefined;
      door(): Promise<NativeDoorInfoResult>;
    },
  ) {}

  async prepare(id: SparkId, provider: string): Promise<AgentRunBriefing> {
    const spark = this.opts.spark(id);
    if (!spark)
      throw new RpcCallError("PRECONDITION_FAILED", "the spark's record is unavailable", false, {
        reason: "spark-unavailable",
      });
    if (spark.agent !== provider)
      throw new RpcCallError("PRECONDITION_FAILED", "this run belongs to another agent", false, {
        reason: "spark-agent-mismatch",
      });
    // A spark already hatched is born again while its row is visible and claims spark, so a deprecated agent's sparks
    // still wake (AC-D3) where a hatch of one is refused; then the facts, as at hatch.
    refuse(
      sparkClaimed(this.opts.catalog, provider, "born")
        ? sparkFactsRefusal(this.opts.capabilities(provider))
        : "spark-not-offered",
      provider,
    );
    let instructions: string;
    try {
      // CP-1c's editable brief keeps its existing filename. The native adapter receives its contents through the
      // typed instructions field; it need not know how another agent discovers a folder's instruction files.
      instructions = await readFile(join(spark.folder, "CLAUDE.md"), "utf8");
    } catch {
      throw new RpcCallError("PRECONDITION_FAILED", "the spark's brief could not be read", false, {
        reason: "spark-brief-unavailable",
      });
    }
    const briefing = AgentRunBriefingSchema.safeParse({
      ...doorOf(await this.opts.door()),
      allowTools: [`${SERVER}/*`],
      instructions,
    });
    // Use the upstream schema before a pending replacement ends its old process. Runtime validates again at its
    // boundary, but waiting until then would make an invalid edited brief cost the pending run its terminal.
    if (!briefing.success)
      throw new RpcCallError("PRECONDITION_FAILED", "the spark's briefing is invalid", false, {
        reason: "spark-brief-invalid",
        field: String(briefing.error.issues[0]?.path[0] ?? "briefing"),
      });
    return briefing.data;
  }

  /** A plain run's briefing, or nothing. Never throws: a plain launch is never refused for the door's sake. */
  async forRun(provider: string): Promise<AgentRunBriefing> {
    if (sparkFactsRefusal(this.opts.capabilities(provider), false) !== undefined) return {};
    let door: NativeDoorInfoResult;
    try {
      door = await this.opts.door();
    } catch {
      return {};
    }
    const briefing = AgentRunBriefingSchema.safeParse({
      ...doorOf(door),
      allowTools: [...RUN_ALLOWANCE],
    });
    return briefing.success ? briefing.data : {};
  }

  /** Hatch checks support before writing a folder or record; prepare checks it again for every later birth. */
  requireSupported(provider: string): void {
    refuse(
      sparkHatchRefusal(this.opts.catalog, provider, () => this.opts.capabilities(provider)),
      provider,
    );
  }
}

/** Why an agent cannot be a spark here, by fieldd's reason. */
export type SparkRefusal =
  | "spark-not-offered"
  | "spark-briefing-unsupported"
  | "spark-door-identity-unsupported";

/** Each refusal's words: a hatch's is said at the New spark sheet's foot, a wake's where the wake was asked. */
const REFUSED: Record<SparkRefusal, string> = {
  "spark-not-offered": "VibeField does not offer this agent as a spark",
  "spark-briefing-unsupported": "this agent cannot receive a spark's briefing yet",
  "spark-door-identity-unsupported": "VibeField cannot identify this agent's spark tools yet",
};

function refuse(reason: SparkRefusal | undefined, provider: string): void {
  if (reason !== undefined)
    throw new RpcCallError("PRECONDITION_FAILED", REFUSED[reason], false, { reason, provider });
}

/** CP-5a (CP5-Q9 (a), ruled 2026-11-04) — whether the catalog lets the agent be a spark. A hatch needs the row offered
 * (`supported` or `preview`) and claiming; a later birth of a spark already hatched needs it visible and claiming, so a
 * deprecated row that keeps its claim still wakes its sparks (AC-D3). R23 lets a supported row claim it and a
 * deprecated one keep it, no other. */
function sparkClaimed(
  catalog: AgentCatalogReaders,
  provider: string,
  birth: "hatch" | "born",
): boolean {
  if (birth === "hatch") return catalog.isOffered(provider, "spark");
  return catalog.isVisible(provider) && catalog.entry(provider)?.offers.spark === true;
}

/** The facts a spark's briefing needs (CP-1d): the fields it carries, and a process the door can name. A plain run's
 * (`instructions` false) needs no instructions. fieldd's one copy of the rule; R23 reads the same clauses from the pin
 * (`portsOf`'s spark). */
export function sparkFactsRefusal(
  capability: AgentBriefingCapabilities | undefined,
  instructions = true,
): SparkRefusal | undefined {
  if (
    !capability?.mcpServers ||
    !capability.allowTools ||
    (instructions && !capability.instructions)
  )
    return "spark-briefing-unsupported";
  // The door proves the caller by a pane's PID and birth time. A helper or external agent is outside that
  // ancestry: declaring a server is not evidence that its process belongs to this run. No vendor branches.
  if (capability.mcpServerProcess !== "terminal") return "spark-door-identity-unsupported";
  return undefined;
}

/** CP-5a — the hatch's verdict on an agent, a reason or none: the catalog's claim first (`spark-not-offered`, and then
 * no fact is read), then the facts. The gate and `agent.providers`' `offers.spark` read this one predicate, so the New
 * spark sheet's menu and the hatch never disagree. `capability` reads the agent's declaration, asked only once the
 * claim stands. */
export function sparkHatchRefusal(
  catalog: AgentCatalogReaders,
  provider: string,
  capability: () => AgentBriefingCapabilities | undefined,
): SparkRefusal | undefined {
  if (!sparkClaimed(catalog, provider, "hatch")) return "spark-not-offered";
  return sparkFactsRefusal(capability());
}

/** The door lines every briefing shares: the floor's bridge, as `native.door.info` names it. */
const doorOf = (door: NativeDoorInfoResult) => ({
  mcpServers: { [SERVER]: { command: door.command, args: [...door.args] } },
});
