import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import { readClipboardText } from "../src/terminal/clipboard";

// Item 102 — the one reader a terminal's paste is handed: the host's door where
// the desktop app has one (main reads the clipboard; the web's read is denied
// there, ESP §7.4), the web's own read where there is no host door (the browser
// catalog), and a refusal that rejects so nothing is pasted.

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

function webRead(text: string) {
  const readText = vi.fn(async () => text);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
  return readText;
}

describe("readClipboardText (item 102)", () => {
  it("reads through the host's door when there is one, never the web's", async () => {
    const door = vi.fn(async () => "from main");
    setHost({ logger: {}, clipboard: { readText: door } } as unknown as FieldHost);
    const web = webRead("from the page");
    await expect(Promise.resolve(readClipboardText())).resolves.toBe("from main");
    expect(door).toHaveBeenCalledOnce();
    expect(web).not.toHaveBeenCalled();
  });

  it("keeps the web's read where the host has no door (the browser catalog)", async () => {
    setHost({ logger: {} } as unknown as FieldHost);
    const web = webRead("from the page");
    await expect(Promise.resolve(readClipboardText())).resolves.toBe("from the page");
    expect(web).toHaveBeenCalledOnce();
  });

  it("a refusal rejects, so the paste carries nothing", async () => {
    setHost({
      logger: {},
      clipboard: { readText: () => Promise.reject(new Error("not focused")) },
    } as unknown as FieldHost);
    await expect(Promise.resolve(readClipboardText())).rejects.toThrow(/not focused/);
  });
});
