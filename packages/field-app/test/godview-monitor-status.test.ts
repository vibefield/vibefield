import { describe, expect, it } from "vitest";
import {
  agentAccentSlot,
  agentDetail,
  classifyAgentStatus,
  classifyTerminalStatus,
  projectLabel,
  providerLabel,
} from "../src/godview/monitor/agent-status";
import { folderName } from "../src/godview/monitor/folder-name";
import { ACCENT_SLOTS } from "../src/godview/monitor/monitor-palette";
import { managedSummary } from "./managed-session-fixture";

// The reference app's `agent-status.test.ts`, ported at GT-3m and re-fed at
// AR-3. The classifier is the module the whole monitor rests on — everything a
// view draws is downstream of "what is this session doing", and since AR-3 that
// answer is fieldd's ONE derived status (AR-D4) rather than anything a
// terminal printed (ADR-003, our EL2 grain).

describe("Godview agent status", () => {
  it("maps the fold's idle, working and blocked onto the three statuses", () => {
    expect(classifyAgentStatus(managedSummary({ status: "idle" }))).toBe("idle");
    expect(classifyAgentStatus(managedSummary({ status: "working" }))).toBe("working");
    expect(
      classifyAgentStatus(managedSummary({ status: "blocked", blocker: { kind: "permission" } })),
    ).toBe("waiting");
  });

  it("drops a run puppeteer reports as no longer alive", () => {
    expect(classifyAgentStatus(managedSummary({ alive: false }))).toBeUndefined();
  });

  it("treats a run with no monitor state yet as starting rather than as absent", () => {
    // A session we have heard of but have no state for is REAL and is doing
    // something; showing nothing would be the dishonest reading.
    const starting = managedSummary({ status: "unknown", monitor: false });
    expect(classifyAgentStatus(starting)).toBe("working");
    expect(agentDetail(starting, "working")).toBe("starting");
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

  it("describes what an agent is doing without reading the terminal", () => {
    expect(
      agentDetail(
        managedSummary({ status: "blocked", blocker: { kind: "permission", tool: "Bash" } }),
        "waiting",
      ),
    ).toBe("permission · Bash");
    expect(
      agentDetail(managedSummary({ status: "blocked", blocker: { kind: "question" } }), "waiting"),
    ).toBe("question");
    expect(
      agentDetail(
        managedSummary({ status: "working", lastAssistantText: "Reading the tests" }),
        "working",
      ),
    ).toBe("Reading the tests");
    expect(agentDetail(managedSummary({ status: "working" }), "working")).toBe("working");
    expect(agentDetail(managedSummary({ status: "idle" }), "idle")).toBe("idle");
  });

  it("assigns a stable per-session accent SLOT, in range", () => {
    // The property the reference's color hash had, kept: same id ⇒ same slot,
    // forever. What changed is the codomain — a curated §2.6 set instead of a
    // free hue wheel, so a relationship color can never wander onto a hue §2.5
    // has already given a meaning.
    expect(agentAccentSlot("session-1", ACCENT_SLOTS)).toBe(
      agentAccentSlot("session-1", ACCENT_SLOTS),
    );
    expect(agentAccentSlot("session-1", ACCENT_SLOTS)).not.toBe(
      agentAccentSlot("session-2", ACCENT_SLOTS),
    );
    for (const id of ["a", "session-1", "remote:mini:s1", "run-42"]) {
      const slot = agentAccentSlot(id, ACCENT_SLOTS);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(ACCENT_SLOTS);
    }
  });

  it("folds a path to its last component and falls back to the given name", () => {
    expect(folderName("/Users/dev/Projects/vibe-field", "x")).toBe("vibe-field");
    expect(folderName("", "codex")).toBe("codex");
    expect(folderName(undefined, "terminal")).toBe("terminal");
  });
});
