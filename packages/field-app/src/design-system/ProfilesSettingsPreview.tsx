import { type ReactElement, useEffect, useMemo } from "react";
import {
  NewProfileView,
  ProfileAgentPageView,
  ProfilePageView,
  profileAgentSubpage,
  SignInCard,
} from "../panels/agents/ProfilesView";
import { agentRow, profilePage, signInNote } from "../panels/agents/profiles-model";
import type { SettingsSubpage } from "../panels/SettingsDialog";
import {
  FIXTURE_DEMO,
  FIXTURE_NATIVE,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_PROFILES_NOW,
  FIXTURE_SIGN_IN_OUTPUT,
  FIXTURE_WORK,
  type ProfilesFixtureState,
} from "./profiles-fixtures";

// Agent Profiles on fixture doors: the shipping pages, one production state at
// a time. Acts are inert; the sign-in's terminal is a still of the vendor's
// login (the live one is the window's terminal pool, which a catalog has not).

const inert = (): void => undefined;

/** The Settings header each state wears (the panel supplies it in the product). */
export function profilesPreviewHead(state: ProfilesFixtureState): {
  head: { title: string; description: string } | null;
  current: string;
} {
  if (state === "new") {
    return {
      head: {
        title: "New agent profile",
        description: "An empty folder for each agent. Nothing is signed in until you add one.",
      },
      current: "new",
    };
  }
  const set =
    state === "this mac" ? FIXTURE_NATIVE : state === "empty" ? FIXTURE_DEMO : FIXTURE_WORK;
  return { head: { title: set.label, description: "Agent profile" }, current: set.id };
}

export function ProfilesSettingsPreview({
  state,
  onSubpage,
}: {
  state: ProfilesFixtureState;
  onSubpage: (subpage: SettingsSubpage | null) => void;
}): ReactElement {
  const context = FIXTURE_PROFILES_CONTEXT;
  const agent = useMemo(
    () => (state === "agent" ? agentRow(context, FIXTURE_WORK.personas[0]!) : undefined),
    [state, context],
  );
  const agentLabel = agent?.label;

  useEffect(() => {
    onSubpage(
      agentLabel === undefined ? null : profileAgentSubpage(FIXTURE_WORK, agentLabel, inert),
    );
  }, [agentLabel, onSubpage]);
  useEffect(() => () => onSubpage(null), [onSubpage]);

  if (state === "new") return <NewProfileView onCancel={inert} onCreate={inert} />;
  if (agent !== undefined) {
    return (
      <ProfileAgentPageView
        set={FIXTURE_WORK}
        row={agent}
        appVersion="2.3.0"
        canSignOut
        now={FIXTURE_PROFILES_NOW}
        onSignIn={inert}
        onReveal={inert}
        onSignOut={inert}
        onOpenApp={inert}
      />
    );
  }
  const set =
    state === "this mac" ? FIXTURE_NATIVE : state === "empty" ? FIXTURE_DEMO : FIXTURE_WORK;
  const signing =
    state === "signing in" ? (
      <SignInCard
        agentLabel="Grok"
        where={set.label}
        note={signInNote(set, "Grok")}
        onCancel={inert}
      >
        <pre className="vf-agents-output-text">{FIXTURE_SIGN_IN_OUTPUT}</pre>
      </SignInCard>
    ) : null;
  return (
    <ProfilePageView
      page={profilePage(set, context)}
      now={FIXTURE_PROFILES_NOW}
      signIn={signing}
      busy={state === "signing in" ? "add:grok" : null}
      onAdd={inert}
      onOpenAgent={inert}
      onSignIn={inert}
      onRename={inert}
      onGlyph={inert}
      onMakeDefault={inert}
      onReveal={inert}
      onDelete={inert}
    />
  );
}
