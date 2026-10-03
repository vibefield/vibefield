import { DEFAULT_LOGO, LivingLogo, logoSvg } from "@vibefield/design-kit/logo";
import { UiButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { Section } from "../catalog-ui";
import "../styles/logo-section.css";

export function LogoSection(): ReactElement {
  const [live, setLive] = useState(false);
  return (
    <Section
      id="living-mark"
      index="02c"
      eyebrow="Identity in motion"
      title="One loop. Infinite possibility."
      description="The existing infinity and RGB identity, reimagined as a continuous spectral ribbon in a living field of light. Shape, atmosphere, palette, and motion are independently tunable."
    >
      <div className="vf-ds-logo-preview">
        {live ? (
          <LivingLogo />
        ) : (
          <img
            alt="VibeField living infinity ribbon"
            src={`data:image/svg+xml,${encodeURIComponent(logoSvg(DEFAULT_LOGO))}`}
          />
        )}
      </div>
      <div className="vf-ds-logo-actions">
        <div>
          <strong>Living mark / Prism</strong>
          <p>
            {Object.keys(DEFAULT_LOGO).length} parameters · 5 starting points · PNG, SVG & preset
            exports
          </p>
        </div>
        <UiButton onClick={() => setLive(!live)}>
          {live ? "Stop preview" : "Animate preview"}
        </UiButton>
        <a className="vf-ui-button" href="./logo-studio.html" target="_blank" rel="noreferrer">
          Open logo studio ↗
        </a>
      </div>
    </Section>
  );
}
