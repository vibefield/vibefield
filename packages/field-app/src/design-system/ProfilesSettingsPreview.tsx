import { type ReactElement, useEffect, useMemo } from "react";
import { ProfileExtensionsView } from "../panels/agents/ExtensionsView";
import {
  NewProfileView,
  ProfileAgentPageView,
  ProfilePageView,
  profileAgentSubpage,
  SignInCard,
} from "../panels/agents/ProfilesView";
import { agentRow, profilePage, signInNote } from "../panels/agents/profiles-model";
import type { SettingsSubpage } from "../panels/SettingsDialog";
import { FIXTURE_EXTENSIONS, FIXTURE_EXTENSIONS_NOW } from "./extensions-fixtures";
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
  const context = useMemo(
    () =>
      state === "loading usage"
        ? { ...FIXTURE_PROFILES_CONTEXT, usage: [] }
        : FIXTURE_PROFILES_CONTEXT,
    [state],
  );
  // "agent": a vendor agent in Work (one subscription); "sign-ins": OpenCode,
  // whose folder holds several
  const agent = useMemo(() => {
    const provider = state === "agent" ? "claude" : state === "sign-ins" ? "opencode" : undefined;
    const persona = FIXTURE_WORK.personas.find((candidate) => candidate.provider === provider);
    return persona === undefined ? undefined : agentRow(context, persona);
  }, [state, context]);
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
        appVersion={
          context.installs.find((candidate) => candidate.provider === agent.provider)?.version
        }
        canSignOut
        now={FIXTURE_PROFILES_NOW}
        plans={profilePage(FIXTURE_WORK, context).plans}
        routes={context.routes[agent.provider]}
        onSignIn={inert}
        onAddSignIn={inert}
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
      refreshingUsage={state === "loading usage" || state === "refreshing usage"}
      onRefreshUsage={inert}
      now={FIXTURE_PROFILES_NOW}
      signIn={signing}
      extensions={
        // AR-S4b: Work's servers and skills, and the page while its first read runs
        set === FIXTURE_WORK ? (
          <ProfileExtensionsView
            lens={state === "reading extensions" ? null : FIXTURE_EXTENSIONS}
            profile={set.label}
            now={FIXTURE_EXTENSIONS_NOW}
            onRefresh={inert}
          />
        ) : undefined
      }
      busy={state === "signing in" ? "add:grok" : null}
      onAdd={inert}
      onOpenAgent={inert}
      onSignIn={inert}
      onRename={() => undefined}
      onGlyph={inert}
      onMakeDefault={inert}
      onReveal={inert}
      onDelete={inert}
      onPlanAct={inert}
    />
  );
}
