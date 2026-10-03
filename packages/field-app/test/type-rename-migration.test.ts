import { describe, expect, it } from "vitest";
import { buildGhostWidgetTypes } from "../src/plugin-host/ghost-stubs";

// C2 renames (2026-07-23; ice 0.4.0 design-008 — petition I5 consumed): the host's
// TYPE_RENAMES history projects into `renamedFrom` declarations (build-widget), and
// the ENGINE folds pre-rename ids in-band. On the desk (DK-4; DK-D13/D14 — "drop
// them, a clean migration") every board that could carry a pre-C2 id is a board from
// before the desk, refused at open and never imported (field/desk/pre-desk.ts), so
// the hand-built pre-rename board this file opened — and its two open rows — went
// with the `vibefield.*` fixtures. What still runs on this build is the history's
// projection into the ghost-stub filter, pinned here until the map retires with
// the `vibefield.*` types.

const OLD_NOTE = "note.card";

describe("type renames — the ghost-stub filter keeps the C2 history", () => {
  it("never ghost-stubs an old id whose successor is registered; truly absent ids still stub", () => {
    const registered = new Set(["vibefield.note"]);
    // A pre-rename envelope names note.card until it self-heals — the rename
    // runner owns it; a stub would collide with vibefield.note's renamedFrom.
    expect(buildGhostWidgetTypes({ [OLD_NOTE]: 1 }, registered)).toHaveLength(0);
    const stubs = buildGhostWidgetTypes({ "acme.vanished.widget": 1 }, registered);
    expect(stubs).toHaveLength(1);
  });
});
