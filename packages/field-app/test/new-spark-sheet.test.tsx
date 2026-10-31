// @vitest-environment happy-dom

import {
  AGENT_CATALOG,
  type AgentModelsResult,
  type AgentProfileSet,
  type AgentProviderSummary,
  type SparkSummary,
} from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewSparkSheet } from "../src/chat/NewSparkSheet";
import type { NewSparkPort } from "../src/chat/new-spark";
import { FIXTURE_NATIVE, FIXTURE_WORK } from "../src/design-system/profiles-fixtures";

// THE NEW SPARK SHEET (SP-1c; DESIGN.md §8 "The New spark sheet"), through the shipping controller and view over a
// stub of its doors: it opens holding a suggested name, selected; ↻ deals another face; the agent menu reads its
// agent's picker once; Create hatches what it asked, flies the face to its row and folds; a refusal is said where the
// sheet asked; Esc folds the menu, then the sheet; and a folded sheet stays for its leave.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THINKER = AGENT_CATALOG[0];
const OTHER = AGENT_CATALOG[2];

const PROVIDERS: AgentProviderSummary[] = [
  {
    id: THINKER.id,
    label: THINKER.label,
    available: true,
    resumable: true,
    personas: [],
    briefing: {
      mcpServers: true,
      allowTools: true,
      instructions: true,
      mcpServerProcess: "terminal",
    },
  },
  { id: OTHER.id, label: OTHER.label, available: true, resumable: false, personas: [] },
];

const MODELS: AgentModelsResult = {
  provider: THINKER.id,
  profileSet: FIXTURE_NATIVE.id,
  catalog: {
    provider: THINKER.id,
    cwd: "/fixture",
    observedAt: "2026-10-31T09:00:00.000Z",
    source: { kind: "native-protocol", freshness: "live" },
    completeness: "complete",
    customModels: false,
    models: [
      {
        id: "deep",
        label: "Deep",
        controls: [
          {
            id: "effort",
            label: "Effort",
            role: "effort",
            values: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          },
        ],
      },
    ],
  },
  refreshing: false,
};

function sparkOf(params: Parameters<NewSparkPort["hatch"]>[0]): SparkSummary {
  return {
    id: `sp-${params.name.toLowerCase()}`,
    name: params.name,
    face: { seed: params.face.seed },
    agent: params.agent,
    profiles: [...params.profiles],
    thinksUnder: params.thinksUnder,
    folder: `/fixture/sparks/${params.name.toLowerCase()}`,
    createdAt: "2026-10-31T09:00:00.000Z",
    updatedAt: "2026-10-31T09:00:00.000Z",
  };
}

function portOf(sets: readonly AgentProfileSet[] = [FIXTURE_NATIVE]) {
  return {
    providers: vi.fn(async () => PROVIDERS),
    profileSets: vi.fn(async () => sets),
    models: vi.fn(async () => MODELS),
    hatch: vi.fn(async (params: Parameters<NewSparkPort["hatch"]>[0]) => sparkOf(params)),
  } satisfies NewSparkPort;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const row of document.querySelectorAll(".vf-chat-row")) row.remove();
  vi.restoreAllMocks();
});

const settle = (ms = 0) => act(async () => new Promise((done) => setTimeout(done, ms)));

async function open(port: NewSparkPort, onClose = vi.fn()): Promise<typeof onClose> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(<NewSparkSheet open port={port} onClose={onClose} container={host} />),
  );
  await settle();
  return onClose;
}

const $ = <T extends Element = HTMLElement>(selector: string): T | null =>
  host?.querySelector<T>(selector) ?? null;
const named = (name: string): HTMLElement | null =>
  [...(host?.querySelectorAll<HTMLElement>("button, [role=menuitem]") ?? [])].find(
    (element) =>
      element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  ) ?? null;
const pill = (): string => $(".vf-new-spark-agent")?.textContent ?? "";
const press = (element: Element | null) =>
  act(async () => (element as HTMLElement | null)?.click());

describe("the New spark sheet", () => {
  it("opens holding a suggested star name, selected, with the agent that can be a spark on its pill", async () => {
    const port = portOf();
    await open(port);
    const name = $<HTMLInputElement>(".vf-new-spark-name");
    expect(name?.value).toBe("Polaris");
    expect(document.activeElement).toBe(name);
    expect([name?.selectionStart, name?.selectionEnd]).toEqual([0, "Polaris".length]);
    expect(pill()).toContain(THINKER.label);
    expect(named("Create Polaris")).not.toBeNull();
    // one profile, This Mac: no profiles row
    expect($(".vf-new-spark-profiles")).toBeNull();
    expect(port.providers).toHaveBeenCalledTimes(1);
  });

  it("deals another face with ↻ and keeps the name; Create sends the face it shows", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const port = portOf();
    await open(port);
    random.mockReturnValue(0.5);
    await press(named("Another face"));
    expect($<HTMLInputElement>(".vf-new-spark-name")?.value).toBe("Polaris");
    await press(named("Create Polaris"));
    expect(port.hatch).toHaveBeenCalledWith(
      expect.objectContaining({ face: { seed: Math.floor(0.5 * 0x1_0000_0000) >>> 0 } }),
    );
  });

  it("reads its agent's picker when the menu first opens, and says a chosen model and its effort on the pill", async () => {
    const port = portOf();
    await open(port);
    await press($(".vf-new-spark-agent"));
    expect($('[role="menu"]')).not.toBeNull();
    await settle();
    expect(port.models).toHaveBeenCalledTimes(1);
    expect(port.models).toHaveBeenCalledWith(THINKER.id, FIXTURE_NATIVE.id);
    // the agent that cannot be a spark is listed, disabled, with why
    expect($('[role="menuitem"][aria-disabled="true"]')?.textContent).toContain(OTHER.label);
    expect(named("Its own model")?.getAttribute("aria-checked")).toBe("true");
    await press(named("Deep"));
    expect(pill()).toContain(`${THINKER.label} · Deep`);
    await press(named("High"));
    expect(pill()).toContain(`${THINKER.label} · Deep · High`);
    // closed and opened again, the picker is not read again
    await press($(".vf-new-spark-agent"));
    await press($(".vf-new-spark-agent"));
    expect(port.models).toHaveBeenCalledTimes(1);
  });

  it("hatches what it asked, flies the face to its row in Chat, and folds", async () => {
    const port = portOf();
    const row = document.createElement("div");
    row.className = "vf-chat-row";
    row.dataset.spark = "sp-polaris";
    row.innerHTML = '<span class="vf-spark-face"></span>';
    document.body.appendChild(row);
    const onClose = await open(port);
    await press(named("Create Polaris"));
    await settle();
    expect(port.hatch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Polaris",
        agent: THINKER.id,
        profiles: [FIXTURE_NATIVE.id],
        thinksUnder: FIXTURE_NATIVE.id,
      }),
    );
    expect(port.hatch.mock.calls[0]?.[0]).not.toHaveProperty("modelSelection");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says a refusal where the sheet asked, stays open, and lets the name be changed", async () => {
    const port = portOf();
    port.hatch.mockRejectedValueOnce(
      Object.assign(new Error("name taken"), { details: { reason: "name-taken" } }),
    );
    const onClose = await open(port);
    await press(named("Create Polaris"));
    await settle();
    const said = $('[role="alert"]');
    expect(said?.textContent).toBe("Polaris is taken");
    // under the name, before the agent pill
    expect(said?.previousElementSibling?.classList.contains("vf-new-spark-namerow")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("folds the menu on Esc first, then the sheet", async () => {
    const port = portOf();
    const onClose = await open(port);
    await press($(".vf-new-spark-agent"));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect($('[role="menu"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows its profiles once there is more than This Mac: the one it thinks under locked, the rest to check", async () => {
    const port = portOf([FIXTURE_NATIVE, FIXTURE_WORK]);
    await open(port);
    const chip = (label: string) =>
      [...(host?.querySelectorAll<HTMLElement>(".vf-new-spark-chip") ?? [])].find((element) =>
        element.textContent?.includes(label),
      ) ?? null;
    expect(chip(FIXTURE_NATIVE.label)?.getAttribute("aria-pressed")).toBe("true");
    expect(chip(FIXTURE_NATIVE.label)?.getAttribute("aria-disabled")).toBe("true");
    expect(chip(FIXTURE_WORK.label)?.getAttribute("aria-pressed")).toBe("false");
    // no field board read here: it says only what it starts
    expect($(".vf-new-spark-reach")?.textContent).toMatch(/^Starts /u);
    await press(chip(FIXTURE_NATIVE.label));
    expect(chip(FIXTURE_NATIVE.label)?.getAttribute("aria-pressed")).toBe("true");
    await press(chip(FIXTURE_WORK.label));
    await press(named("Create Polaris"));
    expect(port.hatch).toHaveBeenCalledWith(
      expect.objectContaining({ profiles: [FIXTURE_NATIVE.id, FIXTURE_WORK.id] }),
    );
  });

  it("stays for its leave when it folds, then goes; opened again, it is a sheet of its own", async () => {
    const port = portOf();
    const onClose = vi.fn();
    await open(port, onClose);
    await act(async () => {
      const name = $<HTMLInputElement>(".vf-new-spark-name");
      if (name === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Vega");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect($<HTMLInputElement>(".vf-new-spark-name")?.value).toBe("Vega");
    await act(async () =>
      root?.render(<NewSparkSheet open={false} port={port} onClose={onClose} container={host} />),
    );
    expect($(".vf-new-spark")?.getAttribute("data-open")).toBe("false");
    await settle(300);
    expect($(".vf-new-spark")).toBeNull();
    await act(async () =>
      root?.render(<NewSparkSheet open port={port} onClose={onClose} container={host} />),
    );
    await settle();
    expect($<HTMLInputElement>(".vf-new-spark-name")?.value).toBe("Polaris");
  });
});
