/**
 * HN-5 — A PROGRAM'S CLIPBOARD WRITE (terminal/clipboard.ts, terminal/pool/runtime-factory.ts;
 * DESIGN.md §8 "The hand", LC-14): a terminal's OSC 52 reaches ghosttea's runtime platform
 * `writeClipboard`, which the window's runtime hands the host's copy door — never the web's
 * write, which the app's empty grant set denies — and it deals NO card: a program's write is
 * not the person's copy. A refusal never throws into ghosttea and is logged once for a run of
 * refusals, by its size and what the door was told, never its words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardsStore } from "../src/frame/cards/cards-store";
import { type FieldHost, setHost } from "../src/host";
import { type RendererLogger, setRendererLogger } from "../src/logging";

const built = vi.hoisted(() => ({
  options: [] as Array<{ platform: { writeClipboard(text: string): void } }>,
}));

// The runtime is ghosttea's; what is pinned here is the platform the window hands it.
vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: (options: (typeof built.options)[number]) => {
    built.options.push(options);
    return {};
  },
  waitForGhostteaRendererPorts: () => new Promise(() => undefined),
}));
// Vite's `?worker` import has no meaning in a test runner (terminal-pool-idle-zero's one mock)
vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

const { createTerminalRuntime } = await import("../src/terminal/pool/runtime-factory");
const { programClipboardWriter } = await import("../src/terminal/clipboard");

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

/** The page's own clipboard: never to be written in the app. */
function webClipboard() {
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

/** The renderer's log, as the terminal's lines reach it. */
function hearLog(): Array<{ event: string; attrs: unknown }> {
  const heard: Array<{ event: string; attrs: unknown }> = [];
  const logger = {
    child: () => logger,
    warn: (event: string, _message: string, attrs?: unknown) => heard.push({ event, attrs }),
  } as unknown as RendererLogger;
  setRendererLogger(logger);
  return heard;
}

beforeEach(() => {
  built.options.length = 0;
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("a program's clipboard write (HN-5, LC-14)", () => {
  it("goes through the host's copy door, never the web's, and deals no card", async () => {
    const copyText = vi.fn(async (_text: string) => undefined);
    setHost({ logger: {}, diagnostics: { copyText } } as unknown as FieldHost);
    const web = webClipboard();
    const before = cardsStore.snapshot().cards.length;
    createTerminalRuntime({ transport: "routed", host: {} as never });
    const platform = built.options.at(-1)?.platform;
    if (platform === undefined) throw new Error("no runtime was built");
    platform.writeClipboard("hn5-osc52");
    await settle();
    expect(copyText).toHaveBeenCalledWith("hn5-osc52");
    expect(web).not.toHaveBeenCalled();
    expect(cardsStore.snapshot().cards).toHaveLength(before);
  });

  it("never throws into ghosttea, and logs a run of refusals once, by size and why", async () => {
    let takes = false;
    const host = {
      diagnostics: {
        copyText: async (_text: string) => {
          if (!takes) throw new Error("diagnostics request timed out");
        },
      },
    };
    const heard = hearLog();
    const write = programClipboardWriter(host);
    expect(() => write("tskey-auth-secret")).not.toThrow();
    write("again");
    await settle();
    // what the door was told is logged beside the door's one sentence (HN-5: never only it)
    expect(heard).toEqual([
      {
        event: "renderer.terminal.clipboard_write_refused",
        attrs: {
          bytes: 17,
          reason: "the clipboard did not take the words",
          error: "diagnostics request timed out",
        },
      },
    ]);
    expect(JSON.stringify(heard)).not.toContain("tskey");
    // a write that lands lets the next refusal speak: past the copy door's bound, in its terms
    takes = true;
    write("landed");
    await settle();
    write("x".repeat(70_000));
    await settle();
    expect(heard).toHaveLength(2);
    expect(heard[1]).toEqual({
      event: "renderer.terminal.clipboard_write_refused",
      attrs: {
        bytes: 70_000,
        reason: "the words hold 70 KB; the clipboard takes at most 65 KB",
        error: "too-large: words 70000 bytes, past 65536",
      },
    });
  });

  it("keeps the web's own write where there is no host (the browser catalog)", async () => {
    const web = webClipboard();
    programClipboardWriter(null)("from the catalog");
    await settle();
    expect(web).toHaveBeenCalledWith("from the catalog");
  });
});
