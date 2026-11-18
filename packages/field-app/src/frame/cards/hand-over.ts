import {
  AgentProvidersResult,
  type ObjectRef,
  ObjectsGrantsResult,
  ObjectsHandResult,
  ObjectsRefResult,
  ObjectsResolveResult,
} from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { agentDoorCanName, noteAgentNameable } from "./card-landing";

// THE WINDOW'S DOORS TO THE DESK'S OBJECTS (OB-L1, §4.3). Playing a card's Live face on one agent is the grant: the window asks
// fieldd (`objects.hand {ref, run}`) and pastes the ref's words only once it is handed. Making a card asks its object's name
// (`objects.ref`), and a ref played on the desk asks where it is (`objects.resolve`). One small door each, so every place goes
// through the same call, and a fieldd that cannot be reached is said honestly: nothing handed, no Live, no camera.

/** What the door says: handed, or the reason it was not. */
export type HandOverDoor = (ref: ObjectRef, run: string) => Promise<ObjectsHandResult>;

/** An object on a board, as `objects.ref` names it. */
export interface RefAsk {
  readonly docId: string;
  readonly key: string;
  readonly kind?: string;
}

/** Where a ref's object lies. */
export interface RefPlace {
  readonly docId: string;
  readonly key: string;
}

export const HAND_OVER_WORDS = {
  /** there is no door to the desk's objects in this window */
  noDoor: "Not handed over — desk objects can't be handed to agents yet",
  /** Chat: the spark has no session to hand it to */
  noRun: "Not handed over — this spark has no session yet",
  /** fieldd did not answer, or answered something it should not */
  unreachable: "Not handed over — VibeField's daemon did not answer",
} as const;

/** How long Make a card waits for a name: a card is never held up by a fieldd that does not answer. */
export const REF_WAIT_MS = 1_500;

type RefDoor = (ask: RefAsk) => Promise<ObjectRef | null>;
type ResolveDoor = (ref: ObjectRef) => Promise<RefPlace | null>;
/** What a take-back came to (item 526): `taken`; `stands`, refused while the run still holds the object; or `unknown`,
 * refused when fieldd could not say either way. */
export type TakeBackSaid = "taken" | "stands" | "unknown";
/** Ends a grant. Never rejects, and never swallows: a refusal is said as what it left. `handle`: the name the pane
 * shows, which a spark's grant is named by. */
export type TakeBackDoor = (ref: ObjectRef, run: string, handle?: string) => Promise<TakeBackSaid>;

let handDoor: HandOverDoor | null = null;
let refDoor: RefDoor | null = null;
let resolveDoor: ResolveDoor | null = null;
let takeBackDoor: TakeBackDoor | null = null;

/** Install the grant's door (the window's own, or a test's). Returns the undo. */
export function setHandOverDoor(next: HandOverDoor): () => void {
  handDoor = next;
  return () => {
    if (handDoor === next) handDoor = null;
  };
}

/** Grant `run` the object `ref`: the person's play, through VibeField's own window (OB-L1). */
export function handOver(ref: ObjectRef, run: string): Promise<ObjectsHandResult> {
  if (handDoor === null) return Promise.resolve({ handed: false, reason: HAND_OVER_WORDS.noDoor });
  return handDoor(ref, run);
}

/** Install the take-back's door (the window's own, or a test's). Returns the undo. */
export function setTakeBackDoor(next: TakeBackDoor): () => void {
  takeBackDoor = next;
  return () => {
    if (takeBackDoor === next) takeBackDoor = null;
  };
}

/** End the grant this play made when its words could not follow it, and say what that came to. With no door in this
 * window nothing was granted, so there is nothing left to take back. */
export function takeBack(ref: ObjectRef, run: string, handle?: string): Promise<TakeBackSaid> {
  return takeBackDoor === null ? Promise.resolve("taken") : takeBackDoor(ref, run, handle);
}

/** fieldd took it back and could not write the evidence yet (item 526): AUDIT_UNAVAILABLE with the act applied. */
function appliedAnyway(cause: unknown): boolean {
  if (!(cause instanceof FielddRpcError) || cause.kind !== "AUDIT_UNAVAILABLE") return false;
  const details = cause.details;
  return typeof details === "object" && details !== null && "actionApplied" in details
    ? details.actionApplied === true
    : false;
}

/** The name of an object on a board; null when there is no door, or fieldd did not say in time. */
export function refFor(ask: RefAsk): Promise<ObjectRef | null> {
  if (refDoor === null) return Promise.resolve(null);
  const asked = refDoor(ask);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), REF_WAIT_MS);
    void asked.then((ref) => {
      clearTimeout(timer);
      resolve(ref);
    });
  });
}

/** Where a ref's object lies; null when it is gone, or there is no way to ask. */
export function resolveRef(ref: ObjectRef): Promise<RefPlace | null> {
  return resolveDoor === null ? Promise.resolve(null) : resolveDoor(ref);
}

/** The window's doors over its fieldd client, and which agents' runs the door can name, read once (a synchronous cache after).
 * Returns the undo. */
export function installObjectsDoor(client: Pick<FielddClient, "request">): () => void {
  const hand: HandOverDoor = async (ref, run) => {
    try {
      const said = ObjectsHandResult.safeParse(await client.request("objects.hand", { ref, run }));
      return said.success ? said.data : { handed: false, reason: HAND_OVER_WORDS.unreachable };
    } catch {
      return { handed: false, reason: HAND_OVER_WORDS.unreachable };
    }
  };
  const named: RefDoor = async (ask) => {
    try {
      const said = ObjectsRefResult.safeParse(await client.request("objects.ref", ask));
      return said.success ? said.data.ref : null;
    } catch {
      return null;
    }
  };
  const found: ResolveDoor = async (ref) => {
    try {
      const said = ObjectsResolveResult.safeParse(await client.request("objects.resolve", { ref }));
      return said.success && said.data.found
        ? { docId: said.data.docId, key: said.data.key }
        : null;
    } catch {
      return null;
    }
  };
  const back: TakeBackDoor = async (ref, run, handle) => {
    // twice: since item 526 fieldd takes back even when it cannot write the evidence, so a refusal is a fieldd that
    // could not be reached, and the second ask may find it again
    for (let ask = 0; ask < 2; ask += 1) {
      try {
        await client.request("objects.takeBack", { ref, run });
        return "taken";
      } catch (cause) {
        if (appliedAnyway(cause)) return "taken";
      }
    }
    // refused twice: say only what fieldd still holds, never more (EL5)
    try {
      const said = ObjectsGrantsResult.safeParse(await client.request("objects.grants", { ref }));
      if (!said.success) return "unknown";
      const stands = said.data.grants.some(
        (grant) => grant.holder === run || (handle !== undefined && grant.name === handle),
      );
      return stands ? "stands" : "taken";
    } catch {
      return "unknown";
    }
  };
  handDoor = hand;
  takeBackDoor = back;
  refDoor = named;
  resolveDoor = found;
  void (async () => {
    try {
      const said = AgentProvidersResult.safeParse(await client.request("agent.providers", {}));
      if (!said.success) return;
      for (const provider of said.data.providers) {
        noteAgentNameable(provider.id, agentDoorCanName(provider.briefing));
      }
    } catch {
      // the catalog's word stands until a fieldd can say (`doorCanNameRun`)
    }
  })();
  return () => {
    if (handDoor === hand) handDoor = null;
    if (takeBackDoor === back) takeBackDoor = null;
    if (refDoor === named) refDoor = null;
    if (resolveDoor === found) resolveDoor = null;
  };
}

/** Test seam: no doors. */
export function resetHandOverForTest(): void {
  handDoor = null;
  takeBackDoor = null;
  refDoor = null;
  resolveDoor = null;
}
