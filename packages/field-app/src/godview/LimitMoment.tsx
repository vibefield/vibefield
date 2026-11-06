import { AgentsInstallsResult } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { ServiceMark } from "@vibefield/puppeteer-views";
import {
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { retireSetupMoment, useSetupLedger } from "../setup/ledger";
import {
  LIMIT_MOMENT,
  type LimitMomentFact,
  limitCandidates,
  limitMoment,
  unplannedAtTheLine,
} from "../setup/limit-moment";
import { PROFILES_WORDS } from "../setup/profiles-words";
import { useMonitorAccountFacts } from "./monitor/account-facts";
import { ColumnAddPresses } from "./profiles-column/ProfilesColumn";

// The limit moment (track AO, AO-6b; AO-D11 ruled A and AO-D15 ruled (a) by
// James 2026-10-27; DESIGN.md §8 "The moments"): a plan at 90% or more of a
// window while This Mac is the only profile offers a profile, once. Add a
// profile… opens Agent Profiles on its New profile… form; either act retires
// the moment in the setup ledger, so no window offers it again. *Since UM-3
// (UM-D23 A, 2026-11-06: "AO-6b's words and rule at a new anchor"):* it stands
// beside the profiles column's add, in the add's card's place, as round 4's
// card — a menu's solid in Godview's mode with a pointer at the add — where it
// was one row on the claims strip in Godview's instrument skin. A press of the
// column's add while it shows does what Add a profile… does (ruling 6).

/** The card itself, controller-free, so the catalog mounts the shipping face.
 * Each act is handed the element it was pressed on. */
export function LimitMomentCard({
  fact,
  canAdd = true,
  onAddProfile,
  onNotNow,
}: {
  fact: LimitMomentFact;
  /** whether Settings can be opened from here now (it is not open already) */
  canAdd?: boolean;
  onAddProfile: (from: HTMLElement) => void;
  onNotNow: (from: HTMLElement) => void;
}): ReactElement {
  const voiceId = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card of words and two acts, said as a group (§9), not a fieldset of form inputs
    <div className="vf-profiles-limit" role="group" aria-label={PROFILES_WORDS.limitTitle}>
      <b className="vf-profiles-limit-title">{PROFILES_WORDS.limitTitle}</b>
      <span className="vf-profiles-limit-plan">
        <ServiceMark service={fact.service} />
        <span className="vf-profiles-limit-plan-name">{fact.title}</span>
        <em className="vf-profiles-limit-use">
          {PROFILES_WORDS.limitUse(fact.usedPercent, fact.window, fact.part)}
        </em>
      </span>
      <span className="vf-profiles-limit-acts">
        <button
          type="button"
          className="vf-profiles-limit-act"
          data-variant="primary"
          aria-describedby={voiceId}
          disabled={!canAdd}
          onClick={(event) => onAddProfile(event.currentTarget)}
        >
          {PROFILES_WORDS.add}
        </button>
        <button
          type="button"
          className="vf-profiles-limit-act"
          onClick={(event) => onNotNow(event.currentTarget)}
        >
          {PROFILES_WORDS.notNow}
        </button>
        {/* the voice, said as the primary act's description and not drawn */}
        <span id={voiceId} hidden>
          {PROFILES_WORDS.limitVoice}
        </span>
      </span>
    </div>
  );
}

/** The card leaves with either act. When it held the keyboard, the keyboard
 * goes to the current view's circle in Godview's head first, so it keeps its
 * place, and Settings, opened from here, returns it there on close. */
function handFocusHome(from: HTMLElement): void {
  if (!from.closest(".vf-profiles-limit")?.contains(document.activeElement)) return;
  from
    .closest(".vf-godview")
    ?.querySelector<HTMLElement>('[role="group"][aria-label="Monitor view"] [aria-pressed="true"]')
    ?.focus({ preventScroll: true });
}

/** The moment beside the column's add, while a plan of This Mac's runs near a
 * window's end. It reads what the stage already reads (`MonitorAccountFacts`:
 * the profile filter's sets, the usage rows) and the setup ledger. It asks
 * fieldd's inventory only once a plan is at the line, so it speaks only for a
 * plan whose card Agent Profiles shows. */
export function LimitMoment({
  openNewProfile,
  now,
}: {
  /** opens Settings on Agent Profiles' New profile… form; absent while
   * Settings is open, where a new page cannot be asked of it */
  openNewProfile?: (() => void) | undefined;
  /** the time a window's reset is read against; the clock's unless pinned (tests) */
  now?: Date | undefined;
}): ReactElement | null {
  const client = useFielddClient();
  const ledger = useSetupLedger();
  const { sets, usage } = useMonitorAccountFacts();
  const input = { sets, usage, ledger, now: now ?? new Date() };
  const candidates = limitCandidates(input);
  const atTheLine = candidates.length > 0;
  // This Mac's installs, asked once a plan is at the line (the page lists only
  // installed agents); unread, the moment waits
  const [installed, setInstalled] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!atTheLine || installed !== null) return;
    let cancelled = false;
    client
      .request("agents.installs", {})
      .then((result) => {
        const parsed = AgentsInstallsResult.safeParse(result);
        if (cancelled || !parsed.success) return;
        setInstalled(new Set(parsed.data.installs.map((install) => install.provider)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, atTheLine, installed]);
  // a sign-in at the line that no plan names yet: fieldd reads the identities
  // again, once, as Agent Profiles asks it to, and the profiles feed brings the plan
  const unplanned = unplannedAtTheLine(input);
  const askedForIdentities = useRef(false);
  useEffect(() => {
    if (!unplanned || askedForIdentities.current) return;
    askedForIdentities.current = true;
    client.request("agents.profileSets.list", { refresh: true }).catch(() => undefined);
  }, [client, unplanned]);
  // answered here: the row leaves at once, before the ledger says so, and for
  // good if its write is refused
  const [answered, setAnswered] = useState(false);
  const fact = answered ? null : limitMoment(candidates, installed);
  const shown = fact !== null;
  const retire = useCallback((): void => {
    setAnswered(true);
    retireSetupMoment(client, LIMIT_MOMENT).catch(() => undefined);
  }, [client]);
  // ruling 6: the column's add, pressed while the card shows, opened New
  // profile… itself; the card retires as its own Add a profile… would
  const addPresses = useContext(ColumnAddPresses);
  const seenPresses = useRef(addPresses);
  useEffect(() => {
    if (addPresses === seenPresses.current) return;
    seenPresses.current = addPresses;
    if (shown) retire();
  }, [addPresses, shown, retire]);
  if (fact === null) return null;
  return (
    <LimitMomentCard
      fact={fact}
      canAdd={openNewProfile !== undefined}
      onAddProfile={(from) => {
        if (openNewProfile === undefined) return;
        handFocusHome(from);
        openNewProfile();
        retire();
      }}
      onNotNow={(from) => {
        handFocusHome(from);
        retire();
      }}
    />
  );
}
