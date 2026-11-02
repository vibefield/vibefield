import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  computePhoneGoldens,
  goldenChanges,
  PHONE_GOLDEN_MIRRORS,
  PHONE_GOLDENS_DIR,
  phoneAllGoldenFiles,
  readWitnessInputs,
} from "./lib/phone-goldens";

// WRITE THE PHONE'S PARITY GOLDENS (PG-3a): the home's window over the witness wire goldens
// (`perf/lib/phone-goldens.ts`), into `test/fixtures/phone-godview/`, pinned byte for byte by
// `test/phone-parity.test.ts`. The ONE writer of those files (biome is told to leave them), so a
// diff reads one row per line. Every regeneration is a re-bless: this prints what moved, by step
// and field, for the commit body to say, with the kit's copies to refresh. PG-4s: every phone golden, through
// the one writer (`phoneAllGoldenFiles`): fold, body, the toolkit's, and one per registered view.
//
//   pnpm --filter @vibefield/field-app phone:goldens

describe("the phone's parity goldens", () => {
  it("writes every phone golden: fold, body, the toolkit's and each registered view's", async () => {
    const files = await phoneAllGoldenFiles(await computePhoneGoldens(readWitnessInputs()));
    mkdirSync(PHONE_GOLDENS_DIR, { recursive: true });
    const report: string[] = [];
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(PHONE_GOLDENS_DIR, name);
      let before: string | null = null;
      try {
        before = readFileSync(path, "utf8");
      } catch {
        before = null;
      }
      writeFileSync(path, bytes);
      const moved =
        before === null ? ["a new golden: its first bless"] : goldenChanges(before, bytes);
      const verdict = before === null ? "WRITTEN" : moved.length === 0 ? "unchanged" : "RE-BLESSED";
      report.push(`${name}: ${verdict} (${Buffer.byteLength(bytes)} bytes)`);
      for (const line of moved) report.push(`  ${line}`);
      if (moved.length > 0)
        for (const folder of PHONE_GOLDEN_MIRRORS[name] ?? [])
          report.push(
            `  then: cp packages/field-app/test/fixtures/phone-godview/${name} ${folder}/${name}`,
          );
    }
    process.stdout.write(`${report.join("\n")}\n`);
  });
});
