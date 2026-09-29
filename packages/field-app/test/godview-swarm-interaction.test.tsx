import {
  AgentSwarm,
  agentFixture,
  type MonitorAgent,
  readMonitorPalette,
  type SwarmFrame,
  SwarmPhysicsProvider,
  terminalFixture,
} from "@vibecook/puppeteer-views";
import { createInlineSwarmPhysicsDriver } from "@vibecook/puppeteer-views/physics";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSwarmPhysicsDriver,
  setSwarmPhysicsDriverFactory,
} from "../src/godview/views/swarm/swarm-physics-driver";

// Only GPU submission is replaced. Shipping pointer handlers, render models,
// VibeField's driver adapter and the shared Matter.js simulation all run.
const { paint } = vi.hoisted(() => ({ paint: vi.fn<(frame: SwarmFrame) => void>() }));
vi.mock(
  "../../../../puppeteer/packages/views/src/views/swarm/gpu/swarm-renderer.js",
  async (original) => ({
    ...(await original<object>()),
    createSwarmRenderer: async () => ({
      ok: true,
      renderer: { render: paint, resize: () => {}, destroy: () => {}, lost: new Promise(() => {}) },
    }),
  }),
);

let root: Root;
let host: HTMLDivElement;
const select = vi.fn();
const createAt = vi.fn();
const bounds = new DOMRect(17, 31, 800, 600);
const now = Date.now();
const terminal = terminalFixture("shell", "test-project", false, now);
const agent = {
  ...agentFixture({ id: "run", project: "test-project", status: "idle", accent: 1 }, now),
  visualId: "shell",
};

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
  setSwarmPhysicsDriverFactory((options) => createInlineSwarmPhysicsDriver(options));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  paint.mockClear();
  select.mockClear();
  createAt.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setSwarmPhysicsDriverFactory(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(row: MonitorAgent): Promise<HTMLElement> {
  await act(async () =>
    root.render(
      <SwarmPhysicsProvider factory={createSwarmPhysicsDriver}>
        <AgentSwarm
          agents={[row]}
          parameters={{ gravityPull: 0 }}
          palette={readMonitorPalette()}
          actions={{ select, createAt }}
        />
      </SwarmPhysicsProvider>,
    ),
  );
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
      expect(createAt).not.toHaveBeenCalled();
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
    expect(select).toHaveBeenCalledExactlyOnceWith(agent);
    expect(select.mock.calls[0]?.[0].id).toBe("run");
  });
});
