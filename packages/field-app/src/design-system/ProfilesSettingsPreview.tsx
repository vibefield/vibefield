import { type ReactElement, useEffect, useMemo } from "react";
import {
  AddServerView,
  AddSkillView,
  AgentExtensionListView,
  AgentExtensionsView,
  addServerSubpage,
  addSkillSubpage,
  agentListSubpage,
  ExtensionItemView,
  extensionItemSubpage,
  ProfileExtensionsView,
} from "../panels/agents/ExtensionsView";
import type { AgentListKey, ExtensionKindKey } from "../panels/agents/extensions-model";
import {
  NewProfileView,
  ProfileAgentPageView,
  ProfilePageView,
  profileAgentSubpage,
  SignInCard,
} from "../panels/agents/ProfilesView";
import { agentRow, inOnWords, profilePage, signInNote } from "../panels/agents/profiles-model";
import type { SettingsSubpage } from "../panels/SettingsDialog";
import {
  FIXTURE_EXTENSION_PLAN,
  FIXTURE_EXTENSION_RUN,
  FIXTURE_EXTENSION_RUNNING,
  FIXTURE_EXTENSION_SIGNING_IN,
  FIXTURE_EXTENSIONS,
  FIXTURE_EXTENSIONS_NOW,
  FIXTURE_SKILL_PLAN,
} from "./extensions-fixtures";
import {
  FIXTURE_DEMO,
  FIXTURE_NATIVE,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_PROFILES_NOW,
  FIXTURE_SERVER_SIGN_IN_OUTPUT,
  FIXTURE_SIGN_IN_OUTPUT,
  FIXTURE_WORK,
  type ProfilesFixtureState,
} from "./profiles-fixtures";

// Agent Profiles on fixture doors: the shipping pages, one production state at
// a time. Acts are inert; the sign-in's terminal is a still of the vendor's
// login (the live one is the window's terminal pool, which a catalog has not).

const inert = (): void => undefined;

/** AR-S4b: an agent's own list in Work, as the extensions fixture reads it. */
const LISTS: Partial<
  Record<ProfilesFixtureState, { provider: string; agent: string; list: AgentListKey }>
> = {
  "agent's plugins": { provider: "claude", agent: "Claude", list: "plugins" },
  "agent's servers": { provider: "claude", agent: "Claude", list: "servers" },
  "agent's skills": { provider: "codex", agent: "Codex", list: "skills" },
};

/** AR-S4b: one of Work's servers or skills on its own page; AR-S4c: notion,
 * which Codex asks to sign in to — its confirm open, then its pane. */
const ITEMS: Partial<Record<ProfilesFixtureState, { list: ExtensionKindKey; name: string }>> = {
  server: { list: "servers", name: "linear" },
  "server sign-in": { list: "servers", name: "notion" },
  "server signing in": { list: "servers", name: "notion" },
  skill: { list: "skills", name: "release-notes" },
  // AR-S4d2 — a skill Work keeps once: its folder, and each agent's link as its switch
  "kept skill": { list: "skills", name: "changelog-writer" },
};

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
  const list = LISTS[state];
  const item = ITEMS[state];

  useEffect(() => {
    onSubpage(
      agentLabel !== undefined
        ? profileAgentSubpage(FIXTURE_WORK, agentLabel, inert)
        : list !== undefined
          ? agentListSubpage(FIXTURE_WORK, list.agent, list.list, inert)
          : item !== undefined
            ? extensionItemSubpage(FIXTURE_WORK, item.list, item.name, inert)
            : state === "add server"
              ? addServerSubpage(FIXTURE_WORK, inert)
              : state === "add skill"
                ? addSkillSubpage(FIXTURE_WORK, inert)
                : null,
    );
  }, [agentLabel, list, item, state, onSubpage]);
  useEffect(() => () => onSubpage(null), [onSubpage]);

  if (state === "new") return <NewProfileView onCancel={inert} onCreate={inert} />;
  // AR-S4d — Add server with its form typed, told what each agent would run
  if (state === "add server") {
    return (
      <AddServerView
        lens={FIXTURE_EXTENSIONS}
        profile={FIXTURE_WORK.label}
        where={inOnWords(FIXTURE_WORK)}
        offers={FIXTURE_EXTENSION_PLAN.offers}
        initial={{ draft: { name: "figma", how: "url", url: "https://mcp.figma.com/mcp" } }}
        onAdd={inert}
        onCancel={inert}
        now={FIXTURE_EXTENSIONS_NOW}
      />
    );
  }
  // AR-S4d2 — Add skill with a folder named, told what the folder is and what each agent would run
  if (state === "add skill") {
    return (
      <AddSkillView
        lens={FIXTURE_EXTENSIONS}
        profile={FIXTURE_WORK.label}
        where={inOnWords(FIXTURE_WORK)}
        plan={FIXTURE_SKILL_PLAN}
        initial={{ from: "~/Downloads/pdf-forms" }}
        onAdd={inert}
        onCancel={inert}
        now={FIXTURE_EXTENSIONS_NOW}
      />
    );
  }
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
        extensions={
          <AgentExtensionsView lens={FIXTURE_EXTENSIONS} provider={agent.provider} onOpen={inert} />
        }
      />
    );
  }
  if (list !== undefined) {
    return (
      <AgentExtensionListView
        lens={FIXTURE_EXTENSIONS}
        provider={list.provider}
        agent={list.agent}
        list={list.list}
        profile={FIXTURE_WORK.label}
        where={inOnWords(FIXTURE_WORK)}
        onRefresh={inert}
        onOpenProfile={inert}
        now={FIXTURE_EXTENSIONS_NOW}
      />
    );
  }
  if (item !== undefined) {
    const signing = FIXTURE_EXTENSION_SIGNING_IN;
    return (
      <ExtensionItemView
        lens={
          state === "server signing in"
            ? { ...FIXTURE_EXTENSIONS, run: signing }
            : FIXTURE_EXTENSIONS
        }
        list={item.list}
        name={item.name}
        where={inOnWords(FIXTURE_WORK)}
        onRefresh={inert}
        onAct={inert}
        now={FIXTURE_EXTENSIONS_NOW}
        {...(state === "server sign-in"
          ? {
              armed: {
                provider: signing.provider,
                kind: signing.kind,
                id: signing.item,
                act: signing.act,
              },
            }
          : {})}
        {...(state === "server signing in"
          ? {
              signIn: {
                pane: <pre className="vf-agents-output-text">{FIXTURE_SERVER_SIGN_IN_OUTPUT}</pre>,
                onCancel: inert,
              },
            }
          : {})}
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
        // AR-S4b: Work's servers and skills, and the page while its first read
        // runs; AR-S4c: a cell's confirm open, an act running, an act finished
        set === FIXTURE_WORK ? (
          <ProfileExtensionsView
            lens={
              state === "reading extensions"
                ? null
                : state === "act running"
                  ? { ...FIXTURE_EXTENSIONS, run: FIXTURE_EXTENSION_RUNNING }
                  : state === "act finished"
                    ? { ...FIXTURE_EXTENSIONS, run: FIXTURE_EXTENSION_RUN }
                    : FIXTURE_EXTENSIONS
            }
            profile={set.label}
            where={inOnWords(set)}
            now={FIXTURE_EXTENSIONS_NOW}
            onRefresh={inert}
            onOpenItem={inert}
            onAct={inert}
            onAddServer={inert}
            onAddSkill={inert}
            otherProfiles={[
              {
                profile: FIXTURE_DEMO.label,
                providers: FIXTURE_DEMO.personas.map((member) => member.provider),
              },
            ]}
            {...(state === "act confirm"
              ? {
                  armed: {
                    provider: "claude",
                    kind: "mcp-server" as const,
                    id: "linear",
                    act: "remove" as const,
                  },
                }
              : {})}
            {...(state === "turn on"
              ? {
                  // AR-S4d — context7 turned on for Codex (the act fixture's agent), its key asked for first
                  armed: {
                    provider: FIXTURE_EXTENSION_RUN.provider,
                    kind: "mcp-server" as const,
                    id: "context7",
                    act: "add" as const,
                  },
                }
              : {})}
            {...(state === "skill to codex"
              ? {
                  // AR-S4d2 — changelog-writer taken to the shared folder for Codex, who else loads it named
                  armed: {
                    provider: "codex",
                    kind: "skill" as const,
                    id: "changelog-writer",
                    act: "add" as const,
                  },
                }
              : {})}
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
