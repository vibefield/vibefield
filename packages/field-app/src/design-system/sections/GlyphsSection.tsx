import { FieldGlyph, GLYPH_META, GLYPH_NAMES, GLYPHS } from "@vibefield/design-kit/glyphs";
import { UiIconButton } from "@vibefield/design-kit/primitives";
import type { ReactElement } from "react";
import { Section, Specimen } from "../catalog-ui";
import "../styles/glyphs.css";

// DESIGN.md §13 — the chrome's glyph set, mounted from the kit's own leaf: the
// catalog draws the shipping component at the sizes the product uses, on both
// grounds, and never a copy of a drawing.

const GROUPS = [
  ["actions", "Actions", "verbs: what a control does"],
  ["navigation", "Navigation", "one drawing, turned"],
  ["objects", "Places and objects", "nouns: where you are, what you hold"],
  ["signals", "Signals", "the swarm's marks on the phone"],
  ["studio", "Studio only", "the catalog's own tiles"],
] as const;

export function GlyphsSection(): ReactElement {
  const hardware = GLYPH_NAMES.filter((name) => GLYPHS[name].kind === "hardware");
  return (
    <Section
      id="glyphs"
      index="02d"
      eyebrow="The chrome's alphabet"
      title="One drawing per meaning, in one box."
      description={`${GLYPH_NAMES.length} glyphs in a 24-unit box, painted in currentColor and nothing else. ${GLYPH_NAMES.length - hardware.length} are one 2-unit stroke (Instrument); ${hardware.length} verbs are solid silhouettes (Hardware). The phone draws the same geometry from template assets.`}
    >
      <Specimen title="At the product's sizes" source="@vibefield/design-kit/glyphs · FieldGlyph">
        <div className="vf-ds-glyph-sizes">
          {[12, 16, 18, 20, 28].map((size) => (
            <div key={size} className="vf-ds-glyph-size">
              <span>{size}px</span>
              <FieldGlyph name="clipboard" size={size} />
              <FieldGlyph name="search" size={size} />
              <FieldGlyph name="agents" size={size} />
              <FieldGlyph name="backspace" size={size} />
            </div>
          ))}
          <div className="vf-ds-glyph-size">
            <span>in a button</span>
            <UiIconButton title="Godview">
              <FieldGlyph name="panes" size={20} />
            </UiIconButton>
            <UiIconButton title="Artifacts" active>
              <FieldGlyph name="sidepanel" size={20} />
            </UiIconButton>
          </div>
        </div>
      </Specimen>
      {GROUPS.map(([group, label, sub]) => (
        <Specimen key={group} title={label} source={sub}>
          <div className="vf-ds-glyph-grid">
            {GLYPH_NAMES.filter((name) => GLYPH_META[name].group === group).map((name) => (
              <figure key={name} className="vf-ds-glyph" title={GLYPH_META[name].role}>
                <span className="vf-ds-glyph-light">
                  <FieldGlyph name={name} size={24} />
                </span>
                <span className="vf-ds-glyph-dark">
                  <FieldGlyph name={name} size={24} />
                </span>
                <figcaption>
                  <strong>{GLYPH_META[name].label}</strong>
                  <code>{name}</code>
                  <small>{GLYPHS[name].kind}</small>
                </figcaption>
              </figure>
            ))}
          </div>
        </Specimen>
      ))}
      <Specimen title="Turned and flipped" source="turn · flip">
        <div className="vf-ds-glyph-turns">
          <FieldGlyph name="chevron" size={20} label="right" />
          <FieldGlyph name="chevron" size={20} turn={90} label="down" />
          <FieldGlyph name="chevron" size={20} turn={180} label="left" />
          <FieldGlyph name="chevron" size={20} turn={270} label="up" />
          <FieldGlyph name="undo" size={20} label="undo" />
          <FieldGlyph name="undo" size={20} flip label="redo" />
        </div>
      </Specimen>
    </Section>
  );
}
