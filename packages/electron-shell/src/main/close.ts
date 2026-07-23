import { type CloseRequest, type CloseResult, IPC_CHANNELS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { type BrowserWindow, dialog, ipcMain } from "electron";

// The durable-close protocol, main side (ESR §6.4): one active attempt per
// window, request ids bind replies, sender is checked, renderer destruction is
// a FAILED drain, and force quit is the user's decision — never the default.

let closeRequestSequence = 0;

export function prepareRendererClose(win: BrowserWindow, timeoutMs = 15_000): Promise<void> {
  const requestId = `${win.id}:${++closeRequestSequence}`;
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      ipcMain.off(IPC_CHANNELS.closeResult, onReply);
      win.webContents.off("destroyed", onDestroyed);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReply = (event: Electron.IpcMainEvent, result: CloseResult) => {
      if (event.sender !== win.webContents || result?.requestId !== requestId) return;
      if (result.ok) finish();
      else finish(new Error(result.error ?? "renderer could not persist the document"));
    };
    const onDestroyed = () => finish(new Error("renderer exited before saving completed"));
    const timeout = setTimeout(
      () => finish(new Error(`document shutdown timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    ipcMain.on(IPC_CHANNELS.closeResult, onReply);
    win.webContents.once("destroyed", onDestroyed);
    win.webContents.send(IPC_CHANNELS.prepareClose, {
      requestId,
      reason: "window",
    } satisfies CloseRequest);
  });
}

export function installDurableClose(win: BrowserWindow, logger?: Logger): void {
  let closeAllowed = false;
  let busy = false;

  const attemptClose = async (): Promise<void> => {
    if (busy || win.isDestroyed()) return;
    busy = true;
    try {
      await prepareRendererClose(win);
      closeAllowed = true;
      win.close();
    } catch (error) {
      logger?.error(
        "desktop.window.close_prepare_failed",
        "The renderer could not complete its durable close",
        error,
        { windowId: String(win.id) },
      );
      const detail = error instanceof Error ? error.message : String(error);
      const choice = await dialog.showMessageBox(win, {
        type: "error",
        title: "Document Not Saved",
        message: "VibeField could not finish saving this document.",
        detail,
        buttons: ["Retry", "Quit Without Saving"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      busy = false;
      if (choice.response === 0) {
        logger?.info("desktop.window.close_retry_requested", "The user retried durable close", {
          windowId: String(win.id),
        });
        void attemptClose();
      } else if (!win.isDestroyed()) {
        logger?.warn(
          "desktop.window.close_forced",
          "The user closed the window without a successful renderer drain",
          { windowId: String(win.id) },
        );
        closeAllowed = true;
        win.close();
      }
    }
  };

  win.on("close", (event) => {
    if (closeAllowed) return;
    event.preventDefault();
    void attemptClose();
  });
}
