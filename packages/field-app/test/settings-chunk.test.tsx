// @vitest-environment happy-dom
/**
 * Settings on demand (Q20; James, 2026-10-28, the housekeeping page;
 * `panels/settings-chunk.tsx`). The rows: the barrel leaves the panel's module
 * unasked until the first open, and a second open neither asks nor waits;
 * nothing is drawn while the chunk arrives; a chunk that will not load or a
 * panel that fails as it draws is held in the dialog's place, in what failed's
 * own words, with Retry, and the window stands. (`pnpm bundle:assert` holds the
 * build; `ui-system-boundaries` the source.)
 */
import type { CanvasEngine } from "@vibecook/ice";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RendererLogger, setRendererLogger } from "../src/logging";
import { SettingsPanelMount } from "../src/panels";
import type { SettingsPanelProps } from "../src/panels/SettingsPanel";
import { settingsPanelLoader } from "../src/panels/settings-chunk";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelModule = typeof import("../src/panels/SettingsPanel");

/** The product's dynamic import, counted: a static import anywhere on the barrel's path asks at load time. */
const product = vi.hoisted(() => ({ asked: 0 }));

vi.mock("../src/panels/SettingsPanel", async () => {
  product.asked += 1;
  const { createElement } = await import("react");
  return { SettingsPanel: () => createElement("div", { "data-panel": "product" }) };
});

const REFUSAL =
  "Failed to fetch dynamically imported module: vibefield-app://shell/assets/SettingsPanel-B3aXq9Lk.js";

const standIn = (): PanelModule =>
  ({
    SettingsPanel: (props: SettingsPanelProps) => (
      <div data-panel="stand-in" data-page={props.initialPage} />
    ),
  }) as unknown as PanelModule;

const PANEL: SettingsPanelProps = {
  engine: {} as CanvasEngine,
  initialPage: "sound",
  onClose: () => undefined,
};

let root: Root | null = null;
let host: HTMLElement | null = null;
let logged: string[] = [];

function mount(element: ReactElement): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

function unmount(): void {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

const panel = (): HTMLElement | null | undefined => host?.querySelector("[data-panel]");
const failed = (): HTMLElement | null | undefined =>
  host?.querySelector(".vf-ui-unavailable-state");

async function until<T>(read: () => T | null | undefined, label: string): Promise<T> {
  // Inside vitest's 5 s row timeout, so a row that never sees it says what it waited for.
  const deadline = Date.now() + 4_000;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function pressRetry(face: HTMLElement): void {
  const retry = face.querySelector("button");
  expect(retry?.textContent).toBe("Retry");
  act(() => retry?.click());
}

beforeEach(() => {
  logged = [];
  const logger = {
    child: () => logger,
    info: () => undefined,
    error: (event: string) => {
      logged.push(event);
    },
  } as unknown as RendererLogger;
  setRendererLogger(logger);
});

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

describe("Settings on demand: the chunk", () => {
  it("leaves the panel's module unasked until the first open, then asks once across opens", async () => {
    expect(product.asked).toBe(0);
    mount(<SettingsPanelMount {...PANEL} />);
    await until(panel, "the product's panel");
    expect(product.asked).toBe(1);
    unmount();
    mount(<SettingsPanelMount {...PANEL} />);
    expect(panel()).not.toBeNull();
    expect(product.asked).toBe(1);
  });

  it("draws nothing while the chunk is on its way, then the panel with what it was handed", async () => {
    let land: (module: PanelModule) => void = () => undefined;
    const loader = settingsPanelLoader(
      () =>
        new Promise<PanelModule>((resolve) => {
          land = resolve;
        }),
    );
    mount(<SettingsPanelMount {...PANEL} loader={loader} />);
    expect(host?.innerHTML).toBe("");
    await act(async () => land(standIn()));
    const drawn = await until(panel, "the panel once it lands");
    expect(drawn.getAttribute("data-page")).toBe("sound");
  });

  it("draws a second open at once: the chunk is here, and is not asked for again", async () => {
    let asked = 0;
    const loader = settingsPanelLoader(async () => {
      asked += 1;
      return standIn();
    });
    mount(<SettingsPanelMount {...PANEL} loader={loader} />);
    await until(panel, "the first open");
    unmount();
    mount(<SettingsPanelMount {...PANEL} loader={loader} />);
    expect(panel()).not.toBeNull();
    expect(asked).toBe(1);
  });
});

describe("Settings on demand: a panel that cannot open", () => {
  /** A chunk refused until the row lets it land; the count of asks is the row's to read. */
  function refusing(): { loader: ReturnType<typeof settingsPanelLoader>; asks: () => number } {
    let asks = 0;
    const loader = settingsPanelLoader(async () => {
      asks += 1;
      if (asks === 1) throw new TypeError(REFUSAL);
      return standIn();
    });
    return { loader, asks: () => asks };
  }

  it("says a refused chunk in the dialog's place, in its own words, and Retry opens the panel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loader, asks } = refusing();
    mount(<SettingsPanelMount {...PANEL} loader={loader} />);
    const face = await until(failed, "the could-not-open face");
    expect(face.querySelector("strong")?.textContent).toBe("Settings could not open");
    expect(face.querySelector(".vf-ui-unavailable-state__detail")?.textContent).toBe(REFUSAL);
    expect(panel()).toBeNull();
    expect(logged).toContain("renderer.settings.panel_failed");

    pressRetry(face);
    await until(panel, "the panel after Retry");
    expect(failed()).toBeNull();
    expect(asks()).toBe(2);
  });

  it("asks again when a refused Settings is closed and opened, with no Retry pressed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loader, asks } = refusing();
    mount(<SettingsPanelMount {...PANEL} loader={loader} />);
    await until(failed, "the could-not-open face");
    unmount();
    mount(<SettingsPanelMount {...PANEL} loader={loader} />);
    await until(panel, "the panel on the next open");
    expect(asks()).toBe(2);
  });

  it("holds a panel that fails as it draws the same way, and the window stands", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let falls = true;
    const loader = settingsPanelLoader(
      async () =>
        ({
          SettingsPanel: () => {
            if (falls) throw new Error("the panel fell");
            return <div data-panel="stood" />;
          },
        }) as unknown as PanelModule,
    );
    mount(
      <>
        <span data-window="" />
        <SettingsPanelMount {...PANEL} loader={loader} />
      </>,
    );
    const face = await until(failed, "the could-not-open face");
    expect(face.querySelector(".vf-ui-unavailable-state__detail")?.textContent).toBe(
      "the panel fell",
    );
    expect(host?.querySelector("[data-window]")).not.toBeNull();

    falls = false;
    pressRetry(face);
    await until(panel, "the panel after Retry");
    expect(failed()).toBeNull();
  });

  it("closes on a press outside the card, and only there", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onClose = vi.fn();
    const { loader } = refusing();
    mount(<SettingsPanelMount {...PANEL} onClose={onClose} loader={loader} />);
    const face = await until(failed, "the could-not-open face");
    act(() => {
      face.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      host
        ?.querySelector(".vf-settings-backdrop")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
