import { type Entity, PrefabId } from "@vibecook/ice";
import { useCanvasEngine } from "@vibecook/ice/react";
import type { SparkId } from "@vibefield/contracts";
import type { SparkStatus } from "@vibefield/design-kit/spark-face";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { sparkEntryNow, useSparksReading } from "../../../chat/sparks-feed";
import { rootToken } from "../../../frame/cards/press/press-colours";
import { useCovered } from "../../../frame/view-state";
import { useAppTheme } from "../../../theme";
import { useReducedMotion } from "../bar/bar-motion";
import { currentDesk, plainWords } from "../desk-door";
import { type PeersHidden, peersHidden } from "../peers/peers-model";
import { useBoardFacts } from "../pegboard/board-door";
import { AtWorkView } from "./AtWorkView";
import {
  type AtWorkLayer,
  countAtWorkRender,
  createAtWorkLayer,
  lentAtWorkSeed,
} from "./at-work-layer";
import { createAtWorkReflector } from "./at-work-reflector";
import { type AtWorkBoard, useAtWorkBoard } from "./at-work-store";
import {
  type AtWorkChipParts,
  type AtWorkChipState,
  type AtWorkWordSources,
  atWorkChipOf,
  atWorkNamesOf,
} from "./at-work-words";

// AT WORK ON THE MAT, in the desk (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat"). Mounted as `<Desk>`'s
// child, before the peers, so it lies in the desk's own box under them. It makes the window's at-work layer
// (`at-work-layer.ts`: the GL marks, or the DOM form) and its reflector (`at-work-reflector.ts`: placed in the desk's
// own flush, registered after its compose), hands the layer its verdict and the person's reduced motion, and renders
// the view (`AtWorkView.tsx`) only when its SHAPE moves — an element coming or going, the form, the verdict — never per
// frame: the layer writes every place imperatively. The layer stands hidden as the peers' does (`peersHidden`): while
// the desk does not draw, under a cover, while the board is out; never by a peer's idle. The names read the board the
// applier publishes (`atWorkStore`), each spark as Chat's list holds it — its name, its seed and its status, the one
// its star wears (DESIGN.md §2.10: one status on every surface, never one mapped from its row) — and an object's name
// the bar's words for its type (§9: ‹object› as the bar says it). The overlay draws no frame at rest (§6 "At rest",
// M5), so a publish of Chat's list that moves a spark at work on this board — read at last, a spark's own new status —
// touches it once, and a publish that moves none of them draws nothing.

/** A spark as Chat's list holds it: its name for the words, its seed for its star, its status for both. */
export interface AtWorkSparkKnown {
  readonly name: string;
  readonly seed: number;
  readonly status: SparkStatus;
}

/** A spark's status as Chat's list holds it now, or null while the list does not hold it (DESIGN.md §2.10): the
 * layer's read, which it makes as it steps, outside React's render. */
const sparkStatusNow = (spark: SparkId): SparkStatus | null => sparkEntryNow(spark)?.status ?? null;

/** Item 550 (2026-11-18): what the overlay reads of the sparks at work on `board`, as one key — a spark's own run's
 * seed and status as Chat's list holds them (its star wears both), a crew run's spark's seed alone (its printed star
 * wears no status). It moves when one of them is read, or a spark's own status changes, and never for a crew spark's
 * status or a spark that is not on the board. PURE. */
export function atWorkSparksKey(
  board: AtWorkBoard,
  known: ReadonlyMap<string, AtWorkSparkKnown>,
): string {
  const ids = new Set<string>();
  const own = new Set<string>();
  for (const object of board.objects.values()) {
    for (const row of object.agents) {
      if (row.spark !== undefined) {
        ids.add(row.spark);
        own.add(row.spark);
      }
      if (row.startedBy !== undefined) ids.add(row.startedBy);
    }
  }
  return [...ids]
    .sort()
    .map((id) => {
      const spark = known.get(id);
      if (spark === undefined) return id;
      return own.has(id) ? `${id}:${spark.seed}:${spark.status}` : `${id}:${spark.seed}`;
    })
    .join("|");
}

/** The layer the sparks were last read for, and what it read of them then. */
interface SparksRead {
  readonly layer: Pick<AtWorkLayer, "touch">;
  readonly key: string;
}

/** Item 550 (2026-11-18): the overlay touched ONCE when what it reads of the sparks at work on `board` moves — a spark
 * read after the first draw, a spark's own new status (DESIGN.md §2.10; §6 "At rest": it draws no frame at rest, so
 * Chat's publish must wake it) — never at its mount, whose first flush reads them, and never for a publish that moves
 * none of them (M5). */
export function useAtWorkSparkWake(
  layer: Pick<AtWorkLayer, "touch">,
  board: AtWorkBoard,
  known: ReadonlyMap<string, AtWorkSparkKnown>,
): void {
  const key = useMemo(() => atWorkSparksKey(board, known), [board, known]);
  const last = useRef<SparksRead | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = { layer, key };
    if (was !== null && was.layer === layer && was.key !== key) layer.touch();
  }, [layer, key]);
}

/** An object's name as the bar says it (its type's words on this mount), or null for one the desk does not hold. */
function thingOf(key: string): string | null {
  const desk = currentDesk();
  if (desk === null) return null;
  const { world } = desk.engine;
  const e = desk.engine.docs.current()?.store.resolve(key as never) as Entity | undefined;
  if (e === undefined || !world.isAlive(e)) return null;
  const type = world.get(e, PrefabId)?.id;
  if (typeof type !== "string") return null;
  return (desk.words ?? plainWords)(type).title;
}

export function AtWorkOnTheMat({
  drawing,
  docId,
}: {
  drawing: boolean;
  /** the board the stage shows (CanvasStage's `docId`); none: no marks */
  docId?: string | undefined;
}): ReactElement {
  const ce = useCanvasEngine();
  const covered = useCovered();
  const facts = useBoardFacts();
  const hidden = peersHidden({ drawing, covered, boardOut: facts?.open === true });
  const reduced = useReducedMotion();
  const theme = useAppTheme().resolved;
  const sparks = useSparksReading();
  const board = useAtWorkBoard(docId ?? "");

  // the sparks as Chat's list holds them: a name for the words, a seed for a star, a status for both
  const known = useMemo(() => {
    const byId = new Map<string, AtWorkSparkKnown>();
    if (sparks.state === "ready")
      for (const entry of sparks.entries)
        byId.set(entry.spark.id, {
          name: entry.spark.name,
          seed: entry.spark.face.seed,
          status: entry.status,
        });
    return byId;
  }, [sparks]);
  const knownRef = useRef(known);
  knownRef.current = known;
  /** a spark's face seed: one door for the layer and the view alike, read as Chat reads it now, else a smoke's lent one
   * (the product lends none) */
  const seedOf = useCallback(
    (spark: SparkId): number | null => knownRef.current.get(spark)?.seed ?? lentAtWorkSeed(spark),
    [],
  );

  // the verdict as placement reads it: while it stands, nothing is placed
  const hiddenRef = useRef<PeersHidden>(hidden);
  const layer = useMemo(
    () =>
      createAtWorkLayer({
        now: () => performance.now(),
        frameStamp: () => {
          const at = typeof document === "undefined" ? null : document.timeline?.currentTime;
          return typeof at === "number" ? at : null;
        },
        requestFrame: (fn) => requestAnimationFrame(() => fn()),
        cancelFrame: (handle) => cancelAnimationFrame(handle as number),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        deskAwake: () => !ce.engine.frame.sleepStats().asleep,
        token: rootToken,
        sparkSeed: seedOf,
        sparkStatus: sparkStatusNow,
      }),
    // one layer per engine: the window's one context is the layer's to borrow, never to make again
    [ce, seedOf],
  );
  const reflector = useMemo(
    () =>
      createAtWorkReflector({
        layer,
        now: () => performance.now(),
        hidden: () => hiddenRef.current !== null,
      }),
    [layer],
  );
  useEffect(() => reflector.attach(), [reflector]);
  // a layer this mount made is let go with it, or with its engine (the window's context stays, for the next mount)
  useEffect(() => () => layer.dispose(), [layer]);
  useLayoutEffect(() => {
    hiddenRef.current = hidden;
    // lifted: the desk as it stands now is placed first, so the layer's first frame back is never an old one
    if (hidden === null) reflector.refresh();
    layer.setHidden(hidden);
  }, [layer, reflector, hidden]);
  useLayoutEffect(() => layer.setReducedMotion(reduced), [layer, reduced]);
  const shape = useSyncExternalStore(layer.subscribe, layer.shape, layer.shape);
  useAtWorkSparkWake(layer, board, known);

  const sources = useMemo<AtWorkWordSources>(
    () => ({
      sparkName: (spark) => known.get(spark)?.name ?? null,
      thingOf,
      sparkStatus: (spark) => known.get(spark)?.status ?? null,
    }),
    [known],
  );
  const names = useMemo(() => atWorkNamesOf(board, sources), [board, sources]);
  const chipOf = (key: string, run: string, state: AtWorkChipState): AtWorkChipParts | null => {
    const row = board.objects.get(key)?.agents.find((agent) => agent.run === run);
    return row === undefined ? null : atWorkChipOf(row, state, sources);
  };

  countAtWorkRender();
  return (
    <AtWorkView
      shape={shape}
      names={names}
      chipOf={chipOf}
      seedOf={seedOf}
      theme={theme}
      refOf={layer.ref}
      glRef={layer.host}
    />
  );
}
