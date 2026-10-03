import { resolveTheme, type ThemePreference } from "@vibefield/contracts";
import { type ReactElement, useState } from "react";
import { MeMenuView } from "../account/MeMenu";
import { ComposerLineView } from "../frame/ComposerLine";
import { ViewsTrackView } from "../frame/ViewsTrack";
import { AppearanceSectionView } from "../panels/AppearanceSection";
import { SettingsDialog } from "../panels/SettingsDialog";
import { FIXTURE_ME, FIXTURE_OTHERS, FIXTURE_OTHERS_WAITING } from "./account-fixtures";

// The corner's fixture ADAPTER (One Frame FR-4; docs/UI_SYSTEM.md): the
// shipping Me menu — `MeMenuView` — open ABOVE the line, over fixture account
// and theme state, one plate per state the page's edges-and-corner and menus
// plates draw; and Settings → Appearance — `AppearanceSectionView` — in the
// shipping Settings dialog, the same setting. What it replaces is only what a
// host supplies: the account and the theme's owner (main's). The page's own
// theme stands in for the OS, so Auto is shown following each.

/** The theme each plate's menu holds. */
export const CORNER_PICKS: readonly ThemePreference[] = ["light", "dark", "auto"];

/** Your face in the corner and its menu open above the line (the page's "Your
 * face" plates), holding `pick`. The plate is the window's bottom-left. */
export function CornerPlate({
  pick,
  dark,
}: {
  pick: ThemePreference;
  /** The page's theme — the OS's, as far as Auto can tell. */
  dark: boolean;
}): ReactElement {
  const [open, setOpen] = useState(true);
  const [chosen, setChosen] = useState<ThemePreference>(pick);
  return (
    <div className="vf-ds-corner-plate" data-pick={pick}>
      <ComposerLineView
        view="canvas"
        keys="mac"
        track={<ViewsTrackView view="canvas" keys="mac" />}
        blank
      />
      <div className="vf-ds-corner-face">
        <MeMenuView
          me={FIXTURE_ME}
          others={FIXTURE_OTHERS_WAITING.slice(0, 1)}
          open={open}
          onOpenChange={setOpen}
          onOpenSettings={() => undefined}
          onOpenAccount={() => undefined}
          onLink={() => undefined}
          onSwitch={() => undefined}
          onNewUser={() => undefined}
          theme={{ preference: chosen, resolved: resolveTheme(chosen, dark) }}
          onThemeChange={setChosen}
        />
      </div>
    </div>
  );
}

/** Settings → Appearance in the shipping dialog: the same three, the same
 * setting as the menu's Theme (FC-D5). */
export function AppearancePlate({ pick }: { pick: ThemePreference }): ReactElement {
  const [chosen, setChosen] = useState<ThemePreference>(pick);
  return (
    <div className="vf-ds-settings-stage" data-plate="appearance" data-pick={pick}>
      <SettingsDialog
        className="vf-ds-settings-dialog"
        activePage="appearance"
        onSelectPage={() => undefined}
        onClose={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        historyBusy={false}
        undoAvailable={false}
        redoAvailable={false}
        account={{ me: FIXTURE_ME, others: FIXTURE_OTHERS, onSwitch: () => undefined }}
      >
        <AppearanceSectionView preference={chosen} onChange={setChosen} />
      </SettingsDialog>
    </div>
  );
}
