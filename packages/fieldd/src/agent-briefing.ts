import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NativeDoorInfoResult, SparkId, SparkRecord } from "@vibefield/contracts";
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
 *   written or ended, when it cannot be delivered (CP-1d).
 * - A plain run's (forRun): the door and the allowance of its read-only `agent` rows, with no instructions; the
 *   server's own paragraph says the rest (the MT lead's ruling 7, provisional on the history room's sentinel eval). It
 *   DEGRADES: an agent that cannot take it, or a door that does not answer, means the run starts with no briefing,
 *   never a refused spawn. Its check comes first, because the runtime refuses the whole launch
 *   (UNSUPPORTED_LAUNCH_FIELD) when a field the agent does not declare is present. */
export class AgentBriefings {
  constructor(
    private readonly opts: {
      spark(id: SparkId): SparkRecord | undefined;
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
    this.requireSupported(provider);
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
    if (this.#unsupported(provider, false) !== undefined) return {};
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
    const reason = this.#unsupported(provider, true);
    if (reason === "spark-briefing-unsupported")
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "this agent cannot receive a spark's briefing yet",
        false,
        { reason, provider },
      );
    if (reason === "spark-door-identity-unsupported")
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "VibeField cannot identify this agent's spark tools yet",
        false,
        { reason, provider },
      );
  }

  /** The support gate both births share: the fields a briefing carries, and a process the door can name. */
  #unsupported(provider: string, instructions: boolean): string | undefined {
    const capability = this.opts.capabilities(provider);
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
}

/** The door lines every briefing shares: the floor's bridge, as `native.door.info` names it. */
const doorOf = (door: NativeDoorInfoResult) => ({
  mcpServers: { [SERVER]: { command: door.command, args: [...door.args] } },
});
