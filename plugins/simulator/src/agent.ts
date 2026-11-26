// THE PHONE'S AGENT HALF (item 581 overturned 2026-11-24): what an agent reads of an iOS Simulator on the desk. It binds no
// tool: an agent can place one and read which iPhone and which iOS it is, and cannot tap, type or take its picture (no tool
// exists for those yet). Its summary is read from its props alone, as the SDK's read API holds them: the device's state
// lives in the window's live face, which an agent's read does not reach, and a UDID never leaves main.

import type { AgentHalf, AgentReadApi } from "@vibefield/plugin-sdk/desk";
import { bindingOf } from "./binding";
import { deviceName } from "./face";
import { modelPropOf } from "./kind";
import { modelOf } from "./law";
import { iosLabel } from "./setup";

/** Whose device a phone shows: none yet (unbound), a device of its own (setup's, item 568), or one of the user's (a binding
 * written before setup made each phone its own). */
export type SimulatorDevice = "none" | "its own" | "the user's";

/** What `object_open` shows of a phone now: small and bounded (its names are a catalog's, at most 128 characters each). */
export interface SimulatorSummary {
  /** the iPhone it is: its bound device type's name, else its model's */
  readonly model: string;
  /** the iOS version it is set to ("iOS 26.1"); absent while it is unbound */
  readonly ios?: string;
  readonly bound: boolean;
  readonly device: SimulatorDevice;
}

/** The longest a summary's name is, characters: the props' own bound (ids.ts `MODEL_ID_MAX`). */
const NAME_MAX = 128;

export function simulatorSummary(api: AgentReadApi): SimulatorSummary {
  const props = api.props();
  const model = modelOf(modelPropOf(props));
  const binding = bindingOf(props);
  if (binding === undefined) return { model: model.name, bound: false, device: "none" };
  return {
    model: deviceName(binding, model).slice(0, NAME_MAX),
    ios: iosLabel(binding.runtime).slice(0, NAME_MAX),
    bound: true,
    device: binding.dedicated === true ? "its own" : "the user's",
  };
}

/** What an agent can do with a phone (OB-2): read what it is. No faces of its own to answer (its Live face is the object). */
export const simulatorAgent: AgentHalf = { summary: simulatorSummary };
