// @vitest-environment happy-dom
import type { GhostteaTerminalRuntime, RoutedTerminalInputContext } from "@vibecook/ghosttea-react";
import { SendInput, type TerminalOpenTicket } from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { describe, expect, it, vi } from "vitest";
import { createRoutedTerminalHost } from "../src/terminal/routed/host";

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

function ticket(endpoints = true): TerminalOpenTicket {
  const cellBootId = "cell-a-boot-1";
  return {
    route: { cellBootId, routeRevision: 3, leaseEpoch: 7 },
    ...(endpoints
      ? {
          endpoints: {
            controlUrl: "ws://127.0.0.1:43101/control",
            framesUrl: "ws://127.0.0.1:43101/frames",
          },
        }
      : {}),
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

    await expect(
      createRoutedTerminalHost({
        fieldd: fieldd({ controlSocket: "/tmp/control", frameSocket: "/tmp/frames", token: "t" }),
      }).host.openTicket("sess-1"),
    ).rejects.toThrow("grants are not landed");
    await expect(
      createRoutedTerminalHost({ fieldd: fieldd(ticket(false)) }).host.openTicket("sess-1"),
    ).rejects.toThrow("transport is not landed");
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
