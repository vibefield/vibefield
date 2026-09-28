import {
  type AgentExtensionOffer,
  type AgentExtensionServerDefinition,
  AgentsExtensionsCatalogResult,
  AgentsExtensionsListResult,
  AgentsExtensionsPlanResult,
  AgentsExtensionsPlanSkillResult,
  AgentsExtensionsPlanSourceResult,
  AgentsExtensionsSignInResult,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { refusalSentence } from "../../account/use-account";
import {
  type AddServerRequest,
  AddServerView,
  type AddSkillPlan,
  type AddSkillRequest,
  AddSkillView,
  AgentExtensionListView,
  AgentExtensionsView,
  BrowseView,
  type ExtensionActRequest,
  ExtensionItemView,
  type ExtensionSignInSlot,
  ListedPluginView,
  PluginView,
  ProfileExtensionsView,
} from "./ExtensionsView";
import {
  ADD_SERVER_NAME,
  type AgentListKey,
  type AgentListOpen,
  type ExtensionKindKey,
  skillSourceProblem,
} from "./extensions-model";
import { SignInTerminal } from "./SignInTerminal";

// Extensions' controllers (AR-S4b). Every page that shows what a profile's
// agents hold reads the same lens from `agents.extensions.subscribe`: the
// last read, or the profile's agents while the first read runs, then each
// finished read. fieldd reads the agents only when asked — a subscription, or
// "Read again", which asks `agents.extensions.list` to read every agent
// again; its frame arrives on the subscription. Moving between the pages
// subscribes again and gets the kept read at once. Nothing is polled and
// nothing is kept here. AR-S4c: an act asks `agents.extensions.act`; its
// output and outcome arrive on the same frames (the lens's `run`), and the
// cells turn when fieldd has read the agents again. A server's sign-in asks
// `agents.extensions.signIn`, which answers with this window's ticket for the
// pane the agent's login runs in: the ticket is kept for the window (below),
// so any of the profile's pages shows the pane while the run says it is open,
// and Cancel ends it (`terminal.terminate`); the receipt arrives on the frames.
// AR-S4d: an act `add` carries the values its server reads (the confirm asked
// for them); Add server asks `agents.extensions.plan` what each agent would
// run as the form changes, then `agents.extensions.add`, whose runs ride the
// frames, and opens the new server's page when it answers. AR-S4d2: Add skill
// asks `agents.extensions.planSkill` what the folder is and what each agent
// would run as the path changes, then `agents.extensions.addSkill`. AR-S4e: a
// plugin's page reads the same lens, and its acts ask `agents.extensions.act`
// with the plugin's key, like a cell's. AR-S4e2: the Browse page and a listed
// plugin's page read the agent's catalog from `agents.extensions.catalog` —
// when they open, and again when an act of that agent's finishes on the frames
// (what it lists as installed moved with it); an install or a marketplace's
// act asks `agents.extensions.act`, or `agents.extensions.terminal` where the
// agent asks the person something first, whose pane is kept like a sign-in's;
// "Check for updates" asks `agents.extensions.check`; a source being typed asks
// `agents.extensions.planSource` what the agent would run.

/** How long the form rests before its draft is planned. */
const PLAN_REST_MS = 300;

/** A minute's tick for "Read 3 minutes ago". */
const CLOCK_MS = 60_000;

/* A sign-in's ticket, per profile, for as long as this window has its pane
   to show: one sign-in runs at a time per profile (fieldd refuses a second). */
interface HeldSignIn {
  runId: string;
  startedAt: string;
  sessionId: string;
  ticket: TerminalCreateOpenResult;
}
const heldSignIns = new Map<string, HeldSignIn>();
const heldListeners = new Set<() => void>();
let heldVersion = 0;
function held(set: string, value: HeldSignIn | null): void {
  if (value === null && !heldSignIns.has(set)) return;
  if (value === null) heldSignIns.delete(set);
  else heldSignIns.set(set, value);
  heldVersion += 1;
  for (const listener of heldListeners) listener();
}
const subscribeHeld = (listener: () => void): (() => void) => {
  heldListeners.add(listener);
  return () => heldListeners.delete(listener);
};

interface ExtensionLens {
  lens: AgentsExtensionsListResult | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
  /** An act was asked for and has not answered. */
  acting: boolean;
  act: (request: ExtensionActRequest) => void;
  /** A server's sign-in running for the profile: this window's pane, and Cancel. */
  signIn: ExtensionSignInSlot | undefined;
  now: Date;
}

function useExtensionLens(set: string): ExtensionLens {
  const client = useFielddClient();
  const feed = useSubscription<unknown>("agents.extensions.subscribe", { set });
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useSyncExternalStore(subscribeHeld, () => heldVersion);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const parsed = feed.data === null ? null : AgentsExtensionsListResult.safeParse(feed.data);
  const lens = parsed?.success === true ? parsed.data : null;

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefusal(null);
    client
      .request("agents.extensions.list", { set, refresh: true })
      .catch((cause: unknown) =>
        setRefusal(refusalSentence("Could not read the agents again", cause)),
      )
      .finally(() => setRefreshing(false));
  }, [client, set]);

  const act = useCallback(
    (request: ExtensionActRequest) => {
      setActing(true);
      setRefusal(null);
      const { terminal: inPane, ...fields } = request;
      // a pane's ticket is this window's, for as long as its run says it is open
      const hold = (answer: unknown) => {
        const { run, terminal } = AgentsExtensionsSignInResult.parse(answer);
        held(set, {
          runId: run.id,
          startedAt: run.startedAt,
          sessionId: terminal.sessionId,
          ticket: terminal,
        });
      };
      const asked =
        request.act === "sign-in"
          ? client
              .request("agents.extensions.signIn", {
                set,
                provider: request.provider,
                id: request.id,
              })
              .then(hold)
          : inPane === true
            ? client
                .request("agents.extensions.terminal", {
                  set,
                  provider: fields.provider,
                  kind: fields.kind,
                  id: fields.id,
                  act: fields.act,
                  ...(fields.source !== undefined ? { source: fields.source } : {}),
                })
                .then(hold)
            : client.request("agents.extensions.act", { set, ...fields });
      asked
        .catch((cause: unknown) =>
          setRefusal(
            refusalSentence(
              request.act === "sign-in"
                ? "That sign-in didn’t start"
                : inPane === true
                  ? "That terminal didn’t open"
                  : "That change didn’t run",
              cause,
            ),
          ),
        )
        .finally(() => setActing(false));
    },
    [client, set],
  );

  // the pane of the profile's running sign-in, where this window opened it;
  // a sign-in that finished, or one a newer run followed, lets its ticket go
  const run = lens?.run;
  const mine = heldSignIns.get(set);
  useEffect(() => {
    if (mine === undefined || run === undefined) return;
    const over =
      (run.id === mine.runId && run.state === "finished") ||
      (run.id !== mine.runId && run.startedAt > mine.startedAt);
    if (over) held(set, null);
  }, [mine, run, set]);
  // a sign-in's pane, or AR-S4e2 any act's the person answers
  const sessionId = run?.state === "running" ? run.terminal?.sessionId : undefined;
  const cancelSignIn = useCallback(() => {
    if (sessionId === undefined) return;
    setCancelling(true);
    client
      .request("terminal.terminate", { sessionId })
      .catch((cause: unknown) => setRefusal(refusalSentence("Couldn’t close the terminal", cause)))
      .finally(() => setCancelling(false));
  }, [client, sessionId]);
  const signIn: ExtensionSignInSlot | undefined =
    sessionId === undefined
      ? undefined
      : {
          ...(mine?.sessionId === sessionId
            ? { pane: <SignInTerminal terminal={mine.ticket} /> }
            : {}),
          onCancel: cancelSignIn,
          cancelling,
        };

  const error =
    refusal ??
    (feed.status === "error"
      ? refusalSentence("Could not read what the agents hold", feed.error)
      : parsed?.success === false
        ? "fieldd answered with a list this version cannot read."
        : null);

  return { lens, error, refreshing, refresh, acting, act, signIn, now };
}

interface AgentCatalog {
  catalog: AgentsExtensionsCatalogResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * AR-S4e2 — one agent's catalog: read when a page opens, and again when an act
 * of that agent's that could change what it lists (an install, a marketplace's
 * act, "Check for updates") has finished on the profile's frames.
 */
function useAgentCatalog(
  set: string,
  provider: string,
  lens: AgentsExtensionsListResult | null,
): AgentCatalog {
  const client = useFielddClient();
  const [catalog, setCatalog] = useState<AgentsExtensionsCatalogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const asked = useRef(0);
  const read = useCallback(() => {
    const ask = ++asked.current;
    setLoading(true);
    setRefusal(null);
    client
      .request("agents.extensions.catalog", { set, provider })
      .then((answer) => {
        if (ask !== asked.current) return;
        const parsed = AgentsExtensionsCatalogResult.safeParse(answer);
        if (parsed.success) setCatalog(parsed.data);
        else setRefusal("fieldd answered with a catalog this version cannot read.");
      })
      .catch((cause: unknown) => {
        if (ask === asked.current)
          setRefusal(refusalSentence("Could not read the catalogs", cause));
      })
      .finally(() => {
        if (ask === asked.current) setLoading(false);
      });
  }, [client, set, provider]);
  useEffect(() => read(), [read]);
  // a finished act of this agent's that moves what it lists: read the catalog again
  const run = lens?.run;
  const finished =
    run !== undefined &&
    run.state === "finished" &&
    run.provider === provider &&
    (run.kind === "marketplace" ||
      run.act === "install" ||
      run.act === "update" ||
      run.act === "remove" ||
      run.act === "purge")
      ? run.id
      : undefined;
  const seenRun = useRef(finished);
  useEffect(() => {
    if (finished === undefined || finished === seenRun.current) return;
    seenRun.current = finished;
    read();
  }, [finished, read]);
  return { catalog, loading, error: refusal, refresh: read };
}

/** AR-S4e2 — what the agent would run for a source being typed, or why not. */
function usePlanSource(
  set: string,
  provider: string,
  kind: "plugin" | "marketplace",
): (source: string) => Promise<AgentExtensionOffer | null> {
  const client = useFielddClient();
  return useCallback(
    (source: string) =>
      client
        .request("agents.extensions.planSource", { set, provider, kind, source })
        .then((answer) => AgentsExtensionsPlanSourceResult.parse(answer).offer)
        .catch((cause: unknown) => ({
          unavailable: {
            reason: "refused",
            message: refusalSentence("It can’t be planned", cause),
          },
        })),
    [client, set, provider, kind],
  );
}

/** AR-S4e2 — "Check for updates": the agent's own fetch of each catalog, then both read again. */
function useCheck(
  set: string,
  provider: string,
): { check: () => void; checking: boolean; refusal: string | null } {
  const client = useFielddClient();
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const check = useCallback(() => {
    setChecking(true);
    setRefusal(null);
    client
      .request("agents.extensions.check", { set, provider })
      .catch((cause: unknown) => setRefusal(refusalSentence("The check didn’t run", cause)))
      .finally(() => setChecking(false));
  }, [client, set, provider]);
  return { check, checking, refusal };
}

/** The profile page's two lists. */
export function ProfileExtensions({
  set,
  profile,
  where,
  onOpenItem,
  onAddServer,
  onAddSkill,
  otherProfiles,
}: {
  set: string;
  /** The profile's name, for the words. */
  profile: string;
  /** "in Work" · "on This Mac" */
  where?: string;
  /** A row's name opens that server's or skill's page. */
  onOpenItem?: (key: ExtensionKindKey, name: string) => void;
  /** AR-S4d — Add server… opens its page. */
  onAddServer?: () => void;
  /** AR-S4d2 — Add skill… opens its page. */
  onAddSkill?: () => void;
  /** AR-S4d2 — the other profiles and their agents: what a move to the shared folder reaches. */
  otherProfiles?: Array<{ profile: string; providers: string[] }>;
}): ReactElement {
  const { lens, error, refreshing, refresh, acting, act, signIn, now } = useExtensionLens(set);
  return (
    <ProfileExtensionsView
      lens={lens}
      profile={profile}
      error={error}
      refreshing={refreshing}
      onRefresh={refresh}
      onAct={act}
      acting={acting}
      now={now}
      {...(signIn !== undefined ? { signIn } : {})}
      {...(where !== undefined ? { where } : {})}
      {...(onOpenItem !== undefined ? { onOpenItem } : {})}
      {...(onAddServer !== undefined ? { onAddServer } : {})}
      {...(onAddSkill !== undefined ? { onAddSkill } : {})}
      {...(otherProfiles !== undefined ? { otherProfiles } : {})}
    />
  );
}

/** AR-S4d2 — Add skill's page: the folder read, what each agent would run, then the Add. */
export function AddSkill({
  set,
  profile,
  where,
  onDone,
  onCancel,
}: {
  set: string;
  profile: string;
  where: string;
  /** The skill was kept (and given where it could be): its page. */
  onDone: (name: string) => void;
  onCancel: () => void;
}): ReactElement {
  const client = useFielddClient();
  const { lens, error, now } = useExtensionLens(set);
  const [plan, setPlan] = useState<AddSkillPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onSource = useCallback(
    (from: string) => {
      clearTimeout(timer.current);
      const ask = ++asked.current;
      setPlan(null);
      if (skillSourceProblem(from) !== null) {
        setPlanError(null);
        return;
      }
      timer.current = setTimeout(() => {
        client
          .request("agents.extensions.planSkill", { set, from })
          .then((answer) => {
            if (ask !== asked.current) return;
            setPlan(AgentsExtensionsPlanSkillResult.parse(answer));
            setPlanError(null);
          })
          .catch((cause: unknown) => {
            if (ask !== asked.current) return;
            setPlanError(refusalSentence("VibeField can’t keep this folder as a skill", cause));
          });
      }, PLAN_REST_MS);
    },
    [client, set],
  );

  const onAdd = useCallback(
    (request: AddSkillRequest) => {
      setAdding(true);
      setRefusal(null);
      client
        .request("agents.extensions.addSkill", { set, ...request })
        .then((answer) => {
          const name = (answer as { name?: unknown } | null)?.name;
          onDone(typeof name === "string" ? name : (plan?.name ?? ""));
        })
        .catch((cause: unknown) => setRefusal(refusalSentence("That skill wasn’t added", cause)))
        .finally(() => setAdding(false));
    },
    [client, set, onDone, plan],
  );

  return (
    <AddSkillView
      lens={lens}
      profile={profile}
      where={where}
      plan={plan}
      planError={planError}
      error={refusal ?? error}
      adding={adding}
      onSource={onSource}
      onAdd={onAdd}
      onCancel={onCancel}
      now={now}
    />
  );
}

/** AR-S4d — Add server's page: the form, what each agent would run, then the Add. */
export function AddServer({
  set,
  profile,
  where,
  onDone,
  onCancel,
}: {
  set: string;
  profile: string;
  where: string;
  /** The server was kept (and turned on where it could be): its page. */
  onDone: (name: string) => void;
  onCancel: () => void;
}): ReactElement {
  const client = useFielddClient();
  const { lens, error, now } = useExtensionLens(set);
  const [offers, setOffers] = useState<Record<string, AgentExtensionOffer> | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onDraft = useCallback(
    (name: string, definition: AgentExtensionServerDefinition | null) => {
      clearTimeout(timer.current);
      const ask = ++asked.current;
      if (definition === null || !ADD_SERVER_NAME.test(name)) {
        setOffers(null);
        setPlanError(null);
        return;
      }
      timer.current = setTimeout(() => {
        client
          .request("agents.extensions.plan", { set, name, definition })
          .then((answer) => {
            if (ask !== asked.current) return;
            setOffers(AgentsExtensionsPlanResult.parse(answer).offers);
            setPlanError(null);
          })
          .catch((cause: unknown) => {
            if (ask !== asked.current) return;
            setOffers(null);
            setPlanError(refusalSentence("VibeField can’t keep this server as it is", cause));
          });
      }, PLAN_REST_MS);
    },
    [client, set],
  );

  const onAdd = useCallback(
    (request: AddServerRequest) => {
      setAdding(true);
      setRefusal(null);
      client
        .request("agents.extensions.add", { set, ...request })
        .then(() => onDone(request.name))
        .catch((cause: unknown) => setRefusal(refusalSentence("That server wasn’t added", cause)))
        .finally(() => setAdding(false));
    },
    [client, set, onDone],
  );

  return (
    <AddServerView
      lens={lens}
      profile={profile}
      where={where}
      offers={offers}
      planError={planError}
      error={refusal ?? error}
      adding={adding}
      onDraft={onDraft}
      onAdd={onAdd}
      onCancel={onCancel}
      now={now}
    />
  );
}

/** One agent's Extensions rows, on its page in a profile. */
export function AgentExtensions({
  set,
  provider,
  onOpen,
}: {
  set: string;
  provider: string;
  /** A row opens the agent's own list, titled as the row is (the agent's own word for the kind). */
  onOpen: (key: AgentListKey, title: string) => void;
}): ReactElement {
  const { lens, error } = useExtensionLens(set);
  return <AgentExtensionsView lens={lens} provider={provider} error={error} onOpen={onOpen} />;
}

/** One agent's own list of one kind, a page below the agent's. */
export function AgentExtensionList({
  set,
  provider,
  agent,
  list,
  profile,
  where,
  onOpenProfile,
  onOpen,
  onBrowse,
}: {
  set: string;
  provider: string;
  agent: string;
  list: AgentListKey;
  profile: string;
  where: string;
  onOpenProfile: () => void;
  /** AR-S4e — a row opens its page: a plugin's, or a server's or skill's. */
  onOpen?: (open: AgentListOpen) => void;
  /** AR-S4e2 — Browse…: the agent's catalogs, or one marketplace's part of them. */
  onBrowse?: (market?: string) => void;
}): ReactElement {
  const { lens, error, refreshing, refresh, acting, act, signIn, now } = useExtensionLens(set);
  const { check, checking, refusal } = useCheck(set, provider);
  const planSource = usePlanSource(set, provider, "plugin");
  return (
    <AgentExtensionListView
      lens={lens}
      provider={provider}
      agent={agent}
      list={list}
      profile={profile}
      where={where}
      error={refusal ?? error}
      refreshing={refreshing}
      onRefresh={refresh}
      onOpenProfile={onOpenProfile}
      onCheck={check}
      onAct={act}
      acting={acting || checking}
      onPlanSource={planSource}
      now={now}
      {...(signIn !== undefined ? { signIn } : {})}
      {...(onOpen !== undefined ? { onOpen } : {})}
      {...(onBrowse !== undefined ? { onBrowse } : {})}
    />
  );
}

/** AR-S4e2 — the agent's catalogs: pass 23's B1, below the agent's own list. */
export function AgentBrowse({
  set,
  provider,
  where,
  market,
  onOpen,
}: {
  set: string;
  provider: string;
  where: string;
  /** Opened on one marketplace's part. */
  market?: string;
  /** A row opens its page: the installed plugin's, or the listed one's. */
  onOpen: (plugin: { id: string; name: string; held: string | null }) => void;
}): ReactElement {
  const { lens, error, acting, act, signIn, now } = useExtensionLens(set);
  const { catalog, loading, error: catalogError, refresh } = useAgentCatalog(set, provider, lens);
  const planSource = usePlanSource(set, provider, "marketplace");
  return (
    <BrowseView
      lens={lens}
      catalog={catalog}
      provider={provider}
      where={where}
      error={catalogError ?? error}
      loading={loading}
      onRefresh={refresh}
      onAct={act}
      acting={acting}
      onOpen={onOpen}
      onPlanSource={planSource}
      now={now}
      {...(market !== undefined ? { market } : {})}
      {...(signIn !== undefined ? { signIn } : {})}
    />
  );
}

/**
 * AR-S4e2 — a plugin opened from the catalogs: its listed page until the agent
 * holds it, then — the install done, whatever the agent named it — the
 * installed plugin's own page.
 */
export function AgentListedPlugin({
  set,
  provider,
  id,
  name,
  where,
}: {
  set: string;
  provider: string;
  /** The catalog's key for it. */
  id: string;
  name: string;
  where: string;
}): ReactElement {
  const { lens, error, refreshing, refresh, acting, act, signIn, now } = useExtensionLens(set);
  const {
    catalog,
    loading,
    error: catalogError,
    refresh: readCatalog,
  } = useAgentCatalog(set, provider, lens);
  const held =
    catalog?.plugins.find((candidate) => candidate.id === id)?.held ??
    (lens?.plugins[provider]?.some((plugin) => plugin.id === id) === true ? id : undefined);
  if (
    held !== undefined &&
    lens?.plugins[provider]?.some((plugin) => plugin.id === held) === true
  ) {
    return (
      <PluginView
        lens={lens}
        provider={provider}
        id={held}
        name={name}
        where={where}
        error={error}
        refreshing={refreshing}
        onRefresh={refresh}
        onAct={act}
        acting={acting}
        now={now}
      />
    );
  }
  return (
    <ListedPluginView
      lens={lens}
      catalog={catalog}
      provider={provider}
      id={id}
      name={name}
      where={where}
      error={catalogError ?? error}
      loading={loading}
      onRefresh={readCatalog}
      onAct={act}
      acting={acting}
      now={now}
      {...(signIn !== undefined ? { signIn } : {})}
    />
  );
}

/** AR-S4e — one plugin an agent holds: its page, below the agent's list. */
export function AgentPlugin({
  set,
  provider,
  id,
  name,
  where,
}: {
  set: string;
  provider: string;
  /** The plugin's key in its agent's read. */
  id: string;
  /** Its name as its row gave it. */
  name: string;
  where: string;
}): ReactElement {
  const { lens, error, refreshing, refresh, acting, act, now } = useExtensionLens(set);
  return (
    <PluginView
      lens={lens}
      provider={provider}
      id={id}
      name={name}
      where={where}
      error={error}
      refreshing={refreshing}
      onRefresh={refresh}
      onAct={act}
      acting={acting}
      now={now}
    />
  );
}

/** One server's or skill's page, below the profile's. */
export function ExtensionItem({
  set,
  list,
  name,
  where,
  otherProfiles,
}: {
  set: string;
  list: ExtensionKindKey;
  name: string;
  where: string;
  /** AR-S4d2 — the other profiles and their agents: what a move to the shared folder reaches. */
  otherProfiles?: Array<{ profile: string; providers: string[] }>;
}): ReactElement {
  const { lens, error, refreshing, refresh, acting, act, signIn, now } = useExtensionLens(set);
  return (
    <ExtensionItemView
      lens={lens}
      list={list}
      name={name}
      where={where}
      error={error}
      refreshing={refreshing}
      onRefresh={refresh}
      onAct={act}
      acting={acting}
      now={now}
      {...(signIn !== undefined ? { signIn } : {})}
      {...(otherProfiles !== undefined ? { otherProfiles } : {})}
    />
  );
}
