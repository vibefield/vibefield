import { FACE_DECK } from "@vibefield/contracts/user-face";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import type { FieldUserFace } from "../host";
import { emojiProblem, faceKey, normalizeFaceEmoji } from "./faces";
import "./FacePicker.css";

// The face picker (UA-D17; DESIGN.md §2.8), shared by the Account page and the
// Setup Assistant's pane 2 — the same deck and the same frame switch — so what
// you pick during setup is visibly what Settings later shows. It draws no face
// of its own: both hosts already show the face it edits (pane 2 at 96px, the
// Account row at 48px), and that face IS the preview. Two parts, because the
// hosts lay them out differently: `FaceFrameSwitch` (Sticker / Coin) and
// `FaceDeck` (the deck, scrolling, and any emoji typed in). The Account page
// stacks both as `FacePicker`; pane 2 puts the switch under the face and the
// deck beside the name, three rows tall, so the whole pane fits its shell.
// Controlled: the Account page writes on every choice, the wizard only on
// Continue, and neither concern lives here.
//
// Boot-reachable (the wizard mounts it), so it takes the kit's LEAF entries
// and the policy's zod-free subpath, never a barrel (UI_SYSTEM.md).

const FRAMES = ["Sticker", "Coin"] as const;

/** Sticker / Coin for `value` — the face's own frame, in the words §2.8 uses. */
export function FaceFrameSwitch({
  value,
  onChange,
  disabled = false,
  size = "regular",
  className = "vf-face-picker-frames",
}: {
  value: FieldUserFace;
  onChange: (face: FieldUserFace) => void;
  disabled?: boolean;
  /** `small` where the switch sits inside a composition (pane 2). */
  size?: "regular" | "small";
  className?: string;
}): ReactElement {
  const frame = value.frame ?? "sticker";
  return (
    <SegmentedControl
      label="Frame"
      options={FRAMES}
      value={frame === "coin" ? "Coin" : "Sticker"}
      size={size}
      onChange={(next) => {
        if (disabled) return;
        onChange({ emoji: value.emoji, frame: next === "Coin" ? "coin" : "sticker" });
      }}
      className={className}
    />
  );
}

/** The deck — the 48 faces, the ones other users wear greyed and named — and
 * any single emoji typed in, judged in place in main's own words. */
export function FaceDeck({
  value,
  held,
  onChange,
  disabled = false,
  name = "vf-face-picker",
  rows = 4,
  label,
}: {
  value: FieldUserFace;
  /** Faces other users on this machine wear (`faceKey` → their name). They
   * stay visible, greyed and named, rather than vanishing from the deck. */
  held: ReadonlyMap<string, string>;
  onChange: (face: FieldUserFace) => void;
  disabled?: boolean;
  /** Distinct per surface — two radio groups sharing a name fight each other. */
  name?: string;
  /** How many rows show before the deck scrolls. */
  rows?: 3 | 4;
  /** Setup's pane 2 names the deck, and puts the typed face on that same row
   * so the pane fits its shell; the Account page leaves it unnamed and stacks
   * the typed face under the deck. */
  label?: string;
}): ReactElement {
  const [typed, setTyped] = useState("");
  const [typedProblem, setTypedProblem] = useState<string | null>(null);
  const valueKey = faceKey(value.emoji);
  // A face typed in earlier is not in the deck; it still leads the grid, so
  // the current choice is always a visible, selected cell.
  const deck: readonly string[] = FACE_DECK.some((emoji) => faceKey(emoji) === valueKey)
    ? FACE_DECK
    : [value.emoji, ...FACE_DECK];

  const choose = (emoji: string): void => {
    onChange(value.frame === undefined ? { emoji } : { emoji, frame: value.frame });
  };

  const commitTyped = (): void => {
    const candidate = normalizeFaceEmoji(typed);
    if (candidate.length === 0) {
      setTypedProblem(null);
      return;
    }
    // Main's own sentences (not one emoji; one that already means something
    // here), said in place — before pane 2 draws it as your face.
    const problem = emojiProblem(candidate);
    if (problem !== null) {
      setTypedProblem(problem);
      return;
    }
    const wornBy = held.get(faceKey(candidate));
    if (wornBy !== undefined) {
      setTypedProblem(`${wornBy} already wears ${candidate} on this machine.`);
      return;
    }
    setTypedProblem(null);
    setTyped("");
    choose(candidate);
  };

  const anyEmoji = (
    <label className="vf-face-picker-any">
      <span className="vf-face-picker-any-label">Or any emoji</span>
      <input
        type="text"
        className="vf-face-picker-any-input"
        aria-label="Any emoji"
        value={typed}
        disabled={disabled}
        placeholder="🐻‍❄️"
        maxLength={16}
        onChange={(event) => {
          setTyped(event.target.value);
          setTypedProblem(null);
        }}
        onBlur={commitTyped}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Inside the wizard's form, Enter means THIS field, not Continue.
            event.preventDefault();
            commitTyped();
          }
        }}
      />
    </label>
  );

  return (
    <div className="vf-face-picker-choices" data-disabled={disabled ? "" : undefined}>
      {label !== undefined && (
        <div className="vf-face-picker-head">
          {/* The radiogroup names itself ("Face") to assistive tech. */}
          <span className="vf-face-picker-label" aria-hidden="true">
            {label}
          </span>
          {anyEmoji}
        </div>
      )}
      <div role="radiogroup" aria-label="Face" className="vf-face-picker-deck" data-rows={rows}>
        {deck.map((emoji) => {
          const key = faceKey(emoji);
          const wornBy = held.get(key);
          const selected = key === valueKey;
          const unavailable = disabled || (wornBy !== undefined && !selected);
          return (
            <label
              key={emoji}
              className="vf-face-picker-cell"
              data-selected={selected ? "" : undefined}
              data-held={wornBy !== undefined && !selected ? "" : undefined}
              title={wornBy !== undefined && !selected ? `${wornBy} wears ${emoji}` : undefined}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={selected}
                disabled={unavailable}
                aria-label={
                  wornBy !== undefined && !selected ? `${emoji}, worn by ${wornBy}` : emoji
                }
                onChange={() => choose(emoji)}
              />
              <span aria-hidden="true">{emoji}</span>
            </label>
          );
        })}
      </div>

      {label === undefined && anyEmoji}
      {typedProblem !== null && (
        <p className="vf-face-picker-problem" role="alert">
          {typedProblem}
        </p>
      )}
    </div>
  );
}

/** Both parts, stacked — the Account page's picker (a four-row deck). */
export function FacePicker({
  value,
  held,
  onChange,
  disabled = false,
  name = "vf-face-picker",
}: {
  value: FieldUserFace;
  held: ReadonlyMap<string, string>;
  onChange: (face: FieldUserFace) => void;
  disabled?: boolean;
  name?: string;
}): ReactElement {
  return (
    <div className="vf-face-picker" data-disabled={disabled ? "" : undefined}>
      <FaceFrameSwitch value={value} onChange={onChange} disabled={disabled} />
      <FaceDeck value={value} held={held} onChange={onChange} disabled={disabled} name={name} />
    </div>
  );
}
