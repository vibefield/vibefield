import { z } from "zod";
import { PluginModuleUrls, PluginRecord } from "./plugin-registry";
import { PluginId } from "./plugins";

// PRC-5a — local update-coordination vocabulary. These shapes do not register
// product methods by themselves; they pin the exact wire before fieldd and the
// renderer participant adapters begin exchanging it.

const UpdateBoundedId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const PluginUpdateId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^pupd_[A-Za-z0-9_-]+$/);
export type PluginUpdateId = z.infer<typeof PluginUpdateId>;

/** Exact immutable artifact identity used at every update fence. */
export const PluginUpdateArtifact = z
  .object({
    pluginId: PluginId,
    installRevision: z.string().min(1).max(64),
    manifestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .passthrough();
export type PluginUpdateArtifact = z.infer<typeof PluginUpdateArtifact>;

function sameArtifact(
  left: z.infer<typeof PluginUpdateArtifact>,
  right: z.infer<typeof PluginUpdateArtifact>,
): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash
  );
}

export const PluginUpdatePhase = z.enum(["preparing", "committing", "recovering-old"]);
export type PluginUpdatePhase = z.infer<typeof PluginUpdatePhase>;

/** Positive renderer-boundary death leaves a bounded, stable-window recovery
 * target. During PREPARING its outcome is deliberately unknown until the
 * episode selects candidate commit or retained-old recovery. */
export const PluginUpdateRecoveryTarget = z
  .object({
    kind: z.literal("renderer"),
    participantId: UpdateBoundedId,
    retiredIncarnation: UpdateBoundedId,
    artifact: PluginUpdateArtifact.nullable(),
    commitEpoch: z.number().int().positive().nullable(),
    reason: z.literal("boundary-death"),
  })
  .passthrough()
  .superRefine((target, ctx) => {
    if ((target.artifact === null) !== (target.commitEpoch === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [target.artifact === null ? "commitEpoch" : "artifact"],
        message: "recovery artifact and commit epoch must become known together",
      });
    }
  });
export type PluginUpdateRecoveryTarget = z.infer<typeof PluginUpdateRecoveryTarget>;

const PluginUpdateRecoveryTargets = z
  .array(PluginUpdateRecoveryTarget)
  .max(64)
  .superRefine((targets, ctx) => {
    const seen = new Set<string>();
    for (const [index, target] of targets.entries()) {
      if (seen.has(target.participantId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "duplicate stable renderer recovery target",
        });
      }
      seen.add(target.participantId);
    }
  });

/** Diagnostics-only participant row. Renderer identity is server-derived from
 * its bearer; service identity is fieldd-owned. Neither is accepted in an ack. */
export const PluginUpdateParticipant = z
  .object({
    kind: z.enum(["service", "renderer"]),
    participantId: UpdateBoundedId,
    incarnation: UpdateBoundedId,
    expected: z.enum(["prepare", "commit", "recover-old", "settled"]),
    connected: z.boolean(),
  })
  .passthrough();
export type PluginUpdateParticipant = z.infer<typeof PluginUpdateParticipant>;

const PluginUpdateParticipants = z
  .array(PluginUpdateParticipant)
  .max(64)
  .superRefine((participants, ctx) => {
    const seen = new Set<string>();
    for (const [index, participant] of participants.entries()) {
      if (seen.has(participant.participantId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "duplicate stable update participant",
        });
      }
      seen.add(participant.participantId);
    }
  });

export const PluginUpdateEpisode = z
  .object({
    updateId: PluginUpdateId,
    phase: PluginUpdatePhase,
    oldArtifact: PluginUpdateArtifact,
    candidateArtifact: PluginUpdateArtifact,
    /** Present exactly after the logical commit edge. */
    commitEpoch: z.number().int().positive().optional(),
    /** Absolute host-clock deadline for this exact phase. */
    phaseDeadlineAt: z.number().int().nonnegative().safe(),
    /** Set only after commit/recovery expiry requested positive boundary death. */
    deathDeadlineAt: z.number().int().nonnegative().safe().nullable(),
    participants: PluginUpdateParticipants,
  })
  .passthrough()
  .superRefine((episode, ctx) => {
    if (episode.oldArtifact.pluginId !== episode.candidateArtifact.pluginId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateArtifact", "pluginId"],
        message: "old and candidate artifacts must belong to the same plugin",
      });
    }
    if (episode.phase === "committing" && episode.commitEpoch === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commitEpoch"],
        message: "committing requires a commit epoch",
      });
    }
    if (episode.phase !== "committing" && episode.commitEpoch !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commitEpoch"],
        message: `${episode.phase} cannot carry a candidate commit epoch`,
      });
    }
  });
export type PluginUpdateEpisode = z.infer<typeof PluginUpdateEpisode>;

/** Bounded public/Doctor fold. `currentArtifact` changes at the logical commit,
 * while `episode` remains visible through acknowledgement convergence. */
export const PluginUpdateSnapshot = z
  .object({
    generation: z.number().int().nonnegative(),
    state: z.enum(["active", "preparing", "committing", "recovering-old", "failed"]),
    currentArtifact: PluginUpdateArtifact,
    commitEpoch: z.number().int().positive(),
    recoveryTargets: PluginUpdateRecoveryTargets,
    episode: PluginUpdateEpisode.nullable(),
  })
  .passthrough()
  .superRefine((snapshot, ctx) => {
    if (snapshot.state === "active" && snapshot.episode !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["episode"],
        message: "an active update snapshot cannot carry an episode",
      });
    }
    if (
      (snapshot.state === "preparing" ||
        snapshot.state === "committing" ||
        snapshot.state === "recovering-old") &&
      snapshot.episode?.phase !== snapshot.state
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["episode", "phase"],
        message: "snapshot state and episode phase must agree",
      });
    }
    if (
      snapshot.episode !== null &&
      snapshot.currentArtifact.pluginId !== snapshot.episode.oldArtifact.pluginId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentArtifact", "pluginId"],
        message: "snapshot and episode must belong to the same plugin",
      });
    }
    for (const [index, target] of snapshot.recoveryTargets.entries()) {
      if (
        target.artifact !== null &&
        target.artifact.pluginId !== snapshot.currentArtifact.pluginId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recoveryTargets", index, "artifact", "pluginId"],
          message: "recovery target belongs to another plugin",
        });
      }
    }
    if (
      snapshot.episode !== null &&
      (snapshot.state === "preparing" || snapshot.state === "recovering-old") &&
      !sameArtifact(snapshot.currentArtifact, snapshot.episode.oldArtifact)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentArtifact"],
        message: `${snapshot.state} must keep the old artifact current`,
      });
    }
    if (
      snapshot.episode !== null &&
      snapshot.state === "committing" &&
      !sameArtifact(snapshot.currentArtifact, snapshot.episode.candidateArtifact)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentArtifact"],
        message: "committing must expose the candidate artifact as current",
      });
    }
    if (snapshot.state === "committing" && snapshot.episode?.commitEpoch !== snapshot.commitEpoch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commitEpoch"],
        message: "snapshot and episode commit epochs must agree",
      });
    }
  });
export type PluginUpdateSnapshot = z.infer<typeof PluginUpdateSnapshot>;

/** fieldd → one renderer participant. These commands contain no paths or
 * module tokens; candidate authority is a separate PRC-5c surface. */
export const PluginUpdateCommand = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("prepare"),
        updateId: PluginUpdateId,
        oldArtifact: PluginUpdateArtifact,
        candidateArtifact: PluginUpdateArtifact,
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("commit"),
        updateId: PluginUpdateId,
        candidateArtifact: PluginUpdateArtifact,
        commitEpoch: z.number().int().positive(),
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("recover-old"),
        updateId: PluginUpdateId,
        oldArtifact: PluginUpdateArtifact,
      })
      .passthrough(),
  ])
  .superRefine((command, ctx) => {
    if (
      command.kind === "prepare" &&
      command.oldArtifact.pluginId !== command.candidateArtifact.pluginId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateArtifact", "pluginId"],
        message: "old and candidate command artifacts must belong to the same plugin",
      });
    }
  });
export type PluginUpdateCommand = z.infer<typeof PluginUpdateCommand>;

// PRC-5e — local renderer participant lane. These outer envelopes are strict because identity is
// transport-derived and update sources carry ephemeral authority. Public registry/module schemas
// remain tolerant elsewhere; this source response deliberately strips unknown top-level fields so
// a future internal root/path cannot hitch a ride into a renderer.

export const PluginUpdateSubscribeParams = z.object({ pluginId: PluginId }).strict();
export type PluginUpdateSubscribeParams = z.infer<typeof PluginUpdateSubscribeParams>;

/** Orderly renderer departure. Identity remains transport-derived; unlike a socket disconnect,
 * this positive host-owned signal may remove the exact incarnation from a frozen vote. */
export const PluginUpdateLeaveParams = z.object({ pluginId: PluginId }).strict();
export type PluginUpdateLeaveParams = z.infer<typeof PluginUpdateLeaveParams>;

export const PluginUpdateLeaveResult = z.object({ retired: z.boolean() }).strict();
export type PluginUpdateLeaveResult = z.infer<typeof PluginUpdateLeaveResult>;

export const PluginUpdateParticipantSnapshot = z
  .object({
    pluginId: PluginId,
    status: z.enum(["live", "held"]),
    artifact: PluginUpdateArtifact.strip().nullable(),
    commitEpoch: z.number().int().positive().nullable(),
    pendingCommand: PluginUpdateCommand.nullable(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.status === "held") {
      if (
        snapshot.artifact !== null ||
        snapshot.commitEpoch !== null ||
        snapshot.pendingCommand !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message: "a held renderer receives no artifact, epoch, or command",
        });
      }
      return;
    }
    if (snapshot.artifact === null || snapshot.commitEpoch === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact"],
        message: "a live renderer requires an artifact and commit epoch",
      });
    }
    if (snapshot.artifact !== null && snapshot.artifact.pluginId !== snapshot.pluginId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact", "pluginId"],
        message: "participant snapshot artifact belongs to another plugin",
      });
    }
  });
export type PluginUpdateParticipantSnapshot = z.infer<typeof PluginUpdateParticipantSnapshot>;

export const PluginUpdateParticipantEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("command"), command: PluginUpdateCommand }).strict(),
  z
    .object({
      kind: z.literal("admitted"),
      artifact: PluginUpdateArtifact.strip(),
      commitEpoch: z.number().int().positive(),
    })
    .strict(),
]);
export type PluginUpdateParticipantEvent = z.infer<typeof PluginUpdateParticipantEvent>;

export const PluginUpdateSourceParams = z
  .object({
    pluginId: PluginId,
    updateId: PluginUpdateId,
    purpose: z.enum(["candidate", "recover-old"]),
  })
  .strict();
export type PluginUpdateSourceParams = z.infer<typeof PluginUpdateSourceParams>;

export const PluginUpdateSourceLease = z
  .object({
    /** Safe public handle for the inverse RPC. The bearer remains secret and is never used as an
     * identifier; fieldd binds this id to the update plus transport-derived participant tuple. */
    leaseId: z.string().regex(/^tk_[0-9a-f]{12}$/),
    token: z.string().min(1),
    pluginId: PluginId,
    manifestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    grantGeneration: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type PluginUpdateSourceLease = z.infer<typeof PluginUpdateSourceLease>;

export const PluginUpdateSourceReleaseParams = z
  .object({
    pluginId: PluginId,
    updateId: PluginUpdateId,
    leaseId: z.string().regex(/^tk_[0-9a-f]{12}$/),
  })
  .strict();
export type PluginUpdateSourceReleaseParams = z.infer<typeof PluginUpdateSourceReleaseParams>;

export const PluginUpdateSourceReleaseResult = z.object({ released: z.boolean() }).strict();
export type PluginUpdateSourceReleaseResult = z.infer<typeof PluginUpdateSourceReleaseResult>;

export const PluginUpdateSourceResult = z
  .object({
    updateId: PluginUpdateId,
    purpose: z.enum(["candidate", "recover-old"]),
    artifact: PluginUpdateArtifact.strip(),
    record: PluginRecord.strip(),
    module: PluginModuleUrls.strip(),
    lease: PluginUpdateSourceLease,
  })
  .strict()
  .superRefine((source, ctx) => {
    const identities = [source.record.id, source.module.pluginId, source.lease.pluginId];
    if (identities.some((pluginId) => pluginId !== source.artifact.pluginId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact", "pluginId"],
        message: "source identities belong to different plugins",
      });
    }
    if (
      source.record.installRevision !== source.artifact.installRevision ||
      source.module.installRevision !== source.artifact.installRevision ||
      source.record.manifestHash !== source.artifact.manifestHash ||
      source.module.manifestHash !== source.artifact.manifestHash ||
      source.lease.manifestHash !== source.artifact.manifestHash ||
      source.lease.grantGeneration !== source.record.grantGeneration
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact"],
        message: "source record, module, lease, and artifact fences disagree",
      });
    }
    for (const [field, url] of [
      ["moduleUrl", source.module.moduleUrl],
      ["styleUrl", source.module.styleUrl],
    ] as const) {
      if (url !== undefined && !/^vibefield-plugin:\/\/[0-9a-f]{32}$/.test(url)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["module", field],
          message: "update source contains a non-opaque module URL",
        });
      }
    }
  });
export type PluginUpdateSourceResult = z.infer<typeof PluginUpdateSourceResult>;

const AckBase = {
  updateId: PluginUpdateId,
  pluginId: PluginId,
};

/** renderer → fieldd. Deliberately strict and deliberately contains no
 * participant identity: the handler must derive the exact tuple from the
 * shell-bound local-token principal. */
export const PluginUpdateAckParams = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...AckBase,
        kind: z.literal("prepared"),
        candidateArtifact: PluginUpdateArtifact,
      })
      .strict(),
    z
      .object({
        ...AckBase,
        kind: z.literal("committed"),
        candidateArtifact: PluginUpdateArtifact,
        commitEpoch: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        ...AckBase,
        kind: z.literal("recovered-old"),
        oldArtifact: PluginUpdateArtifact,
      })
      .strict(),
    z
      .object({
        ...AckBase,
        kind: z.literal("failed"),
        at: z.enum(["prepare", "commit", "recover-old"]),
        error: z
          .object({
            code: z.string().min(1).max(64),
            message: z.string().min(1).max(500),
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((ack, ctx) => {
    const artifact =
      ack.kind === "prepared" || ack.kind === "committed"
        ? ack.candidateArtifact
        : ack.kind === "recovered-old"
          ? ack.oldArtifact
          : null;
    if (artifact !== null && artifact.pluginId !== ack.pluginId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [ack.kind === "recovered-old" ? "oldArtifact" : "candidateArtifact", "pluginId"],
        message: "ack and artifact must belong to the same plugin",
      });
    }
  });
export type PluginUpdateAckParams = z.infer<typeof PluginUpdateAckParams>;

export const PluginUpdateAckResult = z.object({ accepted: z.literal(true) }).strict();
export type PluginUpdateAckResult = z.infer<typeof PluginUpdateAckResult>;
