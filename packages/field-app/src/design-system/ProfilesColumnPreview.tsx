import type { AgentAccountUsageEntry, AgentProfileSet } from "@vibefield/contracts";
import { type ReactElement, useState } from "react";
import type { GodviewTheme } from "../godview/GodviewTuningPanel";
import { LimitMomentCard } from "../godview/LimitMoment";
import { readWords } from "../godview/profiles-column/ProfilePopoverView";
import { columnCircles } from "../godview/profiles-column/ProfilesColumn";
import { ProfilesColumnView } from "../godview/profiles-column/ProfilesColumnView";
import { FIXTURE_LIMIT_MOMENT, FIXTURE_LIMIT_USAGE } from "./limit-moment-fixtures";
import {
  FIXTURE_NATIVE,
  FIXTURE_PROFILE_SETS,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_PROFILES_NOW,
} from "./profiles-fixtures";

// UM-3 (DESIGN.md §8 "Godview's profiles column"; PLAN §4's plates) — THE PROFILES COLUMN ON FIXTURES: the SHIPPING
// column view (`ProfilesColumnView`), its circles read by the stage controller's own reading (`columnCircles`) over the
// Agent Profiles catalog's fixtures at that catalog's clock (`profiles-fixtures.ts`). The casts are This Mac alone, and
// This Mac, Work and Client demo. The batches are their usage rows; the limit moment's (This Mac's week at 92%); and none
// yet. So no agent is named here (R23b). Each state is a plate of its own: a Godview root in the page's theme, as every
// Godview specimen follows it (FC-D7). What the controller keeps (what is open, pinned or pointed at) is stood here,
// and every act lands on no one. The plan a pointer is on inside the open popover is kept live, as the stage keeps it.

/** This Mac's agents as Settings' This Mac page lists them (ruling 8): the fixture's installs. */
const INSTALLED: ReadonlySet<string> = new Set(
  FIXTURE_PROFILES_CONTEXT.installs.map((install) => install.provider),
);

const ONE: readonly AgentProfileSet[] = [FIXTURE_NATIVE];
const TYPICAL = FIXTURE_PROFILES_CONTEXT.usage;

/** A plate: whose circles, over which rows, and what the controller would hold open. */
interface ColumnPlate {
  id: string;
  caption: string;
  /** the profile filter's sets; null, no profiles door */
  sets: readonly AgentProfileSet[] | null;
  /** the usage rows; null before the first frame (every metered sign-in a first read) */
  rows: readonly AgentAccountUsageEntry[] | null;
  usageUnavailable?: boolean;
  /** the profile whose popover a click on its circle pinned (and, with several, chose); its plate takes the row */
  pinned?: string;
  /** the pointer on the add */
  addOpen?: boolean;
  /** the limit moment beside the add */
  limit?: boolean;
  /** Godview's animations off: the breath held still, as under Reduce Motion (M6) */
  still?: boolean;
}

const PLATES: readonly ColumnPlate[] = [
  { id: "one-typical", caption: "One profile · typical", sets: ONE, rows: TYPICAL },
  {
    id: "one-near",
    caption: "One profile · near the limit",
    sets: ONE,
    rows: FIXTURE_LIMIT_USAGE,
  },
  { id: "one-first", caption: "One profile · first read", sets: ONE, rows: null },
  {
    id: "several-typical",
    caption: "Three profiles · typical",
    sets: FIXTURE_PROFILE_SETS,
    rows: TYPICAL,
  },
  {
    id: "several-near",
    caption: "Three profiles · near the limit",
    sets: FIXTURE_PROFILE_SETS,
    rows: FIXTURE_LIMIT_USAGE,
  },
  {
    id: "several-first",
    caption: "Three profiles · first read",
    sets: FIXTURE_PROFILE_SETS,
    rows: null,
  },
  {
    id: "popover",
    caption: "A popover, pinned by a click on This Mac: only its sessions show",
    sets: FIXTURE_PROFILE_SETS,
    rows: TYPICAL,
    pinned: FIXTURE_NATIVE.id,
  },
  { id: "add", caption: "The add, pointed at: its card", sets: ONE, rows: TYPICAL, addOpen: true },
  {
    id: "limit",
    caption:
      "The limit moment in the card's place: a plan at 90% or more of a window while This Mac is the only profile (AO-6b, UM-D23)",
    sets: ONE,
    rows: FIXTURE_LIMIT_USAGE,
    limit: true,
  },
  {
    id: "unavailable",
    caption: "Usage unavailable: every circle dashed",
    sets: FIXTURE_PROFILE_SETS,
    rows: null,
    usageUnavailable: true,
  },
  { id: "no-door", caption: "No profiles door: This Mac, dashed", sets: null, rows: null },
  {
    id: "still",
    caption: "A first read held still: Godview's animations off, as under Reduce Motion",
    sets: ONE,
    rows: null,
    still: true,
  },
];

/** An act the catalog takes for no one. */
const NOTHING = (): void => undefined;

function Plate({ plate, theme }: { plate: ColumnPlate; theme: GodviewTheme }): ReactElement {
  const [focus, setFocus] = useState<string | null>(null);
  const circles = columnCircles(plate.sets, plate.rows, FIXTURE_PROFILES_NOW, {
    installed: INSTALLED,
    usageUnavailable: plate.usageUnavailable === true,
  });
  // UM-D19: several profiles make each circle the lens, and a click on one both chooses it and pins its popover
  const lens = circles.length > 1;
  const open = circles.find((circle) => circle.set.id === plate.pinned);
  return (
    <figure
      className={`vf-godview vf-ds-profiles-plate theme-${theme}${open !== undefined ? " is-wide" : ""}`}
      data-profiles-plate={plate.id}
      data-godview-animations={plate.still === true ? "off" : "on"}
    >
      <figcaption className="vf-ds-profiles-caption">{plate.caption}</figcaption>
      <ProfilesColumnView
        circles={circles}
        lens={lens}
        chosen={lens ? (open?.set.id ?? null) : null}
        open={open?.set.id ?? null}
        pinned={open !== undefined}
        focus={focus}
        read={open === undefined ? "" : readWords(open.meters, FIXTURE_PROFILES_NOW)}
        addOpen={plate.addOpen === true}
        canAdd
        canOpen
        canRetry
        moment={
          // the shipping card over the shipping rule's fixture
          plate.limit === true && FIXTURE_LIMIT_MOMENT !== null ? (
            <LimitMomentCard
              fact={FIXTURE_LIMIT_MOMENT}
              onAddProfile={NOTHING}
              onNotNow={NOTHING}
            />
          ) : undefined
        }
        onPoint={NOTHING}
        onCircle={NOTHING}
        onClose={NOTHING}
        onFocusPlan={setFocus}
        onAdd={NOTHING}
        onOpenProfile={NOTHING}
        onRetry={NOTHING}
      />
    </figure>
  );
}

export function ProfilesColumnPreview({ theme }: { theme: GodviewTheme }): ReactElement {
  return (
    <div className="vf-ds-profiles-plates">
      {PLATES.map((plate) => (
        <Plate key={plate.id} plate={plate} theme={theme} />
      ))}
    </div>
  );
}
