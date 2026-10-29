import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NativeDoorInfoResult, SparkId, SparkRecord } from "@vibefield/contracts";
import {
  type AgentBriefingCapabilities,
  type AgentRunBriefing,
  AgentRunBriefingSchema,
} from "@vibefield/puppeteer-core";
import { RpcCallError } from "./native-link";

/** CP-1d — fieldd's handoff to the agent runtime. Compose owns the signed spark record; this service owns the
 * runtime's briefing. Rebuild it for EVERY process birth, including resumes outside compose.sparks.open. */
export class AgentSparkBriefings {
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
    const door = await this.opts.door();
    const briefing = AgentRunBriefingSchema.safeParse({
      mcpServers: { vibefield: { command: door.command, args: [...door.args] } },
      allowTools: ["vibefield/*"],
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

  /** Hatch checks support before writing a folder or record; prepare checks it again for every later birth. */
  requireSupported(provider: string): void {
    const capability = this.opts.capabilities(provider);
    if (!capability?.mcpServers || !capability.allowTools || !capability.instructions)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "this agent cannot receive a spark's briefing yet",
        false,
        { reason: "spark-briefing-unsupported", provider },
      );
    // The door proves the caller by a pane's PID and birth time. A helper or external agent is outside that
    // ancestry: declaring a server is not evidence that its process belongs to this spark. No vendor branches.
    if (capability.mcpServerProcess !== "terminal")
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "VibeField cannot identify this agent's spark tools yet",
        false,
        { reason: "spark-door-identity-unsupported", provider },
      );
  }
}
