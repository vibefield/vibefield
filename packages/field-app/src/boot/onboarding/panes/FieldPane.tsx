import { type ReactElement, useEffect, useRef, useState } from "react";
import { faceOf, heldFaces } from "../../../account/faces";
import { accountChanged } from "../../../account/use-account";
import { type FieldUserFace, type FieldUserProfile, getHost } from "../../../host";
import { OnboardingFieldPaneView } from "../views/field";

/** Pane 2 — the one mandatory decision, and the only write the wizard needs to
 * make before it can call anything set up. */
export function FieldPane({
  profile,
  usersUpdate,
  eyebrow,
  onBack,
  onDone,
}: {
  profile: FieldUserProfile;
  usersUpdate: ReturnType<typeof getHost>["usersUpdate"];
  eyebrow: string;
  onBack: (() => void) | undefined;
  onDone: (updated: FieldUserProfile) => void;
}): ReactElement {
  const [name, setName] = useState(profile.name);
  // The machine's deal, preselected (UA-D17) — so Continue always writes a
  // face, and so `face`'s presence is a trustworthy "pane 2 was completed"
  // fact for W6. Dealt against this user alone until the roster arrives, then
  // against everyone, so it is never a face somebody else already wears.
  const [roster, setRoster] = useState<readonly FieldUserProfile[]>([]);
  const [face, setFace] = useState<FieldUserFace>(() => faceOf(profile, []));
  // A ref, not state: the roster read below closes over it once, and must see
  // a choice made while it was in flight rather than the value at entry.
  const chosen = useRef(profile.face !== undefined);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const usersList = getHost().usersList;
    if (usersList === undefined) return;
    let cancelled = false;
    void usersList().then(
      (snapshot) => {
        if (cancelled) return;
        setRoster(snapshot.users);
        if (!chosen.current) setFace(faceOf(profile, snapshot.users));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // Once, on entry: a later choice must never be re-dealt underneath the user.
  }, []);

  const commit = (): void => {
    if (writing) return;
    if (usersUpdate === undefined) {
      onDone(profile);
      return;
    }
    // W2 — never blocked by validation. An empty box keeps the name we came in
    // with rather than refusing to move.
    const trimmed = name.trim();
    setWriting(true);
    setError(null);
    void usersUpdate({ name: trimmed.length > 0 ? trimmed : profile.name, face })
      .then((updated) => {
        accountChanged();
        onDone(updated);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setWriting(false);
      });
  };

  return (
    <OnboardingFieldPaneView
      name={name}
      face={face}
      seed={profile.userId}
      held={heldFaces(roster, profile.userId)}
      writing={writing}
      error={error}
      onNameChange={setName}
      onFaceChange={(next) => {
        chosen.current = true;
        setFace(next);
      }}
      onSubmit={commit}
      onBack={onBack}
      eyebrow={eyebrow}
    />
  );
}
