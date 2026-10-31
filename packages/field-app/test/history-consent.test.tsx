// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WizardShellView, type WizardSize } from "../src/boot/onboarding/wizard-ui";
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

/** Every kind the catalog brings history in for, with its agent (nine today). */
const HISTORY_KINDS = (
  CATALOG as {
    catalog: {
      id: string;
      offers: { history?: boolean };
      seams: { rosetta: { kind: string } | null };
    }[];
  }
).catalog.flatMap((row) =>
  row.offers.history === true && row.seams.rosetta !== null
    ? [[row.seams.rosetta.kind, row.id] as const]
    : [],
);

const HISTORY_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/setup/history-consent.css"),
  "utf8",
);

/** The glass's rule for a list that can outgrow its pane's body (DESIGN.md §4
 * `--vf-scroll-fade`, the face deck's): it scrolls within itself, edge-faded,
 * with no scrollbar, and gives back the 4 that keep a focus ring in its clip. */
const scrollsWithin = (list: string): string =>
  [
    `.vf-wizard-shell[data-size="glass"] ${list} {`,
    "  min-height: 0;",
    "  margin: -4px -4px 0;",
    "  padding: 4px 4px var(--vf-scroll-fade);",
    "  overflow-y: auto;",
    "  scroll-padding-bottom: var(--vf-scroll-fade);",
    "  mask-image: linear-gradient(to bottom, black calc(100% - var(--vf-scroll-fade)), transparent);",
    "  scrollbar-width: none;",
    "}",
    "",
    `.vf-wizard-shell[data-size="glass"] ${list}::-webkit-scrollbar {`,
    "  display: none;",
    "}",
  ].join("\n");

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
async function unmount(): Promise<void> {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
}
afterEach(unmount);

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

/** The pane alone, or in a shell of `frame`'s size: the glass, as the wizard
 * stands it, or Finish setting up's sheet. */
async function mountPane(
  client: FielddClient,
  onDone = vi.fn(),
  frame?: WizardSize,
): Promise<typeof onDone> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // The pane says "last used" against the suite's NOW, as the census's fixtures
  // are, never the wall clock: "today" was true on 2026-10-27 alone (item 84).
  const pane = createElement(HistoryWizardPane, { onDone, now: NOW });
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client },
        frame === undefined
          ? pane
          : createElement(WizardShellView, {
              dark: false,
              onToggleTheme: () => undefined,
              size: frame,
              children: pane,
            }),
      ),
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
    // AO-6b — an agent the pane asked about is never offered again as new
    for (const agent of ["claude", "codex"]) {
      expect(client.request).toHaveBeenCalledWith("setup.moment", {
        moment: `agent-past:${agent}`,
        state: "retired",
      });
    }
    expect(onDone).toHaveBeenCalledWith("answered");
  });

  it("turns into Continue without history with every switch off — a no is an answer", async () => {
    const client = fieldd();
    const onDone = await mountPane(client);
    for (const toggle of switches()) await act(async () => toggle.click());
    expect(container?.textContent).not.toContain("About a minute");
    await act(async () => button("Continue without history").click());
    expect(client.request).toHaveBeenCalledWith("index.enroll", { kinds: [] });
    // asked, whatever its switch said (AO-6b)
    expect(client.request).toHaveBeenCalledWith("setup.moment", {
      moment: "agent-past:codex",
      state: "retired",
    });
    expect(onDone).toHaveBeenCalledWith("answered");
  });

  it("puts it off with Not now: nothing read, the step later, its home named", async () => {
    const client = fieldd();
    const onDone = await mountPane(client);
    // its home is the pane's later line, under the actions (FG-L3)
    expect(container?.querySelector(".vf-wizard-later")?.textContent).toBe(
      "Bring it in anytime from History.",
    );
    await act(async () => button("Not now").click());
    expect(client.request).not.toHaveBeenCalledWith("index.enroll", expect.anything());
    expect(client.request).not.toHaveBeenCalledWith("setup.moment", expect.anything());
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

  it("scrolls its rows within themselves on the glass alone, the two sentences standing under them (FG-L3)", async () => {
    // every agent that brings history in has some: nine rows today; from six, with a switch on, they
    // are 354 in a body of 322 by the CSS's own numbers (happy-dom lays nothing out; the pixels are
    // FG-4b's console rows)
    const every = {
      discoveries: HISTORY_KINDS.map(([kind, agent]) => discovery(kind, agent, 1_000_000_000)),
    };
    const glassRows = '.vf-wizard-shell[data-size="glass"] .vf-history-consent-rows';
    await mountPane(fieldd(every), vi.fn(), "glass");
    const rows = container?.querySelector(".vf-history-consent-rows");
    expect(rows?.querySelectorAll(".vf-history-consent-row")).toHaveLength(HISTORY_KINDS.length);
    expect(rows?.matches(glassRows)).toBe(true);
    expect(HISTORY_CSS).toContain(scrollsWithin(".vf-history-consent-rows"));
    // the rows scroll; the sentences stand under them, outside the scroll, and Bring in history on the foot
    const body = container?.querySelector(".vf-wizard-pane-body");
    expect(Array.from(body?.children ?? [], (part) => part.className)).toEqual([
      "vf-history-consent-rows",
      "vf-history-consent-summary",
    ]);
    expect(
      container?.querySelector('.vf-wizard-pane-foot button[type="submit"]')?.textContent,
    ).toBe("Bring in history");
    // only the glass bounds them: Finish setting up's sheet keeps them whole, and so does every host
    // without the glass (History's room, Settings → History)
    for (const frame of ["sheet", undefined] as const) {
      await unmount();
      await mountPane(fieldd(every), vi.fn(), frame);
      expect(container?.querySelector(".vf-history-consent-rows")?.matches(glassRows)).toBe(false);
    }
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
