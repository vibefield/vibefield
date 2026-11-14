import { z } from "zod";

/** OB-D1 A — every card face and every chip in a message is exactly one of these. */
export const CHIP_TYPES = ["text", "image", "file", "link", "session", "ref"] as const;
export type ChipType = (typeof CHIP_TYPES)[number];
export const ChipType = z.enum(CHIP_TYPES);

/** OB-L1 — a desk object's address on this desktop. Knowing it grants nothing: only the person's play does. */
export const OBJECT_REF_PATTERN = /^vf:obj\/[a-z0-9]{8}$/;
export const ObjectRef = z
  .string()
  .regex(OBJECT_REF_PATTERN, "must look like vf:obj/ and eight lowercase letters or digits");
export type ObjectRef = z.infer<typeof ObjectRef>;
