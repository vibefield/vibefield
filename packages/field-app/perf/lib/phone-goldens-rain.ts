import type { PhoneViewGolden, PhoneViewInput } from "./phone-goldens";

/**
 * PG-8 — THE RAIN VIEW'S GOLDEN (red: a skeleton). Registered and not yet written; the compute lands in the green.
 */

const NOTE = "PG-8 — the phone's rain view golden (skeleton).";

export async function rainSteps(_input: PhoneViewInput): Promise<unknown[]> {
  return [];
}

export const golden: PhoneViewGolden = { note: NOTE, compute: rainSteps };
