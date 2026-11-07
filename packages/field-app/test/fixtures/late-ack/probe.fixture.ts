import { beforeEach, expect, it } from "vitest";

// Item 213's probe rows, run only as a child over fixtures/late-ack/vitest.config.ts. LATE_ACK_FIXTURE picks the shape:
// `pass`, nothing goes wrong; `reject`, a real unhandled rejection; `stall`, row two's beforeEach holds the worker's
// loop 65 s while row one's finish is in flight, entered from a setImmediate as React's act enters the catalog's render.
const MODE = process.env.LATE_ACK_FIXTURE ?? "pass";
const STALL_MS = 65_000;

let row = 0;
beforeEach(() => {
  row += 1;
  if (MODE !== "stall" || row !== 2) return;
  const end = Date.now() + STALL_MS;
  let spins = 0;
  while (Date.now() < end) spins += 1;
  expect(spins).toBeGreaterThan(0);
}, 120_000);

it("row one (in `stall`, it outlasts the 100 ms update throttle and ends on a setImmediate)", async () => {
  if (MODE === "stall") {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(row).toBe(1);
});

it("row two", { timeout: 120_000 }, () => {
  if (MODE === "reject") void Promise.reject(new Error("a real unhandled rejection"));
  expect(row).toBe(2);
});
