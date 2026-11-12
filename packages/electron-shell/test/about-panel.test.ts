import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABOUT_NOT_AFFILIATED, ABOUT_TRADEMARK, aboutPanelOptions } from "../src/main/about-panel";

// LP (Q3.2; James, 2026-11-12) — the Mac's About carries the phone's foot, word for word, as
// DESIGN.md §9 says it.
const DESIGN = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8").replace(
  /\s+/g,
  " ",
);

describe("the Mac's About panel (AU-4, LP Q3.2)", () => {
  it("names VibeField, the version and the commit the build id records", () => {
    expect(aboutPanelOptions("0.9.0-beta.1", "0.9.0-beta.1+84509d6a1")).toMatchObject({
      applicationName: "VibeField",
      applicationVersion: "0.9.0-beta.1",
      version: "84509d6a1",
    });
  });

  it("leaves the commit to macOS when no build id is staged", () => {
    expect(aboutPanelOptions("0.1.0", undefined)).not.toHaveProperty("version");
    expect(aboutPanelOptions("0.1.0", null)).not.toHaveProperty("version");
  });

  // RED until the green commit: the red commit's module has no credits.
  it("carries Tailscale's trademark line, then the non-affiliation line, under the version", () => {
    const { credits } = aboutPanelOptions("0.9.0", undefined);
    expect(credits).toBe(`${ABOUT_TRADEMARK}\n${ABOUT_NOT_AFFILIATED}`);
  });

  it("says both lines as DESIGN.md's voice says them, word for word", () => {
    expect(DESIGN).toContain(ABOUT_NOT_AFFILIATED);
    expect(DESIGN).toContain(ABOUT_TRADEMARK);
  });
});
