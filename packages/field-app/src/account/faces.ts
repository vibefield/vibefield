import {
  effectiveFaces,
  type FaceLike,
  faceKey,
  faceProblem,
  isSingleEmoji,
  normalizeFaceEmoji,
} from "@vibefield/contracts/user-face";
import type { FieldUserFace, FieldUserProfile } from "../host";

// UA-D17 — the renderer's reading of the face policy (`@vibefield/contracts/
// user-face`, the same module main enforces with). Boot-reachable: the Setup
// Assistant deals its proposal from here, so this imports the policy through
// its zod-free subpath and nothing from the panels.

export interface ShownFace {
  readonly face: FieldUserFace;
  /** True when the machine proposed it and nobody has written it yet. */
  readonly dealt: boolean;
}

function hostFace(face: FaceLike): FieldUserFace {
  return face.frame === undefined
    ? { emoji: face.emoji }
    : { emoji: face.emoji, frame: face.frame };
}

/** Every user's face as this machine shows it: written, or dealt against the
 * whole roster so no two users are ever drawn alike (I-2). */
export function shownFaces(users: readonly FieldUserProfile[]): ReadonlyMap<string, ShownFace> {
  const out = new Map<string, ShownFace>();
  for (const [userId, shown] of effectiveFaces(users)) {
    out.set(userId, { face: hostFace(shown.face), dealt: shown.dealt });
  }
  return out;
}

/** One user's face when the rest of the roster is not known (a browser
 * harness, a host without `usersList`): written, or dealt against nobody. */
export function shownFaceAlone(user: FieldUserProfile): ShownFace {
  return shownFaces([user]).get(user.userId) ?? { face: { emoji: "🦊" }, dealt: true };
}

/** This user's face: written, or dealt against whatever of the roster is known
 * (the user joins it if the roster does not list them yet). */
export function faceOf(user: FieldUserProfile, roster: readonly FieldUserProfile[]): FieldUserFace {
  if (user.face !== undefined) return user.face;
  const known = roster.some((other) => other.userId === user.userId) ? roster : [...roster, user];
  return shownFaces(known).get(user.userId)?.face ?? shownFaceAlone(user).face;
}

/** The faces OTHER users wear, keyed for comparison, with who wears each —
 * what the picker greys out and names. */
export function heldFaces(
  users: readonly FieldUserProfile[],
  userId: string,
): ReadonlyMap<string, string> {
  const shown = shownFaces(users);
  const held = new Map<string, string>();
  for (const user of users) {
    if (user.userId === userId) continue;
    const face = shown.get(user.userId);
    if (face !== undefined) held.set(faceKey(face.face.emoji), user.name);
  }
  return held;
}

/** Why `emoji` cannot be this user's face, in the sentence main would refuse
 * with — or null. Asked before a write so the picker can say it in place. */
export function faceProblemFor(
  emoji: string,
  userId: string,
  users: readonly FieldUserProfile[],
): string | null {
  return faceProblem({ emoji: normalizeFaceEmoji(emoji) }, userId, users);
}

/** "James, 🦊" — the accessible name for a face that stands without its name
 * beside it (I-4: the name makes it certain, and where there is no room for
 * it, it goes in the accessible name). */
export function faceLabel(name: string, face: FieldUserFace): string {
  return `${name}, ${face.emoji}`;
}

export { faceKey, isSingleEmoji, normalizeFaceEmoji };
