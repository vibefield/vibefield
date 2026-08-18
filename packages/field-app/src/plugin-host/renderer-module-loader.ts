import type { RendererPluginModule } from "@vibefield/plugin-sdk";

/** The §10.1 module shape, from either spelling: a namespace carrying `activate`, or one whose
 * `default` does. Nothing else is a plugin module. */
export function asRendererModule(imported: unknown): RendererPluginModule | null {
  const candidates = [
    imported,
    typeof imported === "object" && imported !== null
      ? (imported as { default?: unknown }).default
      : undefined,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { activate?: unknown }).activate === "function"
    ) {
      return candidate as RendererPluginModule;
    }
  }
  return null;
}

/** PRC-5d deferred import seam. Constructing this closure evaluates no plugin code; invocation is
 * owned by RuntimeTargetController activation after retained-old quiescence. */
export function createRendererModuleLoader(
  moduleUrl: string,
  importModule: (url: string) => Promise<unknown> = importRendererModule,
): (signal: AbortSignal) => Promise<RendererPluginModule> {
  return async (signal) => {
    if (signal.aborted) throw new Error("renderer module import was superseded");
    const imported = await importModule(moduleUrl);
    if (signal.aborted) throw new Error("renderer module import was superseded");
    const module = asRendererModule(imported);
    if (module === null) throw new Error("the module exports no activate (§10.1)");
    return module;
  };
}

/** The real import. This URL is daemon authority data, not a build-time module specifier. */
export async function importRendererModule(url: string): Promise<unknown> {
  return await import(/* @vite-ignore */ url);
}
