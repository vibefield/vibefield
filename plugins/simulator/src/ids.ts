// The phone's IDS — durable: its type and its props live in boards. Pure (no import), so the manifest's emit (plain Node,
// before any bundle exists), the kind, the playground's states and the units read the same strings: a new kind is never
// a repeated string literal.

/** The phone's durable type id — its plugin's id itself (an object may take the bare id: `isOwnedName`). */
export const SIMULATOR_TYPE = "vibefield.simulator";

/**
 * The phone's KIND name — its key in the desk's registry, in every slot's objects and in `handle.local(…)`. The host's
 * rule (DK-6 input (b)): a kind's registry name IS its type, one id and no second namespace.
 */
export const SIMULATOR_KIND = SIMULATOR_TYPE;

/** The renderer module's named export the manifest row's `binding.kind` names (object.ts). */
export const SIMULATOR_BINDING_EXPORT = "simulator";

/** The phone's category on the pegboard — a new chip, the devices' (the PT-S1 brief). */
export const SIMULATOR_CATEGORY = "devices";

/**
 * The phone's PROPS, by name — declared once: the manifest's keys, the kind's reads, the fixtures' keys.
 *  - `model` — the CoreSimulator device type the phone IS (its shape, its size, its band): the catalog's id
 *    (`com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro`). A free string, never an enum: Xcode's set of device types
 *    grows and drops, and a manifest's enum may only grow (an id this build's catalog lacks draws as the default).
 *  - `finish` — the phone's launch colour (theme.ts `SIMULATOR_FINISHES`): one of its model's own, else its model's first.
 *  - `binding` — the device it is BOUND to: a CoreSimulator device type and runtime (contracts'
 *    `LiveSurfaceIosSimulatorBindingV1`), never a UDID; both empty — unbound (no face is opened).
 */
export const PROP = { model: "model", finish: "finish", binding: "binding" } as const;

/** The props as the kind reads them (`binding` arrives as its cell's JSON in the product, parsed in a fixture — binding.ts). A
 * type, not an interface: a fixture's props are handed on as a plain record (`Readonly<Record<string, unknown>>`). */
export type SimulatorProps = {
  readonly model: string;
  readonly finish: string;
  readonly binding: { readonly deviceType: string; readonly runtime: string };
};

/** What a phone is when nothing says otherwise: the newest Pro (PHONE.md's `DEFAULT_PHONE`). */
export const DEFAULT_MODEL = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";

/** A phone bound to nothing: the binding prop's default (ICE derives the same empty object from its shape). */
export const UNBOUND = { deviceType: "", runtime: "" } as const;

/** The longest a `model` or a `finish` may be, characters. */
export const MODEL_ID_MAX = 128;
export const FINISH_ID_MAX = 64;
