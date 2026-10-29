import type { TerminalCreateOpenResult } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import { SignInTerminal } from "../src/panels/agents/SignInTerminal";

// Item 102 — the sign-in terminal (AR-S2) pasted nothing, as the deck did: it
// handed ghosttea the web's clipboard read, which the shell's empty grant set
// denies (ESP §7.4), and ghosttea, given `readClipboard`, takes the paste chord
// itself. A device code or a pasted token is what this pane exists for, so its
// reader is the host's door now. Everything around the surface is a stand-in:
// this asks only which reader the surface was handed. Each stand-in answers
// one value for the test's life: the card adopts again whenever its client or
// its pool changes, and a fresh object per render would adopt without end.

const stand = vi.hoisted(() => ({
  surfaces: [] as Array<Record<string, unknown>>,
  client: {},
  pool: { runtime: {}, generation: 0 },
  born: { sessionId: "sess-login", session: { id: "sess-login" } },
  appearance: {},
}));

vi.mock("@vibecook/ghosttea-react", () => ({
  GhostteaProvider: ({ children }: { children: unknown }) => children,
  TerminalSurface: (props: Record<string, unknown>) => {
    stand.surfaces.push(props);
    return null;
  },
}));
vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => stand.client,
}));
vi.mock("../src/terminal/pool", () => ({
  adoptCreatedTerminal: () => stand.born,
  prewarmTerminalPool: () => undefined,
  useTerminalPool: () => stand.pool,
  useTerminalSessionViews: () => undefined,
}));
vi.mock("../src/godview/deck-appearance", () => ({
  useDeckAppearance: () => stand.appearance,
}));
vi.mock("../src/godview/deck-theme", () => ({
  godviewTerminalTheme: () => ({ background: [0, 0, 0, 0.8] }),
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  stand.surfaces.length = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("the sign-in terminal's paste reads the clipboard through the host's door (item 102)", () => {
  it("hands ghosttea the host's read, never the web's", async () => {
    const readText = vi.fn(async () => "ABCD-1234");
    setHost({ logger: {}, clipboard: { readText } } as unknown as FieldHost);
    const web = vi.fn(async () => "denied by policy");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: web },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(SignInTerminal, {
          terminal: {} as TerminalCreateOpenResult,
          platform: "darwin",
        }),
      );
    });
    const surface = stand.surfaces[stand.surfaces.length - 1];
    if (surface === undefined) throw new Error("no terminal surface was mounted");
    const readClipboard = surface["readClipboard"] as () => string | Promise<string>;
    await expect(Promise.resolve(readClipboard())).resolves.toBe("ABCD-1234");
    expect(readText).toHaveBeenCalledOnce();
    expect(web).not.toHaveBeenCalled();
  });
});
