// @vitest-environment happy-dom
/**
 * Item 550 (2026-11-18) — THE AT-WORK MARK's markup (DESIGN.md §8 "At work on the mat", §9 "The desk's at-work
 * words"). The DOM form — no WebGL2, or a lost context — is still and NEVER A BLANK: every object agents are at work on
 * wears a CSS stroke in its ink (Godview's colour for its project, the neutral pearl's token for none), nested as the
 * GL strokes are, and each seat a sticker carrying `AgentIcon` (an unknown agent its letter) or the paper "+N". In the
 * GL form the canvas draws the strokes and the stickers, and the DOM keeps only the chips and a spark's star. A chip
 * is the peers' label chip, composed: the agent's mark and name, the project's folder mark in Godview's colour at the
 * theme's tint and its name, then the word — in the chrome's ink, behind one switch. Beside the visual layer (which is
 * `aria-hidden`), the NAMES: a visually hidden list of every one, and one polite live region that says each newly
 * urgent one once. A spark's star, its line and its chip wear its status as Chat's list holds it (DESIGN.md §2.10):
 * when that status moves and nothing else does, the star's word and its chip follow, and the mount touches the
 * sleeping overlay once (§6 "At rest", M5); the mount counts its renders on the layer's counter and lets its layer go
 * with it. Red first: each row says what the view must do.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOG, type AtWorkState } from "@vibefield/contracts";
import type { SparkStatus } from "@vibefield/design-kit/spark-face";
import { DEFAULT_PROJECT_TINT, projectColour } from "@vibefield/puppeteer-view-sdk/toolkit";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtWorkView } from "../src/field/desk/at-work/AtWorkView";
import { AT_WORK_ATLAS, AT_WORK_STICKER } from "../src/field/desk/at-work/at-work-atlas";
import { projectInkOf } from "../src/field/desk/at-work/at-work-ink";
import {
  type AtWorkInput,
  type AtWorkObjectState,
  type ScreenFrame,
  stepAtWork,
} from "../src/field/desk/at-work/at-work-model";
import type { AtWorkRow } from "../src/field/desk/at-work/at-work-rows";
import {
  AT_WORK_DOM_INKS,
  type AtWorkDrawnObject,
  type AtWorkForm,
  atWorkPlacementsOf,
  atWorkShapeOf,
} from "../src/field/desk/at-work/at-work-shape";
import type { AtWorkBoard } from "../src/field/desk/at-work/at-work-store";
import {
  AT_WORK_CHIP_INKS,
  type AtWorkName,
  type AtWorkWordSources,
  atWorkChipOf,
  atWorkNamesOf,
} from "../src/field/desk/at-work/at-work-words";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceOf = (path: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src/field/desk/at-work", path), "utf8");

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.reverse()) fn();
  cleanups = [];
  vi.useRealTimers();
});

const FIRST = AGENT_CATALOG[0];
const SECOND = AGENT_CATALOG[1];
if (FIRST === undefined || SECOND === undefined) throw new Error("the catalog has two agents");
const SPARK = "sp-vela0001";
const FRAME: ScreenFrame = { cx: 220, cy: 160, hx: 80, hy: 50, angle: 0, r: 6 };

const row = (
  run: string,
  state: AtWorkState,
  extra: Partial<Pick<AtWorkRow, "agent" | "project" | "spark" | "startedBy">> = {},
): AtWorkRow => ({
  run,
  handle: `${run}-handle`,
  agent: FIRST.id,
  state,
  since: 1,
  ...extra,
});

const IN_VIBE_FIELD = { project: { name: "vibe-field", seq: 3 } } as const;

/** What Chat's list holds of the sparks, by id: each one's status. */
type Statuses = ReadonlyMap<string, SparkStatus>;
const NO_STATUSES: Statuses = new Map();
/** Chat's list holding Vela at `status`. */
const holding = (status: SparkStatus): Statuses => new Map([[SPARK, status]]);

/** The model's input for `rows` on the fixture's object at `now`, Chat's list holding `statuses`. */
const inputOf = (
  rows: readonly AtWorkRow[],
  now: number,
  statuses: Statuses,
  frame: ScreenFrame = FRAME,
  landed: ReadonlySet<string> = new Set(rows.map((r) => r.run)),
): AtWorkInput => ({
  rows,
  frame,
  zoom: 1,
  now,
  reducedMotion: false,
  heldByYou: false,
  inks: AT_WORK_DOM_INKS,
  landed,
  sparkStatus: (spark) => statuses.get(spark) ?? null,
});

/** The model's marks for `rows`, landed (already at work), then `then` 100 ms on, Chat's list holding `statuses`. */
function drawnOf(
  rows: readonly AtWorkRow[],
  then: readonly AtWorkRow[] | null = null,
  frame: ScreenFrame = FRAME,
  statuses: Statuses = NO_STATUSES,
): AtWorkDrawnObject {
  const landed = new Set(rows.map((r) => r.run));
  const step = (prev: AtWorkObjectState | undefined, at: readonly AtWorkRow[], now: number) =>
    stepAtWork(prev, inputOf(at, now, statuses, frame, landed));
  let state = step(undefined, rows, 10_000);
  if (then !== null) state = step(state, then, 10_100);
  return { key: "k1", frame, marks: state.marks };
}

const boardOf = (rows: readonly AtWorkRow[]): AtWorkBoard => ({
  docId: "doc-1",
  objects: new Map([["k1", { ref: "vf:obj/k1000000", key: "k1", agents: rows }]]),
  landed: new Map(),
  epoch: 0,
});

/** The words' sources: Vela's name, the object's, and Vela's status as Chat's list holds it. */
const sourcesOf = (statuses: Statuses): AtWorkWordSources => ({
  sparkName: (spark) => (spark === SPARK ? "Vela" : null),
  thingOf: () => "Q3 plan",
  sparkStatus: (spark) => statuses.get(spark) ?? null,
});

function mountRoot(element: ReactElement): { host: HTMLElement; root: Root } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, root };
}

const mount = (element: ReactElement): HTMLElement => mountRoot(element).host;

/** The shipping view over the model's marks, placed by the shipping placements, its words Chat's `statuses`. */
function viewOf(
  rows: readonly AtWorkRow[],
  form: AtWorkForm,
  drawn = drawnOf(rows),
  theme: "light" | "dark" = "dark",
  statuses: Statuses = NO_STATUSES,
): ReactElement {
  const placed = new Map(
    atWorkPlacementsOf([drawn], form, () => 120, 800).map((p) => [p.id, p] as const),
  );
  const board = boardOf(rows);
  const sources = sourcesOf(statuses);
  return (
    <AtWorkView
      shape={atWorkShapeOf([drawn], form, null)}
      names={atWorkNamesOf(board, sources)}
      chipOf={(key, run, state) => {
        const at = board.objects.get(key)?.agents.find((agent) => agent.run === run);
        return at === undefined ? null : atWorkChipOf(at, state, sources);
      }}
      seedOf={(spark) => (spark === SPARK ? 212 : null)}
      theme={theme}
      placed={placed}
    />
  );
}

const view = (
  rows: readonly AtWorkRow[],
  form: AtWorkForm,
  drawn = drawnOf(rows),
  theme: "light" | "dark" = "dark",
  statuses: Statuses = NO_STATUSES,
): HTMLElement => mount(viewOf(rows, form, drawn, theme, statuses));

/** A spark's own star seat in a drawn object's shape. */
const starOf = (drawn: AtWorkDrawnObject) =>
  atWorkShapeOf([drawn], "gl", null).objects[0]?.seats.find((seat) => seat.form === "star");

const chipText = (host: HTMLElement): string | null | undefined =>
  host.querySelector(".vf-atwork-chip__text")?.textContent;

const SHOWN: readonly AtWorkState[] = [
  "open",
  "reading",
  "acting",
  "needs-you",
  "paused",
  "failed",
];

describe("the DOM form — still, and never a blank", () => {
  it.each(SHOWN)("draws a %s agent as a stroke in its ink and a sticker with its mark", (state) => {
    const host = view([row("r1", state, IN_VIBE_FIELD)], "dom");
    const frames = host.querySelectorAll<HTMLElement>(".vf-atwork-frame");
    expect(frames).toHaveLength(1);
    const strokes = host.querySelectorAll<HTMLElement>(".vf-atwork-stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.style.getPropertyValue("--vf-atwork-ink")).toBe(projectInkOf(3).css);
    // placed by the shipping placements: the frame at the object's centre, its half extents and the marks' scale
    expect(frames[0]?.style.transform).toContain("translate(220.00px, 160.00px)");
    expect(frames[0]?.style.getPropertyValue("--vf-atwork-hx")).toBe("80.00");
    const stickers = host.querySelectorAll<HTMLElement>(".vf-atwork-sticker");
    expect(stickers).toHaveLength(1);
    const mark = stickers[0]?.querySelector(".vf-atwork-sticker__mark");
    expect(mark?.querySelector("svg, span")).not.toBeNull();
  });

  it("sizes a sticker by the atlas's own numbers: the mark 15, its foil and its paper edge either side (26.4)", () => {
    const host = view([row("r1", "open", IN_VIBE_FIELD)], "dom");
    const layer = host.querySelector<HTMLElement>(".vf-atwork");
    const n = (name: string): number => Number(layer?.style.getPropertyValue(name));
    expect(n("--vf-atwork-mark")).toBe(AT_WORK_STICKER.scale * AT_WORK_ATLAS.units);
    expect(n("--vf-atwork-mark")).toBe(15);
    expect(n("--vf-atwork-mark") + 2 * (n("--vf-atwork-foil") + n("--vf-atwork-edge"))).toBeCloseTo(
      26.4,
      9,
    );
    expect(n("--vf-atwork-cut")).toBe(AT_WORK_STICKER.cut);
  });

  it("wears the neutral pearl's token for a run in no project", () => {
    const host = view([row("r1", "reading")], "dom");
    expect(
      host
        .querySelector<HTMLElement>(".vf-atwork-stroke")
        ?.style.getPropertyValue("--vf-atwork-ink"),
    ).toBe("var(--vf-atwork-neutral)");
  });

  it("nests three agents' strokes about the band's gap, 1.1 half-widths apart, and counts the rest on paper", () => {
    const rows = ["r1", "r2", "r3", "r4", "r5"].map((run, at) =>
      row(run, "open", { agent: (at % 2 === 0 ? FIRST : SECOND).id, ...IN_VIBE_FIELD }),
    );
    const host = view(rows, "dom");
    const gaps = [...host.querySelectorAll<HTMLElement>(".vf-atwork-stroke")].map((s) =>
      Number(s.style.getPropertyValue("--vf-atwork-gap")),
    );
    // three agents (DESIGN.md §2.3): hw 4.5·(1 − 0.11·2) = 3.51, the gap 17 + 1.9·2 = 20.8, nested ±1.1·3.51
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeCloseTo(20.8 - 3.51 * 1.1, 9);
    expect(gaps[1]).toBeCloseTo(20.8, 9);
    expect(gaps[2]).toBeCloseTo(20.8 + 3.51 * 1.1, 9);
    const seats = [...host.querySelectorAll<HTMLElement>("[data-atwork-seat]")].map(
      (s) => s.dataset["atworkSeat"],
    );
    expect(seats).toEqual(["sticker", "sticker", "count"]);
    expect(host.querySelector(".vf-atwork-sticker__count")?.textContent).toBe("+3");
  });

  it("gives an unknown agent its letter on the sticker", () => {
    const host = view([row("r1", "reading", { agent: "zephyr" })], "dom");
    expect(host.querySelector(".vf-atwork-sticker__mark span")?.textContent).toBe("Z");
  });

  it("keeps a far object's line (its shorter side under 24 px on screen) and draws no sticker in it", () => {
    const rows = [row("r1", "reading"), row("r2", "open", { agent: SECOND.id })];
    const far: ScreenFrame = { cx: 40, cy: 30, hx: 10, hy: 8, angle: 0, r: 1 };
    const host = view(rows, "dom", drawnOf(rows, null, far));
    const strokes = host.querySelectorAll<HTMLElement>(".vf-atwork-stroke");
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes[0]?.dataset["form"]).toBe("line");
    expect(host.querySelector("[data-atwork-seat]")).toBeNull();
  });
});

describe("the GL form keeps the DOM to its chips and stars", () => {
  it("renders no frame and no sticker (the canvas draws them), but the chip of a run that needs you", () => {
    const host = view([row("r1", "needs-you", IN_VIBE_FIELD)], "gl");
    expect(host.querySelector(".vf-atwork-frame")).toBeNull();
    expect(host.querySelector(".vf-atwork-sticker")).toBeNull();
    expect(host.querySelector(".vf-atwork__gl")).not.toBeNull();
    expect(chipText(host)).toBe(`${FIRST.label} · vibe-field · Needs you`);
    // 7 right of the seat's rim, 11 over its centre
    expect(host.querySelector<HTMLElement>(".vf-atwork-chip")?.style.transform).toMatch(
      /^translate\(/u,
    );
  });

  it("shows a just-failed run's chip, and a spark's own star as a still", () => {
    const failed = drawnOf([row("r1", "open")], [row("r1", "failed")]);
    const host = view([row("r1", "failed")], "gl", failed);
    expect(chipText(host)).toBe(`${FIRST.label} · Failed`);
    expect(host.querySelector('[data-atwork-chip="failed"]')).not.toBeNull();
    const spark = view([row("s1", "reading", { spark: SPARK })], "gl");
    expect(spark.querySelector('[data-atwork-seat="star"]')).not.toBeNull();
  });
});

describe("the chip on the line's glass is the peers' label chip, with its marks (DESIGN.md §8, §9)", () => {
  it("composes the peers' chip — its recipe, its night light — and only places it", () => {
    const host = view([row("r1", "needs-you", IN_VIBE_FIELD)], "gl");
    const chip = host.querySelector<HTMLElement>(".vf-atwork-chip");
    expect(chip?.classList.contains("vf-peer__chip")).toBe(true);
    const css = sourceOf("at-work.css");
    const place = /\.vf-atwork \.vf-atwork-chip \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(place).toContain("top: 0");
    expect(place).toContain("left: 0");
    // no recipe of its own: the peers' is the one recipe
    const recipe = /\.vf-atwork-chip\s*\{[^}]*(?:background|backdrop-filter|box-shadow)/u;
    expect(css).not.toMatch(recipe);
    expect(css).not.toMatch(/\.dark \.vf-atwork-chip/u);
    expect(sourceOf("AtWorkView.tsx")).toContain('import "../peers/peers.css";');
  });

  it("leads with the agent's mark, and puts the project's folder mark in Godview's colour at the theme's tint", () => {
    for (const theme of ["dark", "light"] as const) {
      const host = view([row("r1", "needs-you", IN_VIBE_FIELD)], "gl", undefined, theme);
      const mark = host.querySelector(".vf-atwork-chip__mark svg, .vf-atwork-chip__mark span");
      expect(mark).not.toBeNull();
      const folder = host.querySelector<SVGElement>('.vf-atwork-chip [data-glyph="folder"]');
      expect(folder).not.toBeNull();
      expect(folder?.style.getPropertyValue("--vf-atwork-folder")).toBe(
        projectColour(3, DEFAULT_PROJECT_TINT[theme]),
      );
    }
  });

  it("says a crew run's spark, a spark's own chip and an unknown agent as §9 sets them — never a handle", () => {
    const crew = view(
      [row("r1", "needs-you", { agent: SECOND.id, startedBy: SPARK, ...IN_VIBE_FIELD })],
      "gl",
    );
    expect(chipText(crew)).toBe(`${SECOND.label} · vibe-field · Vela's crew · Needs you`);
    const own = [row("s1", "needs-you", { spark: SPARK })];
    const asking = holding("asking");
    const spark = view(own, "gl", drawnOf(own, null, FRAME, asking), "dark", asking);
    expect(chipText(spark)).toBe("Vela · spark · Asking you");
    expect(spark.querySelector(".vf-atwork-chip [data-glyph='folder']")).toBeNull();
    // an agent this build has no row for is said by its id itself, as the window names it (`agentLabel`)
    const unknown = view([row("r9", "needs-you", { agent: "zephyr" })], "gl");
    expect(chipText(unknown)).toBe("zephyr · Needs you");
    expect(unknown.textContent).not.toContain("handle");
    expect(unknown.textContent).not.toContain("An agent");
  });

  it("keeps the words in the chrome's ink behind one switch, whose two inks the stylesheet already holds", () => {
    expect(AT_WORK_CHIP_INKS).toBe(false);
    const host = view(
      [row("r1", "needs-you", IN_VIBE_FIELD), row("r2", "needs-you", { agent: SECOND.id })],
      "gl",
    );
    expect(host.querySelectorAll(".vf-atwork-chip__word")).toHaveLength(2);
    expect(host.querySelectorAll("[data-ink]")).toHaveLength(0);
    const css = sourceOf("at-work.css");
    expect(css).toMatch(
      /\.vf-atwork-chip__word\[data-ink="needs-you"\] \{\s*color: var\(--vf-ink-attention\);\s*\}/u,
    );
    expect(css).toMatch(
      /\.vf-atwork-chip__word\[data-ink="failed"\] \{\s*color: var\(--vf-ink-danger\);\s*\}/u,
    );
  });
});

describe("the names (DESIGN.md §9)", () => {
  it("says every agent at work in words, outside the visual layer's aria-hidden", () => {
    const rows = [
      row("r1", "reading", IN_VIBE_FIELD),
      row("r2", "acting", { agent: SECOND.id, startedBy: SPARK, ...IN_VIBE_FIELD }),
      row("s1", "open", { spark: SPARK }),
      row("gone", "released"),
    ];
    // the spark's word is Chat's status, whatever its row's state
    const reading = holding("reviewing");
    const host = view(rows, "dom", drawnOf(rows, null, FRAME, reading), "dark", reading);
    const layer = host.querySelector(".vf-atwork");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    const names = host.querySelector("[data-atwork-names]");
    expect(names?.closest("[aria-hidden]")).toBeNull();
    expect(names?.className).toBe("sr-only");
    const items = [...(names?.querySelectorAll("li") ?? [])].map((li) => li.textContent);
    expect(items).toEqual([
      `${FIRST.label} in vibe-field is reading Q3 plan`,
      `${SECOND.label} in vibe-field is changing Q3 plan for Vela`,
      "Vela on Q3 plan: Reading",
    ]);
  });

  it("is live (polite) for needs you and failed only, in one region", () => {
    const rows = [
      row("r1", "reading", IN_VIBE_FIELD),
      row("r2", "needs-you", IN_VIBE_FIELD),
      row("r3", "failed", { agent: SECOND.id }),
    ];
    const host = view(rows, "dom");
    const live = host.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]?.getAttribute("aria-live")).toBe("polite");
    expect(live[0]?.textContent).toBe(
      `${FIRST.label} in vibe-field needs you on Q3 plan. ${SECOND.label}: an act on Q3 plan failed`,
    );
    expect(host.querySelector(".vf-atwork [aria-live]")).toBeNull();
  });

  it("says each newly urgent name once, never the ones already said, and empties a second after", () => {
    vi.useFakeTimers();
    const name = (run: string, text: string, urgent: boolean): AtWorkName => ({
      run,
      key: "k1",
      text,
      urgent,
    });
    const shape = atWorkShapeOf([], "dom", null);
    const at = (names: readonly AtWorkName[]): ReactElement => (
      <AtWorkView
        shape={shape}
        names={names}
        chipOf={() => null}
        seedOf={() => null}
        theme="dark"
      />
    );
    const first = [
      name("r1", "A needs you on Q3 plan", true),
      name("r2", "B is reading Q3 plan", false),
    ];
    const { host, root } = mountRoot(at(first));
    const live = (): string | null | undefined => host.querySelector("[aria-live]")?.textContent;
    expect(live()).toBe("A needs you on Q3 plan");
    const second = [...first, name("r3", "C: an act on Q3 plan failed", true)];
    act(() => root.render(at(second)));
    expect(live()).toBe("C: an act on Q3 plan failed");
    // the same names again: nothing new is said
    act(() => vi.advanceTimersByTime(1_000));
    expect(live()).toBe("");
    act(() => root.render(at([...second])));
    expect(live()).toBe("");
    // the list keeps everyone
    expect(host.querySelectorAll("li")).toHaveLength(3);
  });

  it("stands the region with nothing to say when nobody needs you", () => {
    const host = view([row("r1", "acting")], "dom");
    expect(host.querySelector("[aria-live]")?.textContent).toBe("");
  });
});

describe("the layer's verdict", () => {
  it("hides the visual layer whole while the desk does not draw, under a cover, or with the board out", () => {
    const drawn = drawnOf([row("r1", "reading")]);
    const host = mount(
      <AtWorkView
        shape={{ ...atWorkShapeOf([drawn], "dom", null), hidden: "cover" }}
        names={[]}
        chipOf={() => null}
        seedOf={() => null}
        theme="light"
      />,
    );
    expect(host.querySelector(".vf-atwork")?.getAttribute("data-hidden")).toBe("cover");
  });
});

describe("a spark's status is Chat's: it moves alone, and its star's word and its chip follow (DESIGN.md §2.10, §6)", () => {
  /** The rows, the same throughout: a spark acting on the object, its row never moving. */
  const rows = [row("s1", "acting", { spark: SPARK })];
  const board = boardOf(rows);
  /** Vela as Chat's list holds it, at `status`: the mount's own reading. */
  const knownAt = (status: SparkStatus) => new Map([[SPARK, { name: "Vela", seed: 212, status }]]);
  type Known = ReturnType<typeof knownAt>;
  /** Chat's list read, or not yet, holding no spark. */
  const NONE_KNOWN: Known = new Map();

  it("turns the star, its line and its chip with the status, the rows unmoved", () => {
    // a spark with the object open, its line dry and still: a reading or acting run's shimmer is its work moving,
    // which keeps its star live, so only an open run comes to rest
    const still = [row("s1", "open", { spark: SPARK })];
    const reading = holding("reviewing");
    const asking = holding("asking");
    // at rest past the desk's 8 s ambient, then Chat's status moves and nothing else does
    const first = stepAtWork(undefined, inputOf(still, 10_000, reading));
    const rest = stepAtWork(first, inputOf(still, 30_000, reading));
    const after = stepAtWork(rest, inputOf(still, 30_100, asking));
    const drawn = (state: AtWorkObjectState): AtWorkDrawnObject => ({
      key: "k1",
      frame: FRAME,
      marks: state.marks,
    });
    // the star wears Chat's status, then its new one; no chip while it reads, one once it asks
    expect(starOf(drawn(rest))?.face).toBe("reviewing");
    expect(starOf(drawn(after))?.face).toBe("asking");
    expect(rest.marks.chips).toEqual([]);
    expect(after.marks.chips.map((chip) => [chip.run, chip.word])).toEqual([["s1", "needs-you"]]);
    // a change of its status is its work moving: its star is live again, for the desk's ambient
    expect(rest.marks.stageLive).toBe(false);
    expect(after.marks.stageLive).toBe(true);
    // its line and its chip say the status its star wears
    const was = view(still, "gl", drawn(rest), "dark", reading);
    expect(was.querySelector("[data-atwork-names] li")?.textContent).toBe(
      "Vela on Q3 plan: Reading",
    );
    expect(was.querySelector(".vf-atwork-chip")).toBeNull();
    const now = view(still, "gl", drawn(after), "dark", asking);
    expect(now.querySelector("[data-atwork-names] li")?.textContent).toBe(
      "Vela on Q3 plan: Asking you",
    );
    expect(chipText(now)).toBe("Vela · spark · Asking you");
    expect(now.querySelector('[data-atwork-chip="needs-you"]')).not.toBeNull();
  });

  it("wears its still, with no word, while Chat's list does not hold the spark", () => {
    const drawn = drawnOf(rows);
    expect(starOf(drawn)?.face).toBeNull();
    const host = view(rows, "gl", drawn);
    expect(host.querySelector("[data-atwork-names] li")?.textContent).toBe("Vela on Q3 plan");
    expect(host.querySelector(".vf-atwork-chip")).toBeNull();
  });

  it("touches the sleeping overlay once for the change, and never for a publish that moves no spark here", async () => {
    const { useAtWorkSparkWake } = await import("../src/field/desk/at-work/AtWorkOnTheMat");
    let touches = 0;
    const layer = {
      touch: () => {
        touches += 1;
      },
    };
    function Wake({ known }: { readonly known: Known }): null {
      useAtWorkSparkWake(layer, board, known);
      return null;
    }
    const { root } = mountRoot(<Wake known={knownAt("reviewing")} />);
    // its mount reads the sparks at its own first flush
    expect(touches).toBe(0);
    act(() => root.render(<Wake known={knownAt("asking")} />));
    expect(touches).toBe(1);
    // Chat publishes again, this spark unmoved and another changed: nothing here moved
    const elsewhere: Known = new Map(knownAt("asking"));
    elsewhere.set("sp-lyra0002", { name: "Lyra", seed: 138, status: "stuck" });
    act(() => root.render(<Wake known={elsewhere} />));
    expect(touches).toBe(1);
  });

  it("touches it once when the sparks are read after the first draw (a crew sticker's printed star), never for a crew spark's status", async () => {
    const { atWorkSparksKey, useAtWorkSparkWake } = await import(
      "../src/field/desk/at-work/AtWorkOnTheMat"
    );
    const crew = boardOf([row("r1", "reading", { agent: SECOND.id, startedBy: SPARK })]);
    expect(atWorkSparksKey(crew, NONE_KNOWN)).toBe(SPARK);
    // a crew run's printed star wears its spark's seed and no status: its key is the seed alone
    expect(atWorkSparksKey(crew, knownAt("ready"))).toBe(`${SPARK}:212`);
    expect(atWorkSparksKey(crew, knownAt("stuck"))).toBe(`${SPARK}:212`);
    // the same spark at work on the board on its own run keys its status too
    const both = boardOf([
      row("r1", "reading", { agent: SECOND.id, startedBy: SPARK }),
      row("s1", "acting", { spark: SPARK }),
    ]);
    expect(atWorkSparksKey(both, knownAt("ready"))).toBe(`${SPARK}:212:ready`);
    let touches = 0;
    const layer = {
      touch: () => {
        touches += 1;
      },
    };
    function Wake({ known }: { readonly known: Known }): null {
      useAtWorkSparkWake(layer, crew, known);
      return null;
    }
    const { root } = mountRoot(<Wake known={NONE_KNOWN} />);
    act(() => root.render(<Wake known={knownAt("ready")} />));
    expect(touches).toBe(1);
    // its spark's status moves in Chat: nothing the overlay draws here moved
    act(() => root.render(<Wake known={knownAt("stuck")} />));
    expect(touches).toBe(1);
  });

  it("counts its renders on the layer's counter, and lets its layer go with it", () => {
    const mat = sourceOf("AtWorkOnTheMat.tsx");
    expect(mat).toContain("countAtWorkRender();");
    expect(mat).not.toMatch(/export function atWorkRenders\b/u);
    expect(mat).not.toMatch(/\brenders \+= 1\b/u);
    expect(mat).toContain("useEffect(() => () => layer.dispose(), [layer]);");
    // a spark's status is read where Chat reads it, never kept here
    expect(mat).toContain("sparkEntryNow(spark)?.status ?? null");
    expect(mat).not.toMatch(/\batWorkKeptFaces\b/u);
    // its seed is Chat's, else a smoke's lent one, so a lent spark's still stands once its stage is let go
    expect(mat).toContain("knownRef.current.get(spark)?.seed ?? lentAtWorkSeed(spark)");
  });
});
