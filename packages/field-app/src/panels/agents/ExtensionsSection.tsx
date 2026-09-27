import {
  type AgentExtensionOffer,
  type AgentExtensionServerDefinition,
  AgentsExtensionsListResult,
  AgentsExtensionsPlanResult,
  AgentsExtensionsPlanSkillResult,
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
  type ExtensionActRequest,
  ExtensionItemView,
  type ExtensionSignInSlot,
  ProfileExtensionsView,
} from "./ExtensionsView";
import {
  ADD_SERVER_NAME,
  type AgentListKey,
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
// would run as the path changes, then `agents.extensions.addSkill`.

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
      const asked =
        request.act === "sign-in"
          ? client
              .request("agents.extensions.signIn", {
                set,
                provider: request.provider,
                id: request.id,
              })
              .then((answer) => {
                const { run, terminal } = AgentsExtensionsSignInResult.parse(answer);
                held(set, {
                  runId: run.id,
                  startedAt: run.startedAt,
                  sessionId: terminal.sessionId,
                  ticket: terminal,
                });
              })
          : client.request("agents.extensions.act", { set, ...request });
      asked
        .catch((cause: unknown) =>
          setRefusal(
            refusalSentence(
              request.act === "sign-in" ? "That sign-in didn’t start" : "That change didn’t run",
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
  const sessionId =
    run?.act === "sign-in" && run.state === "running" ? run.terminal?.sessionId : undefined;
  const cancelSignIn = useCallback(() => {
    if (sessionId === undefined) return;
    setCancelling(true);
    client
      .request("terminal.terminate", { sessionId })
      .catch((cause: unknown) => setRefusal(refusalSentence("Couldn’t cancel the sign-in", cause)))
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
  onOpen: (key: AgentListKey) => void;
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
}: {
  set: string;
  provider: string;
  agent: string;
  list: AgentListKey;
  profile: string;
  where: string;
  onOpenProfile: () => void;
}): ReactElement {
  const { lens, error, refreshing, refresh, now } = useExtensionLens(set);
  return (
    <AgentExtensionListView
      lens={lens}
      provider={provider}
      agent={agent}
      list={list}
      profile={profile}
      where={where}
      error={error}
      refreshing={refreshing}
      onRefresh={refresh}
      onOpenProfile={onOpenProfile}
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
