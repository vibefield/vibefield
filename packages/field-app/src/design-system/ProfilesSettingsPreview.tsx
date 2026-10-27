import { type ReactElement, useEffect, useMemo } from "react";
import {
  AddServerView,
  AddSkillView,
  AgentExtensionListView,
  AgentExtensionsView,
  addServerSubpage,
  addSkillSubpage,
  agentListSubpage,
  BrowseView,
  browseSubpage,
  ExtensionItemView,
  extensionItemSubpage,
  ListedPluginView,
  PluginView,
  ProfileExtensionsView,
  pluginSubpage,
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
  FIXTURE_CATALOG,
  FIXTURE_CHECK_RUN,
  FIXTURE_EXTENSION_PLAN,
  FIXTURE_EXTENSION_RUN,
  FIXTURE_EXTENSION_RUNNING,
  FIXTURE_EXTENSION_SIGNING_IN,
  FIXTURE_EXTENSIONS,
  FIXTURE_EXTENSIONS_NOW,
  FIXTURE_INSTALL_PANE,
  FIXTURE_PLUGIN_RUN,
  FIXTURE_SKILL_PLAN,
  FIXTURE_SOURCE_PLAN,
} from "./extensions-fixtures";
import {
  FIXTURE_DEMO,
  FIXTURE_INSTALL_PANE_OUTPUT,
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

/** AR-S4e: one plugin an agent holds, on its own page — Claude's review (updated
 * just now; its removal with its data asked), and OpenCode's, with no act of its own. */
const REVIEW = { provider: "claude", agent: "Claude", id: "review@northlight", name: "review" };
const PLUGINS: Partial<
  Record<
    ProfilesFixtureState,
    {
      provider: string;
      agent: string;
      id: string;
      name: string;
      updated?: boolean;
      armed?: "purge";
    }
  >
> = {
  plugin: REVIEW,
  "plugin updated": { ...REVIEW, updated: true },
  "plugin removal": { ...REVIEW, armed: "purge" },
  "plugin, no command": {
    provider: "opencode",
    agent: "OpenCode",
    id: "opencode-wakatime",
    name: "opencode-wakatime",
  },
};

/**
 * AR-S4e2: browse and install — Claude's Plugins list after a check (review
 * has a newer version listed), OpenCode's with Add plugin's form open, Claude's
 * catalogs (and a profile with no marketplace yet, a marketplace's removal
 * asked, Add marketplace's form), a listed plugin to install in one click, and
 * one whose install runs in a terminal the person answers.
 */
const CHECKED = {
  ...FIXTURE_EXTENSIONS,
  agents: FIXTURE_EXTENSIONS.agents.map((column) =>
    column.provider === REVIEW.provider
      ? { ...column, checkedAt: FIXTURE_CHECK_RUN.finishedAt }
      : column,
  ),
  plugins: {
    ...FIXTURE_EXTENSIONS.plugins,
    [REVIEW.provider]: (FIXTURE_EXTENSIONS.plugins[REVIEW.provider] ?? []).map((held) =>
      held.id === REVIEW.id ? { ...held, newer: { version: "1.3.0" } } : held,
    ),
  },
  run: FIXTURE_CHECK_RUN,
};
/** The agent in Work that installs a plugin from a source a person gives, as the fixture lens says. */
const SOURCE_AGENT = FIXTURE_EXTENSIONS.agents.find(
  (column) =>
    column.support.plugins?.sources !== undefined && column.support.plugins.catalog !== true,
);
/** The two states that open an agent's own list at its head: kept here, so each render holds the same object. */
const HEAD_LISTS: Partial<
  Record<ProfilesFixtureState, { provider: string; agent: string; list: AgentListKey }>
> = {
  "plugins, checked": { provider: REVIEW.provider, agent: REVIEW.agent, list: "plugins" },
  ...(SOURCE_AGENT !== undefined
    ? {
        "add package": {
          provider: SOURCE_AGENT.provider,
          agent: SOURCE_AGENT.label,
          list: "plugins" as const,
        },
      }
    : {}),
};
const BROWSE: Partial<
  Record<ProfilesFixtureState, { query?: string; empty?: boolean; armed?: string; adding?: string }>
> = {
  browse: {},
  "browse, no marketplaces": { empty: true },
  "marketplace removal": { armed: "northlight" },
  "add marketplace": { adding: "northlight-studio/labs" },
};
const LISTED: Partial<Record<ProfilesFixtureState, { id: string; name: string; pane?: boolean }>> =
  {
    "plugin to install": { id: "changelog@northlight", name: "changelog" },
    "install in a terminal": { id: "deploy@northlight", name: "deploy", pane: true },
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
    state === "this mac" || state === "this mac, alone"
      ? FIXTURE_NATIVE
      : state === "empty"
        ? FIXTURE_DEMO
        : FIXTURE_WORK;
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
  const list = LISTS[state] ?? HEAD_LISTS[state];
  const item = ITEMS[state];
  const plugin = PLUGINS[state];
  const browse = BROWSE[state];
  const listed = LISTED[state];

  useEffect(() => {
    onSubpage(
      agentLabel !== undefined
        ? profileAgentSubpage(FIXTURE_WORK, agentLabel, inert)
        : browse !== undefined
          ? browseSubpage(FIXTURE_WORK, REVIEW.agent, "Browse plugins", "Plugins", inert)
          : listed !== undefined
            ? pluginSubpage(FIXTURE_WORK, REVIEW.agent, listed.name, "Browse plugins", inert)
            : list !== undefined
              ? agentListSubpage(FIXTURE_WORK, list.agent, list.list, inert)
              : item !== undefined
                ? extensionItemSubpage(FIXTURE_WORK, item.list, item.name, inert)
                : plugin !== undefined
                  ? pluginSubpage(FIXTURE_WORK, plugin.agent, plugin.name, "Plugins", inert)
                  : state === "add server"
                    ? addServerSubpage(FIXTURE_WORK, inert)
                    : state === "add skill"
                      ? addSkillSubpage(FIXTURE_WORK, inert)
                      : null,
    );
  }, [agentLabel, list, item, plugin, browse, listed, state, onSubpage]);
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
  if (browse !== undefined) {
    const catalog = browse.empty
      ? { ...FIXTURE_CATALOG, marketplaces: [], plugins: [] }
      : FIXTURE_CATALOG;
    return (
      <BrowseView
        lens={FIXTURE_EXTENSIONS}
        catalog={catalog}
        provider={REVIEW.provider}
        where={inOnWords(FIXTURE_WORK)}
        onRefresh={inert}
        onAct={inert}
        onOpen={inert}
        onPlanSource={async () => FIXTURE_SOURCE_PLAN.offer}
        now={FIXTURE_EXTENSIONS_NOW}
        {...(browse.armed !== undefined ? { armed: browse.armed } : {})}
        {...(browse.adding !== undefined ? { adding: browse.adding } : {})}
      />
    );
  }
  if (listed !== undefined) {
    return (
      <ListedPluginView
        lens={
          listed.pane ? { ...FIXTURE_EXTENSIONS, run: FIXTURE_INSTALL_PANE } : FIXTURE_EXTENSIONS
        }
        catalog={FIXTURE_CATALOG}
        provider={REVIEW.provider}
        id={listed.id}
        name={listed.name}
        where={inOnWords(FIXTURE_WORK)}
        onRefresh={inert}
        onAct={inert}
        now={FIXTURE_EXTENSIONS_NOW}
        {...(listed.pane
          ? {
              signIn: {
                pane: <pre className="vf-agents-output-text">{FIXTURE_INSTALL_PANE_OUTPUT}</pre>,
                onCancel: inert,
              },
            }
          : {})}
      />
    );
  }
  if (list !== undefined) {
    return (
      <AgentExtensionListView
        lens={state === "plugins, checked" ? CHECKED : FIXTURE_EXTENSIONS}
        provider={list.provider}
        agent={list.agent}
        list={list.list}
        profile={FIXTURE_WORK.label}
        where={inOnWords(FIXTURE_WORK)}
        onRefresh={inert}
        onOpenProfile={inert}
        onOpen={inert}
        onCheck={inert}
        onBrowse={inert}
        onAct={inert}
        onPlanSource={async () => ({
          // OpenCode keeps its plugins in one config, so an install reaches every profile
          act: {
            act: "install",
            runs: "opencode plugin opencode-notify --global --pure",
            reaches: ["every-profile"],
          },
        })}
        now={FIXTURE_EXTENSIONS_NOW}
        {...(state === "add package" ? { adding: "opencode-notify" } : {})}
      />
    );
  }
  if (plugin !== undefined) {
    // "plugin updated": the read after the update holds the newer commit, and the run card says so
    const lens = plugin.updated
      ? {
          ...FIXTURE_EXTENSIONS,
          plugins: {
            ...FIXTURE_EXTENSIONS.plugins,
            [plugin.provider]: (FIXTURE_EXTENSIONS.plugins[plugin.provider] ?? []).map((held) =>
              held.id === plugin.id
                ? {
                    ...held,
                    version: "9a8b7c6d5e4f",
                    // an update lands in a folder of the new version's
                    ...(held.place !== undefined
                      ? { place: held.place.replace(/[^/]+$/u, "9a8b7c6d5e4f") }
                      : {}),
                  }
                : held,
            ),
          },
          run: FIXTURE_PLUGIN_RUN,
        }
      : FIXTURE_EXTENSIONS;
    return (
      <PluginView
        lens={lens}
        provider={plugin.provider}
        id={plugin.id}
        name={plugin.name}
        where={inOnWords(FIXTURE_WORK)}
        onRefresh={inert}
        onAct={inert}
        now={FIXTURE_EXTENSIONS_NOW}
        {...(plugin.armed !== undefined
          ? {
              armed: {
                provider: plugin.provider,
                kind: "plugin",
                id: plugin.id,
                act: plugin.armed,
              },
            }
          : {})}
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
    state === "this mac" || state === "this mac, alone"
      ? FIXTURE_NATIVE
      : state === "empty"
        ? FIXTURE_DEMO
        : FIXTURE_WORK;
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
      onNewProfile={state === "this mac, alone" ? inert : undefined}
    />
  );
}
