// THE MOUNT — one widget state, rendered the way the product renders it, and
// the verdict that comes out.
//
// What makes this a verdict rather than a demo: the component under the root is
// not the plugin's export, it is what `buildWidgetType` produced from the
// manifest — the same prefab projection and the same §11.4 per-widget failure
// boundary the canvas mounts. A plugin that only renders when someone bypasses
// its declaration has not passed anything.
//
// Three questions per state, and all three must answer yes for a pass:
//   1. did the mount complete without throwing?
//   2. did the §11.4 boundary stay untripped?
//   3. did unmount (and every effect cleanup it runs) complete?
import { EngineProvider } from "@vibecook/ice/react";
import type { WidgetContribution } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { messageOf, type StateVerdict } from "./verdict";

/** The engine surface this module needs — spelled out rather than importing
 * ICE's CanvasEngine type, which would drag its transitive strata types into
 * this app's declaration graph for no gain. */
interface Engine {
  readonly world: unknown;
  readonly ops: {
    spawnWidget(
      type: string,
      opts: Record<string, unknown>,
    ): number | { readonly [k: string]: unknown };
  };
}

export interface MountRequest {
  readonly plugin: string;
  readonly decl: WidgetContribution;
  readonly state: string;
  readonly props: Record<string, unknown>;
  /** the face-wrapped component `buildWidgetType` produced */
  readonly component: unknown;
  readonly engine: Engine;
}

/** Run `body` with console.error captured. React reports render failures through
 * that channel as well as through the root callbacks, and a widget may write to
 * it directly; either way the output belongs in the verdict, not in the middle
 * of a table. */
async function captureConsole<T>(body: () => Promise<T>): Promise<[T, string[]]> {
  const captured: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  try {
    return [await body(), captured];
  } finally {
    console.error = original;
  }
}

/**
 * Mount one state and answer for it.
 *
 * `act` rather than a bare render: it flushes passive effects inside the window
 * we are judging, so a widget whose `useEffect` throws is this state's failure
 * rather than an unattributed crash three states later. IS_REACT_ACT_ENVIRONMENT
 * is set only for the duration, so nothing else in the process starts warning
 * about updates it cannot see.
 */
export async function mountState(request: MountRequest): Promise<StateVerdict> {
  const { plugin, decl, state, props, component, engine } = request;
  const base: Pick<StateVerdict, "kind" | "plugin" | "type" | "state"> = {
    kind: "state",
    plugin,
    type: decl.type,
    state,
  };
  const started = performance.now();

  let entity: unknown;
  try {
    entity = engine.ops.spawnWidget(decl.type, {
      x: 0,
      y: 0,
      w: decl.defaultSize.w,
      h: decl.defaultSize.h,
      undoable: false,
      props,
    });
    (engine.world as { sync(): void }).sync();
  } catch (error) {
    return {
      ...base,
      status: "refused",
      code: "state-spawn-failed",
      detail: `the engine refused these props: ${messageOf(error)}`,
      expected: "props the declared prop schema accepts",
      durationMs: Math.round(performance.now() - started),
    };
  }

  const container = document.createElement("div");
  container.style.width = `${decl.defaultSize.w}px`;
  container.style.height = `${decl.defaultSize.h}px`;
  document.body.appendChild(container);

  const failures: unknown[] = [];
  const root = createRoot(container, {
    // The boundary caught it — the widget rendered a failed face instead of its
    // own, which is precisely what this runner exists to catch.
    onCaughtError: (error: unknown) => failures.push(error),
    // Nothing caught it: the throw escaped even the §11.4 boundary.
    onUncaughtError: (error: unknown) => failures.push(error),
  });

  const actEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  const previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = true;
  let thrown: unknown;
  let html = "";
  const [, consoleErrors] = await captureConsole(async () => {
    try {
      await act(async () => {
        root.render(
          createElement(
            EngineProvider as never,
            { engine } as never,
            createElement(component as never, { entity, world: engine.world } as never),
          ),
        );
      });
      html = container.innerHTML;
      await act(async () => {
        root.unmount();
      });
    } catch (error) {
      thrown = error;
    }
  });
  actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
  container.remove();

  const durationMs = Math.round(performance.now() - started);
  const errors = [...failures, ...(thrown !== undefined ? [thrown] : [])];
  if (errors.length > 0) {
    return {
      ...base,
      status: "refused",
      code: "state-render-failed",
      detail: `${messageOf(errors[0])}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`,
      expected: "a mount that completes without throwing and without tripping the §11.4 boundary",
      durationMs,
      ...(consoleErrors.length > 0 ? { consoleErrors } : {}),
    };
  }
  // An empty DOM from a `dom` widget is not an error — a widget may legitimately
  // render nothing for a state — but it is worth saying, because the far more
  // common cause is a component that returned null when it meant to render.
  return {
    ...base,
    status: "pass",
    detail: html.length > 0 ? `rendered ${html.length} bytes of DOM` : "rendered no DOM",
    durationMs,
    ...(consoleErrors.length > 0 ? { consoleErrors } : {}),
  };
}
