import { createCanvasEngine, defineBehavior, describeBehavior } from "@vibecook/ice";
import type { BehaviorDefinition } from "@vibefield/contracts";
import type { RendererRuntimeTarget } from "@vibefield/plugin-runtime";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { DocManager, DocManagerState } from "../src/doc-manager";
import { useWorkspaceSession, type WorkspaceSession } from "../src/field/use-workspace-session";
import {
  getRendererLogger,
  type RendererLogger,
  type RendererLoggerBindings,
  setRendererLogger,
} from "../src/logging";
import { RendererWindowController } from "../src/plugin-host/renderer-controller";
import type { RendererBehaviorBinding } from "../src/plugin-host/renderer-harness";
import type { PreparedRendererPlugins } from "../src/plugin-host/staged-loader";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const previousLogger = getRendererLogger();

afterEach(() => {
  setRendererLogger(previousLogger);
});

function recordingLogger(
  observe: (event: string, bindings: RendererLoggerBindings) => void,
  bindings: RendererLoggerBindings = {},
): RendererLogger {
  const write = (event: string): void => observe(event, bindings);
  return {
    child: (child) => recordingLogger(observe, { ...bindings, ...child }),
    trace: write,
    debug: write,
    info: write,
    warn: write,
    error: write,
    fatal: write,
    isLevelEnabled: () => true,
  };
}

function preparedBehaviorRuntime(pluginId: string): {
  readonly behaviorName: string;
  readonly plugins: PreparedRendererPlugins;
  readonly runtime: RendererWindowController;
} {
  const Behavior = defineBehavior(`${pluginId}:layout`, { store: "runtime" });
  const { id: _id, ...definition } = describeBehavior(Behavior);
  const rendererTarget: RendererRuntimeTarget = {
    face: "renderer",
    pluginId,
    artifact: {
      installRevision: "workspace-behavior-rev-1",
      manifestHash: `sha256:${"e".repeat(64)}`,
    },
    instanceKey: { windowId: "field" },
    authorityFingerprint: JSON.stringify(["v1", "renderer", ["canvas.write"]]),
    observedGrantGeneration: 1,
  };
  const binding: RendererBehaviorBinding = {
    pluginId,
    id: Behavior.name,
    declarationIndex: 0,
    orderKey: `${pluginId}\0${"0".repeat(6)}`,
    definition: definition as BehaviorDefinition,
    authorized: true,
    handle: Behavior,
  };
  const runtime = new RendererWindowController("field");
  runtime.behaviorCatalog.publishCandidate(
    pluginId,
    {},
    rendererTarget,
    new Map([[Behavior.name, binding]]),
  );
  return {
    behaviorName: Behavior.name,
    runtime,
    plugins: { generation: 1, staged: [], bundled: [], runtime },
  };
}

describe("workspace behavior generation ownership", () => {
  it("registers before docs.create and unregisters before docs.close", async () => {
    const { plugins, runtime } = preparedBehaviorRuntime("com.example.workspace-behavior");
    const state: DocManagerState = {
      phase: "loading",
      loading: { progress: 0, stage: "opening doc" },
      doc: null,
      docs: [],
      thumbnailUrls: {},
      pending: {
        generation: 1,
        docId: "doc-workspace-behavior",
        name: "Behavior test",
        lane: null,
        initialBytes: null,
        initialUpdates: [],
        seed: false,
      },
    };
    const trace: string[] = [];
    const manager = {
      subscribe: () => () => undefined,
      getState: () => state,
      contentApplied: () => trace.push("content-applied"),
      canvasPresented: () => undefined,
    } as unknown as DocManager;
    let session: WorkspaceSession | undefined;
    setRendererLogger(
      recordingLogger((event) => {
        if (event === "renderer.plugin.behavior_registered") {
          trace.push(
            session?.ce.docs.current() === undefined ? "register:docless" : "register:live",
          );
        }
        if (event === "renderer.plugin.behavior_unregistered") {
          trace.push(
            session?.ce.docs.current() === undefined ? "unregister:docless" : "unregister:live",
          );
        }
      }),
    );

    function Harness() {
      const stageDisposeRef = useRef<(() => void) | null>(null);
      session = useWorkspaceSession(manager, stageDisposeRef, plugins);
      return null;
    }

    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    expect(trace.slice(0, 2)).toEqual(["register:docless", "content-applied"]);
    expect(session?.ce.docs.current()).toBeDefined();

    const current = session;
    if (current === undefined) throw new Error("workspace session did not render");
    const docs = current.ce.docs as unknown as { close(): void };
    const close = docs.close.bind(docs);
    docs.close = () => {
      trace.push("docs:close");
      close();
    };
    await act(async () => root.unmount());
    expect(trace.slice(-2)).toEqual(["unregister:live", "docs:close"]);
    expect(current.ce.engine.guests.list()).toEqual([]);
    await runtime.close();
  });

  it("ends the failed journal generation before opening its quarantined replacement", async () => {
    const { plugins, runtime } = preparedBehaviorRuntime("com.example.workspace-behavior-journal");
    const source = createCanvasEngine();
    const initialBytes = source.docs.create().exportEnvelope(1);
    source.docs.close();
    source.dispose();
    const state: DocManagerState = {
      phase: "loading",
      loading: { progress: 0, stage: "opening doc" },
      doc: null,
      docs: [],
      thumbnailUrls: {},
      pending: {
        generation: 2,
        docId: "doc-workspace-behavior-journal",
        name: "Behavior journal test",
        lane: null,
        initialBytes,
        initialUpdates: [Uint8Array.of(0xff, 0x00, 0xff)],
        seed: false,
      },
    };
    const trace: string[] = [];
    const manager = {
      subscribe: () => () => undefined,
      getState: () => state,
      contentApplied: () => trace.push("content-applied"),
      canvasPresented: () => undefined,
    } as unknown as DocManager;
    let session: WorkspaceSession | undefined;
    setRendererLogger(
      recordingLogger((event) => {
        if (event === "renderer.plugin.behavior_registered") {
          trace.push(
            session?.ce.docs.current() === undefined ? "register:docless" : "register:live",
          );
        }
        if (event === "renderer.plugin.behavior_unregistered") {
          trace.push(
            session?.ce.docs.current() === undefined ? "unregister:docless" : "unregister:live",
          );
        }
        if (event === "renderer.board.journal_quarantined") {
          trace.push(session?.ce.docs.current() === undefined ? "journal:docless" : "journal:live");
        }
      }),
    );

    function Harness() {
      const stageDisposeRef = useRef<(() => void) | null>(null);
      session = useWorkspaceSession(manager, stageDisposeRef, plugins);
      return null;
    }

    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    expect(trace).toEqual([
      "register:docless",
      "unregister:live",
      "journal:docless",
      "register:docless",
      "content-applied",
    ]);
    expect(session?.ce.docs.current()).toBeDefined();

    const current = session;
    if (current === undefined) throw new Error("workspace session did not render");
    await act(async () => root.unmount());
    expect(current.ce.engine.guests.list()).toEqual([]);
    await runtime.close();
  });
});
