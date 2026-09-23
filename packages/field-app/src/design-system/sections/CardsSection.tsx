import { WEATHER_GRADIENT } from "@vibefield/plugin-widgetlab/design-system";
import { type ReactElement, useState } from "react";
import { Section, Specimen } from "../catalog-ui";

export function CardsSection(): ReactElement {
  const [state, setState] = useState("Resting");
  return (
    <Section
      id="cards"
      index="07"
      eyebrow="Living cards"
      title="Content has the color. Chrome has the physics."
      description="Committed widget surfaces survive both app themes. The shared rounded shell supplies ambient depth, lift, selection, and overlap feedback."
    >
      <Specimen title="Content surfaces" source="design-kit/CardShell.tsx">
        <div className="vf-ds-widget-card-grid">
          <WidgetCard kind="weather" />
          <WidgetCard kind="terminal" />
          <WidgetCard kind="note" />
          <WidgetCard kind="market" />
        </div>
      </Specimen>

      <div className="vf-ds-grid vf-ds-grid-asymmetric">
        <Specimen title="Interaction projection" source="CardShell.tsx">
          <div className="vf-ds-card-state-controls">
            {["Resting", "Selected", "Lifted", "Accept", "Reject"].map((option) => (
              <button
                key={option}
                type="button"
                className={option === state ? "is-active" : ""}
                onClick={() => setState(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="vf-ds-living-card-stage">
            <div className="vf-ds-living-card" data-state={state.toLowerCase()}>
              <div className="vf-ds-card-content">
                <span>SESSION · CLAUDE</span>
                <strong>Refining the canvas</strong>
                <small>working · 18s</small>
              </div>
              <div className="vf-ds-card-glow" />
              <div className="vf-ds-card-rim" />
              <div className="vf-ds-card-ring" />
            </div>
          </div>
        </Specimen>
        <Specimen title="Card anatomy" source="DESIGN.md §7–8">
          <ol className="vf-ds-anatomy-list">
            <li>
              <span>01</span>
              <div>
                <strong>Rounded clip</strong>
                <small>22px silhouette on every widget.</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Content surface</strong>
                <small>Owns gradients, illustration, and committed color.</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Hot-point glow + rim</strong>
                <small>Strong for accept, restrained for reject.</small>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Selection ring</strong>
                <small>1.5px blue, reserved for interaction.</small>
              </div>
            </li>
            <li>
              <span>05</span>
              <div>
                <strong>Lift plane</strong>
                <small>Scale 1.05, opacity .75, deeper ambient shadow.</small>
              </div>
            </li>
          </ol>
        </Specimen>
      </div>
    </Section>
  );
}

/** Catalog content: a committed widget surface, also the field the switch
 * specimen defocuses. */
export function WidgetCard({ kind }: { kind: "weather" | "terminal" | "note" | "market" }) {
  if (kind === "weather") {
    return (
      <article className="vf-ds-widget-card is-weather" style={{ background: WEATHER_GRADIENT }}>
        <header>
          <span>SAN FRANCISCO</span>
          <small>NOW</small>
        </header>
        <div>
          <strong>64°</strong>
          <span>Clear</span>
        </div>
        <footer>
          <span>H: 68°</span>
          <span>L: 52°</span>
        </footer>
      </article>
    );
  }
  if (kind === "terminal") {
    return (
      <article className="vf-ds-widget-card is-terminal">
        <header>
          <span>TERMINAL</span>
          <small>LIVE</small>
        </header>
        <code>
          <b>~/vibe-field</b>
          {"\n"}
          <span>$</span> pnpm dev{"\n"}
          <em>renderer ready · 5173</em>
          {"\n"}
          <span>$</span> _
        </code>
      </article>
    );
  }
  if (kind === "note") {
    return (
      <article className="vf-ds-widget-card is-note">
        <header>
          <span>NOTE</span>
          <small>12:42</small>
        </header>
        <p>Polish the space between the controls. Consistency lives in the quiet parts.</p>
        <footer>Launch notes</footer>
      </article>
    );
  }
  return (
    <article className="vf-ds-widget-card is-market">
      <header>
        <span>AAPL</span>
        <small>NASDAQ</small>
      </header>
      <div>
        <strong>$218.31</strong>
        <span className="vf-ds-change-badge is-positive">+1.8%</span>
      </div>
      <svg viewBox="0 0 220 54" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 43 C20 36 26 40 44 27 S74 32 88 21 S113 25 130 13 S160 25 178 10 S201 15 220 3" />
      </svg>
    </article>
  );
}
