import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FAILURE_CODES_UNDER_CONTRACT,
  FAILURE_MATRIX,
  machineCoverage,
  TERMINAL_PIPELINE_MACHINES,
} from "../src/terminal-pipeline-machines";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("§20 item 2 — the state-transition tables are TOTAL, deterministic and closed", () => {
  for (const table of TERMINAL_PIPELINE_MACHINES) {
    it(`${table.name}: every (state, event) pair is a transition, an ignored no-op or a refusal`, () => {
      const c = machineCoverage(table);
      expect(c.dangling, "dangling state/event references").toEqual([]);
      expect(
        c.uncovered,
        "uncovered (state, event) pairs — 'handled elsewhere' is not allowed",
      ).toEqual([]);
      expect(c.ambiguous, "two default rows, or a default row that is not last").toEqual([]);
      expect(c.leakyAbsorbing, "an absorbing state with an exit").toEqual([]);
      expect(table.states).toContain(table.initial);
      for (const s of table.absorbing) expect(table.states).toContain(s);
      // ignored/refused pairs name real states and events
      for (const [s, e] of [...table.ignored, ...table.refused]) {
        expect(table.states, `${table.name}: ignored/refused state ${s}`).toContain(s);
        expect(table.events, `${table.name}: ignored/refused event ${e}`).toContain(e);
      }
      // no pair is both ignored and refused
      const ignored = new Set(table.ignored.map(([s, e]) => `${s} ${e}`));
      for (const [s, e] of table.refused) expect(ignored.has(`${s} ${e}`)).toBe(false);
    });
  }

  it("the activation machine names the cell's two dimensions as inputs and the two predicates as outputs", () => {
    const activation = TERMINAL_PIPELINE_MACHINES.find((m) => m.name === "activation");
    expect(activation).toBeDefined();
    const guards = activation!.transitions
      .filter((t) => t.event === "cell-status")
      .map((t) => t.guard ?? "");
    expect(guards.some((g) => g.includes("presentation = presenting"))).toBe(true);
    expect(guards.some((g) => g.includes("presentation = stopped"))).toBe(true);
    expect(guards.some((g) => g.includes("presentation = revoked"))).toBe(true);
    expect(activation!.outputs?.presenting).toContain("InputAllowed");
  });
});

describe("§20 item 3 — the failure matrix covers every code the wire can name", () => {
  it("names every pre-auth, refusal, geometry, seed-required and close code exactly once per family", () => {
    const byFamily = (family: string) =>
      FAILURE_MATRIX.filter((r) => r.family === family).map((r) => r.code);
    expect(byFamily("pre-auth").sort()).toEqual([...FAILURE_CODES_UNDER_CONTRACT.preAuth].sort());
    expect(byFamily("connection-refusal").sort()).toEqual(
      [...FAILURE_CODES_UNDER_CONTRACT.connectionRefusal].sort(),
    );
    expect(byFamily("attach-refusal").sort()).toEqual(
      [...FAILURE_CODES_UNDER_CONTRACT.attachRefusal].sort(),
    );
    expect(byFamily("geometry-refusal").sort()).toEqual(
      [...FAILURE_CODES_UNDER_CONTRACT.geometryRefusal].sort(),
    );
    expect(byFamily("seed-required").sort()).toEqual(
      [...FAILURE_CODES_UNDER_CONTRACT.seedRequired].sort(),
    );
    expect(byFamily("close-code").sort()).toEqual(
      [...FAILURE_CODES_UNDER_CONTRACT.closeCodes].sort(),
    );
    for (const family of [
      "pre-auth",
      "connection-refusal",
      "attach-refusal",
      "geometry-refusal",
      "seed-required",
      "close-code",
      "envelope-decode",
    ]) {
      const codes = byFamily(family);
      expect(new Set(codes).size, `${family} has duplicate rows`).toBe(codes.length);
    }
  });
  it("every pre-auth row is SILENT on the wire and every row names who retries and what the user sees", () => {
    for (const row of FAILURE_MATRIX) {
      expect(row.how.length).toBeGreaterThan(0);
      expect(row.userFace.length).toBeGreaterThan(0);
      expect(row.audit.length).toBeGreaterThan(0);
      if (row.family === "pre-auth") expect(row.wire).toMatch(/silent close 1008/);
    }
  });
});

describe("the published form — fixtures/tp-machines.vector.json is the tables, byte for byte", () => {
  it("matches the module (regenerate the fixture when the tables change — deliberately, as a diff)", () => {
    const published = JSON.parse(readFileSync(join(FIXTURES, "tp-machines.vector.json"), "utf8"));
    expect(published.machines).toEqual(JSON.parse(JSON.stringify(TERMINAL_PIPELINE_MACHINES)));
    expect(published.failureMatrix).toEqual(JSON.parse(JSON.stringify(FAILURE_MATRIX)));
  });
});
