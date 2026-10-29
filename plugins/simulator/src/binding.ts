// THE BINDING — the device a phone is bound to (contracts' `LiveSurfaceIosSimulatorBindingV1`: a CoreSimulator device type and
// runtime, never a UDID), read off its `binding` prop. The contract is the ONE reader the plugin and PT-S2's resolver share.
// ICE keeps a json prop as ONE string cell — the product's props hand the kind that cell's JSON — while a fixture's props (the
// kind harness, a test) hand it the parsed object: both read alike. Both ids empty is the prop's default — unbound — and opens
// no face; anything the contract refuses is unbound too (a corrupt cell never reaches a host as a device).

import { LiveSurfaceIosSimulatorBindingV1 } from "@vibefield/contracts";
import { PROP } from "./ids";

/** A phone's binding as the contract holds it. */
export interface Binding {
  readonly deviceType: string;
  readonly runtime: string;
}

/** The phone's binding from its props, or undefined: unbound (the default), or a value the contract refuses. */
export function bindingOf(props: Readonly<Record<string, unknown>>): Binding | undefined {
  const raw = props[PROP.binding];
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  const read = LiveSurfaceIosSimulatorBindingV1.safeParse(value);
  return read.success
    ? { deviceType: read.data.deviceType, runtime: read.data.runtime }
    : undefined;
}
