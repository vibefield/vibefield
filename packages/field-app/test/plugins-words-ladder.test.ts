// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SERVICE_QUARANTINE_AT } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { INSTALLED_LINE } from "../src/frame/plugins/plugins-words";

// Item 432 — the window says the crash ladder's count from the one contracts constant that
// fieldd's service host reads too (fieldd's half: `plugin-crash-ladder-words.test.ts` there).

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("the crash ladder's count in the plugins words (item 432)", () => {
  it("is the contracts constant, in the words a stopped plugin's row says", () => {
    expect(INSTALLED_LINE.stopped).toBe(
      `Stopped after ${PLUGIN_SERVICE_QUARANTINE_AT} crashes · turn it on to try again`,
    );
  });

  it("is never a number spelled in the words' own file", () => {
    const path = join(PACKAGE_ROOT, "src", "frame", "plugins", "plugins-words.ts");
    expect(readFileSync(path, "utf8")).not.toMatch(/after \d+ crashes/);
  });
});
