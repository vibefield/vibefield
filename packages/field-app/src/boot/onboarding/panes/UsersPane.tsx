import { type ReactElement, useEffect, useState } from "react";
import { faceOf, shownFaces } from "../../../account/faces";
import { refusalSentence } from "../../../account/use-account";
import { type FieldUserProfile, type FieldUserRoster, getHost } from "../../../host";
import { leaveFor } from "../../switch";
import { OnboardingUsersPaneView } from "../views/users";

/** The users chooser's controller: the roster, and the switch. Choosing another
 * user re-targets this window and reloads it (UA-D15) — the switch (DESIGN.md
 * §8) carries the tile's face across, so only a refusal comes back, said on
 * the pane in main's words. Choosing the user being set up is "Continue setup". */
export function UsersPane({
  profile,
  onContinue,
}: {
  profile: FieldUserProfile;
  onContinue: () => void;
}): ReactElement {
  const host = getHost();
  const usersList = host.usersList;
  const [roster, setRoster] = useState<FieldUserRoster | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (usersList === undefined) return;
    let cancelled = false;
    void usersList().then(
      (snapshot) => {
        if (!cancelled) setRoster(snapshot);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(refusalSentence("The users on this machine could not be read", cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [usersList]);

  const faces = roster === null ? null : shownFaces(roster.users);
  const users =
    roster === null
      ? null
      : [...roster.users]
          .sort((a, b) => a.fuid - b.fuid)
          .map((user) => ({
            userId: user.userId,
            name: user.name,
            face: faces?.get(user.userId)?.face ?? faceOf(user, roster.users),
            current: user.userId === profile.userId,
            detail:
              user.userId === profile.userId
                ? "Setting up"
                : user.onboarded
                  ? undefined
                  : "Not set up yet",
          }));

  return (
    <OnboardingUsersPaneView
      users={users}
      opening={opening}
      error={error}
      onContinue={onContinue}
      onChoose={(userId, from) => {
        if (userId === profile.userId) {
          onContinue();
          return;
        }
        const usersSwitch = host.usersSwitch;
        if (usersSwitch === undefined || opening !== null) return;
        const chosen = users?.find((user) => user.userId === userId);
        const name = chosen?.name ?? "that user";
        setOpening(userId);
        setError(null);
        void leaveFor(
          chosen === undefined ? null : { userId, name, face: chosen.face },
          from ?? null,
          () => usersSwitch({ userId }),
        ).catch((cause: unknown) => {
          setOpening(null);
          setError(refusalSentence(`Couldn't open ${name}'s field`, cause));
        });
      }}
    />
  );
}
