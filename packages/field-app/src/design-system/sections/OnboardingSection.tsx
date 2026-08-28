import type { ReactElement } from "react";
import { Section, Specimen } from "../catalog-ui";
import { OnboardingPreview } from "../OnboardingPreview";

export function OnboardingSection({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}): ReactElement {
  return (
    <Section
      id="onboarding"
      index="09"
      eyebrow="Onboarding"
      title="The complete Setup Assistant"
      description="Every shipping pane, alternate entry, transitional face, and completion refusal is mounted from production code. Change a pane once and both onboarding and this catalog move together."
    >
      <Specimen
        title="Production flow and state inventory"
        source="boot/onboarding/onboarding-views.tsx"
        bleed
      >
        <OnboardingPreview dark={dark} onToggleTheme={onToggleTheme} />
      </Specimen>
    </Section>
  );
}
