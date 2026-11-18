import {
  type CallerContext,
  ObjectIntentAnswer,
  ObjectsGrantsParams,
  ObjectsHandParams,
  ObjectsHeldParams,
  ObjectsIntentsSubscribeParams,
  ObjectsRefParams,
  ObjectsResolveParams,
  ObjectsRunParams,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import { wholeValueDoor } from "../projection";
import type { ToolPlaneAudit } from "../tool-plane";
import type { DeskObjects } from "./desk-objects";

// OB-3, OB-4 (thinking-objects-at-work.md §5.5) — the window's door to the desk's state, the ten `objects.*` rows.
// Every one is held to a window's own token: `objects.window` is minted only into window tokens, and this holds it
// again, because a scope is not "the person's window" (EL7) and `clientKind` is only self-declared. The person's acts
// (a hand, an undo, a take-back) are audited; what objects hold never enters a line.
// OB custody (C5; OB-D19 A): a hand and a take-back answer only once whoever outlives fieldd was told the grants' count
// (a bounded wait that refuses nothing), so that by the time the person is told, an older grants file put back is
// already stale. A take-back answers `taken: true` whatever the disk said, with `kept: false` beside it when the
// grants file does not hold it yet. Its audit line names the holders it took the object from (holders are no
// secret), so that whoever reads the line can see when fieldd took it back from more than the one named.
// Item 526 (2026-11-18): a take-back always takes, even when its attempt record cannot be written, as the token
// revocations do. It goes through the audit's `revoke`, which owes the evidence and answers AUDIT_UNAVAILABLE with the
// act applied. A hand and an undo stay `required`: refusing them leaves nothing open.

/** The audit the doors call (audit-service.ts): `required` for an act that gives or changes, `revoke` for one that
 * ends a grant. */
export interface ObjectDoorsAudit extends ToolPlaneAudit {
  revoke<T>(
    ctx: CallerContext,
    mutation: {
      action: string;
      target: { kind: string; id: string };
      attrs?: Record<string, string | number | boolean>;
    },
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => {
      outcome?: "succeeded" | "failed" | "denied";
      attrs?: Record<string, string | number | boolean>;
    },
  ): Promise<T>;
}

export interface ObjectDoorsDeps {
  readonly objects: DeskObjects;
  readonly audit: ObjectDoorsAudit;
  /** a window's own token, by its id */
  isWindowToken(tokenId: string): boolean;
  /** the product API's stream floor on `objects.presence.subscribe` (tests) */
  readonly presenceIntervalMs?: number;
}

type Handler = (ctx: CallerContext, params: unknown) => unknown | Promise<unknown>;
type SubscriptionHandler = (
  ctx: CallerContext,
  params: unknown,
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
) => { snapshot: unknown; start?: () => void; dispose: () => void };

export interface ObjectDoorsApi {
  register(method: string, handler: Handler): void;
  registerSubscription(method: string, handler: SubscriptionHandler): void;
}

const bad = (shape: string): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", `expected ${shape}`, false);

const target = (ref: string) => ({ kind: "object", id: ref });

export function registerObjectDoors(api: ObjectDoorsApi, deps: ObjectDoorsDeps): void {
  const { objects, audit, isWindowToken } = deps;

  const windowToken = (ctx: CallerContext, method: string): string => {
    if (ctx.principal.kind === "local-token" && isWindowToken(ctx.principal.tokenId))
      return ctx.principal.tokenId;
    throw new RpcCallError("FORBIDDEN_SCOPE", `${method} is the window's own`, false);
  };

  api.registerSubscription("objects.intents.subscribe", (ctx, params, emit) => {
    const tokenId = windowToken(ctx, "objects.intents.subscribe");
    const parsed = ObjectsIntentsSubscribeParams.safeParse(params ?? {});
    if (!parsed.success) throw bad("{ docId }");
    const { docId } = parsed.data;
    // the door opens only once the window holds its subId: an intent sent sooner would be dropped by the client
    let close: (() => void) | undefined;
    return {
      snapshot: { docId },
      start: () => {
        close = objects.subscribeDesk(docId, tokenId, (intent) => emit(intent, "delta"));
      },
      dispose: () => close?.(),
    };
  });

  api.register("objects.intent.answer", (ctx, params) => {
    const tokenId = windowToken(ctx, "objects.intent.answer");
    const parsed = ObjectIntentAnswer.safeParse(params);
    if (!parsed.success) throw bad("{ intent, ok, value | fact, text }");
    return objects.intents.answer(parsed.data, tokenId);
  });

  api.register("objects.ref", (ctx, params) => {
    windowToken(ctx, "objects.ref");
    const parsed = ObjectsRefParams.safeParse(params);
    if (!parsed.success) throw bad("{ docId, key, kind? }");
    const { docId, key, kind } = parsed.data;
    return { ref: objects.registry.refFor(docId, key, kind) };
  });

  api.register("objects.hand", (ctx, params) => {
    windowToken(ctx, "objects.hand");
    const parsed = ObjectsHandParams.safeParse(params);
    if (!parsed.success) throw bad("{ ref, run }");
    const { ref, run } = parsed.data;
    objects.registry.readable();
    return audit.required(
      ctx,
      { action: "objects.hand", target: target(ref), attrs: { run } },
      async () => {
        const handed = objects.hand(ref, run);
        await objects.settled();
        return handed;
      },
      (value) => ({ outcome: value.handed ? "succeeded" : "denied" }),
    );
  });

  api.register("objects.undoAgent", (ctx, params) => {
    windowToken(ctx, "objects.undoAgent");
    const parsed = ObjectsRunParams.safeParse(params);
    if (!parsed.success) throw bad("{ ref, run }");
    const { ref, run } = parsed.data;
    return audit.required(
      ctx,
      { action: "objects.undo_agent", target: target(ref), attrs: { run } },
      () => objects.undoAgent(ref, run),
      (value) => ({ outcome: value.undone ? "succeeded" : "denied" }),
    );
  });

  api.register("objects.takeBack", (ctx, params) => {
    windowToken(ctx, "objects.takeBack");
    const parsed = ObjectsRunParams.safeParse(params);
    if (!parsed.success) throw bad("{ ref, run }");
    const { ref, run } = parsed.data;
    objects.registry.readable();
    let holders: string[] = [];
    return audit.revoke(
      ctx,
      { action: "objects.take_back", target: target(ref), attrs: { run } },
      async (): Promise<{ taken: true; kept?: false }> => {
        holders = objects.takeBack(ref, run);
        await objects.settled();
        // taken, whatever the disk said: `kept: false` says the grants file does not hold it yet
        return objects.kept ? { taken: true } : { taken: true, kept: false };
      },
      (value) => {
        // `kept` first: a line over the audit's bound loses its last attrs first
        const attrs: Record<string, string | boolean> = {};
        if (value.kept === false) attrs.kept = false;
        if (holders.length > 0) attrs.holders = holders.join(",");
        return { attrs };
      },
    );
  });

  api.register("objects.resolve", (ctx, params) => {
    windowToken(ctx, "objects.resolve");
    const parsed = ObjectsResolveParams.safeParse(params);
    if (!parsed.success) throw bad("{ ref }");
    const at = objects.resolve(parsed.data.ref);
    return at === undefined ? { found: false } : { found: true, ...at };
  });

  api.register("objects.grants", (ctx, params) => {
    windowToken(ctx, "objects.grants");
    const parsed = ObjectsGrantsParams.safeParse(params ?? {});
    if (!parsed.success) throw bad("{ ref? }");
    return { grants: objects.grants(parsed.data.ref) };
  });

  api.register("objects.held", (ctx, params) => {
    windowToken(ctx, "objects.held");
    const parsed = ObjectsHeldParams.safeParse(params);
    if (!parsed.success) throw bad("{ docId, key, held }");
    const { docId, key, held } = parsed.data;
    objects.held(docId, key, held);
    return {};
  });

  api.registerSubscription("objects.presence.subscribe", (ctx, _params, emit) => {
    windowToken(ctx, "objects.presence.subscribe");
    const door = wholeValueDoor(
      {
        read: () => objects.presence.snapshot(),
        onChange: (listener) => objects.presence.onChange(listener),
      },
      emit,
      deps.presenceIntervalMs !== undefined ? { minIntervalMs: deps.presenceIntervalMs } : {},
    );
    return { snapshot: door.snapshot, dispose: door.dispose };
  });
}
