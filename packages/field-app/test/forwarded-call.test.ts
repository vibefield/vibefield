// @vitest-environment node
/**
 * DS-D15's client half, the window's side (`src/forwarded-call.ts`): one
 * logical call, resolved — an outcome-unknown is asked ONCE more with the key
 * its failure named; any other failure is the call's own answer; a receipt in
 * place of the answer is either said (a birth) or asked anew (a ticket).
 */
import { describe, expect, it, vi } from "vitest";
import { AnswerLostError, outcomeUnknownKey, requestResolvingOutcome } from "../src/forwarded-call";

const unknown = (key: string): Error =>
  Object.assign(new Error("its outcome is unknown"), {
    kind: "UNAVAILABLE",
    details: { service: "fieldd", state: "outcome-unknown", idempotencyKey: key },
    forward: { idempotencyKey: key },
  });

const receipt = (key: string) => ({
  idempotencyKey: key,
  method: "terminal.openTicket",
  device: "dev-b",
  state: "applied",
  at: 1,
  resultOmitted: true,
});

function client(answers: Array<() => unknown>) {
  const request = vi.fn(
    async (_method: string, _params: Record<string, unknown>, _opts?: unknown) => {
      const next = answers.shift();
      if (next === undefined) throw new Error("asked too often");
      return next();
    },
  );
  return { request };
}

describe("requestResolvingOutcome (DS-D15)", () => {
  it("one request when it answers; one request when it is refused — a refusal is the call's own answer", async () => {
    const ok = client([() => ({ ticket: 1 })]);
    expect(await requestResolvingOutcome(ok, "m.x", { a: 1 })).toEqual({ ticket: 1 });
    expect(ok.request.mock.calls).toEqual([["m.x", { a: 1 }]]);

    const refused = Object.assign(new Error("no"), { kind: "FORBIDDEN_SCOPE", details: {} });
    const no = client([
      () => {
        throw refused;
      },
    ]);
    await expect(requestResolvingOutcome(no, "m.x", { a: 1 })).rejects.toBe(refused);
    expect(no.request).toHaveBeenCalledTimes(1);
    expect(outcomeUnknownKey(refused)).toBeUndefined();
    // an outcome-unknown with no key to echo is not one this window can resolve
    expect(outcomeUnknownKey({ details: { state: "outcome-unknown" } })).toBeUndefined();
  });

  it("an outcome-unknown is asked once more with ITS key; a second is thrown as it came", async () => {
    const once = client([
      () => {
        throw unknown("wk_test_1");
      },
      () => ({ ticket: 2 }),
    ]);
    expect(await requestResolvingOutcome(once, "m.x", { a: 1 })).toEqual({ ticket: 2 });
    expect(once.request.mock.calls).toEqual([
      ["m.x", { a: 1 }],
      ["m.x", { a: 1 }, { idempotencyKey: "wk_test_1" }],
    ]);

    const second = unknown("wk_test_2");
    const twice = client([
      () => {
        throw unknown("wk_test_2");
      },
      () => {
        throw second;
      },
    ]);
    await expect(requestResolvingOutcome(twice, "m.x", { a: 1 })).rejects.toBe(second);
    expect(twice.request).toHaveBeenCalledTimes(2);
  });

  it("a receipt in place of the answer: said for a birth, asked ANEW (a fresh logical call) for a ticket", async () => {
    const birth = client([
      () => {
        throw unknown("wk_test_3");
      },
      () => receipt("wk_test_3"),
    ]);
    const lost = requestResolvingOutcome(birth, "agent.spawn", { device: "dev-b" });
    await expect(lost).rejects.toBeInstanceOf(AnswerLostError);
    await expect(lost).rejects.toMatchObject({
      method: "agent.spawn",
      idempotencyKey: "wk_test_3",
    });
    expect(birth.request).toHaveBeenCalledTimes(2);

    const ticket = client([
      () => {
        throw unknown("wk_test_4");
      },
      () => receipt("wk_test_4"),
      () => ({ ticket: "fresh" }),
    ]);
    expect(
      await requestResolvingOutcome(
        ticket,
        "terminal.openTicket",
        { device: "dev-b", sessionId: "s" },
        "ask-anew",
      ),
    ).toEqual({ ticket: "fresh" });
    // the third ask carries no key: the client mints a new one for a new call
    expect(ticket.request.mock.calls.map((call) => call[2])).toEqual([
      undefined,
      { idempotencyKey: "wk_test_4" },
      undefined,
    ]);
  });
});
