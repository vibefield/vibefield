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
  ShellSurfacesSimulatorDevicesParams,
  ShellSurfacesSimulatorDevicesResult,
} from "@vibefield/contracts";
import {
  BROWSER_DESK_PROFILE_REF,
  PAGES_RUN_PROFILE_PREFIX,
  SHELL_SURFACES_MADE_CLOSED,
  SHELL_SURFACES_SERVICE,
} from "@vibefield/contracts";
import type { AuditPhaseV1 } from "@vibefield/contracts/diagnostics";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import type { AuditMutation, AuditMutationOutcome } from "../src/audit-service";
import { RpcCallError } from "../src/native-link";
import {
  createSurfaceService,
  type SurfaceAuthority,
  type SurfaceMadePanes,
} from "../src/surface-service";
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

/** PT-S2 (R1): a phone on the desk asks for its device by its binding — never a UDID. */
const PHONE_SOURCE: LiveSurfaceSourceSpecV1 = {
  kind: "ios-simulator-device",
  binding: {
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
  },
  crop: { mode: "auto" },
};

/** PT-S2 (R11): one of main's redacted device rows. */
const DEVICE_ROW: ShellSurfacesSimulatorDevicesResult["devices"][number] = {
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
  name: "iPhone 17 Pro",
  booted: true,
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
  listed: ShellSurfacesSimulatorDevicesParams[];
  sources: ShellSurfacesEnumerateResult["sources"];
  devices: ShellSurfacesSimulatorDevicesResult["devices"];
  /** the runtimes main says are installed (undefined: unsaid) */
  runtimes?: ShellSurfacesSimulatorDevicesResult["runtimes"];
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
    listed: [],
    sources: [],
    devices: [],
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
    async surfacesSimulatorDevices(params) {
      authority.listed.push(params);
      if (!authority.available) throw shellUnavailable();
      return {
        devices: authority.devices,
        ...(authority.runtimes === undefined ? {} : { runtimes: authority.runtimes }),
      };
    },
  };
  return authority;
}

function service(authority: FakeAuthority, audit = fakeAudit(), made?: SurfaceMadePanes) {
  const options = made === undefined ? { api: authority, audit } : { api: authority, audit, made };
  return { surfaces: createSurfaceService(options), audit };
}

/** EY-2 (the made path) — the pages room, as the panes it placed, and what it was asked. */
function madePanes(...placed: string[]) {
  const asked: string[] = [];
  const panes: SurfaceMadePanes = {
    placed: (surfaceId) => {
      asked.push(surfaceId);
      return placed.includes(surfaceId);
    },
  };
  return { panes, asked };
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

  it("PT-S2 (R1); item 569: a Simulator bound by its device type and runtime costs the simulator scope — at its default crop, the device's own display, whatever main resolves it to", async () => {
    const authority = fakeAuthority();
    const { surfaces, audit } = service(authority);
    const refused = await refusal(
      surfaces.open(windowContext(["surface.attach", "surface.browser"]), {
        source: PHONE_SOURCE,
        reuseKey: "desk:phone-1",
      }),
    );
    expect(refused.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.details).toEqual({ required: "surface.simulator" });
    expect(authority.minted).toEqual([]);

    const opened = await surfaces.open(windowContext(["surface.attach", "surface.simulator"]), {
      source: PHONE_SOURCE,
      reuseKey: "desk:phone-1",
    });
    expect(opened.surfaceId).toBe(`${SURFACE_ID}1`);
    // the binding crosses fieldd verbatim, with the desk object's continuity key
    expect(authority.minted).toEqual([
      { rendererParticipant: PARTICIPANT, source: PHONE_SOURCE, reuseKey: "desk:phone-1" },
    ]);
    // the ledger learns the kind, never the binding
    const attempt = audit.rows.find((row) => row.phase === "attempt" && row.attrs["sourceKind"]);
    expect(attempt?.attrs).toEqual({
      sourceKind: "ios-simulator-device",
      participantId: "win-1",
      incarnation: "gen-1",
    });
    expect(JSON.stringify(audit.rows)).not.toContain("SimDeviceType");
  });

  it("item 569: the capture scope opens no device-bound Simulator — that costs a scope of its own", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const refused = await refusal(
      surfaces.open(windowContext(["surface.attach", "surface.capture"]), {
        source: PHONE_SOURCE,
        reuseKey: "desk:phone-1",
      }),
    );
    expect(refused.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.details).toEqual({ required: "surface.simulator" });
    expect(authority.minted).toEqual([]);
  });

  it("item 569: a device-bound Simulator at a crop other than `auto` costs the capture scope as well — it is the Simulator app's window", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const crops = [
      { mode: "none" },
      { mode: "explicit", sourceRect: { x: 0, y: 0, width: 10, height: 10 } },
    ] as const;
    for (const crop of crops) {
      const refused = await refusal(
        surfaces.open(windowContext(["surface.attach", "surface.simulator"]), {
          source: { ...PHONE_SOURCE, crop },
        }),
      );
      expect(refused.kind).toBe("FORBIDDEN_SCOPE");
      expect(refused.details).toEqual({ required: "surface.capture" });
    }
    expect(authority.minted).toEqual([]);
    const ctx = windowContext(["surface.attach", "surface.simulator", "surface.capture"]);
    await surfaces.open(ctx, { source: { ...PHONE_SOURCE, crop: { mode: "none" } } });
    expect(authority.minted).toHaveLength(1);
  });

  it("item 569: the simulator scope opens no other app's window and no UDID-keyed Simulator — those stay the capture scope's", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    for (const source of [SCK_SOURCE, SIM_SOURCE]) {
      const error = await refusal(
        surfaces.open(windowContext(["surface.attach", "surface.simulator"]), { source }),
      );
      expect(error.kind).toBe("FORBIDDEN_SCOPE");
      expect(error.details).toEqual({ required: "surface.capture" });
    }
    expect(authority.minted).toEqual([]);
  });
});

describe("SurfaceService.simulatorDevices — PT-S2 (R11), the attach's device list", () => {
  it("passes main's redacted rows through, asking main nothing", async () => {
    const authority = fakeAuthority();
    authority.devices = [
      DEVICE_ROW,
      {
        deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
        name: "iPhone 17",
        booted: false,
      },
    ];
    const { surfaces, audit } = service(authority);
    const result = await surfaces.simulatorDevices(windowContext(["surface.simulator"]), {});
    expect(result.devices).toEqual(authority.devices);
    expect(authority.listed).toEqual([{}]);
    // a bare call asks the same nothing
    await surfaces.simulatorDevices(windowContext(["surface.simulator"]), undefined);
    expect(authority.listed).toEqual([{}, {}]);
    // a read: nothing is audited, nothing is minted
    expect(audit.rows).toEqual([]);
    expect(authority.minted).toEqual([]);
  });

  it("carries main's installed runtimes through, the newest first — the attach's third pick, even with no device here", async () => {
    const authority = fakeAuthority();
    authority.runtimes = [
      "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
      "com.apple.CoreSimulator.SimRuntime.iOS-18-6",
    ];
    const { surfaces } = service(authority);
    const result = await surfaces.simulatorDevices(windowContext(["surface.simulator"]), {});
    expect(result).toEqual({ devices: [], runtimes: authority.runtimes });
    // one that is not CoreSimulator's runtime id is refused at this door, as a row with a UDID is
    authority.runtimes = ["ABCDEF01-2345-6789-ABCD-EF0123456789"];
    await expect(
      surfaces.simulatorDevices(windowContext(["surface.simulator"]), {}),
    ).rejects.toThrow();
  });

  it("needs no window: a list binds nothing, so a caller with no renderer participant is answered too", async () => {
    const authority = fakeAuthority();
    authority.devices = [DEVICE_ROW];
    const { surfaces } = service(authority);
    const result = await surfaces.simulatorDevices(agentContext(["surface.simulator"]), {});
    expect(result.devices).toEqual([DEVICE_ROW]);
  });

  it("answers UNAVAILABLE for surfaces when the authority is absent, before the door", async () => {
    const authority = fakeAuthority();
    authority.available = false;
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.simulatorDevices(windowContext(["surface.simulator"]), {}),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ service: "surfaces", state: "authority-unavailable" });
    expect(authority.listed).toEqual([]);
  });

  it("renames the shell's provider-loss mid-call as the surfaces authority", async () => {
    const authority = fakeAuthority();
    authority.surfacesSimulatorDevices = async () => {
      throw shellUnavailable();
    };
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.simulatorDevices(windowContext(["surface.simulator"]), {}),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "surfaces", state: "authority-unavailable" });
  });

  it("refuses params that are not an object", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const error = await refusal(
      surfaces.simulatorDevices(windowContext(["surface.simulator"]), "devices"),
    );
    expect(error.kind).toBe("PRECONDITION_FAILED");
    expect(authority.listed).toEqual([]);
  });

  it("never hands on a row that carries a UDID: main's redaction is re-checked at this door", async () => {
    const authority = fakeAuthority();
    authority.devices = [
      {
        ...DEVICE_ROW,
        udid: "ABCDEF01-2345-6789-ABCD-EF0123456789",
      } as unknown as typeof DEVICE_ROW,
    ];
    const { surfaces } = service(authority);
    await expect(
      surfaces.simulatorDevices(windowContext(["surface.simulator"]), {}),
    ).rejects.toThrow();
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

describe("SurfaceService.open — a made pane (EY-2, the made path)", () => {
  const MADE = "srf_01ARZ3NDEKTSV4RRMADE1";
  /** main's words for a made pane that is gone for good (EY-1's row-4 seam), which fieldd says too */
  const GONE = { service: SHELL_SURFACES_SERVICE, state: SHELL_SURFACES_MADE_CLOSED };
  const ctx = () => windowContext(["surface.attach", "surface.browser"]);

  it("forwards made to main's mint for a pane the pages room placed, beside the source and the reuse key", async () => {
    const authority = fakeAuthority();
    const { panes, asked } = madePanes(MADE);
    const { surfaces } = service(authority, fakeAudit(), panes);
    await surfaces.open(ctx(), { source: BROWSER_SOURCE, reuseKey: "desk:made-1", made: MADE });
    expect(asked).toEqual([MADE]);
    expect(authority.minted).toEqual([
      {
        rendererParticipant: PARTICIPANT,
        source: BROWSER_SOURCE,
        reuseKey: "desk:made-1",
        made: MADE,
      },
    ]);
  });

  it("refuses a made pane the pages room does not hold as gone for good, before the ledger or main", async () => {
    const authority = fakeAuthority();
    const { panes } = madePanes();
    const { surfaces, audit } = service(authority, fakeAudit(), panes);
    const err = await refusal(surfaces.open(ctx(), { source: BROWSER_SOURCE, made: MADE }));
    expect(err.kind).toBe("PRECONDITION_FAILED");
    expect(err.details).toEqual(GONE);
    expect(authority.minted).toEqual([]);
    expect(audit.rows).toEqual([]);
  });

  it("refuses made the same way, gone for good, when no pages room answers", async () => {
    const authority = fakeAuthority();
    const { surfaces } = service(authority);
    const err = await refusal(surfaces.open(ctx(), { source: BROWSER_SOURCE, made: MADE }));
    expect(err.kind).toBe("PRECONDITION_FAILED");
    expect(err.details).toEqual(GONE);
    expect(authority.minted).toEqual([]);
  });

  it("an open naming no made pane never asks the room, and mints as before", async () => {
    const authority = fakeAuthority();
    const { panes, asked } = madePanes(MADE);
    const { surfaces } = service(authority, fakeAudit(), panes);
    await surfaces.open(ctx(), { source: BROWSER_SOURCE });
    expect(asked).toEqual([]);
    expect(authority.minted[0]).not.toHaveProperty("made");
  });

  it("main's refusal of a made pane it closed reaches the caller with its details whole", async () => {
    const authority = fakeAuthority();
    // a guard: green before this piece too
    authority.mintResult = async () => {
      throw new RpcCallError("PRECONDITION_FAILED", "the desktop operation failed", false, GONE);
    };
    const { panes } = madePanes(MADE);
    const { surfaces } = service(authority, fakeAudit(), panes);
    const err = await refusal(surfaces.open(ctx(), { source: BROWSER_SOURCE, made: MADE }));
    expect(err.kind).toBe("PRECONDITION_FAILED");
    expect(err.details).toEqual(GONE);
  });

  it("the attempt says it adopts a made pane, beside the kind and the window", async () => {
    const authority = fakeAuthority();
    const { panes } = madePanes(MADE);
    const { surfaces, audit } = service(authority, fakeAudit(), panes);
    await surfaces.open(ctx(), { source: BROWSER_SOURCE, made: MADE });
    expect(audit.rows[0]?.attrs).toEqual({
      sourceKind: "browser",
      participantId: "win-1",
      incarnation: "gen-1",
      adopts: true,
    });
  });

  it("a refused made pane is logged by its codes alone, never its surface or its address", async () => {
    const said: { event: string; attrs: unknown }[] = [];
    const logger: Logger = {
      child: () => logger,
      trace: () => undefined,
      debug: () => undefined,
      info: (event, _message, attrs) => void said.push({ event, attrs }),
      warn: (event, _message, attrs) => void said.push({ event, attrs }),
      error: (event, _message, _error, attrs) => void said.push({ event, attrs }),
      fatal: () => undefined,
      isLevelEnabled: () => true,
    };
    const { panes } = madePanes();
    const surfaces = createSurfaceService({
      api: fakeAuthority(),
      audit: fakeAudit(),
      logger,
      made: panes,
    });
    await refusal(surfaces.open(ctx(), { source: BROWSER_SOURCE, made: MADE }));
    expect(said).toEqual([
      { event: "fieldd.surfaces.made_refused", attrs: { sourceKind: "browser" } },
    ]);
    expect(JSON.stringify(said)).not.toContain(MADE);
    expect(JSON.stringify(said)).not.toContain("example.invalid");
  });
});

// A run's pane after its run (2026-11-24) — a pane the pages room placed names its run, and its window mints into that
// run's own session at every open. Once the run can be served no page (it ended and no resume carried its pages on;
// fieldd restarted; no fieldd here ever had it), main, started anew, knows nothing of the run and refuses the mint with
// no word, so the pane stood on a failure for good. fieldd says the word first: closed for good.
describe("SurfaceService.open — a mint into a run's session (a run's pane after its run, 2026-11-24)", () => {
  const RUN = "run-01J8Z3K9";
  const RUN_SOURCE: LiveSurfaceSourceSpecV1 = {
    ...BROWSER_SOURCE,
    profile: { mode: "memory", ref: `${PAGES_RUN_PROFILE_PREFIX}${RUN}` },
  };
  const DESK_SOURCE: LiveSurfaceSourceSpecV1 = {
    ...BROWSER_SOURCE,
    profile: { mode: "persistent", ref: BROWSER_DESK_PROFILE_REF },
  };
  const GONE = { service: SHELL_SURFACES_SERVICE, state: SHELL_SURFACES_MADE_CLOSED };
  const ctx = () => windowContext(["surface.attach", "surface.browser"]);
  /** The pages room, as the runs it can still serve a page, and which it was asked about. */
  function runsServed(...served: string[]) {
    const asked: string[] = [];
    const panes: SurfaceMadePanes = {
      placed: () => false,
      serves: (run) => {
        asked.push(run);
        return served.includes(run);
      },
    };
    return { panes, asked };
  }

  it("refuses the mint as closed for good when the room serves the run no page, before the ledger or main", async () => {
    const authority = fakeAuthority();
    const { panes, asked } = runsServed();
    const { surfaces, audit } = service(authority, fakeAudit(), panes);
    const err = await refusal(surfaces.open(ctx(), { source: RUN_SOURCE, reuseKey: "desk:k1" }));
    expect(asked).toEqual([RUN]);
    expect(err.kind).toBe("PRECONDITION_FAILED");
    expect(err.details).toEqual(GONE);
    expect(authority.minted).toEqual([]);
    expect(audit.rows).toEqual([]);
  });

  it("waits for the room's word when it is not ready yet (a mint before the boot's settle), and then holds to it", async () => {
    const authority = fakeAuthority();
    let say: (served: boolean) => void = () => undefined;
    const panes: SurfaceMadePanes = {
      placed: () => false,
      serves: () =>
        new Promise<boolean>((resolve) => {
          say = resolve;
        }),
    };
    const { surfaces } = service(authority, fakeAudit(), panes);
    const opening = refusal(surfaces.open(ctx(), { source: RUN_SOURCE, reuseKey: "desk:k1" }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(authority.minted).toEqual([]);
    say(false);
    expect((await opening).details).toEqual(GONE);
    expect(authority.minted).toEqual([]);
  });

  it("forwards the mint of a run the room serves: main decides it by its key", async () => {
    const authority = fakeAuthority();
    const { panes } = runsServed(RUN);
    const { surfaces } = service(authority, fakeAudit(), panes);
    await surfaces.open(ctx(), { source: RUN_SOURCE, reuseKey: "desk:k1" });
    expect(authority.minted).toEqual([
      { rendererParticipant: PARTICIPANT, source: RUN_SOURCE, reuseKey: "desk:k1" },
    ]);
  });

  it("never asks about the person's own page, nor a memory profile that is no run's: both mint as before", async () => {
    const authority = fakeAuthority();
    const { panes, asked } = runsServed();
    const { surfaces } = service(authority, fakeAudit(), panes);
    await surfaces.open(ctx(), { source: DESK_SOURCE, reuseKey: "desk:mine" });
    await surfaces.open(ctx(), { source: BROWSER_SOURCE, reuseKey: "desk:scratch" });
    expect(asked).toEqual([]);
    expect(authority.minted.map((mint) => mint.reuseKey)).toEqual(["desk:mine", "desk:scratch"]);
  });

  it("a made pane the room placed is forwarded on that word alone: its run is not asked about again", async () => {
    const MADE = "srf_01ARZ3NDEKTSV4RRMADE2";
    const authority = fakeAuthority();
    const asked: string[] = [];
    const panes: SurfaceMadePanes = {
      placed: (surfaceId) => surfaceId === MADE,
      serves: (run) => {
        asked.push(run);
        return false;
      },
    };
    const { surfaces } = service(authority, fakeAudit(), panes);
    await surfaces.open(ctx(), { source: RUN_SOURCE, reuseKey: "desk:k1", made: MADE });
    expect(asked).toEqual([]);
    expect(authority.minted).toHaveLength(1);
  });

  it("with no pages room, or a room that does not say, the mint is forwarded and main's own word stands", async () => {
    const bare = fakeAuthority();
    await service(bare).surfaces.open(ctx(), { source: RUN_SOURCE, reuseKey: "desk:k1" });
    expect(bare.minted).toHaveLength(1);
    const silent = fakeAuthority();
    const { surfaces } = service(silent, fakeAudit(), { placed: () => false });
    await surfaces.open(ctx(), { source: RUN_SOURCE, reuseKey: "desk:k1" });
    expect(silent.minted).toHaveLength(1);
  });

  it("the refusal is logged by its codes alone: never the run, the key or the address", async () => {
    const said: { event: string; attrs: unknown }[] = [];
    const logger: Logger = {
      child: () => logger,
      trace: () => undefined,
      debug: () => undefined,
      info: (event, _message, attrs) => void said.push({ event, attrs }),
      warn: (event, _message, attrs) => void said.push({ event, attrs }),
      error: (event, _message, _error, attrs) => void said.push({ event, attrs }),
      fatal: () => undefined,
      isLevelEnabled: () => true,
    };
    const surfaces = createSurfaceService({
      api: fakeAuthority(),
      audit: fakeAudit(),
      logger,
      made: runsServed().panes,
    });
    await refusal(surfaces.open(ctx(), { source: RUN_SOURCE, reuseKey: "desk:k1" }));
    expect(said).toEqual([
      { event: "fieldd.surfaces.run_session_closed", attrs: { sourceKind: "browser" } },
    ]);
    expect(JSON.stringify(said)).not.toContain(RUN);
    expect(JSON.stringify(said)).not.toContain("example.invalid");
  });
});
