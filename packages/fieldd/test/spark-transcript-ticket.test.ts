import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CallerContext,
  type Principal,
  RECORD_STORES,
  SPARK_TRANSCRIPT,
  SPARK_TRANSCRIPT_SERVICE,
  SparkTranscriptOpenTicketResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import { UNREADABLE_WORDS } from "../src/signed-record";
import { SparkTranscripts } from "../src/spark-transcripts";
import type { HostOps, TicketRegistration } from "../src/transcripts/protocol";
import { TranscriptHostRefusal, TranscriptHostUnavailable } from "../src/transcripts/supervisor";
import { SparkTranscriptTickets } from "../src/transcripts/tickets";

// TH-1 (TH-Q30 (a′); VF-PM's X2; step0-th §8 "the ticket") — `compose.sparks.transcript.openTicket`, fieldd's half:
// a renderer window of this desktop alone is served a fresh single-use credential on the transcript worker's loopback
// socket and the spark's runs, oldest first; shell-main, a plugin, an MCP agent, a plain local token, a phone and a
// peer daemon are refused; a worker that cannot answer, and a folder the disk will not hand over, are the honest
// UNAVAILABLE, never an empty list. The worker itself is spark-transcript-host.test.ts's.

const VELA = "sp-vela00000000";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      chmodSync(join(dir, "spark-files", VELA), 0o700);
    } catch {
      // never made
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

const ctx = (
  principal: Principal,
  more: Partial<Omit<CallerContext, "principal">> = {},
): CallerContext => ({ principal, transport: "ws-loopback", receivedAt: 0, ...more });

const WINDOW = ctx(
  {
    kind: "local-token",
    tokenId: "tok-window",
    scopes: ["sparks.use"],
    rendererParticipant: { participantId: "renderer:w1", incarnation: "renderer:w1:doc-1" },
  } as Principal,
  { clientKind: "renderer" },
);
const REFUSED: Array<[string, CallerContext]> = [
  ["shell-main", ctx({ kind: "shell-main" } as Principal)],
  ["a plugin", ctx({ kind: "plugin", pluginId: "p", scopes: [] } as unknown as Principal)],
  ["an MCP agent", ctx({ kind: "mcp-agent", sessionId: "run-1", scopes: [] } as Principal)],
  [
    "a plain local token",
    ctx({ kind: "local-token", tokenId: "tok-plain", scopes: ["sparks.use"] } as Principal, {
      clientKind: "renderer",
    }),
  ],
  [
    "the phone",
    ctx({ kind: "tailnet", login: "me@example.com", self: true } as Principal, {
      transport: "ws-tailnet",
      clientKind: "ios",
    }),
  ],
  ["a peer daemon", ctx({ kind: "peer-fieldd", deviceId: "dev-b" } as Principal)],
];

function world(opts: { refuse?: Error } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-transcript-ticket-"));
  dirs.push(root);
  /** when each line is written, in order; then now */
  const times: string[] = [];
  const store = new SparkTranscripts({
    dir: join(root, "spark-files"),
    keyPath: join(root, "spark-files.key"),
    now: () => new Date(times.shift() ?? "2026-11-05T04:00:00.000Z"),
  });
  const registered: TicketRegistration[] = [];
  const supervisor = {
    health: () => ({ phase: "ready" as const, detail: null, pid: 7, generation: 2 }),
    request: async <Op extends keyof HostOps>(
      op: Op,
      args: HostOps[Op]["args"],
    ): Promise<HostOps[Op]["value"]> => {
      if (opts.refuse !== undefined) throw opts.refuse;
      if (op === "registerTicket") registered.push(args as TicketRegistration);
      return (op === "registerTicket" ? { port: 53817 } : null) as HostOps[Op]["value"];
    },
  };
  const now = Date.parse("2026-11-05T04:00:00.000Z");
  const tickets = new SparkTranscriptTickets({
    store,
    supervisor,
    hasSpark: (id) => id === VELA,
    now: () => now,
  });
  return { root, store, tickets, registered, now, times };
}

/** The door's answer as the contract parses it, or what it refused with: the row asserts on it, so a door that
 * refuses fails the row by that assertion, never by the refusal thrown into it. */
const answered = async (call: Promise<unknown>) => {
  try {
    const parsed = SparkTranscriptOpenTicketResult.safeParse(await call);
    return parsed.success ? parsed.data : { unparsed: parsed.error.issues };
  } catch (error) {
    return {
      refused: error instanceof RpcCallError ? `${error.kind}: ${error.message}` : String(error),
    };
  }
};

const refused = async (call: Promise<unknown>) => {
  try {
    await call;
    return "served";
  } catch (error) {
    return error instanceof RpcCallError ? error : "thrown";
  }
};

describe("compose.sparks.transcript.openTicket, fieldd's gate and answer (TH-1)", () => {
  it("serves this desktop's window a fresh single-use ticket on the worker's loopback socket and the spark's runs, oldest first", async () => {
    const w = world();
    // the later run is written first: the answer is ordered by when each began
    w.times.push("2026-11-05T03:00:00.000Z", "2026-11-04T20:00:00.000Z");
    w.store.append(VELA, "run-vela-2", { kind: "run", runtimeRunId: "run-vela-2", fresh: false });
    w.store.append(VELA, "run-vela-1", { kind: "run", runtimeRunId: "run-vela-1", fresh: true });
    const answer = await answered(w.tickets.open(WINDOW, { spark: VELA }));
    expect(answer, "the door's answer to this desktop's window").toMatchObject({
      spark: VELA,
      endpoint: "ws://127.0.0.1:53817/transcripts",
      expiresAt: w.now + SPARK_TRANSCRIPT.TICKET_TTL_MS,
      generation: 2,
    });
    const first = answer as SparkTranscriptOpenTicketResult;
    expect(first.runs.map((run) => [run.runtimeRunId, run.fresh])).toEqual([
      ["run-vela-1", true],
      ["run-vela-2", false],
    ]);
    expect(first.ticket).toHaveLength(43);
    expect(w.registered[0]).toEqual({
      ticket: first.ticket,
      spark: VELA,
      clientId: "tok-window",
      expiresAt: first.expiresAt,
    });
    // never idempotent: each answer is a new credential
    const second = await answered(w.tickets.open(WINDOW, { spark: VELA }));
    expect(second, "the door's second answer").toHaveProperty("ticket");
    expect((second as SparkTranscriptOpenTicketResult).ticket).not.toBe(first.ticket);
    expect(w.registered).toHaveLength(2);
  });

  it("refuses shell-main, a plugin, an MCP agent, a plain local token, the phone and a peer daemon, and mints nothing for them", async () => {
    const w = world();
    for (const [who, caller] of REFUSED) {
      const error = await refused(w.tickets.open(caller, { spark: VELA }));
      expect(error instanceof RpcCallError ? error.kind : error, who).toBe("FORBIDDEN_SCOPE");
    }
    expect(w.registered).toEqual([]);
  });

  it("says a spark this desktop does not keep is not found, and a malformed ask is refused", async () => {
    const w = world();
    const unknown = await refused(w.tickets.open(WINDOW, { spark: "sp-kiwi00000000" }));
    expect(unknown instanceof RpcCallError && unknown.kind).toBe("NOT_FOUND");
    const malformed = await refused(w.tickets.open(WINDOW, { spark: "../x" }));
    expect(malformed instanceof RpcCallError && malformed.kind).toBe("PRECONDITION_FAILED");
    expect(w.registered).toEqual([]);
  });

  it("answers a worker that cannot answer, and a folder the disk will not hand over, as the honest UNAVAILABLE", async () => {
    const starting = world({
      refuse: new TranscriptHostUnavailable(
        SPARK_TRANSCRIPT_SERVICE.STATE_STARTING,
        "starting",
        true,
      ),
    });
    const down = await refused(starting.tickets.open(WINDOW, { spark: VELA }));
    expect(down instanceof RpcCallError && [down.kind, down.retryable, down.details]).toEqual([
      "UNAVAILABLE",
      true,
      { service: SPARK_TRANSCRIPT_SERVICE.SERVICE, state: SPARK_TRANSCRIPT_SERVICE.STATE_STARTING },
    ]);
    const busy = world({ refuse: new TranscriptHostRefusal({ code: "busy", message: "full" }) });
    const full = await refused(busy.tickets.open(WINDOW, { spark: VELA }));
    expect(full instanceof RpcCallError && full.kind).toBe("RESOURCE_EXHAUSTED");
    // the spark's folder, refused by the disk: never an empty list of runs
    const w = world();
    w.store.append(VELA, "run-vela-1", { kind: "run", runtimeRunId: "run-vela-1", fresh: true });
    chmodSync(join(w.root, "spark-files", VELA), 0o000);
    const unreadable = await refused(w.tickets.open(WINDOW, { spark: VELA }));
    // item 172's refusal, the store's own (the fold): in fieldd's words, retryable
    expect(
      unreadable instanceof RpcCallError && [
        unreadable.kind,
        unreadable.retryable,
        unreadable.message,
        unreadable.details,
      ],
    ).toEqual([
      "UNAVAILABLE",
      true,
      UNREADABLE_WORDS.transcripts,
      {
        service: SPARK_TRANSCRIPT_SERVICE.SERVICE,
        state: RECORD_STORES.STATE_UNREADABLE,
      },
    ]);
    expect(w.registered).toEqual([]);
  });
});
