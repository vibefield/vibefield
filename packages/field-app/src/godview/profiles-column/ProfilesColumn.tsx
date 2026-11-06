import {
  type AgentAccountUsageEntry,
  type AgentProfileSet,
  NATIVE_PROFILE_SET_ID,
} from "@vibefield/contracts";
import {
  createContext,
  memo,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { hasCircle, planMeters } from "../../usage/meters";
import { setMonitorHoldsKeys } from "../monitor/launcher-keys";
import type { MonitorUsagePort } from "../monitor/remote-door";
import { readWords } from "./ProfilePopoverView";
import { ADD_TARGET, type ColumnCircle, ProfilesColumnView } from "./ProfilesColumnView";

// UM-3 (DESIGN.md §8 "Godview's profiles column") — THE COLUMN'S CONTROLLER, the stage's own chrome. It reads what
// the stage already holds — the profile filter's sets (`agents.profileSets.subscribe`), the usage rows through the
// port's one subscription (UM-3a) and whether that feed could be read — asks This Mac's installs once, when it first
// draws (ruling 8, as the limit moment does), and keeps what is open: the popover a pointer is on or a click pinned,
// the plan a pointer is on inside it. The lens is the stage's profile filter itself (SE-D2: one state with the search
// field's token and the search button's), so it chooses through the stage's own setter. Every reading is the meter
// model's (`usage/meters.ts`); the face is `ProfilesColumnView`.

/** This Mac before the profiles feed has answered, or with no profiles door (the catalog's default): its circle,
 * dashed with its glyph (§8 "Honest states"). */
const THIS_MAC: AgentProfileSet = {
  id: NATIVE_PROFILE_SET_ID,
  kind: "native",
  label: "This Mac",
  default: true,
  personas: [],
};

/** UM-3 2d red: the skeleton — the column's add presses, not yet provided. */
export const ColumnAddPresses = createContext(0);

/** How often the column's words read the clock again: a reset and a forecast move by the minute. */
const CLOCK_MS = 60_000;

export interface ProfilesColumnProps {
  /** the profile filter's sets; null until the feed has answered, or with no profiles door */
  sets: readonly AgentProfileSet[] | null;
  /** the usage rows (the port's one subscription); null until they have answered */
  rows: readonly AgentAccountUsageEntry[] | null;
  /** the usage feed could not be read: every circle that would read draws dashed (ruling 10) */
  usageUnavailable: boolean;
  /** the stage's usage port: Retry (`refresh`) and This Mac's installs */
  port?: MonitorUsagePort | undefined;
  /** the stage's profile filter (the lens) */
  chosen: string | null;
  onChoose: (setId: string | null) => void;
  /** Settings → Agent Profiles on New profile… (the add); absent while Settings is open */
  openNewProfile?: (() => void) | undefined;
  /** Settings → Agent Profiles on one profile's page (Sign in, Agent Profiles…) */
  openProfile?: ((setId: string) => void) | undefined;
  /** the limit moment, beside the add while it is due */
  moment?: ReactNode;
  /** the time the meters are read at; the clock's, by the minute, unless pinned (the catalog, tests) */
  now?: Date | undefined;
}

function ProfilesColumnController({
  sets,
  rows,
  usageUnavailable,
  port,
  chosen,
  onChoose,
  openNewProfile,
  openProfile,
  moment,
  now,
}: ProfilesColumnProps): ReactElement {
  // ruling 8: This Mac's circle lists the agents Settings lists there; until the door answers, every agent
  const [installed, setInstalled] = useState<ReadonlySet<string> | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    port
      ?.installs?.()
      .then((answer) => {
        if (!cancelled) setInstalled(answer);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [port]);
  const [clock, setClock] = useState(() => now ?? new Date());
  useEffect(() => {
    if (now !== undefined) {
      setClock(now);
      return;
    }
    const timer = window.setInterval(() => setClock(new Date()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [now]);
  const circles = useMemo<ColumnCircle[]>(() => {
    const shown = sets === null ? [THIS_MAC] : sets.filter(hasCircle);
    return shown.map((set) => ({
      set,
      meters: planMeters(set, rows ?? [], clock, {
        ...(installed !== undefined ? { installed } : {}),
        usage: usageUnavailable ? "unavailable" : "available",
      }),
    }));
  }, [sets, rows, clock, installed, usageUnavailable]);
  // UM-D19: several profiles make each circle the lens; one (UM-D12) has none to choose
  const lens = circles.length > 1;
  const [pointed, setPointed] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const pointedProfile = pointed !== null && pointed !== ADD_TARGET ? pointed : null;
  const open =
    circles.find((circle) => circle.set.id === (pointedProfile ?? pinned))?.set.id ?? null;
  // a plan is pointed at inside one popover: another popover starts with none
  useEffect(() => {
    if (open === null) setFocus(null);
  }, [open]);
  // ruling 11: a pinned popover holds Godview's keys, so Esc closes it before a pane hears it; a click outside too
  useEffect(() => {
    if (pinned === null) return;
    setMonitorHoldsKeys(true);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPinned(null);
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(".vf-profiles-column") !== null) return;
      setPinned(null);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      setMonitorHoldsKeys(false);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [pinned]);
  const openCircle = circles.find((circle) => circle.set.id === open);
  return (
    <ProfilesColumnView
      circles={circles}
      lens={lens}
      chosen={chosen}
      open={open}
      pinned={open !== null && open === pinned}
      focus={focus}
      read={openCircle === undefined ? "" : readWords(openCircle.meters, clock)}
      addOpen={pointed === ADD_TARGET}
      canAdd={openNewProfile !== undefined}
      moment={moment}
      onPoint={setPointed}
      onCircle={(setId) => {
        if (!lens) {
          setPinned((held) => (held === setId ? null : setId));
          return;
        }
        // the lens: a click shows only its sessions and pins its popover; on the chosen one, all again, closed
        const clears = chosen === setId;
        onChoose(clears ? null : setId);
        setPinned(clears ? null : setId);
      }}
      onClose={() => {
        setPinned(null);
        setPointed(null);
      }}
      onFocusPlan={setFocus}
      onAdd={() => openNewProfile?.()}
      onOpenProfile={(setId) => openProfile?.(setId)}
      onRetry={(profileIds) => {
        port?.refresh?.(profileIds).catch(() => undefined);
      }}
    />
  );
}

/** M195's rule for the stage's chrome: the monitor renders on every model publish, and the column renders only when
 * one of its own inputs moves. */
export const ProfilesColumn = memo(ProfilesColumnController);
