import { z } from "zod";
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
