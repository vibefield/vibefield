import { FACE_DECK } from "@vibefield/contracts/user-face";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import type { FieldUserFace } from "../host";
import { faceKey, isSingleEmoji, normalizeFaceEmoji } from "./faces";
import "./FacePicker.css";

// The face picker (UA-D17; DESIGN.md §2.8), shared by the Account page and the
// Setup Assistant's pane 2 — the same deck and the same frame switch — so what
// you pick during setup is visibly what Settings later shows. It draws no face
// of its own: both hosts already show the face it edits (pane 2 at 112px, the
// Account row at 48px), and that face IS the preview. Compact on purpose — four
// rows of deck, scrolling — so pane 2 stays close to one screen; on a short
// shell the wizard scrolls the rest (its content centres SAFELY, so the title
// is never cut off). Controlled: the Account page writes on every choice, the
// wizard only on Continue, and neither concern lives here.
//
// Boot-reachable (the wizard mounts it), so it takes the kit's LEAF entries
// and the policy's zod-free subpath, never a barrel (UI_SYSTEM.md).

const FRAMES = ["Sticker", "Coin"] as const;

export function FacePicker({
  value,
  held,
  onChange,
  disabled = false,
  name = "vf-face-picker",
}: {
  value: FieldUserFace;
  /** Faces other users on this machine wear (`faceKey` → their name). They
   * stay visible, greyed and named, rather than vanishing from the deck. */
  held: ReadonlyMap<string, string>;
  onChange: (face: FieldUserFace) => void;
  disabled?: boolean;
  /** Distinct per surface — two radio groups sharing a name fight each other. */
  name?: string;
}): ReactElement {
  const [typed, setTyped] = useState("");
  const [typedProblem, setTypedProblem] = useState<string | null>(null);
  const frame = value.frame ?? "sticker";
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
    if (!isSingleEmoji(candidate)) {
      setTypedProblem("A face is a single emoji.");
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

  return (
    <div className="vf-face-picker" data-disabled={disabled ? "" : undefined}>
      <SegmentedControl
        label="Frame"
        options={FRAMES}
        value={frame === "coin" ? "Coin" : "Sticker"}
        onChange={(next) => {
          if (disabled) return;
          onChange({ emoji: value.emoji, frame: next === "Coin" ? "coin" : "sticker" });
        }}
        className="vf-face-picker-frames"
      />

      <div className="vf-face-picker-choices">
        <div role="radiogroup" aria-label="Face" className="vf-face-picker-deck">
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
        {typedProblem !== null && (
          <p className="vf-face-picker-problem" role="alert">
            {typedProblem}
          </p>
        )}
      </div>
    </div>
  );
}
