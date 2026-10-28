import type { StageGeometry } from "@vibefield/puppeteer-view-sdk";
import { MonitorViewHost } from "@vibefield/puppeteer-view-sdk/host";
import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";
import {
  agentViewFixture,
  createFixtureReplica,
  fixtureTheme,
} from "@vibefield/puppeteer-view-sdk/testing";
import { type SwarmFrame, swarmMonitorView } from "@vibefield/puppeteer-views";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only GPU submission is replaced. The shipping SDK view (MV-5) mounts through
// the view host as VibeField's stage mounts it: its pointer handlers, render
// models and its own physics (inline here — happy-dom has no Worker, so the
// view's driver runs the same host in this thread and says so) all run. The
// handoff is M59's: a launcher's agent row arrives wearing the shell's
// `visualId`, and the body the shell had is the one the agent keeps.
// The renderer module inside the views package as it is installed here: the published per-file `dist` (.js)
// from the registry, or the checkout's `src` (.ts) while the dev overlay links it (RD-2). The package exports no
// such subpath (and its export map gives `require` no entry), so the module is found by the file that exists in
// field-app's own node_modules link, and the mock holds in both shapes (a fixed `dist` path missed the overlay's
// module and let the real WebGPU renderer run: lanes/qa-w1, 2026-10-28).
const { paint, RENDERER } = await vi.hoisted(async () => {
  const { existsSync, realpathSync } = await import("node:fs");
  // the test file's own directory (vitest's import.meta.dirname; this environment's import.meta.url is not file:)
  const views = realpathSync(`${import.meta.dirname}/../node_modules/@vibefield/puppeteer-views`);
  const dist = `${views}/dist/views/swarm/gpu/swarm-renderer.js`;
  return {
    paint: vi.fn<(frame: SwarmFrame) => void>(),
    RENDERER: existsSync(dist) ? dist : `${views}/src/views/swarm/gpu/swarm-renderer.ts`,
  };
});
vi.mock(RENDERER, async (original) => ({
  ...(await original<object>()),
  createSwarmRenderer: async () => ({
    ok: true,
    renderer: { render: paint, resize: () => {}, destroy: () => {}, lost: new Promise(() => {}) },
  }),
}));

let root: Root;
let host: HTMLDivElement;
const select = vi.fn();
const create = vi.fn();
const bounds = new DOMRect(17, 31, 800, 600);
const STAGE: StageGeometry = {
  width: bounds.width,
  height: bounds.height,
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  obstacles: [],
};
const terminal: AgentView = agentViewFixture({
  id: "shell",
  kind: "terminal",
  project: { name: "test-project" },
});
const agent: AgentView = agentViewFixture({
  id: "run",
  project: { name: "test-project" },
  visualId: "shell",
});
const replica = createFixtureReplica();
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
    ],
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(bounds.width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(bounds.height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(bounds);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  paint.mockClear();
  select.mockClear();
  create.mockClear();
  replica.set([]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(row: AgentView): Promise<HTMLElement> {
  replica.set([row]);
  await act(async () =>
    root.render(
      <MonitorViewHost
        replica={replica}
        view={swarmMonitorView}
        stage={STAGE}
        theme={fixtureTheme("light")}
        parameters={{ gravityPull: 0 }}
        commands={{ select, create }}
      />,
    ),
  );
  await frames(16);
  const stage = host.querySelector<HTMLElement>(".vf-monitor-swarm")!;
  stage.setPointerCapture = vi.fn();
  stage.hasPointerCapture = () => true;
  stage.releasePointerCapture = vi.fn();
  return stage;
}
async function frames(ms = 1000): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
function body() {
  const frame = paint.mock.calls.at(-1)?.[0];
  expect(frame?.bodies).toHaveLength(1);
  return frame!.bodies[0]!;
}
async function pointer(
  stage: HTMLElement,
  type: string,
  point: { x: number; y: number },
): Promise<void> {
  await act(async () => {
    stage.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: bounds.left + point.x,
        clientY: bounds.top + point.y,
      }),
    );
  });
}

describe("swarm pointer interaction", () => {
  it.each([false, true])(
    "drags the rendered body after handoff=%s without selecting or spawning",
    async (handoff) => {
      let stage = await render(terminal);
      await frames();
      const start = body();
      if (handoff) {
        stage = await render(agent);
        await frames(32);
        expect(Math.hypot(body().x - start.x, body().y - start.y)).toBeLessThan(1);
      }
      await pointer(stage, "pointerdown", start);
      const destination = { x: start.x + 120, y: start.y + 40 };
      await pointer(stage, "pointermove", destination);
      await frames(600);
      expect(body().x - start.x).toBeGreaterThan(60);
      await pointer(stage, "pointerup", destination);
      expect(select).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(stage.releasePointerCapture).toHaveBeenCalledWith(1);
    },
  );

  it("hovers and selects the current managed row through its inherited body", async () => {
    const stage = await render(agent);
    await frames();
    await pointer(stage, "pointermove", body());
    expect(stage.style.cursor).toBe("grab");
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
    await pointer(stage, "pointerdown", body());
    await pointer(stage, "pointerup", body());
    // the row's own id is what select names — never the body it inherited
    expect(select).toHaveBeenCalledExactlyOnceWith("run");
  });
});
