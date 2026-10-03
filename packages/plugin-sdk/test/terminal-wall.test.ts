import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// EL7 — same-uid agents are the adversary. The window's terminal pool stays inside
// the terminal trust boundary: exporting it, a runtime, or a mirror surface through
// this SDK would hand them to every third-party plugin. The row was written for the
// host's built-in terminal mirror (TP-S2b-widget, TPv3 §17 mark 21 = (a): the mirror
// was registered by the HOST, outside the SDK, precisely so this stayed true). The
// mirror retired at DK-5 (DK-D19 — the deck owns terminals; a session tag returns
// under PORTALS), and the wall outlives it here, beside the SDK it guards: a terminal
// door for plugins is mark 21 (b) and needs its own capability design.
describe("the SDK hands plugins no terminal (EL7)", () => {
  it("exports no terminal pool, runtime or mirror", () => {
    const dir = new URL("../src/", import.meta.url);
    const source = readdirSync(dir)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => readFileSync(new URL(file, dir), "utf8"))
      .join("\n");
    for (const forbidden of [
      "terminal/pool",
      "useTerminalPool",
      "TerminalMirrorSurface",
      "watchOnlyRuntime",
      "ghosttea",
    ]) {
      expect(source, `plugin-sdk must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });
});
