import type { PluginUpdateArtifact, PluginUpdateCommand } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type PluginUpdateCandidate,
  PluginUpdateCoordinator,
  type PreparedServiceUpdate,
  type ServiceUpdateParticipant,
} from "../src/plugin-update-coordinator";

const PLUGIN_ID = "com.example.update-coordinator";
const artifact = (character: string): PluginUpdateArtifact => ({
  pluginId: PLUGIN_ID,
  installRevision: character.repeat(64),
  manifestHash: `sha256:${character.repeat(64)}`,
});
const OLD = artifact("a");
const CANDIDATE = artifact("b");
const OTHER = artifact("c");
const A = Object.freeze({
  participantId: "renderer:window-a",
  incarnation: "document-a1",
});
const B = Object.freeze({
  participantId: "renderer:window-b",
  incarnation: "document-b1",
});

const prepared = (updateId: string, candidateArtifact = CANDIDATE) => ({
  kind: "prepared" as const,
  updateId,
  pluginId: PLUGIN_ID,
  candidateArtifact,
});

const committed = (updateId: string, commitEpoch = 2, candidateArtifact = CANDIDATE) => ({
  kind: "committed" as const,
  updateId,
  pluginId: PLUGIN_ID,
  candidateArtifact,
  commitEpoch,
});

const recoveredOld = (updateId: string) => ({
  kind: "recovered-old" as const,
  updateId,
  pluginId: PLUGIN_ID,
  oldArtifact: OLD,
});

function commandSink() {
  const commands: PluginUpdateCommand[] = [];
  return {
    commands,
    send: (command: PluginUpdateCommand) => {
      commands.push(command);
    },
  };
}

function coordinator(updateId = "pupd_test_1") {
  return new PluginUpdateCoordinator({
    pluginId: PLUGIN_ID,
    currentArtifact: OLD,
    makeUpdateId: () => updateId,
  });
}

function candidate(
  overrides: Partial<PluginUpdateCandidate> = {},
): PluginUpdateCandidate & { readonly events: string[] } {
  const events: string[] = [];
  return {
    oldArtifact: OLD,
    candidateArtifact: CANDIDATE,
    commitArtifact: async () => {
      events.push("pointer.commit");
    },
    discardArtifact: async () => {
      events.push("artifact.discard");
    },
    promoteCandidateAuthority: () => {
      events.push("authority.promote");
    },
    revokeCandidateSources: () => {
      events.push("sources.revoke");
    },
    disposeCandidateModuleAuthority: () => {
      events.push("module.dispose");
    },
    ...overrides,
    events,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function eventually(predicate: () => boolean, message = "condition did not become true") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

describe("PluginUpdateCoordinator (PRC-5e)", () => {
  it("freezes service plus exact renderers and publishes once behind both barriers", async () => {
    const update = coordinator();
    const a = commandSink();
    const b = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: a.send });
    update.registerRenderer({ identity: B, artifact: OLD, send: b.send });
    const serviceReady = deferred<PreparedServiceUpdate>();
    const serviceEvents: string[] = [];
    let prematureCommitAck: Promise<unknown> | undefined;
    const service: ServiceUpdateParticipant = {
      participantId: "service:plugin",
      incarnation: "worker-1",
      prepare: (updateId) => {
        serviceEvents.push(`prepare:${updateId}`);
        return serviceReady.promise;
      },
      recoverOld: async () => {
        serviceEvents.push("recover-old");
      },
    };
    const input = candidate({
      candidateArtifact: { ...CANDIDATE, root: "/private/candidate/root" },
      service,
    });

    const started = update.begin(input);

    expect(update.routeOpen).toBe(false);
    expect(update.snapshot().episode?.participants).toHaveLength(3);
    expect(a.commands.map((command) => command.kind)).toEqual(["prepare"]);
    expect(b.commands.map((command) => command.kind)).toEqual(["prepare"]);
    expect(JSON.stringify(a.commands)).not.toContain("/private/candidate/root");
    expect(update.sourceFence(A, started.updateId, "candidate")).toEqual({
      updateId: started.updateId,
      purpose: "candidate",
      artifact: CANDIDATE,
    });

    await update.acknowledge(A, prepared(started.updateId));
    await expect(async () => update.sourceFence(A, started.updateId, "candidate")).rejects.toThrow(
      /does not match its barrier/,
    );
    await update.acknowledge(B, prepared(started.updateId));
    expect(update.currentArtifact).toEqual(OLD);

    serviceReady.resolve({
      commit: () => {
        serviceEvents.push("commit");
        prematureCommitAck = update.acknowledge(A, committed(started.updateId));
        void prematureCommitAck.catch(() => undefined);
      },
      discard: async () => {
        serviceEvents.push("discard");
      },
      release: () => {
        serviceEvents.push("release");
      },
    });
    await eventually(() => update.snapshot().state === "committing");

    expect(update.currentArtifact).toEqual(CANDIDATE);
    expect(update.commitEpoch).toBe(2);
    expect(update.routeOpen).toBe(false);
    expect(input.events.slice(0, 2)).toEqual(["pointer.commit", "authority.promote"]);
    expect(serviceEvents).toEqual([`prepare:${started.updateId}`, "commit"]);
    await expect(prematureCommitAck).rejects.toThrow(/commit acknowledgement is stale/);
    expect(a.commands.map((command) => command.kind)).toEqual(["prepare", "commit"]);

    await update.acknowledge(A, committed(started.updateId));
    expect(update.routeOpen).toBe(false);
    await update.acknowledge(B, committed(started.updateId));
    await expect(started.completion).resolves.toEqual({
      outcome: "committed",
      updateId: started.updateId,
      currentArtifact: CANDIDATE,
      commitEpoch: 2,
    });
    expect(serviceEvents).toEqual([`prepare:${started.updateId}`, "commit", "release"]);
    expect(input.events).toEqual(["pointer.commit", "authority.promote", "module.dispose"]);
    expect(update.routeOpen).toBe(true);
  });

  it("keeps a disconnected incarnation mandatory and redelivers to its exact reconnect", async () => {
    const update = coordinator();
    const first = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: first.send });
    const started = update.begin(candidate());
    update.disconnectRenderer(A);

    expect(update.snapshot().episode?.participants[0]).toMatchObject({
      participantId: A.participantId,
      incarnation: A.incarnation,
      expected: "prepare",
      connected: false,
    });
    expect(() =>
      update.registerRenderer({
        identity: { ...A, incarnation: "document-a2" },
        artifact: OLD,
        send: () => undefined,
      }),
    ).toThrow(/positive retirement/);
    await expect(update.acknowledge(A, prepared(started.updateId))).rejects.toThrow(/disconnected/);

    const second = commandSink();
    expect(update.registerRenderer({ identity: A, artifact: OLD, send: second.send })).toBe("live");
    expect(second.commands.map((command) => command.kind)).toEqual(["prepare"]);
    await update.acknowledge(A, prepared(started.updateId));
    expect(second.commands.map((command) => command.kind)).toEqual(["prepare", "commit"]);
    await update.acknowledge(A, committed(started.updateId));
    await expect(started.completion).resolves.toMatchObject({ outcome: "committed" });
  });

  it("lets a positive orderly leave release an exact frozen vote", async () => {
    const update = coordinator();
    const a = commandSink();
    const b = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: a.send });
    update.registerRenderer({ identity: B, artifact: OLD, send: b.send });
    const started = update.begin(candidate());

    await update.acknowledge(A, prepared(started.updateId));
    update.disconnectRenderer(B);
    await expect(update.retireRenderer({ ...B, incarnation: "document-b2" })).rejects.toThrow(
      /stale renderer incarnation/,
    );
    await expect(update.retireRenderer(B)).resolves.toBe(true);
    expect(a.commands.map((command) => command.kind)).toEqual(["prepare", "commit"]);
    await update.acknowledge(A, committed(started.updateId));
    await expect(started.completion).resolves.toMatchObject({ outcome: "committed" });
    await expect(update.retireRenderer(B)).resolves.toBe(false);
  });

  it("holds a post-freeze newcomer outside the vote and source authority", async () => {
    const update = coordinator();
    const a = commandSink();
    const b = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: a.send });
    const started = update.begin(candidate());

    expect(update.registerRenderer({ identity: B, artifact: OLD, send: b.send })).toBe("held");
    expect(b.commands).toEqual([]);
    expect(update.snapshot().episode?.participants.map((member) => member.participantId)).toEqual([
      A.participantId,
    ]);
    expect(() => update.sourceFence(B, started.updateId, "candidate")).toThrow(
      /outside the frozen/,
    );
    expect(() => update.admitHeld(B)).toThrow(/during an update/);

    await update.acknowledge(A, prepared(started.updateId));
    await update.acknowledge(A, committed(started.updateId));
    await started.completion;
    expect(update.admitHeld(B)).toEqual({ artifact: CANDIDATE, commitEpoch: 2 });
  });

  it("recovers retained old before discarding a failed renderer candidate", async () => {
    const update = coordinator();
    const a = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: a.send });
    const recoveryGate = deferred<void>();
    const serviceEvents: string[] = [];
    const service: ServiceUpdateParticipant = {
      participantId: "service:plugin",
      incarnation: "worker-1",
      prepare: async () => ({
        commit: () => {
          serviceEvents.push("commit");
        },
        discard: async () => {
          serviceEvents.push("discard");
        },
        release: () => {
          serviceEvents.push("release");
        },
      }),
      recoverOld: async () => {
        serviceEvents.push("recover-start");
        await recoveryGate.promise;
        serviceEvents.push("recover-done");
      },
    };
    const input = candidate({ service });
    const started = update.begin(input);
    await eventually(
      () =>
        update.snapshot().episode?.participants.find((member) => member.kind === "service")
          ?.expected === "settled",
    );

    await update.acknowledge(A, {
      kind: "failed",
      updateId: started.updateId,
      pluginId: PLUGIN_ID,
      at: "prepare",
      error: { code: "candidate-failed", message: "renderer activation failed" },
    });
    expect(update.snapshot().state).toBe("recovering-old");
    expect(a.commands.map((command) => command.kind)).toEqual(["prepare", "recover-old"]);
    expect(update.sourceFence(A, started.updateId, "recover-old").artifact).toEqual(OLD);
    expect(input.events).toEqual(["sources.revoke", "module.dispose"]);

    await update.acknowledge(A, recoveredOld(started.updateId));
    expect(update.routeOpen).toBe(false);
    expect(input.events).not.toContain("artifact.discard");
    recoveryGate.resolve();
    await expect(started.completion).resolves.toEqual({
      outcome: "candidate-failed-old-recovered",
      updateId: started.updateId,
      currentArtifact: OLD,
      commitEpoch: 1,
    });
    expect(serviceEvents).toEqual(["discard", "recover-start", "recover-done"]);
    expect(input.events).toEqual(["sources.revoke", "module.dispose", "artifact.discard"]);
    expect(update.routeOpen).toBe(true);
  });

  it("turns pointer-CAS failure into old recovery without issuing an epoch", async () => {
    const update = coordinator();
    const a = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: a.send });
    const input = candidate({
      commitArtifact: async () => {
        input.events.push("pointer.failed");
        throw new Error("stale base slot");
      },
    });
    const started = update.begin(input);

    await update.acknowledge(A, prepared(started.updateId));
    expect(update.snapshot().state).toBe("recovering-old");
    expect(update.currentArtifact).toEqual(OLD);
    expect(update.commitEpoch).toBe(1);
    expect(a.commands.map((command) => command.kind)).toEqual(["prepare", "recover-old"]);

    await update.acknowledge(A, recoveredOld(started.updateId));
    await expect(started.completion).resolves.toMatchObject({
      outcome: "candidate-failed-old-recovered",
      commitEpoch: 1,
    });
    expect(input.events).toEqual([
      "pointer.failed",
      "sources.revoke",
      "module.dispose",
      "artifact.discard",
    ]);
  });

  it("contains a synchronous service prepare failure inside retained-old recovery", async () => {
    const update = coordinator();
    const serviceEvents: string[] = [];
    const service: ServiceUpdateParticipant = {
      participantId: "service:plugin",
      incarnation: "worker-1",
      prepare: () => {
        serviceEvents.push("prepare.failed");
        throw new Error("worker constructor failed");
      },
      recoverOld: async () => {
        serviceEvents.push("recover-old");
      },
    };
    const input = candidate({ service });

    const started = update.begin(input);

    await expect(started.completion).resolves.toMatchObject({
      outcome: "candidate-failed-old-recovered",
      currentArtifact: OLD,
      commitEpoch: 1,
    });
    expect(serviceEvents).toEqual(["prepare.failed", "recover-old"]);
    expect(input.events).toEqual(["sources.revoke", "module.dispose", "artifact.discard"]);
    expect(update.routeOpen).toBe(true);
  });

  it("refuses stale update, identity, artifact, epoch, and phase acknowledgements", async () => {
    const update = coordinator();
    const a = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: a.send });
    const started = update.begin(candidate());

    await expect(
      update.acknowledge(A, { ...prepared("pupd_stale"), participantId: A.participantId }),
    ).rejects.toThrow();
    await expect(update.acknowledge(A, prepared("pupd_stale"))).rejects.toThrow(/stale or absent/);
    await expect(
      update.acknowledge({ ...A, incarnation: "document-a0" }, prepared(started.updateId)),
    ).rejects.toThrow(/stale renderer incarnation/);
    await expect(update.acknowledge(A, prepared(started.updateId, OTHER))).rejects.toThrow(
      /artifact mismatch/,
    );
    await expect(
      update.acknowledge(A, {
        kind: "failed",
        updateId: started.updateId,
        pluginId: PLUGIN_ID,
        at: "commit",
        error: { code: "wrong-phase", message: "not committed" },
      }),
    ).rejects.toThrow(/stale/);
    expect(update.snapshot().state).toBe("preparing");

    await update.acknowledge(A, prepared(started.updateId));
    await expect(update.acknowledge(A, committed(started.updateId, 1))).rejects.toThrow(
      /fence mismatch/,
    );
    await expect(update.acknowledge(A, committed(started.updateId, 2, OTHER))).rejects.toThrow(
      /fence mismatch/,
    );
    await update.acknowledge(A, committed(started.updateId));
    await started.completion;
    await expect(update.acknowledge(A, committed(started.updateId))).rejects.toThrow(
      /stale or absent/,
    );
  });

  it("fails forward after pointer publication and never invokes retained-old recovery", async () => {
    const update = coordinator();
    const a = commandSink();
    update.registerRenderer({ identity: A, artifact: OLD, send: a.send });
    const serviceEvents: string[] = [];
    const service: ServiceUpdateParticipant = {
      participantId: "service:plugin",
      incarnation: "worker-1",
      prepare: async () => ({
        commit: () => {
          serviceEvents.push("commit.failed");
          throw new Error("provider publication failed");
        },
        discard: async () => {
          serviceEvents.push("discard");
        },
        release: () => {
          serviceEvents.push("release");
        },
      }),
      recoverOld: async () => {
        serviceEvents.push("recover-old");
      },
    };
    const input = candidate({ service });
    const started = update.begin(input);
    await eventually(
      () =>
        update.snapshot().episode?.participants.find((member) => member.kind === "service")
          ?.expected === "settled",
    );

    await update.acknowledge(A, prepared(started.updateId));
    await expect(started.completion).rejects.toThrow(/provider publication failed/);
    expect(update.currentArtifact).toEqual(CANDIDATE);
    expect(update.commitEpoch).toBe(2);
    expect(update.routeOpen).toBe(false);
    expect(update.snapshot()).toMatchObject({
      state: "failed",
      currentArtifact: CANDIDATE,
      commitEpoch: 2,
      episode: { phase: "committing", commitEpoch: 2 },
    });
    expect(input.events).toEqual(["pointer.commit", "authority.promote"]);
    expect(serviceEvents).toEqual(["commit.failed"]);
    await expect(update.abortBeforeCommit(started.updateId, "roll back")).rejects.toThrow(/failed/);
  });

  it("commits an empty frozen set once and rejects update-id reuse", async () => {
    let nextId = "pupd_empty";
    const update = new PluginUpdateCoordinator({
      pluginId: PLUGIN_ID,
      currentArtifact: OLD,
      makeUpdateId: () => nextId,
    });
    const first = update.begin(candidate());
    await expect(first.completion).resolves.toMatchObject({
      outcome: "committed",
      currentArtifact: CANDIDATE,
      commitEpoch: 2,
    });
    expect(update.routeOpen).toBe(true);

    expect(() =>
      update.begin(candidate({ oldArtifact: CANDIDATE, candidateArtifact: OTHER })),
    ).toThrow(/update id was reused/);
    nextId = "pupd_empty_2";
    const second = update.begin(candidate({ oldArtifact: CANDIDATE, candidateArtifact: OTHER }));
    await expect(second.completion).resolves.toMatchObject({ commitEpoch: 3 });
  });
});
