import { AgentsExtensionsListResult } from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { refusalSentence } from "../../account/use-account";
import { ProfileExtensionsView } from "./ExtensionsView";

// Extensions' controller for one profile's page (AR-S4b). The lens comes from
// `agents.extensions.subscribe`: the last read, or the profile's agents while
// the first read runs, then each finished read. fieldd reads the agents only
// when asked — this subscription, or "Read again", which asks
// `agents.extensions.list` to read every agent again; its frame arrives on the
// subscription. Nothing is polled and nothing is kept here.

/** A minute's tick for "Read 3 minutes ago". */
const CLOCK_MS = 60_000;

export function ProfileExtensions({
  set,
  profile,
}: {
  set: string;
  /** The profile's name, for the words. */
  profile: string;
}): ReactElement {
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

  return (
    <ProfileExtensionsView
      lens={lens}
      profile={profile}
      error={error}
      refreshing={refreshing}
      onRefresh={refresh}
      now={now}
    />
  );
}
