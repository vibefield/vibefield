import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider, useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { faceOf, heldFaces } from "../../account/faces";
import {
  hasLink,
  type LinkBeginStep,
  type LinkFace,
  linkFace,
  type UserLinkStatus,
} from "../../account/link";
import { useSyncPosture } from "../../account/posture";
import { accountChanged } from "../../account/use-account";
import { type FieldUserFace, type FieldUserProfile, getHost } from "../../host";
import type { BootOnboarding } from "../machine";
import {
  type OnboardingCompletionFlag,
  OnboardingConnectPaneView,
  OnboardingDerivingPaneView,
  OnboardingFieldPaneView,
  OnboardingFinishingPaneView,
  OnboardingPosturePaneView,
  OnboardingReadyPaneView,
  OnboardingSettingUpPaneView,
  OnboardingWelcomeBackPaneView,
  OnboardingWelcomePaneView,
} from "./onboarding-views";
import { WizardShell } from "./wizard-ui";

// The Setup Assistant (UA-3w; spec §6). Held open by the boot machine between
// a warm daemon and an open document, and closed by the only thing that may
// close it: a durable `onboarded: true`.
//
// The laws it implements, and where each one lives:
//   W1 one decision per pane          — the Pane union below; nothing asks twice.
//   W2 the mandatory core is a name   — pane 2 pre-fills it and Continue never
//                                       validates; an empty box keeps the
//                                       pre-filled name rather than blocking.
//   W3 everything else is skippable   — SkipAction, whose subtitle names the
//                                       later home verbatim.
//   W4 honest progress only           — pane 3 lists the stages this boot
//                                       ACTUALLY passed (machine.onboarding
//                                       .stagesDone) and says the rest is
//                                       already running behind the window.
//   W5 it ends inside the product     — the last act is a write, then the boot
//                                       machine carries on to the real field.
//   W6 position derives from facts    — `entryPane` reads users.json fields and
//                                       the link snapshot. There is no wizard
//                                       state store, so quitting and relaunching
//                                       lands on the first incomplete pane by
//                                       construction, not by memory.

/** One beat on the setting-up pane. Long enough to read two finished stages,
 * short enough that a warm machine never feels detained. */
const SETTING_UP_BEAT_MS = 900;
/** One beat on Ready before the flag write — the sentence lands, then it goes. */
const READY_BEAT_MS = 700;
/** How long a RESUMING wizard waits for the link snapshot before deciding
 * where to land. A silent daemon must not park the user on a blank pane, so
 * the derivation proceeds with "no link known" once this elapses. */
const ENTRY_SETTLE_MS = 1_200;

type Pane =
  | "welcome"
  | "welcome-back"
  | "field"
  | "setting-up"
  | "connect"
  | "posture"
  | "ready"
  /** The second-user variant's end (§6.2) — the same durable write Ready makes,
   * without the pause or the greeting. Not a sixth question: a terminal state
   * that only has a face if the write is refused. */
  | "finishing";

export function OnboardingWizard({
  client,
  onboarding,
  onComplete,
}: {
  client: FielddClient;
  onboarding: BootOnboarding;
  onComplete: (profile?: FieldUserProfile) => void;
}): ReactElement {
  return (
    <FielddProvider client={client}>
      <WizardBody onboarding={onboarding} onComplete={onComplete} />
    </FielddProvider>
  );
}

function WizardBody({
  onboarding,
  onComplete,
}: {
  onboarding: BootOnboarding;
  onComplete: (profile?: FieldUserProfile) => void;
}): ReactElement {
  const usersUpdate = getHost().usersUpdate;
  const [profile, setProfile] = useState<FieldUserProfile>(onboarding.profile);
  // A field a version-skewed writer set, never a schema field (host.ts).
  const migrated = profile.setupVariant === "migrated";
  // UA-5 §6.2 — the second user this machine ever had. The field is already
  // set up; only this PERSON is new, so the variant drops the two beats that
  // exist to introduce the product: the Welcome pane and the Ready pause. What
  // is left is panes 2 → 4 — name, the honest stages, the mesh — and then the
  // same completion write, immediately.
  const secondUser = profile.setupVariant === "second-user";
  /** Where every path ends. The two variants differ only in whether that end
   * has a face to read. */
  const endPane: Pane = secondUser ? "finishing" : "ready";

  const link = useSubscription<UserLinkStatus>("user.link.subscribe");
  const face = linkFace(link.status, link.status === "live" ? (link.data ?? null) : null);
  const linked = hasLink(face);

  // W6 — the entry pane is DERIVED. A record with no face never finished pane
  // 2 (mint never writes one — UA-D17), so the wizard starts at the top; a
  // record with one did, so it resumes at the first thing still unanswered. A
  // pre-v0.3 record's `color` proves the same thing: that user answered pane 2
  // before faces existed. "The top" is variant-specific: a second user starts
  // AT pane 2, because the field it is joining needs no welcome.
  const [pane, setPane] = useState<Pane | null>(() =>
    profile.face === undefined && profile.color === undefined
      ? migrated
        ? "welcome-back"
        : secondUser
          ? "field"
          : "welcome"
      : null,
  );
  const [history, setHistory] = useState<Pane[]>([]);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (pane !== null) return;
    const timer = setTimeout(() => setSettled(true), ENTRY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pane]);

  useEffect(() => {
    if (pane !== null) return;
    if (link.status === "loading" && !settled) return; // one honest beat, bounded
    // Migration's only remaining pane after the name is Ready — its link, if
    // there is one, is acknowledged rather than re-asked (spec §6, migration).
    // The second-user variant resumes exactly like a fresh one: a record with a
    // color enters at Connect, and its END is the only thing that differs.
    setPane(migrated ? endPane : linked ? "posture" : "connect");
  }, [pane, link.status, settled, migrated, linked, endPane]);

  // Plain forward/back over panes. This is the ONLY position state in the
  // wizard and it lives for exactly as long as the window does — where you
  // resume comes from users.json, never from here (W6).
  const go = (next: Pane): void => {
    if (pane !== null) setHistory((stack) => [...stack, pane]);
    setPane(next);
  };
  const back = (): void => {
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    setPane(previous);
    setHistory((stack) => stack.slice(0, -1));
  };
  const canGoBack = history.length > 0;

  // Pane 3 auto-advances: it reports work that is already done, so it is a
  // beat, not a gate.
  useEffect(() => {
    if (pane !== "setting-up") return;
    const timer = setTimeout(() => {
      setHistory((stack) => [...stack, "setting-up"]);
      setPane("connect");
    }, SETTING_UP_BEAT_MS);
    return () => clearTimeout(timer);
  }, [pane]);

  // The last act. The flag is written FIRST and the hold released only on
  // success — a wizard that says it finished when nothing was recorded would
  // reopen next launch with no explanation.
  const [flag, setFlag] = useState<OnboardingCompletionFlag>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // ONE completion path for both variants (§6.2): the second-user end differs
    // only in having no beat to wait out, never in what it records.
    if (pane !== "ready" && pane !== "finishing") return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (usersUpdate === undefined) {
          onComplete(profile);
          return;
        }
        setFlag({ kind: "writing" });
        usersUpdate({ onboarded: true })
          .then((updated) => {
            if (!cancelled) onComplete(updated);
          })
          .catch((cause: unknown) => {
            if (cancelled) return;
            setFlag({
              kind: "failed",
              reason: `${cause instanceof Error ? cause.message : String(cause)} — your field is ready either way.`,
            });
          });
      },
      pane === "finishing" || attempt > 0 ? 0 : READY_BEAT_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pane, attempt, usersUpdate, onComplete, profile]);

  const shell = (content: ReactElement): ReactElement => <WizardShell>{content}</WizardShell>;

  if (pane === null) {
    // Deriving. A fact, not a spinner (§8: a state is rendered, never blank).
    return shell(<OnboardingDerivingPaneView />);
  }

  const onBack = canGoBack ? back : undefined;

  switch (pane) {
    case "welcome":
      return shell(<OnboardingWelcomePaneView onContinue={() => go("field")} />);

    case "welcome-back":
      return shell(<OnboardingWelcomeBackPaneView onContinue={() => go("field")} />);

    case "field":
      return shell(
        <FieldPane
          profile={profile}
          usersUpdate={usersUpdate}
          onBack={onBack}
          onDone={(updated) => {
            setProfile(updated);
            go(migrated ? endPane : "setting-up");
          }}
        />,
      );

    case "setting-up":
      return shell(
        <OnboardingSettingUpPaneView
          stagesDone={onboarding.stagesDone}
          onContinue={() => go("connect")}
        />,
      );

    case "connect":
      return shell(
        <ConnectPane
          face={face}
          onBack={onBack}
          onContinue={() => go(linked ? "posture" : endPane)}
          onSkip={() => go(endPane)}
        />,
      );

    case "posture":
      return shell(<PosturePane onBack={onBack} onDone={() => go(endPane)} />);

    case "ready":
      return shell(
        <OnboardingReadyPaneView
          profileName={profile.name}
          flag={flag}
          onRetry={() => setAttempt((n) => n + 1)}
          onContinueAnyway={() => onComplete(profile)}
          settingsChord={getHost().platform === "darwin" ? "⌘," : "Ctrl+,"}
        />,
      );

    case "finishing":
      // §6.2 — a successful write is gone before anyone could read a greeting,
      // so this state's only real face is the refusal. The passing case still
      // renders a fact rather than a blank window (§8), because a slow
      // supervisor must not look like a hang.
      return shell(
        <OnboardingFinishingPaneView
          flag={flag}
          onRetry={() => setAttempt((n) => n + 1)}
          onContinueAnyway={() => onComplete(profile)}
        />,
      );
  }
}

/** Pane 2 — the one mandatory decision, and the only write the wizard needs to
 * make before it can call anything set up. */
function FieldPane({
  profile,
  usersUpdate,
  onBack,
  onDone,
}: {
  profile: FieldUserProfile;
  usersUpdate: ReturnType<typeof getHost>["usersUpdate"];
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
  const [pickerOpen, setPickerOpen] = useState(false);
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
      pickerOpen={pickerOpen}
      writing={writing}
      error={error}
      onNameChange={setName}
      onFaceChange={(next) => {
        chosen.current = true;
        setFace(next);
      }}
      onPickerToggle={() => setPickerOpen((open) => !open)}
      onSubmit={commit}
      onBack={onBack}
    />
  );
}

/** Pane 4 — the link, and since UA-P-0g the place it BEGINS. The same act as
 * Settings → Account: the same method, the same phrase on the button, and the
 * same rule about where the face comes from — `user.link.subscribe` moves it,
 * this call never does. Only the in-flight beat and a refusal live here.
 *
 * The client rather than the view owns it for the same reason `PosturePane`
 * below does: `onboarding-views` is the Electron-free surface the catalog
 * mounts, and a view that reached for a daemon could not be shown there. */
function ConnectPane({
  face,
  onContinue,
  onSkip,
  onBack,
}: {
  face: LinkFace;
  onContinue: () => void;
  onSkip: () => void;
  onBack: (() => void) | undefined;
}): ReactElement {
  const client = useFielddClient();
  const [step, setStep] = useState<LinkBeginStep>({ kind: "idle" });

  const begin = async (): Promise<void> => {
    setStep({ kind: "pending" });
    try {
      await client.request("user.link.begin", {});
      setStep({ kind: "idle" });
    } catch (cause) {
      setStep({
        kind: "failed",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  return (
    <OnboardingConnectPaneView
      face={face}
      beginStep={step}
      onBeginLink={() => void begin()}
      onContinue={onContinue}
      onSkip={onSkip}
      onBack={onBack}
    />
  );
}

/** The posture question — the same two cards, the same words, the same key as
 * Settings → Account (they share `POSTURE_CHOICES` and `useSyncPosture`). */
function PosturePane({
  onBack,
  onDone,
}: {
  onBack: (() => void) | undefined;
  onDone: () => void;
}): ReactElement {
  const posture = useSyncPosture();
  return <OnboardingPosturePaneView posture={posture} onDone={onDone} onBack={onBack} />;
}
