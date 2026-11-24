// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { vitalsFixtureModel, vitalsFixtureOff } from "../src/design-system/vitals-fixtures";
import {
  RECORD_VITALS_LINE,
  RECORD_VITALS_TITLE,
  VITALS_SECTION_LINE,
  VITALS_SECTION_TITLE,
  VitalsRecorderSection,
} from "../src/panels/VitalsRecorderSection";
import { VitalsView } from "../src/vitals/VitalsView";
import { applyDelta } from "../src/vitals/vitals-model";
import { stateWords, VITALS_WORDS } from "../src/vitals/vitals-words";

// VT-2b (track VT, 2026-11-24; VT-D2's second half) — the recorder's switch in Settings → Diagnostics, and the
// Vitals window's off state.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const design = (): string =>
  readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function client(snapshot: Record<string, unknown>, request = vi.fn(async () => ({ ok: true }))) {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method !== "storage.appPreferences.subscribe") {
        throw new Error(`unexpected subscription: ${method}`);
      }
      return { subId: "app-preferences", snapshot, unsubscribe: () => undefined };
    }),
    request,
  } as unknown as FielddClient;
}

async function mount(fieldd: FielddClient, onSettingsChanged?: (undoable: boolean) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client: fieldd },
        createElement(VitalsRecorderSection, {
          ...(onSettingsChanged === undefined ? {} : { onSettingsChanged }),
        }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return container.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="${RECORD_VITALS_TITLE}"]`,
  );
}

const EFFECTIVE = { showTray: true, backgroundShell: true, syncPosture: "automatic" };

describe("VT-2b — Settings → Diagnostics' Vitals section", () => {
  it("is one switch, on from the first run, in DESIGN.md's words", async () => {
    // an older daemon's snapshot does not say the key: it records, and the switch reads on
    const toggle = await mount(client(EFFECTIVE));
    expect(container?.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(toggle?.disabled).toBe(false);
    const text = container?.textContent ?? "";
    const words = design();
    for (const said of [
      VITALS_SECTION_TITLE,
      VITALS_SECTION_LINE,
      RECORD_VITALS_TITLE,
      RECORD_VITALS_LINE,
    ]) {
      expect(text, said).toContain(said);
      expect(words, said).toContain(`"${said}"`);
    }
  });

  it("writes only its own key, and says the change is one undo can take back", async () => {
    const request = vi.fn(async () => ({ ok: true }));
    const changed = vi.fn();
    const toggle = await mount(client({ ...EFFECTIVE, recordVitals: true }, request), changed);
    await act(async () => toggle?.click());
    expect(request.mock.calls).toEqual([
      ["storage.appPreferences.set", { key: "diagnostics.recordVitals", value: false }],
    ]);
    expect(changed).toHaveBeenCalledWith(true);
  });

  it("reads off from the snapshot, and turns it on again", async () => {
    const request = vi.fn(async () => ({ ok: true }));
    const toggle = await mount(client({ ...EFFECTIVE, recordVitals: false }, request));
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle?.click());
    expect(request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "diagnostics.recordVitals",
      value: true,
    });
  });

  it("says a refused write and is not left disabled", async () => {
    const request = vi.fn(async () => {
      throw new Error("the settings document is not ready");
    });
    const toggle = await mount(client({ ...EFFECTIVE, recordVitals: true }, request));
    await act(async () => toggle?.click());
    expect(container?.textContent).toContain("the settings document is not ready");
    expect(toggle?.disabled).toBe(false);
  });

  it("cannot be flipped before the preferences are read", async () => {
    const never = {
      status: "ready",
      onStatusChange: () => () => undefined,
      subscribe: vi.fn(() => new Promise(() => undefined)),
      request: vi.fn(),
    } as unknown as FielddClient;
    const toggle = await mount(never);
    expect(toggle?.disabled).toBe(true);
    expect(container?.textContent).toContain("Loading preferences…");
  });
});

describe("VT-2b — the Vitals window while the recorder is off", () => {
  it("says off in DESIGN.md's words, with a dot that is not the recording one", () => {
    expect(stateWords("off")).toEqual({ words: "Off · turned off in Settings", recording: false });
    const words = design();
    expect(words).toContain("**Off · turned off in Settings**");
    expect(words).toContain(`"${VITALS_WORDS.off}"`);
  });

  it("draws nothing and says where the switch is", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(VitalsView, { model: vitalsFixtureOff(), logs: [] }));
    });
    expect(container.querySelector(".vf-vitals")?.getAttribute("data-state")).toBe("off");
    expect(container.querySelector(".vf-vitals__empty")?.textContent).toBe(VITALS_WORDS.off);
    expect(container.querySelector(".vf-vitals__state")?.textContent).toBe(
      "Off · turned off in Settings",
    );
    expect(container.querySelectorAll("[data-own], .vf-vitals__row")).toHaveLength(0);
  });

  it("drops what it drew when the recorder is turned off under it, and draws again from nothing", () => {
    const drawn = vitalsFixtureModel();
    expect(drawn.samples.length).toBeGreaterThan(0);
    const off = applyDelta(drawn, { state: "off" });
    expect(off.state).toBe("off");
    expect(off.samples).toEqual([]);
    expect(off.processes.size).toBe(0);
    const waiting = applyDelta(off, {
      state: "waiting",
      detail: "the floor's meter has not answered yet",
    });
    expect(waiting.state).toBe("waiting");
    expect(waiting.samples).toEqual([]);
  });
});
