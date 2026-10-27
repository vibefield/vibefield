// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryConsent } from "../src/history/HistoryConsent";
import { type FieldHost, setHost } from "../src/host";
import { enrollmentFor } from "../src/setup/consent-act";
import { lastUsedWords } from "../src/setup/HistoryConsentView";
import { HistoryWizardPane } from "../src/setup/HistoryWizardPane";
import { firstReadingSentence, historyAgentRows } from "../src/setup/history-consent";

// AO-3 (track AO; AO-D3, AO-L5) — History's consent, one question for every door
// that asks it: the agents with history on this Mac, every switch on at first,
// nothing read before the button, one `index.enroll` with the COMPLETE set (so
// nothing already brought in is revoked by omission), and the ledger's answer.

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

const NOW = new Date("2026-10-27T12:00:00").getTime();
const DAY = 86_400_000;

/** The catalog as `agent.catalog` answers it: the contracts' own fixture (every
 * row but acp offers history). */
const CATALOG = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../contracts/fixtures/agent-catalog.valid.json",
    ),
    "utf8",
  ),
) as unknown;

const discovery = (
  kind: string,
  agent: string | undefined,
  bytes: number,
  extra: Partial<{ files: number; consented: boolean; newestModifiedMs: number }> = {},
) => ({
  kind,
  ...(agent === undefined ? {} : { agent }),
  dataRoot: `~/.${kind}`,
  installed: true,
  files: extra.files ?? 40,
  bytes,
  newestModifiedMs: extra.newestModifiedMs ?? NOW,
  consented: extra.consented ?? false,
});

const DISCOVERIES = {
  discoveries: [
    discovery("codex", "codex", 1_100_000_000, { newestModifiedMs: NOW - DAY }),
    discovery("claude-code", "claude", 6_200_000_000),
    discovery("grok", "grok", 240_000_000, { files: 0 }),
    discovery("acp", "acp", 50_000_000),
    discovery("mystery", undefined, 9_000),
  ],
};

describe("History's census, as the pane lists it", () => {
  it("lists the agents with history on this Mac that offer it, in the catalog's order", () => {
    const labels = new Map([
      ["claude", "Claude Code"],
      ["codex", "Codex"],
      ["grok", "Grok"],
    ]);
    const rows = historyAgentRows(DISCOVERIES.discoveries, labels);
    // grok has no files, acp is not in this map, mystery maps to no row
    expect(rows.map((row) => [row.kind, row.label])).toEqual([
      ["claude-code", "Claude Code"],
      ["codex", "Codex"],
    ]);
    expect(rows[0]).toMatchObject({
      agent: "claude",
      root: "~/.claude-code",
      bytes: 6_200_000_000,
    });
  });

  it("sends the complete set: the brought-in kinds it does not list, plus every switch left on", () => {
    expect(
      enrollmentFor({
        consented: ["opencode", "codex"],
        listed: ["claude-code", "codex"],
        chosen: new Set(["claude-code"]),
      }),
    ).toEqual(["claude-code", "opencode"]);
    expect(enrollmentFor({ consented: [], listed: ["codex"], chosen: new Set() })).toEqual([]);
  });

  it("says the first reading's time a quiet Mac takes, never a countdown", () => {
    expect(firstReadingSentence(13_300_000_000)).toBe(
      "About a minute on a quiet Mac, one time only. History fills in while you work.",
    );
    expect(firstReadingSentence(41_100_000_000)).toBe(
      "About 4 minutes on a quiet Mac, longer while it is busy. History fills in while you work.",
    );
  });

  it("says when an agent was last used as a person says it", () => {
    expect(lastUsedWords(NOW - 60_000, NOW)).toBe("today");
    expect(lastUsedWords(NOW - DAY, NOW)).toBe("yesterday");
    expect(lastUsedWords(NOW - 4 * DAY, NOW)).toBe("this week");
    expect(lastUsedWords(new Date("2026-08-14").getTime(), NOW)).toBe("in August");
    expect(lastUsedWords(new Date("2025-03-01").getTime(), NOW)).toBe("in 2025");
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeEach(() => {
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
});

function fieldd(discoveries: unknown = DISCOVERIES): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async () => {
      throw new Error("no subscriptions here");
    }),
    request: vi.fn(async (method: string) => {
      if (method === "agent.catalog") return CATALOG;
      if (method === "index.discoveries") return discoveries;
      return { ok: true };
    }),
  } as unknown as FielddClient;
}

/** Let the census's two reads land and the pane draw them. */
async function answered(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountPane(client: FielddClient, onDone = vi.fn()): Promise<typeof onDone> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(FielddProvider, { client }, createElement(HistoryWizardPane, { onDone })),
    );
  });
  // the census answers
  await answered();
  return onDone;
}

const button = (label: string): HTMLButtonElement => {
  const found = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button "${label}" in ${container?.textContent}`);
  return found;
};
const switches = (): HTMLButtonElement[] =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? []);

describe("the History pane (AO-3)", () => {
  it("opens with every switch on, says the time and where it stays, and brings the complete set in", async () => {
    const client = fieldd();
    const onDone = await mountPane(client);
    expect(container?.textContent).toContain("Bring in your past sessions.");
    expect(
      switches().map((s) => [s.getAttribute("aria-label"), s.getAttribute("aria-checked")]),
    ).toEqual([
      ["Bring in Claude Code's history", "true"],
      ["Bring in Codex's history", "true"],
    ]);
    expect(container?.textContent).toContain("6.2 GB · last used today");
    expect(container?.textContent).toContain("1.1 GB · last used yesterday");
    expect(container?.textContent).toContain("About a minute on a quiet Mac");
    expect(container?.textContent).toContain("VibeField reads it here and never uploads it.");
    // nothing is read before the button
    expect(client.request).not.toHaveBeenCalledWith("index.enroll", expect.anything());

    await act(async () => button("Bring in history").click());
    expect(client.request).toHaveBeenCalledWith("index.enroll", {
      kinds: ["claude-code", "codex"],
    });
    expect(client.request).toHaveBeenCalledWith("setup.answer", {
      step: "history",
      state: "answered",
    });
    expect(onDone).toHaveBeenCalledWith("answered");
  });

  it("turns into Continue without history with every switch off — a no is an answer", async () => {
    const client = fieldd();
    const onDone = await mountPane(client);
    for (const toggle of switches()) await act(async () => toggle.click());
    expect(container?.textContent).not.toContain("About a minute");
    await act(async () => button("Continue without history").click());
    expect(client.request).toHaveBeenCalledWith("index.enroll", { kinds: [] });
    expect(onDone).toHaveBeenCalledWith("answered");
  });

  it("puts it off with Not now: nothing read, the step later, its home named", async () => {
    const client = fieldd();
    const onDone = await mountPane(client);
    expect(container?.textContent).toContain("Bring it in anytime from History.");
    await act(async () => button("Not now").click());
    expect(client.request).not.toHaveBeenCalledWith("index.enroll", expect.anything());
    expect(client.request).toHaveBeenCalledWith("setup.answer", {
      step: "history",
      state: "later",
    });
    expect(onDone).toHaveBeenCalledWith("later");
  });

  it("moves on by itself when there is nothing to decide (AO-L2)", async () => {
    const onDone = await mountPane(
      fieldd({ discoveries: [discovery("codex", "codex", 1_000, { consented: true })] }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("skipped");
  });
});

describe("History's consent slot (AO-3, AO-D9)", () => {
  it("is the History pane in the room's place, with no Not now and nothing read before its button", async () => {
    const client = fieldd();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FielddProvider, { client }, createElement(HistoryConsent)));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.querySelector("h2")?.textContent).toBe("Bring in your past sessions.");
    expect(container?.textContent).not.toContain("Settings → Agents");
    expect(
      Array.from(container?.querySelectorAll("button") ?? []).map((b) => b.textContent),
    ).not.toContain("Not now");
    for (const toggle of switches()) await act(async () => toggle.click());
    expect(button("Bring in history").disabled).toBe(true);
  });
});
