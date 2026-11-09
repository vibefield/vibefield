import {
  type CallerContext,
  ObjectIntentAnswer,
  ObjectsHeldParams,
  ObjectsIntentsSubscribeParams,
  ObjectsRefParams,
  ObjectsResolveParams,
  ObjectsRunParams,
  ObjectsHandParams,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import { wholeValueDoor } from "../projection";
import type { ToolPlaneAudit } from "../tool-plane";
import type { DeskObjects } from "./desk-objects";

// OB-3, OB-4 (thinking-objects-at-work.md §5.5) — the window's door to the desk's state, the nine `objects.*` rows.
// Every one is held to a window's own token: `objects.window` is minted only into window tokens, and this holds it
// again, because a scope is not "the person's window" (EL7) and `clientKind` is only self-declared. The person's acts
// (a hand, an undo, a take-back) are audited; what objects hold never enters a line.

export interface ObjectDoorsDeps {
  readonly objects: DeskObjects;
  readonly audit: ToolPlaneAudit;
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
      () => objects.hand(ref, run),
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
      { action: "objects.undoAgent", target: target(ref), attrs: { run } },
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
    return audit.required(
      ctx,
      { action: "objects.takeBack", target: target(ref), attrs: { run } },
      () => {
        objects.takeBack(ref, run);
        return { taken: true as const };
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
