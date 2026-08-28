import type { ReactElement } from "react";
import { BrandMark, Icon } from "../catalog-ui";
import { StudioToolbar, studioWorkbenchCopy } from "../StudioToolbar";
import type { DesignSystemStudioController, DesignSystemStudioState } from "../studio-controller";

export function OverviewSection({
  studio,
  state,
}: {
  studio?: DesignSystemStudioController | undefined;
  state: DesignSystemStudioState;
}): ReactElement {
  return (
    <header id="overview" className="vf-ds-hero vf-ds-anchor">
      <div className="vf-ds-mobile-brand">
        <BrandMark />
        <span>VibeField interface index</span>
      </div>
      <div className="vf-ds-hero-copy">
        <p className="vf-ds-kicker">
          {studio === undefined
            ? "Design system · live renderer inventory"
            : "VibeField Studio · Design System"}
        </p>
        <h1>The field, in one frame.</h1>
        <p>
          {studio === undefined
            ? "The current VibeField visual language, gathered from the production renderer. Use this page to compare primitives, interaction states, field chrome, and the control room without booting a daemon or opening a document."
            : "Inspect the production renderer inventory and tune one complete appearance snapshot against the running app. Live preview is explicit, temporary, and never changes product settings."}
        </p>
      </div>
      <div className="vf-ds-hero-actions">
        {studio === undefined ? (
          <div className="vf-ds-live-pill">
            <span />
            Catalog-only browser mode
          </div>
        ) : (
          <StudioToolbar controller={studio} state={state} />
        )}
      </div>
      <div className="vf-ds-hero-facts">
        <HeroFact value="3" label="surface families" />
        <HeroFact value="8" label="accent slots" />
        <HeroFact value="22" label="card radius" suffix="px" />
        <HeroFact value="1" label="shared inventory" />
      </div>
      <div className="vf-ds-callout">
        <Icon name="sparkles" />
        <div>
          <strong>{studio === undefined ? "What is live here" : "Studio preview boundary"}</strong>
          <span>
            {studio === undefined
              ? "Tokens, primitives, and controller-free production views are mounted directly. Fixture adapters replace runtime data only; engine-rendered cards use deterministic state fixtures."
              : studioWorkbenchCopy(state)}
          </span>
        </div>
      </div>
    </header>
  );
}

function HeroFact({ value, label, suffix }: { value: string; label: string; suffix?: string }) {
  return (
    <div>
      <strong>
        {value}
        {suffix !== undefined && <small>{suffix}</small>}
      </strong>
      <span>{label}</span>
    </div>
  );
}
