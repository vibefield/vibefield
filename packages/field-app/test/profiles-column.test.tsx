// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAccountUsageEntry, AgentProfileSet } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_DEMO,
  FIXTURE_NATIVE,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_PROFILES_NOW,
  FIXTURE_WORK,
} from "../src/design-system/profiles-fixtures";
import { monitorHoldsKeys } from "../src/godview/monitor/launcher-keys";
import { BandsCircle, BandsKey } from "../src/godview/profiles-column/BandsCircle";
import { ProfilePopoverView, readWords } from "../src/godview/profiles-column/ProfilePopoverView";
import {
  ProfilesColumn,
  type ProfilesColumnProps,
} from "../src/godview/profiles-column/ProfilesColumn";
import {
  ADD_TARGET,
  type ColumnCircle,
  ProfilesColumnView,
  type ProfilesColumnViewProps,
} from "../src/godview/profiles-column/ProfilesColumnView";
import { resetWords } from "../src/panels/agents/profiles-model";
import { PROFILES_WORDS } from "../src/setup/profiles-words";
import { bandsGeometry } from "../src/usage/bands";
import {
  type MetersOptions,
  type NoMeterReason,
  type PlanMeter,
  type ProfileMeters,
  planMeters,
} from "../src/usage/meters";

// UM-3 (2b; DESIGN.md §8 "The Bands circle" and "Godview's profiles column", §9 "The meters' words"): the column's
// three views, controller-free, so the catalog mounts the shipping faces. Every number is the model's
// (`src/usage/meters.ts`, `src/usage/bands.ts`): these rows pin what the views SAY and which acts they hand back, and
// that they draw the geometry they are given — never a second reading of it.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(
  join(HERE, "..", "src", "godview", "profiles-column", "profiles-column.css"),
  "utf8",
);

const NOW = FIXTURE_PROFILES_NOW;
const READINGS: readonly AgentAccountUsageEntry[] = FIXTURE_PROFILES_CONTEXT.usage;
const INSTALLED: ReadonlySet<string> = new Set(
  FIXTURE_PROFILES_CONTEXT.installs.map((install) => install.provider),
);

function metersOf(
  set: AgentProfileSet,
  rows: readonly AgentAccountUsageEntry[] = READINGS,
  options: MetersOptions = {},
): ProfileMeters {
  return planMeters(set, rows, NOW, { installed: INSTALLED, ...options });
}

/** The fixture's readings with one row changed: the row of the sign-in that names `set`'s first plan. */
function withNamer(
  set: AgentProfileSet,
  change: (row: AgentAccountUsageEntry) => AgentAccountUsageEntry,
): AgentAccountUsageEntry[] {
  const namer = set.plans?.[0]?.namedBy;
  const persona = set.personas.find((each) => each.profileId === namer);
  return READINGS.map((row) =>
    row.provider === persona?.provider &&
    (row.profileId === namer || (row.profileId === undefined && persona.kind === "native-default"))
      ? change(row)
      : row,
  );
}

/** every window of every reading at 100%: hot by Settings' rule */
const HOT = READINGS.map((row) => ({
  ...row,
  metrics: row.metrics.map((metric) => ({ ...metric, usedPercent: 100 })),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;
let layer: HTMLElement | null = null;

/** The cards layer as `GodviewMonitor` stands it: a sibling of the stage, outside the column's own DOM. */
function cardLayer(): HTMLElement {
  layer = document.createElement("div");
  layer.className = "vf-monitor-cards";
  document.body.appendChild(layer);
  return layer;
}

function mount(element: ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  layer?.remove();
  layer = null;
  vi.restoreAllMocks();
});

const thisMac = (): ColumnCircle => ({ set: FIXTURE_NATIVE, meters: metersOf(FIXTURE_NATIVE) });
const work = (): ColumnCircle => ({ set: FIXTURE_WORK, meters: metersOf(FIXTURE_WORK) });

function column(over: Partial<ProfilesColumnViewProps> = {}): ProfilesColumnViewProps {
  return {
    circles: [thisMac()],
    lens: false,
    chosen: null,
    open: null,
    pinned: false,
    focus: null,
    read: "",
    addOpen: false,
    canAdd: true,
    canOpen: true,
    canRetry: true,
    chosenPlanFamily: null,
    onChoosePlan: vi.fn(),
    onPoint: vi.fn(),
    onCircle: vi.fn(),
    onClose: vi.fn(),
    onFocusPlan: vi.fn(),
    onAdd: vi.fn(),
    onOpenProfile: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  };
}

/** The stage controller as the monitor mounts it, its clock pinned so no interval starts. */
function controller(over: Partial<ProfilesColumnProps> = {}): ProfilesColumnProps {
  return {
    sets: [FIXTURE_NATIVE, FIXTURE_WORK],
    rows: READINGS,
    usageUnavailable: false,
    chosen: null,
    onChoose: vi.fn(),
    chosenPlanFamily: null,
    onChoosePlan: vi.fn(),
    now: NOW,
    ...over,
  };
}

const tightest = (meters: ProfileMeters): number =>
  Math.round(meters.tightest?.tightest.line.usedPercent ?? Number.NaN);

/* ── the Bands circle ─────────────────────────────────────────────────────── */

describe("the Bands circle (UM-D16): the model's geometry drawn, never re-derived", () => {
  it("draws each arc and notch the geometry holds, said as an image in bandsLabel's words when labelled", () => {
    const meters = metersOf(FIXTURE_NATIVE);
    const geometry = bandsGeometry(212, meters.entries, { hit: true });
    const page = mount(<BandsCircle geometry={geometry} labelled />);
    const image = page.querySelector('[role="img"]');
    expect(image?.getAttribute("aria-label")).toBe(geometry.label);
    expect(geometry.label.startsWith("Usage: ")).toBe(true);
    const arcs = geometry.plans.flatMap((plan) => plan.arcs);
    expect(page.querySelectorAll("path[data-part]")).toHaveLength(arcs.length);
    expect(page.querySelectorAll('line[data-part="notch"]')).toHaveLength(
      geometry.plans.flatMap((plan) => plan.notches).length,
    );
    expect(page.querySelectorAll("path[data-hit]")).toHaveLength(geometry.plans.length);
  });

  it("is its control's picture when unlabelled: nothing in it is said", () => {
    const geometry = bandsGeometry(40, metersOf(FIXTURE_NATIVE).entries, {
      centre: "glyph",
      hotDot: true,
    });
    const page = mount(<BandsCircle geometry={geometry} profile={FIXTURE_NATIVE} />);
    expect(page.querySelector('[role="img"]')).toBeNull();
    expect(page.querySelector(".vf-bands")?.getAttribute("aria-hidden")).toBe("true");
    expect(page.querySelector(".vf-bands-glyph")).not.toBeNull();
  });

  it("keeps the profile's glyph in the dashed circle while the usage cannot be read", () => {
    const meters = metersOf(FIXTURE_WORK, [], { usage: "unavailable" });
    const geometry = bandsGeometry(40, meters.entries, { centre: "glyph", hotDot: true });
    expect(geometry.empty).toBeDefined();
    const page = mount(<BandsCircle geometry={geometry} profile={FIXTURE_WORK} />);
    const ring = page.querySelector('circle[data-part="empty"]');
    expect(ring?.getAttribute("stroke-dasharray")).toBe("2 3");
    expect(page.querySelector(".vf-bands-glyph")).not.toBeNull();
    expect(page.querySelector('[data-part="hot-dot"]')).toBeNull();
  });

  it("wears the hot dot in --vf-orange, ringed in the ground it stands on, while a plan runs hot", () => {
    const meters = metersOf(FIXTURE_NATIVE, HOT);
    expect(meters.hot).toBe(true);
    const geometry = bandsGeometry(40, meters.entries, { centre: "glyph", hotDot: true });
    const page = mount(<BandsCircle geometry={geometry} profile={FIXTURE_NATIVE} />);
    const dot = page.querySelector<SVGElement>('[data-part="hot-dot"]');
    expect(dot?.style.fill).toBe("var(--vf-orange)");
    expect(dot?.style.stroke).toBe("var(--vf-bands-ground)");
  });

  it("paints tones through the stage's tokens, never a literal colour", () => {
    const meters = metersOf(FIXTURE_NATIVE, HOT);
    const geometry = bandsGeometry(212, meters.entries, { hit: true });
    const page = mount(<BandsCircle geometry={geometry} labelled />);
    const paints = [...page.querySelectorAll<SVGElement>("[data-part]")]
      .flatMap((node) => [node.style.stroke, node.style.fill])
      .filter((paint) => paint !== "" && paint !== "none" && paint !== "transparent");
    expect(paints.length).toBeGreaterThan(0);
    for (const paint of paints) {
      expect(paint, paint).toMatch(/var\(--vf-/);
      expect(paint, paint).not.toMatch(/#[\da-f]{3,8}\b/i);
    }
  });

  it("breathes a first read on the breath's class, its one loop", () => {
    const meters = metersOf(FIXTURE_NATIVE, []);
    expect(meters.entries.some((entry) => entry.kind === "first-read")).toBe(true);
    const geometry = bandsGeometry(40, meters.entries, { centre: "glyph" });
    const page = mount(<BandsCircle geometry={geometry} profile={FIXTURE_NATIVE} />);
    expect(page.querySelectorAll(".vf-bands-breath").length).toBeGreaterThan(0);
    expect(page.querySelectorAll(".vf-bands-breath")).toHaveLength(
      page.querySelectorAll('[data-part="breath"]').length,
    );
  });

  it("hands the plan a pointer is on at the open size, and lets it go", () => {
    const meters = metersOf(FIXTURE_NATIVE);
    const geometry = bandsGeometry(212, meters.entries, { hit: true });
    const onFocusPlan = vi.fn();
    const page = mount(<BandsCircle geometry={geometry} labelled onFocusPlan={onFocusPlan} />);
    const first = geometry.plans[0];
    const hit = page.querySelector(`path[data-hit="${first?.key}"]`);
    act(() => {
      hit?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(onFocusPlan).toHaveBeenLastCalledWith(first?.key);
    act(() => {
      hit?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    });
    expect(onFocusPlan).toHaveBeenLastCalledWith(null);
  });

  it("says the bands key's three words, said as the key", () => {
    const page = mount(<BandsKey />);
    const key = page.querySelector(".vf-profiles-key");
    expect(key?.textContent).toBe("5 hours7 daysa model's week");
    expect(key?.getAttribute("aria-label")).toBe(
      "Inside, the next five hours; outside, the week; a hairline, a model's own week",
    );
  });
});

/* ── the column ───────────────────────────────────────────────────────────── */

describe("the profiles column (UM-D21, UM-D19, UM-D22): said as DESIGN.md §9 says it", () => {
  it("with one profile is This Mac: a plain button that opens its popover, not pressable, and the add under it", () => {
    const circle = thisMac();
    const page = mount(<ProfilesColumnView {...column({ circles: [circle] })} />);
    const group = page.querySelector('.vf-profiles-column[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Agent profiles");
    const buttons = [...page.querySelectorAll<HTMLButtonElement>(".vf-profiles-circle")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("aria-label")).toBe(
      `This Mac, tightest ${tightest(circle.meters)}%`,
    );
    expect(buttons[0]?.hasAttribute("aria-pressed")).toBe(false);
    const add = page.querySelector<HTMLButtonElement>(".vf-profiles-add");
    expect(add?.getAttribute("aria-label")).toBe("Add a profile…");
    expect(group?.lastElementChild?.contains(add ?? null)).toBe(true);
  });

  it("with several, each circle is the lens: a toggle pressed on the chosen profile, said with its lens words", () => {
    const circles = [thisMac(), work()];
    const page = mount(<ProfilesColumnView {...column({ circles, lens: true, chosen: "work" })} />);
    const [mac, chosen] = [...page.querySelectorAll<HTMLButtonElement>(".vf-profiles-circle")];
    expect(mac?.getAttribute("aria-pressed")).toBe("false");
    expect(mac?.getAttribute("aria-label")).toBe(
      `This Mac, tightest ${tightest(circles[0]?.meters as ProfileMeters)}%, click to show only its sessions`,
    );
    expect(chosen?.getAttribute("aria-pressed")).toBe("true");
    expect(chosen?.getAttribute("aria-label")).toBe(
      `Work, tightest ${tightest(circles[1]?.meters as ProfileMeters)}%, showing only its sessions`,
    );
  });

  it("says a circle with nothing on it in the Bands circle's own words: its usage unavailable, or no meters (§8 'Honest states')", () => {
    // the review: the dashed circle was said by its name alone ("Work"), its honest state unsaid
    const unread = (set: AgentProfileSet): ColumnCircle => ({
      set,
      meters: metersOf(set, [], { usage: "unavailable" }),
    });
    const said = (props: ProfilesColumnViewProps): (string | null)[] =>
      [...mount(<ProfilesColumnView {...props} />).querySelectorAll(".vf-profiles-circle")].map(
        (circle) => circle.getAttribute("aria-label"),
      );
    expect(said(column({ circles: [unread(FIXTURE_WORK)] }))).toEqual(["Work: usage unavailable"]);
    // a profile with no plans has no meters whether or not the usage can be read
    expect(
      said(column({ circles: [unread(FIXTURE_WORK), unread(FIXTURE_DEMO)], lens: true })),
    ).toEqual([
      "Work: usage unavailable, click to show only its sessions",
      "Client demo, no meters, click to show only its sessions",
    ]);
  });

  it("hands its acts back: a circle's click, the pointer on a circle and off it, the add", () => {
    const props = column({ circles: [thisMac(), work()], lens: true });
    const page = mount(<ProfilesColumnView {...props} />);
    const item = page.querySelector<HTMLElement>('.vf-profiles-item[data-profile="work"]');
    act(() => {
      item?.querySelector<HTMLButtonElement>(".vf-profiles-circle")?.click();
    });
    expect(props.onCircle).toHaveBeenCalledWith("work");
    act(() => {
      item?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(props.onPoint).toHaveBeenLastCalledWith("work");
    act(() => {
      page.querySelector<HTMLButtonElement>(".vf-profiles-add")?.click();
    });
    expect(props.onAdd).toHaveBeenCalledOnce();
  });

  it("draws the add disabled while Settings is open (nothing to open)", () => {
    const props = column({ canAdd: false });
    const page = mount(<ProfilesColumnView {...props} />);
    const add = page.querySelector<HTMLButtonElement>(".vf-profiles-add");
    expect(add?.disabled).toBe(true);
    act(() => add?.click());
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("points the add at its card: AO-5's offer and fact, and where it opens", () => {
    const page = mount(<ProfilesColumnView {...column({ addOpen: true })} />);
    const card = page.querySelector(".vf-profiles-addcard");
    expect(card?.textContent).toBe(
      `${PROFILES_WORDS.add}${PROFILES_WORDS.offer} ${PROFILES_WORDS.fact}Opens Settings → Agent Profiles on New profile…`,
    );
    expect(
      mount(<ProfilesColumnView {...column()} />).querySelector(".vf-profiles-addcard"),
    ).toBeNull();
  });

  it("stands the limit moment in the add's card's place (UM-D23)", () => {
    const page = mount(
      <ProfilesColumnView {...column({ addOpen: true, moment: <p data-moment="">limit</p> })} />,
    );
    const slot = page.querySelector(".vf-profiles-add-item > .vf-profiles-moment");
    expect(slot?.querySelector("[data-moment]")).toBeTruthy();
    // the moment's card hides the add's card while it stands (it says nothing when it is not due). UM-R1 moved the
    // card to a portaled stand, so the rule reads the moment from the root and hides the stand wherever it stands
    expect(CSS).toMatch(
      /\.vf-godview:has\(\.vf-profiles-add-item > \.vf-profiles-moment > \*\)\s+\.vf-profiles-stand\[data-card="add"\] \{\s*display: none;/u,
    );
  });

  it("pointing at the limit card is not pointing at the add (UM-R4)", () => {
    const props = column({ moment: <p data-moment="">limit</p> });
    const page = mount(<ProfilesColumnView {...props} />);
    const slot = page.querySelector(".vf-profiles-add-item > .vf-profiles-moment");
    expect(slot).not.toBeNull();
    act(() => {
      slot
        ?.querySelector("[data-moment]")
        ?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(props.onPoint).not.toHaveBeenCalledWith(ADD_TARGET);
    // the add itself still is
    act(() => {
      page
        .querySelector(".vf-profiles-add")
        ?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(props.onPoint).toHaveBeenLastCalledWith(ADD_TARGET);
  });

  it("opens the popover of the profile it is told, and only that one", () => {
    const page = mount(
      <ProfilesColumnView
        {...column({ circles: [thisMac(), work()], lens: true, open: "work" })}
      />,
    );
    const pops = page.querySelectorAll(".vf-profiles-pop");
    expect(pops).toHaveLength(1);
    expect(
      page.querySelector('.vf-profiles-item[data-profile="work"] .vf-profiles-pop'),
    ).not.toBeNull();
    expect(
      page
        .querySelector('.vf-profiles-item[data-profile="work"] .vf-profiles-circle')
        ?.hasAttribute("data-open"),
    ).toBe(true);
  });
});

/* ── the popover ──────────────────────────────────────────────────────────── */

describe("the popover (DESIGN.md §8 'Godview's profiles column')", () => {
  function popover(
    circle: ColumnCircle,
    over: Partial<Parameters<typeof ProfilePopoverView>[0]> = {},
  ): Parameters<typeof ProfilePopoverView>[0] {
    return {
      circle,
      lens: false,
      chosen: false,
      focus: null,
      read: "Read a minute ago",
      canOpen: true,
      canRetry: true,
      chosenPlanFamily: null,
      onChoosePlan: vi.fn(),
      onClose: vi.fn(),
      onFocusPlan: vi.fn(),
      onOpenProfile: vi.fn(),
      onRetry: vi.fn(),
      ...over,
    };
  }

  it("heads with the profile's name, the default tag only among several, the reading's age and its ×", () => {
    const props = popover(thisMac(), { lens: true });
    const page = mount(<ProfilePopoverView {...props} />);
    const pop = page.querySelector('.vf-profiles-pop[role="dialog"]');
    expect(pop?.getAttribute("aria-label")).toBe("This Mac");
    expect(page.querySelector(".vf-profiles-pop-name")?.textContent).toBe("This Mac");
    expect(page.querySelector(".vf-profiles-pop-tag")?.textContent).toBe("default");
    expect(page.querySelector(".vf-profiles-pop-age")?.textContent).toBe("Read a minute ago");
    act(() => {
      page.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    });
    expect(props.onClose).toHaveBeenCalledOnce();
    const alone = mount(<ProfilePopoverView {...popover(thisMac())} />);
    expect(alone.querySelector(".vf-profiles-pop-tag")).toBeNull();
  });

  it("draws the circle at 212 with its arcs answering the pointer, and the bands key under it", () => {
    const page = mount(<ProfilePopoverView {...popover(thisMac())} />);
    const circle = page.querySelector<HTMLElement>(".vf-profiles-pop .vf-bands");
    expect(circle?.style.width).toBe("212px");
    expect(circle?.getAttribute("role")).toBe("img");
    expect(page.querySelectorAll("path[data-hit]").length).toBeGreaterThan(0);
    expect(page.querySelector(".vf-profiles-key")).not.toBeNull();
  });

  it("lists one row per plan on the circle in its order: the title, the right words and Settings' C1 line", () => {
    const circle = thisMac();
    const page = mount(<ProfilePopoverView {...popover(circle)} />);
    const shown = circle.meters.entries.filter((entry) => entry.kind !== "no-meter");
    const rows = [...page.querySelectorAll<HTMLElement>(".vf-profiles-pop-row")];
    expect(rows.map((row) => row.dataset.plan)).toEqual(shown.map((entry) => entry.key));
    expect(rows.map((row) => row.querySelector(".vf-profiles-pop-row-title")?.textContent)).toEqual(
      shown.map((entry) => entry.title),
    );
    const reading = shown.find((entry) => entry.kind === "reading");
    const row = rows.find((each) => each.dataset.plan === reading?.key);
    expect(row?.querySelector(".vf-profiles-pop-row-right")?.textContent).toBe(
      reading?.kind === "reading" ? reading.right.words : "",
    );
    // the shipping C1 line (UsageTimeline), its tightest window alone
    expect(row?.querySelectorAll('.vf-profiles-usage [role="listitem"]')).toHaveLength(1);
  });

  it("draws Settings' C1 line in a row at 196 × 12 (§8), Settings' own 14 track taken down to 12", () => {
    // the review: the width was capped at 196 and the track kept Settings' 14; the line measures its track's height
    // (UsageLineView), so its now line follows
    expect(CSS).toMatch(/\n\.vf-profiles-pop-row-meter \{[^}]*max-width: 196px;/u);
    expect(CSS).toContain(
      "\n.vf-profiles-pop-row-meter .vf-profiles-usage-track {\n  height: 12px;\n}",
    );
  });

  /** The reading rows of a circle, with the bare and the union key of each. */
  function readingRows(circle: ColumnCircle): { key: string; union: string; title: string }[] {
    return circle.meters.entries
      .filter((entry) => entry.kind === "reading")
      .map((entry) => ({
        key: entry.key,
        union: `${circle.set.id}/${entry.key}`,
        title: entry.title,
      }));
  }
  const rowOf = (page: HTMLElement, key: string): HTMLElement =>
    page.querySelector<HTMLElement>(`.vf-profiles-pop-row[data-plan="${key}"]`) as HTMLElement;
  const chooseButton = (row: HTMLElement | null): HTMLButtonElement | null =>
    row?.querySelector<HTMLButtonElement>("button.vf-profiles-pop-row-choose") ?? null;

  it("a plan's row is a toggle: a pressable button stretched over it, handing back ‹set›/‹key›; the others dim; a need row has none (UM-5a)", () => {
    const circle = thisMac();
    const [first, second] = readingRows(circle);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const props = popover(circle);
    const page = mount(<ProfilePopoverView {...props} />);
    const row = rowOf(page, first.key);
    // still a list's row: the C1 line and its [role=listitem] are found inside a div
    expect(row.tagName).toBe("DIV");
    expect(row.querySelector('[role="listitem"]')).not.toBeNull();
    const button = chooseButton(row);
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(button?.getAttribute("aria-label")).toBe(`Show only ${first.title}'s sessions`);
    expect(row.firstElementChild).toBe(button);
    act(() => button?.click());
    expect(props.onChoosePlan).toHaveBeenCalledWith(first.union);

    const chosen = mount(
      <ProfilePopoverView {...popover(circle, { chosenPlanFamily: [first.union] })} />,
    );
    const on = rowOf(chosen, first.key);
    expect(on.hasAttribute("data-pressed")).toBe(true);
    expect(on.hasAttribute("data-dim")).toBe(false);
    expect(chooseButton(on)?.getAttribute("aria-pressed")).toBe("true");
    const other = rowOf(chosen, second.key);
    expect(other.hasAttribute("data-dim")).toBe(true);
    expect(other.hasAttribute("data-pressed")).toBe(false);
    // the numbers are the design's: the ready fill and a 1.5 inset ring, the others at 50%
    expect(CSS).toMatch(
      /\.vf-profiles-pop-row\[data-pressed\] \{[^}]*color-mix\(in srgb, var\(--vf-foreground\) 8%, transparent\);[^}]*inset 0 0 0 1\.5px var\(--vf-foreground\);/u,
    );
    expect(CSS).toMatch(/\.vf-profiles-pop-row\[data-dim\] \{[^}]*opacity: 0\.5;/u);

    const retrying = metersOf(
      FIXTURE_WORK,
      withNamer(FIXTURE_WORK, (entry) => ({ ...entry, state: "unavailable", metrics: [] })),
    );
    const need = retrying.entries.find((entry) => entry.kind === "needs-you");
    const needPage = mount(
      <ProfilePopoverView {...popover({ set: FIXTURE_WORK, meters: retrying })} />,
    );
    expect(chooseButton(rowOf(needPage, need?.key ?? ""))).toBeNull();
  });

  /** Work with its first plan's reading down: a row that needs you (Retry) beside rows that can be chosen. */
  function retryingWork(): {
    circle: ColumnCircle;
    need: PlanMeter;
    other: { key: string; union: string; title: string };
  } {
    const meters = metersOf(
      FIXTURE_WORK,
      withNamer(FIXTURE_WORK, (entry) => ({ ...entry, state: "unavailable", metrics: [] })),
    );
    const circle = { set: FIXTURE_WORK, meters };
    const need = meters.entries.find((entry) => entry.kind === "needs-you");
    const [other] = readingRows(circle);
    if (need === undefined || other === undefined)
      throw new Error("fixture: no need or no reading");
    return { circle, need, other };
  }

  it("a chosen plan that turns to need you draws no press, and the foot stops offering the click it cannot take (UM-5a)", () => {
    const { circle, need } = retryingWork();
    const page = mount(
      <ProfilePopoverView
        {...popover(circle, { chosenPlanFamily: [`${circle.set.id}/${need.key}`] })}
      />,
    );
    const row = rowOf(page, need.key);
    expect(row.hasAttribute("data-pressed")).toBe(false);
    expect(row.querySelector("[aria-pressed]")).toBeNull();
    // the filter stands, so the rows that can be chosen stay dim and can move it; nothing there can be clicked again
    expect(page.querySelector(".vf-profiles-pop-lens")?.textContent).toBe(
      "Click a plan to show only its sessions",
    );
  });

  it("a row that needs you keeps its full ink while another plan is chosen: it holds an act (UM-5a)", () => {
    const { circle, need, other } = retryingWork();
    const page = mount(
      <ProfilePopoverView {...popover(circle, { chosenPlanFamily: [other.union] })} />,
    );
    expect(rowOf(page, need.key).hasAttribute("data-dim")).toBe(false);
    expect(rowOf(page, other.key).hasAttribute("data-pressed")).toBe(true);
  });

  it("with one profile and no plan that can be chosen the foot offers none, and Agent Profiles… stands (UM-5a)", () => {
    const { circle } = retryingWork();
    const needsOnly: ColumnCircle = {
      set: circle.set,
      meters: {
        ...circle.meters,
        entries: circle.meters.entries.filter((entry) => entry.kind === "needs-you"),
      },
    };
    const allNeed = mount(<ProfilePopoverView {...popover(needsOnly)} />);
    expect(allNeed.querySelector(".vf-profiles-pop-lens")).toBeNull();
    expect(allNeed.querySelector(".vf-profiles-pop-foot button")?.textContent).toBe(
      "Agent Profiles…",
    );
    const unreadable: ColumnCircle = {
      set: FIXTURE_NATIVE,
      meters: metersOf(FIXTURE_NATIVE, READINGS, { usage: "unavailable" }),
    };
    expect(unreadable.meters.entries.every((entry) => entry.kind === "no-meter")).toBe(true);
    const none = mount(<ProfilePopoverView {...popover(unreadable)} />);
    expect(none.querySelector(".vf-profiles-pop-lens")).toBeNull();
    // with several profiles the lens's words stand: the circle can always be clicked
    const lens = mount(<ProfilePopoverView {...popover(unreadable, { lens: true })} />);
    expect(lens.querySelector(".vf-profiles-pop-lens")?.textContent).toContain("Click it to show");
  });

  it("twins: a family's row draws pressed in the other profile's popover, and its click clears (UM-5a)", () => {
    const circle = thisMac();
    const [first] = readingRows(circle);
    if (first === undefined) throw new Error("no reading row");
    const props = popover(circle, {
      chosenPlanFamily: [first.union, "work/plan:anthropic"],
    });
    const page = mount(<ProfilePopoverView {...props} />);
    const button = chooseButton(rowOf(page, first.key));
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    act(() => button?.click());
    expect(props.onChoosePlan).toHaveBeenCalledWith(null);
  });

  it("an arc in the open circle chooses as its row does; a need arc chooses nothing, and the popover stays (UM-5a)", () => {
    const circle = thisMac();
    const [first] = readingRows(circle);
    if (first === undefined) throw new Error("no reading row");
    const props = popover(circle);
    const page = mount(<ProfilePopoverView {...props} />);
    const arc = page.querySelector(`path[data-hit="${first.key}"]`);
    expect(arc?.hasAttribute("data-choosable")).toBe(true);
    act(() => arc?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(props.onChoosePlan).toHaveBeenCalledWith(first.union);
    expect(props.onClose).not.toHaveBeenCalled();

    const retrying = metersOf(
      FIXTURE_WORK,
      withNamer(FIXTURE_WORK, (entry) => ({ ...entry, state: "unavailable", metrics: [] })),
    );
    const need = retrying.entries.find((entry) => entry.kind === "needs-you");
    const needProps = popover({ set: FIXTURE_WORK, meters: retrying });
    const needPage = mount(<ProfilePopoverView {...needProps} />);
    const needArc = needPage.querySelector(`path[data-hit="${need?.key}"]`);
    expect(needArc?.hasAttribute("data-choosable")).toBe(false);
    act(() => needArc?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(needProps.onChoosePlan).not.toHaveBeenCalled();
  });

  it("says what a plan needs with its act: Sign in opens the profile's page, Retry reads that sign-in again", () => {
    const retrying = metersOf(
      FIXTURE_WORK,
      withNamer(FIXTURE_WORK, (row) => ({ ...row, state: "unavailable", metrics: [] })),
    );
    const retry = retrying.entries.find((entry) => entry.kind === "needs-you");
    expect(retry?.kind === "needs-you" && retry.need).toBe("retry");
    const props = popover({ set: FIXTURE_WORK, meters: retrying });
    const page = mount(<ProfilePopoverView {...props} />);
    const row = page.querySelector<HTMLElement>(`.vf-profiles-pop-row[data-plan="${retry?.key}"]`);
    expect(row?.querySelector(".vf-profiles-pop-row-right")?.textContent).toBe("couldn't read");
    act(() => {
      row?.querySelector<HTMLButtonElement>(".vf-profiles-pop-row-act")?.click();
    });
    expect(props.onRetry).toHaveBeenCalledWith([retry?.profileId]);

    const signing = metersOf(
      FIXTURE_WORK,
      withNamer(FIXTURE_WORK, (each) => ({ ...each, state: "unauthenticated", metrics: [] })),
    );
    const signIn = signing.entries.find((entry) => entry.kind === "needs-you");
    const asks = popover({ set: FIXTURE_WORK, meters: signing });
    const page2 = mount(<ProfilePopoverView {...asks} />);
    const row2 = page2.querySelector<HTMLElement>(
      `.vf-profiles-pop-row[data-plan="${signIn?.key}"]`,
    );
    expect(row2?.querySelector(".vf-profiles-pop-row-right")?.textContent).toBe("not signed in");
    expect(row2?.querySelector(".vf-profiles-pop-row-act")?.textContent).toBe("Sign in");
    act(() => {
      row2?.querySelector<HTMLButtonElement>(".vf-profiles-pop-row-act")?.click();
    });
    expect(asks.onOpenProfile).toHaveBeenCalledWith("work");
  });

  it("offers no act it cannot take: Sign in and Agent Profiles… draw disabled while Settings is open, and no Retry stands without a door that reads again (§8 'No act is inert')", () => {
    // the review: both stayed enabled and did nothing while Settings was open, as Retry did with no door to ask
    const signing = metersOf(
      FIXTURE_WORK,
      withNamer(FIXTURE_WORK, (each) => ({ ...each, state: "unauthenticated", metrics: [] })),
    );
    const shut = popover({ set: FIXTURE_WORK, meters: signing }, { canOpen: false });
    const page = mount(<ProfilePopoverView {...shut} />);
    const opens = [
      page.querySelector<HTMLButtonElement>(".vf-profiles-pop-row-act"),
      page.querySelector<HTMLButtonElement>(".vf-profiles-pop-open"),
    ];
    expect(opens.map((button) => button?.textContent)).toEqual(["Sign in", "Agent Profiles…"]);
    for (const button of opens) {
      expect(button?.disabled).toBe(true);
      act(() => button?.click());
    }
    expect(shut.onOpenProfile).not.toHaveBeenCalled();
    // off, their words wear t4 at full opacity (§2.4 "Off"), as the add's `plus` does
    for (const off of [".vf-profiles-pop-row-act:disabled", ".vf-profiles-pop-open:disabled"]) {
      expect(CSS).toContain(`\n${off} {\n  color: var(--vf-text-faint);\n  cursor: default;\n}`);
    }

    const retrying = metersOf(
      FIXTURE_WORK,
      withNamer(FIXTURE_WORK, (row) => ({ ...row, state: "unavailable", metrics: [] })),
    );
    const retry = retrying.entries.find((entry) => entry.kind === "needs-you");
    const blind = mount(
      <ProfilePopoverView
        {...popover({ set: FIXTURE_WORK, meters: retrying }, { canRetry: false })}
      />,
    );
    const row = blind.querySelector(`.vf-profiles-pop-row[data-plan="${retry?.key}"]`);
    expect(row?.querySelector(".vf-profiles-pop-row-right")?.textContent).toBe("couldn't read");
    expect(row?.querySelector(".vf-profiles-pop-row-act")).toBeNull();
  });

  it("says an agent with no meter in a line of its own", () => {
    const circle = thisMac();
    const none = circle.meters.entries.filter(
      (entry) => entry.kind === "no-meter" && entry.why !== "unavailable",
    );
    const page = mount(<ProfilePopoverView {...popover(circle)} />);
    expect(
      [...page.querySelectorAll(".vf-profiles-pop-none")].map((line) => line.textContent),
    ).toEqual(
      none.map((entry) =>
        entry.kind === "no-meter" && entry.why === "unreported"
          ? `${entry.agent} shows no meter`
          : entry.title,
      ),
    );
  });

  it("says a plan no agent named, or whose reading holds no window, by its title alone, as the phone does (§9 ‹for James›)", () => {
    // "shows no meter" is an agent that reports no usage; said of the other two it would be false of an agent
    // that meters (UM-D3, one meter everywhere; the phone since UM-4d)
    const circle = thisMac();
    const first = circle.meters.entries[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const none = (why: NoMeterReason, key: string, title: string): PlanMeter => ({
      key,
      provider: first.provider,
      agent: first.agent,
      title,
      profiles: first.profiles,
      kind: "no-meter",
      why,
    });
    const meters: ProfileMeters = {
      ...circle.meters,
      entries: [
        none("unreported", "agent:quiet", first.agent),
        none("unnamed", "plan:unnamed", "Team plan"),
        none("no-windows", "agent:empty", "Empty reading"),
      ],
    };
    const page = mount(<ProfilePopoverView {...popover({ set: circle.set, meters })} />);
    expect(
      [...page.querySelectorAll(".vf-profiles-pop-none")].map((line) => line.textContent),
    ).toEqual([`${first.agent} shows no meter`, "Team plan", "Empty reading"]);
    // each keeps its agent's mark
    expect(
      page.querySelectorAll(".vf-profiles-pop-none > .vf-profiles-pop-none-mark"),
    ).toHaveLength(3);
  });

  it.each([
    ["three days off, by its day and clock", 3 * 24 * 60],
    ["ten minutes past, now", -10],
  ])(
    "says its tightest window's reset as Settings' line does: %s (§9 ‹for James›)",
    (_, minutes) => {
      const at = new Date(NOW.getTime() + minutes * 60_000);
      // every window of the plan Work's first namer reads, its reset moved
      const rows = withNamer(FIXTURE_WORK, (row) => ({
        ...row,
        metrics: row.metrics.map((metric) => ({ ...metric, resetsAt: at.toISOString() })),
      }));
      const meters = metersOf(FIXTURE_WORK, rows);
      const entry = meters.entries.find(
        (each) => each.kind === "reading" && each.plan?.id === FIXTURE_WORK.plans?.[0]?.id,
      );
      expect(entry?.kind).toBe("reading");
      if (entry?.kind !== "reading") return;
      const line = entry.tightest.line;
      expect(line.reset).toBe(resetWords(at, NOW));
      const page = mount(<ProfilePopoverView {...popover({ set: FIXTURE_WORK, meters })} />);
      expect(
        page
          .querySelector(`.vf-profiles-pop-row[data-plan="${entry.key}"] [role="listitem"]`)
          ?.getAttribute("aria-label"),
      ).toBe(
        `${line.group !== undefined ? `${line.group.label}, ` : ""}${line.label}: ${Math.round(
          line.usedPercent,
        )}% used, resets ${line.reset}${line.hot ? ", ahead of pace" : ""}`,
      );
    },
  );

  it("while the usage cannot be read, says the profile's one line, never a line per agent (§9)", () => {
    // the review: each agent said "‹agent›: usage unavailable", words §9 does not rule; the profile's are ruled
    const meters = metersOf(FIXTURE_WORK, [], { usage: "unavailable" });
    expect(
      meters.entries.filter((entry) => entry.kind === "no-meter" && entry.why === "unavailable")
        .length,
    ).toBeGreaterThan(1);
    const page = mount(<ProfilePopoverView {...popover({ set: FIXTURE_WORK, meters })} />);
    const lines = [...page.querySelectorAll(".vf-profiles-pop-none")].map(
      (line) => line.textContent ?? "",
    );
    expect(lines.filter((line) => line.endsWith(": usage unavailable"))).toEqual([
      "Work: usage unavailable",
    ]);
  });

  it("dims every other plan to 28% while the pointer is on one, on the circle and in the rows", () => {
    const circle = thisMac();
    const shown = circle.meters.entries.filter((entry) => entry.kind !== "no-meter");
    const [first, second] = shown;
    expect(second).toBeDefined();
    const page = mount(<ProfilePopoverView {...popover(circle, { focus: first?.key ?? null })} />);
    const others = page.querySelectorAll<SVGElement>(`path[data-plan="${second?.key}"][data-part]`);
    expect(others.length).toBeGreaterThan(0);
    for (const arc of others) expect(arc.style.opacity).toBe("0.28");
    expect(
      page
        .querySelector(`.vf-profiles-pop-row[data-plan="${first?.key}"]`)
        ?.hasAttribute("data-focus"),
    ).toBe(true);
  });

  it("feet: with several profiles the lens's words, with one the plan's words; Agent Profiles… opens that profile", () => {
    const unchosen = mount(<ProfilePopoverView {...popover(work(), { lens: true })} />);
    expect(unchosen.querySelector(".vf-profiles-pop-lens")?.textContent).toBe(
      "Click it to show only Work's sessions",
    );
    const chosen = mount(<ProfilePopoverView {...popover(work(), { lens: true, chosen: true })} />);
    expect(chosen.querySelector(".vf-profiles-pop-lens")?.textContent).toBe(
      "Showing only Work's sessions · click it again for all",
    );
    const props = popover(thisMac());
    const alone = mount(<ProfilePopoverView {...props} />);
    expect(alone.querySelector(".vf-profiles-pop-lens")?.textContent).toBe(
      "Click a plan to show only its sessions",
    );
    const reading = thisMac().meters.entries.find((entry) => entry.kind === "reading");
    const showing = mount(
      <ProfilePopoverView
        {...popover(thisMac(), { chosenPlanFamily: [`native/${reading?.key}`] })}
      />,
    );
    expect(showing.querySelector(".vf-profiles-pop-lens")?.textContent).toBe(
      "Showing one plan's sessions · click it again for all",
    );
    const open = alone.querySelector<HTMLButtonElement>(".vf-profiles-pop-foot button");
    expect(open?.textContent).toBe("Agent Profiles…");
    act(() => open?.click());
    expect(props.onOpenProfile).toHaveBeenCalledWith("native");
  });

  it("says the reading's age, or that the first is on its way", () => {
    const meters = metersOf(FIXTURE_NATIVE);
    const newest = Math.max(
      ...meters.entries.flatMap((entry) =>
        entry.kind === "reading" ? [Date.parse(entry.fetchedAt)] : [],
      ),
    );
    expect(readWords(meters, new Date(newest + 60_000))).toBe("Read a minute ago");
    expect(readWords(meters, new Date(newest + 5 * 60_000))).toBe("Read 5 minutes ago");
    expect(readWords(metersOf(FIXTURE_NATIVE, []), NOW)).toBe("Reading usage…");
  });
});

/* ── the cards layer (UM-R1; DESIGN.md §8 "Where the cards stand") ──────────── */

describe("the cards layer (UM-R1): a card stands above the terminals, in the column's own hover and keys", () => {
  const GODVIEW_CSS = readFileSync(join(HERE, "..", "src", "godview", "godview.css"), "utf8");
  const cards = (props: Partial<ProfilesColumnViewProps>): ProfilesColumnViewProps =>
    column({ circles: [thisMac(), work()], lens: true, open: "work", ...props });

  it("stands an open card in the given layer, not in the item", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumnView {...cards({ cardLayer: target })} />);
    const stand = target.querySelector('.vf-profiles-stand[data-profile="work"]');
    expect(stand).not.toBeNull();
    expect(stand?.querySelector('.vf-profiles-pop[role="dialog"]')).not.toBeNull();
    expect(page.querySelector(".vf-profiles-item .vf-profiles-pop")).toBeNull();
    // the add's card stands in the same layer, said by its own mark
    const addTarget = cardLayer();
    mount(<ProfilesColumnView {...cards({ open: null, addOpen: true, cardLayer: addTarget })} />);
    expect(
      addTarget.querySelector('.vf-profiles-stand[data-card="add"] .vf-profiles-addcard'),
    ).not.toBeNull();
  });

  it("carries the pointer across the portal: pointing at the stand is pointing at its circle", () => {
    const target = cardLayer();
    const props = cards({ cardLayer: target });
    mount(<ProfilesColumnView {...props} />);
    const stand = target.querySelector('.vf-profiles-stand[data-profile="work"]');
    expect(stand).not.toBeNull();
    act(() => {
      stand?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(props.onPoint).toHaveBeenLastCalledWith("work");
  });

  it("renders in place with no layer (the catalog)", () => {
    const page = mount(<ProfilesColumnView {...cards({})} />);
    const stand = page.querySelector('.vf-profiles-item[data-profile="work"] .vf-profiles-stand');
    expect(stand).not.toBeNull();
    expect(stand?.querySelector(".vf-profiles-pop")).not.toBeNull();
    // the in-place geometry is named: the pill's padding 6 plus §8's 16, the same 16 the app draws
    expect(CSS).toMatch(
      /\n\.vf-profiles-stand \{[^}]*position: absolute;[^}]*left: calc\(100% \+ 22px\);[^}]*top: -6px;/u,
    );
    // the card itself no longer places itself
    expect(CSS).not.toMatch(
      /\n\.vf-profiles-pop,\n\.vf-profiles-addcard \{[^}]*position: absolute/u,
    );
  });

  describe("places the card at the item's top less 6, 16 right of the pill, clamped to the layer", () => {
    const box = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

    function placed(
      layerBox: DOMRect,
      standHeight: number,
      layout?: { width: number; height: number },
    ): CSSStyleDeclaration | undefined {
      const target = cardLayer();
      if (layout) {
        vi.spyOn(target, "clientWidth", "get").mockReturnValue(layout.width);
        vi.spyOn(target, "clientHeight", "get").mockReturnValue(layout.height);
      }
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element,
      ) {
        if (this === target) return layerBox;
        if (this.classList.contains("vf-profiles-column")) return box(13, 64, 52, 200);
        if (this.classList.contains("vf-profiles-item")) return box(19, 120, 40, 40);
        if (this.classList.contains("vf-profiles-stand")) return box(0, 0, 566, standHeight);
        return box(0, 0, 0, 0);
      });
      mount(<ProfilesColumnView {...cards({ cardLayer: target })} />);
      return target.querySelector<HTMLElement>(".vf-profiles-stand")?.style;
    }

    it("stands at its natural top when it fits", () => {
      const style = placed(box(0, 64, 1000, 600), 300);
      expect(style?.left).toBe("81px");
      expect(style?.top).toBe("50px");
      expect(style?.maxWidth).toBe("903px");
      expect(style?.maxHeight).toBe("600px");
    });

    it("is lifted at the layer's foot", () => {
      expect(placed(box(0, 64, 1000, 600), 590)?.top).toBe("10px");
    });

    it("in a layer too short for it, stands at the layer's top, held at its height", () => {
      const style = placed(box(0, 64, 1000, 200), 590);
      expect(style?.top).toBe("0px");
      expect(style?.maxHeight).toBe("200px");
      // §8 "held at the room's height and scrolls": the card takes the stand's bounds, and scrolls
      const card = /\n\.vf-profiles-pop,\n\.vf-profiles-addcard \{[^}]*\}/u.exec(CSS)?.[0] ?? "";
      expect(card).toContain("max-width: inherit;");
      expect(card).toContain("max-height: inherit;");
      expect(card).toContain("overflow-y: auto;");
    });

    it("stands in the layer's own pixels while the cover scales the stage (the monitor's clientWidth || rect)", () => {
      // the layer's box drawn at twice its layout: every screen distance is halved into the layer's pixels
      const style = placed(box(0, 64, 2000, 1200), 300, { width: 1000, height: 600 });
      expect(style?.left).toBe("49px");
      expect(style?.top).toBe("22px");
      expect(style?.maxWidth).toBe("935px");
      expect(style?.maxHeight).toBe("600px");
    });

    it("places again when the room moves: a ResizeObserver over the layer and the stand", () => {
      const observers: { fire: () => void; targets: Element[] }[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          private readonly entry: { fire: () => void; targets: Element[] };
          constructor(callback: () => void) {
            this.entry = { fire: callback, targets: [] };
            observers.push(this.entry);
          }
          observe(target: Element): void {
            this.entry.targets.push(target);
          }
          unobserve(): void {}
          disconnect(): void {}
        },
      );
      try {
        const room = box(0, 64, 1000, 600);
        expect(placed(room, 590)?.top).toBe("10px");
        const target = layer as HTMLElement;
        const stand = target.querySelector<HTMLElement>(".vf-profiles-stand");
        const placing = observers.find((each) => each.targets.includes(target));
        expect(placing?.targets).toContain(stand);
        Object.assign(room, { height: 500, bottom: 564 });
        act(() => placing?.fire());
        expect(stand?.style.top).toBe("0px");
        expect(stand?.style.maxHeight).toBe("500px");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("Tab from the open circle enters the portaled card, Shift+Tab from its first control returns", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumnView {...cards({ cardLayer: target })} />);
    const circle = page.querySelector<HTMLButtonElement>(
      '[data-profile="work"] .vf-profiles-circle',
    );
    const first = target.querySelector<HTMLButtonElement>(
      ".vf-profiles-stand button:not(:disabled)",
    );
    expect(first).not.toBeNull();
    circle?.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      circle?.dispatchEvent(forward);
    });
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      first?.dispatchEvent(back);
    });
    expect(document.activeElement).toBe(circle);
  });

  it("Tab from a circle whose card is not the open one walks on as the DOM does", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumnView {...cards({ cardLayer: target })} />);
    const other = page.querySelector<HTMLButtonElement>(
      '[data-profile="native"] .vf-profiles-circle',
    );
    other?.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      other?.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other);
  });

  it("a press inside a pinned card leaves it pinned", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
    act(() => {
      page.querySelector<HTMLButtonElement>('[data-profile="work"] .vf-profiles-circle')?.click();
    });
    const pop = target.querySelector(".vf-profiles-pop");
    expect(pop).not.toBeNull();
    act(() => {
      pop?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    });
    expect(target.querySelector(".vf-profiles-pop")).not.toBeNull();
  });

  it("a plan's row in a portaled card chooses through the layer, and closing the card keeps the plan (UM-5a over UM-R)", () => {
    const target = cardLayer();
    const onChoosePlan = vi.fn();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target, onChoosePlan })} />);
    const circle = page.querySelector<HTMLButtonElement>(
      '[data-profile="work"] .vf-profiles-circle',
    );
    act(() => circle?.click());
    const choose = target.querySelector<HTMLButtonElement>("button.vf-profiles-pop-row-choose");
    expect(choose).not.toBeNull();
    act(() => {
      choose?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      choose?.click();
    });
    expect(onChoosePlan).toHaveBeenCalledTimes(1);
    expect(onChoosePlan.mock.calls[0]?.[0]).toMatch(/^work\//u);
    expect(target.querySelector(".vf-profiles-pop")).not.toBeNull();
    act(() => {
      choose?.focus();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
    expect(document.activeElement).toBe(circle);
    expect(onChoosePlan).toHaveBeenCalledTimes(1);
  });

  it("names the layer: z 13, no pointer of its own, the stand takes the pointer, and both themes point its tokens", () => {
    const layerRule = /\n\.vf-monitor-cards \{[^}]*\}/u.exec(CSS)?.[0] ?? "";
    expect(layerRule).toContain("position: absolute;");
    expect(layerRule).toContain("z-index: 13;");
    expect(layerRule).toContain("pointer-events: none;");
    expect(layerRule).toMatch(
      /inset: calc\(var\(--vf-godview-head-reserve\) \+ 8px\) 0 var\(--vf-godview-panes-foot\) 0;/u,
    );
    expect(CSS).toMatch(/\n\.vf-profiles-stand \{[^}]*pointer-events: auto;/u);
    // a portaled card stands outside the column, so the layer carries the column's sans and the Bands circle's inks
    const inks = /\n\.vf-monitor-cards,\n\.vf-profiles-column \{[^}]*\}/u.exec(CSS)?.[0] ?? "";
    expect(inks).toContain("font-family: var(--vf-font-sans);");
    expect(inks).toContain("--vf-bands-ink: var(--vf-foreground);");
    expect(inks).toContain("--vf-bands-attention: var(--vf-monitor-ink-attention);");
    for (const theme of ["light", "dark"]) {
      expect(CSS).toContain(`\n.vf-godview.theme-${theme} .vf-monitor-cards`);
    }
    // the deck composites while a card stands, as for the tuning panel (a promoted WebGPU canvas)
    expect(GODVIEW_CSS).toMatch(
      /\.vf-godview:has\(\.vf-monitor-cards > \*\) \.vf-godview-terminal-deck \{\s*opacity: 0\.999;/u,
    );
  });
});

/* ── the reach (UM-R2; DESIGN.md §8 "The reach") ─────────────────────────── */

describe("the reach (UM-R2): the pointer can cross to its card", () => {
  beforeEach(() => {
    // the setTimeout pair alone: `now` is pinned, so the clock's interval never starts
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const over = (node: Element | null | undefined): void => {
    act(() => {
      node?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
  };
  const out = (node: Element | null | undefined): void => {
    act(() => {
      node?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    });
  };
  const wait = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  const setup = (): {
    target: HTMLElement;
    item: (id: string) => HTMLElement | null;
    stand: (id: string) => Element | null;
  } => {
    const target = cardLayer();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
    return {
      target,
      item: (id) => page.querySelector<HTMLElement>(`.vf-profiles-item[data-profile="${id}"]`),
      stand: (id) => target.querySelector(`.vf-profiles-stand[data-profile="${id}"]`),
    };
  };

  it("keeps the card through the grace and closes after it", () => {
    const { item, stand } = setup();
    over(item("work"));
    expect(stand("work")).not.toBeNull();
    out(item("work"));
    wait(319);
    expect(stand("work")).not.toBeNull();
    wait(1);
    expect(stand("work")).toBeNull();
  });

  it("a card reached within the grace stays", () => {
    const { item, stand } = setup();
    over(item("work"));
    out(item("work"));
    wait(100);
    over(stand("work"));
    wait(1000);
    expect(stand("work")).not.toBeNull();
  });

  it("a move to another circle waits out the dwell, and reaching the card cancels it", () => {
    const { item, stand } = setup();
    over(item("native"));
    out(item("native"));
    over(item("work"));
    wait(119);
    expect(stand("native")).not.toBeNull();
    expect(stand("work")).toBeNull();
    wait(1);
    expect(stand("work")).not.toBeNull();
    expect(stand("native")).toBeNull();
    // back toward This Mac, then onto the shown card first
    out(item("work"));
    over(item("native"));
    wait(100);
    over(stand("work"));
    wait(1000);
    expect(stand("work")).not.toBeNull();
    expect(stand("native")).toBeNull();
  });

  it("opens at once with nothing showing, and bridges the gap to the card (§8: 22 wide, from the item's edge)", () => {
    const { item, stand } = setup();
    over(item("work"));
    expect(stand("work")).not.toBeNull();
    const bridge = /\n\.vf-profiles-stand::before \{[^}]*\}/u.exec(CSS)?.[0] ?? "";
    expect(bridge).toContain("position: absolute;");
    expect(bridge).toContain("right: 100%;");
    expect(bridge).toContain("width: 22px;");
    expect(bridge).toMatch(/top: 0;[^}]*bottom: 0;/u);
    // a ::before with no content generates no box, so no bridge
    expect(bridge).toContain('content: "";');
  });

  it("the real crossing is no leave: out of the circle onto its stand, and between the card's own controls", () => {
    // what a browser fires: out and over carry each other's node, so React's enter/leave walks the portal, where the
    // bare `out`s above read as a leave of the whole tree. An item that listened for out would arm the grace here.
    const { item, stand, target } = setup();
    const cross = (from: Element | null | undefined, to: Element | null | undefined): void => {
      act(() => {
        from?.dispatchEvent(
          new PointerEvent("pointerout", { bubbles: true, relatedTarget: to ?? null }),
        );
        to?.dispatchEvent(
          new PointerEvent("pointerover", { bubbles: true, relatedTarget: from ?? null }),
        );
      });
    };
    over(item("work"));
    cross(item("work"), stand("work"));
    wait(1000);
    expect(stand("work")).not.toBeNull();
    cross(target.querySelector(".vf-profiles-pop"), target.querySelector(".vf-profiles-pop-close"));
    wait(1000);
    expect(stand("work")).not.toBeNull();
  });

  it("a close cancels the armed dwell: no card opens after the person closed it", () => {
    const { item, target } = setup();
    over(item("work"));
    act(() => item("work")?.querySelector<HTMLButtonElement>(".vf-profiles-circle")?.click());
    out(item("work"));
    over(item("native"));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    wait(1000);
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
  });

  it("a pinned card counts as showing: another circle waits the dwell before it peeks (§8 'The reach')", () => {
    const { item, stand } = setup();
    act(() => item("work")?.querySelector<HTMLButtonElement>(".vf-profiles-circle")?.click());
    over(item("native"));
    wait(119);
    expect(stand("work")).not.toBeNull();
    expect(stand("native")).toBeNull();
    wait(1);
    expect(stand("native")).not.toBeNull();
  });

  it("the add's card counts as showing and can be reached: its stand holds the pointer, and a circle waits the dwell", () => {
    const target = cardLayer();
    const page = mount(
      <ProfilesColumn {...controller({ cardLayer: target, openNewProfile: vi.fn() })} />,
    );
    const zone = page.querySelector(".vf-profiles-add-zone");
    const add = (): Element | null => target.querySelector('.vf-profiles-stand[data-card="add"]');
    const work = (): Element | null =>
      target.querySelector('.vf-profiles-stand[data-profile="work"]');
    over(zone);
    expect(add()).not.toBeNull();
    out(zone);
    wait(100);
    over(add());
    wait(1000);
    expect(add()).not.toBeNull();
    out(add());
    over(page.querySelector('.vf-profiles-item[data-profile="work"]'));
    wait(119);
    expect(add()).not.toBeNull();
    expect(work()).toBeNull();
    wait(1);
    expect(work()).not.toBeNull();
    expect(add()).toBeNull();
  });

  it("with no add to open, pointing at it shows nothing: the next circle opens at once", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
    over(page.querySelector(".vf-profiles-add-zone"));
    expect(target.querySelector(".vf-profiles-stand")).toBeNull();
    over(page.querySelector('.vf-profiles-item[data-profile="work"]'));
    expect(target.querySelector('.vf-profiles-stand[data-profile="work"]')).not.toBeNull();
  });

  it("opens no card while the terminals fill the window: not by the pointer, not by a press; the lens still chooses (§8 'Pinned')", () => {
    // the review: `covered` closed a card only as it turned true, and maximize only fades the stage, so a circle behind
    // the deck was still reachable, and the card it opened stood in the z 13 layer over the full-window terminals
    const onChoose = vi.fn();
    const target = cardLayer();
    const page = mount(
      <ProfilesColumn
        {...controller({ cardLayer: target, covered: true, onChoose, openNewProfile: vi.fn() })}
      />,
    );
    const work = page.querySelector<HTMLElement>('.vf-profiles-item[data-profile="work"]');
    over(work);
    expect(target.querySelector(".vf-profiles-stand")).toBeNull();
    over(page.querySelector(".vf-profiles-add-zone"));
    expect(target.querySelector(".vf-profiles-stand")).toBeNull();
    act(() => work?.querySelector<HTMLButtonElement>(".vf-profiles-circle")?.click());
    expect(onChoose).toHaveBeenCalledWith("work");
    expect(target.querySelector(".vf-profiles-stand")).toBeNull();
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("while the limit card stands, pointing at the add holds no hidden card, and the next circle opens at once (§8 'The add')", () => {
    // the review: a `display: none` stand still matched `:has(.vf-monitor-cards > *)` and read as "showing", so the
    // deck re-composited with no card on screen and the next circle waited a dwell with nothing to replace
    const target = cardLayer();
    const page = mount(
      <ProfilesColumn
        {...controller({
          cardLayer: target,
          openNewProfile: vi.fn(),
          moment: <p data-moment="">limit</p>,
        })}
      />,
    );
    const zone = page.querySelector(".vf-profiles-add-zone");
    over(zone);
    expect(target.children).toHaveLength(0);
    out(zone);
    over(page.querySelector('.vf-profiles-item[data-profile="work"]'));
    expect(target.querySelector('.vf-profiles-stand[data-profile="work"]')).not.toBeNull();
  });
});

/* ── closing is one act (UM-R3; DESIGN.md §8 "Pinned") ─────────────────────── */

describe("closing is one act (UM-R3): the pin, the pointer's hold and the keyboard go together", () => {
  const over = (node: Element | null | undefined): void => {
    act(() => {
      node?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
  };
  const click = (node: HTMLElement | null | undefined): void => {
    act(() => node?.click());
  };
  const esc = (): void => {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  };
  const circleOf = (page: HTMLElement, id: string): HTMLButtonElement | null =>
    page.querySelector<HTMLButtonElement>(`[data-profile="${id}"] .vf-profiles-circle`);
  const itemOf = (page: HTMLElement, id: string): HTMLElement | null =>
    page.querySelector<HTMLElement>(`.vf-profiles-item[data-profile="${id}"]`);

  it("one profile: a second click closes the card under the pointer and releases the keys", () => {
    const target = cardLayer();
    const page = mount(
      <ProfilesColumn {...controller({ sets: [FIXTURE_NATIVE], cardLayer: target })} />,
    );
    over(itemOf(page, "native"));
    click(circleOf(page, "native"));
    expect(target.querySelector(".vf-profiles-pop")).not.toBeNull();
    expect(monitorHoldsKeys()).toBe(true);
    click(circleOf(page, "native"));
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("Esc closes the card under the pointer and releases the keys", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
    over(itemOf(page, "work"));
    click(circleOf(page, "work"));
    expect(target.querySelector(".vf-profiles-pop")).not.toBeNull();
    esc();
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("the card leaving hands the keyboard to its circle", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
    click(circleOf(page, "work"));
    const close = target.querySelector<HTMLButtonElement>(".vf-profiles-pop-close");
    close?.focus();
    expect(document.activeElement).toBe(close);
    esc();
    expect(document.activeElement).toBe(circleOf(page, "work"));
  });

  it("closes before Settings: Agent Profiles… hands focus home, then opens", () => {
    const target = cardLayer();
    let focused: Element | null = null;
    const openProfile = vi.fn(() => {
      focused = document.activeElement;
    });
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target, openProfile })} />);
    click(circleOf(page, "work"));
    const open = target.querySelector<HTMLButtonElement>(".vf-profiles-pop-open");
    open?.focus();
    click(open);
    expect(openProfile).toHaveBeenCalledWith("work");
    expect(focused).toBe(circleOf(page, "work"));
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("drops the pin when Settings opens", () => {
    const target = cardLayer();
    const props = controller({ cardLayer: target, openProfile: vi.fn() });
    const page = mount(<ProfilesColumn {...props} />);
    click(circleOf(page, "work"));
    expect(monitorHoldsKeys()).toBe(true);
    act(() => root?.render(<ProfilesColumn {...props} openProfile={undefined} />));
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("× is one close: the pointer lets go, the pin drops, the keyboard goes home, the keys are released", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
    over(itemOf(page, "work"));
    click(circleOf(page, "work"));
    const close = target.querySelector<HTMLButtonElement>(".vf-profiles-pop-close");
    close?.focus();
    click(close);
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
    expect(document.activeElement).toBe(circleOf(page, "work"));
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("Settings opening some other way is the same close: the pointer lets go and the keyboard goes home", () => {
    const target = cardLayer();
    const props = controller({ cardLayer: target, openProfile: vi.fn() });
    const page = mount(<ProfilesColumn {...props} />);
    over(itemOf(page, "work"));
    click(circleOf(page, "work"));
    target.querySelector<HTMLButtonElement>(".vf-profiles-pop-close")?.focus();
    act(() => root?.render(<ProfilesColumn {...props} openProfile={undefined} />));
    expect(target.querySelector(".vf-profiles-pop")).toBeNull();
    expect(document.activeElement).toBe(circleOf(page, "work"));
  });

  it("leaves the keyboard where it is when the card does not hold it", () => {
    const target = cardLayer();
    const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    try {
      elsewhere.focus();
      click(circleOf(page, "work"));
      esc();
      expect(target.querySelector(".vf-profiles-pop")).toBeNull();
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it("grace expiry and a dwell swap do not hand focus to the circle (the pointer's, not a deliberate act)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const target = cardLayer();
      const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
      const out = (node: Element | null | undefined): void => {
        act(() => {
          node?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
        });
      };
      const wait = (ms: number): void => {
        act(() => {
          vi.advanceTimersByTime(ms);
        });
      };
      // a grace: the card leaves, and the circle does not take the keys
      over(itemOf(page, "work"));
      target.querySelector<HTMLButtonElement>(".vf-profiles-pop-close")?.focus();
      out(itemOf(page, "work"));
      wait(320);
      expect(target.querySelector(".vf-profiles-pop")).toBeNull();
      expect(document.activeElement).not.toBe(circleOf(page, "work"));
      // a dwell: the card is swapped, and the circle it stood for does not take the keys
      over(itemOf(page, "native"));
      target.querySelector<HTMLButtonElement>(".vf-profiles-pop-close")?.focus();
      out(itemOf(page, "native"));
      over(itemOf(page, "work"));
      wait(120);
      expect(target.querySelector('.vf-profiles-stand[data-profile="work"]')).not.toBeNull();
      expect(target.querySelector('.vf-profiles-stand[data-profile="native"]')).toBeNull();
      expect(document.activeElement).not.toBe(circleOf(page, "native"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no add card while the add is disabled", () => {
    const page = mount(<ProfilesColumnView {...column({ addOpen: true, canAdd: false })} />);
    expect(page.querySelector(".vf-profiles-addcard")).toBeNull();
  });

  it("says whether a circle's popover is open, and which (§8 'Said')", () => {
    const circles = [thisMac(), work()];
    const page = mount(<ProfilesColumnView {...column({ circles, lens: true, open: "work" })} />);
    const shut = circleOf(page, "native");
    const open = circleOf(page, "work");
    expect(shut?.getAttribute("aria-expanded")).toBe("false");
    expect(shut?.hasAttribute("aria-controls")).toBe(false);
    expect(open?.getAttribute("aria-expanded")).toBe("true");
    const controls = open?.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(page.querySelector(`[id="${controls}"][role="dialog"]`)).not.toBeNull();
  });
});

/* ── the pinned tell (UM-R-F, c3; DESIGN.md §8 "A circle") ─────────────────── */

describe("the pinned tell (UM-R-F, c3): a pinned card's circle wears the ready fill, a pointed one does not", () => {
  // the UM-R5 rows' helper, copied: one rule's block of the column's sheet
  const block = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\n${escaped} \\{[^}]*\\}`, "u").exec(CSS)?.[0] ?? "";
  };
  const circleOf = (page: HTMLElement, id: string): HTMLButtonElement | null =>
    page.querySelector<HTMLButtonElement>(`[data-profile="${id}"] .vf-profiles-circle`);

  it("wears the ready fill on a pinned card's circle, after the hover, so it wins under the pointer (§8 'A circle')", () => {
    expect(block(".vf-profiles-circle[data-pinned]")).toContain(
      "background: color-mix(in srgb, var(--vf-foreground) 8%, transparent);",
    );
    const hover = CSS.indexOf("\n.vf-profiles-circle:hover,\n.vf-profiles-circle[data-open] {");
    expect(hover).toBeGreaterThan(-1);
    expect(CSS.indexOf("\n.vf-profiles-circle[data-pinned] {")).toBeGreaterThan(hover);
  });

  it("the tell is the pin's: on the pinned circle while another circle peeks, and gone with the pin (c2 kept)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const target = cardLayer();
      const page = mount(<ProfilesColumn {...controller({ cardLayer: target })} />);
      act(() => circleOf(page, "work")?.click());
      expect(circleOf(page, "work")?.hasAttribute("data-pinned")).toBe(true);
      expect(circleOf(page, "native")?.hasAttribute("data-pinned")).toBe(false);
      // the peek: This Mac's card stands over Work's, and the pin's tell stays on Work's circle
      act(() => {
        page
          .querySelector('.vf-profiles-item[data-profile="native"]')
          ?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      });
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(target.querySelector('.vf-profiles-stand[data-profile="native"]')).not.toBeNull();
      expect(circleOf(page, "work")?.hasAttribute("data-pinned")).toBe(true);
      expect(circleOf(page, "native")?.hasAttribute("data-pinned")).toBe(false);
      // closing is one act: the pin goes, and its tell with it
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      expect(circleOf(page, "work")?.hasAttribute("data-pinned")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pointed card's circle wears no tell; a pinned one does (the view)", () => {
    const page = mount(<ProfilesColumnView {...column({ open: "native", pinned: true })} />);
    expect(circleOf(page, "native")?.hasAttribute("data-pinned")).toBe(true);
    act(() => root?.render(<ProfilesColumnView {...column({ open: "native", pinned: false })} />));
    expect(circleOf(page, "native")?.hasAttribute("data-pinned")).toBe(false);
  });
});

/* ── the card's details (UM-R5) ──────────────────────────────────────────── */

describe("the card's details (UM-R5): §7 'Off', the truncations, the rings, the motion-off lists", () => {
  const block = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\n${escaped} \\{[^}]*\\}`, "u").exec(CSS)?.[0] ?? "";
  };

  it("draws the limit card's off act as §7's off pill: no fade, the quiet fill and t4 (§7 'Off')", () => {
    const off = block(".vf-profiles-limit-act:disabled");
    expect(off).not.toContain("opacity: 0.4");
    expect(off).toContain("color: var(--vf-text-faint);");
    expect(off).toContain("background: color-mix(in srgb, var(--vf-foreground) 5%, transparent);");
  });

  it("stands the off rule after the primary, at equal specificity, so an off primary loses its inversion (§7 'Off')", () => {
    const primary = CSS.indexOf('\n.vf-profiles-limit-act[data-variant="primary"] {');
    const off = CSS.indexOf("\n.vf-profiles-limit-act:disabled {");
    expect(primary).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(primary);
  });

  it("steps ×, a row's act and Agent Profiles… under the pointer, as §8 records", () => {
    const close = block(".vf-profiles-pop-close:hover");
    expect(close).toContain(
      "background: color-mix(in srgb, var(--vf-foreground) 14%, transparent);",
    );
    expect(close).toContain("color: var(--vf-text-primary);");
    expect(block(".vf-profiles-pop-row-act:hover:not(:disabled)")).toContain(
      "background: color-mix(in srgb, var(--vf-foreground) 14%, transparent);",
    );
    expect(block(".vf-profiles-pop-open:hover:not(:disabled)")).toContain(
      "color: var(--vf-text-primary);",
    );
  });

  it("holds the tag, the age and Agent Profiles… on one line, and the limit card 16 right of the pill", () => {
    for (const unbroken of [
      ".vf-profiles-pop-tag",
      ".vf-profiles-pop-age",
      ".vf-profiles-pop-open",
    ]) {
      expect(block(unbroken), unbroken).toContain("white-space: nowrap;");
    }
    expect(block(".vf-profiles-moment")).toContain("left: calc(100% + 22px);");
  });

  it("truncates the popover's name and its foot rather than wrapping them", () => {
    for (const truncating of [".vf-profiles-pop-name", ".vf-profiles-pop-lens"]) {
      const rule = block(truncating);
      expect(rule, truncating).toContain("overflow: hidden;");
      expect(rule, truncating).toContain("text-overflow: ellipsis;");
      expect(rule, truncating).toContain("white-space: nowrap;");
    }
  });

  it("rings ×, Retry/Sign in and Agent Profiles… on keyboard focus", () => {
    const ring = /\n\.vf-profiles-pop-close:focus-visible,[^{]*\{[^}]*\}/u.exec(CSS)?.[0] ?? "";
    expect(ring).toContain(".vf-profiles-pop-row-act:focus-visible");
    expect(ring).toContain(".vf-profiles-pop-open:focus-visible");
    expect(ring).toContain("outline: 2px solid var(--vf-select);");
  });

  it("names the limit card's acts in both motion-off lists", () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/u.exec(CSS)?.[0] ?? "";
    expect(reduced).toMatch(/\.vf-profiles-limit-act,[^{]*\{\s*transition: none;/u);
    expect(CSS).toMatch(
      /\.vf-godview\[data-godview-animations="off"\] \.vf-profiles-limit-act,[^{]*\{\s*transition: none;/u,
    );
  });
});

/* ── names (the column's sheet stands beside Settings') ─────────────────── */

describe("the column's names stand apart from Settings' own", () => {
  it("styles no `.vf-profiles-row` (Settings' agent row) and draws none in the popover", () => {
    // `.vf-profiles-row` is Agent Profiles' agent row (profiles-settings.css): a rule of the column's on it would
    // re-lay Settings' rows, and Settings' on the popover's would re-lay its plans
    expect(CSS).not.toMatch(/\.vf-profiles-rows?\b/u);
    const page = mount(
      <ProfilesColumnView {...column({ circles: [thisMac()], open: FIXTURE_NATIVE.id })} />,
    );
    expect(page.querySelector(".vf-profiles-row")).toBeNull();
  });
});

/* ── motion (M6) ──────────────────────────────────────────────────────────── */

describe("the column's motion, and none under Reduce Motion or with Godview's animations off (M6)", () => {
  const block = (pattern: RegExp): string => CSS.match(pattern)?.[0] ?? "";

  it("breathes a first read on §6's breath: 1.1s, alternate, ease-in-out, from 35% to all of it", () => {
    expect(CSS).toMatch(
      /\.vf-bands-breath \{[^}]*animation: vf-bands-breath 1\.1s ease-in-out infinite alternate;/u,
    );
    expect(CSS).toMatch(
      /@keyframes vf-bands-breath \{\s*from \{\s*opacity: 0\.35;\s*\}\s*to \{\s*opacity: 1;/u,
    );
  });

  it("stands the breath still at 60%, and changes the ring and the hover at once", () => {
    const reduced = block(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/u);
    const off = block(
      /\.vf-godview\[data-godview-animations="off"\] \.vf-bands-breath[^{]*\{[^}]*\}/u,
    );
    for (const rules of [reduced, off]) {
      expect(rules).toMatch(/\.vf-bands-breath[^{]*\{[^}]*animation: none;[^}]*opacity: 0\.6;/u);
    }
    expect(reduced).toMatch(/\.vf-profiles-circle[^{]*\{[^}]*transition: none;/u);
    // the review: with Godview's animations off the ring and the hover still eased (§8: "and Godview's animations
    // off: … the ring and the hover change at once")
    expect(CSS).toContain(
      '\n.vf-godview[data-godview-animations="off"] .vf-profiles-circle,\n.vf-godview[data-godview-animations="off"] .vf-profiles-add {\n  transition: none;\n}',
    );
  });
});
