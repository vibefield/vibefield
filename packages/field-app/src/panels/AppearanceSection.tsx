import type { ThemePreference } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import type { ReactElement } from "react";
import { setAppTheme, THEME_LABELS, themeChoice, themeLabel, useAppTheme } from "../theme";
import { SettingsRow, SettingsSection } from "./settings-ui";

/** Settings → Appearance, controller-free: the choice it shows and where a
 * choice goes. The catalog mounts it on fixture state. */
export function AppearanceSectionView({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange?: (preference: ThemePreference) => void;
}): ReactElement {
  return (
    <SettingsSection
      title="Theme"
      description="The same setting as Theme in your menu, in the corner."
    >
      <SettingsRow
        title="Appearance"
        description="Light, Dark, or Auto — which follows this computer's appearance as it changes. App chrome, cards, the canvas and Godview all follow it."
        divider={false}
      >
        <SegmentedControl
          options={THEME_LABELS}
          value={themeLabel(preference)}
          onChange={(label) => onChange?.(themeChoice(label))}
          label="Appearance"
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** Settings → Appearance (One Frame FC-D5): the SAME setting as the Me menu's
 * Theme — one owner, main's; three states, Auto following this computer's
 * appearance. It reads and asks the one store the Me menu does, so the two can
 * never show two answers. */
export function AppearanceSection(): ReactElement {
  const theme = useAppTheme();
  return <AppearanceSectionView preference={theme.preference} onChange={setAppTheme} />;
}
