import { describe, expect, it } from "vitest";
import { folderName } from "../src/godview/monitor/folder-name";
import { paneFrameAgentFacts } from "../src/godview/monitor/pane-frame-facts";
import { chromeRunOf } from "./chrome-run-fixture";
import { managedSummary } from "./managed-session-fixture";

// The reference app's `agent-status.test.ts`, ported at GT-3m, re-fed at AR-3
// and re-worded at AR-5. (Item 125, 2026-10-31: the classifier and the
// project and provider labels it held — `classifyAgentStatus`,
// `classifyTerminalStatus`, `projectPath`, `projectLabel`, `projectKey`,
// `providerLabel` — retired with `agent-status.ts`, as ST retired
// `agentDetail` and `blockerTool` beside them: none had a caller outside this
// suite, and Godview's rows are puppeteer's model backend's. What stays: the
// fixture's witness of Core's blocker shape, the frame's, and `folderName`.)

describe("Godview agent status", () => {
  it("keeps a permission's tool where Core writes it — nested, not at the root — and the frame draws none (GT-6 review)", () => {
    // THE DEFECT, and the reason it hid: Core nests the tool under
    // `permission` (`core/src/monitor/types.ts:74–78`), the mirror carries that
    // through verbatim, and a renderer read `blocker.tool` at the root. The
    // fixture invented the root shape too, so the assertion passed on data the
    // fold has never sent while every real board said a bare "permission". The
    // fixture now says what Core says. (ST, 2026-10-31: `agentDetail` and
    // `blockerTool`, the reader this row held, had no caller outside this
    // suite — Godview's row words are puppeteer's model backend's — and
    // retired; the fixture's witness and the frame's stay.)
    const blocked = managedSummary({
      status: "blocked",
      blocker: { kind: "permission", tool: "Bash" },
    });
    const blocker = blocked.monitor?.blockers[0] as
      | { tool?: unknown; permission?: { tool?: unknown } }
      | undefined;
    expect(blocker?.tool).toBeUndefined();
    expect(blocker?.permission?.tool).toBe("Bash");

    // The deck's frame reads the same row and draws NO tool at all: the
    // record's §07 frame has no field for one (name · mark · readout · meter ·
    // verbs), so the only thing it takes from a blocked row is the status —
    // which is exactly what it must keep taking once the tool is read
    // correctly. Stated here rather than assumed, because "the frame reads the
    // nested field too" would be a claim about code that draws no blocker.
    const facts = paneFrameAgentFacts(chromeRunOf(blocked));
    expect(facts?.status).toBe("blocked");
    expect(Object.keys(facts ?? {})).not.toContain("tool");
  });

  it("folds a path to its last component and falls back to the given name", () => {
    expect(folderName("/Users/dev/Projects/vibe-field", "x")).toBe("vibe-field");
    expect(folderName("", "codex")).toBe("codex");
    expect(folderName(undefined, "terminal")).toBe("terminal");
  });
});
