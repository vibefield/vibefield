import {
  type AppearanceOverrideSource,
  createAppearanceOverrideStore,
} from "@vibefield/field-app/appearance";
import type { ProductAppearanceRendererApi } from "../studio/product-preload-bridge";

export function createStudioProductAppearanceSource(api: ProductAppearanceRendererApi): {
  source: AppearanceOverrideSource;
  dispose(): void;
} {
  const store = createAppearanceOverrideStore();
  const dispose = api.onCommand((command) => {
    const result =
      command.type === "appearance.apply"
        ? store.apply(command.revision, command.serialized)
        : store.clear(command.revision);
    if (result.status === "applied") {
      api.reportApplied(result.revision);
    } else {
      api.reportRejected(result.revision, result.code);
    }
  });
  return { source: store, dispose };
}
