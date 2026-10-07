import { defaultProductAppearance, serializeVisualTweaks } from "@vibefield/field-app/appearance";
import { describe, expect, it, vi } from "vitest";
import { createStudioProductAppearanceSource } from "../src/renderer-host/studio-product-appearance";
import type {
  ProductAppearanceCommand,
  ProductAppearanceRendererApi,
} from "../src/studio/product-preload-bridge";

describe("Studio product appearance adapter", () => {
  it("applies, rejects, and clears complete snapshots with exact acknowledgements", () => {
    const commandHandlers: Array<(command: ProductAppearanceCommand) => void> = [];
    const unsubscribe = vi.fn();
    const applied = vi.fn();
    const rejected = vi.fn();
    const api: ProductAppearanceRendererApi = {
      onCommand(handler) {
        commandHandlers.push(handler);
        return unsubscribe;
      },
      reportApplied: applied,
      reportRejected: rejected,
      reportContext: vi.fn(),
    };
    const adapter = createStudioProductAppearanceSource(api);
    const appearance = defaultProductAppearance();
    appearance.canvasPalette.bgLight = "#F2EAD3";
    const commandHandler = commandHandlers[0];
    if (commandHandler === undefined) throw new Error("the adapter did not subscribe");

    commandHandler({
      type: "appearance.apply",
      revision: 1,
      serialized: serializeVisualTweaks(appearance),
    });
    expect(adapter.source.snapshot()).toEqual({ revision: 1, appearance });
    expect(applied).toHaveBeenCalledWith(1);

    commandHandler({ type: "appearance.apply", revision: 2, serialized: "not json" });
    expect(adapter.source.snapshot()).toEqual({ revision: 2, appearance });
    expect(rejected).toHaveBeenCalledWith(2, "invalid-document");

    commandHandler({ type: "appearance.clear", revision: 3, reason: "live-disabled" });
    expect(adapter.source.snapshot()).toEqual({ revision: 3, appearance: null });
    expect(applied).toHaveBeenCalledWith(3);

    adapter.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
