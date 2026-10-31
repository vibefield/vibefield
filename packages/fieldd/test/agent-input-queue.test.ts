import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentInputQueues,
  type DeliveryOutcome,
  type DeliveryReceipt,
  markedText,
} from "../src/agent-input-queue";

// CP-2 — every session's one input queue (CP-L5; `draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31): idle-only
// delivery, one input per idle moment, the text marked by its source (CP2-D1), a receipt deciding the head (CP2-D2),
// and the queue kept across a fieldd restart (CP2-D3).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(receipts: DeliveryReceipt[] = [], dir?: string) {
  const root = dir ?? mkdtempSync(join(tmpdir(), "vf-inputs-"));
  if (dir === undefined) dirs.push(root);
  const inputs = join(root, "inputs");
  const idle = new Set<string>();
  const delivered: { run: string; text: string }[] = [];
  const outcomes: { run: string; text: string; outcome: DeliveryOutcome; reason?: string }[] = [];
  const queues = new AgentInputQueues({
    dir: inputs,
    deliver: async (run, text) => {
      delivered.push({ run, text });
      return receipts.shift() ?? { status: "confirmed" };
    },
    isIdle: (run) => idle.has(run),
    onOutcome: (run, input, outcome, reason) =>
      outcomes.push({ run, text: input.text, outcome, ...(reason ? { reason } : {}) }),
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { root, inputs, queues, idle, delivered, outcomes, flush };
}

const VELA = { kind: "spark", spark: "sp-1111111111111111", name: "Vela" } as const;

describe("the input queue (CP-L5, CP-2)", () => {
  it("marks a spark's words as its own on the person's behalf, and a wake as VibeField's (CP2-D1)", () => {
    expect(markedText({ id: "a", text: "run the tests", from: VELA, at: "t" })).toBe(
      "Vela (your spark) on your behalf:\nrun the tests",
    );
    expect(markedText({ id: "b", text: "Ada finished", from: { kind: "fieldd" }, at: "t" })).toBe(
      "VibeField: Ada finished",
    );
  });

  it("holds an input while the session works, and delivers one at each idle moment, in order", async () => {
    const h = harness();
    expect(h.queues.enqueue("run-1", "first", VELA)).toEqual({ position: 1 });
    expect(h.queues.enqueue("run-1", "second", VELA)).toEqual({ position: 2 });
    await h.flush();
    expect(h.delivered).toEqual([]);
    h.idle.add("run-1");
    await h.queues.poke("run-1");
    expect(h.delivered.map((d) => d.text)).toEqual(["Vela (your spark) on your behalf:\nfirst"]);
    // the delivered input started a turn; the second waits for that turn's end
    expect(h.queues.pending("run-1").map((i) => i.text)).toEqual(["second"]);
    await h.queues.poke("run-1");
    expect(h.delivered).toHaveLength(2);
    expect(h.outcomes.map((o) => o.outcome)).toEqual(["delivered", "delivered"]);
  });

  it("keeps a rejected input for the next idle, and never sends an uncertain one again (CP2-D2)", async () => {
    const h = harness([
      { status: "rejected", reason: "a dialog is open" },
      { status: "uncertain", reason: "no echo" },
    ]);
    h.idle.add("run-1");
    h.queues.enqueue("run-1", "careful", VELA);
    await h.flush();
    expect(h.queues.pending("run-1")).toHaveLength(1);
    await h.queues.poke("run-1");
    expect(h.queues.pending("run-1")).toHaveLength(0);
    await h.queues.poke("run-1");
    expect(h.delivered).toHaveLength(2);
    expect(h.outcomes).toEqual([
      { run: "run-1", text: "careful", outcome: "waiting", reason: "a dialog is open" },
      { run: "run-1", text: "careful", outcome: "uncertain", reason: "no echo" },
    ]);
  });

  it("keeps the queue across a restart: one file per session, 0600 in 0700, read back whole (CP2-D3)", async () => {
    const h = harness();
    h.queues.enqueue("run-1", "after the restart", VELA);
    h.queues.enqueue("run-2", "and here", VELA);
    expect(readdirSync(h.inputs).sort()).toEqual(["run-1.json", "run-2.json"]);
    expect(statSync(h.inputs).mode & 0o777).toBe(0o700);
    expect(statSync(join(h.inputs, "run-1.json")).mode & 0o777).toBe(0o600);
    const again = harness([], h.root);
    expect(again.queues.restore()).toBe(2);
    again.idle.add("run-1");
    await again.queues.poke("run-1");
    expect(again.delivered.map((d) => d.text)).toEqual([
      "Vela (your spark) on your behalf:\nafter the restart",
    ]);
    // a delivered queue's file goes
    expect(existsSync(join(h.inputs, "run-1.json"))).toBe(false);
  });

  it("drops what waited for a session that ended, telling each sender, and removes its file", () => {
    const h = harness();
    h.queues.enqueue("run-1", "too late", VELA);
    h.queues.forget("run-1");
    expect(h.outcomes).toEqual([{ run: "run-1", text: "too late", outcome: "dropped" }]);
    expect(existsSync(join(h.inputs, "run-1.json"))).toBe(false);
  });

  it("joins wakes that wait into one line, and keeps a spark's words apart from them (CP-D4)", () => {
    const h = harness();
    h.queues.wake("run-spark", "Ada finished");
    h.queues.wake("run-spark", "Ben is asking you");
    h.queues.enqueue("run-spark", "a word", VELA);
    h.queues.wake("run-spark", "Cy failed");
    expect(h.queues.pending("run-spark").map((i) => i.text)).toEqual([
      "Ada finished · Ben is asking you",
      "a word",
      "Cy failed",
    ]);
  });
});
