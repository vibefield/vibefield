import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupLedger, setupTutorialsUnread } from "@vibefield/contracts/setup";
import type { FielddClient } from "@vibefield/fieldd-client";
import { describe, expect, it, vi } from "vitest";
import { recordTutorial, tutorialRecord, tutorialShown } from "../src/setup/ledger";

// SH-1 — the window's half of a tutorial chapter's record (DESIGN.md §8 "Tutorials", "Kept"): it
// reads the same golden ledger fieldd's store reads (EL9), shows "paused" and "left" from a started
// row and never writes them, and sends exactly what fieldd's door parses.

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "fixtures",
  "setup-ledger-tutorials.valid.json",
);

describe("a tutorial chapter's record, in a window (SH-1)", () => {
  it("reads the golden ledger's rows, and names the one a newer build wrote (EL9)", () => {
    const ledger = SetupLedger.parse(JSON.parse(readFileSync(GOLDEN, "utf8")));
    expect(tutorialRecord(ledger, "your-desk")?.state).toBe("finished");
    expect(tutorialRecord(ledger, "godview")).toMatchObject({
      state: "started",
      step: 1,
      steps: 3,
    });
    expect(tutorialRecord(ledger, "chat")?.state).toBe("declined");
    expect(tutorialRecord(ledger, "search")?.state).toBe("offered");
    expect(tutorialRecord(ledger, "your-hand")).toBeUndefined();
    expect(setupTutorialsUnread(ledger)).toEqual(["your-hand"]);
    expect(tutorialRecord(null, "your-desk")).toBeUndefined();
  });

  it("shows paused and left from a started row, and every other state as written", () => {
    const at = "2026-11-19T00:00:00.000Z";
    const started = { state: "started" as const, at, step: 1, steps: 3 };
    expect(tutorialShown(undefined, null)).toBe("none");
    expect(tutorialShown({ state: "offered", at }, null)).toBe("offered");
    expect(tutorialShown({ state: "declined", at }, null)).toBe("declined");
    expect(tutorialShown({ state: "finished", at }, null)).toBe("finished");
    expect(tutorialShown(started, null)).toBe("left");
    expect(tutorialShown(started, { paused: false })).toBe("running");
    expect(tutorialShown(started, { paused: true })).toBe("paused");
  });

  it("sends fieldd exactly a chapter's answer, with step and steps for started alone", async () => {
    const request = vi.fn(async () => ({}));
    const client = { request } as unknown as FielddClient;
    await recordTutorial(client, "godview", { state: "declined" });
    await recordTutorial(client, "your-desk", { state: "started", step: 2, steps: 4 });
    expect(request.mock.calls).toEqual([
      ["setup.tutorial", { chapter: "godview", state: "declined" }],
      ["setup.tutorial", { chapter: "your-desk", state: "started", step: 2, steps: 4 }],
    ]);
  });
});
