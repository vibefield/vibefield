// @vitest-environment happy-dom
import type { GhostteaTerminalRuntime, RoutedTerminalInputContext } from "@vibecook/ghosttea-react";
import { SendInput, type TerminalOpenTicket } from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { describe, expect, it, vi } from "vitest";
import { createRoutedTerminalHost, ROUTED_CLIENT_CAPABILITIES } from "../src/terminal/routed/host";

const summary = {
  id: "sess-1",
  handle: "1",
  executable: "/bin/zsh",
  cols: 80,
  rows: 24,
  exited: false,
  readWrite: true,
  title: null,
  cwd: "/Users/test",
  bellCount: 0,
  pid: 123,
  createdAtMs: 1_000,
  exitCode: null,
  exitSignal: null,
  requestedTermination: null,
  exitOutcome: null,
  ownerId: null,
  persistence: "keep-until-exit" as const,
  activity: {
    kind: "unknown" as const,
    source: "unsupported" as const,
    confidence: "heuristic" as const,
    rootProcessGroupId: null,
    foregroundProcessGroupId: null,
    observedAtMs: 1_000,
  },
};

function ticket(): TerminalOpenTicket {
  const cellBootId = "cell-a-boot-1";
  return {
    route: { cellBootId, routeRevision: 3, leaseEpoch: 7 },
    // REQUIRED since TP-S3e — a ticket without doors is not a ticket.
    endpoints: {
      controlUrl: "ws://127.0.0.1:43101/control",
      framesUrl: "ws://127.0.0.1:43101/frames",
    },
    transportGrant: {
      protected: {
        v: 1,
        typ: "CellTransportGrant",
        iss: "fieldd",
        alg: "HS256",
        kid: { cellBootId, keyGeneration: 1 },
      },
      claims: {
        audienceCellBootId: cellBootId,
        clientId: "renderer-1",
        connectionSetId: "connection-1",
        allowedChannels: ["control", "frames"],
        transportGrantGeneration: 2,
        issuedAt: 1_000,
        expiresAt: 61_000,
        nonce: "nonce-1",
      },
      mac: "bWFj",
    },
    attachGrant: {
      protected: {
        v: 1,
        typ: "SessionAttachGrant",
        iss: "fieldd",
        alg: "HS256",
        kid: { cellBootId, keyGeneration: 1 },
      },
      claims: {
        audienceCellBootId: cellBootId,
        clientId: "renderer-1",
        sessionId: "sess-1",
        leaseEpoch: 7,
        routeRevision: 3,
        grantGeneration: 5,
        rights: ["input", "read"],
        issuedAt: 1_000,
        expiresAt: 61_000,
      },
      mac: "bWFj",
    },
  };
}

function inputContext(activationId: string, viewId = "view-1"): RoutedTerminalInputContext {
  return {
    sessionId: "sess-1",
    viewId,
    activationId,
    leaseEpoch: 7,
    inputSequence: 99,
    operation: { kind: "text", text: "x" },
  };
}

function sequenceOf(
  binding: ReturnType<typeof createRoutedTerminalHost>,
  activationId: string,
): number {
  const encoded = binding.host.encodeInput?.(inputContext(activationId));
  return SendInput.parse(encoded).inputSequence;
}

describe("createRoutedTerminalHost — the G23 product adapter", () => {
  it("maps every supported product verb and carries exact engine summaries", async () => {
    const opened = ticket();
    const renewed = { attachGrant: { ...opened.attachGrant } };
    const requests = vi.fn(async (method: string) => {
      if (method === "terminal.openTicket") return opened;
      if (method === "terminal.renewAttach") return renewed;
      if (method === "terminal.sessions") return { sessions: [summary] };
      if (method === "terminal.terminate") return { terminated: true };
      throw new Error(`unexpected ${method}`);
    });
    const onTicket = vi.fn();
    const onTerminated = vi.fn();
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
      onTicket,
      onTerminated,
    });

    await expect(binding.host.openTicket("sess-1", { reason: "mount" })).resolves.toEqual(opened);
    await expect(
      binding.host.renewAttach?.({
        sessionId: "sess-1",
        expectGeneration: 5,
        requestId: "renew-1",
      }),
    ).resolves.toEqual(renewed);
    await expect(binding.host.listSessions?.()).resolves.toEqual([summary]);
    await expect(binding.host.terminate?.("sess-1", "user")).resolves.toBeUndefined();

    expect(onTicket).toHaveBeenCalledWith("sess-1", opened);
    expect(onTerminated).toHaveBeenCalledWith("sess-1");
    expect(requests.mock.calls.map(([method]) => method)).toEqual([
      "terminal.openTicket",
      "terminal.renewAttach",
      "terminal.sessions",
      "terminal.terminate",
    ]);
    // Birth remains the product workspace's audited `terminal.create` path;
    // accepting Ghosttea's lower-level CreateSessionOptions here would bypass it.
    expect(binding.host.createSession).toBeUndefined();
  });

  it("fails closed on a legacy ticket or a routed ticket with no cell doors", async () => {
    const fieldd = (answer: unknown) =>
      ({
        request: vi.fn(async () => answer),
      }) as unknown as FielddClient;

    // TP-S3e: both non-routed answers (the retired legacy trio; a ticket with
    // no doors) refuse at the schema — a compliant fieldd answers UNAVAILABLE
    // upstream instead, so reaching either here is a contract break.
    await expect(
      createRoutedTerminalHost({
        fieldd: fieldd({ controlSocket: "/tmp/control", frameSocket: "/tmp/frames", token: "t" }),
      }).host.openTicket("sess-1"),
    ).rejects.toThrow("does not carry the routed contract");
    const { endpoints: _doors, ...doorless } = ticket();
    await expect(
      createRoutedTerminalHost({ fieldd: fieldd(doorless) }).host.openTicket("sess-1"),
    ).rejects.toThrow("does not carry the routed contract");
  });

  it("waits through the explicit unobserved state before Workspace takes its one list", async () => {
    let calls = 0;
    const binding = createRoutedTerminalHost({
      fieldd: {
        request: vi.fn(async (method: string) => {
          if (method !== "terminal.sessions") throw new Error(`unexpected ${method}`);
          calls += 1;
          if (calls === 1) {
            throw new FielddRpcError(
              "UNAVAILABLE",
              "the terminal inventory has not been observed",
              true,
              { service: "terminal", state: "unobserved" },
            );
          }
          return { sessions: [summary] };
        }),
      } as unknown as FielddClient,
    });

    await expect(binding.host.listSessions?.()).resolves.toEqual([summary]);
    expect(calls).toBe(2);
  });

  it("refuses a primed ticket whose attach grant names another session", () => {
    const binding = createRoutedTerminalHost({
      fieldd: { request: vi.fn() } as unknown as FielddClient,
    });
    const crossed = ticket();
    crossed.attachGrant.claims.sessionId = "sess-other";

    expect(() => binding.primeTicket("sess-1", crossed)).toThrow("names a different session");
  });

  it("releases activation-scoped input on replacement, end, termination, and owner disposal", async () => {
    const requests = vi.fn(async (method: string) => {
      if (method === "terminal.terminate") return { terminated: true };
      throw new Error(`unexpected ${method}`);
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });
    const runtime = new EventTarget();
    binding.bind(runtime as GhostteaTerminalRuntime);

    const transition = (activationId: string, phase = "presenting") => {
      runtime.dispatchEvent(
        new CustomEvent("routed-activation-state", {
          detail: {
            sessionId: "sess-1",
            previous: { activationId, phase },
            current: { activationId, phase },
          },
        }),
      );
    };

    transition("act-1");
    expect(sequenceOf(binding, "act-1")).toBe(1);
    const secondView = binding.host.encodeInput?.(inputContext("act-1", "view-2"));
    expect(SendInput.parse(secondView).inputSequence).toBe(2);

    transition("act-2");
    expect(sequenceOf(binding, "act-2")).toBe(1);
    transition("act-2", "ended");
    expect(sequenceOf(binding, "act-2")).toBe(1);

    await binding.host.terminate?.("sess-1", "application");
    expect(sequenceOf(binding, "act-2")).toBe(1);

    expect(() => binding.bind(new EventTarget() as GhostteaTerminalRuntime)).toThrow(
      "cannot bind two runtimes",
    );
    binding.dispose();
    expect(binding.host.encodeInput?.(inputContext("act-3"))).toBeNull();
    expect(() => binding.bind(runtime as GhostteaTerminalRuntime)).toThrow("disposed");
  });

  it("releases input but preserves product records when termination refuses", async () => {
    const onTerminated = vi.fn();
    const binding = createRoutedTerminalHost({
      fieldd: {
        request: vi.fn(async () => {
          throw new Error("floor unavailable");
        }),
      } as unknown as FielddClient,
      onTerminated,
    });

    expect(sequenceOf(binding, "act-1")).toBe(1);
    await expect(binding.host.terminate?.("sess-1", "user")).rejects.toThrow("floor unavailable");
    expect(onTerminated).not.toHaveBeenCalled();
    expect(sequenceOf(binding, "act-1")).toBe(1);
  });
});

describe("createRoutedTerminalHost — TP-S3f routed session events (G24)", () => {
  const context = {
    cellBootId: "cell-a-boot-1",
    connectionSetId: "connection-1",
    channel: "control" as const,
  };

  function ticketFor(sessionId: string, cellBootId: string): TerminalOpenTicket {
    const t = ticket();
    t.route.cellBootId = cellBootId;
    t.attachGrant.claims.sessionId = sessionId;
    return t;
  }

  function runtimeStub() {
    const applySessionEvent = vi.fn();
    const runtime = Object.assign(new EventTarget(), { applySessionEvent });
    return { runtime: runtime as unknown as GhostteaTerminalRuntime, applySessionEvent };
  }

  it("advertises resume plus the load-bearing session-events capability", () => {
    expect(ROUTED_CLIENT_CAPABILITIES).toEqual(["resume", "session-events"]);
  });

  it("coalesces concurrent getSession reads into one inventory snapshot", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const requests = vi.fn((method: string) => {
      if (method !== "terminal.sessions") throw new Error(`unexpected ${method}`);
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });

    // N panes refreshing in the same turn cost ONE wire read…
    const first = binding.host.getSession?.("sess-1");
    const second = binding.host.getSession?.("sess-absent");
    expect(requests).toHaveBeenCalledTimes(1);
    resolvers[0]?.({ sessions: [summary] });
    await expect(first).resolves.toEqual(summary);
    // …absence is `null` (no update), never an invented removal…
    await expect(second).resolves.toBeNull();

    // …and a read AFTER settle is a fresh snapshot, not a stale cache.
    const third = binding.host.getSession?.("sess-1");
    expect(requests).toHaveBeenCalledTimes(2);
    resolvers[1]?.({ sessions: [summary] });
    await expect(third).resolves.toEqual(summary);
  });

  it("a rejected inventory read rejects the turn and the next turn retries fresh", async () => {
    let calls = 0;
    const binding = createRoutedTerminalHost({
      fieldd: {
        request: vi.fn(async () => {
          calls += 1;
          if (calls === 1) throw new Error("floor unavailable");
          return { sessions: [summary] };
        }),
      } as unknown as FielddClient,
    });

    await expect(binding.host.getSession?.("sess-1")).rejects.toThrow("floor unavailable");
    await expect(binding.host.getSession?.("sess-1")).resolves.toEqual(summary);
  });

  it("applies exited and removed through the runtime door, custody-checked", () => {
    const binding = createRoutedTerminalHost({
      fieldd: { request: vi.fn() } as unknown as FielddClient,
    });
    const { runtime, applySessionEvent } = runtimeStub();
    binding.bind(runtime);
    binding.primeTicket("sess-1", ticket());

    const exited = {
      type: "SessionEvent",
      event: {
        kind: "exited",
        sessionId: "sess-1",
        exitCode: null,
        exitSignal: "SIGHUP",
        requestedTermination: "user",
        exitOutcome: "user-terminated",
      },
    };
    binding.host.onExtensionMessage?.(exited, context);
    expect(applySessionEvent).toHaveBeenCalledWith({
      type: "exited",
      sessionId: "sess-1",
      exitCode: null,
      exitSignal: "SIGHUP",
      requestedTermination: "user",
      exitOutcome: "user-terminated",
    });

    // A cell may only speak for sessions whose ticket named it.
    binding.host.onExtensionMessage?.(exited, { ...context, cellBootId: "cell-b-boot-9" });
    expect(applySessionEvent).toHaveBeenCalledTimes(1);

    // A session this window never ticketed passes through: the deck tracks
    // roster sessions it never attached, and the runtime ignores unknown ids.
    binding.host.onExtensionMessage?.(
      {
        type: "SessionEvent",
        event: {
          kind: "exited",
          sessionId: "sess-foreign",
          exitCode: 1,
          exitSignal: null,
          requestedTermination: null,
          exitOutcome: "crashed",
        },
      },
      { ...context, cellBootId: "cell-b-boot-9" },
    );
    expect(applySessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "exited", sessionId: "sess-foreign" }),
    );

    // A removal AFTER the observed exit applies immediately — the intended
    // order needs no hold.
    binding.host.onExtensionMessage?.(
      { type: "SessionEvent", event: { kind: "removed", sessionId: "sess-1" } },
      context,
    );
    expect(applySessionEvent).toHaveBeenCalledWith({ type: "removed", sessionId: "sess-1" });
  });

  it("holds a removed that outran its exited, restoring the intended order (the verb-kill shape)", () => {
    vi.useFakeTimers();
    try {
      const binding = createRoutedTerminalHost({
        fieldd: { request: vi.fn() } as unknown as FielddClient,
      });
      const { runtime, applySessionEvent } = runtimeStub();
      binding.bind(runtime);

      // A verb-driven kill publishes Removed at the verb and Exited only when
      // the child dies — the wire legitimately inverts the pair. Applying the
      // removal first would unregister the session and turn the following
      // exit into a no-op, so the hold keeps the face's facts first.
      binding.host.onExtensionMessage?.(
        { type: "SessionEvent", event: { kind: "removed", sessionId: "sess-1" } },
        context,
      );
      expect(applySessionEvent).not.toHaveBeenCalled();
      binding.host.onExtensionMessage?.(
        {
          type: "SessionEvent",
          event: {
            kind: "exited",
            sessionId: "sess-1",
            exitCode: null,
            exitSignal: "SIGHUP",
            requestedTermination: "user",
            exitOutcome: "user-terminated",
          },
        },
        context,
      );
      expect(applySessionEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ type: "exited", sessionId: "sess-1" }),
      );
      expect(applySessionEvent).toHaveBeenNthCalledWith(2, {
        type: "removed",
        sessionId: "sess-1",
      });

      // A removal with truly no exit (an explicit close) applies at the bound.
      binding.host.onExtensionMessage?.(
        { type: "SessionEvent", event: { kind: "removed", sessionId: "sess-2" } },
        context,
      );
      expect(applySessionEvent).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(10_000);
      expect(applySessionEvent).toHaveBeenCalledWith({ type: "removed", sessionId: "sess-2" });

      // Disposal cancels a pending hold rather than firing it late.
      binding.host.onExtensionMessage?.(
        { type: "SessionEvent", event: { kind: "removed", sessionId: "sess-3" } },
        context,
      );
      binding.dispose();
      vi.advanceTimersByTime(20_000);
      expect(applySessionEvent).not.toHaveBeenCalledWith({ type: "removed", sessionId: "sess-3" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops what it cannot place — wrong tag, malformed body, a future kind — without closing anything", () => {
    const binding = createRoutedTerminalHost({
      fieldd: { request: vi.fn() } as unknown as FielddClient,
    });
    const { runtime, applySessionEvent } = runtimeStub();
    binding.bind(runtime);

    // A known tag that does not belong on this seam.
    binding.host.onExtensionMessage?.({ type: "SendInput" }, context);
    // No tag at all; a body the schema refuses; a kind this build predates.
    binding.host.onExtensionMessage?.({ hello: true }, context);
    binding.host.onExtensionMessage?.({ type: "SessionEvent", event: { kind: "exited" } }, context);
    binding.host.onExtensionMessage?.(
      { type: "SessionEvent", event: { kind: "renamed", sessionId: "sess-1" } },
      context,
    );
    expect(applySessionEvent).not.toHaveBeenCalled();
  });

  it("stays inert before bind and after dispose", () => {
    const binding = createRoutedTerminalHost({
      fieldd: { request: vi.fn() } as unknown as FielddClient,
    });
    const removed = { type: "SessionEvent", event: { kind: "removed", sessionId: "sess-1" } };
    // Before bind: nothing to apply onto, nothing thrown.
    binding.host.onExtensionMessage?.(removed, context);

    const { runtime, applySessionEvent } = runtimeStub();
    binding.bind(runtime);
    binding.dispose();
    binding.host.onExtensionMessage?.(removed, context);
    expect(applySessionEvent).not.toHaveBeenCalled();
  });

  it("resync reconciles THIS cell's sessions against the authoritative inventory", async () => {
    const requests = vi.fn(async (method: string) => {
      if (method !== "terminal.sessions") throw new Error(`unexpected ${method}`);
      return { sessions: [summary] };
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });
    const { runtime, applySessionEvent } = runtimeStub();
    binding.bind(runtime);
    // Two sessions in cell A's custody (one live, one the lag lost), one in
    // cell B's that this resync must not touch.
    binding.primeTicket("sess-1", ticket());
    binding.primeTicket("sess-2", ticketFor("sess-2", "cell-a-boot-1"));
    binding.primeTicket("sess-3", ticketFor("sess-3", "cell-b-boot-9"));

    binding.host.onExtensionMessage?.({ type: "SessionEvent", event: { kind: "resync" } }, context);

    await vi.waitFor(() => {
      expect(applySessionEvent).toHaveBeenCalledWith({ type: "updated", session: summary });
      expect(applySessionEvent).toHaveBeenCalledWith({ type: "removed", sessionId: "sess-2" });
    });
    expect(requests).toHaveBeenCalledTimes(1);
    expect(applySessionEvent).toHaveBeenCalledTimes(2);
  });
});
