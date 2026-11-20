import { type DeskLightValues, deskLightValues } from "@vibefield/contracts";
import { type ReactElement, useState } from "react";
import { deskShadeCss } from "../field/desk/desk-light";
import { LightSettingsView } from "../panels/canvas/LightSettings";
import { PLANT_SILHOUETTES } from "../panels/canvas/plant-silhouettes";
import { type LightFixtureState, lightSettingsFixture } from "./light-settings-fixtures";

/** Item 583 — the shipping Settings → Canvas Light section over a fixture (docs/UI_SYSTEM.md: a fixture adapter,
 * never a copy of its markup). Every row acts on the fixture, so the section can be walked; nothing is written and no
 * desk follows. */
export function LightSettingsPreview({ state }: { state: LightFixtureState }): ReactElement {
  const fixture = lightSettingsFixture(state);
  const [values, setValues] = useState<DeskLightValues>(fixture.values);
  return (
    <LightSettingsView
      model={{
        values,
        theme: fixture.theme,
        shade: deskShadeCss(values, fixture.theme),
        silhouettes: PLANT_SILHOUETTES,
        reducedMotion: fixture.reducedMotion,
        writable: fixture.writable,
      }}
      onPlant={(plant) => setValues((was) => ({ ...was, plant }))}
      onMirror={(mirror) => setValues((was) => ({ ...was, mirror }))}
      onSlide={(row, value) => setValues((was) => ({ ...was, [row]: value }))}
      onLetGo={() => undefined}
      onReset={() => setValues(deskLightValues(undefined))}
    />
  );
}
