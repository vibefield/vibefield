// The DESK CLOCK's code half — the `ObjectBinding` its manifest row names (`binding: { kind: "clock" }`).
// In ICE's example this is the `defineObject` call; on VibeField the HOST makes that call (spec §12.2:
// plugin code never owns a durable schema), compiling the manifest's durable half (manifest.ts — the
// props, the size, the tray entry, what it provides) with what this export carries: the kind, whole
// (kind.ts), and its act in the selection menu. Static, never registered from `activate`: the desk
// creates every kind's pass together at its mount, so the host reads this export by name.

import type {
  AgentHalf,
  AgentReadApi,
  MenuActionApi,
  ObjectBinding,
} from "@vibefield/plugin-sdk/desk";
import { SECONDS_GLYPH } from "./glyphs";
import { CLOCK_SECONDS_ACT } from "./ids";
import { clockKind, flagProp } from "./kind";
import type { ClockGeometry, ClockInstance } from "./layout";
import type { ClockLook } from "./theme";

export { CLOCK_SECONDS_ACT, CLOCK_TYPE } from "./ids";

const settings = (api: AgentReadApi) => {
  const { style, ring24, seconds, zone } = api.props();
  return { style, ring24, seconds, zone };
};

/** What an agent can do with a clock (OB-2): read its settings and flip its seconds hand, as the menu's act does. */
export const clockAgent: AgentHalf = {
  summary: settings,
  read: { read_settings: settings },
  act: {
    set_seconds: (api, input) => {
      const on = input["on"] === true;
      api.setProps({ seconds: on });
      return {
        value: { seconds: on },
        changed: on ? "Showed the seconds hand" : "Hid the seconds hand",
      };
    },
  },
};

// docs:begin binding
/**
 * THE BINDING — the clock's kind and its selection-menu act (K8a — a plugin's act, declared as a
 * built-in's: the selected clocks' seconds hand flips, the first's deciding so a mixed selection ends
 * alike, each clock one undo step — with its own glyph, a stopwatch).
 */
export const clock: ObjectBinding<ClockGeometry, ClockInstance, ClockLook> = {
  kind: clockKind(),
  menu: [
    {
      id: CLOCK_SECONDS_ACT,
      label: "Seconds hand",
      keys: "S",
      glyph: { path: SECONDS_GLYPH },
      run: (api: MenuActionApi) => {
        const first = api.entities[0];
        if (first === undefined) return;
        const next = !flagProp(api.props(first), "seconds", true);
        for (const e of api.entities) api.setProps(e, { seconds: next });
      },
    },
  ],
  agent: clockAgent,
};
// docs:end binding
