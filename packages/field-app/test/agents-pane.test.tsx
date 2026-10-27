// @vitest-environment happy-dom

import { AGENT_CATALOG, type AgentCatalogEntryWire } from "@vibefield/contracts/agent-catalog";
import type { AgentInstall } from "@vibefield/contracts/agent-index";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import { AgentsWizardPane } from "../src/setup/AgentsWizardPane";
import { agentsPaneModel, howItUpdates, installFact } from "../src/setup/agents-pane";

// AO-5 (track AO; AO-D1, AO-D13; DESIGN.md §8 "The Setup Assistant's agent
// chapter" — Agents) — the chapter's first pane: the agents on this Mac as
// ready, the supported ones it lacks, the preview ones behind More agents, and
// the ledger's answer. Every agent here is read from the catalog's own table,
// so a status flip there moves these rows with it.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noopLogger: FieldHost["logger"] = {
  child: () => noopLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

const CATALOG: readonly AgentCatalogEntryWire[] = AGENT_CATALOG;
const SUPPORTED = CATALOG.filter((row) => row.status === "supported");
const PREVIEW_TO_GET = CATALOG.filter(
  (row) => row.status === "preview" && row.offers.distribution === true && row.surfaces.desktop,
);
/** a preview row VibeField does not install (a protocol, today) */
const NOT_INSTALLABLE = CATALOG.filter((row) => row.offers.distribution !== true);
const FIRST = SUPPORTED[0];
const SECOND = SUPPORTED[1];
const A_PREVIEW = PREVIEW_TO_GET[0];
if (FIRST === undefined || SECOND === undefined || A_PREVIEW === undefined) {
  throw new Error("the catalog no longer has two supported agents and a preview one to get");
}

function install(provider: string, patch: Partial<AgentInstall> = {}): AgentInstall {
  return {
    provider,
    executable: `/usr/local/bin/${provider}`,
    realPath: `/usr/local/bin/${provider}`,
    version: "1.0.0",
    method: "native-installer",
    autoUpdate: "enabled",
    active: true,
    ...patch,
  };
}

describe("the Agents pane's model", () => {
  it("lists the agents on this Mac first, then the supported ones it lacks, in the catalog's order", () => {
    const model = agentsPaneModel(CATALOG, [
      install(A_PREVIEW.id, { version: "0.9.1" }),
      install(FIRST.id, { version: "2.1.270" }),
    ]);
    expect(model.first).toBe(false);
    const order = CATALOG.map((row) => row.id);
    const ready = model.rows.filter((row) => row.state === "ready");
    expect(ready.map((row) => row.provider)).toEqual(
      [FIRST.id, A_PREVIEW.id].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    );
    expect(ready.find((row) => row.provider === FIRST.id)).toEqual({
      provider: FIRST.id,
      label: FIRST.label,
      state: "ready",
      fact: "2.1.270 · updates itself",
    });
    // the supported agent this Mac lacks follows the ready ones
    expect(model.rows.at(-1)).toEqual({
      provider: SECOND.id,
      label: SECOND.label,
      state: "missing",
    });
    // More agents: the preview ones VibeField installs, not this Mac's one
    expect(model.more.map((row) => row.provider)).toEqual(
      PREVIEW_TO_GET.filter((row) => row.id !== A_PREVIEW.id).map((row) => row.id),
    );
  });

  it("never offers an agent it does not install, and draws no install the catalog does not list", () => {
    const model = agentsPaneModel(CATALOG, [install("not-in-the-catalog")]);
    const listed = [...model.rows, ...model.more].map((row) => row.provider);
    for (const row of NOT_INSTALLABLE) expect(listed).not.toContain(row.id);
    expect(listed).not.toContain("not-in-the-catalog");
    expect(model.first).toBe(true);
  });

  it("asks for a first agent with nothing installed, the supported ones first", () => {
    const model = agentsPaneModel(CATALOG, []);
    expect(model.first).toBe(true);
    expect(model.rows.map((row) => row.provider)).toEqual(SUPPORTED.map((row) => row.id));
    expect(model.rows.every((row) => row.state === "missing")).toBe(true);
  });

  it("reads the active install of an agent with two", () => {
    const model = agentsPaneModel(CATALOG, [
      install(FIRST.id, { version: "2.0.0", active: false }),
      install(FIRST.id, { version: "2.1.270", active: true }),
    ]);
    expect(model.rows[0]?.fact).toBe("2.1.270 · updates itself");
  });

  it("lists an installed agent whose status is one this build never heard of nowhere", () => {
    const odd = CATALOG.map((row) => (row.id === FIRST.id ? { ...row, status: "retired" } : row));
    const model = agentsPaneModel(odd, [install(FIRST.id)]);
    expect([...model.rows, ...model.more].map((row) => row.provider)).not.toContain(FIRST.id);
  });

  it("says how an agent stays current in a person's words", () => {
    expect(howItUpdates(install(FIRST.id))).toBe("updates itself");
    expect(
      howItUpdates(install(FIRST.id, { autoUpdate: "disabled", update: { kind: "npm-global" } })),
    ).toBe("npm");
    expect(howItUpdates(install(FIRST.id, { autoUpdate: "unknown", method: "brew" }))).toBe(
      "Homebrew",
    );
    expect(
      howItUpdates(install(FIRST.id, { autoUpdate: "unknown", update: { kind: "manual" } })),
    ).toBeUndefined();
    // no version read and no recipe known: no fact at all, never a blank
    const bare: AgentInstall = {
      provider: FIRST.id,
      executable: "/usr/local/bin/agent",
      realPath: "/usr/local/bin/agent",
      method: "unknown",
      autoUpdate: "unknown",
      active: true,
    };
    expect(installFact(bare)).toBeUndefined();
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

/** A daemon whose inventory answers `installs` (null: it refuses, as one that
 * is still starting does). */
function daemon(installs: readonly AgentInstall[] | null): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(async (method: string) => {
      if (installs === null) throw new Error("UNAVAILABLE: agents are starting");
      if (method === "agent.catalog") return { catalog: CATALOG };
      if (method === "agents.installs") return { installs };
      return { ok: true };
    }),
  } as unknown as FielddClient;
}

async function mount(client: FielddClient, onDone: (end: string) => void): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(FielddProvider, { client }, createElement(AgentsWizardPane, { onDone })),
    );
  });
  await flush();
}

/** Let the doors' answers land (each is a few promise hops away). */
async function flush(): Promise<void> {
  await act(async () => {
    for (let hop = 0; hop < 6; hop += 1) await Promise.resolve();
  });
}

const text = (): string => container?.textContent ?? "";
const heading = (): string => container?.querySelector("h1")?.textContent ?? "";
async function click(label: string): Promise<void> {
  const found = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}" in: ${text()}`);
  await act(async () => found.click());
}

describe("the Agents pane on the wizard's glass", () => {
  it("shows this Mac's agents as ready and records the step answered on Continue", async () => {
    const client = daemon([install(FIRST.id, { version: "2.1.270" })]);
    const onDone = vi.fn();
    await mount(client, onDone);
    expect(heading()).toBe("Your agents are ready.");
    const ready = container?.querySelector('.vf-agents-pane-row[data-state="ready"]');
    expect(ready?.textContent).toContain(FIRST.label);
    expect(ready?.textContent).toContain("2.1.270 · updates itself");
    expect(ready?.textContent).toContain("Ready");
    const missing = container?.querySelector('.vf-agents-pane-row[data-state="missing"]');
    expect(missing?.textContent).toContain(SECOND.label);
    expect(missing?.textContent).toContain("Not on this Mac");
    await click("Continue");
    expect(client.request).toHaveBeenCalledWith("setup.answer", {
      step: "agents",
      state: "answered",
    });
    expect(onDone).toHaveBeenCalledWith("answered");
  });

  it("keeps the preview agents behind More agents until asked", async () => {
    await mount(daemon([install(FIRST.id)]), vi.fn());
    const more = container?.querySelector<HTMLButtonElement>(".vf-agents-pane-more");
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    expect(text()).not.toContain(A_PREVIEW.label);
    await act(async () => more?.click());
    expect(more?.getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain(A_PREVIEW.label);
  });

  it("asks for a first agent on a Mac with none, and records the step put off", async () => {
    const client = daemon([]);
    const onDone = vi.fn();
    await mount(client, onDone);
    expect(heading()).toBe("Add your first agent.");
    expect(text()).toContain("Install one, and it appears here.");
    expect(text()).toContain("Add agents anytime in Settings → Agents.");
    await click("Look again");
    expect(client.request).toHaveBeenCalledWith("agents.installs", { refresh: true });
    await flush();
    await click("Continue");
    expect(client.request).toHaveBeenCalledWith("setup.answer", { step: "agents", state: "later" });
    expect(onDone).toHaveBeenCalledWith("later");
  });

  it("claims nothing while the inventory is unread, and records nothing when moved past", async () => {
    const client = daemon(null);
    const onDone = vi.fn();
    await mount(client, onDone);
    expect(heading()).toBe("Your agents.");
    expect(text()).toContain("Looking for your agents…");
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(text()).toContain("VibeField couldn't read the agents on this Mac right now.");
    await click("Continue");
    expect(client.request).not.toHaveBeenCalledWith("setup.answer", expect.anything());
    expect(onDone).toHaveBeenCalledWith("skipped");
  });
});
