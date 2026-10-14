// DEBTS (s-debts-fieldd.md Appendix 3) — an agent's birth over the REAL floor,
// retried inside its row's budget. Under load a real-floor row's `agent.spawn`
// or `agent.resume` met UNAVAILABLE "the terminal floor is not available"
// (`state: absent`, retryable) before the floor's endpoints had landed — the
// birth-race class the kill matrix cured with `createRetrying`
// (terminal-kill-matrix.test.ts), met again in MF-1f/MF-1g (LANDED "PJ-6, the
// launch") and QL-D10 (the MV lead's gate, 2026-10-14).
//
// What is retried is exactly a refusal that started nothing: retryable
// UNAVAILABLE with no run in its details. A run born whose ticket could not be
// minted (`bornWithoutTicket`: its details name the run) is never retried — a
// second birth would be a second agent — and every other refusal is the row's
// to read, at once. A retried birth says so on stderr, with each refusal.
import type { RpcErrorShape } from "./ws-rpc";

/** A row's whole budget for one birth, unless it names its own. */
export const BIRTH_BUDGET_MS = 30_000;

/** Whether a refusal started nothing and may be asked again. */
export function retryableBirthRefusal(refusal: RpcErrorShape | undefined): boolean {
  const data = refusal?.data;
  if (data?.kind !== "UNAVAILABLE" || data.retryable !== true) return false;
  const details = data.details as { runtimeRunId?: unknown } | undefined;
  return details?.runtimeRunId === undefined;
}

/** `agent.spawn` or `agent.resume`, asked again while the floor is not there
 * yet, inside `budgetMs`; the last refusal is thrown when the budget is spent. */
export async function born(
  rpc: { call(method: string, params: unknown): Promise<unknown> },
  method: "agent.spawn" | "agent.resume",
  params: Record<string, unknown>,
  budgetMs: number = BIRTH_BUDGET_MS,
  opts: { pauseMs?: number; now?: () => number; warn?: (line: string) => void } = {},
): Promise<unknown> {
  const now = opts.now ?? Date.now;
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const deadline = now() + budgetMs;
  for (let attempt = 1; ; attempt++) {
    try {
      const answer = await rpc.call(method, params);
      if (attempt > 1) warn(`${method} was born on attempt ${attempt}`);
      return answer;
    } catch (error) {
      const refusal = (error as { rpc?: RpcErrorShape }).rpc;
      if (!retryableBirthRefusal(refusal) || now() > deadline) throw error;
      warn(
        `${method} attempt ${attempt} refused, retrying: ${(error as Error).message} ${JSON.stringify(refusal?.data)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, opts.pauseMs ?? 250));
    }
  }
}
