import { resolveTheme, type ThemePreference } from "@vibefield/contracts";
import { type ReactElement, useEffect, useState } from "react";
import { type MeMenuUpdate, MeMenuView } from "../account/MeMenu";
import { ComposerLineView } from "../frame/ComposerLine";
import { ViewsTrackView } from "../frame/ViewsTrack";
import { meUpdateRow, notAppliedNotice, readyClause, updateWaits } from "../panels/update-words";
import { FIXTURE_ME, FIXTURE_OTHERS, FIXTURE_OTHERS_WAITING } from "./account-fixtures";
import {
  UPDATES_FIXTURE_NOW,
  type UpdateCornerFixture,
  type UpdateCornerState,
  type UpdateFaceState,
  updateCornerFixture,
} from "./updates-settings-fixtures";

// AU-2 — the corner's update in the catalog (docs/UI_SYSTEM.md's fixture-adapter rule): the shipping Me menu,
// `MeMenuView`, its row built by the shipping `meUpdateRow` over main's projection as the fixtures write it, and the
// face's dot by the shipping `updateWaits`. What stands in for the controller is only what it holds: the row's flow
// inside one open, main's question, a refusal's line — never the menu's markup, never the host's doors.

/** The update as the controller hands it to the menu, from a fixture. */
function menuUpdateOf(fixture: UpdateCornerFixture, asking: boolean): MeMenuUpdate {
  const view = fixture.view;
  const markTitle = readyClause(view);
  return {
    row: meUpdateRow({ view, local: fixture.local, now: UPDATES_FIXTURE_NOW }),
    mark: updateWaits(view) && fixture.local.kind !== "restarting",
    ...(markTitle !== null ? { markTitle } : {}),
    notice: notAppliedNotice(view),
    ask: asking && fixture.ask !== undefined ? fixture.ask : null,
  };
}

/** The face alone, folded: at rest, an install waiting (the dot pops in as the plate mounts — once, never a
 * pulse), and a waiting count holding the one slot (I-5). */
export function UpdateFacePlate({ state }: { state: UpdateFaceState }): ReactElement {
  // the dot arrives after the first frame, so the plate shows the pop the corner plays
  const [arrived, setArrived] = useState(false);
  useEffect(() => setArrived(true), []);
  const fixture = updateCornerFixture(state === "rest" || !arrived ? "current" : "ready");
  return (
    <div className="vf-ds-update-face" data-face={state}>
      <MeMenuView
        me={FIXTURE_ME}
        others={state === "waiting" ? FIXTURE_OTHERS_WAITING.slice(0, 1) : FIXTURE_OTHERS}
        open={false}
        onOpenChange={() => undefined}
        onOpenSettings={() => undefined}
        onOpenAccount={() => undefined}
        onLink={() => undefined}
        update={menuUpdateOf(fixture, false)}
      />
    </div>
  );
}

/** The menu open above the line over one row state: the row nearest the face, its question at 320 when it asks
 * (Cancel goes back to the rows; the row asks again), and a refusal at the top. */
export function UpdateMenuPlate({
  state,
  dark,
}: {
  state: UpdateCornerState;
  /** The page's theme — the OS's, as far as Auto can tell. */
  dark: boolean;
}): ReactElement {
  const fixture = updateCornerFixture(state);
  const [open, setOpen] = useState(true);
  const [asking, setAsking] = useState(fixture.ask !== undefined);
  const [chosen, setChosen] = useState<ThemePreference>("auto");
  return (
    <div className="vf-ds-corner-plate" data-update={state}>
      <ComposerLineView
        view="canvas"
        keys="mac"
        track={<ViewsTrackView view="canvas" keys="mac" />}
      />
      <div className="vf-ds-corner-face">
        <MeMenuView
          me={FIXTURE_ME}
          others={FIXTURE_OTHERS}
          open={open}
          onOpenChange={setOpen}
          onOpenSettings={() => undefined}
          onOpenAccount={() => undefined}
          onLink={() => undefined}
          onSwitch={() => undefined}
          onNewUser={() => undefined}
          theme={{ preference: chosen, resolved: resolveTheme(chosen, dark) }}
          onThemeChange={setChosen}
          notice={fixture.refusal ?? null}
          update={menuUpdateOf(fixture, asking)}
          onUpdate={(act) => {
            if (act === "ask" && fixture.ask !== undefined) setAsking(true);
          }}
          onUpdateConfirm={() => undefined}
          onUpdateCancel={() => setAsking(false)}
        />
      </div>
    </div>
  );
}
