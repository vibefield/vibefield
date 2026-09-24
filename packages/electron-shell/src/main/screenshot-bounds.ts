import type { ScreenshotBounds, ScreenshotCaptureResult } from "@vibefield/contracts";

export interface ScreenshotDisplay {
  readonly id: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

/** The shell knows the display layout; the renderer does not. Preserve the
 * helper's v1 bounds and add an explicit, normalized rect for presentation. */
export function withScreenshotScreenBounds(
  result: ScreenshotCaptureResult,
  platform: NodeJS.Platform,
  displays: readonly ScreenshotDisplay[],
  screenToDipRect: (bounds: ScreenshotBounds) => ScreenshotDisplay["bounds"],
): ScreenshotCaptureResult {
  if (result.status !== "ok") return result;
  const { screenBounds: _untrusted, ...still } = result;
  const { bounds } = still;
  if (platform === "darwin") {
    const display = displays.find((candidate) => candidate.id === still.displayId);
    if (display === undefined) return still;
    return {
      ...still,
      screenBounds: {
        x: display.bounds.x + bounds.x,
        y: display.bounds.y + display.bounds.height - bounds.y - bounds.height,
        width: bounds.width,
        height: bounds.height,
      },
    };
  }
  if (platform === "win32") {
    return { ...still, screenBounds: { ...screenToDipRect(bounds) } };
  }
  return still;
}
