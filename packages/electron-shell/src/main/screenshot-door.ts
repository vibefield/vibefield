import {
  ScreenshotCaptureRequest,
  type ScreenshotCaptureResult,
  ScreenshotCaptureResult as ScreenshotCaptureResultSchema,
} from "@vibefield/contracts";

// The IPC door's policy half (SNAP-D3), pure so it can be pinned without
// Electron: only a window THIS shell registered may ask, the request is
// schema-checked at the seam, and the answer is validated BEFORE it crosses —
// a tool that returned something the contract refuses throws here, on main's
// side, rather than reaching a page as a shape it never agreed to. The
// ipcMain wiring lives in ipc.ts, like every other door's.

export interface ScreenshotDoorOptions<Sender extends { readonly id: number }> {
  readonly owns: (sender: Sender) => boolean;
  readonly capture: () => Promise<ScreenshotCaptureResult>;
  readonly onRefused?: (sender: Sender) => void;
  readonly onFinished?: (result: ScreenshotCaptureResult, sender: Sender) => void;
}

export type ScreenshotDoor<Sender extends { readonly id: number }> = (
  sender: Sender,
  raw: unknown,
) => Promise<ScreenshotCaptureResult>;

export function createScreenshotDoor<Sender extends { readonly id: number }>(
  options: ScreenshotDoorOptions<Sender>,
): ScreenshotDoor<Sender> {
  return async (sender, raw) => {
    if (!options.owns(sender)) {
      options.onRefused?.(sender);
      throw new Error("screenshot capture refused: unregistered sender");
    }
    ScreenshotCaptureRequest.parse(raw);
    const result = ScreenshotCaptureResultSchema.parse(await options.capture());
    options.onFinished?.(result, sender);
    return result;
  };
}
