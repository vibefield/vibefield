import type { WidgetType } from "@vibecook/ice";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { useEffect } from "react";
import type { DocManager } from "../doc-manager";

// PreviewWarmup (§5.4.3): preview discovery, scheduling into the manager's
// loading pipeline, and the boot of the manager.
//
// DK-2 (desk/landing, ICE 0.14.0): there is nothing to warm. The runner captured
// GL-surface widgets' tray previews through ICE's `/r3f` entry's
// `captureWidgetPreviews` under a three PMREM environment — the R3F islands, the
// preview capture and `WidgetType.surface` are all gone (a desk kind draws its own
// specimen on the pegboard, DK-13). The runner now reports an empty stage at once
// so the manager's loading veil never waits on previews (doc-manager's veil wait
// itself is DK-4's to retire), and the manager still boots here.
export function usePreviewWarmup(manager: DocManager, registry: PluginRegistry<WidgetType>): void {
  useEffect(() => {
    manager.setPreviewRunner(async (onTick) => {
      onTick(0, 0);
    });
    void manager.boot();
    return () => manager.setPreviewRunner(null);
  }, [manager, registry]);
}
