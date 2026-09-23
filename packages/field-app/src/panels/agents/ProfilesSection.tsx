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
  AgentsProfilesLoginResult,
  type ShellPlatform,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refusalSentence } from "../../account/use-account";
import type { SettingsSubpage } from "../SettingsDialog";
import type { AgentsNotice } from "./AgentsView";
import {
  NewProfileView,
  ProfileAgentPageView,
  ProfilePageView,
  profileAgentSubpage,
  SignInCard,
} from "./ProfilesView";
import { agentRow, plural, profilePage, signInNote } from "./profiles-model";
import { SignInTerminal } from "./SignInTerminal";

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
// A sign-in runs in a terminal on the page that asked for it. It closes when
// the feed stops saying the persona is signing in (fieldd verified it from the
// provider's own status surface when the pane ended). Cancel ends the pane; a
// sign-in the Add menu created and nobody finished is removed again, so a
// cancelled add adds nothing.

export type ProfilesRoute =
  | { kind: "profile"; set: string }
  | { kind: "agent"; set: string; provider: string }
  | { kind: "new" };

interface SignIn {
  profileId: string;
  provider: string;
  set: string;
  /** the page the terminal shows on */
  at: "profile" | "agent";
  terminal: TerminalCreateOpenResult;
  /** made by the Add menu just now: cancelled unfinished, it is removed again */
  fresh: boolean;
  cancelled: boolean;
  /** the feed has said it is signing in (so its disappearance means done) */
  seen: boolean;
  /** when the login was asked for: an identity read after it also means done
   * (a login quick enough to end inside one feed frame is never seen) */
  startedAt: number;
}

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
  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => pinnedNow ?? new Date());
  const mounted = useRef(true);
  const root = useRef<HTMLDivElement>(null);

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
    return parsed.success ? parsed.data.entries : [];
  }, [usageFeed.data]);

  const context = useMemo(
    () => ({
      providers,
      installs,
      usage,
      signIn: feed?.signIn ?? [],
      signOut: feed?.signOut ?? [],
      reading: feed?.reading ?? false,
    }),
    [providers, installs, usage, feed],
  );

  const set: AgentProfileSet | undefined =
    route.kind === "new" ? undefined : feed?.sets.find((candidate) => candidate.id === route.set);
  const page = set === undefined ? undefined : profilePage(set, context);
  const persona =
    route.kind === "agent" && set !== undefined
      ? set.personas.find((candidate) => candidate.provider === route.provider)
      : undefined;
  const row = persona === undefined ? undefined : agentRow(context, persona);

  // The header: an agent's page names the agent and its profile, with the way back.
  const backToProfile = useCallback((): void => {
    if (route.kind === "agent") onRoute({ kind: "profile", set: route.set });
  }, [route, onRoute]);
  const subpageKey =
    route.kind === "agent" && set !== undefined && row !== undefined
      ? `${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${row.label}`
      : null;
  // keyed by what the header shows: a feed frame that changes nothing on it does not rebuild it
  useEffect(() => {
    onSubpage(
      route.kind === "agent" && set !== undefined && row !== undefined
        ? profileAgentSubpage(set, row.label, backToProfile)
        : null,
    );
  }, [subpageKey, onSubpage, backToProfile]);
  useEffect(() => () => onSubpage(null), [onSubpage]);

  // A page whose profile (or sign-in) went away closes to where it lived.
  useEffect(() => {
    if (feed === null) return;
    if (route.kind === "profile" && set === undefined) onLeave();
    if (route.kind === "agent" && set === undefined) onLeave();
    if (route.kind === "agent" && set !== undefined && persona === undefined) {
      onRoute({ kind: "profile", set: route.set });
    }
  }, [feed, route, set, persona, onLeave, onRoute]);

  // Focus follows the page: its title when it opens.
  const routeKey =
    route.kind === "new"
      ? "new"
      : `${route.kind}:${route.set}:${"provider" in route ? route.provider : ""}`;
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-agents-page-title]")?.focus();
    setNotice(null);
  }, [routeKey]);

  // The sign-in closes when the feed stops saying the persona is signing in.
  useEffect(() => {
    if (signIn === null || feed === null) return;
    const current = feed.sets
      .flatMap((candidate) => candidate.personas)
      .find((candidate) => candidate.profileId === signIn.profileId);
    if (current?.signingIn !== undefined) {
      if (!signIn.seen) setSignIn({ ...signIn, seen: true });
      return;
    }
    const readSince =
      current?.identity !== undefined &&
      Date.parse(current.identity.verifiedAt) >= signIn.startedAt;
    // the feed's first frame about this login is a tick away
    if (!signIn.seen && !readSince) return;
    const done = signIn;
    setSignIn(null);
    setCancelling(false);
    const label = providers.find((p) => p.id === done.provider)?.label ?? done.provider;
    if (current?.identity?.loggedIn === true) {
      setNotice({ tone: "neutral", text: `Signed in to ${label}.` });
      return;
    }
    if (done.fresh && done.cancelled) {
      // a cancelled add adds nothing: the empty sign-in goes again
      void client.request("agents.profiles.delete", { profileId: done.profileId }).catch(() => {
        // it stays, not signed in, and its row says so
      });
      return;
    }
    if (current !== undefined) {
      setNotice({
        tone: "attention",
        text: `The sign-in ended before ${label} said who is signed in. Sign in again when you're ready.`,
      });
    }
  }, [feed, signIn, client, providers]);

  const labelOf = (provider: string): string =>
    providers.find((p) => p.id === provider)?.label ?? provider;
  const revealLabel = platform === "darwin" ? "Show in Finder" : "Show in folder";

  /** Run one act; a refusal is said in the act's own words. */
  const act = async <T,>(
    key: string,
    failure: string,
    run: () => Promise<T>,
  ): Promise<T | null> => {
    setBusy(key);
    setNotice(null);
    try {
      return await run();
    } catch (cause) {
      if (mounted.current) setNotice({ tone: "error", text: refusalSentence(failure, cause) });
      return null;
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const startSignIn = async (
    profileId: string,
    provider: string,
    setId: string,
    at: "profile" | "agent",
    fresh: boolean,
  ): Promise<void> => {
    const answer = await act(
      `add:${provider}`,
      `Couldn't start ${labelOf(provider)}'s sign-in`,
      async () =>
        AgentsProfilesLoginResult.parse(
          await client.request("agents.profiles.login", { profileId }),
        ),
    );
    if (answer === null) {
      if (fresh)
        void client.request("agents.profiles.delete", { profileId }).catch(() => undefined);
      return;
    }
    if (!mounted.current) return;
    setSignIn({
      profileId,
      provider,
      set: setId,
      at,
      terminal: answer.terminal,
      fresh,
      cancelled: false,
      seen: false,
      startedAt: Date.now(),
    });
  };

  const add = async (provider: string): Promise<void> => {
    if (set === undefined) return;
    if (set.kind === "native") {
      // This Mac: the agent's own folder, signed in with its own login
      const own = set.personas.find((candidate) => candidate.provider === provider);
      if (own !== undefined) await startSignIn(own.profileId, provider, set.id, "profile", false);
      return;
    }
    const made = await act(`add:${provider}`, `Couldn't add ${labelOf(provider)}`, async () =>
      AgentsProfilesCreateResult.parse(
        await client.request("agents.profiles.create", { set: set.id, provider }),
      ),
    );
    if (made !== null) await startSignIn(made.persona.profileId, provider, set.id, "profile", true);
  };

  const cancelSignIn = async (): Promise<void> => {
    if (signIn === null) return;
    setCancelling(true);
    setSignIn({ ...signIn, cancelled: true });
    try {
      await client.request("terminal.terminate", { sessionId: signIn.terminal.sessionId });
    } catch (cause) {
      if (mounted.current) {
        setCancelling(false);
        setNotice({ tone: "error", text: refusalSentence("Couldn't cancel the sign-in", cause) });
      }
    }
  };

  const update = async (key: string, params: Record<string, unknown>): Promise<void> => {
    if (set === undefined) return;
    await act(key, `Couldn't change ${set.label}`, async () =>
      AgentsProfileSetsSetResult.parse(
        await client.request("agents.profileSets.update", { set: set.id, ...params }),
      ),
    );
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
    onRoute({ kind: "profile", set: set.id });
    const waiting = done.waiting ?? 0;
    setNotice({
      tone: "neutral",
      text:
        waiting > 0
          ? `Signed out of ${label} in ${set.label}. The ${plural(waiting, "session")} running under it keep going; its folder goes when they end.`
          : set.kind === "native"
            ? `Signed out of ${label} on ${set.label}.`
            : `Signed out of ${label} in ${set.label}.`,
    });
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
        set={set}
        row={row}
        appVersion={install?.version}
        canSignOut={set.kind === "managed" || context.signOut.includes(row.provider)}
        now={now}
        notice={notice}
        busy={busy}
        signIn={card("agent")}
        revealLabel={revealLabel}
        onSignIn={() =>
          void startSignIn(row.persona.profileId, row.provider, set.id, "agent", false)
        }
        onReveal={() => void reveal(row.provider)}
        onSignOut={() => void signOut()}
        onOpenApp={() => onOpenApp(row.provider)}
      />
    );
  } else if (page !== undefined) {
    body = (
      <ProfilePageView
        page={page}
        now={now}
        notice={notice}
        busy={busy ?? (signIn !== null ? `add:${signIn.provider}` : null)}
        signIn={card("profile")}
        revealLabel={revealLabel}
        onAdd={(provider) => void add(provider)}
        onOpenAgent={(provider) => onRoute({ kind: "agent", set: page.set.id, provider })}
        onSignIn={(provider) => {
          const target = page.set.personas.find((candidate) => candidate.provider === provider);
          if (target !== undefined) {
            void startSignIn(target.profileId, provider, page.set.id, "profile", false);
          }
        }}
        onRename={(label) => void update("name", { label })}
        onGlyph={(glyph) => void update("glyph", { glyph })}
        onMakeDefault={() => void update("default", { default: true })}
        onReveal={() => void reveal()}
        onDelete={() => void remove()}
      />
    );
  }
  return (
    <div ref={root} className="vf-agents-section vf-profiles-section">
      {body}
    </div>
  );
}
