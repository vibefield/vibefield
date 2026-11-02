import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AtSources } from "./at-rows";
import type { NewSparkPort } from "./new-spark";

// CHAT'S READING OF THE AGENT PROFILES (track CO, the handle; DESIGN.md §8 "Chat's composer", @). Chat's controller
// (`ChatView`) reads them here, once for the window's Chat, and hands the one reading to what reads it: @'s rows, in
// the composer. Read on Chat's first show, and again each time @ opens (`ask`), so @ is never staler than its last
// open. It moved out of the composer, which is drawn again for each thread, so a thread switch reads nothing.

/** The Agent Profiles as Chat reads them, and the door that reads them again. */
export interface ProfileSets {
  /** `agents.profileSets.list`'s answer: null until it is read, "failed" when it could not be */
  readonly sets: AtSources["sets"];
  /** read them again (@ opened): what was read stands meanwhile, and a failure reads as reading */
  readonly ask: () => void;
}

/** Read the Agent Profiles fieldd offers: on the first show while `active`, and again at each `ask`. */
export function useProfileSets(
  port: Pick<NewSparkPort, "profileSets">,
  active: boolean,
): ProfileSets {
  const [asks, setAsks] = useState(0);
  const [sets, setSets] = useState<AtSources["sets"]>(null);
  const ask = useCallback(() => setAsks((count) => count + 1), []);
  const shownOnce = useRef(false);
  useEffect(() => {
    if (!active || shownOnce.current) return;
    shownOnce.current = true;
    ask();
  }, [active, ask]);
  useEffect(() => {
    if (asks === 0) return;
    let current = true;
    // a read that failed is said as failed (`atRowsOf`), never as profiles with nothing in them; the next read is
    // said as reading, never as the failure it reads past (a list read before stands while it is read again)
    setSets((held) => (held === "failed" ? null : held));
    port.profileSets().then(
      (listed) => {
        if (current) setSets(listed);
      },
      () => {
        if (current) setSets("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [asks, port]);
  return useMemo(() => ({ sets, ask }), [sets, ask]);
}
