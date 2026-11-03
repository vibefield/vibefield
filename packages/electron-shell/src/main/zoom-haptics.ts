import { createRequire } from "node:module";
import { isAbsolute } from "node:path";

interface NativeHaptics {
  alignment(): boolean;
}

/** Lazy, once per shell. Unsupported hosts do nothing; a failed optional
 * feedback device never interrupts navigation or retries on every frame. */
export function createDesktopHaptics(options: {
  platform: string;
  path: string | null;
  load?: (path: string) => unknown;
  onError?: (error: unknown) => void;
}): () => void {
  let attempted = false;
  let addon: NativeHaptics | null = null;
  return () => {
    if (options.platform !== "darwin" || options.path === null) return;
    if (!attempted) {
      attempted = true;
      try {
        if (!isAbsolute(options.path)) throw new Error("haptic adapter path must be absolute");
        const raw = (options.load ?? createRequire(__filename))(options.path);
        if (
          typeof raw !== "object" ||
          raw === null ||
          typeof (raw as NativeHaptics).alignment !== "function"
        ) {
          throw new Error("haptic adapter has an invalid export surface");
        }
        addon = raw as NativeHaptics;
      } catch (error) {
        options.onError?.(error);
      }
    }
    if (addon === null) return;
    try {
      addon.alignment();
    } catch (error) {
      addon = null;
      options.onError?.(error);
    }
  };
}

/** A narrow, payload-free door. Embedded content and background windows
 * cannot vibrate the trackpad; the rate limit is shared across all windows. */
export function createZoomHapticDoor<Sender>(options: {
  owns: (sender: Sender) => boolean;
  focused: (sender: Sender) => boolean;
  perform: () => void;
  now?: () => number;
}): (sender: Sender, mainFrame: boolean, argumentCount: number) => void {
  let last = Number.NEGATIVE_INFINITY;
  const now = options.now ?? (() => performance.now());
  return (sender, mainFrame, argumentCount) => {
    if (!mainFrame || argumentCount !== 0 || !options.owns(sender) || !options.focused(sender))
      return;
    const time = now();
    if (!Number.isFinite(time) || time - last < 80) return;
    last = time;
    options.perform();
  };
}
