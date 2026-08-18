import type { PluginUpdateArtifact, PluginUpdateCommand } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type {
  CommitRendererReplacementInput,
  PrepareRendererReplacementInput,
  PrepareRendererReplacementResult,
  RecoverOldRendererInput,
  RecoverOldRendererResult,
  RendererReplacementSource,
} from "../src/plugin-host/renderer-controller";
import {
  RendererUpdateParticipant,
  type RendererUpdateParticipantRuntime,
} from "../src/plugin-host/renderer-update-participant";

type PrepareCommand = Extract<PluginUpdateCommand, { kind: "prepare" }>;
type CommitCommand = Extract<PluginUpdateCommand, { kind: "commit" }>;
type RecoverCommand = Extract<PluginUpdateCommand, { kind: "recover-old" }>;

const artifact = (char: string): PluginUpdateArtifact => ({
  pluginId: "vibefield.renderer.participant",
  installRevision: char.repeat(64),
  manifestHash: `sha256:${char.repeat(64)}`,
});

const oldArtifact = artifact("a");
const candidateArtifact = artifact("b");
const source = {} as RendererReplacementSource;
const activation = { state: "active", bindings: new Map(), behaviors: new Map() } as const;

const prepareCommand = (updateId = "pupd_renderer_adapter"): PrepareCommand => ({
  kind: "prepare",
  updateId,
  oldArtifact,
  candidateArtifact,
});

const commitCommand = (updateId = "pupd_renderer_adapter"): CommitCommand => ({
  kind: "commit",
  updateId,
  candidateArtifact,
  commitEpoch: 2,
});

const recoverCommand = (updateId = "pupd_renderer_adapter"): RecoverCommand => ({
  kind: "recover-old",
  updateId,
  oldArtifact,
});

class FakeRuntime implements RendererUpdateParticipantRuntime {
  readonly prepares: PrepareRendererReplacementInput[] = [];
  readonly commits: CommitRendererReplacementInput[] = [];
  readonly recoveries: RecoverOldRendererInput[] = [];
  prepareResult: PrepareRendererReplacementResult = { state: "prepared", activation };
  recoverResult: RecoverOldRendererResult = { state: "recovered-old", activation };
  prepareError: Error | undefined;
  commitError: Error | undefined;
  active = true;

  async prepareReplacement(
    input: PrepareRendererReplacementInput,
  ): Promise<PrepareRendererReplacementResult> {
    this.prepares.push(input);
    if (this.prepareError !== undefined) throw this.prepareError;
    return this.prepareResult;
  }

  commitReplacement(input: CommitRendererReplacementInput): void {
    this.commits.push(input);
    if (this.commitError !== undefined) throw this.commitError;
  }

  async recoverOld(input: RecoverOldRendererInput): Promise<RecoverOldRendererResult> {
    this.recoveries.push(input);
    return this.recoverResult;
  }

  isActiveArtifact(input: PluginUpdateArtifact): boolean {
    return this.active && input.installRevision === oldArtifact.installRevision;
  }
}

describe("RendererUpdateParticipant", () => {
  it("maps exact prepare and commit outcomes to strict identity-free acknowledgements", async () => {
    const runtime = new FakeRuntime();
    const participant = new RendererUpdateParticipant(runtime);

    const prepared = await participant.prepare(prepareCommand(), source);
    expect(prepared).toEqual({
      kind: "prepared",
      updateId: "pupd_renderer_adapter",
      pluginId: oldArtifact.pluginId,
      candidateArtifact,
    });
    expect(prepared).not.toHaveProperty("participantId");
    expect(runtime.prepares[0]).toMatchObject({ candidate: source });

    const committed = participant.commit(commitCommand());
    expect(committed).toEqual({
      kind: "committed",
      updateId: "pupd_renderer_adapter",
      pluginId: oldArtifact.pluginId,
      candidateArtifact,
      commitEpoch: 2,
    });
    expect(committed).not.toHaveProperty("participantId");
    expect(runtime.commits).toHaveLength(1);
  });

  it("acknowledges retained old directly when static preparation refused before disturbance", async () => {
    const runtime = new FakeRuntime();
    runtime.prepareError = new Error("fixed widget projection changed");
    const participant = new RendererUpdateParticipant(runtime);
    let candidateReleases = 0;
    let oldReleases = 0;

    await expect(
      participant.prepare(prepareCommand(), {
        ...source,
        releaseAuthority: () => {
          candidateReleases += 1;
        },
      }),
    ).resolves.toMatchObject({
      kind: "failed",
      at: "prepare",
      error: { code: "renderer-prepare-refused" },
    });
    await expect(
      participant.recoverOld(recoverCommand(), {
        ...source,
        releaseAuthority: () => {
          oldReleases += 1;
        },
      }),
    ).resolves.toEqual({
      kind: "recovered-old",
      updateId: "pupd_renderer_adapter",
      pluginId: oldArtifact.pluginId,
      oldArtifact,
    });
    expect(runtime.recoveries).toEqual([]);
    expect(candidateReleases).toBe(1);
    expect(oldReleases).toBe(1);
  });

  it("drives explicit retained-old recovery after a disturbed candidate failure", async () => {
    const runtime = new FakeRuntime();
    runtime.prepareResult = { state: "failed", error: "candidate exploded" };
    const participant = new RendererUpdateParticipant(runtime);

    await expect(participant.prepare(prepareCommand(), source)).resolves.toMatchObject({
      kind: "failed",
      at: "prepare",
      error: { code: "renderer-prepare-failed" },
    });
    await expect(participant.recoverOld(recoverCommand(), source)).resolves.toMatchObject({
      kind: "recovered-old",
      oldArtifact,
    });
    expect(runtime.recoveries).toHaveLength(1);
  });

  it("releases old authority when recovery is refused before runtime ownership", async () => {
    const runtime = new FakeRuntime();
    const participant = new RendererUpdateParticipant(runtime);
    let releases = 0;
    const refusedSource = {
      ...source,
      releaseAuthority: () => {
        releases += 1;
      },
    };

    await expect(participant.recoverOld(recoverCommand(), refusedSource)).resolves.toMatchObject({
      kind: "failed",
      at: "recover-old",
      error: { code: "renderer-old-recovery-refused" },
    });
    expect(releases).toBe(1);

    participant.close();
    await expect(participant.recoverOld(recoverCommand(), refusedSource)).resolves.toMatchObject({
      kind: "failed",
      at: "recover-old",
      error: { code: "renderer-left" },
    });
    expect(releases).toBe(2);
    expect(runtime.recoveries).toEqual([]);
  });

  it("never reopens old recovery after a logical commit command, even when local commit fails", async () => {
    const runtime = new FakeRuntime();
    runtime.commitError = new Error("publication failed");
    const participant = new RendererUpdateParticipant(runtime);
    await participant.prepare(prepareCommand(), source);

    expect(participant.commit(commitCommand())).toMatchObject({
      kind: "failed",
      at: "commit",
      error: { code: "renderer-commit-failed" },
    });
    await expect(participant.recoverOld(recoverCommand(), source)).resolves.toMatchObject({
      kind: "failed",
      at: "recover-old",
      error: { code: "renderer-old-recovery-refused" },
    });
    expect(runtime.recoveries).toEqual([]);
  });

  it("refuses concurrent commands without mutating the in-flight episode", async () => {
    let release!: (result: PrepareRendererReplacementResult) => void;
    const pending = new Promise<PrepareRendererReplacementResult>((resolve) => {
      release = resolve;
    });
    const runtime = new FakeRuntime();
    runtime.prepareReplacement = async (input) => {
      runtime.prepares.push(input);
      return await pending;
    };
    const participant = new RendererUpdateParticipant(runtime);
    const first = participant.prepare(prepareCommand(), source);

    await expect(
      participant.prepare(prepareCommand("pupd_renderer_concurrent"), source),
    ).resolves.toMatchObject({
      kind: "failed",
      error: { code: "renderer-update-busy" },
    });
    expect(participant.commit(commitCommand())).toMatchObject({
      kind: "failed",
      error: { code: "renderer-commit-refused" },
    });
    expect(runtime.commits).toEqual([]);

    release({ state: "prepared", activation });
    await expect(first).resolves.toMatchObject({ kind: "prepared" });
  });
});
