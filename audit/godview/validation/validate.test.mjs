import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MODEL_COMMIT, PACKAGE_CHECK_COMMIT, PINS, run, validateSchema } from "./validate.mjs";

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

test("foundation absence is incomplete and still valid", () => {
  const report = run(ROOT);
  assert.equal(report.ok, true, JSON.stringify(report.failures, null, 2));
  assert.equal(report.pins.puppeteer, PINS.puppeteer);
  assert.equal(report.notShipped, "0.3.3");
  assert.equal(report.packageCheckVerifiedByThisSlice, false);
  assert.equal(report.warning, "NOT SHIPPED 0.3.3");
  assert.equal(report.modelIntegration.status, "incomplete");
  assert.equal(report.modelIntegration.present.length, 0);
  assert.equal(report.modelIntegration.missing.length, 3);
  assert.equal(report.modelIntegration.packageCheck, "absent");
  assert.ok(report.waivers.some((item) => item.includes("model-slice incomplete")));
});

test("canonical integrated trio matches 49fc12da, including d53a0fa package context", () => {
  const trio = withSlice([
    "contracts/model.schema.json",
    "contracts/model.md",
    "contracts/model.validation.json",
  ]);
  assert.equal(trio.ok, true, JSON.stringify(trio.failures, null, 2));
  assert.equal(trio.modelIntegration.status, "matched");
  assert.equal(trio.modelIntegration.packageCheck, "absent");
  assert.equal(trio.modelIntegration.modelBytesIdenticalAtPackageCheckCommit, true);
  const combined = withSlice([
    "contracts/model.schema.json",
    "contracts/model.md",
    "contracts/model.validation.json",
    "validation/package-pin-check.md",
  ]);
  assert.equal(combined.ok, true, JSON.stringify(combined.failures, null, 2));
  assert.equal(combined.modelIntegration.status, "matched");
  assert.equal(combined.modelIntegration.packageCheck, "matched");
});

test("mismatched model file is rejected with hashes", () => {
  const report = withSlice(
    ["contracts/model.schema.json", "contracts/model.md", "contracts/model.validation.json"],
    (root) => {
      const path = join(root, "audit/godview/contracts/model.md");
      const bytes = readFileSync(path);
      bytes[bytes.length - 1] ^= 0xff;
      writeFileSync(path, bytes);
    },
  );
  assert.equal(report.ok, false);
  assert.equal(report.modelIntegration.status, "rejected");
  const failure = report.failures.find((item) => item.gate === "gate.model-slice-ref");
  assert.ok(failure, JSON.stringify(report.failures, null, 2));
  assert.match(failure.message, /contracts\/model\.md sha256 [0-9a-f]{64}/u);
  assert.match(failure.message, new RegExp(MODEL_COMMIT, "u"));
  assert.match(
    failure.message,
    /b7ce5ae9db6c50e3012f5ad84c0dd6fa735362b7536732756620672d292f2bb0/u,
  );
});

test("partial model file presence is rejected", () => {
  const report = withSlice(["contracts/model.md"]);
  assert.equal(report.ok, false);
  assert.equal(report.modelIntegration.status, "rejected");
  const failure = report.failures.find((item) => item.message.includes("partial model slice"));
  assert.ok(failure, JSON.stringify(report.failures, null, 2));
  assert.match(failure.message, /present contracts\/model\.md/u);
  assert.match(failure.message, /contracts\/model\.schema\.json/u);
  assert.match(failure.message, /contracts\/model\.validation\.json/u);
});

function withSlice(paths, mutate) {
  ensureCommit(MODEL_COMMIT);
  ensureCommit(PACKAGE_CHECK_COMMIT);
  const dir = mkdtempSync(join(tmpdir(), "gv-model-slice-"));
  cpSync(join(ROOT, "audit/godview"), join(dir, "audit/godview"), { recursive: true });
  try {
    for (const rel of paths) {
      const commit = rel.endsWith("package-pin-check.md") ? PACKAGE_CHECK_COMMIT : MODEL_COMMIT;
      const dest = join(dir, "audit/godview", rel);
      writeFileSync(
        dest,
        execFileSync("git", ["show", `${commit}:audit/godview/${rel}`], {
          cwd: ROOT,
          maxBuffer: 8 * 1024 * 1024,
        }),
      );
    }
    mutate?.(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function ensureCommit(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT, stdio: "ignore" });
  } catch {
    execFileSync("git", ["fetch", "origin", sha, "--depth=1"], { cwd: ROOT, stdio: "inherit" });
  }
}

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
