import type { LiveSimulatorBinding, SimulatorRuntimeOption } from "@vibefield/plugin-sdk/desk";
import { bindingOf } from "./binding";
import { PROP } from "./ids";

export const iosLabel = (runtime: string): string =>
  runtime.replace("com.apple.CoreSimulator.SimRuntime.iOS-", "iOS ").replaceAll("-", ".");

/** Only pairs reported by Xcode can reach the document. */
export function simulatorChoice(
  options: readonly SimulatorRuntimeOption[],
  runtime: string,
  deviceType: string,
): LiveSimulatorBinding | undefined {
  return options
    .find((row) => row.runtime === runtime)
    ?.models.some((model) => model.deviceType === deviceType)
    ? { deviceType, runtime }
    : undefined;
}

export function configurationPatch(
  props: Readonly<Record<string, unknown>>,
  choice: LiveSimulatorBinding,
) {
  const prior = bindingOf(props);
  if (
    prior?.dedicated &&
    prior.deviceType === choice.deviceType &&
    prior.runtime === choice.runtime &&
    props[PROP.model] === choice.deviceType
  )
    return undefined;
  return {
    model: choice.deviceType,
    binding: { deviceType: choice.deviceType, runtime: choice.runtime, dedicated: true },
  };
}
