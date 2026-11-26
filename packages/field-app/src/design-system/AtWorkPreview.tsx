import { deskTheme } from "@vibecook/ice/desk/objects";
import { AGENT_CATALOG, type SparkId } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import type { SparkStatus } from "@vibefield/design-kit/spark-face";
import {
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AtWorkView } from "../field/desk/at-work/AtWorkView";
import { type AtWorkInks, readAtWorkInks } from "../field/desk/at-work/at-work-ink";
import { AT_WORK_FOCUS, createAtWorkLayer } from "../field/desk/at-work/at-work-layer";
import {
  type AtWorkCamera,
  type AtWorkObjectState,
  type ScreenFrame,
  screenFrameOf,
  stepAtWork,
} from "../field/desk/at-work/at-work-model";
import type { AtWorkProject, AtWorkRow } from "../field/desk/at-work/at-work-rows";
import { AT_WORK_NO_PENCIL, atWorkPencilOf } from "../field/desk/at-work/at-work-shader";
import {
  AT_WORK_DOM_INKS,
  type AtWorkDrawnObject,
  atWorkPlacementsOf,
  atWorkShapeOf,
} from "../field/desk/at-work/at-work-shape";
import type { AtWorkBoard } from "../field/desk/at-work/at-work-store";
import {
  type AtWorkChipParts,
  type AtWorkChipState,
  type AtWorkWordSources,
  atWorkChipOf,
  atWorkNamesOf,
} from "../field/desk/at-work/at-work-words";
import { rootToken } from "../frame/cards/press/press-colours";

// AT WORK ON THE MAT IN THE CATALOG (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat", its witnesses). The
// SHIPPING view (`AtWorkView`) over fixture rows, its marks made by the product's own model (`stepAtWork`) and its
// elements placed by the product's own placements (`atWorkShapeOf`, `atWorkPlacementsOf`), through a fixture camera
// (`screenFrameOf`), on a stand-in for the LIT MAT (`--vf-mat-ground`): the desk draws the mat on the GPU, so each
// plate lays its ground where it lies, as the peers' plates do. The plates are the DOM form — every state, a crew
// sticker, the LOD bands — still; the live plate is the shipping GL layer (`createAtWorkLayer`, the window's one
// context) over the same fixtures, moving, with reduced motion and both lights, and the one plate of a selection: the
// band the overlay keeps clear for ICE's pencil, which only the GL form masks (the catalog draws no brackets of its
// own). The names and the chips are the product's words (`atWorkNamesOf`, `atWorkChipOf`). A spark's status is Chat's
// (DESIGN.md §2.10), so each fixture says what Chat's list holds of its sparks at each moment, and the model, the
// layer and the words read it there, as the mount reads Chat's list.
// A LIVE PAGE AT WORK (item 550b, 2026-11-24): an agent's browser pane wears the mark round its own silhouette, head
// included (the pane kind's `frame`), so two plates stand a pane's frame in for the note's, named as the bar names the
// kind, reading and acting; the page itself is the desk's to draw, so the plate lays only its mat, as every plate does.
// A PAGE IN YOUR HAND (item 550, 2026-11-24; DESIGN.md §8 When not): a pane lifted to browse, its own mark grey and
// still, and a Simulator behind it, dimmed, its marks covered where the pane lies: the DOM form hides its frame whole
// and keeps its sticker, which stands past the pane's edge; the live plate's GL form masks its stroke by the pixel. The
// pane is not drawn here either: the cover's edge is the held pane's silhouette, where its own stroke runs.

/** The plate's size and the fixture object, world units = CSS px at zoom 1. */
const PLATE = { width: 420, height: 230 } as const;
const OBJECT: ScreenFrame = { cx: 176, cy: 112, hx: 84, hy: 56, angle: -0.035, r: 8 };
const KEY = "fixture-note";
/** A browser pane's silhouette at the plate's scale (item 550b, 2026-11-24): wider than the note, square to the mat,
 * its corner the pane's. */
const PAGE: ScreenFrame = { cx: 170, cy: 115, hx: 112, hy: 72, angle: 0, r: 12 };
/** Item 550 (2026-11-24): a pane in the hand, at the plate's middle (its camera the world's own, zoom 1), and a
 * Simulator behind it, its right side past the pane's edge. */
const HELD_PAGE: ScreenFrame = { cx: 186, cy: 115, hx: 130, hy: 80, angle: 0, r: 14 };
const BEHIND: ScreenFrame = { cx: 322, cy: 124, hx: 34, hy: 66, angle: 0, r: 16 };
const BEHIND_KEY = "fixture-simulator";
/** The out-of-focus desk's level behind the hand, as the layer dims it once the pickup is over. */
const DIMMED = AT_WORK_FOCUS.dimmed;

/** The fixture camera, centred on the object at `zoom`. */
const cameraAt = (zoom: number, object: ScreenFrame = OBJECT): AtWorkCamera => ({
  x: object.cx - PLATE.width / 2 / zoom + 24 / zoom,
  y: object.cy - PLATE.height / 2 / zoom,
  zoom,
});

/** Agents from the catalog by place (a fixture never spells an id), and two sparks. */
const AGENT = AGENT_CATALOG.map((row) => row.id);
const agentAt = (at: number): string => AGENT[at % AGENT.length] ?? "agent";
const VELA: SparkId = "sp-vela01";
const LYRA: SparkId = "sp-lyra02";
const SPARKS: ReadonlyMap<SparkId, { readonly name: string; readonly seed: number }> = new Map([
  [VELA, { name: "Vela", seed: 212 }],
  [LYRA, { name: "Lyra", seed: 138 }],
]);

/** What Chat's list holds of the fixture's sparks at a moment: each one's status (DESIGN.md §2.10). */
type Statuses = ReadonlyMap<SparkId, SparkStatus>;
const NO_STATUSES: Statuses = new Map();
/** Chat's list holding each spark at its status. */
const holding = (...held: readonly (readonly [SparkId, SparkStatus])[]): Statuses => new Map(held);

/** A fixture row: in vibe-field (Godview's deal 3) unless it says another project, or none (`null`). */
function row(
  run: string,
  agent: string,
  state: AtWorkRow["state"],
  extra: {
    readonly project?: AtWorkProject | null;
    readonly spark?: SparkId;
    readonly startedBy?: SparkId;
  } = {},
): AtWorkRow {
  const project = extra.project === undefined ? { name: "vibe-field", seq: 3 } : extra.project;
  return {
    run,
    handle: run,
    agent,
    state,
    since: 1,
    ...(project === null ? {} : { project }),
    ...(extra.spark === undefined ? {} : { spark: extra.spark }),
    ...(extra.startedBy === undefined ? {} : { startedBy: extra.startedBy }),
  };
}

/** One change of a fixture: its rows, and Chat's statuses when they move (none said: as they stood). */
interface AtWorkChange {
  readonly afterMs: number;
  readonly rows: readonly AtWorkRow[];
  readonly statuses?: Statuses;
}

/** One plate's fixture: the rows the object begins with (landed: already at work) and Chat's statuses then; `next`,
 * each later change. */
interface AtWorkFixture {
  readonly rows: readonly AtWorkRow[];
  readonly statuses?: Statuses;
  readonly next?: readonly AtWorkChange[];
  /** how long after the last change the plate is drawn, ms */
  readonly holdMs?: number;
  readonly zoom?: number;
  readonly heldByYou?: boolean;
  readonly reduced?: boolean;
  readonly selected?: boolean;
  /** the object's silhouette, world units: the note's unless said (a page's, item 550b) */
  readonly object?: ScreenFrame;
  /** the object's name as the bar says it: the note's "Q3 plan" unless said */
  readonly thing?: string;
  /** item 550 (2026-11-24): the object is in hand, and this one lies behind it: its silhouette, its rows, its name */
  readonly behind?: {
    readonly object: ScreenFrame;
    readonly rows: readonly AtWorkRow[];
    readonly thing: string;
  };
}

const one = (state: AtWorkRow["state"]): AtWorkFixture => ({
  rows: [row("run-a", agentAt(0), state)],
});

/** The DOM form's plates, each a still. */
export const AT_WORK_PLATES = [
  "Open",
  "Reading",
  "Acting",
  "Needs you",
  "Paused — your hand on it",
  "Failed",
  "Released — leaving",
  "Three agents",
  "Five agents — +N",
  "A spark at work",
  "A spark needs you",
  "A crew run",
  "An unknown agent",
  "No project",
  "Zoomed out — merged",
  "Far — a line",
  "Reduced motion",
  "A page at work — reading",
  "A page at work — acting",
  "A page in your hand — another behind it",
] as const;
export type AtWorkPlateState = (typeof AT_WORK_PLATES)[number];

/** The live plate's picks: every still's fixture, and the selection, which only the GL form keeps clear for. */
const SELECTED = "Selected — the band ICE's pencil lies in";
export const AT_WORK_LIVE_PLATES = [...AT_WORK_PLATES, SELECTED] as const;
export type AtWorkLivePlateState = (typeof AT_WORK_LIVE_PLATES)[number];

const three = [
  row("run-a", agentAt(0), "acting"),
  row("run-b", agentAt(1), "reading", { project: { name: "garden", seq: 7 } }),
  row("run-c", agentAt(2), "open", { project: { name: "ledger", seq: 11 } }),
];

const FIXTURES: Readonly<Record<AtWorkLivePlateState, AtWorkFixture>> = {
  Open: one("open"),
  Reading: one("reading"),
  Acting: one("acting"),
  "Needs you": one("needs-you"),
  "Paused — your hand on it": { rows: [row("run-a", agentAt(0), "acting")], heldByYou: true },
  Failed: {
    rows: [row("run-a", agentAt(0), "acting")],
    next: [{ afterMs: 100, rows: [row("run-a", agentAt(0), "failed")] }],
    holdMs: 700,
  },
  "Released — leaving": {
    rows: [row("run-a", agentAt(0), "open")],
    next: [{ afterMs: 100, rows: [row("run-a", agentAt(0), "released")] }],
    holdMs: 230,
  },
  "Three agents": { rows: three },
  "Five agents — +N": {
    rows: [
      ...three,
      row("run-d", agentAt(3), "open", { project: { name: "tides", seq: 2 } }),
      row("run-e", agentAt(4), "open", { project: { name: "atlas", seq: 5 } }),
    ],
  },
  "A spark at work": {
    rows: [row("run-s", agentAt(0), "reading", { spark: VELA })],
    statuses: holding([VELA, "reviewing"]),
  },
  // its status turns Asking you in Chat's list: its star and its words follow, and its chip stands
  "A spark needs you": {
    rows: [row("run-s", agentAt(0), "reading", { spark: VELA })],
    statuses: holding([VELA, "reviewing"]),
    next: [
      {
        afterMs: 100,
        rows: [row("run-s", agentAt(0), "needs-you", { spark: VELA })],
        statuses: holding([VELA, "asking"]),
      },
    ],
  },
  "A crew run": {
    rows: [row("run-a", agentAt(1), "needs-you", { startedBy: LYRA })],
    statuses: holding([LYRA, "running"]),
  },
  // an id no catalog row holds: the sticker wears its letter (the toolkit's `agentMark`), the words its id itself, as
  // the window names it elsewhere (`agentLabel`)
  "An unknown agent": { rows: [row("run-a", "zephyr", "needs-you")] },
  "No project": { rows: [row("run-a", agentAt(0), "reading", { project: null })] },
  "Zoomed out — merged": { rows: three, zoom: 0.4 },
  "Far — a line": { rows: three, zoom: 0.12 },
  "Reduced motion": { rows: [row("run-a", agentAt(0), "acting")], reduced: true },
  // item 550b (2026-11-24): an agent's browser pane, its page read, then acted on
  "A page at work — reading": {
    rows: [row("run-a", agentAt(0), "reading")],
    object: PAGE,
    thing: "Browser",
  },
  "A page at work — acting": {
    rows: [row("run-a", agentAt(0), "acting")],
    object: PAGE,
    thing: "Browser",
  },
  // item 550 (2026-11-24): the pane in your hand (its mark grey and still), and the Simulator the same agent placed,
  // behind it
  "A page in your hand — another behind it": {
    rows: [row("run-a", agentAt(0), "reading")],
    object: HELD_PAGE,
    thing: "Browser",
    heldByYou: true,
    behind: { object: BEHIND, rows: [row("run-a", agentAt(0), "open")], thing: "iOS Simulator" },
  },
  [SELECTED]: { rows: three, selected: true },
};

/** The fixture as a board, as the store would hold it: its rows on one object (and the one behind the hand, when
 * there is one), landed or arriving. */
function boardOf(
  rows: readonly AtWorkRow[],
  epoch: number,
  landed: boolean,
  behind?: AtWorkFixture["behind"],
): AtWorkBoard {
  const objects: [string, readonly AtWorkRow[]][] = [[KEY, rows]];
  if (behind !== undefined) objects.push([BEHIND_KEY, behind.rows]);
  return {
    docId: "fixture",
    objects: new Map(objects.map(([key, agents]) => [key, { ref: "fixture", key, agents }])),
    landed: landed
      ? new Map(objects.map(([key, agents]) => [key, new Set(agents.map((r) => r.run))]))
      : new Map(),
    epoch,
  };
}

/** The fixture's rows as they stand at its last change. */
const lastRowsOf = (fixture: AtWorkFixture): readonly AtWorkRow[] =>
  fixture.next?.at(-1)?.rows ?? fixture.rows;

/** Chat's statuses at the fixture's last change: each change's own, else those that stood. */
const lastStatusesOf = (fixture: AtWorkFixture): Statuses =>
  (fixture.next ?? []).reduce<Statuses>(
    (stood, change) => change.statuses ?? stood,
    fixture.statuses ?? NO_STATUSES,
  );

const seedOf = (spark: SparkId): number | null => SPARKS.get(spark)?.seed ?? null;

/** A spark's status in `statuses`, or null where Chat's list holds none, as the product's `sparkStatus` reads it. */
const statusIn =
  (statuses: Statuses) =>
  (spark: SparkId): SparkStatus | null =>
    statuses.get(spark) ?? null;

/** The words' sources over the fixture: its sparks' names and statuses, each object's name. */
const sourcesOf = (statuses: Statuses, fixture?: AtWorkFixture): AtWorkWordSources => ({
  sparkName: (spark) => SPARKS.get(spark)?.name ?? null,
  thingOf: (key) =>
    key === BEHIND_KEY && fixture?.behind !== undefined
      ? fixture.behind.thing
      : (fixture?.thing ?? "Q3 plan"),
  sparkStatus: statusIn(statuses),
});

/** A chip's parts over one board, by the product's words. */
const chipsOver =
  (board: AtWorkBoard, sources: AtWorkWordSources) =>
  (key: string, run: string, state: AtWorkChipState): AtWorkChipParts | null => {
    const at = board.objects.get(key)?.agents.find((agent) => agent.run === run);
    return at === undefined ? null : atWorkChipOf(at, state, sources);
  };

/** The fixture's frames on screen: its object's, and the one behind the hand's, through the object's camera. */
function framesOf(fixture: AtWorkFixture): {
  readonly frame: ScreenFrame;
  readonly behind: ScreenFrame | null;
} {
  const zoom = fixture.zoom ?? 1;
  const object = fixture.object ?? OBJECT;
  const camera = cameraAt(zoom, object);
  const behind = fixture.behind === undefined ? null : screenFrameOf(fixture.behind.object, camera);
  return { frame: screenFrameOf(object, camera), behind };
}

/** One fixture's drawn objects at its last moment: its object's, and the one behind the hand's — dimmed with the
 * out-of-focus desk and lying under the hand (2026-11-24). */
function drawnOf(fixture: AtWorkFixture, inks: AtWorkInks): AtWorkDrawnObject[] {
  const own = marksOf(fixture, inks);
  const { behind } = framesOf(fixture);
  if (fixture.behind === undefined || behind === null) return [own];
  const under = marksOf(
    { rows: fixture.behind.rows, object: fixture.behind.object, holdMs: fixture.holdMs ?? 1_200 },
    inks,
    { frame: behind, fade: DIMMED },
  );
  return [own, { key: BEHIND_KEY, frame: behind, marks: under.marks, under: true }];
}

/** One fixture's marks as the model leaves them at its last moment: the product's own steps, in its own time; `at`, a
 * frame and a fade of its own (the object behind the hand's). */
function marksOf(
  fixture: AtWorkFixture,
  inks: AtWorkInks,
  at?: { readonly frame: ScreenFrame; readonly fade: number },
): AtWorkDrawnObject {
  const zoom = fixture.zoom ?? 1;
  const frame = at?.frame ?? framesOf(fixture).frame;
  const landed = new Set(fixture.rows.map((r) => r.run));
  let statuses = fixture.statuses ?? NO_STATUSES;
  const step = (prev: AtWorkObjectState | undefined, rows: readonly AtWorkRow[], now: number) =>
    stepAtWork(prev, {
      rows,
      frame,
      zoom,
      now,
      reducedMotion: fixture.reduced === true,
      heldByYou: fixture.heldByYou === true,
      inks,
      landed,
      sparkStatus: statusIn(statuses),
      ...(at === undefined ? {} : { fade: at.fade }),
    });
  let now = 10_000;
  let state = step(undefined, fixture.rows, now);
  let rows = fixture.rows;
  for (const change of fixture.next ?? []) {
    now += change.afterMs;
    rows = change.rows;
    statuses = change.statuses ?? statuses;
    state = step(state, rows, now);
  }
  // the frames between: the eased values approach as they do on screen
  const until = now + (fixture.holdMs ?? 1_200);
  while (now < until) {
    now = Math.min(now + 16, until);
    state = step(state, rows, now);
  }
  return { key: KEY, frame, marks: state.marks };
}

/** The inks as the root spells them now (the catalog's theme), or the DOM form's own. */
const inksNow = (): AtWorkInks => readAtWorkInks(rootToken) ?? AT_WORK_DOM_INKS;

/** One still plate: the DOM form of one state over the lit mat. */
export function AtWorkPlate({
  state,
  dark,
}: {
  state: AtWorkPlateState;
  dark: boolean;
}): ReactElement {
  const fixture = FIXTURES[state];
  const drawn = drawnOf(fixture, inksNow());
  const shape = atWorkShapeOf(drawn, "dom", null);
  const hand = fixture.behind === undefined ? null : framesOf(fixture).frame;
  const placed = new Map(
    atWorkPlacementsOf(drawn, "dom", () => 150, PLATE.width, undefined, hand).map(
      (p) => [p.id, p] as const,
    ),
  );
  const board = boardOf(lastRowsOf(fixture), 0, true, fixture.behind);
  const sources = sourcesOf(lastStatusesOf(fixture), fixture);
  return (
    <div className="vf-ds-atwork-plate" data-state={state} style={PLATE}>
      <AtWorkView
        shape={shape}
        names={atWorkNamesOf(board, sources)}
        chipOf={chipsOver(board, sources)}
        seedOf={seedOf}
        theme={dark ? "dark" : "light"}
        placed={placed}
      />
      <span className="vf-ds-board-caption">{state}</span>
    </div>
  );
}

const MOTIONS = ["Full motion", "Reduced motion"] as const;

/** The live plate: the shipping GL layer over one fixture at a time, arriving afresh at each pick. */
export function AtWorkLivePlate({ dark }: { dark: boolean }): ReactElement {
  const [state, setState] = useState<AtWorkLivePlateState>("Reading");
  const [motion, setMotion] = useState<(typeof MOTIONS)[number]>("Full motion");
  /** Chat's statuses as the fixture holds them now: the layer reads them as it steps */
  const statusesNow = useRef<Statuses>(NO_STATUSES);
  const layer = useMemo(
    () =>
      createAtWorkLayer({
        now: () => performance.now(),
        frameStamp: () => null,
        requestFrame: (fn) => requestAnimationFrame(() => fn()),
        cancelFrame: (handle) => cancelAnimationFrame(handle as number),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        // no desk steps here: the layer's own loop draws every frame it moves
        deskAwake: () => false,
        token: rootToken,
        sparkSeed: seedOf,
        sparkStatus: (spark) => statusesNow.current.get(spark) ?? null,
      }),
    [],
  );
  const shape = useSyncExternalStore(layer.subscribe, layer.shape, layer.shape);
  /** each pick is a fresh feed (a new epoch): the marks arrive */
  const epoch = useRef(0);
  useEffect(
    () => () => {
      layer.drop();
      layer.dispose();
    },
    [layer],
  );
  useEffect(() => {
    const fixture = FIXTURES[state];
    const zoom = fixture.zoom ?? 1;
    const { frame, behind } = framesOf(fixture);
    const reduced = motion === "Reduced motion" || fixture.reduced === true;
    // item 550 (2026-11-24): with an object behind the hand, the fixture's own object is the one in hand
    const placedOf = () => [
      {
        key: KEY,
        frame,
        heldByYou: fixture.heldByYou === true,
        fade: 1,
        dimmed: false,
        held: behind !== null,
      },
      ...(behind === null
        ? []
        : [
            {
              key: BEHIND_KEY,
              frame: behind,
              heldByYou: false,
              fade: 1,
              dimmed: true,
              held: false,
            },
          ]),
    ];
    const scene = (rows: readonly AtWorkRow[], at: number) => ({
      board: boardOf(rows, at, false, fixture.behind),
      placed: placedOf(),
      hand: behind === null ? null : frame,
      zoom,
      view: PLATE,
      // the theme's own light on the mat, and a sole selection's brackets at rest round the object
      light: deskTheme(dark ? "dark" : "light").matLight,
      pencil: fixture.selected === true ? atWorkPencilOf(frame) : AT_WORK_NO_PENCIL,
      theme: dark ? "dark" : "light",
    });
    layer.setReducedMotion(reduced);
    epoch.current += 1;
    const at = epoch.current;
    statusesNow.current = fixture.statuses ?? NO_STATUSES;
    layer.show(scene(fixture.rows, at));
    const timers = (fixture.next ?? []).map((change, index, all) =>
      setTimeout(
        () => {
          statusesNow.current = change.statuses ?? statusesNow.current;
          layer.show(scene(change.rows, at));
        },
        900 + all.slice(0, index + 1).reduce((sum, c) => sum + c.afterMs, 0),
      ),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [layer, state, motion, dark]);
  const fixture = FIXTURES[state];
  const board = boardOf(lastRowsOf(fixture), 0, true, fixture.behind);
  const sources = sourcesOf(lastStatusesOf(fixture), fixture);
  const form = shape.form === "gl" ? "GL" : "DOM";
  return (
    <div className="vf-ds-atwork-live">
      <div className="vf-ds-atwork-live__controls">
        <SegmentedControl
          options={AT_WORK_LIVE_PLATES}
          value={state}
          onChange={setState}
          label="At-work state"
          size="small"
        />
        <SegmentedControl
          options={MOTIONS}
          value={motion}
          onChange={setMotion}
          label="Motion"
          size="small"
        />
      </div>
      <div className="vf-ds-atwork-plate" data-state={state} style={PLATE}>
        <AtWorkView
          shape={shape}
          names={atWorkNamesOf(board, sources)}
          chipOf={chipsOver(board, sources)}
          seedOf={seedOf}
          theme={dark ? "dark" : "light"}
          refOf={layer.ref}
          glRef={layer.host}
        />
        <span className="vf-ds-board-caption">{`${state} · ${form} form`}</span>
      </div>
    </div>
  );
}
