import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_MISMATCHES,
  ENTRIES,
  FOUNDATION_COMMIT,
  HOLES,
  MODEL_COMMIT,
  PACKAGE_CONTEXT_COMMIT,
  PINS,
  SHIPPED_TAG_COMMIT,
  assertCoverage,
} from "./inputs.mjs";
import { matrix } from "./matrix.mjs";

assertCoverage();
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
      ...(painted ? { renderStatus: "rendered", screenshot } : { renderStatus: "pending-screenshot" }),
    };
  }),
  holes: HOLES,
  matrix: matrix().map(({ stateId, viewId, disposition, fixtureId }) => ({
    stateId,
    viewId,
    disposition,
    ...(fixtureId ? { fixtureId } : {}),
  })),
};
writeFileSync(join(import.meta.dirname, "integration.json"), `${JSON.stringify(integration, null, 2)}\n`);
process.stdout.write(`wrote ${ENTRIES.length} fixtures\n`);
