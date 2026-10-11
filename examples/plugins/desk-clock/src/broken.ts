// THE FAULT FIXTURE (ICE petition I24; ported at DK-7 from ICE's `examples/desk-clock/src/broken.ts`) — the
// desk clock broken ON PURPOSE, the ways a plugin's kind breaks: its WGSL does not compile (the desk refuses
// the kind at create, boots without it and draws its objects as the MISSING face, `status().faults` naming
// it), its `record` throws from a given call on (three strikes and the desk quarantines it), its `hit` throws
// (each pick a strike, and the pick misses it) — and (PT-5a) its `record` throws once it has been IN HAND a while: a kind
// that goes missing while its object is held, which the host must put down (ICE M24 LT3). Each broken kind has its own type — and, the host's rule, a
// registry name that IS that type — so it stands beside the clock on one desk; it is the clock in every
// other respect, through the SDK's `/desk` door alone.
//
// Two harnesses hold it: the SDK's kind-conformance harness, whose NEGATIVE fixture it is (test/broken.test.ts —
// the faulty clock refused by the states it breaks, the broken WGSL passing the READ and named as the gap no
// compiler closes here), and the host with ICE's own creation (field-app's desk-clock-faults.test.ts — the
// broken kind refused at create, its entry the missing face's, the clock beside it standing). Never in the
// clock's manifest: a first board never carries a fault. A host registers them by declaring
// `BROKEN_CLOCK_ROWS` beside the clock's row and reading these exports by name.

import type { ObjectContribution } from "@vibefield/contracts";
import type {
  ComposeOptions,
  MatPass,
  ObjectBinding,
  ObjectKind,
  ShaderText,
} from "@vibefield/plugin-sdk/desk";
import { CLOCK_TYPE } from "./ids";
import { type ClockKindOptions, clockKind } from "./kind";
import { CLOCK, CLOCK_STYLES } from "./law";
import type { ClockGeometry, ClockInstance } from "./layout";
import { ClockPass } from "./pass";
import { clockShaders } from "./shaders";
import type { ClockLook } from "./theme";

/** The identifier the broken WGSL uses and nothing declares — what a compiler refuses it by. */
export const BROKEN_WGSL_TOKEN = "desk_clock_broken_on_purpose";

/** How a clock breaks. */
export interface ClockBreak {
  /** Its kind's name — on VibeField, its object's TYPE (the host refuses any other). */
  readonly name: string;
  /** Its WGSL does not compile: a module of its own names `BROKEN_WGSL_TOKEN` — the engine's `compile` throws, its create rejects. */
  readonly wgsl?: boolean;
  /** Its `record` throws from this call on, 1-based (3: the third record it is asked for, and every one after). Absent: never. */
  readonly recordFrom?: number;
  /** Its `hit` throws, every pick. */
  readonly hit?: boolean;
  /**
   * PT-5a — its `record` throws once its object has been IN HAND this long (ms; the clock of `brokenClockKind`'s `now`): a
   * kind that breaks while held. It KEEPS the clock's opening — it is picked up to break.
   */
  readonly heldAfterMs?: number;
}

/** The clock's program with one more module that names what nothing declares: a compiler refuses the whole of it. */
export function brokenClockShaders(text?: ShaderText): ComposeOptions {
  const s = clockShaders(text);
  return {
    ...s,
    modules: [
      ...(s.modules ?? []),
      {
        label: "desk-clock/broken.wgsl",
        text: `fn desk_clock_broken() -> f32 { return ${BROKEN_WGSL_TOKEN}; }\n`,
      },
    ],
  };
}

/** A clock kind broken as `how` says — the clock's own kind in every other respect (it never opens: a fixture is looked at, not
 * set — but for one that breaks IN HAND, which is picked up to break). */
export function brokenClockKind(
  how: ClockBreak,
  opts: ClockKindOptions = {},
  now: () => number = () => performance.now(),
): ObjectKind<ClockGeometry, ClockInstance, ClockLook> {
  const base = clockKind(opts);
  let records = 0;
  /** When its object was first recorded in hand (one object: a fixture). */
  let heldAt: number | undefined;
  const { open, ...rest } = base;
  return {
    ...rest,
    ...(how.heldAfterMs === undefined || open === undefined ? {} : { open }),
    name: how.name,
    ...(how.wgsl === true
      ? {
          create: async (device: GPUDevice, format: GPUTextureFormat, mat: MatPass) =>
            ClockPass.create(device, format, brokenClockShaders(opts.text), mat),
        }
      : {}),
    record(G, ctx) {
      records += 1;
      if (how.recordFrom !== undefined && records >= how.recordFrom)
        throw new Error(`${how.name}: its record throws on purpose (call ${records})`);
      if (how.heldAfterMs !== undefined) {
        if (ctx.held === undefined) heldAt = undefined;
        else {
          heldAt ??= now();
          if (now() - heldAt >= how.heldAfterMs)
            throw new Error(`${how.name}: its record throws on purpose (in hand)`);
        }
      }
      return base.record(G, ctx);
    },
    hit:
      how.hit === true
        ? () => {
            throw new Error(`${how.name}: its hit throws on purpose`);
          }
        : base.hit,
  };
}

/** The type of a clock whose WGSL does not compile. */
export const BROKEN_CLOCK_TYPE = `${CLOCK_TYPE}.broken`;
/** …and of one whose `record` throws from its third call and whose `hit` throws. */
export const FAULTY_CLOCK_TYPE = `${CLOCK_TYPE}.faulty`;

/** A clock the desk REFUSES at create (its WGSL does not compile): drawn as missing from the first frame, said once at the boot. */
export const clockBroken: ObjectBinding<ClockGeometry, ClockInstance, ClockLook> = {
  kind: brokenClockKind({ name: BROKEN_CLOCK_TYPE, wgsl: true }),
};

/** A clock the desk QUARANTINES: its record throws from its third call, its hit on every pick — three strikes, then missing, said once. */
export const clockFaulty: ObjectBinding<ClockGeometry, ClockInstance, ClockLook> = {
  kind: brokenClockKind({ name: FAULTY_CLOCK_TYPE, recordFrom: 3, hit: true }),
};

/** PT-5a — the type of a clock that breaks IN HAND: its record throws once it has been held `FRAGILE_HELD_MS`. */
export const FRAGILE_CLOCK_TYPE = `${CLOCK_TYPE}.fragile`;
/** How long the fragile clock is held before it breaks (ms): long enough to be SEEN in hand, short of its pick-up's end. */
export const FRAGILE_HELD_MS = 400;

/** A clock the desk strikes out WHILE IT IS HELD (PT-5a; ICE M24 LT3): picked up, its record throws 0.4 s on — three strikes,
 * its kind missing — and the host puts it down: on the desk again, wearing the missing face, never held forever. */
export const clockFragile: ObjectBinding<ClockGeometry, ClockInstance, ClockLook> = {
  kind: brokenClockKind({ name: FRAGILE_CLOCK_TYPE, heldAfterMs: FRAGILE_HELD_MS }),
};

const TITLES: Readonly<Record<string, string>> = {
  [BROKEN_CLOCK_TYPE]: "Broken clock",
  [FAULTY_CLOCK_TYPE]: "Faulty clock",
  [FRAGILE_CLOCK_TYPE]: "Fragile clock",
};

/** The durable half each broken clock shares with the clock: its props, its size, how it is moved. */
const clockLike = (type: string, binding: string): ObjectContribution => ({
  type,
  title: TITLES[type] ?? "Broken clock",
  description:
    "The desk clock broken on purpose — a fault fixture (petition I24), never on a first board",
  schemaVersion: 1,
  size: { w: CLOCK.size, h: CLOCK.size },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  provides: [type, "desk.object", "desk.containable"],
  props: {
    style: { kind: "enum", options: [...CLOCK_STYLES], default: "classic" },
    ring24: { kind: "boolean", default: false },
    seconds: { kind: "boolean", default: true },
    zone: { kind: "string", default: "local" },
  },
  groups: {},
  binding: { kind: binding },
});

/** The manifest rows a host's plugin declares to register the two beside the clock — each the clock's
 * durable half under its own type, naming its export here; never on the tray. */
export const BROKEN_CLOCK_ROWS: readonly ObjectContribution[] = [
  clockLike(BROKEN_CLOCK_TYPE, "clockBroken"),
  clockLike(FAULTY_CLOCK_TYPE, "clockFaulty"),
];

/** PT-5a — the row of the clock that breaks in hand: declared beside the two by a host that witnesses the put-down. */
export const FRAGILE_CLOCK_ROW: ObjectContribution = clockLike(FRAGILE_CLOCK_TYPE, "clockFragile");
