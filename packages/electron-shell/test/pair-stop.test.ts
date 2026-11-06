import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCensus, readPlainCensus, requestConsentedStop } from "../src/main/pair-stop";
import { CENSUS_BOUND_MS } from "../src/main/updates/apply";

// Item 192 (RV #6, gap3-1) — the two halves of a consented stop for the stop a release needs. A release that leaves
// field-native's bytes alone stops fieldd alone, and fieldd's own stop ends the agent runs whose agents don't
// re-attach: fieldd counts them (`system.shutdown.census`), the person consents to exactly that set, and the stop
// carries it back (`system.shutdown {reason, agents: {runs}}`) for fieldd to re-check. Every row drives the real
// functions over a fake client: what was asked, and what each answer reads as.

type FielddClient = FielddHandle["client"];

interface Asked {
  readonly method: string;
  readonly params: unknown;
}

/** A client that answers every request with `answer` (a function of the ask), recording each ask. */
function clientOf(answer: (asked: Asked) => Promise<unknown>): {
  client: FielddClient;
  asked: Asked[];
} {
  const asked: Asked[] = [];
  const client = {
    request: async (method: string, params?: unknown) => {
      const ask = { method, params };
      asked.push(ask);
      return answer(ask);
    },
  } as unknown as FielddClient;
  return { client, asked };
}

/** fieldd's refusal as its client throws it (`FielddRpcError`'s fields, duck-typed as `requestConsentedStop` reads). */
const refusal = (kind: string, details?: unknown): Error =>
  Object.assign(new Error(`${kind} from fieldd`), {
    kind,
    retryable: kind === "UNAVAILABLE",
    ...(details !== undefined ? { details } : {}),
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("the consented stop carries the consent of the stop it asks (RV #6)", () => {
  it("fieldd's own stop names the runs the person consented to end", async () => {
    const { client, asked } = clientOf(async () => ({ stopping: true }));
    const outcome = await requestConsentedStop(
      client,
      { reason: "update", sessions: ["run-1"], native: false, toVersion: "0.9.0" },
      1_000,
    );
    expect(outcome).toEqual({ ok: true });
    expect(asked).toEqual([
      { method: "system.shutdown", params: { reason: "update", agents: { runs: ["run-1"] } } },
    ]);
  });

  it("at census zero it names none, and still asks fieldd to compare", async () => {
    const { client, asked } = clientOf(async () => ({ stopping: true }));
    await requestConsentedStop(client, { reason: "update", sessions: [], native: false }, 1_000);
    expect(asked[0]?.params).toEqual({ reason: "update", agents: { runs: [] } });
  });

  it("the floor's stop is unchanged: its sessions, and the version it installs", async () => {
    const { client, asked } = clientOf(async () => ({ stopping: true, native: "closed" }));
    const outcome = await requestConsentedStop(
      client,
      { reason: "update", sessions: ["s-1"], native: true, toVersion: "0.9.0" },
      1_000,
    );
    expect(outcome).toEqual({ ok: true, native: "closed" });
    expect(asked[0]?.params).toEqual({
      reason: "update",
      native: { stop: true, sessions: ["s-1"], toVersion: "0.9.0" },
    });
  });

  it("a run born after the census comes back as the live set fieldd holds, and nothing stopped", async () => {
    const { client } = clientOf(async () => {
      throw refusal("PRECONDITION_FAILED", { live: ["run-1", "run-2"], births: 0 });
    });
    const outcome = await requestConsentedStop(
      client,
      { reason: "update", sessions: ["run-1"], native: false },
      1_000,
    );
    expect(outcome).toMatchObject({ ok: false, live: ["run-1", "run-2"] });
  });
});

describe("readPlainCensus — fieldd's census of its own stop, ONE bounded snapshot (RV #6)", () => {
  it("asks fieldd's census door and reads its answer as the snapshot the person consents to", async () => {
    const { client, asked } = clientOf(async () => ({
      runs: [{ runId: "run-1", sessionId: "s-1", title: "task", cwd: "/w", agent: "Scripted" }],
    }));
    expect(await readPlainCensus(() => client)).toEqual({
      known: true,
      sessions: [{ sessionId: "run-1", title: "task", cwd: "/w", agent: "Scripted" }],
    });
    expect(asked.map((ask) => ask.method)).toEqual(["system.shutdown.census"]);
  });

  it("an older fieldd (no such door) holds: unknown, never zero", async () => {
    const { client } = clientOf(async () => {
      throw refusal("METHOD_NOT_FOUND");
    });
    expect(await readPlainCensus(() => client)).toEqual({ known: false });
  });

  it("a fieldd still re-attaching its runs holds: unknown", async () => {
    const { client } = clientOf(async () => {
      throw refusal("UNAVAILABLE", { service: "agents", state: "reattaching" });
    });
    expect(await readPlainCensus(() => client)).toEqual({ known: false });
  });

  it("an answer that is no census holds: unknown", async () => {
    const { client } = clientOf(async () => ({ runs: [{ runId: "run-1" }] }));
    expect(await readPlainCensus(() => client)).toEqual({ known: false });
  });

  it("no answer inside the bound is unknown, as the floor's census is", async () => {
    vi.useFakeTimers();
    const { client } = clientOf(() => new Promise<never>(() => undefined));
    const plain = readPlainCensus(() => client);
    const floor = readCensus(() => client);
    await vi.advanceTimersByTimeAsync(CENSUS_BOUND_MS);
    expect(await plain).toEqual({ known: false });
    expect(await floor).toEqual({ known: false });
  });

  it("a client that cannot be reached is unknown", async () => {
    expect(
      await readPlainCensus(async () => {
        throw new Error("fieldd is not running");
      }),
    ).toEqual({ known: false });
  });
});
