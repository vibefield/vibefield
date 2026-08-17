import { describe, expect, it } from "vitest";
import {
  PluginUpdateAckParams,
  PluginUpdateCommand,
  PluginUpdateEpisode,
  PluginUpdateSnapshot,
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
});
