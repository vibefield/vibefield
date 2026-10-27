import { faceLiftHostClass, UserFaceView } from "@vibefield/design-kit/face";
import type { ReactElement } from "react";
import type { FieldUserFace } from "../../../host";
import { factCls, primaryCls, WizardError, WizardPane } from "../wizard-ui";

/** One user as the chooser shows them. */
export interface OnboardingChooserUser {
  readonly userId: string;
  readonly name: string;
  readonly face: FieldUserFace;
  /** The user this window is setting up. */
  readonly current: boolean;
  /** Said only when there is something to say: "Setting up", "Not set up yet". */
  readonly detail?: string | undefined;
}

/** The users chooser (§6.2; DESIGN.md §8) — Back from a new user's first pane.
 * By then that user exists, so going back means choosing who to enter: another
 * user's tile switches this window to them, this user's carries on setting up. */
export function OnboardingUsersPaneView({
  users,
  opening,
  error,
  onChoose,
  onContinue,
}: {
  /** Null while the roster is read. */
  users: readonly OnboardingChooserUser[] | null;
  /** The user being switched to — the window is about to reload. */
  opening: string | null;
  error: string | null;
  /** `from` is the tile that was pressed — the switch carries its face (§8). */
  onChoose: (userId: string, from?: Element) => void;
  onContinue: () => void;
}): ReactElement {
  return (
    <WizardPane
      eyebrow="Users"
      title="Choose a user"
      voice="Each user has their own field on this machine. Open one, or carry on setting up the new one."
      onSubmit={onContinue}
      actions={
        <button type="submit" className={primaryCls} disabled={opening !== null}>
          Continue setup
        </button>
      }
    >
      {users === null ? (
        <p className={factCls}>Reading the users on this machine…</p>
      ) : (
        <ul className="vf-wizard-users" aria-label="Users on this machine">
          {users.map((user) => (
            <li key={user.userId}>
              <button
                type="button"
                className={`vf-wizard-user ${faceLiftHostClass}`}
                aria-current={user.current ? "true" : undefined}
                aria-label={
                  user.current ? `Continue setting up ${user.name}` : `Open ${user.name}'s field`
                }
                disabled={opening !== null}
                onClick={(event) => onChoose(user.userId, event.currentTarget)}
              >
                <UserFaceView
                  emoji={user.face.emoji}
                  frame={user.face.frame}
                  size={56}
                  seed={user.userId}
                />
                <span className="vf-wizard-user-name">{user.name}</span>
                {(opening === user.userId || user.detail !== undefined) && (
                  <span className="vf-wizard-user-detail">
                    {opening === user.userId ? "Opening…" : user.detail}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error !== null && <WizardError reason={error} />}
    </WizardPane>
  );
}
