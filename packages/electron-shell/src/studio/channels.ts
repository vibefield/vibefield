export {
  STUDIO_PRODUCT_PORT_CHANNEL,
  STUDIO_PUBLISHER_PORT_CHANNEL,
} from "@vibefield/contracts/registries";

export interface StudioPortEnvelope {
  readonly generation: number;
}

export function parseStudioPortGeneration(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const generation = (value as Record<string, unknown>)["generation"];
  return Number.isSafeInteger(generation) && (generation as number) > 0
    ? (generation as number)
    : null;
}
