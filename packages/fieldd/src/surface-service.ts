import {
  type CallerContext,
  type LiveSurfaceSourceKindV1,
  type RendererParticipantIdentity,
  type Scope,
  type ShellSurfacesEnumerateParams,
  type ShellSurfacesEnumerateResult,
  type ShellSurfacesMintParams,
  type ShellSurfacesMintResult,
  type ShellSurfacesReleaseParams,
  type ShellSurfacesReleaseResult,
  SurfaceCloseParamsV1,
  SurfaceCloseResultV1,
  SurfaceOpenParamsV1,
  SurfaceOpenResultV1,
  SurfaceSourcesParamsV1,
  SurfaceSourcesResultV1,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AuditMutation, AuditMutationOutcome } from "./audit-service";
import { RpcCallError } from "./native-link";

// DT-1b — the SurfaceService: fieldd's POLICY door for `surface.*`
// (thinking-devtools-pack.md DT-D2/DT-D3). Electron main owns the MECHANISM —
// producers, the one-use ticket table, the OS consent prompts. Everything that
// decides WHETHER a surface may exist lives here: the kind→scope matrix, the
// local-window binding, idempotent replay, and the audit pair.
//
// What this file deliberately does NOT do: re-check the METHODS registry scope.
// ProductAPI checks `def.scope` against the connection's grant before a handler
// runs (product-api.ts, the `def.scope !== null` gate), so `surface.attach` on
// open/close and `surface.capture` on sources are already enforced on arrival.
// The matrix below is the ADDITIONAL gate that one registry row — one scope per
// row — cannot express.

/** The kind→scope matrix (DT-D3). The registry row carries the base
 * `surface.attach`; CREATING a source of a given kind costs one scope more,
 * because capturing another app's window is a different consent class from
 * rendering a browser view we own (A5/EL7 — Screen Recording gravity). */
const SURFACE_KIND_SCOPE: Readonly<Record<LiveSurfaceSourceKindV1, Scope>> = {
  browser: "surface.browser",
  "sck-window": "surface.capture",
  "ios-simulator": "surface.capture",
};

/** How many `surface.open` answers are remembered for idempotent retries.
 * ProductAPI has no generic dedupe — the registry's `idempotent: true` column
 * declares retry SAFETY to callers and forwarders, it remembers nothing — so
 * the service owns this the way TerminalGrantMinter owns `renewAttach`'s. A
 * retry arrives within seconds; this bounds a caller that never stops asking. */
const OPEN_REPLAY_MEMORY = 64;

/** The four DT-1a authority helpers, narrowed. `ProductApi` satisfies this
 * structurally; tests pass a fake and never a real broker. */
export interface SurfaceAuthority {
  surfaceAuthorityAvailable(): boolean;
  surfacesEnumerate(params: ShellSurfacesEnumerateParams): Promise<ShellSurfacesEnumerateResult>;
  surfacesMint(params: ShellSurfacesMintParams): Promise<ShellSurfacesMintResult>;
  surfacesRelease(params: ShellSurfacesReleaseParams): Promise<ShellSurfacesReleaseResult>;
}

/** The slice of AuditService this door needs: attempt → effect → outcome. */
export interface SurfaceAudit {
  required<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
  ): Promise<T>;
}

export interface SurfaceServiceOptions {
  api: SurfaceAuthority;
  audit: SurfaceAudit;
  logger?: Logger;
}

export interface SurfaceService {
  sources(ctx: CallerContext, params: unknown): Promise<SurfaceSourcesResultV1>;
  open(ctx: CallerContext, params: unknown): Promise<SurfaceOpenResultV1>;
  close(ctx: CallerContext, params: unknown): Promise<SurfaceCloseResultV1>;
}

function authorityUnavailable(): RpcCallError {
  return new RpcCallError("UNAVAILABLE", "the live-surface authority is unavailable", true, {
    service: "surfaces",
    state: "authority-unavailable",
  });
}

/** The internal door reports provider loss as the SHELL's UNAVAILABLE. A
 * `surface.*` caller is told about surfaces, not about which process happened
 * to own the mechanism — the tolerant-reader law's honest degraded state, named
 * for the service that was asked. Every other failure passes through as it is. */
function throughSurfaces(error: unknown): never {
  if (error instanceof RpcCallError && error.kind === "UNAVAILABLE") throw authorityUnavailable();
  throw error;
}

/** daemon.ts's convention, verbatim: read the grant off the principal and treat
 * its absence as EMPTY. A principal with no `scopes` field is a tailnet one, and
 * no `surface.*` scope is in TAILNET_SCOPES — absent means denied here, never
 * trusted. */
function scopesOf(ctx: CallerContext): readonly string[] {
  return (ctx.principal as { scopes?: string[] }).scopes ?? [];
}

/** PRC-5a/PRC-D14 — the window binding. A renderer's local-token principal
 * carries the identity fieldd derived at token mint; nothing else does, and that
 * is the point: a surface is a view inside ONE window, so a caller with no
 * window has nothing to attach to. mcp-agent, tailnet and peer principals fail
 * here — and so does shell-main, which is a process, not a window. */
function rendererParticipantOf(ctx: CallerContext): RendererParticipantIdentity {
  const identity = (ctx.principal as { rendererParticipant?: RendererParticipantIdentity })
    .rendererParticipant;
  if (identity === undefined) {
    throw new RpcCallError(
      "FORBIDDEN_SCOPE",
      "surfaces attach only to a local renderer window",
      false,
    );
  }
  return identity;
}

/** `owner` is log provenance, never authority (DT-1a). No caller reaches this
 * branch today: TokenService refuses to mint a token that is both plugin-bound
 * and renderer-bound ("ambiguous bindings"), so a plugin principal can never
 * carry the rendererParticipant the gate above requires. The derivation stays
 * because `owner` is the door's declared shape, and the suite pins both halves
 * of why it is currently unreachable rather than leaving it looking supported. */
function ownerOf(ctx: CallerContext): { pluginId: string } | undefined {
  return ctx.principal.kind === "plugin" ? { pluginId: ctx.principal.id } : undefined;
}

/** Replay identity for one open request. The renderer INCARNATION is part of
 * the key on purpose: a reload is a new renderer generation, and the ticket the
 * previous generation was handed is bound to it main-side — replaying it would
 * give the new document a ticket it cannot redeem. NUL separates: the three
 * derived components are regex-bounded and cannot contain one, and the only
 * unconstrained component — the caller's key — is LAST, so nothing a caller
 * types can shift a boundary and collide with another window's entry. */
function replayKey(ctx: CallerContext, identity: RendererParticipantIdentity, key: string): string {
  const tokenId = (ctx.principal as { tokenId?: string }).tokenId ?? "anonymous";
  return [tokenId, identity.participantId, identity.incarnation, key].join("\u0000");
}

export function createSurfaceService(options: SurfaceServiceOptions): SurfaceService {
  const { api, audit } = options;
  const logger = (options.logger ?? createNoopLogger()).child({ component: "surfaces" });
  /** replay key → the answer the first call got (the in-flight promise, so a
   * retry that races the original collapses onto it instead of minting twice). */
  const openReplays = new Map<string, Promise<SurfaceOpenResultV1>>();

  const remember = (key: string, answer: Promise<SurfaceOpenResultV1>): void => {
    openReplays.set(key, answer);
    // A failed mint is not an answer: the retry that follows is the one this
    // key exists for, so forget it rather than replaying the failure forever.
    void answer.catch(() => {
      if (openReplays.get(key) === answer) openReplays.delete(key);
    });
    while (openReplays.size > OPEN_REPLAY_MEMORY) {
      const oldest = openReplays.keys().next().value;
      if (oldest === undefined) break;
      openReplays.delete(oldest);
    }
  };

  return {
    // No principal fact is read here: enumeration needs no window and no extra
    // scope, so the registry's `surface.capture` row is the whole policy.
    async sources(_ctx, params) {
      const parsed = SurfaceSourcesParamsV1.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { kind: sck-window | ios-simulator }",
          false,
        );
      }
      // Enumeration is a read of what this device could show, and both
      // enumerable kinds cost exactly the row's `surface.capture` — the matrix
      // adds nothing here, so the registry gate is the whole gate.
      if (!api.surfaceAuthorityAvailable()) {
        logger.info(
          "fieldd.surfaces.authority_unavailable",
          "A surface enumeration arrived with no live-surface authority registered",
          { kind: parsed.data.kind },
        );
        throw authorityUnavailable();
      }
      const enumerated = await api
        .surfacesEnumerate({ kind: parsed.data.kind })
        .catch(throughSurfaces);
      return SurfaceSourcesResultV1.parse(enumerated);
    },

    async open(ctx, params) {
      const parsed = SurfaceOpenParamsV1.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { source, reuseKey?, idempotencyKey? }",
          false,
        );
      }
      const source = parsed.data.source;
      // DT-1c's continuity key (a desk object's durable key): forwarded to main's mint, where custody dedupes on it so
      // a renderer reload re-binds the SAME running page instead of restarting it (PT-2 — it was parsed and dropped here)
      const reuseKey = parsed.data.reuseKey;
      const required = SURFACE_KIND_SCOPE[source.kind];
      if (!scopesOf(ctx).includes(required)) {
        throw new RpcCallError("FORBIDDEN_SCOPE", `requires ${required}`, false, { required });
      }
      const rendererParticipant = rendererParticipantOf(ctx);
      const owner = ownerOf(ctx);
      const memo =
        parsed.data.idempotencyKey === undefined
          ? undefined
          : replayKey(ctx, rendererParticipant, parsed.data.idempotencyKey);
      let replayed = false;

      const opened = await audit.required(
        ctx,
        {
          // The surface has no id until main mints it, so the attempt names it
          // "pending" and the outcome carries the real one (the shape
          // terminal.session.create established — honest both ways). attrs
          // carry the source KIND and the window, never the source itself: a
          // spec holds the URL, window ref, or UDID this ledger must not copy.
          action: "surface.open",
          target: { kind: "surface", id: "pending" },
          attrs: {
            sourceKind: source.kind,
            participantId: rendererParticipant.participantId,
            incarnation: rendererParticipant.incarnation,
            ...(owner === undefined ? {} : { pluginId: owner.pluginId }),
            ...(memo === undefined ? {} : { idempotent: true }),
          },
        },
        async () => {
          if (memo !== undefined) {
            // Reusing a key after the surface was closed returns the closed
            // surface's answer: a key names one REQUEST, not one slot. The
            // replayed ticket is one-use and already spent, so the caller
            // learns it honestly at redemption rather than getting a stranger.
            const remembered = openReplays.get(memo);
            if (remembered !== undefined) {
              replayed = true;
              return await remembered;
            }
          }
          const minted = api
            .surfacesMint({
              rendererParticipant,
              source,
              ...(reuseKey === undefined ? {} : { reuseKey }),
              ...(owner === undefined ? {} : { owner }),
            })
            .then((result) => SurfaceOpenResultV1.parse(result), throughSurfaces);
          if (memo !== undefined) remember(memo, minted);
          return await minted;
        },
        (result) => ({
          outcome: "succeeded",
          attrs: { surfaceId: result.surfaceId, replayed },
        }),
      );

      // "answered", not "minted": a replay mints nothing, and the operator
      // reading this line needs to know which of the two happened.
      logger.info("fieldd.surfaces.opened", "A live surface open was answered", {
        surfaceId: opened.surfaceId,
        sourceKind: source.kind,
        replayed,
      });
      return opened;
    },

    async close(ctx, params) {
      const parsed = SurfaceCloseParamsV1.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError("PRECONDITION_FAILED", "expected { surfaceId }", false);
      }
      const rendererParticipant = rendererParticipantOf(ctx);
      const surfaceId = parsed.data.surfaceId;
      const closed = await audit.required(
        ctx,
        {
          action: "surface.close",
          target: { kind: "surface", id: surfaceId },
          attrs: {
            participantId: rendererParticipant.participantId,
            incarnation: rendererParticipant.incarnation,
          },
        },
        async () => {
          const released = await api
            .surfacesRelease({ surfaceId, rendererParticipant })
            .catch(throughSurfaces);
          // Releasing a surface that is already gone is the ANSWER, not an
          // error: a close racing a window teardown must be safe to repeat.
          return SurfaceCloseResultV1.parse({ closed: released.released });
        },
        (result) => ({ outcome: "succeeded", attrs: { closed: result.closed } }),
      );
      logger.info("fieldd.surfaces.closed", "A live surface release was requested", {
        surfaceId,
        closed: closed.closed,
      });
      return closed;
    },
  };
}
