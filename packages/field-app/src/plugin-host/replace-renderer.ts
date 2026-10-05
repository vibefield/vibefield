import type { RendererLogger } from "../logging";

// THE RENDERER MOVE, CARRIED OUT (DK-9, window-kinds.ts's RENDERER: a plugin's kinds changed in a way this
// realm cannot take — an update's new code or schema, a type a ghost stub defined faceless — so a NEW
// DOCUMENT carries them and reopens the window's own board, `vf-window-doc`). The board is SAVED first (its
// lease closed, its lane drained); then the shell's door replaces this renderer — main reloads the page,
// because the page's own `location.reload()` is a navigation the shell's contents policy refuses in every
// mode but dev (electron-shell security-policy.ts), which left the window on a drained board, its lane
// closed, its kinds never moved. A host with no door (a browser harness) reloads the page itself.
//
// A save that fails or does not settle is SAID and the replacement goes on: the kinds are already another
// realm's, and a window that waited forever on its save would sit on a closed lane.

/** How long the board's save may take before the renderer is replaced regardless. */
export const REPLACE_SAVE_DEADLINE_MS = 10_000;

export async function replaceThisRenderer(deps: {
  /** Save the board and let it go (DocManager.shutdown). */
  shutdown(): Promise<void>;
  /** The shell's door (`FieldHost.replaceRenderer`); undefined where the host has none. */
  readonly door: ((reason: "plugin-kinds") => Promise<unknown>) | undefined;
  /** The page's own reload — the door's stand-in where there is none. */
  reload(): void;
  readonly log: RendererLogger;
  readonly saveDeadlineMs?: number;
}): Promise<void> {
  const deadlineMs = deps.saveDeadlineMs ?? REPLACE_SAVE_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), deadlineMs);
  });
  try {
    const saved = await Promise.race([deps.shutdown().then(() => "saved" as const), late]);
    if (saved === "late") {
      deps.log.error(
        "renderer.plugins.replace_save_late",
        "The board's save did not settle in time; the renderer is replaced regardless",
        undefined,
        { deadlineMs },
      );
    }
  } catch (error) {
    deps.log.error("renderer.plugins.replace_save_failed", "The board did not save first", error);
  } finally {
    clearTimeout(timer);
  }
  if (deps.door === undefined) {
    deps.reload();
    return;
  }
  deps.log.info(
    "renderer.plugins.replace_requested",
    "The shell is asked to replace this renderer",
  );
  try {
    await deps.door("plugin-kinds");
  } catch (error) {
    deps.log.error(
      "renderer.plugins.replace_refused",
      "The shell did not replace this renderer; it reloads itself",
      error,
    );
    deps.reload();
  }
}
