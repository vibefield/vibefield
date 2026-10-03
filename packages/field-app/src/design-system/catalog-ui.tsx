// Shared catalog harness chrome: the section frame, the specimen card, the
// brand mark, and the catalog's own icon set. Harness-only UI — production
// components never import from here.
import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import type { ReactElement, ReactNode } from "react";

export type IconName =
  | "arrow-left"
  | "canvas"
  | "chevron"
  | "close"
  | "command"
  | "document"
  | "folder"
  | "layers"
  | "plus"
  | "settings"
  | "sparkles";

export function BrandMark(): ReactElement {
  return (
    <span className="vf-ds-brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Section({
  id,
  index,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="vf-ds-section vf-ds-anchor">
      <header className="vf-ds-section-head">
        <span>{index}</span>
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="vf-ds-section-body">{children}</div>
    </section>
  );
}

export function Specimen({
  title,
  source,
  children,
  bleed = false,
  darkStage = false,
}: {
  title: string;
  source: string;
  children: ReactNode;
  bleed?: boolean;
  darkStage?: boolean;
}): ReactElement {
  return (
    <article
      className={`vf-ds-specimen ${bleed ? "is-bleed" : ""} ${darkStage ? "is-dark-stage" : ""}`}
    >
      <header>
        <span>{title}</span>
        <code>{source}</code>
      </header>
      <div className="vf-ds-specimen-body">{children}</div>
    </article>
  );
}

const CATALOG_GLYPH: Record<IconName, { name: GlyphName; turn?: 180 }> = {
  "arrow-left": { name: "chevron", turn: 180 },
  canvas: { name: "canvas" },
  chevron: { name: "chevron" },
  close: { name: "close" },
  command: { name: "terminal" },
  document: { name: "document" },
  folder: { name: "folder" },
  layers: { name: "layers" },
  plus: { name: "plus" },
  settings: { name: "gear" },
  sparkles: { name: "sparkle" },
};

/** The catalog's own tiles draw the shipping glyph set (DESIGN.md §13). */
export function Icon({ name }: { name: IconName }): ReactElement {
  const glyph = CATALOG_GLYPH[name];
  return <FieldGlyph name={glyph.name} turn={glyph.turn ?? 0} size={20} />;
}
