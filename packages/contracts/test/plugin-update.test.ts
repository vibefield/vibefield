import { describe, expect, it } from "vitest";
import {
  PluginUpdateAckParams,
  PluginUpdateCommand,
  PluginUpdateEpisode,
  PluginUpdateParticipantSnapshot,
  PluginUpdateSnapshot,
  PluginUpdateSourceParams,
  PluginUpdateSourceResult,
} from "../src/plugin-update";

const artifact = (installRevision: string) => ({
  pluginId: "com.example.update",
  installRevision,
  manifestHash: `sha256:${installRevision === "r1" ? "a" : "b"}`.padEnd(71, "0"),
});

const participant = {
  kind: "renderer" as const,
  participantId: "renderer:desktop-test:window-1",
  incarnation: "renderer:desktop-test:window-1:document-1",
  expected: "commit" as const,
  connected: true,
};

describe("PRC-5a update coordination contracts", () => {
  it("pins a committing episode to exact artifacts, epoch, and participant incarnation", () => {
    const episode = PluginUpdateEpisode.parse({
      updateId: "pupd_example_1",
      phase: "committing",
      oldArtifact: artifact("r1"),
      candidateArtifact: artifact("r2"),
      commitEpoch: 2,
      participants: [participant],
    });
    expect(episode.participants[0]).toMatchObject(participant);
  });

  it("refuses a commit phase without an epoch and duplicate exact incarnations", () => {
    expect(
      PluginUpdateEpisode.safeParse({
        updateId: "pupd_example_1",
        phase: "committing",
        oldArtifact: artifact("r1"),
        candidateArtifact: artifact("r2"),
        participants: [participant],
      }).success,
    ).toBe(false);
    expect(
      PluginUpdateEpisode.safeParse({
        updateId: "pupd_example_1",
        phase: "preparing",
        oldArtifact: artifact("r1"),
        candidateArtifact: artifact("r2"),
        participants: [
          participant,
          { ...participant, incarnation: "renderer:desktop-test:window-1:document-2" },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps current old during prepare and current candidate through COMMITTING", () => {
    expect(
      PluginUpdateSnapshot.parse({
        generation: 4,
        state: "preparing",
        currentArtifact: artifact("r1"),
        commitEpoch: 1,
        episode: {
          updateId: "pupd_example_1",
          phase: "preparing",
          oldArtifact: artifact("r1"),
          candidateArtifact: artifact("r2"),
          participants: [{ ...participant, expected: "prepare" }],
        },
      }).currentArtifact.installRevision,
    ).toBe("r1");
    expect(
      PluginUpdateSnapshot.parse({
        generation: 5,
        state: "committing",
        currentArtifact: artifact("r2"),
        commitEpoch: 2,
        episode: {
          updateId: "pupd_example_1",
          phase: "committing",
          oldArtifact: artifact("r1"),
          candidateArtifact: artifact("r2"),
          commitEpoch: 2,
          participants: [participant],
        },
      }).currentArtifact.installRevision,
    ).toBe("r2");
  });

  it("pins prepare, commit, and retained-old recovery commands", () => {
    for (const command of [
      {
        kind: "prepare",
        updateId: "pupd_example_1",
        oldArtifact: artifact("r1"),
        candidateArtifact: artifact("r2"),
      },
      {
        kind: "commit",
        updateId: "pupd_example_1",
        candidateArtifact: artifact("r2"),
        commitEpoch: 2,
      },
      {
        kind: "recover-old",
        updateId: "pupd_example_1",
        oldArtifact: artifact("r1"),
      },
    ]) {
      expect(PluginUpdateCommand.safeParse(command).success).toBe(true);
    }
    expect(
      PluginUpdateCommand.safeParse({
        kind: "prepare",
        updateId: "pupd_example_1",
        oldArtifact: artifact("r1"),
        candidateArtifact: { ...artifact("r2"), pluginId: "com.example.other" },
      }).success,
    ).toBe(false);
  });

  it("accepts an exact ack but refuses caller-supplied participant identity", () => {
    const ack = {
      kind: "committed",
      updateId: "pupd_example_1",
      pluginId: "com.example.update",
      candidateArtifact: artifact("r2"),
      commitEpoch: 2,
    };
    expect(PluginUpdateAckParams.parse(ack)).toEqual(ack);
    expect(
      PluginUpdateAckParams.safeParse({
        ...ack,
        participantId: participant.participantId,
        incarnation: participant.incarnation,
      }).success,
    ).toBe(false);
    expect(
      PluginUpdateAckParams.safeParse({
        ...ack,
        candidateArtifact: { ...artifact("r2"), pluginId: "com.example.other" },
      }).success,
    ).toBe(false);
  });

  it("refuses mismatched snapshot/episode phases and cross-plugin artifacts", () => {
    expect(
      PluginUpdateSnapshot.safeParse({
        generation: 5,
        state: "preparing",
        currentArtifact: artifact("r1"),
        commitEpoch: 1,
        episode: {
          updateId: "pupd_example_1",
          phase: "committing",
          oldArtifact: artifact("r1"),
          candidateArtifact: artifact("r2"),
          commitEpoch: 2,
          participants: [participant],
        },
      }).success,
    ).toBe(false);
    expect(
      PluginUpdateEpisode.safeParse({
        updateId: "pupd_example_1",
        phase: "preparing",
        oldArtifact: artifact("r1"),
        candidateArtifact: { ...artifact("r2"), pluginId: "com.example.other" },
        participants: [participant],
      }).success,
    ).toBe(false);
  });

  it("keeps held participant snapshots authority-free and input identity-free", () => {
    expect(
      PluginUpdateParticipantSnapshot.parse({
        pluginId: "com.example.update",
        status: "held",
        artifact: null,
        commitEpoch: null,
        pendingCommand: null,
      }),
    ).toMatchObject({ status: "held", artifact: null });
    expect(
      PluginUpdateParticipantSnapshot.safeParse({
        pluginId: "com.example.update",
        status: "held",
        artifact: artifact("r1"),
        commitEpoch: 1,
        pendingCommand: null,
      }).success,
    ).toBe(false);
    expect(
      PluginUpdateSourceParams.safeParse({
        pluginId: "com.example.update",
        updateId: "pupd_example_1",
        purpose: "candidate",
        participantId: participant.participantId,
      }).success,
    ).toBe(false);
  });

  it("projects one exact path-free source and refuses mixed authority", () => {
    const candidateArtifact = artifact("r2");
    const source = {
      updateId: "pupd_example_1",
      purpose: "candidate" as const,
      artifact: { ...candidateArtifact, root: "/secret/artifact" },
      record: {
        id: "com.example.update",
        version: "1.0.0",
        title: "Update",
        source: "registry",
        manifestHash: candidateArtifact.manifestHash,
        installRevision: candidateArtifact.installRevision,
        state: "enabled",
        compatible: true,
        enabled: true,
        requestedCapabilities: [],
        grantedCapabilities: [],
        deniedCapabilities: [],
        grantGeneration: 4,
        contributions: {},
        renderer: "active",
        service: "none",
        root: "/secret/record",
      },
      module: {
        pluginId: "com.example.update",
        moduleUrl: `vibefield-plugin://${"c".repeat(32)}`,
        manifestHash: candidateArtifact.manifestHash,
        installRevision: candidateArtifact.installRevision,
        path: "/secret/module.js",
      },
      lease: {
        leaseId: "tk_aaaaaaaaaaaa",
        token: "candidate-token",
        pluginId: "com.example.update",
        manifestHash: candidateArtifact.manifestHash,
        grantGeneration: 4,
        expiresAt: 10_000,
      },
    };
    const parsed = PluginUpdateSourceResult.parse(source);
    expect(JSON.stringify(parsed)).not.toContain("/secret/");
    expect(
      PluginUpdateSourceResult.safeParse({
        ...source,
        lease: { ...source.lease, grantGeneration: 5 },
      }).success,
    ).toBe(false);
    expect(
      PluginUpdateSourceResult.safeParse({
        ...source,
        module: { ...source.module, moduleUrl: "file:///secret/module.js" },
      }).success,
    ).toBe(false);
  });
});
