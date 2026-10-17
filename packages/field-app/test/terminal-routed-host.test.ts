// @vitest-environment happy-dom
import type { GhostteaTerminalRuntime, RoutedTerminalInputContext } from "@vibecook/ghosttea-react";
import { SendInput, TERMINAL_PIPELINE, type TerminalOpenTicket } from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { describe, expect, it, vi } from "vitest";
import { getRendererLogger, type RendererLogger, setRendererLogger } from "../src/logging";
import { createRoutedTerminalHost, ROUTED_CLIENT_CAPABILITIES } from "../src/terminal/routed/host";
import { remoteRefusalOf } from "../src/terminal/routed/remote-refusal";

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

/** Every inventory read is handed its bound (the read's 5 s, less what is spent). */
const BOUND = { timeoutMs: expect.any(Number) };

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

  it("tells its owner of a paste too large for one message, and hands the runtime nothing (D6)", () => {
    const onInputRefusal = vi.fn();
    const binding = createRoutedTerminalHost({
      fieldd: { request: vi.fn() } as unknown as FielddClient,
      onInputRefusal,
    });
    const tooLarge: RoutedTerminalInputContext = {
      ...inputContext("act-1"),
      operation: { kind: "paste", text: "x".repeat(TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES) },
    };
    // the one-message seam: never parted, refused — and the owner is told
    expect(binding.host.encodeInput?.(tooLarge)).toBeNull();
    expect(onInputRefusal).toHaveBeenCalledTimes(1);
    // its own size, and the most of it one message carries — less than that
    expect(onInputRefusal).toHaveBeenCalledWith({
      sessionId: "sess-1",
      kind: "paste",
      bytes: TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES,
      limitBytes: expect.any(Number),
    });
    expect(onInputRefusal.mock.calls[0]?.[0].limitBytes).toBeLessThan(
      TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES,
    );
    // the refusal spent nothing: the activation's next input is its first
    expect(sequenceOf(binding, "act-1")).toBe(1);
    // a disposed host refuses nothing aloud
    binding.dispose();
    onInputRefusal.mockClear();
    expect(binding.host.encodeInput?.(tooLarge)).toBeNull();
    expect(onInputRefusal).not.toHaveBeenCalled();
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

  it("advertises resume plus the load-bearing session-events and geometry-events capabilities", () => {
    expect(ROUTED_CLIENT_CAPABILITIES).toEqual(["resume", "session-events", "geometry-events"]);
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

    // Staggered panes within the cadence reuse the completed read too.
    await expect(binding.host.getSession?.("sess-1")).resolves.toEqual(summary);
    expect(requests).toHaveBeenCalledTimes(1);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 201);
    const third = binding.host.getSession?.("sess-1");
    expect(requests).toHaveBeenCalledTimes(2);
    resolvers[1]?.({ sessions: [summary] });
    await expect(third).resolves.toEqual(summary);
    now.mockRestore();
    binding.dispose();
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

  it("a hung terminal.sessions no longer pins every pane: the read gives up at its 5 s bound, and the next turn reads fresh", async () => {
    vi.useFakeTimers();
    try {
      // the first read is taken and never answered (a request that ignores
      // any bound it is handed); the second answers
      let asked = 0;
      const requests = vi.fn((method: string, _params?: unknown, _opts?: unknown) => {
        if (method !== "terminal.sessions") throw new Error(`unexpected ${method}`);
        asked += 1;
        return asked === 1
          ? new Promise(() => undefined)
          : Promise.resolve({ sessions: [summary] });
      });
      const binding = createRoutedTerminalHost({
        fieldd: { request: requests } as unknown as FielddClient,
      });
      // two panes join the one read
      const first = vi.fn();
      const second = vi.fn();
      binding.host.getSession?.("sess-1").then(first, first);
      binding.host.getSession?.("sess-1").then(second, second);
      expect(requests).toHaveBeenCalledTimes(1);
      // the client is handed the same bound, so a real one drops its pending call
      expect((requests.mock.calls[0]?.[2] as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(
        5_000,
      );

      await vi.advanceTimersByTimeAsync(4_900);
      expect(first).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      const said = expect.objectContaining({
        kind: "UNAVAILABLE",
        retryable: true,
        details: expect.objectContaining({ state: "timeout" }),
      });
      expect(first).toHaveBeenCalledWith(said);
      expect(second).toHaveBeenCalledWith(said);

      // the expiry let go of the read: the next pane's turn asks again, and lands
      const third = binding.host.getSession?.("sess-1");
      expect(requests).toHaveBeenCalledTimes(2);
      await expect(third).resolves.toEqual(summary);
      binding.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an inventory invalidated while it was read is re-read ONCE: a second invalidation answers the re-read, uncached", async () => {
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
    const settled = vi.fn();
    void binding.host.getSession?.("sess-1").then(settled, settled);
    expect(requests).toHaveBeenCalledTimes(1);
    // a ticket primed while the read is out invalidates it: the read re-reads
    binding.primeTicket("sess-1", ticket());
    resolvers[0]?.({ sessions: [] });
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    // invalidated again under the re-read: its answer is the answer this time
    binding.primeTicket("sess-1", ticket());
    resolvers[1]?.({ sessions: [summary] });
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(summary));
    expect(requests).toHaveBeenCalledTimes(2);
    // …uncached: the floor moved under it, so the next turn reads again
    void binding.host.getSession?.("sess-1");
    expect(requests).toHaveBeenCalledTimes(3);
    binding.dispose();
  });

  it("applies exited and removed through the runtime door, custody-checked", () => {
    const onTerminated = vi.fn();
    const binding = createRoutedTerminalHost({
      fieldd: { request: vi.fn() } as unknown as FielddClient,
      onTerminated,
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
    expect(onTerminated).toHaveBeenCalledExactlyOnceWith("sess-1");
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

// item 42 (DESIGN.md §8 "A session another device is driving") — the cell
// announces a session's geometry seat (`GeometryState`, behind `geometry-events`)
// to every leg with an activation of it; the host reads it, says whether the
// holder is THIS window, and hands it to the pool. A shape it cannot read is
// dropped and said, never a leg close.
describe("createRoutedTerminalHost — the geometry seat the cell announces (item 42)", () => {
  const context = {
    cellBootId: "cell-a-boot-1",
    connectionSetId: "connection-1",
    channel: "control" as const,
  };
  /** the phone holding the seat, named by the face fieldd minted into its grant */
  const PHONE = {
    clientId: "tailnet:me@example.com#node-phone~E1",
    viewId: "phone-view-1",
    holderGeneration: 3,
    face: { kind: "phone", name: "James's iPhone", os: "ios" },
  };
  /** this window's own view, under the client its ticket names (`renderer-1`) */
  const OWN = { clientId: "renderer-1", viewId: "view-1", holderGeneration: 4 };
  const announced = (holder: unknown, geometryRevision: number, sessionId = "sess-1") => ({
    type: "GeometryState",
    sessionId,
    holder,
    geometryRevision,
    cols: 45,
    rows: 22,
  });

  function hostWithSeats() {
    const onSessionSeat = vi.fn();
    const binding = createRoutedTerminalHost({
      fieldd: {
        request: vi.fn(async (method: string) => {
          if (method === "terminal.terminate") return { terminated: true };
          throw new Error(`unexpected ${method}`);
        }),
      } as unknown as FielddClient,
      onSessionSeat,
    });
    return { binding, onSessionSeat };
  }

  it("hands the pool every seat the cell announces, and whether its holder is THIS window", () => {
    const { binding, onSessionSeat } = hostWithSeats();
    binding.primeTicket("sess-1", ticket());

    binding.host.onExtensionMessage?.(announced(PHONE, 4), context);
    expect(onSessionSeat).toHaveBeenLastCalledWith("sess-1", {
      holder: PHONE,
      mine: false,
      revision: 4,
      cols: 45,
      rows: 22,
    });
    binding.host.onExtensionMessage?.(announced(OWN, 5), context);
    expect(onSessionSeat).toHaveBeenLastCalledWith("sess-1", {
      holder: OWN,
      mine: true,
      revision: 5,
      cols: 45,
      rows: 22,
    });
    // an empty seat: nobody drives, the PTY at the last size committed
    binding.host.onExtensionMessage?.(announced(null, 6), context);
    expect(onSessionSeat).toHaveBeenLastCalledWith("sess-1", {
      holder: null,
      mine: false,
      revision: 6,
      cols: 45,
      rows: 22,
    });
    // the order is the pool's to judge: an older revision is handed on as it came
    binding.host.onExtensionMessage?.(announced(PHONE, 2), context);
    expect(onSessionSeat).toHaveBeenCalledTimes(4);
  });

  it("counts every client this window's tickets named as its own — a fieldd restart mints a new one while the cell may hold the seat for the old", async () => {
    const restarted = ticket();
    restarted.transportGrant.claims.clientId = "renderer-2";
    restarted.attachGrant.claims.clientId = "renderer-2";
    const tickets = [ticket(), restarted];
    const onSessionSeat = vi.fn();
    const binding = createRoutedTerminalHost({
      fieldd: {
        request: vi.fn(async (method: string) => {
          if (method === "terminal.openTicket") return tickets.shift();
          throw new Error(`unexpected ${method}`);
        }),
      } as unknown as FielddClient,
      onSessionSeat,
    });
    await binding.host.openTicket("sess-1");
    await binding.host.openTicket("sess-1");
    const mine = (): unknown => onSessionSeat.mock.lastCall?.[1]?.mine;

    binding.host.onExtensionMessage?.(announced(OWN, 7), context);
    expect(mine()).toBe(true);
    binding.host.onExtensionMessage?.(
      announced({ ...OWN, clientId: "renderer-2", holderGeneration: 5 }, 8),
      context,
    );
    expect(mine()).toBe(true);
    binding.host.onExtensionMessage?.(announced(PHONE, 9), context);
    expect(mine()).toBe(false);
    expect(onSessionSeat).toHaveBeenCalledTimes(3);
  });

  it("believes only the cell its ticket named, and says nothing of a session this window holds no ticket for", async () => {
    const { binding, onSessionSeat } = hostWithSeats();
    binding.primeTicket("sess-1", ticket());

    // a foreign cell speaking for this session
    binding.host.onExtensionMessage?.(announced(PHONE, 4), {
      ...context,
      cellBootId: "cell-b-boot-9",
    });
    // a session no ticket of this window's names
    binding.host.onExtensionMessage?.(announced(PHONE, 4, "sess-foreign"), context);
    expect(onSessionSeat).not.toHaveBeenCalled();

    // and none once the session is gone
    await binding.host.terminate?.("sess-1", "user");
    binding.host.onExtensionMessage?.(announced(PHONE, 5), context);
    expect(onSessionSeat).not.toHaveBeenCalled();
  });

  it("drops a GeometryState it cannot read — said by its field paths, never its values — and closes nothing", () => {
    const warnings: Array<{ event: string; attrs: unknown }> = [];
    const capture: RendererLogger = {
      child: () => capture,
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: (event, _message, attrs) => {
        warnings.push({ event, attrs });
      },
      error: () => undefined,
      fatal: () => undefined,
      isLevelEnabled: () => true,
    };
    const previous = getRendererLogger();
    setRendererLogger(capture);
    try {
      const { binding, onSessionSeat } = hostWithSeats();
      binding.primeTicket("sess-1", ticket());
      // a zero-column PTY, and a holder with no client: neither is a seat
      binding.host.onExtensionMessage?.({ ...announced(PHONE, 4), cols: 0 }, context);
      binding.host.onExtensionMessage?.(
        announced({ viewId: "phone-view-1", holderGeneration: 3 }, 4),
        context,
      );
      expect(onSessionSeat).not.toHaveBeenCalled();
      expect(warnings.map(({ event }) => event)).toEqual([
        "renderer.terminal.geometry_state_dropped",
        "renderer.terminal.geometry_state_dropped",
      ]);
      expect(warnings[0]?.attrs).toEqual({ reason: "invalid", fields: ["cols"] });
      expect(warnings[1]?.attrs).toEqual({ reason: "invalid", fields: ["holder.clientId"] });
      expect(JSON.stringify(warnings)).not.toContain("James's iPhone");
      // the leg is untouched: the next good one lands
      binding.host.onExtensionMessage?.(announced(PHONE, 5), context);
      expect(onSessionSeat).toHaveBeenCalledTimes(1);
      // and the other drops stay as silent as they were
      binding.host.onExtensionMessage?.(
        { type: "SessionEvent", event: { kind: "exited" } },
        context,
      );
      expect(warnings).toHaveLength(2);
    } finally {
      setRendererLogger(previous);
    }
  });
});

// DS-4e (2026-10-01; thinking-desktop-sync-plane.md §6.3 steps 1, 5 and 6) — a
// session that lives on ANOTHER desktop. The pane asks its own daemon, naming
// the owner (`device`); the daemon forwards, the owner mints, and the daemon
// answers a ticket whose doors it re-homed onto a loopback egress route — which
// the routed runtime dials exactly as it dials a local cell. Renewal and the
// kill take the same road; the owner's inventory (the only answer carrying its
// engine `handle`) is read by the same `device`.
describe("createRoutedTerminalHost — a session on another desktop (DS-4e)", () => {
  const OWNER = "dev-studio";
  const OWNER_CELL = "cell-studio-boot-7";
  /** The pair this desktop's daemon answered: the owner's paths on a loopback
   * listener of its own (fieldd `remote-cell-rewriter.ts`). */
  const LOOPBACK = {
    controlUrl: `ws://127.0.0.1:61234/cell/${OWNER_CELL}/control`,
    framesUrl: `ws://127.0.0.1:61234/cell/${OWNER_CELL}/frames`,
  };
  const context = {
    cellBootId: OWNER_CELL,
    connectionSetId: "connection-r",
    channel: "control" as const,
  };
  const ownersSummary = {
    ...summary,
    id: "pane-r",
    handle: "41",
    cwd: "file://studio.local/Users/peer/src",
  };

  function ownersTicket(sessionId = "pane-r"): TerminalOpenTicket {
    const t = ticket();
    t.route.cellBootId = OWNER_CELL;
    t.endpoints = { ...LOOPBACK };
    t.transportGrant.protected.kid.cellBootId = OWNER_CELL;
    t.transportGrant.claims.audienceCellBootId = OWNER_CELL;
    t.attachGrant.protected.kid.cellBootId = OWNER_CELL;
    t.attachGrant.claims.audienceCellBootId = OWNER_CELL;
    t.attachGrant.claims.sessionId = sessionId;
    return t;
  }

  function outcomeUnknown(key: string): FielddRpcError {
    const error = new FielddRpcError(
      "UNAVAILABLE",
      "the call was cut before an answer; its outcome is unknown",
      true,
      { service: "fieldd", state: "outcome-unknown", idempotencyKey: key },
    );
    error.forward = { idempotencyKey: key };
    return error;
  }

  function scripted(answers: Array<() => unknown>) {
    return vi.fn(async (_method: string, _params?: unknown, _opts?: unknown) => {
      const next = answers.shift();
      if (next === undefined) throw new Error("asked too often");
      return next();
    });
  }

  function runtimeStub() {
    const applySessionEvent = vi.fn();
    const runtime = Object.assign(new EventTarget(), { applySessionEvent });
    return { runtime: runtime as unknown as GhostteaTerminalRuntime, applySessionEvent };
  }

  it("asks the OWNER for a remote session's ticket, renewal and kill — and hands back the loopback pair its daemon answered", async () => {
    const opened = ownersTicket();
    const requests = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "terminal.openTicket") return opened;
      if (method === "terminal.renewAttach") return { attachGrant: opened.attachGrant };
      if (method === "terminal.terminate") return { terminated: true };
      throw new Error(`unexpected ${method}`);
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });
    binding.placeRemote("pane-r", OWNER);

    const minted = await binding.host.openTicket("pane-r", { reason: "mount" });
    // dialled as a local cell's: the routed ticket carries the loopback pair whole
    expect(minted.endpoints).toEqual(LOOPBACK);
    expect(minted.route.cellBootId).toBe(OWNER_CELL);
    await binding.host.renewAttach?.({
      sessionId: "pane-r",
      expectGeneration: 5,
      requestId: "renew-r",
    });
    await binding.host.terminate?.("pane-r", "user");

    expect(requests.mock.calls).toEqual([
      ["terminal.openTicket", { device: OWNER, sessionId: "pane-r" }],
      [
        "terminal.renewAttach",
        { sessionId: "pane-r", expectGeneration: 5, requestId: "renew-r", device: OWNER },
      ],
      ["terminal.terminate", { sessionId: "pane-r", device: OWNER }],
    ]);
  });

  it("leaves a LOCAL session's asks exactly as they were — `{sessionId}`, no device", async () => {
    const requests = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "terminal.openTicket") return ticket();
      throw new Error(`unexpected ${method}`);
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });
    // another session's placement changes nothing for this one
    binding.placeRemote("pane-r", OWNER);
    await binding.host.openTicket("sess-1");
    expect(requests.mock.calls).toEqual([["terminal.openTicket", { sessionId: "sess-1" }]]);
  });

  it("asks an outcome-unknown mint once more with ITS key, and a receipt in place of the ticket ANEW", async () => {
    const requests = scripted([
      () => {
        throw outcomeUnknown("wk_attach_1");
      },
      () => ownersTicket(),
    ]);
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });
    binding.placeRemote("pane-r", OWNER);

    await expect(binding.host.openTicket("pane-r")).resolves.toMatchObject({ endpoints: LOOPBACK });
    expect(requests.mock.calls).toEqual([
      ["terminal.openTicket", { device: OWNER, sessionId: "pane-r" }],
      [
        "terminal.openTicket",
        { device: OWNER, sessionId: "pane-r" },
        { idempotencyKey: "wk_attach_1" },
      ],
    ]);

    // The retry answered with the owner's RECEIPT (the ticket applied, its
    // answer too large to journal): a ticket is harmless to mint twice, so it
    // is a NEW logical call — no key, a fresh ticket, the lost one expires.
    const again = scripted([
      () => {
        throw outcomeUnknown("wk_attach_2");
      },
      () => ({
        idempotencyKey: "wk_attach_2",
        method: "terminal.openTicket",
        device: OWNER,
        state: "applied",
        at: 1,
        resultOmitted: true,
      }),
      () => ownersTicket(),
    ]);
    const asked = createRoutedTerminalHost({
      fieldd: { request: again } as unknown as FielddClient,
    });
    asked.placeRemote("pane-r", OWNER);
    await expect(asked.host.openTicket("pane-r")).resolves.toMatchObject({ endpoints: LOOPBACK });
    expect(again.mock.calls.map((call) => call[2])).toEqual([
      undefined,
      { idempotencyKey: "wk_attach_2" },
      undefined,
    ]);
    expect(again.mock.calls.map((call) => call[1])).toEqual([
      { device: OWNER, sessionId: "pane-r" },
      { device: OWNER, sessionId: "pane-r" },
      { device: OWNER, sessionId: "pane-r" },
    ]);
  });

  it("reconciles a remote cell's resync against the OWNER's inventory — never against this desktop's", async () => {
    const requests = vi.fn(async (method: string, params?: unknown) => {
      if (method !== "terminal.sessions") throw new Error(`unexpected ${method}`);
      // this desktop's floor knows nothing of the owner's sessions
      return (params as { device?: string } | undefined)?.device === OWNER
        ? { sessions: [ownersSummary] }
        : { sessions: [] };
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });
    const { runtime, applySessionEvent } = runtimeStub();
    binding.bind(runtime);
    binding.placeRemote("pane-r", OWNER);
    binding.placeRemote("pane-gone", OWNER);
    binding.primeTicket("pane-r", ownersTicket("pane-r"));
    binding.primeTicket("pane-gone", ownersTicket("pane-gone"));

    binding.host.onExtensionMessage?.({ type: "SessionEvent", event: { kind: "resync" } }, context);

    await vi.waitFor(() => {
      expect(applySessionEvent).toHaveBeenCalledWith({ type: "updated", session: ownersSummary });
      expect(applySessionEvent).toHaveBeenCalledWith({ type: "removed", sessionId: "pane-gone" });
    });
    expect(applySessionEvent).toHaveBeenCalledTimes(2);
    expect(requests.mock.calls).toEqual([["terminal.sessions", { device: OWNER }, BOUND]]);
  });

  it("refreshes a remote pane's summary from the OWNER's inventory — one read per desktop per turn", async () => {
    const requests = vi.fn(async (method: string, params?: unknown) => {
      if (method !== "terminal.sessions") throw new Error(`unexpected ${method}`);
      return (params as { device?: string } | undefined)?.device === OWNER
        ? { sessions: [ownersSummary] }
        : { sessions: [summary] };
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });
    binding.placeRemote("pane-r", OWNER);

    const [remote, local, again] = await Promise.all([
      binding.host.getSession?.("pane-r"),
      binding.host.getSession?.("sess-1"),
      binding.host.getSession?.("pane-r"),
    ]);
    expect(remote).toEqual(ownersSummary);
    expect(local).toEqual(summary);
    expect(again).toEqual(ownersSummary);
    expect(requests.mock.calls).toEqual([
      ["terminal.sessions", { device: OWNER }, BOUND],
      ["terminal.sessions", {}, BOUND],
    ]);
  });

  it("reads the owner's exact summary for a mount, and null for a session the owner does not list", async () => {
    const requests = vi.fn(async (method: string, params?: unknown) => {
      if (method !== "terminal.sessions") throw new Error(`unexpected ${method}`);
      return (params as { device?: string } | undefined)?.device === OWNER
        ? { sessions: [ownersSummary] }
        : { sessions: [summary] };
    });
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
    });

    await expect(binding.readRemoteSession(OWNER, "pane-r")).resolves.toEqual(ownersSummary);
    // a mount reads FRESH: the summary it mounts is the owner's now
    await expect(binding.readRemoteSession(OWNER, "pane-elsewhere")).resolves.toBeNull();
    expect(requests.mock.calls).toEqual([
      ["terminal.sessions", { device: OWNER }, BOUND],
      ["terminal.sessions", { device: OWNER }, BOUND],
    ]);
  });
});

// DS-4e — the HONEST answer when the owner's ticket does not come. The host
// says why (`onRemoteRefusal`, structured: the pane words it), and a refusal
// that may heal waits for the owner's NEXT roster flip — the device subscription
// the monitor already holds — and is asked again then, once. Never on a timer.
describe("createRoutedTerminalHost — when another desktop's ticket does not come (DS-4e)", () => {
  const OWNER = "dev-studio";
  const OWNER_CELL = "cell-studio-boot-7";
  const LOOPBACK = {
    controlUrl: `ws://127.0.0.1:61234/cell/${OWNER_CELL}/control`,
    framesUrl: `ws://127.0.0.1:61234/cell/${OWNER_CELL}/frames`,
  };
  const NO_ROAD = "this desktop has no egress route to that desktop's terminal cells yet";

  function ownersTicket(sessionId = "pane-r"): TerminalOpenTicket {
    const t = ticket();
    t.route.cellBootId = OWNER_CELL;
    t.endpoints = { ...LOOPBACK };
    t.transportGrant.protected.kid.cellBootId = OWNER_CELL;
    t.transportGrant.claims.audienceCellBootId = OWNER_CELL;
    t.attachGrant.protected.kid.cellBootId = OWNER_CELL;
    t.attachGrant.claims.audienceCellBootId = OWNER_CELL;
    t.attachGrant.claims.sessionId = sessionId;
    return t;
  }

  /** fieldd's own refusal on this desktop (`remote-cell-rewriter.ts`). */
  const egress = (): FielddRpcError =>
    new FielddRpcError("UNAVAILABLE", NO_ROAD, true, {
      service: "terminal",
      state: "egress_unavailable",
      device: OWNER,
    });

  function scripted(answers: Array<() => unknown>) {
    return vi.fn(async (_method: string, _params?: unknown, _opts?: unknown) => {
      const next = answers.shift();
      if (next === undefined) throw new Error("asked too often");
      return next();
    });
  }

  function hostOver(requests: ReturnType<typeof scripted>) {
    const onRemoteRefusal = vi.fn();
    const binding = createRoutedTerminalHost({
      fieldd: { request: requests } as unknown as FielddClient,
      onRemoteRefusal,
    });
    binding.placeRemote("pane-r", OWNER);
    return { binding, onRemoteRefusal };
  }

  it("classifies each refusal by what fieldd SAID, never by its words", () => {
    const refusal = (kind: string, retryable: boolean, details?: unknown) =>
      remoteRefusalOf(new FielddRpcError(kind, `the ${kind} words`, retryable, details), OWNER);
    expect(
      refusal("UNAVAILABLE", true, { service: "terminal", state: "egress_unavailable" }),
    ).toEqual({ device: OWNER, state: "no-road", reason: "the UNAVAILABLE words", waits: true });
    // a mesh that failed the dial closed, and an owner whose doors only its own
    // machine can dial, are the same fact from here: no road yet
    expect(refusal("UNAVAILABLE", true, { service: "mesh", state: "proxy-down" }).state).toBe(
      "no-road",
    );
    expect(
      refusal("UNAVAILABLE", true, { service: "terminal", state: "doors_not_published" }).state,
    ).toBe("no-road");
    expect(refusal("UNAVAILABLE", true, { service: "peer-link", state: "offline" })).toMatchObject({
      state: "asleep",
      waits: true,
    });
    expect(
      refusal("UNAVAILABLE", true, { service: "peer-link", state: "unreachable" }),
    ).toMatchObject({ state: "not-answering", waits: true });
    // a second outcome-unknown the one retry could not resolve: not answered yet
    expect(
      refusal("UNAVAILABLE", true, { service: "fieldd", state: "outcome-unknown" }),
    ).toMatchObject({ state: "not-answering", waits: true });
    // final: what no second ask changes is said once and never asked again
    expect(refusal("NOT_FOUND", false)).toMatchObject({ state: "gone", waits: false });
    expect(refusal("FORBIDDEN_SCOPE", false, { required: "terminal.attach" })).toEqual({
      device: OWNER,
      state: "refused",
      reason: "the FORBIDDEN_SCOPE words",
      waits: false,
    });
    expect(
      refusal("UNAVAILABLE", false, { service: "peer-link", state: "disposed" }),
    ).toMatchObject({ state: "refused", waits: false });
    // a throw that is not fieldd's (a contract break the parse caught) is final too
    expect(remoteRefusalOf(new Error("the ticket names a different session"), OWNER)).toEqual({
      device: OWNER,
      state: "refused",
      reason: "the ticket names a different session",
      waits: false,
    });
  });

  it("says `no-road` and waits for the owner's next flip — ten minutes of timers ask nothing, a flip asks once", async () => {
    vi.useFakeTimers();
    try {
      const requests = scripted([
        () => {
          throw egress();
        },
        () => ownersTicket(),
      ]);
      const { binding, onRemoteRefusal } = hostOver(requests);
      let minted: unknown;
      const asking = binding.host.openTicket("pane-r").then((answer) => {
        minted = answer;
        return answer;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(onRemoteRefusal).toHaveBeenLastCalledWith("pane-r", {
        device: OWNER,
        state: "no-road",
        reason: NO_ROAD,
        waits: true,
      });

      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(requests).toHaveBeenCalledTimes(1);
      expect(minted).toBeUndefined();

      // another desktop's row flipping is not this desktop's news
      binding.deviceFlipped("dev-other");
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveBeenCalledTimes(1);

      binding.deviceFlipped(OWNER);
      await expect(asking).resolves.toMatchObject({ endpoints: LOOPBACK });
      expect(requests).toHaveBeenCalledTimes(2);
      expect(requests.mock.calls[1]?.[1]).toEqual({ device: OWNER, sessionId: "pane-r" });
      // the road is open: the honest state clears
      expect(onRemoteRefusal).toHaveBeenLastCalledWith("pane-r", undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks once per flip: refused again, it waits for the NEXT flip — and a flip that lands mid-ask earns its own ask", async () => {
    let refuseSecond: (cause: unknown) => void = () => undefined;
    const requests = scripted([
      () => {
        throw egress();
      },
      () =>
        new Promise((_resolve, reject) => {
          refuseSecond = reject;
        }),
      () => ownersTicket(),
    ]);
    const { binding } = hostOver(requests);
    const asking = binding.host.openTicket("pane-r");
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(1));

    binding.deviceFlipped(OWNER);
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    // the owner flips again WHILE the second ask is out; then that ask is refused
    binding.deviceFlipped(OWNER);
    refuseSecond(egress());
    // the flip it missed is not lost: asked a third time with no flip after
    await expect(asking).resolves.toMatchObject({ endpoints: LOOPBACK });
    expect(requests).toHaveBeenCalledTimes(3);
  });

  it("says the owner is asleep and waits too; a refusal no second ask changes is final — said, thrown, never asked again", async () => {
    const asleep = scripted([
      () => {
        throw new FielddRpcError("UNAVAILABLE", "peer has no published endpoint", true, {
          service: "peer-link",
          device: OWNER,
          state: "offline",
        });
      },
      () => ownersTicket(),
    ]);
    const sleeping = hostOver(asleep);
    const waking = sleeping.binding.host.openTicket("pane-r");
    await vi.waitFor(() =>
      expect(sleeping.onRemoteRefusal).toHaveBeenLastCalledWith(
        "pane-r",
        expect.objectContaining({ state: "asleep", waits: true }),
      ),
    );
    sleeping.binding.deviceFlipped(OWNER);
    await expect(waking).resolves.toMatchObject({ endpoints: LOOPBACK });

    const forbidden = new FielddRpcError(
      "FORBIDDEN_SCOPE",
      "terminal.openTicket is forwarded to another desktop only for this person's own windows and devices",
      false,
      { method: "terminal.openTicket", device: OWNER },
    );
    const refused = scripted([
      () => {
        throw forbidden;
      },
    ]);
    const refusing = hostOver(refused);
    await expect(refusing.binding.host.openTicket("pane-r")).rejects.toBe(forbidden);
    expect(refusing.onRemoteRefusal).toHaveBeenLastCalledWith("pane-r", {
      device: OWNER,
      state: "refused",
      reason: forbidden.message,
      waits: false,
    });
    refusing.binding.deviceFlipped(OWNER);
    await Promise.resolve();
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("withdraws a waiting ask when its activation ends, and every one at dispose — no ask after", async () => {
    let refuseOut: (cause: unknown) => void = () => undefined;
    const requests = scripted([
      () => {
        throw egress();
      },
      () =>
        new Promise((_resolve, reject) => {
          refuseOut = reject;
        }),
      () => {
        throw egress();
      },
    ]);
    const { binding, onRemoteRefusal } = hostOver(requests);
    const runtime = new EventTarget();
    binding.bind(runtime as GhostteaTerminalRuntime);
    const ended = (): void => {
      runtime.dispatchEvent(
        new CustomEvent("routed-activation-state", {
          detail: {
            sessionId: "pane-r",
            previous: { activationId: "act-r", phase: "unresolved" },
            current: { activationId: "act-r", phase: "ended" },
          },
        }),
      );
    };

    // PARKED: refused and waiting for the flip when the pane lets it go — a
    // detach ends any activation — and the ask is withdrawn, its state cleared
    const parked = binding.host.openTicket("pane-r");
    await vi.waitFor(() =>
      expect(onRemoteRefusal).toHaveBeenLastCalledWith(
        "pane-r",
        expect.objectContaining({ state: "no-road" }),
      ),
    );
    ended();
    await expect(parked).rejects.toThrow("withdrawn");
    expect(onRemoteRefusal).toHaveBeenLastCalledWith("pane-r", undefined);
    binding.deviceFlipped(OWNER);
    await Promise.resolve();
    expect(requests).toHaveBeenCalledTimes(1);

    // OUT: the pane lets go while the ask is on the wire — its refusal, when it
    // comes, is neither said nor parked
    const out = binding.host.openTicket("pane-r");
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    const said = onRemoteRefusal.mock.calls.length;
    ended();
    refuseOut(egress());
    await expect(out).rejects.toThrow(NO_ROAD);
    expect(onRemoteRefusal.mock.calls.slice(said)).toEqual([]);
    binding.deviceFlipped(OWNER);
    await Promise.resolve();
    expect(requests).toHaveBeenCalledTimes(2);

    // DISPOSED: every parked ask goes with the host
    const later = binding.host.openTicket("pane-r");
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(onRemoteRefusal).toHaveBeenLastCalledWith(
        "pane-r",
        expect.objectContaining({ state: "no-road" }),
      ),
    );
    binding.dispose();
    await expect(later).rejects.toThrow("withdrawn");
  });
});
