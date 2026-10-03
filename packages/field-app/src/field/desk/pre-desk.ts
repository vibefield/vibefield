import { type CanvasTypeIdentity, DefaultCanvasType, decodeEnvelope } from "@vibecook/ice";

// BOARDS FROM BEFORE THE DESK (the orchestrator's ruling 7; DK-D13…D16 ruled 2 Oct — "drop them, a
// clean migration"): a board rooted at `ice.default` is REFUSED at open — never opened, never
// converted. A desk build that opened one would bind it to the untyped canvas next to the desk's own
// and ghost-stub the desk's data prefabs (r2 R4, risk 1); there is no road from it to `desk.desk`
// (the root identity is write-once). Read from the ENVELOPE, before anything is imported: schema 3
// made the root a durable identity, and every legacy document binds to `ice.default` at the 2→3 step,
// so a header below 3, or one whose root mirror names `ice.default`, is a board from before the desk.
// The library marks such boards from the registry alone (`engineSchema` below 3, the last save's), and
// any board the open refused, so neither is offered to open again.

/** The engine schema that made a board's root canvas a durable identity (ICE `ENGINE_SCHEMA_VERSION` 3). */
export const DESK_ROOT_SCHEMA = 3;

const isLegacyRoot = (root: CanvasTypeIdentity | undefined): boolean =>
  root !== undefined && root.id === DefaultCanvasType.id;

/** Whether an at-rest board is from before the desk. An envelope that cannot be read is not judged
 * here: `docs.open`'s own quarantine is the honest catch for it. */
export function isBeforeTheDesk(bytes: Uint8Array): boolean {
  let header: ReturnType<typeof decodeEnvelope>["header"];
  try {
    header = decodeEnvelope(bytes).header;
  } catch {
    return false;
  }
  return header.engineSchema < DESK_ROOT_SCHEMA || isLegacyRoot(header.rootCanvas);
}

/** The same judgement on an OPENED document's authoritative root — the belt under the header's mirror. */
export function rootIsBeforeTheDesk(root: CanvasTypeIdentity | undefined): boolean {
  return isLegacyRoot(root);
}

/** The registry's word, before any bytes: the last save's engine schema. `null` (never saved) is a new board. */
export function registryBeforeTheDesk(engineSchema: number | null): boolean {
  return engineSchema !== null && engineSchema < DESK_ROOT_SCHEMA;
}
