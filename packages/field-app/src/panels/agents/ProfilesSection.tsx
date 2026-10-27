import {
  AgentAccountUsageBatch,
  type AgentInstall,
  type AgentProfileSet,
  type AgentProviderSummary,
  AgentProvidersResult,
  AgentsInstallsResult,
  AgentsProfileSetsDeleteResult,
  type AgentsProfileSetsListResult,
  AgentsProfileSetsRevealResult,
  AgentsProfileSetsSetResult,
  AgentsProfilesCreateResult,
  AgentsProfilesDeleteResult,
  type ShellPlatform,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refusalSentence } from "../../account/use-account";
import type { SettingsSubpage } from "../SettingsDialog";
import type { AgentsNotice } from "./AgentsView";
import {
  AddServer,
  AddSkill,
  AgentBrowse,
  AgentExtensionList,
  AgentExtensions,
  AgentListedPlugin,
  AgentPlugin,
  ExtensionItem,
  ProfileExtensions,
} from "./ExtensionsSection";
import {
  addServerSubpage,
  addSkillSubpage,
  agentListSubpage,
  browseSubpage,
  extensionItemSubpage,
  pluginSubpage,
} from "./ExtensionsView";
import type { AgentListKey, ExtensionKindKey } from "./extensions-model";
import {
  NewProfileView,
  ProfileAgentPageView,
  ProfilePageView,
  profileAgentSubpage,
  SignInCard,
} from "./ProfilesView";
import { agentRow, inOnWords, plural, profilePage, signInNote } from "./profiles-model";
import { SignInTerminal } from "./SignInTerminal";
import { signInEndNotice, useProfileSignIn } from "./use-profile-sign-in";

// Agent Profiles' controller (the design record's R1, pass 16).
//
// The profiles themselves come from `agents.profileSets.subscribe`, which the
// Settings panel holds (the sidebar lists them on every page). This reads what
// the pages join to them — `agent.providers` (labels), `agents.installs` (what
// is installed, fieldd's inventory at launch) and `agents.usage.subscribe`
// (each sign-in's windows) — and runs the acts: make, rename, re-mark, make
// the default, delete (`agents.profileSets.*`), add an agent and sign in or out
// (`agents.profiles.create` · `.login` · `.delete`), Show in Finder. No
// optimistic state: every act lands through the profiles feed.
//
// A sign-in runs in a terminal on the page that asked for it, one at a time,
// through the controller this page shares with the Setup Assistant's Profiles
// pane (use-profile-sign-in.ts): it closes when fieldd says its pane has ended,
// and a cancelled add adds nothing.
//
// AR-S4b — Extensions: below a profile's page, one server's or skill's own
// page (a list's row name opens it); below an agent's, its own plugins,
// servers or skills (its Extensions rows open them). Each reads the profile's
// lens itself (ExtensionsSection.tsx). AR-S4e: a row of an agent's own list
// opens its page — a plugin's below the list, a server's or skill's (whose
// way back is then that list).

export type ProfilesRoute =
  | { kind: "profile"; set: string }
  | { kind: "agent"; set: string; provider: string }
  /** AR-S4b — one agent's own plugins, servers or skills, a page below the agent's;
   * AR-S4e — titled as its row was, in the agent's own word for the kind */
  | { kind: "list"; set: string; provider: string; list: AgentListKey; title?: string }
  /** AR-S4b — one server or skill of the profile, a page below the profile's;
   * AR-S4e — or below an agent's own list it was opened from */
  | {
      kind: "item";
      set: string;
      list: ExtensionKindKey;
      name: string;
      from?: { provider: string; list: AgentListKey; title?: string };
    }
  /** AR-S4e — one plugin an agent holds, a page below the agent's list;
   * AR-S4e2 — or one its catalogs list, opened from Browse (`from`), the
   * installed plugin's page once the agent holds it */
  | {
      kind: "plugin";
      set: string;
      provider: string;
      id: string;
      name: string;
      listTitle?: string;
      from?: "browse";
      market?: string;
    }
  /** AR-S4e2 — the agent's catalogs (pass 23's B1), a page below its list */
  | { kind: "browse"; set: string; provider: string; listTitle?: string; market?: string }
  /** AR-S4d — Add server (AR-S4d2 — Add skill): one kept once for the profile, a page below the profile's */
  | { kind: "add"; set: string; list: ExtensionKindKey }
  | { kind: "new" };

export function ProfilesSection({
  platform = "other",
  feed,
  route,
  onRoute,
  onLeave,
  onSubpage,
  onOpenApp,
  now: pinnedNow,
}: {
  platform?: ShellPlatform;
  /** the profiles feed, held by the Settings panel; null until it answers */
  feed: AgentsProfileSetsListResult | null;
  route: ProfilesRoute;
  onRoute: (route: ProfilesRoute) => void;
  /** leave the profiles (a deleted profile's page has nowhere to be) */
  onLeave: () => void;
  onSubpage: (subpage: SettingsSubpage | null) => void;
  onOpenApp: (provider: string) => void;
  now?: Date | undefined;
}): ReactElement | null {
  const client = useFielddClient();
  const usageFeed = useSubscription<unknown>("agents.usage.subscribe", {});
  const [providers, setProviders] = useState<AgentProviderSummary[]>([]);
  const [installs, setInstalls] = useState<AgentInstall[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<AgentsNotice | null>(null);
  const [now, setNow] = useState(() => pinnedNow ?? new Date());
  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const [refreshedUsage, setRefreshedUsage] = useState<AgentAccountUsageBatch | null>(null);
  const mounted = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  // acts in flight, by key: a second press of the same act does nothing
  const inFlight = useRef(new Set<string>());
  // the profiles and sign-ins the feed has shown: only one that WAS there and
  // went away closes its page (a profile just made is not in the feed yet)
  const seen = useRef(new Set<string>());
  // a route change this page made itself keeps the notice it just set
  const keepNotice = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // What the pages join: labels and installs, read once (the inventory fieldd
  // holds answers at once; the Agents page is where it is read again).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      client.request("agent.providers", {}).then((r) => AgentProvidersResult.parse(r).providers),
      client.request("agents.installs", {}).then((r) => AgentsInstallsResult.parse(r).installs),
    ]).then(
      ([labels, inventory]) => {
        if (cancelled) return;
        setProviders(labels);
        setInstalls(inventory);
      },
      (cause: unknown) => {
        if (!cancelled) {
          setNotice({ tone: "error", text: refusalSentence("The agents couldn't be read", cause) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  // A minute's clock for the usage lines' "now" (the catalog pins it).
  useEffect(() => {
    if (pinnedNow !== undefined) return;
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, [pinnedNow]);

  const usage = useMemo(() => {
    const parsed = AgentAccountUsageBatch.safeParse(usageFeed.data);
    // The reply can beat the subscription frame; a later frame takes over.
    if (
      refreshedUsage !== null &&
      (!parsed.success ||
        Date.parse(refreshedUsage.generatedAt) > Date.parse(parsed.data.generatedAt))
    ) {
      return refreshedUsage.entries;
    }
    return parsed.success ? parsed.data.entries : [];
  }, [usageFeed.data, refreshedUsage]);

  const context = useMemo(
    () => ({
      providers,
      installs,
      usage,
      signIn: feed?.signIn ?? [],
      identity: feed?.identity ?? [],
      signOut: feed?.signOut ?? [],
      reading: feed?.reading ?? false,
      sets: feed?.sets ?? [],
      routes: feed?.routes ?? {},
    }),
    [providers, installs, usage, feed],
  );

  const set: AgentProfileSet | undefined =
    route.kind === "new" ? undefined : feed?.sets.find((candidate) => candidate.id === route.set);
  const page = set === undefined ? undefined : profilePage(set, context);
  // the agent a page is about: its own page, one of its lists, or a plugin on one
  const provider =
    route.kind === "agent" ||
    route.kind === "list" ||
    route.kind === "plugin" ||
    route.kind === "browse"
      ? route.provider
      : undefined;
  const persona =
    provider !== undefined && set !== undefined
      ? set.personas.find((candidate) => candidate.provider === provider)
      : undefined;
  const row = persona === undefined ? undefined : agentRow(context, persona);

  // The header: a page below the profile's names itself and its profile, with the way back.
  const backToProfile = useCallback((): void => {
    if (route.kind !== "new") onRoute({ kind: "profile", set: route.set });
  }, [route, onRoute]);
  const backToAgent = useCallback((): void => {
    if (route.kind === "list") {
      onRoute({ kind: "agent", set: route.set, provider: route.provider });
    }
  }, [route, onRoute]);
  // AR-S4e — a plugin's page, and a server's or skill's opened from an agent's list, go back to that list
  const backToList = useCallback((): void => {
    if (route.kind === "plugin" && route.from === "browse") {
      // AR-S4e2 — a plugin opened from Browse goes back to Browse
      onRoute({
        kind: "browse",
        set: route.set,
        provider: route.provider,
        ...(route.listTitle !== undefined ? { listTitle: route.listTitle } : {}),
        ...(route.market !== undefined ? { market: route.market } : {}),
      });
    } else if (route.kind === "plugin" || route.kind === "browse") {
      onRoute({
        kind: "list",
        set: route.set,
        provider: route.provider,
        list: "plugins",
        ...(route.listTitle !== undefined ? { title: route.listTitle } : {}),
      });
    } else if (route.kind === "item" && route.from !== undefined) {
      onRoute({
        kind: "list",
        set: route.set,
        provider: route.from.provider,
        list: route.from.list,
        ...(route.from.title !== undefined ? { title: route.from.title } : {}),
      });
    }
  }, [route, onRoute]);
  const subpageKey =
    set === undefined
      ? null
      : route.kind === "agent" && row !== undefined
        ? `agent|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${row.label}`
        : route.kind === "list" && row !== undefined
          ? `list|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${row.label}|${route.list}|${route.title ?? ""}`
          : route.kind === "item"
            ? `item|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${route.list}|${route.name}|${route.from?.provider ?? ""}`
            : route.kind === "add"
              ? `add|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${route.list}`
              : route.kind === "plugin" && row !== undefined
                ? `plugin|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${row.label}|${route.id}|${route.name}|${route.from ?? ""}`
                : route.kind === "browse" && row !== undefined
                  ? `browse|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${row.label}|${route.listTitle ?? ""}`
                  : null;
  // keyed by what the header shows: a feed frame that changes nothing on it does not rebuild it
  useEffect(() => {
    if (set === undefined) {
      onSubpage(null);
    } else if (route.kind === "agent" && row !== undefined) {
      onSubpage(profileAgentSubpage(set, row.label, backToProfile));
    } else if (route.kind === "list" && row !== undefined) {
      onSubpage(agentListSubpage(set, row.label, route.list, backToAgent, route.title));
    } else if (route.kind === "item") {
      onSubpage(
        extensionItemSubpage(
          set,
          route.list,
          route.name,
          route.from !== undefined ? backToList : backToProfile,
        ),
      );
    } else if (route.kind === "plugin" && row !== undefined) {
      const listTitle = route.listTitle ?? "Plugins";
      onSubpage(
        pluginSubpage(
          set,
          row.label,
          route.name,
          route.from === "browse" ? `Browse ${listTitle.toLowerCase()}` : listTitle,
          backToList,
        ),
      );
    } else if (route.kind === "browse" && row !== undefined) {
      const listTitle = route.listTitle ?? "Plugins";
      onSubpage(
        browseSubpage(set, row.label, `Browse ${listTitle.toLowerCase()}`, listTitle, backToList),
      );
    } else if (route.kind === "add") {
      onSubpage(
        route.list === "skills"
          ? addSkillSubpage(set, backToProfile)
          : addServerSubpage(set, backToProfile),
      );
    } else {
      onSubpage(null);
    }
  }, [subpageKey, onSubpage, backToProfile, backToAgent, backToList]);
  useEffect(() => () => onSubpage(null), [onSubpage]);

  // A page whose profile (or sign-in) went away closes to where it lived —
  // only once it has been seen: a profile just made is a frame away.
  useEffect(() => {
    if (feed === null) return;
    for (const candidate of feed.sets) {
      seen.current.add(candidate.id);
      for (const member of candidate.personas)
        seen.current.add(`${candidate.id}:${member.provider}`);
    }
    if (route.kind === "new") return;
    if (set === undefined) {
      if (seen.current.has(route.set)) onLeave();
      return;
    }
    if (
      (route.kind === "agent" ||
        route.kind === "list" ||
        route.kind === "plugin" ||
        route.kind === "browse") &&
      persona === undefined &&
      seen.current.has(`${route.set}:${route.provider}`)
    ) {
      onRoute({ kind: "profile", set: route.set });
    }
  }, [feed, route, set, persona, onLeave, onRoute]);

  // Focus follows the page: its title when it opens. A plain visit clears the
  // last page's notice; a move this page made itself keeps the one it set.
  const routeKey =
    route.kind === "new"
      ? "new"
      : route.kind === "item"
        ? `item:${route.set}:${route.list}:${route.name}`
        : route.kind === "add"
          ? `add:${route.set}:${route.list}`
          : route.kind === "plugin"
            ? `plugin:${route.set}:${route.provider}:${route.id}`
            : route.kind === "browse"
              ? `browse:${route.set}:${route.provider}`
              : `${route.kind}:${route.set}:${"provider" in route ? route.provider : ""}${
                  route.kind === "list" ? `:${route.list}` : ""
                }`;
  const currentRoute = useRef(routeKey);
  currentRoute.current = routeKey;
  // what each page reads usage for: an agent's own, a profile's every agent;
  // the Extensions pages show no usage
  const usageProfileIds =
    route.kind === "list" ||
    route.kind === "item" ||
    route.kind === "add" ||
    route.kind === "plugin" ||
    route.kind === "browse"
      ? []
      : route.kind === "agent"
        ? persona === undefined
          ? []
          : [persona.profileId]
        : (set?.personas.map((item) => item.profileId) ?? []);
  const usagePageKey =
    usageProfileIds.length === 0 ? null : JSON.stringify([routeKey, usageProfileIds]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-agents-page-title]")?.focus();
    if (keepNotice.current) keepNotice.current = false;
    else setNotice(null);
  }, [routeKey]);

  async function refreshUsage(feedback = true): Promise<void> {
    if (set === undefined || inFlight.current.has("usage")) return;
    const profileIds = usageProfileIds;
    if (profileIds.length === 0) return;
    inFlight.current.add("usage");
    setRefreshingUsage(true);
    if (feedback) setNotice(null);
    try {
      // This Mac's plan cards come from identities, independently of usage.
      // A failed boot-time identity read must be retried too, or a working
      // meter has no plan card to belong to. The daemon coalesces these reads
      // and publishes each recovered identity through the profiles feed.
      const [usageResult, identitiesResult] = await Promise.allSettled([
        client.request("agents.usage", { refresh: true, profileIds }),
        set.kind === "native"
          ? client.request("agents.profileSets.list", { refresh: true })
          : Promise.resolve(),
      ]);
      if (usageResult.status === "rejected") throw usageResult.reason;
      const batch = AgentAccountUsageBatch.parse(usageResult.value);
      if (!mounted.current) return;
      setRefreshedUsage(batch);
      setNow(pinnedNow ?? new Date());
      if (!feedback || currentRoute.current !== routeKey) return;
      if (identitiesResult.status === "rejected") {
        setNotice({
          tone: "error",
          text: refusalSentence("Sign-ins couldn't be refreshed", identitiesResult.reason),
        });
        return;
      }
      const entries = batch.entries.filter(
        (entry) => entry.profileId !== undefined && profileIds.includes(entry.profileId),
      );
      const failures = entries.filter(
        (entry) => entry.state !== "available" && entry.state !== "unsupported",
      );
      setNotice(
        failures.length > 0
          ? {
              tone: "error",
              text: failures
                .map((entry) => {
                  const retryAt = entry.retryAt === undefined ? NaN : Date.parse(entry.retryAt);
                  const retry = Number.isFinite(retryAt)
                    ? ` Retry after ${new Date(retryAt).toLocaleTimeString()}.`
                    : "";
                  return `${entry.label}: ${entry.message ?? "Usage couldn't be refreshed."}${retry}`;
                })
                .join(" "),
            }
          : {
              tone: "neutral",
              text: entries.some((entry) => entry.state === "available")
                ? "Usage checked. Readings from the last 30 seconds are reused."
                : "Usage isn't reported for these sign-ins.",
            },
      );
    } catch (cause) {
      if (feedback && mounted.current && currentRoute.current === routeKey) {
        setNotice({ tone: "error", text: refusalSentence("Usage couldn't be refreshed", cause) });
      }
    } finally {
      inFlight.current.delete("usage");
      if (mounted.current) setRefreshingUsage(false);
    }
  }

  const refreshUsageRef = useRef(refreshUsage);
  refreshUsageRef.current = refreshUsage;
  // A route may open before its feed arrives, or while the previous route is
  // still refreshing. Keep that opening pending until its own accounts can be read.
  const pendingUsagePage = useRef<string | null>(null);
  useEffect(() => {
    pendingUsagePage.current = usagePageKey;
  }, [usagePageKey]);
  useEffect(() => {
    if (usagePageKey === null || pendingUsagePage.current !== usagePageKey || refreshingUsage)
      return;
    pendingUsagePage.current = null;
    void refreshUsageRef.current(false);
  }, [usagePageKey, refreshingUsage]);

  useEffect(() => {
    let away = document.hidden || !document.hasFocus();
    const resume = (): void => {
      if (!away || document.hidden) return;
      away = false;
      void refreshUsageRef.current(false);
    };
    const onBlur = (event: FocusEvent): void => {
      if (event.target === event.currentTarget) away = true;
    };
    const onFocus = (event: FocusEvent): void => {
      if (event.target === event.currentTarget) resume();
    };
    const onVisibility = (): void => {
      if (document.hidden) away = true;
      else resume();
    };
    // App switches emit window focus; minimizing or changing Spaces may also
    // change visibility. Treat the pair as one return, not two refreshes.
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const labelOf = (provider: string): string =>
    providers.find((p) => p.id === provider)?.label ?? provider;
  const revealLabel = platform === "darwin" ? "Show in Finder" : "Show in folder";

  /** Run one act; a refusal is said in the act's own words. The busy mark is
   * the act's own: another act finishing never clears it. */
  const act = async <T,>(
    key: string,
    failure: string,
    run: () => Promise<T>,
  ): Promise<T | null> => {
    if (inFlight.current.has(key)) return null;
    inFlight.current.add(key);
    setBusy(key);
    setNotice(null);
    try {
      return await run();
    } catch (cause) {
      if (mounted.current) setNotice({ tone: "error", text: refusalSentence(failure, cause) });
      return null;
    } finally {
      inFlight.current.delete(key);
      if (mounted.current) setBusy((current) => (current === key ? null : current));
    }
  };

  const {
    signIn,
    signInRef,
    cancelling,
    start: startSignIn,
    cancel: cancelSignIn,
  } = useProfileSignIn<"profile" | "agent">({
    client,
    feed,
    act,
    labelOf,
    mounted,
    onNotice: setNotice,
    onEnd: (done, end) => {
      const said = signInEndNotice(end, labelOf(done.provider));
      if (said !== null) setNotice(said);
    },
  });

  const add = async (provider: string): Promise<void> => {
    if (set === undefined) return;
    if (set.kind === "native") {
      // This Mac: the agent's own folder, signed in with its own login
      const own = set.personas.find((candidate) => candidate.provider === provider);
      if (own !== undefined) await startSignIn(own.profileId, provider, set.id, "profile", false);
      return;
    }
    if (signInRef.current !== null) {
      setNotice({
        tone: "attention",
        text: `Finish or cancel the sign-in to ${labelOf(signInRef.current.provider)} first.`,
      });
      return;
    }
    const made = await act(`add:${provider}`, `Couldn't add ${labelOf(provider)}`, async () =>
      AgentsProfilesCreateResult.parse(
        await client.request("agents.profiles.create", { set: set.id, provider }),
      ),
    );
    if (made !== null) await startSignIn(made.persona.profileId, provider, set.id, "profile", true);
  };

  /** A sign-in this page does not show (opened elsewhere, or before the page
   * was left): its row ends it by the pane the feed names. */
  const cancelFromRow = (provider: string): void => {
    const target = set?.personas.find((candidate) => candidate.provider === provider);
    const sessionId = target?.signingIn?.sessionId;
    if (sessionId === undefined) return;
    void act(`cancel:${provider}`, "Couldn't cancel the sign-in", () =>
      client.request("terminal.terminate", { sessionId }),
    );
  };
  const heldProvider =
    signIn !== null && set !== undefined && signIn.set === set.id ? signIn.provider : null;

  const update = async (key: string, params: Record<string, unknown>): Promise<boolean> => {
    if (set === undefined) return false;
    const done = await act(key, `Couldn't change ${set.label}`, async () =>
      AgentsProfileSetsSetResult.parse(
        await client.request("agents.profileSets.update", { set: set.id, ...params }),
      ),
    );
    return done !== null;
  };

  const remove = async (): Promise<void> => {
    if (set === undefined) return;
    const label = set.label;
    const done = await act("delete", `Couldn't delete ${label}`, async () =>
      AgentsProfileSetsDeleteResult.parse(
        await client.request("agents.profileSets.delete", { set: set.id }),
      ),
    );
    if (done !== null && mounted.current) onLeave();
  };

  const reveal = async (provider?: string): Promise<void> => {
    if (set === undefined) return;
    await act("reveal", "Couldn't show the folder", async () =>
      AgentsProfileSetsRevealResult.parse(
        await client.request("agents.profileSets.reveal", {
          set: set.id,
          ...(provider !== undefined ? { provider } : {}),
        }),
      ),
    );
  };

  const signOut = async (): Promise<void> => {
    if (set === undefined || persona === undefined) return;
    const label = labelOf(persona.provider);
    const done = await act("signout", `Couldn't sign out of ${label}`, async () =>
      AgentsProfilesDeleteResult.parse(
        await client.request("agents.profiles.delete", { profileId: persona.profileId }),
      ),
    );
    if (done === null || !mounted.current) return;
    keepNotice.current = true;
    onRoute({ kind: "profile", set: set.id });
    setNotice({ tone: "neutral", text: signedOutWords(done, label, set) });
  };

  const create = async (profile: {
    label: string;
    glyph: string;
    isDefault: boolean;
  }): Promise<void> => {
    const made = await act("create", "Couldn't make the profile", async () =>
      AgentsProfileSetsSetResult.parse(
        await client.request("agents.profileSets.create", {
          label: profile.label,
          glyph: profile.glyph,
          ...(profile.isDefault ? { default: true } : {}),
        }),
      ),
    );
    if (made !== null && mounted.current) onRoute({ kind: "profile", set: made.set.id });
  };

  const card = (at: "profile" | "agent") => {
    if (signIn === null || set === undefined || signIn.set !== set.id || signIn.at !== at)
      return null;
    if (at === "agent" && route.kind === "agent" && signIn.provider !== route.provider) return null;
    const label = labelOf(signIn.provider);
    return (
      <SignInCard
        agentLabel={label}
        where={set.label}
        note={signInNote(set, label)}
        cancelling={cancelling}
        onCancel={() => void cancelSignIn()}
      >
        <SignInTerminal terminal={signIn.terminal} platform={platform} />
      </SignInCard>
    );
  };

  // one sign-in at a time: while one runs, nothing else starts another
  const signInBusy = signIn !== null ? `add:${signIn.provider}` : null;
  // AR-S4d2 — the other profiles and their agents: who a skill's move to the shared folder reaches
  const otherProfilesOf = (setId: string): Array<{ profile: string; providers: string[] }> =>
    (feed?.sets ?? [])
      .filter((candidate) => candidate.id !== setId)
      .map((candidate) => ({
        profile: candidate.label,
        providers: candidate.personas.map((member) => member.provider),
      }));
  let body: ReactElement | null = null;
  if (route.kind === "new") {
    body = (
      <NewProfileView
        busy={busy === "create"}
        notice={notice}
        onCancel={onLeave}
        onCreate={(profile) => void create(profile)}
      />
    );
  } else if (route.kind === "agent" && set !== undefined && row !== undefined) {
    const install = installs.find(
      (candidate) => candidate.provider === row.provider && candidate.active,
    );
    body = (
      <ProfileAgentPageView
        // a different agent or profile is a different page: nothing armed carries over
        key={`${set.id}:${row.provider}`}
        set={set}
        row={row}
        refreshingUsage={refreshingUsage || (set.kind === "native" && context.reading)}
        onRefreshUsage={() => void refreshUsage()}
        appVersion={install?.version}
        canSignOut={set.kind === "managed" || context.signOut.includes(row.provider)}
        now={now}
        notice={notice}
        busy={busy ?? signInBusy}
        signIn={card("agent")}
        revealLabel={revealLabel}
        onSignIn={() =>
          void startSignIn(row.persona.profileId, row.provider, set.id, "agent", false)
        }
        onCancelSignIn={
          heldProvider === row.provider ? undefined : () => cancelFromRow(row.provider)
        }
        onReveal={() => void reveal(row.provider)}
        onSignOut={() => void signOut()}
        onOpenApp={() => onOpenApp(row.provider)}
        plans={page?.plans}
        routes={context.routes[row.provider]}
        onAddSignIn={(signInRoute) =>
          void startSignIn(row.persona.profileId, row.provider, set.id, "agent", false, signInRoute)
        }
        extensions={
          // AR-S4b — pass 23's three rows, each opening the agent's own list
          <AgentExtensions
            set={set.id}
            provider={row.provider}
            onOpen={(list, title) =>
              onRoute({ kind: "list", set: set.id, provider: row.provider, list, title })
            }
          />
        }
      />
    );
  } else if (route.kind === "list" && set !== undefined && row !== undefined) {
    body = (
      <AgentExtensionList
        key={`${set.id}:${row.provider}:${route.list}`}
        set={set.id}
        provider={row.provider}
        agent={row.label}
        list={route.list}
        profile={set.label}
        where={inOnWords(set)}
        onOpenProfile={() => onRoute({ kind: "profile", set: set.id })}
        {...(route.list === "plugins"
          ? {
              // AR-S4e2 — the agent's catalogs, or one marketplace's part of them
              onBrowse: (market?: string) =>
                onRoute({
                  kind: "browse",
                  set: set.id,
                  provider: row.provider,
                  ...(route.title !== undefined ? { listTitle: route.title } : {}),
                  ...(market !== undefined ? { market } : {}),
                }),
            }
          : {})}
        onOpen={(open) =>
          onRoute(
            open.kind === "plugin"
              ? {
                  kind: "plugin",
                  set: set.id,
                  provider: row.provider,
                  id: open.id,
                  name: open.name,
                  ...(route.title !== undefined ? { listTitle: route.title } : {}),
                }
              : {
                  kind: "item",
                  set: set.id,
                  list: open.list,
                  name: open.name,
                  from: {
                    provider: row.provider,
                    list: route.list,
                    ...(route.title !== undefined ? { title: route.title } : {}),
                  },
                },
          )
        }
      />
    );
  } else if (route.kind === "plugin" && set !== undefined && row !== undefined) {
    body =
      route.from === "browse" ? (
        // AR-S4e2 — listed until the agent holds it, then the installed plugin's page
        <AgentListedPlugin
          key={`${set.id}:${row.provider}:${route.id}:listed`}
          set={set.id}
          provider={row.provider}
          id={route.id}
          name={route.name}
          where={inOnWords(set)}
        />
      ) : (
        <AgentPlugin
          key={`${set.id}:${row.provider}:${route.id}`}
          set={set.id}
          provider={row.provider}
          id={route.id}
          name={route.name}
          where={inOnWords(set)}
        />
      );
  } else if (route.kind === "browse" && set !== undefined && row !== undefined) {
    body = (
      <AgentBrowse
        key={`${set.id}:${row.provider}:browse`}
        set={set.id}
        provider={row.provider}
        where={inOnWords(set)}
        {...(route.market !== undefined ? { market: route.market } : {})}
        onOpen={(plugin) =>
          onRoute({
            kind: "plugin",
            set: set.id,
            provider: row.provider,
            // one it holds opens the installed plugin's page, by its id on the agent's list
            id: plugin.held ?? plugin.id,
            name: plugin.name,
            from: "browse",
            ...(route.listTitle !== undefined ? { listTitle: route.listTitle } : {}),
            ...(route.market !== undefined ? { market: route.market } : {}),
          })
        }
      />
    );
  } else if (route.kind === "item" && set !== undefined) {
    body = (
      <ExtensionItem
        key={`${set.id}:${route.list}:${route.name}`}
        set={set.id}
        list={route.list}
        name={route.name}
        where={inOnWords(set)}
        otherProfiles={otherProfilesOf(set.id)}
      />
    );
  } else if (route.kind === "add" && set !== undefined) {
    body =
      route.list === "skills" ? (
        <AddSkill
          key={`${set.id}:add-skill`}
          set={set.id}
          profile={set.label}
          where={inOnWords(set)}
          onDone={(name) => onRoute({ kind: "item", set: set.id, list: "skills", name })}
          onCancel={() => onRoute({ kind: "profile", set: set.id })}
        />
      ) : (
        <AddServer
          key={`${set.id}:add`}
          set={set.id}
          profile={set.label}
          where={inOnWords(set)}
          onDone={(name) => onRoute({ kind: "item", set: set.id, list: "servers", name })}
          onCancel={() => onRoute({ kind: "profile", set: set.id })}
        />
      );
  } else if (page !== undefined) {
    body = (
      <ProfilePageView
        key={page.set.id}
        page={page}
        refreshingUsage={refreshingUsage || (page.set.kind === "native" && context.reading)}
        onRefreshUsage={() => void refreshUsage()}
        now={now}
        notice={notice}
        busy={busy ?? signInBusy}
        signIn={card("profile")}
        extensions={
          // AR-S4b — read when the page opens (a profile with no agent has nothing to read)
          page.rows.length > 0 ? (
            <ProfileExtensions
              set={page.set.id}
              profile={page.set.label}
              where={inOnWords(page.set)}
              onOpenItem={(list, name) => onRoute({ kind: "item", set: page.set.id, list, name })}
              onAddServer={() => onRoute({ kind: "add", set: page.set.id, list: "servers" })}
              onAddSkill={() => onRoute({ kind: "add", set: page.set.id, list: "skills" })}
              otherProfiles={otherProfilesOf(page.set.id)}
            />
          ) : undefined
        }
        revealLabel={revealLabel}
        onAdd={(provider) => void add(provider)}
        onOpenAgent={(provider) => onRoute({ kind: "agent", set: page.set.id, provider })}
        onSignIn={(provider) => {
          const target = page.set.personas.find((candidate) => candidate.provider === provider);
          if (target !== undefined) {
            void startSignIn(target.profileId, provider, page.set.id, "profile", false);
          }
        }}
        onCancelSignIn={(provider) => {
          if (provider !== heldProvider) cancelFromRow(provider);
        }}
        onRename={(label) => update("name", { label })}
        onGlyph={(glyph) => void update("glyph", { glyph })}
        onMakeDefault={() => void update("default", { default: true })}
        onReveal={() => void reveal()}
        onDelete={() => void remove()}
        onNewProfile={
          // AO-5 — This Mac explains itself while it is the only profile
          page.set.kind === "native" && context.sets.every((other) => other.kind === "native")
            ? () => onRoute({ kind: "new" })
            : undefined
        }
        onPlanAct={(card) => {
          // a card's act is its agent's own login, in this profile's folder
          const target = page.set.personas.find(
            (candidate) => candidate.provider === card.act?.provider,
          );
          if (target !== undefined) {
            void startSignIn(target.profileId, target.provider, page.set.id, "profile", false);
          }
        }}
      />
    );
  }
  return (
    <div ref={root} className="vf-agents-section vf-profiles-section">
      {body}
    </div>
  );
}

/** What a sign-out did, in words: it waits for its sessions, and what it
 * does to the credential is what the agent itself has said. */
function signedOutWords(
  done: { deleted: boolean; waiting?: number | undefined; credential?: string | undefined },
  label: string,
  set: AgentProfileSet,
): string {
  const where = set.kind === "native" ? `on ${set.label}` : `in ${set.label}`;
  const waiting = done.waiting ?? 0;
  const first =
    waiting > 0
      ? `Signed out of ${label} ${where}. The ${plural(waiting, "session")} running under it keep going; its folder goes when they end.`
      : `Signed out of ${label} ${where}.`;
  return done.credential === "unknown" && set.kind === "managed"
    ? `${first} ${label} doesn't say where it keeps its sign-in, so only its folder is removed.`
    : first;
}
