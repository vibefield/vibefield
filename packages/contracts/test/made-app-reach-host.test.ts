// Item 525 (2026-11-18) — a made app's declared host is never an address in another spelling: the cross-language
// vector both checks read (the phone's copy is held byte-identical by check:ios-fixtures). Its `moved` rows are the
// ones this item turned from admitted to refused; every other row pins the rule as it already stood.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MadeAppReachHost } from "../src/artifacts";

interface Row {
  host: string;
  why: string;
  moved?: boolean;
}

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const vector = JSON.parse(
  readFileSync(join(fixtures, "made-app-reach-host.vector.json"), "utf8"),
) as {
  hosts: Row[];
  refused: Row[];
};

describe("item 525 — a declared host is never an address in another spelling", () => {
  it("accepts every host the vector names", () => {
    for (const row of vector.hosts) {
      expect(MadeAppReachHost.safeParse(row.host).success, `${row.host}: ${row.why}`).toBe(true);
    }
  });

  it("refuses every row it refused before this item, as it did", () => {
    for (const row of vector.refused.filter((each) => !each.moved)) {
      expect(MadeAppReachHost.safeParse(row.host).success, `${row.host}: ${row.why}`).toBe(false);
    }
  });

  it("refuses a last label of 0x and hex, a bare 0x included", () => {
    const moved = vector.refused.filter((each) => each.moved);
    expect(moved.length).toBe(6);
    for (const row of moved) {
      expect(MadeAppReachHost.safeParse(row.host).success, `${row.host}: ${row.why}`).toBe(false);
    }
  });
});
