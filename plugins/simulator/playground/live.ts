// The faces the phone's stills show (PT-S1 — the playground's `--still` lends ICE's `stillLive` over this under `LIVE`): a
// bound phone's face is the plugin's FIXTURE (src/fixture.ts — the synthetic screen, arithmetic alone, no Apple artwork),
// laid out for the bound device's own screen at the first halving of its framebuffer (what a phone at rest asks for), in the
// desk's scheme, its clock pinned; and its WORDS — the face's honest state (`LiveInfo.extra.simulator`, the SDK's
// `LiveSimulatorFace`) — the fixture's Mac's for that device (fixture-mac.ts). A state that shows no still (no Simulator, no
// permission, no device) is answered with one dark texel the kind never shows: a still's source must hand bytes to say words.
// A still's act runs nothing. Its logical size: the screen's points, as a Simulator's frames say theirs.
//
// Authoring-time only, as states.ts is: this directory never enters a `.vfplugin`.
import { liveSimulatorSpec } from "@vibefield/plugin-sdk/desk";
import { FACE_SHOWS } from "../src/face";
import { feedScreenOf, fixtureFrame } from "../src/fixture";
import { phoneById, shapeOf } from "../src/law";
import { FIXTURE_TIME, fixtureDevice, stagedWords } from "./fixture-mac";

export default (_key: string, spec: Readonly<Record<string, unknown>>) => {
  const device = liveSimulatorSpec(spec);
  const model = device === undefined ? undefined : phoneById(device.deviceType);
  const staged = device === undefined ? undefined : fixtureDevice(device.deviceType);
  if (device === undefined || model === undefined || staged === undefined) return undefined;
  const info = { extra: { simulator: stagedWords(staged.is) } };
  if (FACE_SHOWS[staged.is] === "none")
    return { width: 1, height: 1, bytes: new Uint8Array([0, 0, 0, 255]), info };
  const screen = feedScreenOf(shapeOf(model));
  const width = Math.round(model.screen.px[0] / 2);
  const height = Math.round(model.screen.px[1] / 2);
  return {
    width,
    height,
    bytes: fixtureFrame(screen, [width, height], device.scheme, FIXTURE_TIME),
    logical: screen.pt,
    info,
  };
};
