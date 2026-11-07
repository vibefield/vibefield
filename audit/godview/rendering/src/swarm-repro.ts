// Diagnostic host only. createSwarmRenderer and AgentSwarm are the pinned
// 748d015 sources, imported and called unchanged. The trace records adapter,
// device, destroy, and lost events, then forwards the original call.

import { createElement, StrictMode, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MonitorViewHost } from "@vibefield/puppeteer-view-sdk/host";
import { agentViewFixture } from "@puppeteer-pin/sdk/testing/fixtures";
import { createFixtureReplica } from "@puppeteer-pin/sdk/testing/replica";
import { useMonitorPalette } from "@puppeteer-pin/views/monitor/palette";
import { monitorParameterDefaults } from "@puppeteer-pin/views/monitor/parameters";
import { MONITOR_VIEWS } from "@puppeteer-pin/views/monitor/registry";
import { createSwarmRenderer } from "@puppeteer-pin/views/views/swarm/gpu/swarm-renderer";
import "../../../../packages/design-kit/src/tokens.css";
import "../../../../packages/field-app/src/godview/godview.css";
import "../.pin/puppeteer/packages/views/src/styles/views.css";

type Trace = { t: number; event: string; detail: unknown };
const traces: Trace[] = [];
const started = performance.now();

function push(event: string, detail: unknown) {
  traces.push({ t: Math.round(performance.now() - started), event, detail });
  const node = document.getElementById("log");
  if (node) node.textContent = JSON.stringify(traces);
}

function installTrace() {
  const gpu = navigator.gpu;
  if (!gpu) {
    push("navigator.gpu", false);
    return;
  }
  const requestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (options) => {
    push("requestAdapter:start", options ?? null);
    const adapter = await requestAdapter(options);
    if (!adapter) {
      push("requestAdapter:null", null);
      return null;
    }
    push("requestAdapter:ok", {
      features: [...adapter.features],
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxBindGroups: adapter.limits.maxBindGroups,
      maxBufferSize: adapter.limits.maxBufferSize,
    });
    const requestDevice = adapter.requestDevice.bind(adapter);
    adapter.requestDevice = async (descriptor) => {
      push("requestDevice:start", {
        label: descriptor?.label ?? null,
        requiredLimits: descriptor?.requiredLimits ?? null,
      });
      try {
        const device = await requestDevice(descriptor);
        push("requestDevice:ok", { label: device.label });
        const destroy = device.destroy.bind(device);
        device.destroy = () => {
          push("device.destroy", new Error("device.destroy").stack ?? "");
          destroy();
        };
        device.lost.then((info) => {
          push("device.lost", { reason: info.reason, message: info.message });
        });
        device.addEventListener("uncapturederror", (event) => {
          push("uncapturederror", (event as GPUUncapturedErrorEvent).error.message);
        });
        return device;
      } catch (error) {
        push("requestDevice:throw", String(error));
        throw error;
      }
    };
    return adapter;
  };
}

const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  push("console.warn", args.map(String).join(" ").slice(0, 500));
  originalWarn(...args);
};
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  push("console.error", args.map(String).join(" ").slice(0, 500));
  originalError(...args);
};

async function bareDevice(destroyAfter: boolean) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return;
  const device = await adapter.requestDevice({
    label: "bare comparison",
    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
  });
  push("bare-device-held", { destroyAfter });
  if (!destroyAfter) return;
  device.destroy();
  await device.lost;
  const again = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  push("adapter-after-destroy", { ok: again !== null });
}

async function bareRenderer(thenDestroy: boolean) {
  const canvas = document.getElementById("bare") as HTMLCanvasElement;
  const result = await createSwarmRenderer(canvas);
  push("createSwarmRenderer", {
    ok: result.ok,
    reason: result.ok ? null : result.reason,
  });
  if (!result.ok) return;
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!thenDestroy) {
    push("bare-renderer-still-held", true);
    return;
  }
  result.renderer.destroy();
  await result.renderer.lost;
  const again = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  push("adapter-after-renderer-destroy", { ok: again !== null });
}

function IntegrationSwarm() {
  const rootRef = useRef<HTMLDivElement>(null);
  const palette = useMonitorPalette(rootRef);
  const registered = MONITOR_VIEWS.find((view) => view.id === "swarm");
  if (!registered) throw new Error("missing swarm view");
  const row = useMemo(
    () =>
      agentViewFixture({
        id: "row-1",
        status: "working",
        context: { usedPercent: 80 },
        model: "fixture-model",
        effort: { value: "high", intent: "configured" },
        cost: { usd: 2.5, coverage: "complete", burnPerHour: 12 },
      }),
    [],
  );
  const replica = useMemo(() => createFixtureReplica([row]), [row]);
  const parameters = useMemo(() => monitorParameterDefaults(registered.parameterGroups), [registered]);
  const commands = useMemo(() => ({ select: () => undefined, create: () => undefined }), []);
  const theme = useMemo(
    () => ({ scheme: "dark" as const, tokens: palette, reducedMotion: true, animations: false }),
    [palette],
  );
  return createElement(
    "div",
    {
      ref: rootRef,
      className: "vf-godview theme-dark",
      "data-godview-open": "true",
      "data-godview-animations": "off",
      style: { width: "1000px", height: "640px" },
    },
    createElement(MonitorViewHost, {
      replica,
      view: registered.view,
      stage: {
        width: 1000,
        height: 640,
        insets: { top: 12, right: 12, bottom: 12, left: 12 },
        obstacles: [],
      },
      theme,
      parameters,
      commands,
      className: "fe-slot",
    }),
  );
}

function mountReact() {
  const strict = new URLSearchParams(location.search).get("strict") === "1";
  const root = createRoot(document.getElementById("react")!);
  const node = createElement(IntegrationSwarm);
  root.render(strict ? createElement(StrictMode, null, node) : node);
  push("react-mounted", { strict, dev: import.meta.env.DEV, mode: import.meta.env.MODE });
}

installTrace();
const phase = new URLSearchParams(location.search).get("phase") ?? "bare-renderer";
push("phase", { phase, dev: import.meta.env.DEV, mode: import.meta.env.MODE });

if (phase === "bare-hold") await bareDevice(false);
else if (phase === "bare-destroy") await bareDevice(true);
else if (phase === "bare-renderer") await bareRenderer(false);
else if (phase === "bare-renderer-destroy") await bareRenderer(true);
else if (phase === "react") {
  mountReact();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  push("react-settled", {
    empty: document.querySelector(".vf-monitor-swarm-empty")?.textContent ?? null,
  });
}

document.documentElement.dataset.reproDone = "1";
