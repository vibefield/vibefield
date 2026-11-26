import type { SparkId } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { SparkFace, type SparkStatus } from "@vibefield/design-kit/spark-face";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { DEFAULT_PROJECT_TINT, projectColour } from "@vibefield/puppeteer-view-sdk/toolkit";
import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import { AT_WORK_ATLAS, AT_WORK_STICKER } from "./at-work-atlas";
import { AT_WORK_STAR_PROPS } from "./at-work-model";
import {
  type AtWorkPlacement,
  type AtWorkShape,
  type AtWorkShapeObject,
  atWorkIds,
} from "./at-work-shape";
import {
  AT_WORK_CHIP_INKS,
  AT_WORK_WORDS,
  type AtWorkChipParts,
  type AtWorkChipState,
  type AtWorkName,
} from "./at-work-words";
import "../peers/peers.css";
import "./at-work.css";

// THE AT-WORK MARK — the markup (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat", §9 "The desk's at-work
// words"). Controller-free, so the catalog mounts this exact markup over fixture rows: the layer in the desk's own box
// (`.vf-atwork`, below the peers, the bar and the line), the GL form's canvas host, and the DOM's elements — in the DOM
// form (no WebGL2, or a lost context) each object's frame as a CSS stroke in its ink, nested as the GL strokes are, and
// its stickers as chips carrying `AgentIcon` (an unknown agent its letter, as on the foil), still and never a blank; in
// both forms each spark's star (a still, wearing its status as Chat's list holds it, §2.10) and each chip on the
// line's glass — the peers' label chip, composed, never a copy: the agent's mark and name (a spark's face, in the
// status its star wears), the project's folder mark in its colour at the theme's lightness (§2.9) and its name, then
// the word. Beside the layer, outside its `aria-hidden`, the names: a visually hidden list per board, and a
// polite live region that says each newly urgent name once. No colour is written here: an ink is the model's (the
// toolkit's colour for a project, a token's `var()` for the rest), a folder mark's the toolkit's. In the product the
// layer writes each element's place imperatively (`at-work-layer.ts`); a fixture passes `placed`.

/** What the view is told beside the shape: the words, the faces and, in the product, the binder. */
export interface AtWorkViewProps {
  readonly shape: AtWorkShape;
  readonly names: readonly AtWorkName[];
  /** a chip's parts, by the object's key, the run and the state it stands for; null for a run the board lost */
  readonly chipOf: (key: string, run: string, state: AtWorkChipState) => AtWorkChipParts | null;
  /** a spark's face seed (its own star, a crew sticker's printed star, a spark's chip), or null while it is not read */
  readonly seedOf: (spark: SparkId) => number | null;
  /** the window's theme: a chip's folder mark takes its lightness (DESIGN.md §2.9) */
  readonly theme: "light" | "dark";
  /** the product's binder: each placed element handed to the layer, which writes its place from then on */
  readonly refOf?: (id: string) => Ref<HTMLDivElement>;
  /** a fixture's places, by element id (the catalog); the product's layer writes them */
  readonly placed?: ReadonlyMap<string, AtWorkPlacement>;
  /** the GL form's canvas host: an element React keeps empty, the layer's canvas taken into it */
  readonly glRef?: Ref<HTMLDivElement>;
}

/** The sticker's numbers in ink px, for the DOM form's stickers (DESIGN.md §2.8: the mark 15 on 4.1 of foil, the 1.6
 * paper edge, the cut 0.7 beyond it), from the atlas the GL form cuts them by. */
const STICKER_VARS = {
  "--vf-atwork-mark": String(AT_WORK_STICKER.scale * AT_WORK_ATLAS.units),
  "--vf-atwork-foil": String(AT_WORK_STICKER.foil),
  "--vf-atwork-edge": String(AT_WORK_STICKER.edge),
  "--vf-atwork-cut": String(AT_WORK_STICKER.cut),
} as CSSProperties;

/** How long the live region holds what it said before it empties, so the next change is heard alone. */
const SAID_FOR_MS = 1_000;

/** The face a star wears with no status of its own to wear: a spark Chat's list does not hold is its still, with no
 * word, and a crew sticker's printed star is a print (DESIGN.md §2.10). */
const STILL_FACE: SparkStatus = "ready";

/** A chip's mark and a crew sticker's printed star, px. */
const CHIP_FACE = 14;
const CREW_FACE = 16;
const FOLDER_GLYPH = 13;

/** A fixture's place as the element's own style (the product's layer writes the same, imperatively). */
function styleOf(place: AtWorkPlacement | undefined): CSSProperties | undefined {
  if (place === undefined) return undefined;
  return {
    transform: place.transform,
    ...(place.opacity === null ? {} : { opacity: place.opacity }),
    ...(place.vars ?? {}),
  } as CSSProperties;
}

/** A project's folder mark's colour: Godview's deal at the theme's tint (DESIGN.md §2.9: off the mat it takes the
 * theme's lightness). PURE. */
export function atWorkFolderInk(seq: number, theme: "light" | "dark"): string {
  return projectColour(seq, DEFAULT_PROJECT_TINT[theme]);
}

/** One object's frame in the DOM form: a stroke per agent (or the far band's line), each in its ink. */
export function AtWorkFrameView({
  object,
  ref,
  place,
}: {
  readonly object: AtWorkShapeObject;
  readonly ref?: Ref<HTMLDivElement> | undefined;
  readonly place?: AtWorkPlacement | undefined;
}): ReactElement {
  return (
    <div
      ref={ref}
      className="vf-atwork-frame"
      data-atwork-frame=""
      data-lod={object.lod}
      style={styleOf(place)}
    >
      {object.strokes.map((stroke) => (
        <i
          key={stroke.run}
          className="vf-atwork-stroke"
          data-form={stroke.form}
          style={
            {
              "--vf-atwork-ink": stroke.ink,
              "--vf-atwork-hw": String(stroke.hw),
              "--vf-atwork-gap": String(stroke.gap),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** One seat: in the DOM form a sticker (the agent's mark on its ink, a printed star on a crew run's) or the paper
 * "+N"; in both forms a spark's own star, free, a still. */
export function AtWorkSeatView({
  seat,
  seedOf,
  ref,
  place,
}: {
  readonly seat: AtWorkShapeObject["seats"][number];
  readonly seedOf: (spark: SparkId) => number | null;
  readonly ref?: Ref<HTMLDivElement> | undefined;
  readonly place?: AtWorkPlacement | undefined;
}): ReactElement | null {
  const style = styleOf(place);
  if (seat.form === "star") {
    const seed = seat.spark === null ? null : seedOf(seat.spark);
    if (seed === null) return null;
    return (
      <div ref={ref} className="vf-atwork-star" data-atwork-seat="star" style={style}>
        <SparkFace
          seed={seed}
          status={seat.face ?? STILL_FACE}
          size={34}
          framed={false}
          props={AT_WORK_STAR_PROPS}
        />
      </div>
    );
  }
  if (seat.form === "count") {
    return (
      <div ref={ref} className="vf-atwork-sticker" data-atwork-seat="count" style={style}>
        <span className="vf-atwork-sticker__count">{AT_WORK_WORDS.count(seat.count)}</span>
      </div>
    );
  }
  const crew = seat.crewSpark === null ? null : seedOf(seat.crewSpark);
  return (
    <div
      ref={ref}
      className="vf-atwork-sticker"
      data-atwork-seat="sticker"
      style={{ ...style, "--vf-atwork-ink": seat.ink } as CSSProperties}
    >
      <span className="vf-atwork-sticker__mark">
        <AgentIcon providerId={seat.agent} />
      </span>
      {crew === null ? null : (
        <span className="vf-atwork-sticker__crew">
          <SparkFace
            seed={crew}
            status={STILL_FACE}
            size={CREW_FACE}
            framed={false}
            props={false}
          />
        </span>
      )}
    </div>
  );
}

/** A chip on the line's glass beside a seat that needs you, or just failed: the peers' label chip (DESIGN.md §8), its
 * marks before the words they name; a spark's face in the status its star wears. */
export function AtWorkChipView({
  chip,
  seedOf,
  theme,
  ref,
  place,
}: {
  readonly chip: AtWorkChipParts;
  readonly seedOf: (spark: SparkId) => number | null;
  readonly theme: "light" | "dark";
  readonly ref?: Ref<HTMLDivElement> | undefined;
  readonly place?: AtWorkPlacement | undefined;
}): ReactElement {
  const between = AT_WORK_WORDS.between;
  const seed = "spark" in chip.mark ? seedOf(chip.mark.spark) : null;
  const mark =
    "agent" in chip.mark ? (
      <AgentIcon providerId={chip.mark.agent} />
    ) : seed === null ? null : (
      <SparkFace
        seed={seed}
        status={chip.face ?? STILL_FACE}
        size={CHIP_FACE}
        framed={false}
        props={AT_WORK_STAR_PROPS}
      />
    );
  const seq = chip.project?.seq ?? null;
  const folder =
    seq === null
      ? undefined
      : ({ "--vf-atwork-folder": atWorkFolderInk(seq, theme) } as CSSProperties);
  return (
    <div
      ref={ref}
      className="vf-peer__chip vf-atwork-chip"
      data-atwork-chip={chip.state}
      style={styleOf(place)}
    >
      {mark === null ? null : <span className="vf-atwork-chip__mark">{mark}</span>}
      <span className="vf-atwork-chip__text">
        {chip.name}
        {chip.project === null ? null : (
          <>
            {between}
            <FieldGlyph
              name="folder"
              size={FOLDER_GLYPH}
              className="vf-atwork-chip__folder"
              {...(folder === undefined ? {} : { style: folder })}
            />
            {chip.project.name}
          </>
        )}
        {chip.role === null ? null : `${between}${chip.role}`}
        {between}
        <span
          className="vf-atwork-chip__word"
          data-ink={AT_WORK_CHIP_INKS ? chip.state : undefined}
        >
          {chip.word}
        </span>
      </span>
    </div>
  );
}

/** What the live region keys a name by: the same words for the same run on the same object are said once. */
const sayKey = (name: AtWorkName): string => `${name.key}:${name.run}:${name.text}`;

/** The names, visually hidden: every one in a list, and each newly urgent one (needs you, failed) said aloud once. */
export function AtWorkNamesView({
  names,
}: {
  readonly names: readonly AtWorkName[];
}): ReactElement {
  const said = useRef<ReadonlySet<string>>(new Set());
  const hush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saying, setSaying] = useState("");
  useEffect(
    () => () => {
      if (hush.current !== null) clearTimeout(hush.current);
    },
    [],
  );
  useEffect(() => {
    const urgent = names.filter((name) => name.urgent);
    const fresh = urgent.filter((name) => !said.current.has(sayKey(name)));
    // what is urgent now is what was said; a name that stops being urgent may be said again when it is again
    said.current = new Set(urgent.map(sayKey));
    if (fresh.length === 0) return;
    setSaying(fresh.map((name) => name.text).join(". "));
    if (hush.current !== null) clearTimeout(hush.current);
    hush.current = setTimeout(() => {
      hush.current = null;
      setSaying("");
    }, SAID_FOR_MS);
  }, [names]);
  return (
    <div className="sr-only" data-atwork-names="">
      <ul aria-label={AT_WORK_WORDS.list}>
        {names.map((name) => (
          <li key={`${name.key}:${name.run}`}>{name.text}</li>
        ))}
      </ul>
      <p aria-live="polite">{saying}</p>
    </div>
  );
}

/** The whole mark: the layer over the desk and the names beside it. */
export function AtWorkView({
  shape,
  names,
  chipOf,
  seedOf,
  theme,
  refOf,
  placed,
  glRef,
}: AtWorkViewProps): ReactElement {
  const dom = shape.form === "dom";
  const placeOf = (id: string): AtWorkPlacement | undefined => placed?.get(id);
  return (
    <>
      <div
        className="vf-atwork"
        aria-hidden="true"
        data-atwork=""
        data-form={shape.form}
        style={STICKER_VARS}
        {...(shape.hidden === null ? {} : { "data-hidden": shape.hidden })}
      >
        <div ref={glRef} className="vf-atwork__gl" />
        {dom
          ? shape.objects.map((object) => {
              const id = atWorkIds.object(object.key);
              return (
                <AtWorkFrameView key={id} object={object} ref={refOf?.(id)} place={placeOf(id)} />
              );
            })
          : null}
        {shape.objects.flatMap((object) =>
          object.seats
            .filter((seat) => dom || seat.form === "star")
            .map((seat) => {
              const id = atWorkIds.seat(object.key, seat.run, seat.form);
              return (
                <AtWorkSeatView
                  key={id}
                  seat={seat}
                  seedOf={seedOf}
                  ref={refOf?.(id)}
                  place={placeOf(id)}
                />
              );
            }),
        )}
        {shape.objects.flatMap((object) =>
          object.chips.flatMap((at) => {
            const chip = chipOf(object.key, at.run, at.word);
            if (chip === null) return [];
            const id = atWorkIds.chip(object.key, at.run);
            return [
              <AtWorkChipView
                key={id}
                chip={chip}
                seedOf={seedOf}
                theme={theme}
                ref={refOf?.(id)}
                place={placeOf(id)}
              />,
            ];
          }),
        )}
      </div>
      <AtWorkNamesView names={names} />
    </>
  );
}
