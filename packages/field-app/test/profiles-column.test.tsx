// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAccountUsageEntry, AgentProfileSet } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_DEMO,
  FIXTURE_NATIVE,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_PROFILES_NOW,
  FIXTURE_WORK,
} from "../src/design-system/profiles-fixtures";
import { BandsCircle, BandsKey } from "../src/godview/profiles-column/BandsCircle";
import { ProfilePopoverView, readWords } from "../src/godview/profiles-column/ProfilePopoverView";
import {
  type ColumnCircle,
  ProfilesColumnView,
  type ProfilesColumnViewProps,
} from "../src/godview/profiles-column/ProfilesColumnView";
import { PROFILES_WORDS } from "../src/setup/profiles-words";
import { bandsGeometry } from "../src/usage/bands";
import { type MetersOptions, type ProfileMeters, planMeters } from "../src/usage/meters";

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
    // the moment's card hides the add's card while it stands (it says nothing when it is not due)
    expect(CSS).toMatch(
      /\.vf-profiles-add-item:has\(> \.vf-profiles-moment > \*\) > \.vf-profiles-addcard \{\s*display: none;/u,
    );
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

  it("wave 1: a plan's row takes no click — not a button, never pressed", () => {
    const page = mount(<ProfilePopoverView {...popover(thisMac())} />);
    expect(page.querySelectorAll(".vf-profiles-pop-row").length).toBeGreaterThan(0);
    for (const row of page.querySelectorAll(".vf-profiles-pop-row")) {
      expect(row.tagName).not.toBe("BUTTON");
      expect(row.hasAttribute("aria-pressed")).toBe(false);
    }
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
    ).toEqual(none.map((entry) => `${entry.agent} shows no meter`));
  });

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

  it("feet: with several profiles the lens's words, with one only Agent Profiles… (wave 1); it opens that profile", () => {
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
    expect(alone.querySelector(".vf-profiles-pop-lens")).toBeNull();
    const open = alone.querySelector<HTMLButtonElement>(".vf-profiles-pop-foot button");
    expect(alone.querySelector(".vf-profiles-pop-foot")?.textContent).toBe("Agent Profiles…");
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
  });
});
