import { type ReactElement, useState } from "react";
import { type SoundSettingsModel, SoundSettingsView } from "../panels/sound/SoundSettings";
import { type SoundFixtureState, soundSettingsFixture } from "./sound-settings-fixtures";

/** SD-2 — the shipping Settings → Sound page over a fixture model (docs/UI_SYSTEM.md: a fixture adapter, never a copy
 * of its markup). The switch and Quiet act on the fixture so the page can be walked; Play plays nothing here. */
export function SoundSettingsPreview({ state }: { state: SoundFixtureState }): ReactElement {
  const [model, setModel] = useState<SoundSettingsModel>(() => soundSettingsFixture(state));
  return (
    <SoundSettingsView
      model={model}
      onSounds={(on) => setModel((m) => ({ ...m, on }))}
      onPlay={() => undefined}
      onQuiet={(quiet) =>
        setModel((m) => {
          const { quietUntilText: _was, ...rest } = m;
          return quiet === null
            ? rest
            : { ...rest, quietUntilText: quiet === "hour" ? "4:12 PM" : "8:00 AM" };
        })
      }
    />
  );
}
