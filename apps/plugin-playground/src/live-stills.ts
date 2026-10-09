// THE FACES A STILL SHOWS (PT-2; ICE design-019 §9, `stillLive`): a plugin whose kind opens LIVE FACES — a portal: a browser
// pane, later a captured window — authors what its stills show on them, `<plugin>/playground/live.ts`, default-exporting
// `(key, spec) => LiveStill | undefined`: the RGBA8 rows (row-major, no header), their size and the face's words, for the
// spec the kind opens a face with (the HOST's contract — a page's address, viewport and scheme). `--still` lends ICE's
// `stillLive` over it under `LIVE`, so the kind is drawn through its own live path — the face's texture, its sampling, its
// mips — from bytes the plugin owns, never a third party's pixels and never a producer. Absent: no `LIVE` lent, and a live
// kind draws its film. Authoring-time only, as `states.ts` is: never in a `.vfplugin`.

import type { LiveStill } from "@vibecook/ice/desk/kit";
import { type Refusal, refusal } from "./verdict";

export const LIVE_RELATIVE_PATH = "playground/live.ts";

/** What a plugin's `playground/live.ts` default-exports: the still a face shows, by its key and the spec it was opened with. */
export type LiveStills = (
  key: string,
  spec: Readonly<Record<string, unknown>>,
) => LiveStill | undefined;

export type LiveStillsRead =
  | { readonly ok: true; readonly live: LiveStills }
  | ({ readonly ok: false } & Refusal);

/** Read the loaded module's default export as the faces' stills. */
export function readLiveModule(mod: Record<string, unknown>): LiveStillsRead {
  const declared = mod.default;
  if (typeof declared !== "function")
    return {
      ok: false,
      ...refusal(
        "live-invalid",
        `${LIVE_RELATIVE_PATH} default-exports ${declared === undefined ? "nothing" : `a ${typeof declared}`}`,
        { expected: "export default (key, spec) => ({ width, height, bytes, info? }) | undefined" },
      ),
    };
  return { ok: true, live: declared as LiveStills };
}
