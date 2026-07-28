import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  ipcMain: {
    on: vi.fn(),
    off: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

vi.mock("electron", () => electron);

import { installDurableClose } from "../src/main/close";

describe("installDurableClose", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces the closing generation synchronously and only once", () => {
    let closeListener: ((event: { preventDefault(): void }) => void) | undefined;
    const webContents = {
      once: vi.fn(),
      off: vi.fn(),
      send: vi.fn(),
    };
    const window = {
      id: 7,
      webContents,
      isDestroyed: () => false,
      close: vi.fn(),
      on: vi.fn((event: string, listener: typeof closeListener) => {
        if (event === "close") closeListener = listener;
      }),
    } as unknown as BrowserWindow;
    const onClosing = vi.fn();
    installDurableClose(window, undefined, onClosing);
    const event = { preventDefault: vi.fn() };

    closeListener?.(event);
    closeListener?.(event);

    expect(onClosing).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(webContents.send).toHaveBeenCalledTimes(1);
    vi.clearAllTimers();
  });
});
