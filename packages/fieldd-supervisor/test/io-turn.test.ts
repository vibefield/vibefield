import { describe, expect, it } from "vitest";
import { afterIoTurn } from "../src/index";

// Item 212 (RV #30, gap3-2) — WG-E1 (thinking-floor-wedge.md §4) on the shell's side of the link. A deadline's timer
// fires in the event loop's timers phase, BEFORE the poll phase reads a reply already waiting on its socket, so the
// verdict waits one turn of I/O. Two timers that are both due when the loop reads its clock fire in ONE timers phase
// (microtasks run between them, a setImmediate never does): the shape of a deadline that fires while its reply sits
// unread. Two `setTimeout(…, 0)` in one block do not promise that by themselves: Node stamps each with the loop's
// clock read afresh, so they can straddle a millisecond, and then the second waits for the next turn. `bothDue` holds
// this thread until both are due before it hands the thread back to the loop: a precondition held, never a wait on an
// event. No sleep decides anything here; the loop's own phase order does.

/** Hold the thread past the 1 ms every `setTimeout(…, 0)` armed just before it is given (Node's floor for a delay),
 * so when the loop next reads its clock each of them is due and ONE timers phase runs them all. */
function bothDue(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
}

describe("afterIoTurn: a timeout verdict waits one turn of I/O (WG-E1)", () => {
  it("without it, a deadline that fires first beats a reply in the same turn (the defect's shape)", async () => {
    const verdict = await new Promise<string>((resolve) => {
      setTimeout(() => resolve("timeout"), 0);
      setTimeout(() => resolve("ready"), 0);
      bothDue();
    });
    expect(verdict).toBe("timeout");
  });

  it("through it, the reply in the same turn wins", async () => {
    expect(typeof afterIoTurn).toBe("function");
    const verdict = await new Promise<string>((resolve) => {
      setTimeout(() => afterIoTurn(() => resolve("timeout")), 0);
      setTimeout(() => resolve("ready"), 0);
      bothDue();
    });
    expect(verdict).toBe("ready");
  });

  it("with no reply, the verdict still comes, one setImmediate later", async () => {
    expect(typeof afterIoTurn).toBe("function");
    const seen: string[] = [];
    await new Promise<void>((resolve) => {
      afterIoTurn(() => seen.push("verdict"));
      setImmediate(() => {
        seen.push("the next immediate");
        resolve();
      });
      queueMicrotask(() => seen.push("microtask"));
      seen.push("caller");
    });
    expect(seen).toEqual(["caller", "microtask", "verdict", "the next immediate"]);
  });
});
