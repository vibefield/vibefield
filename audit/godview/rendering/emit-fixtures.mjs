import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertCoverage,
  CONTRACT_MISMATCHES,
  ENTRIES,
  FOUNDATION_COMMIT,
  HOLES,
  MODEL_COMMIT,
  PACKAGE_CONTEXT_COMMIT,
  PINS,
  SHIPPED_TAG_COMMIT,
} from "./inputs.mjs";
import { matrix, matrixSummary } from "./matrix.mjs";

assertCoverage();
const integrationPath = join(import.meta.dirname, "integration.json");
const previous = existsSync(integrationPath)
  ? JSON.parse(readFileSync(integrationPath, "utf8"))
  : {};
const previousPaint = new Map(
  (previous.fixtures ?? [])
    .filter((item) => item.paint)
    .map((item) => [item.fixtureId, item.paint]),
);
function evidence(name) {
  const file = join(import.meta.dirname, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
const root = join(import.meta.dirname, "..", "fixtures");
mkdirSync(root, { recursive: true });
for (const entry of ENTRIES) {
  const file = join(root, `${entry.fixtureId}.json`);
  writeFileSync(file, `${JSON.stringify(entry.envelope, null, 2)}\n`);
}
const integration = {
  kind: "frontend-render-index",
  fidelity: "puppeteer-source",
  sourceSha: PINS.puppeteer,
  newerThanShippedPackage: "0.3.3",
  shippedTagCommit: SHIPPED_TAG_COMMIT,
  shippedPackageRendered: false,
  modelCommit: MODEL_COMMIT,
  packageContextCommit: PACKAGE_CONTEXT_COMMIT,
  foundationCommit: FOUNDATION_COMMIT,
  vibefieldSha: PINS.vibefield,
  entry: "audit/godview/rendering/index.html",
  query: "fixture=<fixtureId>",
  mount:
    "MonitorViewHost plus the registry view from Puppeteer source packages/views at sourceSha. The checkout is audit/godview/rendering/.pin/puppeteer and is not the installed npm package.",
  contractMismatches: CONTRACT_MISMATCHES,
  fixtures: ENTRIES.map((entry) => {
    const screenshot = `audit/godview/rendering/screenshots/${entry.fixtureId}.png`;
    const painted = existsSync(join(import.meta.dirname, "screenshots", `${entry.fixtureId}.png`));
    return {
      fixtureId: entry.fixtureId,
      viewId: entry.viewId,
      lifecycleStates: [entry.stateId],
      file: `audit/godview/fixtures/${entry.fixtureId}.json`,
      requiresBodyPaint: entry.requiresBodyPaint,
      interact: entry.interact,
      ...(painted
        ? {
            renderStatus: "rendered",
            ...(previousPaint.has(entry.fixtureId)
              ? { paint: previousPaint.get(entry.fixtureId) }
              : {}),
            screenshot,
          }
        : { renderStatus: "pending-screenshot" }),
    };
  }),
  holes: HOLES,
  matrixSummary: matrixSummary(),
  matrix: matrix().map((cell) => ({
    stateId: cell.stateId,
    viewId: cell.viewId,
    disposition: cell.disposition,
    ...(cell.fixtureId ? { fixtureId: cell.fixtureId } : {}),
    ...(cell.exercise ? { exercise: cell.exercise } : {}),
    evidence: cell.evidence,
  })),
};
if ("swarmBodyPaint" in previous) integration.swarmBodyPaint = previous.swarmBodyPaint;
const spanEvidence = evidence("timeline-span-evidence.json");
const endedEvidence = evidence("timeline-ended-evidence.json");
if (spanEvidence) integration.timelineSpanEvidence = spanEvidence;
if (endedEvidence) integration.timelineEndedEvidence = endedEvidence;
writeFileSync(integrationPath, `${JSON.stringify(integration, null, 2)}\n`);
process.stdout.write(`wrote ${ENTRIES.length} fixtures\n`);
