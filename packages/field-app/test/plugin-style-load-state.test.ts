import { describe, expect, it } from "vitest";
import { stagePluginStyleLink } from "../src/plugin-host/plugin-style";

function fixture() {
  // Keep the unit deterministic and fetch-free. The physical canvas smoke owns
  // the real custom-scheme fetch; this row owns only event → evidence state.
  const link = document.createElement("link");
  const doc = {
    createElement: () => link,
    querySelectorAll: () => [],
    head: { appendChild: () => link },
  } as unknown as Document;
  const candidate = stagePluginStyleLink(
    doc,
    "vibefield.fixture.style",
    "revision-1",
    `vibefield-plugin://${"a".repeat(32)}`,
  );
  candidate.commit();
  return { candidate, link };
}

describe("plugin stylesheet load evidence", () => {
  it("records the browser load terminal on the owned link", () => {
    const { candidate, link } = fixture();
    expect(link.dataset["vfPluginStyleState"]).toBe("loading");

    link.dispatchEvent(new Event("load"));
    expect(link.dataset["vfPluginStyleState"]).toBe("loaded");

    // Terminal means terminal: a late or synthetic opposite event cannot
    // rewrite the evidence a smoke/doctor reader already observed.
    link.dispatchEvent(new Event("error"));
    expect(link.dataset["vfPluginStyleState"]).toBe("loaded");
    candidate.dispose();
  });

  it("records an authorization/fetch failure instead of treating a link as loaded", () => {
    const { candidate, link } = fixture();
    link.dispatchEvent(new Event("error"));
    expect(link.dataset["vfPluginStyleState"]).toBe("error");
    candidate.dispose();
  });
});
