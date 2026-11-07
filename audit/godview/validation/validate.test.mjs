import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PINS, run, validateSchema } from "./validate.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PROVENANCE = join(ROOT, "audit/godview/contracts/provenance.schema.json");

function envelope(patch) {
  return {
    recordId: "prov.claude.status",
    pins: { ...PINS },
    adapterId: "adapter.claude",
    fieldId: "field.status",
    sources: [
      {
        repo: "puppeteer",
        sha: PINS.puppeteer,
        path: "packages/core/src/monitor/types.ts",
        lineStart: 51,
        lineEnd: 51,
        symbol: "AgentMonitorStatus",
      },
    ],
    producer: { kind: "core-reducer", name: "status", ingestedFrom: "adapter" },
    transforms: [],
    merge: { strategy: "unknown", defaults: [] },
    transport: { channel: "unknown", name: "unknown" },
    renderer: { viewIds: ["view.swarm"], component: "unknown", symbol: "unknown" },
    applicability: { states: "model-axes", views: "all-monitor-views" },
    absence: {
      onMissing: "record-unknown",
      onStale: "unknown",
      zeroPolicy: "unknown-unsupported-and-absent-are-not-zero",
    },
    observation: { presence: "unknown", synthetic: false },
    classification: {
      modelSupported: "unknown",
      adapterEmittable: "unknown",
      uiReachable: "unknown",
    },
    verification: { status: "unverified", owner: "GV-AUDIT2" },
    ...patch,
  };
}

test("foundation tree passes", () => {
  const report = run(ROOT);
  assert.equal(report.ok, true, JSON.stringify(report.failures, null, 2));
  assert.equal(report.pins.puppeteer, PINS.puppeteer);
  assert.equal(report.notShipped, "0.3.3");
  assert.equal(report.packageCheckVerifiedByThisSlice, false);
  assert.equal(report.warning, "NOT SHIPPED 0.3.3");
});

test("unknown observation cannot carry a literal zero", () => {
  const errors = validateSchema(
    PROVENANCE,
    envelope({ observation: { presence: "unknown", literal: 0, synthetic: false } }),
  );
  assert.ok(errors.length > 0);
});

test("observed zero is allowed only when marked", () => {
  const bad = validateSchema(
    PROVENANCE,
    envelope({ observation: { presence: "present", literal: 0, synthetic: false } }),
  );
  assert.ok(bad.length > 0);
  const good = validateSchema(
    PROVENANCE,
    envelope({
      observation: { presence: "present", literal: 0, zeroIsObserved: true, synthetic: false },
    }),
  );
  assert.deepEqual(good, []);
});

test("synthetic observation requires a label", () => {
  const errors = validateSchema(
    PROVENANCE,
    envelope({ observation: { presence: "present", synthetic: true } }),
  );
  assert.ok(errors.length > 0);
});

test("a claim that 0.3.3 equals the audit pin fails the manifest schema", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "audit/godview/contracts/manifest.json"), "utf8"),
  );
  manifest.notShippedPackage = {
    warning: "NOT SHIPPED 0.3.3. This fixture must fail closed.",
    shippedVersion: "0.3.3",
    shippedTag: "v0.3.3",
    shippedTagCommit: PINS.puppeteer,
    equivalentToAuditPin: true,
  };
  const errors = validateSchema(
    join(ROOT, "audit/godview/contracts/manifest.schema.json"),
    manifest,
  );
  assert.ok(errors.length > 0);
});
