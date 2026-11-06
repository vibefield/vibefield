// CP-4a2a (the review's findings 5, 6, 10 and H2b) — a run on the REAL flow host for the rows that need its far end:
// fieldd's own build of `flows-host.cjs` (flows-host-bundle.ts), started by the supervisor from
// PATH_ONLY (PATH and no smoke's run mark, so the child holds PATH alone), its calls
// answered by a scripted handler that keeps what it heard. Test-local, beside flows-host.test.ts's own harness, which
// stays that suite's.
import { afterEach } from "vitest";
import {
  type FlowCallHandler,
  type FlowHostAnswer,
  type FlowHostCall,
  type FlowHostEnd,
  type FlowHostRun,
  startFlowHost,
} from "../src/flows/supervisor";
import { flowsHostLaunch } from "./flows-host-bundle";

const WAIT_MS = 20_000;
const PATH_ONLY = { PATH: process.env["PATH"] ?? "/usr/bin:/bin" };

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

const runs: FlowHostRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.stop()));
});

/** What a run heard and how it ended: its calls (the handler's received args), its log lines, and its end, or
 * "timeout" past the bound (the row asserts which it got, never the test's own timeout). */
export interface RunHeard {
  readonly calls: FlowHostCall[];
  readonly logs: string[];
  readonly end: FlowHostEnd | "timeout";
}

/** Run `bytes` on a real host, every call answered `{ ok: true, value: "ok" }` unless `answer` says otherwise. */
export async function runOnHost(
  bytes: Uint8Array,
  answer: (call: FlowHostCall) => FlowHostAnswer = () => ({ ok: true, value: "ok" }),
): Promise<RunHeard> {
  const calls: FlowHostCall[] = [];
  const logs: string[] = [];
  const handler: FlowCallHandler = {
    call(call) {
      calls.push(call);
      return Promise.resolve(answer(call));
    },
    log(text) {
      logs.push(text);
    },
  };
  const run = startFlowHost({
    launch: { kind: "launch", launch: await flowsHostLaunch() },
    bytes,
    input: {},
    handler,
    environment: PATH_ONLY,
  });
  runs.push(run);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), WAIT_MS);
  });
  try {
    const end = await Promise.race([run.ended, late]);
    return { calls, logs, end };
  } finally {
    clearTimeout(timer);
  }
}
