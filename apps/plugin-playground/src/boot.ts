// THE BOOTSTRAP — everything that must happen before a single product module is
// imported, and therefore the one file Node loads directly (type-stripped) rather
// than through Vite.
//
// Two jobs, in this order and only this order:
//
//  1. A DOM on globalThis. React DOM reads `document` when its module body runs,
//     so the window has to exist BEFORE anything in the graph imports it. Once
//     react-dom has bound a document, no later swap fixes it.
//  2. A Vite dev server used purely as a module loader. The graph a widget verdict
//     needs is .ts + .tsx + .css + workspace packages that export SOURCE — which
//     is the renderer's own build pipeline, not something Node's type stripping
//     can approximate. Running the real transform is what makes this a verdict
//     about the plugin rather than about the harness.
//
// Everything after this point is loaded THROUGH the server, so bare specifiers in
// those modules resolve exactly as they do in the app.
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's own directory, so the loader can find `src/cli.ts` no matter
 * which directory the bin was invoked from. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** apps/plugin-playground -> the workspace root. */
const WORKSPACE_ROOT = resolve(PACKAGE_ROOT, "..", "..");

/** The window properties a widget graph actually reaches for. An explicit list,
 * not a blanket copy of the happy-dom window: overwriting a Node global (`fetch`,
 * `crypto`, `performance`, timers) with a synthetic one is how a harness starts
 * answering for itself instead of for the code under test. */
const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "Element",
  "HTMLElement",
  "HTMLCanvasElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "SVGElement",
  "Node",
  "Text",
  "DocumentFragment",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "WheelEvent",
  "FocusEvent",
  "InputEvent",
  "DragEvent",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "DOMRect",
  "DOMPoint",
  "CSSStyleSheet",
  "Image",
  "matchMedia",
  "scrollTo",
] as const;

export interface Harness {
  /** Load a module through the real transform pipeline. */
  readonly load: (absolutePath: string) => Promise<Record<string, unknown>>;
  readonly close: () => Promise<void>;
}

/** Install a DOM on globalThis. Idempotent: a second call (tests in one process)
 * keeps the first window, because react-dom is already bound to it. */
export async function installDom(): Promise<void> {
  if (globalThis.document !== undefined) return;
  const { Window } = await import("happy-dom");
  const win = new Window({ url: "https://plugin-playground.vibefield.local/" });
  const source = win as unknown as Record<string, unknown>;
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (target[key] !== undefined) continue;
    const value = source[key];
    if (value === undefined) continue;
    Object.defineProperty(target, key, {
      value: typeof value === "function" ? (value as () => void).bind(win) : value,
      configurable: true,
      writable: true,
    });
  }
  // The Node-26 localStorage shim, same defect and same fix as field-app's own
  // test setup (test/setup.ts): Node defines an OWN `localStorage` key that
  // evaluates to undefined without --localstorage-file, so the loop above skips
  // it AND happy-dom's real Storage never lands. Product code reads it at module
  // init. Defined unconditionally rather than after an `=== undefined` check —
  // READING Node's property is what prints its ExperimentalWarning, and a tool
  // that warns on every run has taught its users to ignore its stderr.
  {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length(): number {
          return map.size;
        },
        clear: () => map.clear(),
        getItem: (k: string) => map.get(k) ?? null,
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => {
          map.delete(k);
        },
        setItem: (k: string, v: string) => {
          map.set(k, String(v));
        },
      } satisfies Storage,
    });
  }
}

/**
 * Stand up the module loader.
 *
 * `extraRoots` are directories the run needs to read outside the workspace — a
 * plugin being authored elsewhere. Named explicitly rather than opening the
 * filesystem: this tool imports and EXECUTES what it is pointed at, so the set
 * of places it will do that from should be a decision, not a default.
 */
export async function createHarness(extraRoots: readonly string[] = []): Promise<Harness> {
  const { createServer } = await import("vite");
  const allow = [WORKSPACE_ROOT, ...extraRoots.filter((p) => existsSync(p))];
  const server = await createServer({
    root: WORKSPACE_ROOT,
    // The repo's vite configs are renderer/build configs; picking one up here
    // would apply an app's plugins to an authoring harness.
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    // A loader, not a server: no HTTP listener, no HMR socket, no file watcher.
    server: { middlewareMode: true, hmr: false, watch: null, fs: { allow: [...allow] } },
    // Workspace packages export .ts sources, which Node cannot load — they must
    // ride the transform. Everything else (react, react-dom, ice, three) stays
    // EXTERNAL so each is the single real instance Node resolved, which is what
    // keeps hooks and ICE's process-global widget catalog working across the
    // host/plugin boundary.
    ssr: { noExternal: [/^@vibefield\//] },
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
  });
  return {
    load: (absolutePath) => server.ssrLoadModule(absolutePath) as Promise<Record<string, unknown>>,
    close: () => server.close(),
  };
}

/** The bin's whole body: DOM, loader, then hand control to the CLI — which lives
 * on the far side of the loader so it can import the product graph normally. */
export async function boot(argv: readonly string[]): Promise<number> {
  let harness: Harness | undefined;
  try {
    await installDom();
    // Any argument that names an existing directory is a candidate plugin root;
    // reading it is the point of the run, so it joins the allow list.
    const roots = argv.filter((a) => !a.startsWith("-")).map((a) => resolve(a));
    harness = await createHarness(roots.filter((p) => existsSync(p) && statSync(p).isDirectory()));
    const cli = await harness.load(resolve(PACKAGE_ROOT, "src", "cli.ts"));
    const main = cli.main as (argv: readonly string[], harness: Harness) => Promise<number>;
    return await main(argv, harness);
  } catch (error) {
    // Exit 2 — the harness failed, which is a different fact from "the plugin
    // was refused" and must never be reported as one.
    process.stderr.write(
      `plugin-playground: harness error\n  ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    return 2;
  } finally {
    await harness?.close();
  }
}
