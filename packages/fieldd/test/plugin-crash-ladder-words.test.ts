import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SERVICE_QUARANTINE_AT } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";

// Item 432 — the crash ladder's count is one contracts constant: fieldd's service host takes its
// default from it, read here as text, so a number spelled again after `quarantineAt ??` fails.
// The window's half, its words, is field-app's own test (`plugins-words-ladder.test.ts` there), so
// each half is inside its own package's inputs.

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...path: string[]) => readFileSync(join(HERE, ...path), "utf8");

describe("the crash ladder's count (item 432)", () => {
  it("is three, as DESIGN.md §8 says it (three times in ten minutes)", () => {
    expect(PLUGIN_SERVICE_QUARANTINE_AT).toBe(3);
  });

  it("is fieldd's default, never a number spelled in the service host", () => {
    const host = read("..", "src", "service-host.ts");
    expect(host).toContain("quarantineAt ?? PLUGIN_SERVICE_QUARANTINE_AT");
    expect(host).not.toMatch(/quarantineAt \?\? \d/);
  });
});
