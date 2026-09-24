import {
  ScreenshotPreviewRequest,
  type ScreenshotPreviewResult,
  screenshotStillUrl,
} from "@vibefield/contracts";
import type { StillResolution } from "./still-protocol";

/** Keep native Quick Look behind the same retained-file authority as <img>.
 * The renderer can select a still; it cannot ask the OS to open arbitrary paths. */
export function createScreenshotPreviewDoor<Sender>(options: {
  owns: (sender: Sender) => boolean;
  resolve: (url: string) => StillResolution;
  preview: (sender: Sender, path: string) => Promise<void>;
}): (sender: Sender, raw: unknown) => Promise<ScreenshotPreviewResult> {
  return async (sender, raw) => {
    if (!options.owns(sender)) throw new Error("screenshot preview refused: unregistered sender");
    const { name } = ScreenshotPreviewRequest.parse(raw);
    const still = options.resolve(screenshotStillUrl(name));
    if (!still.ok)
      return { ok: false, message: "This screenshot is no longer available to preview." };
    try {
      await options.preview(sender, still.path);
      return { ok: true };
    } catch {
      return { ok: false, message: "The screenshot preview could not be opened. Try again." };
    }
  };
}
