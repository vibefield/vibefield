// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentKind, AgentSessionInfo } from "../src/godview/monitor/facet-types";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { AgentBubbleView, agentBubblePresentation } from "../src/godview/views/swarm/AgentBubble";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function terminal(status: "idle" | "working"): MonitorAgent {
  return {
    id: `terminal-${status}`,
    createdAtMs: 0,
    status,
    project: "scratch",
    detail: "/Projects/scratch",
    color: "#6366f1",
    active: false,
  };
}

function agent(status: "idle" | "working" | "waiting", kind: AgentKind = "codex"): MonitorAgent {
  return {
    id: `agent-${status}`,
    createdAtMs: 0,
    status,
    project: "vibe-field",
    detail: status === "waiting" ? "permission · Bash" : status,
    color: "#22c55e",
    active: false,
    agent: {
      kind,
      provider: "Codex",
      model: "GPT-5.6 Codex",
      branch: "swarm-audit",
      contextWindow: {
        usedTokens: 84_000,
        capacityTokens: 200_000,
        usedPercent: 42.8,
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
      info: {} as AgentSessionInfo,
    },
  };
}

function remote(status: "idle" | "working", hostWritable = true): MonitorAgent {
  return {
    id: `remote-${status}`,
    createdAtMs: 0,
    status,
    project: "mesh-console",
    detail: "studio-mini · /Projects/mesh-console",
    color: "#ec4899",
    active: false,
    remote: {
      deviceId: "studio-mini",
      deviceName: "studio-mini",
      remoteSessionId: "peer-session",
      attachable: true,
      hostWritable,
      cwdLabel: "/Projects/mesh-console",
    },
  };
}

function mount(subject: MonitorAgent, onClick = vi.fn()): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<AgentBubbleView agent={subject} onClick={onClick} />));
  return container;
}

describe("Godview agent-circle presentation", () => {
  it("names every valid source and lifecycle mapping explicitly", () => {
    const cases = [
      { subject: terminal("idle"), source: "terminal", visual: "idle", appearance: "idle" },
      {
        subject: terminal("working"),
        source: "terminal",
        visual: "working",
        appearance: "working",
      },
      { subject: agent("idle"), source: "agent", visual: "working", appearance: "working" },
      { subject: agent("working"), source: "agent", visual: "ignited", appearance: "working" },
      { subject: agent("waiting"), source: "agent", visual: "waiting", appearance: "waiting" },
      { subject: remote("idle"), source: "remote", visual: "idle", appearance: "idle" },
      {
        subject: remote("working"),
        source: "remote",
        visual: "working",
        appearance: "working",
      },
    ] as const;

    for (const expected of cases) {
      expect(agentBubblePresentation(expected.subject)).toMatchObject({
        source: expected.source,
        visualState: expected.visual,
        appearance: expected.appearance,
      });
    }
  });

  it("keeps ready and working agents visibly distinguishable without changing body size", () => {
    const ready = agentBubblePresentation(agent("idle"));
    const working = agentBubblePresentation(agent("working"));

    expect(ready.appearance).toBe(working.appearance);
    expect(ready.className).not.toContain("is-ignited");
    expect(working.className).toContain("is-ignited");
  });

  it("renders all ignition, identity, context, and pane-link layers from the exact view", () => {
    const subject = {
      ...agent("working", "grok"),
      active: true,
      attachment: { primary: "#06b6d4", mirrors: ["#8b5cf6", "#ef4444"] },
    } satisfies MonitorAgent;
    const host = mount(subject);
    const bubble = host.querySelector<HTMLButtonElement>(".vf-monitor-bubble");

    expect(bubble?.classList.contains("is-ignited")).toBe(true);
    expect(bubble?.classList.contains("is-linked")).toBe(true);
    expect(bubble?.classList.contains("is-active")).toBe(true);
    expect(bubble?.getAttribute("aria-current")).toBe("true");
    expect(bubble?.style.getPropertyValue("--agent-color")).toBe("#06b6d4");
    expect(host.querySelectorAll(".vf-monitor-bubble-particle")).toHaveLength(24);
    expect(host.querySelectorAll(".vf-monitor-bubble-mirrors i")).toHaveLength(2);
    expect(host.querySelector(".vf-monitor-bubble-glyph")).not.toBeNull();
    expect(host.querySelector(".vf-monitor-bubble-branch")?.textContent).toBe("swarm-audit");
    expect(host.querySelector(".vf-monitor-bubble-context")?.textContent).toBe("CTX:42%");
    expect(host.querySelector<HTMLElement>(".vf-monitor-bubble-context-fill")?.style.height).toBe(
      "42.8%",
    );
  });

  it("keeps local unassigned and remote-session semantics separate", () => {
    const localHost = mount(terminal("idle"));
    expect(localHost.querySelector(".vf-monitor-bubble")?.classList.contains("is-unassigned")).toBe(
      true,
    );
    act(() => root?.unmount());
    localHost.remove();
    root = null;
    container = null;

    const remoteHost = mount(remote("working", false));
    const bubble = remoteHost.querySelector(".vf-monitor-bubble");
    expect(bubble?.classList.contains("is-remote")).toBe(true);
    expect(bubble?.classList.contains("is-unassigned")).toBe(false);
    expect(bubble?.getAttribute("aria-label")).toContain("read-only host");
    expect(remoteHost.querySelector(".vf-monitor-bubble-host")?.textContent).toBe("studio-mini");
    expect(remoteHost.textContent).toContain("read-only host");
  });

  it("states the HOST's write policy in BOTH directions, never by silence", () => {
    // The pre-attach claim is a claim about the peer, not about this viewer
    // (GT-5c / the review's 2b): upstream advertises one boolean per host and
    // the per-viewer answer is decided at attach. Marking only the refusing
    // host taught the eye that an unmarked row was writable — which on a
    // capability-configured peer is exactly the row that is not.
    const writable = mount(remote("idle", true));
    expect(writable.textContent).toContain("writable host");
    expect(writable.textContent).not.toContain("read-only host");
    expect(writable.querySelector(".vf-monitor-bubble")?.getAttribute("aria-label")).toContain(
      "writable host",
    );
  });

  it("forwards selection through the controller seam", () => {
    const onClick = vi.fn();
    const host = mount(agent("idle"), onClick);
    act(() => host.querySelector<HTMLButtonElement>(".vf-monitor-bubble")?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
