import {
  defaultProductAppearance,
  deserializeVisualTweaks,
  serializeVisualTweaks,
} from "@vibefield/field-app/appearance";
import { describe, expect, it, vi } from "vitest";
import { ElectronStudioController } from "../src/renderer-host/studio-controller";
import type { HostToStudio } from "../src/studio/protocol";
import type { StudioRendererApi } from "../src/studio/studio-preload-bridge";

function fakeApi(): {
  api: StudioRendererApi;
  publish: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  emit(message: HostToStudio): void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let handler: ((message: HostToStudio) => void) | null = null;
  const publish = vi.fn(() => "studio-1");
  const clear = vi.fn(() => "studio-2");
  const focus = vi.fn();
  const unsubscribe = vi.fn();
  return {
    api: {
      environment: "electron",
      publishAppearance: publish,
      clearAppearance: clear,
      focusProduct: focus,
      onMessage(next) {
        handler = next;
        return unsubscribe;
      },
    },
    publish,
    clear,
    focus,
    unsubscribe,
    emit(message) {
      handler?.(message);
    },
  };
}

describe("ElectronStudioController", () => {
  it("keeps edits local until Live is explicit, then publishes complete snapshots", () => {
    const harness = fakeApi();
    const controller = new ElectronStudioController(harness.api);
    const changed = defaultProductAppearance();
    changed.canvasPalette.bgLight = "#F2EAD3";

    controller.setAppearance(changed);
    expect(controller.snapshot().appearance).toBe(changed);
    expect(harness.publish).not.toHaveBeenCalled();

    controller.setLive(true);
    expect(harness.publish).toHaveBeenCalledOnce();
    expect(deserializeVisualTweaks(harness.publish.mock.calls[0]?.[0] as string)).toEqual(changed);

    const changedAgain = {
      ...changed,
      canvasPalette: { ...changed.canvasPalette, bgDark: "#1E2A22" },
    };
    controller.setAppearance(changedAgain);
    expect(harness.publish).toHaveBeenCalledTimes(2);
    expect(deserializeVisualTweaks(harness.publish.mock.calls[1]?.[0] as string)).toEqual(
      changedAgain,
    );

    controller.setLive(false);
    expect(harness.clear).toHaveBeenCalledOnce();
    expect(controller.snapshot().appearance).toBe(changedAgain);
  });

  it("restores a host snapshot and reports only the current revision as applied", () => {
    const harness = fakeApi();
    const controller = new ElectronStudioController(harness.api);
    const restored = defaultProductAppearance();
    restored.canvasPalette.bgDark = "#1E2A22";
    const listener = vi.fn();
    controller.subscribe(listener);

    harness.emit({
      type: "studio.snapshot",
      revision: 8,
      serialized: serializeVisualTweaks(restored),
      live: true,
    });
    harness.emit({
      type: "studio.status",
      status: {
        productConnection: "connected",
        live: true,
        revision: 8,
        appliedRevision: null,
        rejection: null,
      },
    });
    harness.emit({ type: "appearance.applied", revision: 7 });
    expect(controller.snapshot().appliedRevision).toBeNull();
    harness.emit({ type: "appearance.applied", revision: 8 });

    expect(controller.snapshot()).toMatchObject({
      appearance: restored,
      live: true,
      productConnection: "connected",
      revision: 8,
      appliedRevision: 8,
      rejection: null,
    });
    expect(listener).toHaveBeenCalled();
  });

  it("surfaces invalid restored documents, focuses the app, and disposes cleanly", () => {
    const harness = fakeApi();
    const controller = new ElectronStudioController(harness.api);
    const initial = controller.snapshot().appearance;

    harness.emit({ type: "studio.snapshot", revision: 2, serialized: "{}", live: true });
    expect(controller.snapshot()).toMatchObject({
      appearance: initial,
      live: true,
      revision: 2,
      rejection: "invalid-document",
    });

    controller.focusProduct();
    expect(harness.focus).toHaveBeenCalledOnce();
    controller.dispose();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it("tracks product context, navigation, and a stable transport failure", () => {
    const harness = fakeApi();
    const controller = new ElectronStudioController(harness.api);

    harness.emit({ type: "product.context", theme: "dark", zoom: 1.25 });
    harness.emit({ type: "studio.navigate", section: "appearance" });
    expect(controller.snapshot()).toMatchObject({
      productContext: { theme: "dark", zoom: 1.25 },
      requestedSection: "appearance",
      navigationRevision: 1,
    });

    harness.emit({ type: "studio.disconnected", reason: "version-mismatch" });
    expect(controller.snapshot()).toMatchObject({
      productConnection: "unavailable",
      productContext: null,
      appliedRevision: null,
      transportError: "version-mismatch",
    });
  });
});
