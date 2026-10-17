import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PHONE_BUDGET } from "../src/registries";

// SP-2 (g) — the phone's connection budget, as BUILT (SP-D12's terminal half
// ruled by FW-D2, 2026-10-16; the rest is OPEN). The kit mirrors these numbers
// as Swift literals and enforces them; `pnpm check:ios-fixtures` pins the
// mirror to this table verbatim, so a move here that the phone did not make is
// a red there, not a silent disagreement.

describe("SP-2 — PHONE_BUDGET, today's as-built numbers", () => {
  it("is one door per self desktop, three terminal lanes' legs, one web view", () => {
    expect(PHONE_BUDGET).toEqual({ DOORS_PER_DESKTOP: 1, TERMINAL_LEGS: 6, WEB_VIEWS: 1 });
  });

  it("counts terminal legs in whole attachments (a control leg and a frames leg each)", () => {
    // A routed attachment is a connection SET of exactly two legs (TPv3 §5.1),
    // so a leg budget that is not even could only ever be spent in halves.
    expect(PHONE_BUDGET.TERMINAL_LEGS % 2).toBe(0);
    for (const value of Object.values(PHONE_BUDGET)) {
      expect(Number.isInteger(value) && value > 0).toBe(true);
    }
  });

  it("is mirrored in the kit, and the mirror is pinned by the fixture check", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const swift = readFileSync(
      join(root, "apps/ios/VibeFieldKit/Sources/FieldProduct/PhoneBudget.swift"),
      "utf8",
    );
    const check = readFileSync(join(root, "scripts/check-ios-fixtures.mjs"), "utf8");
    for (const [key, swiftName] of [
      ["DOORS_PER_DESKTOP", "doorsPerDesktop"],
      ["TERMINAL_LEGS", "terminalLegs"],
      ["WEB_VIEWS", "webViews"],
    ] as const) {
      expect(swift).toContain(`public static let ${swiftName} = ${PHONE_BUDGET[key]}`);
      expect(check).toContain(`phoneBudgetPin("${key}", "${swiftName}")`);
    }
  });
});
