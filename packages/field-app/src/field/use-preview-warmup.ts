import type { WidgetType } from "@vibecook/ice";
import { captureWidgetPreviews } from "@vibecook/ice/r3f";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { useEffect } from "react";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { DocManager } from "../doc-manager";

// PreviewWarmup (§5.4.3): preview discovery (GL-surface widgets from the
// registry), scheduling into the manager's loading pipeline, and the context
// limit — chunks of 3, because each capture call owns one WebGL context and 7
// rapid context cycles flirts with the browser cap; skip-if-captured inside
// captureWidgetPreviews makes doc-switch re-runs instant. Boots the manager
// after registering (StrictMode double-effect is absorbed by boot()'s guard).
// The environment stays a factory built ON the capture renderer: PMREM
// textures don't cross renderers.

export function usePreviewWarmup(manager: DocManager, registry: PluginRegistry<WidgetType>): void {
  useEffect(() => {
    manager.setPreviewRunner(async (onTick) => {
      const glTypes = [...registry.allWidgets().values()]
        .filter((w) => w.surface === "gl")
        .map((w) => w.type);
      const chunks: string[][] = [];
      for (let i = 0; i < glTypes.length; i += 3) chunks.push(glTypes.slice(i, i + 3));
      let done = 0;
      onTick(0, glTypes.length);
      for (const types of chunks) {
        await captureWidgetPreviews({
          types,
          environment: (gl) =>
            new PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture,
        });
        done += types.length;
        onTick(done, glTypes.length);
      }
    });
    void manager.boot();
    return () => manager.setPreviewRunner(null);
  }, [manager, registry]);
}
