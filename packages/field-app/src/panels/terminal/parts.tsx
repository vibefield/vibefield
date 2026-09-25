import { createContext, type ReactElement, type ReactNode, useContext } from "react";
import { borderCls, labelCls } from "../settings-ui";
import { chordGlyphs } from "./keyboard-model";

// The page's small vocabulary (GT-7). The scope and timing tags are FACT
// labels — DESIGN.md §8's plugin-source-badge recipe (a hairline chip, no fill,
// no hue): who owns a setting and when it lands are facts, never warnings.

export type Scope = "window" | "mac" | "fact";

const SCOPES: Record<Scope, { text: string; title: string }> = {
  window: {
    text: "This window",
    title: "Stored with this window. Other windows, and your phone, keep their own.",
  },
  mac: {
    text: "This Mac",
    title: "Saved to config.ghostty. Every terminal on this Mac reads it.",
  },
  fact: { text: "Read-only", title: "A fact about this Mac, shown so nothing is guessed." },
};

export function ScopeTag({ scope }: { scope: Scope }): ReactElement {
  const entry = SCOPES[scope];
  return (
    <span className="vf-ts-tag" data-kind="scope" title={entry.title}>
      {entry.text}
    </span>
  );
}

export type When = "live" | "new-terminals" | "after-save" | "next-ghosttea" | "kept";

const WHENS: Record<When, string> = {
  live: "Live",
  "new-terminals": "New terminals",
  "after-save": "After save",
  "next-ghosttea": "Next ghosttea",
  kept: "Kept, not drawn",
};

export function WhenTag({ when }: { when: When }): ReactElement {
  return (
    <span className="vf-ts-tag" data-kind="when" data-when={when}>
      {WHENS[when]}
    </span>
  );
}

/** The anchor a search just took the page to — flashed once where it lands. */
export const HighlightContext = createContext<string | null>(null);

/** `data-highlighted` for an anchor the search just revealed. */
export function useHighlight(anchor: string): { "data-highlighted"?: "" } {
  return useContext(HighlightContext) === anchor ? { "data-highlighted": "" } : {};
}

/** A section tile headed by a title, its tags and one line (the settings
 * surface's own 18px tile, from settings-ui). */
export function PageSection({
  id,
  title,
  scope,
  when,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  scope?: Scope;
  when?: When;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const highlighted = useHighlight(id);
  return (
    <section
      className={`vf-ts-section ${borderCls}`}
      data-ts-anchor={id}
      aria-labelledby={`${id}-title`}
      {...highlighted}
    >
      <div className="vf-ts-section-head">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="vf-ts-section-title">
            {title}
            {scope !== undefined && <ScopeTag scope={scope} />}
            {when !== undefined && <WhenTag when={when} />}
          </h3>
          {description !== undefined && (
            <p className={`vf-ts-section-line ${labelCls}`}>{description}</p>
          )}
        </div>
        {action !== undefined && <div className="vf-ts-section-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A chord as keycaps (⌘ ⇧ K), with its words for a screen reader. */
export function Keycaps({ trigger, label }: { trigger: string; label?: string }): ReactElement {
  const glyphs = chordGlyphs(trigger);
  return (
    <span className="vf-ts-keycaps" title={trigger}>
      <span className="sr-only">{label ?? trigger}</span>
      <span className="vf-ts-keycaps-caps" aria-hidden="true">
        {glyphs.map((glyph, index) => (
          <kbd key={`${glyph}:${index}`}>{glyph}</kbd>
        ))}
      </span>
    </span>
  );
}

/** A slider with its value beside it, as the settings surface draws one. */
export function RangeControl({
  id,
  label,
  min,
  max,
  step = 1,
  value,
  format,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <span className="vf-ts-range">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <output htmlFor={id}>{format(value)}</output>
    </span>
  );
}

/** A fact where a control would be: the value, in the page's mono. */
export function Fact({ children }: { children: ReactNode }): ReactElement {
  return <span className="vf-ts-fact">{children}</span>;
}
