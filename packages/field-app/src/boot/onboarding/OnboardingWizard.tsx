import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider, useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import { faceOf } from "../../account/faces";
import { hasLink, linkFace, type UserLinkStatus } from "../../account/link";
import { type FieldUserProfile, getHost } from "../../host";
import { answerSetupStep } from "../../setup/ledger";
import type { BootOnboarding, BootView } from "../machine";
import { entryAfterName, entryBeforeAsking, nextPane, type Pane, variantOf } from "./order";
import { ConnectPane } from "./panes/ConnectPane";
import { FieldPane } from "./panes/FieldPane";
import { PosturePane } from "./panes/PosturePane";
import { SettingUpPane } from "./panes/SettingUpPane";
import { UsersPane } from "./panes/UsersPane";
import {
  OnboardingDerivingPaneView,
  OnboardingWelcomeBackPaneView,
  OnboardingWelcomePaneView,
} from "./views/welcome";
import { WizardShell } from "./wizard-ui";

// The Setup Assistant (UA-3w; spec §6; track AO — draft/thinking-agent-onboarding.md).
// Held open by the boot machine between a warm daemon and an open document;
// its answers recorded, it keeps the window while the desk opens beneath it,
// and hands the window over when Setting up becomes Ready (AO-D2).
//
// The laws it implements, and where each one lives:
//   W1 one decision per pane          — the Pane union in order.ts; nothing asks twice.
//   W2 the mandatory core is a name   — the name pane pre-fills it and Continue never
//                                       validates; an empty box keeps the
//                                       pre-filled name rather than blocking.
//   W3 everything else is skippable   — SkipAction, whose subtitle names the
//                                       later home verbatim.
//   W4 honest progress only           — Setting up lists the boot machine's own
//                                       phase and stage for the desk, as it opens.
//   W5 it ends inside the product     — the answers are a durable write, then the
//                                       desk opens beneath the glass, and the
//                                       glass hands the window to it.
//   W6 position derives from facts    — order.ts's entry derivation reads users.json
//                                       fields and the link snapshot. There is no
//                                       wizard state store, so quitting and
//                                       relaunching lands on the first incomplete
//                                       pane by construction, not by memory.
//
// Each pane's controller is its own file under panes/ and its face under
// views/, one owner each: the Connect pane and the sync question are track TS's.

/** How long a RESUMING wizard waits for the link snapshot before deciding
 * where to land. A silent daemon must not park the user on a blank pane, so
 * the derivation proceeds with "no link known" once this elapses. */
const ENTRY_SETTLE_MS = 1_200;

export function OnboardingWizard({
  client,
  onboarding,
  boot,
  onComplete,
  onReveal,
  onRetry,
}: {
  client: FielddClient;
  onboarding: BootOnboarding;
  /** The boot machine's view — the desk's real phase and stage (W4). */
  boot: BootView;
  /** The questions are answered and recorded: the document opens beneath the glass. */
  onComplete: (profile?: FieldUserProfile) => void;
  /** Setting up's last beat is over: the glass hands the window to the desk. */
  onReveal: () => void;
  /** The boot's own Retry, for a desk that could not open. */
  onRetry: () => void;
}): ReactElement {
  return (
    <FielddProvider client={client}>
      <WizardBody
        onboarding={onboarding}
        boot={boot}
        onComplete={onComplete}
        onReveal={onReveal}
        onRetry={onRetry}
      />
    </FielddProvider>
  );
}

function WizardBody({
  onboarding,
  boot,
  onComplete,
  onReveal,
  onRetry,
}: {
  onboarding: BootOnboarding;
  boot: BootView;
  onComplete: (profile?: FieldUserProfile) => void;
  onReveal: () => void;
  onRetry: () => void;
}): ReactElement {
  const client = useFielddClient();
  const usersUpdate = getHost().usersUpdate;
  const [profile, setProfile] = useState<FieldUserProfile>(onboarding.profile);
  const variant = variantOf(profile);

  const link = useSubscription<UserLinkStatus>("user.link.subscribe");
  const face = linkFace(link.status, link.status === "live" ? (link.data ?? null) : null);
  const linked = hasLink(face);
  const facts = { variant, linked };

  // W6 — the entry pane is DERIVED (order.ts): the top for a record that never
  // answered the name pane, else the first thing still unanswered once the link
  // snapshot has spoken.
  const [pane, setPane] = useState<Pane | null>(() => entryBeforeAsking(profile));
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
    setPane(entryAfterName(variant, linked));
  }, [pane, link.status, settled, variant, linked]);

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
  // A second user's first pane has nowhere earlier to go, and the user it is
  // setting up already exists — so its Back opens the chooser instead, and the
  // chooser's "Continue setup" returns to the pane it was opened from.
  const host = getHost();
  const canChooseUser =
    variant === "second-user" && host.usersList !== undefined && host.usersSwitch !== undefined;

  // AO-2 — a step put off is recorded in the ledger, so Settings' "Finish
  // setting up" can list it. Devices is put off when the person moves on
  // without a link; a link, made here or anywhere, answers it by itself.
  const putOffDevices = (): void => {
    void answerSetupStep(client, "devices", "later").catch((cause: unknown) =>
      host.logger
        .child({ component: "onboarding" })
        .warn("renderer.setup.answer_refused", "The setup ledger did not record a step put off", {
          step: "devices",
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    );
  };

  const shell = (content: ReactElement): ReactElement => <WizardShell>{content}</WizardShell>;

  if (pane === null) {
    // Deriving. A fact, not a spinner (§8: a state is rendered, never blank).
    return shell(<OnboardingDerivingPaneView />);
  }

  const onBack = canGoBack ? back : canChooseUser ? () => go("users") : undefined;

  switch (pane) {
    case "welcome":
      return shell(<OnboardingWelcomePaneView onContinue={() => go(nextPane("welcome", facts))} />);

    case "welcome-back":
      return shell(
        <OnboardingWelcomeBackPaneView onContinue={() => go(nextPane("welcome-back", facts))} />,
      );

    case "field":
      return shell(
        <FieldPane
          profile={profile}
          usersUpdate={usersUpdate}
          eyebrow={variant === "second-user" ? "New user" : "Your field"}
          onBack={onBack}
          onDone={(updated) => {
            setProfile(updated);
            go(nextPane("field", facts));
          }}
        />,
      );

    case "connect":
      return shell(
        <ConnectPane
          me={{ face: faceOf(profile, []), seed: profile.userId }}
          escapeIsNotNow
          onBack={onBack}
          onContinue={() => {
            if (!linked) putOffDevices();
            go(nextPane("connect", facts));
          }}
          onSkip={() => {
            putOffDevices();
            go(nextPane("connect", facts, "skip"));
          }}
        />,
      );

    case "posture":
      return shell(<PosturePane onBack={onBack} onDone={() => go(nextPane("posture", facts))} />);

    case "users":
      return shell(<UsersPane profile={profile} onContinue={back} />);

    case "setting-up":
      return shell(
        <SettingUpPane
          profile={profile}
          welcomeName={variant === "second-user" ? null : profile.name}
          usersUpdate={usersUpdate}
          boot={boot}
          onAnswered={onComplete}
          onReveal={onReveal}
          onRetryBoot={onRetry}
          settingsChord={host.platform === "darwin" ? "⌘," : "Ctrl+,"}
        />,
      );
  }
}
