import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  type BloomField,
  type BloomPoint,
  CARD_BLOOM,
  pickAt,
  placeBuds,
  sayPx,
  wordsTop,
} from "./bloom-geometry";
import type { BloomModel, Bud, ChipType } from "./bloom-model";
import "./card-bloom.css";

/**
 * THE CARD'S BLOOM, DRAWN (OB-D2, OB-D3, OB-D12 A; DESIGN.md §8 "The hand"). Controller-free: it is told the landing
 * table's model, where the card stands and the window's size, and it answers one `choose`. A face or null for nothing.
 * While it is open it holds the keys and the pointer. The catalog mounts this same view, `still` so it hears neither.
 */

/** The glyph each type wears (§13, CS-D10 A). */
export const TYPE_GLYPH: Readonly<Record<ChipType, GlyphName>> = {
  text: "type-text",
  image: "type-image",
  file: "document",
  link: "link",
  session: "agents",
  ref: "type-ref",
};

export interface CardBloomViewProps {
  readonly model: BloomModel;
  readonly at: BloomPoint;
  readonly field: BloomField;
  readonly choose: (face: string | null) => void;
  /** The card's name, for the menu's accessible name. */
  readonly title?: string;
  /** How long the ring ignores the pointer after it opens. */
  readonly settleMs?: number;
  /** Going away: the buds go back along their spokes. */
  readonly closing?: boolean;
  /** A catalog plate: it stands in its box and listens to nothing. */
  readonly still?: boolean;
}

/** What the words say for what is pointed at. */
function saying(bud: Bud | undefined): { readonly verb: string; readonly noun: string } {
  if (bud === undefined) return { verb: "", noun: "Cancel" };
  return bud.lands ? { verb: bud.verb, noun: bud.noun } : { verb: "Not", noun: "here" };
}

/** A label's side of its bud, from the bud's direction. */
function sideOf(deg: number): "top" | "left" | "right" {
  const x = Math.cos((deg * Math.PI) / 180);
  if (x < -0.35) return "left";
  return x > 0.35 ? "right" : "top";
}

/** How far the words' centre stays from the window's sides. */
const WORDS_HALF = 296;
/** A label's anchor from its bud's centre. */
const LABEL_OFF = 34;

export function CardBloomView({
  model,
  at,
  field,
  choose,
  title,
  settleMs = CARD_BLOOM.settle,
  closing = false,
  still = false,
}: CardBloomViewProps): ReactElement {
  const ring = useMemo(
    () => placeBuds(model.buds.length, at, field),
    [model.buds.length, at, field],
  );
  const hub = model.buds.findIndex((bud) => bud.face === model.hub);
  const [pick, setPick] = useState<number | null>(hub >= 0 ? hub : null);
  const live = useRef({ pick, closing, choose, model, hub, ring, at, settleMs });
  live.current = { pick, closing, choose, model, hub, ring, at, settleMs };
  const openedAt = useRef(performance.now());

  useEffect(() => {
    if (still) return;
    const settled = (): boolean => performance.now() - openedAt.current >= live.current.settleMs;
    const take = (index: number | null): void => {
      const now = live.current;
      if (index === null) {
        now.choose(null);
        return;
      }
      const bud = now.model.buds[index];
      if (bud === undefined) return;
      setPick(index);
      if (bud.lands) now.choose(bud.face);
    };
    const onKey = (event: KeyboardEvent): void => {
      const now = live.current;
      if (now.closing) return;
      const count = now.model.buds.length;
      let handled = true;
      if (event.key === "Escape") now.choose(null);
      else if (event.key === "Enter") take(now.pick);
      else if (event.key === "ArrowRight") setPick(((now.pick ?? now.hub) + 1 + count) % count);
      else if (event.key === "ArrowLeft") setPick(((now.pick ?? now.hub) - 1 + count) % count);
      else if (/^[1-9]$/.test(event.key) && Number(event.key) <= count) take(Number(event.key) - 1);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const pointed = (event: MouseEvent): number | null => {
      const now = live.current;
      const hit = pickAt({ x: event.clientX, y: event.clientY }, now.at, now.ring);
      return hit === "hub" ? (now.hub >= 0 ? now.hub : null) : hit;
    };
    const onMove = (event: MouseEvent): void => {
      if (!live.current.closing && settled()) setPick(pointed(event));
    };
    // the click the drop's own release makes lands inside the settle, and takes nothing
    const onClick = (event: MouseEvent): void => {
      event.stopPropagation();
      event.preventDefault();
      if (!live.current.closing && settled()) take(pointed(event));
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [still]);

  const said = saying(pick === null ? undefined : model.buds[pick]);
  const say = sayPx(field);
  const left =
    field.width <= WORDS_HALF * 2
      ? field.width / 2
      : Math.max(WORDS_HALF, Math.min(field.width - WORDS_HALF, at.x));
  const middle = (model.buds.length - 1) / 2;
  return (
    <div
      className="vf-card-bloom"
      role="menu"
      aria-label={title === undefined ? "Choose how it lands" : `Choose how ${title} lands`}
      {...(closing ? { "data-closing": "" } : {})}
      {...(still ? { "data-still": "" } : {})}
    >
      <div className="vf-card-bloom-veil" aria-hidden="true" />
      <div className="vf-card-bloom-clear" aria-hidden="true" style={{ left: at.x, top: at.y }} />
      {model.buds.map((bud, i) => {
        const place = ring.buds[i];
        if (place === undefined) return null;
        const a = (place.deg * Math.PI) / 180;
        const motion = {
          "--dx": `${(at.x - place.x).toFixed(1)}px`,
          "--dy": `${(at.y - place.y).toFixed(1)}px`,
          "--k": Math.floor(Math.abs(i - middle)),
        } as CSSProperties;
        return (
          <div key={bud.face}>
            <div
              className="vf-card-bloom-spoke"
              aria-hidden="true"
              style={{
                left: at.x,
                top: at.y,
                width: CARD_BLOOM.ring - CARD_BLOOM.bud / 2,
                transform: `rotate(${place.deg}deg)`,
              }}
            />
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="vf-card-bloom-bud"
              data-face={bud.face}
              aria-label={bud.label}
              {...(pick === i ? { "data-on": "" } : {})}
              {...(bud.lands ? {} : { "data-faint": "", "aria-disabled": true })}
              style={{ left: place.x, top: place.y, ...motion }}
            >
              <FieldGlyph name={TYPE_GLYPH[bud.type]} size={22} />
            </button>
            <div
              className="vf-card-bloom-label"
              data-side={sideOf(place.deg)}
              {...(pick === i ? { "data-on": "" } : {})}
              style={{
                left: place.x + Math.cos(a) * LABEL_OFF,
                top: place.y + Math.sin(a) * LABEL_OFF,
                ...motion,
              }}
            >
              <b>{bud.label}</b>
              {bud.reason !== undefined && <span>{bud.reason}</span>}
            </div>
          </div>
        );
      })}
      <div
        className="vf-card-bloom-words"
        aria-live="polite"
        style={{ left, top: wordsTop(at, field, say + 24) }}
      >
        <div
          className="vf-card-bloom-say"
          key={`${said.verb} ${said.noun}`}
          style={{ fontSize: say }}
        >
          <span className="vf-card-bloom-verb">{said.verb}</span>
          {said.verb === "" ? "" : " "}
          <span className="vf-card-bloom-noun">{said.noun}</span>
        </div>
        <div className="vf-card-bloom-where">{model.where}</div>
      </div>
    </div>
  );
}
