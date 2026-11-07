import { AUDIT_PINS, AUDIT_TARGET_LABEL } from "./contract.mjs";

/**
 * The package-pin report is context. This audit does not re-run it and does
 * not build shipped 0.3.3 coverage. The phrases below have to be present so
 * the notice is the report's verdict, not a paraphrase that drifted.
 */
const REQUIRED_PHRASES = [
  "52d09c8e84951b9a355a6700eac2dfc1290a9fa0",
  "748d015a",
  "691/691",
  "88 files differ",
  "4 commits after",
  ".d.ts files were not compared",
];

export function boundaryNotice(markdown) {
  const missing = REQUIRED_PHRASES.filter((phrase) => !markdown.includes(phrase));
  return {
    status: missing.length === 0 ? "context-only" : "report-unreadable",
    missing,
    producesShippedCoverage: false,
    auditedHere: false,
    auditTarget: AUDIT_TARGET_LABEL,
    puppeteerPin: AUDIT_PINS.puppeteer,
    vibefieldPin: AUDIT_PINS.vibefield,
    path: "audit/godview/validation/package-pin-check.md",
    summary:
      "Vibefield at the original pin installs @vibefield/puppeteer-* 0.3.3. package-pin-check.md reports those packages match tag v0.3.3 (52d09c8e, 691/691 compiled files) and that pinned source 748d015 is four commits later, with 88 compiled differences. That mismatch is context. This audit inventories pinned source 748d015 only.",
  };
}
