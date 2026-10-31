import { describe, expect, it } from "vitest";
import {
  classifyAgentStatus,
  classifyTerminalStatus,
  projectKey,
  projectLabel,
  providerLabel,
} from "../src/godview/monitor/agent-status";
import { folderName } from "../src/godview/monitor/folder-name";
import { paneFrameAgentFacts } from "../src/godview/monitor/pane-frame-facts";
import { chromeRunOf } from "./chrome-run-fixture";
import { managedSummary } from "./managed-session-fixture";

// The reference app's `agent-status.test.ts`, ported at GT-3m, re-fed at AR-3
// and re-worded at AR-5. The classifier is the module the whole monitor rests
// on — everything a view draws is downstream of "what is this session doing",
// and since AR-3 that answer is fieldd's ONE derived status (AR-D4) rather
// than anything a terminal printed (ADR-003, our EL2 grain). The WORD is
// Core's since AR-5 (`idle` · `working` · `blocked`); GT-3m's `waiting` was
// the same state under a local name and retired with the views port.

describe("Godview agent status", () => {
  it("maps the fold's idle, working and blocked onto Core's three words", () => {
    expect(classifyAgentStatus(managedSummary({ status: "idle" }))).toBe("idle");
    expect(classifyAgentStatus(managedSummary({ status: "working" }))).toBe("working");
    expect(
      classifyAgentStatus(managedSummary({ status: "blocked", blocker: { kind: "permission" } })),
    ).toBe("blocked");
  });

  it("drops a run puppeteer reports as no longer alive", () => {
    expect(classifyAgentStatus(managedSummary({ alive: false }))).toBeUndefined();
  });

  it("treats a run with no monitor state yet as starting rather than as absent", () => {
    // A session we have heard of but have no state for is REAL and is doing
    // something; showing nothing would be the dishonest reading.
    const starting = managedSummary({ status: "unknown", monitor: false });
    expect(classifyAgentStatus(starting)).toBe("working");
  });

  it("AR-4: a pending row is idle, and the drop is asked FIRST", () => {
    // The order is the rule: "this run is not alive" is a fact about the run,
    // and pending is a reading of a row still presumed to exist. Asked second,
    // pending answered for a dead run and the stage drew it as a live agent.
    expect(classifyAgentStatus(managedSummary({ pending: "cannot attach" }))).toBe("idle");
    expect(
      classifyAgentStatus(managedSummary({ pending: "cannot attach", alive: false })),
    ).toBeUndefined();
  });

  it("uses foreground activity for unassigned terminals, and unknown falls to idle", () => {
    expect(classifyTerminalStatus({ kind: "shell-idle" })).toBe("idle");
    expect(classifyTerminalStatus({ kind: "foreground-job" })).toBe("working");
    expect(classifyTerminalStatus({ kind: "unknown" })).toBe("idle");
    expect(classifyTerminalStatus(undefined)).toBe("idle");
  });

  it("labels a session from where the agent is, else its workspace; the provider from its own label", () => {
    expect(projectLabel(managedSummary({ cwd: "/project/vibe-field" }))).toBe("vibe-field");
    const moved = managedSummary({ cwd: "/project/vibe-field" });
    moved.monitor = {
      ...moved.monitor!,
      environment: { cwd: "/project/vibe-field/packages/field-app", worktrees: [] },
    };
    expect(projectLabel(moved)).toBe("field-app");
    expect(providerLabel(managedSummary({ kind: "codex", label: "Codex" }))).toBe("Codex");
    // an OPEN id: a provider this renderer never heard of is labeled by its
    // adapter, and by its id when the label is empty (the tolerant reader)
    expect(providerLabel(managedSummary({ kind: "some-new-agent", label: "Some New Agent" }))).toBe(
      "Some New Agent",
    );
    expect(providerLabel({ kind: "some-new-agent", label: "" })).toBe("some-new-agent");
  });

  it("keys a project by its workspace ROOT, so a worktree shares the repository's colour", () => {
    // Record §02/D3, and the reason the key and the label are two functions: a
    // run in a subdirectory is LABELLED by where it is, and COLOURED by the
    // repository it belongs to. Keying on the observed cwd would have dealt a
    // second sequence — a second hue — for the same project.
    const moved = managedSummary({ cwd: "/project/vibe-field" });
    moved.monitor = {
      ...moved.monitor!,
      environment: { cwd: "/project/vibe-field/packages/field-app", worktrees: [] },
    };
    expect(projectKey(moved)).toBe("/project/vibe-field");
    expect(projectLabel(moved)).toBe("field-app");

    // With no workspace at all the observed directory is the best key there is…
    const observed = managedSummary({ cwd: "/project/truffle" });
    delete observed.workspace;
    expect(projectKey(observed)).toBe("/project/truffle");

    // …and a row that names no directory belongs to no project, which is the
    // ramp rather than a sequence dealt to the empty string.
    const rootless = managedSummary({ monitor: false });
    delete rootless.workspace;
    expect(projectKey(rootless)).toBeUndefined();
  });

  it("keeps a permission's tool where Core writes it — nested, not at the root — and the frame draws none (GT-6 review)", () => {
    // THE DEFECT, and the reason it hid: Core nests the tool under
    // `permission` (`core/src/monitor/types.ts:74–78`), the mirror carries that
    // through verbatim, and a renderer read `blocker.tool` at the root. The
    // fixture invented the root shape too, so the assertion passed on data the
    // fold has never sent while every real board said a bare "permission". The
    // fixture now says what Core says. (DS, 2026-10-31: `agentDetail` and
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
