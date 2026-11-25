// THE PANE'S ACTS (track OM, OM-1, 2026-11-25; DESIGN.md §9 "The browser pane's acts", §8 "An act that is a
// choice"): DEVICE, a choice (ICE I62) — the presets of devices.ts, each with its size; Turn, for a phone or a tablet;
// and Custom, which asks for a width, a height and a user agent — and MUTE, which says Unmute, its speaker struck
// through, once every selected pane is muted (ICE I61). The same two stand on the selection bar and in the tools in
// hand. Each write lands a pane's Size, about its centre, and its props in ONE transaction: one undo step. This module
// owns the canvas components; page navigation stays in its own URL cell.
//
// The settings form these replace (`device-menu.ts`, retired with OM-1) also set a pixel ratio, an input and a user
// agent apart from the device. A pane saved with one keeps it (`deviceForProps` still reads them) until a device is
// chosen, which clears them.

import { getWidgetType, Position, Size, type WidgetType } from "@vibefield/plugin-sdk/canvas";
import type {
  ActChoice,
  ActChoiceTaken,
  Entity,
  HeldToolApi,
  HeldToolDef,
  MenuActionDef,
  World,
} from "@vibefield/plugin-sdk/desk";
import {
  CUSTOM_DEVICE,
  DEVICES,
  type Device,
  deviceById,
  deviceForProps,
  deviceOf,
  hundredth,
  MIN_VIEWPORT,
  sizeOf,
  viewportOf,
} from "./devices";
import { BROWSER_PANE_TYPE } from "./ids";

/** The cut a device switch lands: a viewport (the device's own, unless one is given) at the device's density, about
 * the old centre — a pane's Position and Size. */
export function switchedRect(
  at: { readonly x: number; readonly y: number },
  size: { readonly w: number; readonly h: number },
  device: Device,
  viewport: readonly [number, number] = [device.width, device.height],
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const cut = sizeOf(viewport, device);
  const next = { w: hundredth(cut.w), h: hundredth(cut.h) };
  const cx = at.x + size.w / 2;
  const cy = at.y + size.h / 2;
  return { x: cx - next.w / 2, y: cy - next.h / 2, w: next.w, h: next.h };
}

/** The pane type's props CELL — the component its props live in (the catalog's group `props`); undefined before the type is defined. */
export const propsCell = (): WidgetType["groups"][number]["component"] | undefined =>
  getWidgetType(BROWSER_PANE_TYPE)?.groups.find((g) => g.name === "props")?.component;

/** The cell the pane's `url` lives in — the catalog's group that holds it (its own: an undo of the desk's edits to the other
 * props never re-asserts an old address — the manifest's `groups`); undefined before the type is defined. */
export const urlCell = (): WidgetType["groups"][number]["component"] | undefined => {
  const type = getWidgetType(BROWSER_PANE_TYPE);
  const group = type?.propToGroup.url;
  return group === undefined ? undefined : type?.groups.find((g) => g.name === group)?.component;
};

/** What the acts write through — the world they read and the transaction they write in (a menu act's api, a tool's). */
export type PaneWriteApi = Pick<HeldToolApi, "world" | "transact">;

export const DEVICE_GLYPH = {
  path: "M3 5 H16 V15 H3 Z M6 19 H12 M9 15 V19 M17 9 H21 V20 H14 V9 Z",
};
export const SOUND_ON = {
  path: "M3 9 H7 L12 5 V19 L7 15 H3 Z M16 8 C19 10 19 14 16 16 M18 5 C23 8 23 16 18 19",
};
export const SOUND_OFF = { path: "M3 9 H7 L12 5 V19 L7 15 H3 Z M16 9 L22 15 M22 9 L16 15" };

/** Custom's bounds (DESIGN.md §9): a viewport 320 to 8192 by 240 to 8192 CSS px, an agent of at most 512 characters —
 * what the host's bounded device reader takes. */
export const CUSTOM_LIMITS = {
  width: [MIN_VIEWPORT[0], 8192],
  height: [MIN_VIEWPORT[1], 8192],
  agent: 512,
} as const;

/** The props a device choice writes beside its id: the form's overrides cleared, so the device's own stand. */
const DEVICE_OWN = {
  deviceScaleFactor: 0,
  inputMode: "device",
  userAgentMode: "device",
  userAgent: "",
  navigatorPlatform: "",
} as const;

/** A header cannot carry these; the host's device reader refuses them. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: user-agent headers cannot carry control characters
const CONTROL = /[\u0000-\u001f\u007f]/u;

/** A pane as the device choice reads it: the device it is on, the viewport it shows, the agent it was given. */
export interface PaneOn {
  readonly device: Device;
  readonly viewport: readonly [number, number];
  /** The agent typed for it under Custom (`userAgentMode: "custom"`), else "". */
  readonly agent: string;
}

/** A pane's device, viewport and typed agent, from its props and its Size. */
export function paneOn(world: World, e: Entity, props: Readonly<Record<string, unknown>>): PaneOn {
  const device = deviceForProps(props);
  const size = world.get(e, Size);
  const viewport: readonly [number, number] =
    size === undefined ? [device.width, device.height] : viewportOf(size, device);
  const agent =
    props.userAgentMode === "custom" && typeof props.userAgent === "string" ? props.userAgent : "";
  return { device, viewport, agent };
}

/** A device that turns: one whose own screen stands taller than wide (the iPad, the iPhone). */
const turns = (device: Device): boolean => device.width < device.height;

/**
 * THE DEVICE CHOICES NOW (ICE I62): the presets in the list's order, each with its size, the current one marked when
 * every pane is on it; Turn to landscape (or to portrait, once turned) when every pane is on the same phone or tablet;
 * and Custom last, its fields holding the first pane's viewport and agent. Undefined with no pane.
 */
export function deviceChoices(panes: readonly PaneOn[]): ActChoice[] | undefined {
  const first = panes[0];
  if (first === undefined) return undefined;
  const on = panes.every((p) => p.device.id === first.device.id) ? first.device.id : undefined;
  const choices: ActChoice[] = DEVICES.map((d) => ({
    id: d.id,
    label: d.name,
    hint: `${d.width} × ${d.height}`,
    group: "devices",
    ...(on === d.id ? { current: true } : {}),
  }));
  if (on !== undefined && turns(first.device)) {
    const landscape = first.viewport[0] > first.viewport[1];
    choices.push({
      id: landscape ? "portrait" : "landscape",
      label: landscape ? "Turn to portrait" : "Turn to landscape",
      group: "turn",
    });
  }
  const custom = on === CUSTOM_DEVICE.id;
  choices.push({
    id: CUSTOM_DEVICE.id,
    label: CUSTOM_DEVICE.name,
    hint: custom ? `${first.viewport[0]} × ${first.viewport[1]}` : "your size and agent",
    group: "custom",
    ...(custom ? { current: true } : {}),
    fields: [
      {
        id: "width",
        label: "Width",
        kind: "number",
        value: first.viewport[0],
        min: CUSTOM_LIMITS.width[0],
        max: CUSTOM_LIMITS.width[1],
        step: 1,
      },
      {
        id: "height",
        label: "Height",
        kind: "number",
        value: first.viewport[1],
        min: CUSTOM_LIMITS.height[0],
        max: CUSTOM_LIMITS.height[1],
        step: 1,
      },
      {
        id: "agent",
        label: "User agent",
        kind: "text",
        value: first.agent.slice(0, CUSTOM_LIMITS.agent),
        maxLength: CUSTOM_LIMITS.agent,
        placeholder: "The browser's own",
      },
    ],
  });
  return choices;
}

/** What a choice cuts one pane to: the device it is on after, the viewport, and the props written beside them. */
interface PaneCut {
  readonly device: Device;
  readonly viewport: readonly [number, number];
  readonly props: Readonly<Record<string, unknown>>;
}

/** Each pane's cut and props, written in ONE transaction. False when nothing could be written. */
function cutPanes(
  api: PaneWriteApi,
  entities: readonly Entity[],
  each: (props: Readonly<Record<string, unknown>>) => PaneCut | undefined,
): boolean {
  const cell = propsCell();
  if (cell === undefined || entities.length === 0) return false;
  return api.transact((tx) => {
    for (const e of entities) {
      const at = api.world.get(e, Position);
      const size = api.world.get(e, Size);
      if (at === undefined || size === undefined) continue;
      const props = (api.world.get(e, cell) ?? {}) as Readonly<Record<string, unknown>>;
      const next = each(props);
      if (next === undefined) continue;
      const r = switchedRect(at, size, next.device, next.viewport);
      tx.edit(e)
        .set(Position, { x: r.x, y: r.y })
        .set(Size, { w: r.w, h: r.h })
        .set(cell, { ...props, ...next.props });
    }
  });
}

/**
 * A DEVICE CHOICE TAKEN (ICE I62 — held already to the choices now and their fields): a preset cuts each pane to it and
 * clears the form's overrides; Turn cuts each to its device's own size the other way round; Custom cuts each to the
 * typed size at a laptop's density, with the typed agent or none. False when nothing was written — a choice this pane
 * does not offer, an agent a header cannot carry, or a read-only document.
 */
export function chooseDevice(
  api: PaneWriteApi,
  entities: readonly Entity[],
  taken: ActChoiceTaken | undefined,
): boolean {
  // the act is a choice: the bar lists its choices, and nothing is written until one is taken
  if (taken === undefined) return false;
  if (taken.id === "landscape" || taken.id === "portrait") {
    const wide = taken.id === "landscape";
    return cutPanes(api, entities, (props) => {
      const device = deviceForProps(props);
      if (!turns(deviceOf(props.device))) return undefined;
      const long = Math.max(device.width, device.height);
      const short = Math.min(device.width, device.height);
      return { device, viewport: wide ? [long, short] : [short, long], props: {} };
    });
  }
  if (taken.id === CUSTOM_DEVICE.id) {
    const width = taken.values?.width;
    const height = taken.values?.height;
    const typed = taken.values?.agent;
    if (typeof width !== "number" || typeof height !== "number" || typeof typed !== "string")
      return false;
    const agent = typed.trim();
    if (CONTROL.test(agent) || agent.length > CUSTOM_LIMITS.agent) return false;
    return cutPanes(api, entities, () => ({
      device: CUSTOM_DEVICE,
      viewport: [width, height],
      props: {
        ...DEVICE_OWN,
        device: CUSTOM_DEVICE.id,
        ...(agent === "" ? {} : { userAgentMode: "custom", userAgent: agent }),
      },
    }));
  }
  const device = deviceById(taken.id);
  if (device === undefined || device.id === CUSTOM_DEVICE.id) return false;
  return cutPanes(api, entities, () => ({
    device,
    viewport: [device.width, device.height],
    props: { ...DEVICE_OWN, device: device.id },
  }));
}

/** Mute: every pane muted while any can sound; once every one is muted, Unmute sounds them all. One undo step. */
export function togglePaneSound(api: PaneWriteApi, entities: readonly Entity[]): boolean {
  const cell = propsCell();
  if (cell === undefined || entities.length === 0) return false;
  const muted = !entities.every(
    (e) => (api.world.get(e, cell) as { muted?: boolean } | undefined)?.muted === true,
  );
  return api.transact((tx) => {
    for (const e of entities) tx.edit(e).set(cell, { ...(api.world.get(e, cell) ?? {}), muted });
  });
}

/** Unmute, its speaker struck through, once every pane is muted (ICE I61 — an action whose name changes, R10). */
const soundNow = (muted: readonly boolean[]) =>
  muted.length > 0 && muted.every((m) => m) ? { label: "Unmute", glyph: SOUND_OFF } : undefined;

/** THE SELECTION BAR'S ACTS (DESIGN.md §9 "The browser pane's acts"): Device, then Mute. */
export const PANE_ACTS: readonly MenuActionDef[] = [
  {
    id: "device",
    label: "Device",
    glyph: DEVICE_GLYPH,
    choices: (c) => deviceChoices(c.entities.map((e) => paneOn(c.world, e, c.props(e)))),
    run: (api, taken) => {
      chooseDevice(api, api.entities, taken);
    },
  },
  {
    id: "sound",
    label: "Mute",
    glyph: SOUND_ON,
    state: (c) => soundNow(c.entities.map((e) => c.props(e).muted === true)),
    run: (api) => {
      togglePaneSound(api, api.entities);
    },
  },
];

/** THE SAME TWO IN HAND (DESIGN.md §8 "Tools in hand"; ICE I49, I62): the held pane's device and its sound. */
export const PANE_HELD_ACTS: readonly HeldToolDef[] = [
  {
    id: "device",
    label: "Device",
    kind: "action",
    glyph: DEVICE_GLYPH,
    choices: (c) => deviceChoices([paneOn(c.world, c.entity, c.props())]),
    run: (api, taken) => {
      chooseDevice(api, [api.entity], taken);
    },
  },
  {
    id: "sound",
    label: "Mute",
    kind: "action",
    glyph: SOUND_ON,
    state: (c) => soundNow([c.props().muted === true]),
    run: (api) => {
      togglePaneSound(api, [api.entity]);
    },
  },
];
