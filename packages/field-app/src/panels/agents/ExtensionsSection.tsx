import {
  AgentsExtensionsListResult,
  AgentsExtensionsSignInResult,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { refusalSentence } from "../../account/use-account";
import {
  AgentExtensionListView,
  AgentExtensionsView,
  type ExtensionActRequest,
  ExtensionItemView,
  type ExtensionSignInSlot,
  ProfileExtensionsView,
} from "./ExtensionsView";
import type { AgentListKey, ExtensionKindKey } from "./extensions-model";
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
}: {
  set: string;
  /** The profile's name, for the words. */
  profile: string;
  /** "in Work" · "on This Mac" */
  where?: string;
  /** A row's name opens that server's or skill's page. */
  onOpenItem?: (key: ExtensionKindKey, name: string) => void;
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
}: {
  set: string;
  list: ExtensionKindKey;
  name: string;
  where: string;
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
    />
  );
}
