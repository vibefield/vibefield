import { AgentAccountUsageBatch, AgentsProfileSetsListResult } from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { ServiceMark } from "@vibefield/puppeteer-views";
import { type CSSProperties, type ReactElement, useMemo, useState } from "react";
import { openSettingsAt, useSettingsDoor } from "../frame/settings-door";
import { retireSetupMoment, useSetupLedger } from "../setup/ledger";
import { LIMIT_MOMENT, type LimitMomentFact, limitMoment } from "../setup/limit-moment";
import { PROFILES_WORDS } from "../setup/profiles-words";

// The limit moment (track AO, AO-6b; AO-D11 ruled A and AO-D15 ruled (a) by
// James 2026-10-27; DESIGN.md §8 "The moments"): a plan at 90% or more of a
// window while This Mac is the only profile offers a profile, once, on
// VibeField's claims strip beside Godview's usage column (the column is
// puppeteer-views'; the strip is VibeField's). Add a profile… opens Agent
// Profiles on its New profile… form; either act retires the moment in the
// setup ledger, so no window offers it again. Drawn in Godview's instrument
// skin, which follows Godview's own theme, not the app's.

/** The card itself, controller-free, so the catalog mounts the shipping face. */
export function LimitMomentCard({
  fact,
  canAdd = true,
  onAddProfile,
  onNotNow,
}: {
  fact: LimitMomentFact;
  /** whether Settings can be opened from here (a frame lends the door) */
  canAdd?: boolean;
  onAddProfile: () => void;
  onNotNow: () => void;
}): ReactElement {
  return (
    <section
      className="vf-monitor-moment"
      aria-label={PROFILES_WORDS.limitTitle}
      style={{ "--vf-moment-used": `${Math.min(100, fact.usedPercent)}%` } as CSSProperties}
    >
      <div className="vf-monitor-moment-head">
        <span className="vf-monitor-moment-plan">
          <ServiceMark service={fact.service} />
          <span>{fact.title}</span>
        </span>
        <span className="vf-monitor-moment-use">
          {PROFILES_WORDS.limitUse(fact.usedPercent, fact.window)}
        </span>
      </div>
      <span className="vf-monitor-moment-bar" aria-hidden="true" />
      <p className="vf-monitor-moment-title">{PROFILES_WORDS.limitTitle}</p>
      <p className="vf-monitor-moment-voice">{PROFILES_WORDS.limitVoice}</p>
      <div className="vf-monitor-moment-acts">
        <button
          type="button"
          className="vf-monitor-moment-act"
          data-variant="primary"
          disabled={!canAdd}
          onClick={onAddProfile}
        >
          {PROFILES_WORDS.add}
        </button>
        <button type="button" className="vf-monitor-moment-act" onClick={onNotNow}>
          {PROFILES_WORDS.notNow}
        </button>
      </div>
    </section>
  );
}

/** The claims strip's moment, while a plan of This Mac's runs near a window's
 * end. It reads this window's own fieldd (the stage's door may be another
 * desktop's): the profiles, the usage and the ledger, held only while the
 * stage is (PF6). */
export function LimitMoment(): ReactElement | null {
  const client = useFielddClient();
  const ledger = useSetupLedger();
  const profilesFeed = useSubscription<unknown>("agents.profileSets.subscribe", {});
  const usageFeed = useSubscription<unknown>("agents.usage.subscribe", {});
  const sets = useMemo(() => {
    const parsed = AgentsProfileSetsListResult.safeParse(profilesFeed.data);
    return parsed.success ? parsed.data.sets : null;
  }, [profilesFeed.data]);
  const usage = useMemo(() => {
    const parsed = AgentAccountUsageBatch.safeParse(usageFeed.data);
    return parsed.success ? parsed.data.entries : null;
  }, [usageFeed.data]);
  const door = useSettingsDoor();
  // answered here: the card leaves at once, before the ledger says so, and
  // for good if its write is refused
  const [answered, setAnswered] = useState(false);
  const fact = answered ? null : limitMoment(sets, usage, ledger);
  if (fact === null) return null;
  const retire = (): void => {
    setAnswered(true);
    retireSetupMoment(client, LIMIT_MOMENT).catch(() => undefined);
  };
  return (
    <LimitMomentCard
      fact={fact}
      canAdd={door !== null}
      onAddProfile={() => {
        retire();
        openSettingsAt("new-profile");
      }}
      onNotNow={retire}
    />
  );
}
