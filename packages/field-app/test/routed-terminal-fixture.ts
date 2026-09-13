/**
 * The floor's answers to a routed birth (TP-S3e), as a fixture both deck
 * fixtures read: `terminal.create` — and `agent.spawn`/`agent.resume`, which
 * answer the SAME ticket — carry the grants a routed transport needs plus the
 * summary the workspace mounts. Shared so two fixtures cannot drift into two
 * different ideas of what the floor says.
 */

/** The cell every grant in here is audienced to. */
export const CELL = "cell-test-boot-1";

export function routedTicket(sessionId: string): Record<string, unknown> {
  return {
    route: { cellBootId: CELL, routeRevision: 1 },
    endpoints: {
      controlUrl: "ws://127.0.0.1:40001/control",
      framesUrl: "ws://127.0.0.1:40001/frames",
    },
    transportGrant: {
      protected: {
        v: 1,
        typ: "CellTransportGrant",
        iss: "fieldd",
        alg: "HS256",
        kid: { cellBootId: CELL, keyGeneration: 1 },
      },
      claims: {
        audienceCellBootId: CELL,
        clientId: "renderer-1",
        connectionSetId: "connection-1",
        allowedChannels: ["control", "frames"],
        transportGrantGeneration: 1,
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
        kid: { cellBootId: CELL, keyGeneration: 1 },
      },
      claims: {
        audienceCellBootId: CELL,
        clientId: "renderer-1",
        sessionId,
        leaseEpoch: 1,
        routeRevision: 1,
        grantGeneration: 1,
        rights: ["input", "read"],
        issuedAt: 1_000,
        expiresAt: 61_000,
      },
      mac: "bWFj",
    },
  };
}

export function bornSummary(
  sessionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: sessionId,
    handle: "1",
    executable: "/bin/zsh",
    cols: 80,
    rows: 24,
    exited: false,
    readWrite: true,
    title: null,
    cwd: "/home/tester",
    bellCount: 0,
    pid: 123,
    createdAtMs: 1_000,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ownerId: null,
    persistence: "keep-until-exit",
    activity: {
      kind: "unknown",
      source: "unsupported",
      confidence: "heuristic",
      rootProcessGroupId: null,
      foregroundProcessGroupId: null,
      observedAtMs: 1_000,
    },
    ...overrides,
  };
}
