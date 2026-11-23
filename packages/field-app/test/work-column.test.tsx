import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";
import { agentViewFixture } from "@vibefield/puppeteer-view-sdk/testing";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monitorHoldsKeys } from "../src/godview/monitor/launcher-keys";
import { workFacets, workSessions } from "../src/godview/monitor/work-facets";
import { headingIntoSide } from "../src/godview/profiles-column/aim";
import { WorkColumn, type WorkColumnProps } from "../src/godview/work-column/WorkColumn";
import {
  workActWords,
  workCircleWords,
  workKey,
  workTargetOf,
} from "../src/godview/work-column/WorkColumnView";

// WL-1 (2026-11-23; DESIGN.md §8 "Godview's work column"): the profiles column's
// twin at the stage's right — one circle per project in its bodies' colour, a
// spacer, one per agent — each a lens; a card beside a circle lists the
// sessions under it and its foot holds the click's own act. Reach, focus and
// closing are the profiles column's (`column-hold.ts`), its cards mirrored.

const ALPHA = { id: "alpha-agent", label: "Alpha" };
const BETA = { id: "beta-agent", label: "Beta" };

const row = (
  id: string,
  project: string,
  provider: { id: string; label: string } | undefined,
  extra: Partial<AgentView> = {},
): AgentView =>
  agentViewFixture({
    id,
    project: { name: project, seq: project.length },
    ...(provider === undefined ? { kind: "terminal" as const } : { provider }),
    ...extra,
  });

const ROWS: readonly AgentView[] = [
  row("r1", "vibe-field", ALPHA, { createdAt: 1, status: "working", colour: "#4a7bd0" }),
  row("r2", "vibe-field", BETA, {
    createdAt: 2,
    status: "blocked",
    wait: { kind: "permission", since: 2 },
  }),
  row("r3", "billing-api", ALPHA, { createdAt: 3, colour: "#b04ad0" }),
  row("r4", "billing-api", undefined, { createdAt: 4 }),
];

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(patch: Partial<WorkColumnProps> = {}): {
  props: WorkColumnProps;
  render: (next: Partial<WorkColumnProps>) => void;
} {
  let props: WorkColumnProps = {
    work: workFacets(ROWS),
    sessions: workSessions(ROWS),
    project: null,
    agent: null,
    onProject: vi.fn(),
    onAgent: vi.fn(),
    ...patch,
  };
  act(() => root?.render(<WorkColumn {...props} />));
  return {
    get props() {
      return props;
    },
    render: (next) => {
      props = { ...props, ...next };
      act(() => root?.render(<WorkColumn {...props} />));
    },
  };
}

const circles = (): HTMLButtonElement[] => [
  ...(container?.querySelectorAll<HTMLButtonElement>(".vf-work-circle") ?? []),
];
const circleFor = (name: string): HTMLButtonElement => {
  const found = circles().find((each) => each.getAttribute("aria-label")?.startsWith(`${name},`));
  if (!found) throw new Error(`no circle for ${name}`);
  return found;
};
/** The pointer onto an item: React hears its enter in the `pointerover` it bubbles. */
const enter = (element: Element): void => {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
};

describe("the work column's circles (§8 'Which circles', 'A project's circle', 'Waiting')", () => {
  it("draws the projects, a spacer, then the agents, each in the order it first came", () => {
    mount();
    expect(circles().map((each) => [each.dataset.group, each.getAttribute("aria-label")])).toEqual([
      ["project", "vibe-field, 2 sessions, 1 waiting, click to show only its sessions"],
      ["project", "billing-api, 2 sessions, click to show only its sessions"],
      ["agent", "Alpha, 2 sessions, click to show only its sessions"],
      ["agent", "Beta, 1 session, 1 waiting, click to show only its sessions"],
      ["agent", "Shell, 1 session, click to show only its sessions"],
    ]);
    const list = container?.querySelector(".vf-work-circles");
    expect([...(list?.children ?? [])].map((child) => child.className)).toEqual([
      "vf-work-item",
      "vf-work-item",
      "vf-work-gap",
      "vf-work-item",
      "vf-work-item",
      "vf-work-item",
    ]);
    expect(container?.querySelector(".vf-work-column")?.getAttribute("aria-label")).toBe(
      "Projects and agents",
    );
  });

  it("draws a project as its folder in its bodies' colour, filled at a quarter, and an agent as its mark", () => {
    mount();
    const project = circleFor("vibe-field").querySelector<SVGElement>(".vf-project-mark");
    expect(project?.getAttribute("data-glyph")).toBe("folder");
    expect(project?.getAttribute("style")).toMatch(/#4a7bd0|rgb\(74, 123, 208\)/u);
    expect(circleFor("Alpha").querySelector(".vf-agent-mark")).not.toBeNull();
    expect(circleFor("Shell").querySelector('[data-glyph="terminal"]')).not.toBeNull();
  });

  it("wears the blocked dot on every circle a session waits under", () => {
    mount();
    const waits = circles()
      .filter((each) => each.querySelector(".vf-work-blocked") !== null)
      .map((each) => each.getAttribute("aria-label")?.split(",")[0]);
    expect(waits).toEqual(["vibe-field", "Beta"]);
  });

  it("draws no group of one value unless it is chosen, and no pill with neither", () => {
    const one = [row("r1", "vibe-field", ALPHA)];
    mount({ work: workFacets(one), sessions: workSessions(one) });
    expect(container?.querySelector(".vf-work-column")).toBeNull();
    const view = mount({ work: workFacets(one), sessions: workSessions(one), agent: ALPHA.id });
    expect(circles().map((each) => each.dataset.group)).toEqual(["agent"]);
    expect(circleFor("Alpha").getAttribute("aria-pressed")).toBe("true");
    view.render({ agent: null });
    expect(container?.querySelector(".vf-work-column")).toBeNull();
  });
});

describe("the lens and the card (§8 'The lens', 'The card')", () => {
  it("rings the chosen circle and says it shows only its sessions", () => {
    mount({ project: "billing-api", agent: BETA.id });
    expect(
      circles()
        .filter((each) => each.getAttribute("aria-pressed") === "true")
        .map((each) => each.getAttribute("aria-label")),
    ).toEqual([
      "billing-api, 2 sessions, showing only its sessions",
      "Beta, 1 session, 1 waiting, showing only its sessions",
    ]);
  });

  it("shows a circle's card while the pointer is on it: its sessions, those that wait first, and the click's act", () => {
    mount();
    enter(circleFor("vibe-field").parentElement as Element);
    const card = container?.querySelector(".vf-work-stand .vf-work-card");
    expect(card?.getAttribute("role")).toBe("dialog");
    expect(card?.querySelector(".vf-work-card-name")?.textContent).toBe("vibe-field");
    expect(card?.querySelector(".vf-work-card-count")?.textContent).toBe("2 sessions · 1 waiting");
    expect(
      [...(card?.querySelectorAll(".vf-work-card-row") ?? [])].map((each) => [
        each.querySelector(".vf-work-dot")?.getAttribute("data-dot"),
        each.querySelector(".vf-work-card-words")?.textContent,
      ]),
    ).toEqual([
      ["blocked", "Betablocked · permission"],
      ["working", "Alphaworking"],
    ]);
    expect(card?.querySelector(".vf-work-card-act")?.textContent).toBe("Show only vibe-field");
    expect(circleFor("vibe-field").getAttribute("aria-expanded")).toBe("true");
    // an agent's card lists its sessions by their projects
    enter(circleFor("Alpha").parentElement as Element);
    const agentCard = container?.querySelector(".vf-work-stand .vf-work-card");
    expect(
      [...(agentCard?.querySelectorAll(".vf-work-card-words > span") ?? [])].map(
        (each) => each.textContent,
      ),
    ).toEqual(["vibe-field", "billing-api"]);
  });

  it("chooses on a click and pins the card, holding Godview's keys; Esc closes it and the lens stands", () => {
    const view = mount();
    act(() => circleFor("billing-api").click());
    expect(view.props.onProject).toHaveBeenCalledWith("billing-api");
    view.render({ project: "billing-api" });
    expect(container?.querySelector(".vf-work-stand")).not.toBeNull();
    expect(circleFor("billing-api").hasAttribute("data-pinned")).toBe(true);
    expect(monitorHoldsKeys()).toBe(true);
    expect(container?.querySelector(".vf-work-card-act")?.textContent).toBe("Show every project");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container?.querySelector(".vf-work-stand")).toBeNull();
    expect(monitorHoldsKeys()).toBe(false);
    expect(view.props.onProject).toHaveBeenCalledTimes(1);
  });

  it("shows every session again on a click on the chosen circle, or on the card's act, and closes the card", () => {
    const view = mount({ agent: BETA.id });
    act(() => circleFor("Beta").click());
    expect(view.props.onAgent).toHaveBeenCalledWith(null);
    expect(container?.querySelector(".vf-work-stand")).toBeNull();
    // the card's own act is the click's
    view.render({ agent: null });
    act(() => circleFor("Beta").click());
    view.render({ agent: BETA.id });
    act(() => container?.querySelector<HTMLButtonElement>(".vf-work-card-act")?.click());
    expect(view.props.onAgent).toHaveBeenLastCalledWith(null);
  });

  it("lets a press outside go of the pin, and opens no card while the terminals fill the window", () => {
    const view = mount();
    act(() => circleFor("Alpha").click());
    expect(container?.querySelector(".vf-work-stand")).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(container?.querySelector(".vf-work-stand")).toBeNull();
    view.render({ covered: true });
    act(() => circleFor("Alpha").click());
    // the lens still chooses behind full-window terminals; no card stands over them
    expect(view.props.onAgent).toHaveBeenLastCalledWith(ALPHA.id);
    expect(container?.querySelector(".vf-work-stand")).toBeNull();
  });

  it("stands its card in the cards layer, 16 LEFT of the pill", () => {
    const layer = document.createElement("div");
    container?.appendChild(layer);
    mount({ cardLayer: layer });
    enter(circleFor("Beta").parentElement as Element);
    const stand = layer.querySelector<HTMLElement>(".vf-work-stand");
    expect(stand?.dataset.target).toBe(workKey({ group: "agent", id: BETA.id }));
    expect(stand?.style.right).toBe("16px");
    expect(stand?.style.left).toBe("");
  });
});

describe("the column's words and keys", () => {
  it("names a target by its group and its id, a colon in the id kept", () => {
    expect(workKey({ group: "project", id: "a:b" })).toBe("project:a:b");
    expect(workTargetOf("project:a:b")).toEqual({ group: "project", id: "a:b" });
    expect(workTargetOf("agent:x")).toEqual({ group: "agent", id: "x" });
    expect(workTargetOf("plan:x")).toBeNull();
    expect(workTargetOf("project:")).toBeNull();
  });

  it("says a circle and its card's act", () => {
    const [vibe] = workFacets(ROWS).projects;
    if (vibe === undefined) throw new Error("no project");
    expect(workCircleWords(vibe, false)).toBe(
      "vibe-field, 2 sessions, 1 waiting, click to show only its sessions",
    );
    expect(workActWords({ group: "project", id: "vibe-field" }, "vibe-field", false)).toBe(
      "Show only vibe-field",
    );
    expect(workActWords({ group: "agent", id: "x" }, "X", true)).toBe("Show every agent");
  });

  it("reads a trip into a card that stands LEFT of its pill as heading in (§8 'The reach', mirrored)", () => {
    const card = { left: 100, right: 400, top: 100, bottom: 300 };
    // from the pill at the right, moving left toward the card's right edge
    expect(headingIntoSide({ x: 480, y: 200 }, { x: 460, y: 205 }, card, "left")).toBe(true);
    // moving right, away from it, or straight down the pill
    expect(headingIntoSide({ x: 460, y: 200 }, { x: 480, y: 205 }, card, "left")).toBe(false);
    expect(headingIntoSide({ x: 470, y: 120 }, { x: 469, y: 200 }, card, "left")).toBe(false);
    // the right-hand card keeps the profiles column's own reading
    const right = { left: 500, right: 800, top: 100, bottom: 300 };
    expect(headingIntoSide({ x: 420, y: 200 }, { x: 440, y: 205 }, right, "right")).toBe(true);
  });
});
