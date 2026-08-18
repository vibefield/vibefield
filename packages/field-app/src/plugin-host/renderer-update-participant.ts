import {
  PluginUpdateAckParams,
  type PluginUpdateArtifact,
  type PluginUpdateCommand,
} from "@vibefield/contracts";
import type {
  CommitRendererReplacementInput,
  PrepareRendererReplacementInput,
  PrepareRendererReplacementResult,
  RecoverOldRendererInput,
  RecoverOldRendererResult,
  RendererReplacementSource,
} from "./renderer-controller";

type PrepareCommand = Extract<PluginUpdateCommand, { kind: "prepare" }>;
type CommitCommand = Extract<PluginUpdateCommand, { kind: "commit" }>;
type RecoverOldCommand = Extract<PluginUpdateCommand, { kind: "recover-old" }>;

export interface RendererUpdateParticipantRuntime {
  prepareReplacement(
    input: PrepareRendererReplacementInput,
  ): Promise<PrepareRendererReplacementResult>;
  commitReplacement(input: CommitRendererReplacementInput): unknown;
  recoverOld(input: RecoverOldRendererInput): Promise<RecoverOldRendererResult>;
  isActiveArtifact(artifact: PluginUpdateArtifact): boolean;
}

interface Attempt {
  readonly updateId: string;
  readonly pluginId: string;
  readonly oldArtifact: PluginUpdateArtifact;
  readonly candidateArtifact: PluginUpdateArtifact;
  state: "undisturbed" | "episode" | "committed";
}

/** PRC-5d command adapter for one exact renderer/window participant.
 *
 * It deliberately sends nothing and accepts no participant identity. PRC-5e owns the authenticated
 * transport and derives identity from the window bearer; this class only returns the strict ack
 * that transport must send. Candidate/old sources already contain separately authorized module and
 * product-client authority.
 */
export class RendererUpdateParticipant {
  private attempt: Attempt | undefined;
  private busy = false;
  private closed = false;

  constructor(private readonly runtime: RendererUpdateParticipantRuntime) {}

  async prepare(
    command: PrepareCommand,
    candidate: RendererReplacementSource,
  ): Promise<PluginUpdateAckParams> {
    const pluginId = command.candidateArtifact.pluginId;
    if (this.closed)
      return failed(command.updateId, pluginId, "prepare", "renderer-left", "renderer left");
    if (this.busy || this.attempt !== undefined) {
      return failed(
        command.updateId,
        pluginId,
        "prepare",
        "renderer-update-busy",
        "renderer already owns an update episode",
      );
    }

    const attempt: Attempt = {
      updateId: command.updateId,
      pluginId,
      oldArtifact: command.oldArtifact,
      candidateArtifact: command.candidateArtifact,
      state: "undisturbed",
    };
    this.attempt = attempt;
    this.busy = true;
    try {
      const result = await this.runtime.prepareReplacement({
        updateId: command.updateId,
        oldArtifact: command.oldArtifact,
        candidateArtifact: command.candidateArtifact,
        candidate,
      });
      attempt.state = "episode";
      if (this.closed) {
        return failed(command.updateId, pluginId, "prepare", "renderer-left", "renderer left");
      }
      if (result.state === "prepared") {
        return parseAck({
          kind: "prepared",
          updateId: command.updateId,
          pluginId,
          candidateArtifact: command.candidateArtifact,
        });
      }
      return failed(
        command.updateId,
        pluginId,
        "prepare",
        result.state === "boundary-required"
          ? "renderer-boundary-required"
          : "renderer-prepare-failed",
        result.error,
      );
    } catch (error) {
      // Static/source refusal occurred before RuntimeTargetController accepted the candidate;
      // retained old remains live and may acknowledge recovery without a new import.
      return failed(
        command.updateId,
        pluginId,
        "prepare",
        "renderer-prepare-refused",
        errorMessage(error),
      );
    } finally {
      this.busy = false;
    }
  }

  commit(command: CommitCommand): PluginUpdateAckParams {
    const pluginId = command.candidateArtifact.pluginId;
    const attempt = this.matchingAttempt(command.updateId, pluginId, command.candidateArtifact);
    if (this.closed)
      return failed(command.updateId, pluginId, "commit", "renderer-left", "renderer left");
    if (this.busy || attempt === undefined || attempt.state !== "episode") {
      return failed(
        command.updateId,
        pluginId,
        "commit",
        "renderer-commit-refused",
        "renderer has no exact prepared episode",
      );
    }

    // The command itself proves the logical epoch exists. Even a local publication failure is a
    // forward-recovery problem; old recovery is permanently unreachable from this attempt.
    attempt.state = "committed";
    try {
      this.runtime.commitReplacement({
        updateId: command.updateId,
        candidateArtifact: command.candidateArtifact,
        commitEpoch: command.commitEpoch,
      });
      this.attempt = undefined;
      return parseAck({
        kind: "committed",
        updateId: command.updateId,
        pluginId,
        candidateArtifact: command.candidateArtifact,
        commitEpoch: command.commitEpoch,
      });
    } catch (error) {
      return failed(
        command.updateId,
        pluginId,
        "commit",
        "renderer-commit-failed",
        errorMessage(error),
      );
    }
  }

  async recoverOld(
    command: RecoverOldCommand,
    source: RendererReplacementSource,
  ): Promise<PluginUpdateAckParams> {
    const pluginId = command.oldArtifact.pluginId;
    const attempt = this.matchingAttempt(
      command.updateId,
      pluginId,
      undefined,
      command.oldArtifact,
    );
    if (this.closed)
      return failed(command.updateId, pluginId, "recover-old", "renderer-left", "renderer left");
    if (this.busy || attempt === undefined || attempt.state === "committed") {
      return failed(
        command.updateId,
        pluginId,
        "recover-old",
        "renderer-old-recovery-refused",
        "renderer has no pre-commit episode eligible for old recovery",
      );
    }

    this.busy = true;
    try {
      if (attempt.state === "undisturbed") {
        if (!this.runtime.isActiveArtifact(command.oldArtifact)) {
          return failed(
            command.updateId,
            pluginId,
            "recover-old",
            "renderer-old-not-active",
            "static preparation failed but retained old is not active",
          );
        }
        this.attempt = undefined;
        return parseAck({
          kind: "recovered-old",
          updateId: command.updateId,
          pluginId,
          oldArtifact: command.oldArtifact,
        });
      }

      const result = await this.runtime.recoverOld({
        updateId: command.updateId,
        oldArtifact: command.oldArtifact,
        source,
      });
      if (result.state === "recovered-old") {
        this.attempt = undefined;
        return parseAck({
          kind: "recovered-old",
          updateId: command.updateId,
          pluginId,
          oldArtifact: command.oldArtifact,
        });
      }
      return failed(
        command.updateId,
        pluginId,
        "recover-old",
        result.state === "boundary-required"
          ? "renderer-boundary-required"
          : "renderer-old-recovery-failed",
        result.error,
      );
    } catch (error) {
      return failed(
        command.updateId,
        pluginId,
        "recover-old",
        "renderer-old-recovery-failed",
        errorMessage(error),
      );
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    this.closed = true;
  }

  private matchingAttempt(
    updateId: string,
    pluginId: string,
    candidateArtifact?: PluginUpdateArtifact,
    oldArtifact?: PluginUpdateArtifact,
  ): Attempt | undefined {
    const attempt = this.attempt;
    if (
      attempt === undefined ||
      attempt.updateId !== updateId ||
      attempt.pluginId !== pluginId ||
      (candidateArtifact !== undefined &&
        !sameArtifact(attempt.candidateArtifact, candidateArtifact)) ||
      (oldArtifact !== undefined && !sameArtifact(attempt.oldArtifact, oldArtifact))
    ) {
      return undefined;
    }
    return attempt;
  }
}

function sameArtifact(left: PluginUpdateArtifact, right: PluginUpdateArtifact): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash
  );
}

function parseAck(value: PluginUpdateAckParams): PluginUpdateAckParams {
  return PluginUpdateAckParams.parse(value);
}

function failed(
  updateId: string,
  pluginId: string,
  at: "prepare" | "commit" | "recover-old",
  code: string,
  message: string,
): PluginUpdateAckParams {
  return parseAck({
    kind: "failed",
    updateId,
    pluginId,
    at,
    error: { code, message: boundedMessage(message) },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedMessage(message: string): string {
  const trimmed = message.trim();
  return (trimmed.length === 0 ? "renderer update failed" : trimmed).slice(0, 500);
}
