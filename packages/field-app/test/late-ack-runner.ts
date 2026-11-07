import { type VitestRunner, VitestTestRunner } from "vitest/runners";

// ITEM 213 (2026-11-07): the worker's late ack to a progress report is not a red.
//
// Every call vitest's worker makes to the main process gets 60 s for its reply (birpc's DEFAULT_TIMEOUT; vitest 3.2.7
// passes none and offers no option for it), and the timer runs in the WORKER. A test that holds the worker's event loop
// past 60 s leaves a reply unread until the timer fires: design-system.test.tsx renders the whole catalog in one
// synchronous stretch, 20–111 s a row on a loaded CI runner against 2–4 s on a Mac. The call is `onTaskUpdate`, a
// progress report the worker posts in the same step that arms the timer, so the main process has it and every result
// arrives; its reply carries nothing. Yet the rejection is kept until the file's end and reds the run with every test
// passed — six verifies from 2026-10-30 to 11-07, none of them a failure.
//
// This runner drops exactly that rejection and passes every other rejection of `onTaskUpdate` through, so the run still
// reds on it. Other calls' timeouts and a test's own unhandled errors never pass through here and are untouched.
// late-ack-runner.test.ts holds the filter, and a real run through it (fixtures/late-ack).
// One case is lost, and no code here can recover it: when the main process's reporter throws on that same update, its
// error arrives only as the late reply, which birpc has already dropped.
//
// RETIRE IT when vitest makes the worker's RPC timeout configurable, or when design-system.test.tsx stops rendering the
// whole catalog in every row (item 213's second half), whichever comes first.

/** The one message this runner drops: birpc's timeout for the worker's `onTaskUpdate` call, exactly. */
export const LATE_ACK = '[vitest-worker]: Timeout calling "onTaskUpdate"';

type TaskUpdate = NonNullable<VitestRunner["onTaskUpdate"]>;

// By tag, not `instanceof`: under a vm pool the rejection's Error comes from the outer realm.
function isLateAck(error: unknown): boolean {
  return (
    Object.prototype.toString.call(error) === "[object Error]" &&
    (error as Error).message === LATE_ACK
  );
}

/** `send`, except that its late-ack rejection resolves; every other rejection passes through unchanged. */
export function dropLateAck(send: TaskUpdate): TaskUpdate {
  return (packs, events) =>
    send(packs, events).catch((error: unknown) => {
      if (!isLateAck(error)) throw error;
    });
}

export default class LateAckRunner extends VitestTestRunner {
  // vitest assigns its RPC-calling `onTaskUpdate` to the instance after constructing it, then calls `onBeforeCollect`
  // before any task reports, so it is wrapped there. The base class declares no such member, hence the `declare`
  // (nothing is emitted for it). A worker that runs several files wraps it again per file, which only nests the filter.
  declare onTaskUpdate?: TaskUpdate;

  onBeforeCollect(): void {
    if (this.onTaskUpdate !== undefined) this.onTaskUpdate = dropLateAck(this.onTaskUpdate);
  }
}
