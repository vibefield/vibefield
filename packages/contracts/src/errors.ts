import { z } from "zod";

// Error taxonomy (design-01 §4). `UNAVAILABLE` carries {service, state, progress?}
// in details — it drives the honest "rebuilding / adopting" UX.

export const ErrorKind = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN_SCOPE",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "UNAVAILABLE",
  "TIMEOUT",
  "INCOMPATIBLE",
  "INTERNAL",
]);
export type ErrorKind = z.infer<typeof ErrorKind>;

export const UnavailableDetails = z
  .object({
    service: z.string(),
    state: z.string(),
    progress: z.number().min(0).max(1).optional(),
    /** federation (D35): which device was unreachable, when a forwarded call fails */
    device: z.string().optional(),
  })
  .passthrough();
export type UnavailableDetails = z.infer<typeof UnavailableDetails>;

export const ErrorData = z
  .object({
    kind: ErrorKind,
    retryable: z.boolean(),
    details: z.unknown().optional(),
  })
  .passthrough();
export type ErrorData = z.infer<typeof ErrorData>;

/** JSON-RPC error codes: -32000..-32099 is the server-defined range. */
export const RPC_ERROR_CODES: Record<ErrorKind, number> = {
  INTERNAL: -32000,
  UNAUTHORIZED: -32001,
  FORBIDDEN_SCOPE: -32002,
  NOT_FOUND: -32003,
  CONFLICT: -32004,
  PRECONDITION_FAILED: -32005,
  UNAVAILABLE: -32006,
  TIMEOUT: -32007,
  INCOMPATIBLE: -32008,
};
