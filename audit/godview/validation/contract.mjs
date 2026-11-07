/**
 * GV-AUDIT6 loader constants.
 *
 * The audit target is pinned Puppeteer source. It is newer than the 0.3.3
 * package Vibefield ships. Shipped-package mismatch is context from
 * `package-pin-check.md`, which this slice does not rewrite and does not turn
 * into a second inventory.
 */

export const SLICE = "GV-AUDIT6";
export const INDEX_CONTRACT = "gv-audit6/index@1";
export const LOADER_CONTRACT = "gv-audit6/loader@1";
export const HARNESS_CONTRACT = "gv-audit6/rendering-harness@1";

export const AUDIT_PINS = Object.freeze({
  vibefield: "433505fd0f224f4cda540d642661b13848c0ef82",
  puppeteer: "748d015a7e393112e0a91dad80111fdf5abe6583",
});

/** Short label the page repeats. The full pin is always shown beside it. */
export const AUDIT_TARGET_LABEL =
  "Pinned Puppeteer source 748d015, newer than the 0.3.3 package Vibefield ships";

export const PROVENANCE_STAGES = Object.freeze([
  "producer",
  "transforms",
  "defaults",
  "merge",
  "transport",
  "renderer",
]);

/** How a traced value or fixture says it was obtained. Omission stays unknown. */
export const CLASSIFICATIONS = Object.freeze([
  "code-reachable",
  "synthetic",
  "unsupported",
  "missing",
  "stale",
  "unknown",
  "inapplicable",
  "pending",
]);

export const COVERAGE_CLAIM = Object.freeze({
  cartesianComplete: false,
  semanticValidation: false,
  runtimeEquivalence: false,
  producesShippedCoverage: false,
  endToEndProven: false,
  reason:
    "Loaded rows are the model contract's orthogonal inventory plus whatever traces and renders actually arrived. They are not a Cartesian state space, not semantic proof, and not a claim that Vibefield's installed 0.3.3 packages equal pinned source 748d015.",
});

export const SOURCE_LAYOUT = Object.freeze({
  schema: "audit/godview/contracts/model.schema.json",
  narrative: "audit/godview/contracts/model.md",
  validationReport: "audit/godview/contracts/model.validation.json",
  packagePinReport: "audit/godview/validation/package-pin-check.md",
  evidenceDirectory: "audit/godview/evidence",
  renderingManifest: "audit/godview/rendering/manifest.json",
  renderingDirectory: "audit/godview/rendering",
});

export const REQUIRED_COUNTS = Object.freeze({
  statusEnumValues: 3,
  stateEntries: 82,
  fieldEntries: 74,
  apiEntries: 19,
  views: 5,
  adapters: 10,
  declaredCapabilityCells: 90,
});

export const PRODUCTION_SEAM = Object.freeze({
  monitorAgent: "packages/field-app/src/godview/monitor/types.ts",
  windowRows: "packages/field-app/src/godview/monitor/window-rows.ts",
  host: "packages/field-app/src/godview/GodviewMonitor.tsx",
  note: "VibeField aliases MonitorAgent to Puppeteer's AgentView and patches display rows in window-rows. The five views are Puppeteer's. This page mounts only a team-5 harness and does not draw a replacement monitor.",
});
