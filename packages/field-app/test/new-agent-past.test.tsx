// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SetupLedger } from "@vibefield/contracts/setup";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryNewAgentPast, NewAgentPastCard } from "../src/history/NewAgentPast";
import { type FieldHost, setHost } from "../src/host";
import type { HistoryAgentRow } from "../src/setup/history-consent";
import { newAgentWithAPast } from "../src/setup/new-agent-past";
import type { HistoryCensus } from "../src/setup/use-history-census";

// AO-6b (track AO; AO-D15, ruled (a) by James 2026-10-27) — a new agent with a
// past: an agent whose history is on this Mac, that History's own question
// never asked about, is offered once at History's head. Bring it in adds it to
// the complete set read afresh; Not now retires it for good; both are kept in
// the setup ledger's moments, so no window asks again.

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

/** The catalog as `agent.catalog` answers it: the contracts' own fixture. */
const CATALOG = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../contracts/fixtures/agent-catalog.valid.json",
    ),
    "utf8",
  ),
) as unknown;

const row = (
  agent: string,
  kind: string,
  extra: Partial<HistoryAgentRow> = {},
): HistoryAgentRow => ({
  kind,
  agent,
  label: agent,
  root: `~/.${kind}`,
  bytes: 1_100_000_000,
  newestModifiedMs: NOW,
  consented: false,
  ...extra,
});

const found = (rows: HistoryAgentRow[], consented: string[]): HistoryCensus => ({
  kind: "found",
  rows,
  consented,
});

const ledger = (
  history: "answered" | "later" | null,
  moments: Record<string, unknown> = {},
): SetupLedger => ({
  format: 1,
  steps: history === null ? {} : { history: { state: history, at: "2026-10-27T05:41:30.000Z" } },
  hidden: false,
  moments,
});

const RETIRED = { state: "retired", at: "2026-10-27T15:00:00.000Z" };

describe("which agent History's head offers (the rule)", () => {
  const rows = [
    row("claude", "claude-code", { consented: true }),
    row("codex", "codex"),
    row("grok", "grok"),
  ];
  const census = found(rows, ["claude-code"]);

  it("offers the first agent in the census's order not brought in and never asked about", () => {
    expect(newAgentWithAPast(census, ledger("answered"))?.agent).toBe("codex");
  });

  it("skips one whose moment is retired, and one answered in this window", () => {
    const retired = ledger("answered", { "agent-past:codex": RETIRED });
    expect(newAgentWithAPast(census, retired)?.agent).toBe("grok");
    expect(newAgentWithAPast(census, ledger("answered"), new Set(["codex"]))?.agent).toBe("grok");
    expect(
      newAgentWithAPast(census, retired, new Set(["grok"])),
      "every agent is brought in or asked about",
    ).toBeNull();
    // only retired skips it: a moment's other state (TS-4's `asked`) is no answer here
    const asked = ledger("answered", {
      "agent-past:codex": { state: "asked", at: "2026-10-27T15:00:00.000Z" },
    });
    expect(newAgentWithAPast(census, asked)?.agent).toBe("codex");
  });

  it("waits for History's own question: answered, and something brought in", () => {
    // put off, or never asked: Finish setting up lists History instead
    expect(newAgentWithAPast(census, ledger("later"))).toBeNull();
    expect(newAgentWithAPast(census, ledger(null))).toBeNull();
    // nothing brought in: the room shows History's pane itself, every agent listed
    expect(newAgentWithAPast(found(rows, []), ledger("answered"))).toBeNull();
    // nothing known yet
    expect(newAgentWithAPast(census, null)).toBeNull();
    expect(newAgentWithAPast({ kind: "looking" }, ledger("answered"))).toBeNull();
    expect(newAgentWithAPast({ kind: "unavailable" }, ledger("answered"))).toBeNull();
  });

  it("reads a moment from a newer build as never answered, so the row stays", () => {
    const newer = ledger("answered", { "agent-past:codex": { state: "snoozed", at: "x" } });
    expect(newAgentWithAPast(census, newer)?.agent).toBe("codex");
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

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

/** Let the census's reads and the ledger's snapshot land, and the row draw them. */
async function settled(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const button = (label: string): HTMLButtonElement => {
  const hit = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (hit === undefined) throw new Error(`no button "${label}" in ${container?.textContent}`);
  return hit;
};

describe("the row (the shipping face the catalog mounts)", () => {
  it("says the agent, its size and its last use, with Bring it in and Not now", async () => {
    const onBringIn = vi.fn();
    const onNotNow = vi.fn();
    await mount(
      createElement(NewAgentPastCard, {
        row: row("grok", "grok", {
          label: "Grok",
          bytes: 240_000_000,
          newestModifiedMs: new Date("2026-08-14").getTime(),
        }),
        now: NOW,
        onBringIn,
        onNotNow,
      }),
    );
    expect(container?.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Grok has history on this Mac.",
    );
    expect(container?.querySelector(".vf-history-new-agent-words")?.textContent).toBe(
      "Grok has history on this Mac. 240 MB, last used in August.",
    );
    await act(async () => button("Bring it in").click());
    await act(async () => button("Not now").click());
    expect(onBringIn).toHaveBeenCalledTimes(1);
    expect(onNotNow).toHaveBeenCalledTimes(1);
  });
});

const discovery = (kind: string, agent: string, bytes: number, consented: boolean) => ({
  kind,
  agent,
  dataRoot: `~/.${kind}`,
  installed: true,
  files: 40,
  bytes,
  newestModifiedMs: Date.now(),
  consented,
});

/** fieldd as History's head asks it: the catalog, the census (`discoveries`, a
 * later read answering `later` when given — another door changed the set), the
 * ledger's subscription, and every write recorded. */
function fieldd(opts: {
  ledger: SetupLedger;
  later?: unknown;
  refuse?: (method: string) => string | null;
}): FielddClient {
  const discoveries = {
    discoveries: [
      discovery("claude-code", "claude", 6_200_000_000, true),
      discovery("codex", "codex", 1_100_000_000, false),
    ],
  };
  let reads = 0;
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method === "setup.subscribe") {
        return { subId: "setup", snapshot: opts.ledger, unsubscribe: (): void => undefined };
      }
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(async (method: string) => {
      const refusal = opts.refuse?.(method) ?? null;
      if (refusal !== null) throw new Error(refusal);
      if (method === "agent.catalog") return CATALOG;
      if (method === "index.discoveries") {
        reads += 1;
        return reads > 1 && opts.later !== undefined ? opts.later : discoveries;
      }
      return { ok: true };
    }),
  } as unknown as FielddClient;
}

const mountHead = (client: FielddClient) =>
  mount(createElement(FielddProvider, { client }, createElement(HistoryNewAgentPast)));

describe("History's head (the controller)", () => {
  it("offers Codex once History's answered, and Bring it in sends the complete set read afresh", async () => {
    // since the census, Settings → History brought OpenCode in: it stays in
    const later = {
      discoveries: [
        discovery("claude-code", "claude", 6_200_000_000, true),
        discovery("codex", "codex", 1_100_000_000, false),
        discovery("opencode", "opencode", 9_000_000, true),
      ],
    };
    const client = fieldd({ ledger: ledger("answered"), later });
    await mountHead(client);
    await settled();
    expect(container?.querySelector(".vf-history-new-agent-words")?.textContent).toBe(
      "Codex has history on this Mac. 1.1 GB, last used today.",
    );

    await act(async () => button("Bring it in").click());
    await settled();
    expect(client.request).toHaveBeenCalledWith("index.enroll", {
      kinds: ["claude-code", "codex", "opencode"],
    });
    expect(client.request).toHaveBeenCalledWith("setup.moment", {
      moment: "agent-past:codex",
      state: "retired",
    });
    // it leaves at once, before the ledger says so
    expect(container?.querySelector(".vf-history-new-agent")).toBeNull();
  });

  it("retires it with Not now, reads nothing, and leaves even when the write is refused", async () => {
    const client = fieldd({
      ledger: ledger("answered"),
      refuse: (method) => (method === "setup.moment" ? "the ledger is not writable" : null),
    });
    await mountHead(client);
    await settled();
    await act(async () => button("Not now").click());
    await settled();
    expect(client.request).toHaveBeenCalledWith("setup.moment", {
      moment: "agent-past:codex",
      state: "retired",
    });
    expect(client.request).not.toHaveBeenCalledWith("index.enroll", expect.anything());
    expect(container?.querySelector(".vf-history-new-agent")).toBeNull();
  });

  it("stays and says the daemon's words when bringing it in is refused", async () => {
    const client = fieldd({
      ledger: ledger("answered"),
      refuse: (method) =>
        method === "index.enroll" ? "History can't change what it reads now" : null,
    });
    await mountHead(client);
    await settled();
    await act(async () => button("Bring it in").click());
    await settled();
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "History can't change what it reads now",
    );
    expect(button("Bring it in").disabled).toBe(false);
    expect(client.request).not.toHaveBeenCalledWith("setup.moment", expect.anything());
  });

  it("draws nothing for an agent the ledger has retired, or while History's question waits", async () => {
    await mountHead(fieldd({ ledger: ledger("answered", { "agent-past:codex": RETIRED }) }));
    await settled();
    expect(container?.querySelector(".vf-history-new-agent")).toBeNull();
    await act(async () => root?.unmount());
    container?.remove();

    await mountHead(fieldd({ ledger: ledger("later") }));
    await settled();
    expect(container?.querySelector(".vf-history-new-agent")).toBeNull();
  });
});
