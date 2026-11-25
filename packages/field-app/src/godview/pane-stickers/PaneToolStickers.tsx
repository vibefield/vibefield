import { type Entity, PrefabId } from "@vibecook/ice";
import { deskKind, type ObjectPresence } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { declaredProps } from "../../field/desk/agent/applier";
import { usePresence } from "../../field/desk/agent/presence-store";
import {
  currentDesk,
  type MountedDesk,
  plainWords,
  subscribeDesk,
} from "../../field/desk/desk-door";
import { showOnDesk } from "../../field/desk/look-at-object";
import { useDeckAgentFacts } from "../monitor/GodviewAgentsProvider";
import {
  type PaneStickerItem,
  paneStickerItems,
  shownStickers,
  stateWords,
  stickerAngle,
} from "./pane-stickers-model";
import { connectStickerArt, type StickerArt, stickerArtUrl, useStickerArts } from "./sticker-art";
import "./pane-stickers.css";

/** One sticker as the view draws it. */
export interface PaneStickerFace {
  readonly item: PaneStickerItem;
  /** the art as an image; absent: a blank paper label (a kind on a board this window has not mounted, or art never served) */
  readonly url?: string | undefined;
  /** the art's sides and its cut's corner, each over its long side */
  readonly w: number;
  readonly h: number;
  readonly r: number;
  /** its own angle, degrees */
  readonly angle: number;
  /** the kind's title ("Browser") */
  readonly kind: string;
  /** the object's own name ("localhost:5173"), when its kind names one */
  readonly name?: string | undefined;
  /** what the agent is doing with it ("changing it") */
  readonly words: string;
}

const stillMotion = (element: Element): boolean =>
  element.closest('[data-godview-animations="off"]') !== null ||
  (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

/** Each landed act presses the sticker once (the act's `lastChange` moves while it acts). */
function usePress(button: RefObject<HTMLButtonElement | null>, beat: string | undefined): void {
  const last = useRef(beat);
  useEffect(() => {
    const was = last.current;
    last.current = beat;
    const element = button.current;
    if (
      beat === undefined ||
      was === undefined ||
      beat === was ||
      element === null ||
      stillMotion(element)
    )
      return;
    element.classList.add("is-pressed");
    const lift = setTimeout(() => element.classList.remove("is-pressed"), 140);
    return () => clearTimeout(lift);
  }, [button, beat]);
}

/** An act that failed shivers the sticker once: a one-shot on the Web Animations API, finite and event-driven (never a
 * stylesheet keyframe: GT-D15.1's audit admits Godview's loops by name, and this is no loop). */
function useShiver(button: RefObject<HTMLButtonElement | null>, failed: boolean): void {
  const was = useRef(failed);
  useEffect(() => {
    const element = button.current;
    if (
      failed &&
      !was.current &&
      element !== null &&
      !stillMotion(element) &&
      typeof element.animate === "function"
    )
      element.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(2.4px)", offset: 0.09 },
          { transform: "translateX(-2.2px)", offset: 0.18 },
          { transform: "translateX(1.9px)", offset: 0.28 },
          { transform: "translateX(-1.6px)", offset: 0.37 },
          { transform: "translateX(1.2px)", offset: 0.46 },
          { transform: "translateX(-0.9px)", offset: 0.56 },
          { transform: "translateX(0.6px)", offset: 0.65 },
          { transform: "translateX(-0.3px)", offset: 0.75 },
          { transform: "translateX(0)" },
        ],
        { duration: 600, easing: "linear" },
      );
    was.current = failed;
  }, [button, failed]);
}

function PaneSticker({
  face,
  chip,
  onChip,
  onShow,
}: {
  face: PaneStickerFace;
  chip: boolean;
  onChip: (on: boolean) => void;
  onShow: (item: PaneStickerItem) => void;
}): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  usePress(button, face.item.state === "acting" ? face.item.lastChange : undefined);
  useShiver(button, face.item.state === "failed");
  const style = {
    "--vf-sticker-w": face.w,
    "--vf-sticker-h": face.h,
    "--vf-sticker-r": face.r,
    "--vf-sticker-tilt": `${face.angle}deg`,
  } as CSSProperties;
  const named = face.name === undefined ? face.kind : `${face.kind} “${face.name}”`;
  return (
    <span className="vf-pane-sticker-slot">
      <button
        ref={button}
        type="button"
        className="vf-pane-sticker"
        data-state={face.item.state}
        style={style}
        aria-label={`${named}, ${face.words}. Show it on the desk`}
        onPointerEnter={() => onChip(true)}
        onPointerLeave={() => onChip(false)}
        onFocus={() => onChip(true)}
        onBlur={() => onChip(false)}
        onClick={() => onShow(face.item)}
      >
        <span className="vf-pane-sticker__body">
          <span
            className="vf-pane-sticker__paper"
            data-blank={face.url === undefined ? "" : undefined}
          >
            {face.url === undefined ? null : (
              <img className="vf-pane-sticker__art" src={face.url} alt="" draggable={false} />
            )}
            <span className="vf-pane-sticker__sheen" aria-hidden="true" />
          </span>
        </span>
        <span className="vf-pane-sticker__ring" aria-hidden="true" />
      </button>
      {chip ? (
        <span className="vf-pane-sticker-chip" role="tooltip">
          <b>{face.kind}</b>
          {face.name === undefined ? null : (
            <>
              <span className="vf-pane-sticker-chip__dot">·</span>
              <span className="vf-pane-sticker-chip__name">{face.name}</span>
            </>
          )}
          <span className="vf-pane-sticker-chip__dot">·</span>
          {face.words}
          <span className="vf-pane-sticker-chip__go" aria-hidden="true">
            ↗
          </span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * OB-D16 (2026-11-25; DESIGN.md §8 "At work, in the pane") — THE OBJECTS A PANE'S AGENT HOLDS, as their stickers: stuck
 * on the pane's bottom-right corner over the terminal's last rows, first held nearest the corner, the rest a little pile
 * to its left, past three the first two and a count. Each says its state by motion, as item 550's mark does (a band
 * of light while the agent reads or acts, a press each act, a lift and a ring while it needs you, one shiver when an act
 * fails, grey under your hand, a dashed backing while it waits its turn, a peel when it lets go), never by colour.
 * Pointing at one names it; clicking one goes to it on the desk.
 */
export function PaneToolStickersView({
  faces,
  more,
  onShow,
}: {
  faces: readonly PaneStickerFace[];
  more: number;
  onShow: (item: PaneStickerItem) => void;
}): ReactElement {
  const [chip, setChip] = useState<string | null>(null);
  return (
    <div className="vf-pane-stickers">
      {faces.map((face) => (
        <PaneSticker
          key={face.item.ref}
          face={face}
          chip={chip === face.item.ref}
          onChip={(on) =>
            setChip((held) => (on ? face.item.ref : held === face.item.ref ? null : held))
          }
          onShow={onShow}
        />
      ))}
      {more > 0 ? (
        <span className="vf-pane-sticker-slot">
          <span
            className="vf-pane-sticker vf-pane-sticker--more"
            role="img"
            aria-label={`${more} more`}
          >
            +{more}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** The object on the mounted desk: its kind and its props (a row on a board this window has not mounted is none). */
function onTheDesk(
  desk: MountedDesk | null,
  item: PaneStickerItem,
): { kind: string; props: Readonly<Record<string, unknown>> } | undefined {
  if (desk === null || desk.docId !== item.docId) return undefined;
  const { engine } = desk;
  const entity = engine.docs.current()?.store.resolve(item.key as never) as Entity | undefined;
  if (entity === undefined || !engine.world.isAlive(entity)) return undefined;
  const kind = engine.world.get(entity, PrefabId)?.id;
  return typeof kind === "string" ? { kind, props: declaredProps(engine, entity) } : undefined;
}

/** The face a sticker wears: its art (painted from the object's props), its name, its words. */
export function stickerFace(
  item: PaneStickerItem,
  run: string,
  desk: MountedDesk | null,
  arts: ReadonlyMap<string, StickerArt>,
  objects: readonly ObjectPresence[],
): PaneStickerFace {
  const found = onTheDesk(desk, item);
  const art = found === undefined ? undefined : arts.get(found.kind);
  const kind =
    found === undefined ? "An object" : (desk?.words?.(found.kind) ?? plainWords(found.kind)).title;
  const nameProp = found === undefined ? undefined : (deskKind(found.kind)?.titleProp ?? art?.name);
  const nameValue = nameProp === undefined ? undefined : found?.props[nameProp];
  const name =
    typeof nameValue === "string" && nameValue.trim().length > 0 ? nameValue.trim() : undefined;
  const holder =
    item.holder === undefined
      ? undefined
      : objects
          .find((object) => object.ref === item.ref)
          ?.agents.find((agent) => agent.run === item.holder)?.handle;
  const long = art === undefined ? 1 : Math.max(art.width, art.height);
  return {
    item,
    url: art === undefined || found === undefined ? undefined : stickerArtUrl(art, found.props),
    w: art === undefined ? 0.8 : art.width / long,
    h: art === undefined ? 0.8 : art.height / long,
    r: art === undefined ? 0.16 : art.radius / long,
    angle: stickerAngle(item.ref, run),
    kind,
    name,
    words: stateWords(item.state, holder),
  };
}

/**
 * The controller: one pane's session, its run from the deck's facts (fieldd's `runtimeRunId`, a local run's alone, so
 * another desktop's pane wears none), the window's at-work feed, the desk the objects are on, and every kind's art;
 * portaled into ghosttea's pane element beside the frame, as the pane's other states are.
 */
export function PaneToolStickers({
  pane,
  sessionId,
}: {
  pane: HTMLElement;
  sessionId: string;
}): ReactElement | null {
  const { runs } = useDeckAgentFacts();
  const run = runs.get(sessionId);
  const objects = usePresence();
  const arts = useStickerArts();
  const desk = useSyncExternalStore(subscribeDesk, currentDesk, currentDesk);
  const fieldd = useFielddClient();
  useEffect(() => {
    connectStickerArt(fieldd);
  }, [fieldd]);
  if (run === undefined) return null;
  const { shown, more } = shownStickers(paneStickerItems(objects, run));
  if (shown.length === 0) return null;
  const faces = shown.map((item) => stickerFace(item, run, desk, arts, objects));
  return createPortal(
    <PaneToolStickersView faces={faces} more={more} onShow={(item) => void showOnDesk(item)} />,
    pane,
  );
}
