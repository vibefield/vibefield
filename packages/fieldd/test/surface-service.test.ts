// DT-1b — the SurfaceService, fieldd's policy door for `surface.*`. The whole
// point of this suite is the POLICY: the kind→scope matrix that one registry
// row cannot express, the local-window binding, idempotent replay, and what
// the audit ledger is allowed to learn about a source it never gets to keep.
// The authority is a fake throughout — a real broker would test Electron main,
// which is DT-1c's job.
import type {
  CallerContext,
  LiveSurfaceSourceSpecV1,
  RendererParticipantIdentity,
  Scope,
  ShellSurfacesEnumerateParams,
  ShellSurfacesEnumerateResult,
  ShellSurfacesMintParams,
  ShellSurfacesMintResult,
  ShellSurfacesReleaseParams,
  ShellSurfacesReleaseResult,
} from "@vibefield/contracts";
import type { AuditPhaseV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it } from "vitest";
import type { AuditMutation, AuditMutationOutcome } from "../src/audit-service";
import { RpcCallError } from "../src/native-link";
import { createSurfaceService, type SurfaceAuthority } from "../src/surface-service";
import { TokenService } from "../src/token-service";

const PARTICIPANT: RendererParticipantIdentity = {
  participantId: "win-1",
  incarnation: "gen-1",
};

const TICKET = { v: 1 as const, token: "t".repeat(48) };
const SURFACE_ID = "srf_01ARZ3NDEKTSV4RR";

const BROWSER_SOURCE: LiveSurfaceSourceSpecV1 = {
  kind: "browser",
  initialUrl: "https://example.invalid/dashboard?token=secret-in-the-url",
  profile: { mode: "memory", ref: "scratch" },
  logicalViewport: { width: 1280, height: 720 },
};

const SCK_SOURCE: LiveSurfaceSourceSpecV1 = {
  kind: "sck-window",
  sourceRef: "window:4823:Xcode",
  captureCursor: false,
};

const SIM_SOURCE: LiveSurfaceSourceSpecV1 = {
  kind: "ios-simulator",
  udid: "ABCDEF01-2345-6789-ABCD-EF0123456789",
  crop: { mode: "auto" },
};

/** A renderer window's local-token principal: the only principal shape that
 * carries the rendererParticipant fieldd derived at token mint (PRC-D14). */
function windowContext(scopes: Scope[], identity = PARTICIPANT): CallerContext {
  return {
    principal: {
      kind: "local-token",
      tokenId: "tk_000000000001",
      scopes,
      rendererParticipant: identity,
    },
    transport: "ws-loopback",
    receivedAt: Date.now(),
    clientKind: "renderer",
  };
}

function pluginContext(scopes: Scope[]): CallerContext {
  return {
    principal: { kind: "plugin", id: "vibefield.devtool", scopes, tokenId: "tk_000000000002" },
    transport: "ws-loopback",
    receivedAt: Date.now(),
    clientKind: "renderer",
  };
}

function agentContext(scopes: Scope[]): CallerContext {
  return {
    principal: { kind: "mcp-agent", sessionId: "mcp-1", scopes },
    transport: "mcp",
    receivedAt: Date.now(),
  };
}

interface AuditRow {
  action: string;
  phase: AuditPhaseV1;
  targetId: string;
  /** AuditService derives the actor from the caller context; so does this. */
  actor: string;
  outcome?: AuditMutationOutcome["outcome"];
  attrs: Record<string, unknown>;
}

interface FakeAudit {
  rows: AuditRow[];
  required<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
  ): Promise<T>;
}

/** Mirrors AuditService.required's contract: attempt row, then the effect, then
 * an outcome row (failed when the effect throws). */
function fakeAudit(): FakeAudit {
  const rows: AuditRow[] = [];
  return {
    rows,
    async required<T>(
      ctx: CallerContext,
      mutation: AuditMutation,
      effect: () => Promise<T> | T,
      describeOutcome?: (value: T) => AuditMutationOutcome,
    ): Promise<T> {
      const actor = ctx.principal.kind;
      rows.push({
        action: mutation.action,
        phase: "attempt",
        targetId: mutation.target.id,
        actor,
        attrs: { ...mutation.attrs },
      });
      let value: T;
      try {
        value = await effect();
      } catch (error) {
        rows.push({
          action: mutation.action,
          phase: "outcome",
          targetId: mutation.target.id,
          actor,
          outcome: "failed",
          attrs: {},
        });
        throw error;
      }
      const described = describeOutcome?.(value) ?? {};
      rows.push({
        action: mutation.action,
        phase: "outcome",
        targetId: mutation.target.id,
        actor,
        outcome: described.outcome ?? "succeeded",
        attrs: { ...described.attrs },
      });
      return value;
    },
  };
}

interface FakeAuthority extends SurfaceAuthority {
  available: boolean;
  enumerated: ShellSurfacesEnumerateParams[];
  minted: ShellSurfacesMintParams[];
  released: ShellSurfacesReleaseParams[];
  sources: ShellSurfacesEnumerateResult["sources"];
  mintResult: () => Promise<ShellSurfacesMintResult>;
  releaseResult: (params: ShellSurfacesReleaseParams) => Promise<ShellSurfacesReleaseResult>;
}

function shellUnavailable(): RpcCallError {
  // The exact shape the real broker throws when no provider is registered.
  return new RpcCallError("UNAVAILABLE", "desktop shell provider is unavailable", true, {
    service: "shell",
    state: "unavailable",
  });
}

function fakeAuthority(): FakeAuthority {
  let mintSeq = 0;
  const authority: FakeAuthority = {
    available: true,
    enumerated: [],
    minted: [],
    released: [],
    sources: [],
    mintResult: async () => {
      mintSeq += 1;
      return { surfaceId: `${SURFACE_ID}${mintSeq}`, ticket: TICKET };
    },
    releaseResult: async () => ({ released: true }),
    surfaceAuthorityAvailable: () => authority.available,
    async surfacesEnumerate(params) {
      authority.enumerated.push(params);
      if (!authority.available) throw shellUnavailable();
      return { sources: authority.sources };
    },
    async surfacesMint(params) {
      authority.minted.push(params);
      return await authority.mintResult();
    },
    async surfacesRelease(params) {
      authority.released.push(params);
      return await authority.releaseResult(params);
    },
  };
  return authority;
}

function service(authority: FakeAuthority, audit = fakeAudit()) {
  return { surfaces: createSurfaceService({ api: authority, audit }), audit };
}

async function refusal(promise: Promise<unknown>): Promise<RpcCallError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcCallError) return error;
    throw error;
  }
  throw new Error("expected the call to be refused");
}

describe("SurfaceService.sources", () => {
  it("passes the redacted picker rows through", async () => {
    const authority = fakeAuthority();
    authority.sources = [
      { kind: "sck-window", sourceRef: "window:1", title: "Xcode", appName: "Xcode" },
      { kind: "sck-window", sourceRef: "window:2" },
    ];
    const { surfaces } = service(authority);
    const result = await surfaces.sources(windowContext(["surface.capture"]), {
      kind: "sck-window",
    });
    expect(result.sources).toEqual(authority.sources);
    expect(authority.enumerated).toEqual([{ kind: "sck-window" }]);
  });

  it("answers UNAVAILABLE for surfaces when the authority is absent", async () => {
    const authority = fakeAuthority();
    authority.available = false;
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.sources(windowContext(["surface.capture"]), { kind: "ios-simulator" }),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ service: "surfaces", state: "authority-unavailable" });
    // Refused before the door: nothing was dispatched at all.
    expect(authority.enumerated).toEqual([]);
  });

  it("refuses a kind that is not enumerable", async () => {
    const { surfaces } = service(fakeAuthority());
    const error = await refusal(
      surfaces.sources(windowContext(["surface.capture"]), { kind: "browser" }),
    );
    expect(error.kind).toBe("PRECONDITION_FAILED");
  });
});

describe("SurfaceService.open — the kind→scope matrix", () => {
  it("mints for a browser source when the caller holds attach + browser", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const result = await surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
      source: BROWSER_SOURCE,
    });
    expect(result).toEqual({ surfaceId: `${SURFACE_ID}1`, ticket: TICKET });
    expect(authority.minted).toEqual([
      { rendererParticipant: PARTICIPANT, source: BROWSER_SOURCE },
    ]);
    // The source crosses fieldd verbatim, exactly once (DT-D2).
    expect(authority.minted[0]?.source).toStrictEqual(BROWSER_SOURCE);
  });

  it("refuses a browser source from a caller holding only the base attach scope", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.open(windowContext(["surface.attach"]), { source: BROWSER_SOURCE }),
    );
    expect(error.kind).toBe("FORBIDDEN_SCOPE");
    expect(error.details).toEqual({ required: "surface.browser" });
    expect(authority.minted).toEqual([]);
  });

  it("refuses a capture source from a caller holding attach + browser", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    for (const source of [SCK_SOURCE, SIM_SOURCE]) {
      const error = await refusal(
        surfaces.open(windowContext(["surface.attach", "surface.browser"]), { source }),
      );
      expect(error.kind).toBe("FORBIDDEN_SCOPE");
      expect(error.details).toEqual({ required: "surface.capture" });
    }
    expect(authority.minted).toEqual([]);
  });

  it("mints a capture source for a caller holding attach + capture", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const result = await surfaces.open(windowContext(["surface.attach", "surface.capture"]), {
      source: SCK_SOURCE,
    });
    expect(result.surfaceId).toBe(`${SURFACE_ID}1`);
    expect(authority.minted[0]?.source).toStrictEqual(SCK_SOURCE);
  });
});

describe("SurfaceService.open — reload continuity (DT-1c's reuseKey)", () => {
  it("forwards the caller's reuseKey to main's mint, where custody dedupes a reload onto the SAME page", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    await surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
      source: BROWSER_SOURCE,
      reuseKey: "desk:13918995204487956201-1",
    });
    expect(authority.minted).toEqual([
      {
        rendererParticipant: PARTICIPANT,
        source: BROWSER_SOURCE,
        reuseKey: "desk:13918995204487956201-1",
      },
    ]);
  });

  it("mints with no reuseKey when the caller gives none — a fresh page each time", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    await surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
      source: BROWSER_SOURCE,
    });
    expect(authority.minted[0]).not.toHaveProperty("reuseKey");
  });

  it("refuses a reuseKey the contract does not admit, before any mint", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
        source: BROWSER_SOURCE,
        reuseKey: "a key with spaces",
      }),
    );
    expect(error.kind).toBe("PRECONDITION_FAILED");
    expect(authority.minted).toEqual([]);
  });
});

describe("SurfaceService.open — the local-window binding", () => {
  it("refuses a caller that carries no renderer participant", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.open(agentContext(["surface.attach", "surface.browser"]), {
        source: BROWSER_SOURCE,
      }),
    );
    expect(error.kind).toBe("FORBIDDEN_SCOPE");
    expect(error.message).toMatch(/attach only to a local renderer window/);
    expect(authority.minted).toEqual([]);
  });

  it("refuses a plugin principal — and the token law is why it can never carry one", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.open(pluginContext(["surface.attach", "surface.browser"]), {
        source: BROWSER_SOURCE,
      }),
    );
    expect(error.kind).toBe("FORBIDDEN_SCOPE");
    expect(error.message).toMatch(/attach only to a local renderer window/);
    expect(authority.minted).toEqual([]);
    // The reason is upstream of this service and worth pinning here: a plugin
    // principal comes from a plugin-bound token, and TokenService refuses to
    // bind one token to both a plugin and a renderer window. So DT-1a's
    // `owner.pluginId` provenance field has no reachable caller in v1 — a
    // contract-vs-token-model gap, reported rather than papered over.
    const tokens = new TokenService();
    expect(() =>
      tokens.mint(["surface.attach"], "plugin:vibefield.devtool", {
        pluginId: "vibefield.devtool",
        rendererParticipant: PARTICIPANT,
      }),
    ).toThrowError(/ambiguous bindings/);
  });

  it("binds the mint to the caller's own participant, not to a claim in params", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const identity: RendererParticipantIdentity = {
      participantId: "win-9",
      incarnation: "gen-4",
    };
    await surfaces.open(windowContext(["surface.attach", "surface.browser"], identity), {
      source: BROWSER_SOURCE,
      rendererParticipant: { participantId: "win-attacker", incarnation: "gen-attacker" },
    });
    expect(authority.minted[0]?.rendererParticipant).toEqual(identity);
  });
});

describe("SurfaceService.open — audit", () => {
  it("records the kind and the window, never the source itself", async () => {
    const authority = fakeAuthority();
    const { surfaces, audit } = service(authority);
    await surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
      source: BROWSER_SOURCE,
      idempotencyKey: "key-1",
    });
    const [attempt, outcome] = audit.rows;
    expect(audit.rows).toHaveLength(2);
    expect(attempt).toMatchObject({
      action: "surface.open",
      phase: "attempt",
      targetId: "pending",
      actor: "local-token",
    });
    expect(attempt?.attrs).toEqual({
      sourceKind: "browser",
      participantId: "win-1",
      incarnation: "gen-1",
      idempotent: true,
    });
    expect(outcome).toMatchObject({ phase: "outcome", outcome: "succeeded" });
    expect(outcome?.attrs).toEqual({ surfaceId: `${SURFACE_ID}1`, replayed: false });
    // The ledger never learns the URL, the window ref, the UDID, or the ticket.
    const serialized = JSON.stringify(audit.rows);
    expect(serialized).not.toContain("secret-in-the-url");
    expect(serialized).not.toContain("example.invalid");
    expect(serialized).not.toContain(TICKET.token);
  });

  it("keeps a capture source's sourceRef and udid out of the records", async () => {
    const authority = fakeAuthority();
    const { surfaces, audit } = service(authority);
    const ctx = windowContext(["surface.attach", "surface.capture"]);
    await surfaces.open(ctx, { source: SCK_SOURCE });
    await surfaces.open(ctx, { source: SIM_SOURCE });
    const serialized = JSON.stringify(audit.rows);
    expect(serialized).not.toContain("window:4823:Xcode");
    expect(serialized).not.toContain("ABCDEF01-2345-6789-ABCD-EF0123456789");
    expect(audit.rows.filter((row) => row.phase === "attempt").map((row) => row.attrs)).toEqual([
      { sourceKind: "sck-window", participantId: "win-1", incarnation: "gen-1" },
      { sourceKind: "ios-simulator", participantId: "win-1", incarnation: "gen-1" },
    ]);
  });

  it("records a failed outcome when the authority refuses", async () => {
    const authority = fakeAuthority();
    authority.mintResult = async () => {
      throw shellUnavailable();
    };
    const { surfaces, audit } = service(authority);
    await refusal(
      surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
        source: BROWSER_SOURCE,
      }),
    );
    expect(audit.rows.map((row) => [row.phase, row.outcome])).toEqual([
      ["attempt", undefined],
      ["outcome", "failed"],
    ]);
  });
});

describe("SurfaceService.open — idempotency", () => {
  it("replays one answer for a repeated key and mints exactly once", async () => {
    const authority = fakeAuthority();
    const { surfaces, audit } = service(authority);
    const ctx = windowContext(["surface.attach", "surface.browser"]);
    const first = await surfaces.open(ctx, { source: BROWSER_SOURCE, idempotencyKey: "k" });
    const second = await surfaces.open(ctx, { source: BROWSER_SOURCE, idempotencyKey: "k" });
    expect(second).toEqual(first);
    expect(authority.minted).toHaveLength(1);
    // The retry is still a real request, so the ledger still sees it — and says
    // it was a replay rather than a second surface.
    const outcomes = audit.rows.filter((row) => row.phase === "outcome");
    expect(outcomes.map((row) => row.attrs["replayed"])).toEqual([false, true]);
  });

  it("collapses a retry that races the first mint", async () => {
    const authority = fakeAuthority();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let seq = 0;
    authority.mintResult = async () => {
      await gate;
      seq += 1;
      return { surfaceId: `${SURFACE_ID}${seq}`, ticket: TICKET };
    };
    const { surfaces } = service(authority);
    const ctx = windowContext(["surface.attach", "surface.browser"]);
    const both = Promise.all([
      surfaces.open(ctx, { source: BROWSER_SOURCE, idempotencyKey: "k" }),
      surfaces.open(ctx, { source: BROWSER_SOURCE, idempotencyKey: "k" }),
    ]);
    release?.();
    const [first, second] = await both;
    expect(first).toEqual(second);
    expect(authority.minted).toHaveLength(1);
  });

  it("mints again after a failed attempt — a failure is not an answer", async () => {
    const authority = fakeAuthority();
    authority.mintResult = async () => {
      throw shellUnavailable();
    };
    const { surfaces } = service(authority);
    const ctx = windowContext(["surface.attach", "surface.browser"]);
    await refusal(surfaces.open(ctx, { source: BROWSER_SOURCE, idempotencyKey: "k" }));
    authority.mintResult = async () => ({ surfaceId: `${SURFACE_ID}9`, ticket: TICKET });
    const retried = await surfaces.open(ctx, { source: BROWSER_SOURCE, idempotencyKey: "k" });
    expect(retried.surfaceId).toBe(`${SURFACE_ID}9`);
    expect(authority.minted).toHaveLength(2);
  });

  it("never replays another window's answer", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const params = { source: BROWSER_SOURCE, idempotencyKey: "k" };
    const first = await surfaces.open(windowContext(["surface.attach", "surface.browser"]), params);
    const other = await surfaces.open(
      windowContext(["surface.attach", "surface.browser"], {
        participantId: "win-2",
        incarnation: "gen-1",
      }),
      params,
    );
    // Same token, same key, different window: two surfaces, not one shared one.
    expect(other.surfaceId).not.toBe(first.surfaceId);
    expect(authority.minted).toHaveLength(2);
  });

  it("mints per request when no key is given", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const ctx = windowContext(["surface.attach", "surface.browser"]);
    const first = await surfaces.open(ctx, { source: BROWSER_SOURCE });
    const second = await surfaces.open(ctx, { source: BROWSER_SOURCE });
    expect(second.surfaceId).not.toBe(first.surfaceId);
    expect(authority.minted).toHaveLength(2);
  });
});

describe("SurfaceService.close", () => {
  it("releases with the caller's own participant and reports the outcome", async () => {
    const authority = fakeAuthority();
    const { surfaces, audit } = service(authority);
    const result = await surfaces.close(windowContext(["surface.attach"]), {
      surfaceId: SURFACE_ID,
    });
    expect(result).toEqual({ closed: true });
    expect(authority.released).toEqual([
      { surfaceId: SURFACE_ID, rendererParticipant: PARTICIPANT },
    ]);
    expect(audit.rows.map((row) => [row.action, row.phase, row.targetId])).toEqual([
      ["surface.close", "attempt", SURFACE_ID],
      ["surface.close", "outcome", SURFACE_ID],
    ]);
    expect(audit.rows[1]?.attrs).toEqual({ closed: true });
  });

  it("answers { closed: false } for an unknown surface instead of an error", async () => {
    const authority = fakeAuthority();
    authority.releaseResult = async () => ({ released: false });
    const { surfaces, audit } = service(authority);
    const result = await surfaces.close(windowContext(["surface.attach"]), {
      surfaceId: SURFACE_ID,
    });
    expect(result).toEqual({ closed: false });
    expect(audit.rows[1]).toMatchObject({ outcome: "succeeded" });
    expect(audit.rows[1]?.attrs).toEqual({ closed: false });
  });

  it("requires the same local-window binding as open", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.close(agentContext(["surface.attach"]), { surfaceId: SURFACE_ID }),
    );
    expect(error.kind).toBe("FORBIDDEN_SCOPE");
    expect(error.message).toMatch(/attach only to a local renderer window/);
    expect(authority.released).toEqual([]);
  });
});

describe("SurfaceService — UNAVAILABLE pass-through", () => {
  it("renames the shell's provider-loss as the surfaces authority on open", async () => {
    const authority = fakeAuthority();
    authority.mintResult = async () => {
      throw shellUnavailable();
    };
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
        source: BROWSER_SOURCE,
      }),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ service: "surfaces", state: "authority-unavailable" });
  });

  it("does the same on close", async () => {
    const authority = fakeAuthority();
    authority.releaseResult = async () => {
      throw shellUnavailable();
    };
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.close(windowContext(["surface.attach"]), { surfaceId: SURFACE_ID }),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "surfaces", state: "authority-unavailable" });
  });

  it("passes a non-UNAVAILABLE door failure through untouched", async () => {
    const authority = fakeAuthority();
    authority.mintResult = async () => {
      throw new RpcCallError("TIMEOUT", "shell.surfaces.mint timed out", true, {
        service: "shell",
        state: "timeout",
      });
    };
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
        source: BROWSER_SOURCE,
      }),
    );
    expect(error.kind).toBe("TIMEOUT");
    expect(error.details).toEqual({ service: "shell", state: "timeout" });
  });
});
