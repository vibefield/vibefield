import {
  AgentAccountUsageBatch,
  type AgentInstall,
  type AgentPersona,
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
  AgentsProfilesListResult,
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
  AgentExtensionList,
  AgentExtensions,
  ExtensionItem,
  ProfileExtensions,
} from "./ExtensionsSection";
import { agentListSubpage, extensionItemSubpage } from "./ExtensionsView";
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
// A sign-in runs in a terminal on the page that asked for it, one at a time.
// It closes when fieldd says its pane has ended — and, for an agent that says
// who signed in, once that has been read (fieldd reads it as the pane ends).
// Cancel ends the pane; a sign-in the Add menu created and nobody finished is
// removed again, so a cancelled add adds nothing. Leaving the page does NOT
// end it: a browser-based login can still finish, and the row it belongs to
// offers Cancel wherever it is shown next.
//
// AR-S4b — Extensions: below a profile's page, one server's or skill's own
// page (a list's row name opens it); below an agent's, its own plugins,
// servers or skills (its Extensions rows open them). Each reads the profile's
// lens itself (ExtensionsSection.tsx).

/** How long a closed sign-in waits for the identity read before it says so. */
const IDENTITY_WAIT_MS = 15_000;
/** How long before a login the feed never showed open is asked after directly
 * (one that ends inside a single feed frame is never seen open). */
const UNSEEN_CHECK_MS = 3_000;

export type ProfilesRoute =
  | { kind: "profile"; set: string }
  | { kind: "agent"; set: string; provider: string }
  /** AR-S4b — one agent's own plugins, servers or skills, a page below the agent's */
  | { kind: "list"; set: string; provider: string; list: AgentListKey }
  /** AR-S4b — one server or skill of the profile, a page below the profile's */
  | { kind: "item"; set: string; list: ExtensionKindKey; name: string }
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
  /** asked for at (before the request): an identity read after it is this login's */
  startedAt: number;
  /** the feed has shown this login open — until then a frame without it
   * says nothing (a sign-in just made, a frame read before the pane was) */
  seen: boolean;
  /** its pane has ended (the feed no longer names it) */
  ended: boolean;
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
  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const [refreshedUsage, setRefreshedUsage] = useState<AgentAccountUsageBatch | null>(null);
  const mounted = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  // acts in flight, by key: a second press of the same act does nothing
  const inFlight = useRef(new Set<string>());
  // the sign-in, as the acts see it between renders (one at a time)
  const signInRef = useRef<SignIn | null>(null);
  signInRef.current = signIn;
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
  // the agent a page is about: its own page, or one of its lists
  const provider = route.kind === "agent" || route.kind === "list" ? route.provider : undefined;
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
  const subpageKey =
    set === undefined
      ? null
      : route.kind === "agent" && row !== undefined
        ? `agent|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${row.label}`
        : route.kind === "list" && row !== undefined
          ? `list|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${row.label}|${route.list}`
          : route.kind === "item"
            ? `item|${set.id}|${set.label}|${set.glyph ?? ""}|${set.default}|${route.list}|${route.name}`
            : null;
  // keyed by what the header shows: a feed frame that changes nothing on it does not rebuild it
  useEffect(() => {
    if (set === undefined) {
      onSubpage(null);
    } else if (route.kind === "agent" && row !== undefined) {
      onSubpage(profileAgentSubpage(set, row.label, backToProfile));
    } else if (route.kind === "list" && row !== undefined) {
      onSubpage(agentListSubpage(set, row.label, route.list, backToAgent));
    } else if (route.kind === "item") {
      onSubpage(extensionItemSubpage(set, route.list, route.name, backToProfile));
    } else {
      onSubpage(null);
    }
  }, [subpageKey, onSubpage, backToProfile, backToAgent]);
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
      (route.kind === "agent" || route.kind === "list") &&
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
        : `${route.kind}:${route.set}:${"provider" in route ? route.provider : ""}${
            route.kind === "list" ? `:${route.list}` : ""
          }`;
  const currentRoute = useRef(routeKey);
  currentRoute.current = routeKey;
  // what each page reads usage for: an agent's own, a profile's every agent;
  // the Extensions pages show no usage
  const usageProfileIds =
    route.kind === "list" || route.kind === "item"
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

  // The sign-in closes when its pane has ended: at once for an agent that
  // never says who, and — for one that does — once fieldd has read who (it
  // reads as the pane ends), or after a wait that says it could not.
  useEffect(() => {
    if (signIn === null || feed === null) return;
    const current = feed.sets
      .flatMap((candidate) => candidate.personas)
      .find((candidate) => candidate.profileId === signIn.profileId);
    const open = current?.signingIn?.sessionId === signIn.terminal.sessionId;
    if (open) {
      if (!signIn.seen) setSignIn({ ...signIn, seen: true });
      return;
    }
    if (!signIn.seen) return;
    const readsIdentity = feed.identity.includes(signIn.provider);
    const readSince =
      current?.identity !== undefined &&
      Date.parse(current.identity.verifiedAt) >= signIn.startedAt;
    // a cancelled one has nothing to wait for
    if (readsIdentity && !readSince && current !== undefined && !signIn.cancelled) {
      if (!signIn.ended) setSignIn({ ...signIn, ended: true });
      return;
    }
    finishSignIn(signIn, current);
  });
  // a login the feed never showed open is asked after directly: gone means ended
  const unseen = signIn !== null && !signIn.seen ? signIn : null;
  useEffect(() => {
    if (unseen === null) return;
    const timer = setTimeout(() => {
      void client
        .request("agents.profiles.list", { provider: unseen.provider })
        .then((answer) => {
          const open = AgentsProfilesListResult.safeParse(answer).data?.personas.some(
            (candidate) => candidate.signingIn?.sessionId === unseen.terminal.sessionId,
          );
          if (open !== false || signInRef.current !== unseen) return;
          const known = { ...unseen, seen: true };
          signInRef.current = known;
          setSignIn(known);
        })
        .catch(() => undefined);
    }, UNSEEN_CHECK_MS);
    return () => clearTimeout(timer);
  }, [unseen, client]);
  // an identity read that never comes still closes the card, and says so
  const waiting = signIn?.ended === true ? signIn : null;
  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(() => {
      if (signInRef.current === waiting) finishSignIn(waiting, undefined);
    }, IDENTITY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  function finishSignIn(done: SignIn, current: AgentPersona | undefined): void {
    setSignIn(null);
    signInRef.current = null;
    setCancelling(false);
    const label = labelOf(done.provider);
    if (done.fresh && done.cancelled) {
      // a cancelled add adds nothing: the empty sign-in goes again
      void client.request("agents.profiles.delete", { profileId: done.profileId }).catch(() => {
        // it stays, not signed in, and its row says so
      });
      return;
    }
    if (done.cancelled) return;
    if (current?.identity?.loggedIn === true) {
      setNotice({ tone: "neutral", text: `Signed in to ${label}.` });
    } else if (feed?.identity.includes(done.provider) === false) {
      setNotice({
        tone: "neutral",
        text: `${label}'s sign-in finished. ${label} doesn't say which account it used.`,
      });
    } else {
      setNotice({
        tone: "attention",
        text: `The sign-in ended before ${label} said who is signed in. Sign in again when you're ready.`,
      });
    }
  }

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

  const startSignIn = async (
    profileId: string,
    provider: string,
    setId: string,
    at: "profile" | "agent",
    fresh: boolean,
    /** one of the agent's own routes (AR-S2c); absent, its default login */
    route?: string,
  ): Promise<void> => {
    const open = signInRef.current;
    if (open !== null) {
      setNotice({
        tone: "attention",
        text: `Finish or cancel the sign-in to ${labelOf(open.provider)} first.`,
      });
      if (fresh)
        void client.request("agents.profiles.delete", { profileId }).catch(() => undefined);
      return;
    }
    const startedAt = Date.now();
    const answer = await act(
      `add:${provider}`,
      `Couldn't start ${labelOf(provider)}'s sign-in`,
      async () =>
        AgentsProfilesLoginResult.parse(
          await client.request("agents.profiles.login", {
            profileId,
            ...(route !== undefined ? { route } : {}),
          }),
        ),
    );
    if (answer === null) {
      if (fresh)
        void client.request("agents.profiles.delete", { profileId }).catch(() => undefined);
      return;
    }
    if (!mounted.current) {
      // the page was left before its terminal could show: nobody would see
      // this login, so it ends here, and an Add's empty sign-in goes with it
      void client
        .request("terminal.terminate", { sessionId: answer.terminal.sessionId })
        .catch(() => undefined)
        .then(() => (fresh ? client.request("agents.profiles.delete", { profileId }) : undefined))
        .catch(() => undefined);
      return;
    }
    const opened: SignIn = {
      profileId,
      provider,
      set: setId,
      at,
      terminal: answer.terminal,
      fresh,
      cancelled: false,
      startedAt,
      seen: false,
      ended: false,
    };
    signInRef.current = opened;
    setSignIn(opened);
  };

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

  const cancelSignIn = async (): Promise<void> => {
    const open = signInRef.current;
    if (open === null) return;
    setCancelling(true);
    const cancelled = { ...open, cancelled: true };
    signInRef.current = cancelled;
    setSignIn(cancelled);
    try {
      await client.request("terminal.terminate", { sessionId: open.terminal.sessionId });
    } catch (cause) {
      if (mounted.current) {
        setCancelling(false);
        setNotice({ tone: "error", text: refusalSentence("Couldn't cancel the sign-in", cause) });
      }
    }
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
            onOpen={(list) => onRoute({ kind: "list", set: set.id, provider: row.provider, list })}
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
              onOpenItem={(list, name) => onRoute({ kind: "item", set: page.set.id, list, name })}
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
