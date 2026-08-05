import type { ReactElement } from "react";

// The accent choice, shared by the Account page and the Setup Assistant
// (UA-3/UA-3w). Both show the same eight swatches and the same live chip, so
// the thing you pick in the wizard is visibly the thing Settings later shows.

/** The eight §2.6 accent slots by NAME (DESIGN.md: slot names, never hex — the
 * value belongs to the token, so a palette revision moves one file). */
export const ACCENT_SLOTS = [
  "accent-1",
  "accent-2",
  "accent-3",
  "accent-4",
  "accent-5",
  "accent-6",
  "accent-7",
  "accent-8",
] as const;

export type AccentSlot = (typeof ACCENT_SLOTS)[number];

/** Real radios, not buttons wearing the role: arrow-key traversal and the group
 * semantics come free, and the swatch is the label's own face. */
export function AccentPicker({
  value,
  disabled = false,
  onSelect,
  name = "vf-account-accent",
  className = "flex flex-wrap justify-end gap-1.5",
}: {
  value: string | null;
  disabled?: boolean;
  onSelect: (slot: AccentSlot) => void;
  /** Distinct per surface — two radio groups sharing a name fight each other. */
  name?: string;
  className?: string;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label="Accent color" className={className}>
      {ACCENT_SLOTS.map((slot) => {
        const selected = value === slot;
        return (
          <label
            key={slot}
            className={`inline-flex rounded-full transition-transform focus-within:ring-2 focus-within:ring-[var(--vf-select)] motion-reduce:transition-none ${
              disabled ? "opacity-40" : "cursor-pointer hover:scale-105 active:scale-95"
            }`}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              aria-label={slot}
              checked={selected}
              disabled={disabled}
              onChange={() => onSelect(slot)}
            />
            <span
              aria-hidden="true"
              className="block h-7 w-7 rounded-full"
              style={{
                background: `var(--vf-${slot})`,
                // §7: the sole-selection ring, 1.5px in --vf-select.
                ...(selected
                  ? { outline: "1.5px solid var(--vf-select)", outlineOffset: "2px" }
                  : {}),
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

/** The live chip — the §2.6 tint recipe (12% body, 35% hairline, label at
 * full), so the choice is shown doing its actual job rather than as a bare
 * swatch. */
export function AccentChip({
  accent,
  label,
  className = "",
}: {
  accent: string | null;
  label: string;
  className?: string;
}): ReactElement {
  const text = label.trim().length > 0 ? label.trim() : "your field";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium text-black/75 dark:text-white/75 ${className}`}
      style={{
        background:
          accent === null
            ? "transparent"
            : `color-mix(in srgb, var(--vf-${accent}) 12%, transparent)`,
        borderColor:
          accent === null
            ? "color-mix(in srgb, currentColor 15%, transparent)"
            : `color-mix(in srgb, var(--vf-${accent}) 35%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background:
            accent === null
              ? "color-mix(in srgb, currentColor 30%, transparent)"
              : `var(--vf-${accent})`,
        }}
      />
      {text}
    </span>
  );
}
