import type { StageGeometry } from "@vibefield/puppeteer-view-sdk";
import { MonitorViewHost } from "@vibefield/puppeteer-view-sdk/host";
import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";
import {
  agentViewFixture,
  createFixtureReplica,
  fixtureTheme,
} from "@vibefield/puppeteer-view-sdk/testing";
import type { SwarmFrame } from "@vibefield/puppeteer-views";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMonitorView } from "../src/godview/monitor/monitor-tuning";

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
const { paint, posts, rendererStartup, DRIVER, RENDERER } = await vi.hoisted(async () => {
  const { existsSync, realpathSync } = await import("node:fs");
  // the test file's own directory (vitest's import.meta.dirname; this environment's import.meta.url is not file:)
  const views = realpathSync(`${import.meta.dirname}/../node_modules/@vibefield/puppeteer-views`);
  const modulePath = (path: string): string => {
    const dist = `${views}/dist/views/swarm/${path}.js`;
    return existsSync(dist) ? dist : `${views}/src/views/swarm/${path}.ts`;
  };
  return {
    paint: vi.fn<(frame: SwarmFrame) => void>(),
    posts: vi.fn<(type: string) => void>(),
    rendererStartup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    DRIVER: modulePath("physics/driver"),
    RENDERER: modulePath("gpu/swarm-renderer"),
  };
});
vi.mock(DRIVER, async (original) => {
  type Post = (command: { type: string }, transfer?: Transferable[]) => void;
  const actual = await original<{ createSwarmPhysicsDriver(options: unknown): { post: Post } }>();
  return {
    ...actual,
    createSwarmPhysicsDriver(options: unknown) {
      const driver = actual.createSwarmPhysicsDriver(options);
      const post = driver.post.bind(driver);
      driver.post = (command, transfer) => {
        posts(command.type);
        post(command, transfer);
      };
      return driver;
    },
  };
});
vi.mock(RENDERER, async (original) => ({
  ...(await original<object>()),
  createSwarmRenderer: async () => {
    await rendererStartup();
    return {
      ok: true,
      renderer: { render: paint, resize: () => {}, destroy: () => {}, lost: new Promise(() => {}) },
    };
  },
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
  posts.mockClear();
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

function Stage({ viewId, open, hidden }: { viewId: string; open: boolean; hidden: boolean }) {
  const entry = useMonitorView(viewId);
  return open ? (
    <MonitorViewHost
      replica={replica}
      view={entry.view}
      stage={STAGE}
      theme={{ ...fixtureTheme("light"), hidden }}
      parameters={{ gravityPull: 0 }}
      commands={{ select, create }}
    />
  ) : null;
}
async function choose(viewId: string, open = true, hidden = false): Promise<void> {
  await act(async () => root.render(<Stage viewId={viewId} open={open} hidden={hidden} />));
}
async function render(row: AgentView): Promise<HTMLElement> {
  await act(async () => replica.set([row]));
  await choose("swarm");
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

describe("swarm navigation and live updates", () => {
  it("reuses an unchanged agent model while a running terminal's elapsed label advances", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const job = agentViewFixture({ id: "job", kind: "terminal", status: "working" });
    await act(async () => replica.set([agent, job]));
    await choose("swarm");
    await frames(48);
    const models = () => paint.mock.calls.at(-1)![0].bodies.map((item) => item.model);
    const currentAgent = () => models().find((model) => model.rowId === agent.id);
    const elapsed = () =>
      models()
        .find((model) => model.rowId === job.id)
        ?.copy.find((line) => line.key === "elapsed")?.text;
    const original = currentAgent();
    expect(original).toBeDefined();
    expect(elapsed()).toBe("0:00");
    now.mockReturnValue(103_000);
    await frames(1100);
    expect(elapsed()).toBe("0:03");
    expect(currentAgent()).toBe(original);
    await act(async () => replica.set([agent, { ...job, title: "watch" }]));
    await frames(32);
    expect(currentAgent()).toBe(original);
  });
  it.each(["list", "outside Godview"])(
    "resumes a dragged bubble after visiting %s",
    async (away) => {
      const stage = await render(terminal);
      await frames();
      const start = body();
      const destination = { x: start.x + 110, y: start.y + 32 };
      await pointer(stage, "pointerdown", start);
      await pointer(stage, "pointermove", destination);
      await frames(600);
      await pointer(stage, "pointerup", destination);
      await frames(200);
      const gone = agentViewFixture({ id: "gone", spawnHint: { x: 140, y: 120 } });
      await act(async () => replica.set([terminal, gone]));
      await frames(16);
      await frames(64);
      const before = paint.mock.calls.at(-1)![0].bodies;
      expect(before.map(({ model }) => model.id)).toContain("gone");
      const saved = before.find(({ model }) => model.id === "shell")!;
      expect(saved.x - start.x).toBeGreaterThan(60);

      await choose(away === "list" ? "list" : "swarm", away === "list");
      expect(posts).toHaveBeenCalledWith("dispose");
      const draws = paint.mock.calls.length;
      await frames();
      expect(paint).toHaveBeenCalledTimes(draws);
      // A reopened stage can receive its board after mounting. A quick visit
      // during this interval must preserve the last populated layout.
      await act(async () => replica.set([]));
      await choose("swarm");
      await frames(32);
      await choose("swarm", false);
      const fresh = agentViewFixture({ id: "fresh", spawnHint: { x: 140, y: 120 } });
      await act(async () => replica.set([agent, fresh]));
      paint.mockClear();
      await choose("swarm");
      await frames(64);
      const first = paint.mock.calls
        .map(([frame]) => frame)
        .find((frame) => frame.bodies.length === 2);
      const survivor = first?.bodies.find(({ model }) => model.id === "shell");
      const arrival = first?.bodies.find(({ model }) => model.id === "fresh");
      expect(survivor).toMatchObject({ model: { rowId: "run" }, seed: saved.seed, scale: 1 });
      expect(Math.hypot(survivor!.x - saved.x, survivor!.y - saved.y)).toBeLessThan(2);
      expect(arrival?.scale).toBeLessThan(0.1);
      expect(first?.bodies.map(({ model }) => model.id)).not.toContain("gone");
      posts.mockClear();
      await act(async () => replica.set([fresh, { ...agent, title: "Renamed after returning" }]));
      await frames(64);
      expect(posts).not.toHaveBeenCalledWith("updateAgents");
    },
  );

  it("keeps a new window independent of a closed window's layout", async () => {
    await render(agent);
    await frames();
    expect(body().scale).toBe(1);
    await act(async () => root.unmount());
    root = createRoot(host);
    paint.mockClear();
    await choose("swarm");
    await frames(32);
    expect(body().scale).toBeLessThan(0.5);
  });

  it("retains the last painted board when an intermediate visit never gets a GPU frame", async () => {
    await render(agent);
    await frames();
    const saved = body();
    await choose("swarm", false);
    let ready!: () => void;
    rendererStartup.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    await act(async () => replica.set([agentViewFixture({ id: "partial-board" })]));
    paint.mockClear();
    await choose("swarm");
    await frames(100);
    expect(paint).not.toHaveBeenCalled();
    await choose("swarm", false);
    await act(async () => ready());
    await act(async () => replica.set([agent]));
    await choose("swarm");
    await frames(32);
    expect(body()).toMatchObject({ seed: saved.seed, scale: 1 });
    expect(Math.hypot(body().x - saved.x, body().y - saved.y)).toBeLessThan(2);
  });

  it("fits a saved position inside a window resized while away", async () => {
    await render({ ...agent, spawnHint: { x: 680, y: 470 } });
    await frames();
    expect(body().x).toBeGreaterThan(520);
    await choose("swarm", false);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(520);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(360);
    await choose("swarm");
    await frames(32);
    const restored = body();
    expect(restored.scale).toBe(1);
    expect(restored.x + restored.radius).toBeLessThanOrEqual(521);
    expect(restored.y + restored.radius).toBeLessThanOrEqual(361);
  });

  it("does no drawing while covered and reveals the latest board when uncovered", async () => {
    await render(agent);
    await frames();
    await choose("swarm", true, true);
    expect(posts).toHaveBeenCalledWith("pause");
    paint.mockClear();
    await act(async () => replica.set([{ ...agent, title: "Changed while hidden" }]));
    await frames();
    expect(paint).not.toHaveBeenCalled();
    await choose("swarm");
    await frames(32);
    expect(body().model.title).toContain("Changed while hidden");
    expect(body().scale).toBe(1);
  });

  it("updates text without sending another roster to physics", async () => {
    await render(agent);
    await frames();
    posts.mockClear();
    for (let i = 1; i <= 20; i++) {
      await act(async () => replica.set([{ ...agent, title: `Live title ${i}` }]));
      await frames(16);
    }
    await frames(32);
    expect(body().model.title).toContain("Live title 20");
    expect(posts).not.toHaveBeenCalledWith("updateAgents");
    const second = agentViewFixture({ id: "second" });
    await act(async () => replica.set([agent, second]));
    await frames(32);
    expect(posts.mock.calls.filter(([type]) => type === "updateAgents")).toHaveLength(1);
    posts.mockClear();
    await act(async () => replica.set([{ ...agent, status: "working" }, second]));
    await frames(32);
    await frames(16);
    expect(posts).toHaveBeenCalledWith("updateAgents");
  });
});
