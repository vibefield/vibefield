// Playground states (plugin spec §24.2 "every state render fixture") — object type → state name → the props that state draws.
// The SDK's kind-conformance harness (`pnpm playground plugins/simulator`, and test/kind.test.ts) validates each state's props
// against the manifest's declared schema FIRST, then drives the kind through it in every mode it declares (idle, selected,
// held, open — it opens: ICE's pick-up) at every zoom the desk's LOD names. `--still` draws each one on Dawn by day and by
// night (the faces by playground/live.ts — the plugin's fixture), held to test/still.golden.json once the first gated run
// blesses it (never by hand).
//
// Authoring-time only: this directory never enters a `.vfplugin`, the same way `scripts/` and `test/` do not.
import { SIMULATOR_TYPE, type SimulatorProps } from "../src/ids";
import { FIXTURE_MAC } from "./fixture-mac";

/** A phone of the device's own type, bound to it — the face the fixture's Mac answers for it. */
const bound = (deviceType: string, runtime: string): Partial<SimulatorProps> => ({
  model: deviceType,
  binding: { deviceType, runtime },
});

const faces: Record<string, Partial<SimulatorProps>> = Object.fromEntries(
  FIXTURE_MAC.map((d) => [d.is, bound(d.deviceType, d.runtime)]),
);

const states: Record<string, Record<string, Partial<SimulatorProps>>> = {
  [SIMULATOR_TYPE]: {
    // a new phone: the 17 Pro in its first finish, bound to nothing — its screen off
    default: {},
    // the same in its silver: another finish of its model
    silver: { finish: "silver-17p" },
    // a home-button phone, unbound: its white front, its LCD off, its steel-less aluminium band
    "iphone-8": { model: "com.apple.CoreSimulator.SimDeviceType.iPhone-8", finish: "silver-8" },
    // the nine honest faces, each on the device the fixture's Mac answers it for
    ...faces,
  },
};

export default states;
