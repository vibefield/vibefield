import { AgentsExtensionsListResult } from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { refusalSentence } from "../../account/use-account";
import {
  AgentExtensionListView,
  AgentExtensionsView,
  ExtensionItemView,
  ProfileExtensionsView,
} from "./ExtensionsView";
import type { AgentListKey, ExtensionKindKey } from "./extensions-model";

// Extensions' controllers (AR-S4b). Every page that shows what a profile's
// agents hold reads the same lens from `agents.extensions.subscribe`: the
// last read, or the profile's agents while the first read runs, then each
// finished read. fieldd reads the agents only when asked — a subscription, or
// "Read again", which asks `agents.extensions.list` to read every agent
// again; its frame arrives on the subscription. Moving between the pages
// subscribes again and gets the kept read at once. Nothing is polled and
// nothing is kept here.

/** A minute's tick for "Read 3 minutes ago". */
const CLOCK_MS = 60_000;

interface ExtensionLens {
  lens: AgentsExtensionsListResult | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
  now: Date;
}

function useExtensionLens(set: string): ExtensionLens {
  const client = useFielddClient();
  const feed = useSubscription<unknown>("agents.extensions.subscribe", { set });
  const [refreshing, setRefreshing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

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

  const error =
    refusal ??
    (feed.status === "error"
      ? refusalSentence("Could not read what the agents hold", feed.error)
      : parsed?.success === false
        ? "fieldd answered with a list this version cannot read."
        : null);

  return { lens, error, refreshing, refresh, now };
}

/** The profile page's two lists. */
export function ProfileExtensions({
  set,
  profile,
  onOpenItem,
}: {
  set: string;
  /** The profile's name, for the words. */
  profile: string;
  /** A row's name opens that server's or skill's page. */
  onOpenItem?: (key: ExtensionKindKey, name: string) => void;
}): ReactElement {
  const { lens, error, refreshing, refresh, now } = useExtensionLens(set);
  return (
    <ProfileExtensionsView
      lens={lens}
      profile={profile}
      error={error}
      refreshing={refreshing}
      onRefresh={refresh}
      now={now}
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
  const { lens, error, refreshing, refresh, now } = useExtensionLens(set);
  return (
    <ExtensionItemView
      lens={lens}
      list={list}
      name={name}
      where={where}
      error={error}
      refreshing={refreshing}
      onRefresh={refresh}
      now={now}
    />
  );
}
