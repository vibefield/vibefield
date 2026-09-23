// @vitest-environment happy-dom
/**
 * The Agents settings section (the design record's R1, pass 16) against a
 * fake FielddClient: the shelf opens on the check the machine record kept and
 * never checks on its own (AR-D22); Check for updates is the one network act;
 * Update runs through `agents.update` and settles once the version is read
 * back; an agent's page names itself in the Settings header and acts through
 * the doors. The model joins the doors' answers without inventing anything.
 */
import type {
  AgentInstall,
  AgentOperation,
  AgentProviderSummary,
  AgentsReleasesResult,
} from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsSection } from "../src/panels/agents/AgentsSection";
import {
  agentShelf,
  commandWords,
  receiptNotice,
  shelfCheckedLine,
} from "../src/panels/agents/agents-model";
import { SettingsDialog, type SettingsSubpage } from "../src/panels/SettingsDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── fixtures: the doors' answers ──

const CHECKED = new Date(2026, 8, 22, 9, 41, 20).toISOString();
const LATER = new Date(2026, 8, 22, 9, 50, 2).toISOString();
const NOW = new Date(2026, 8, 22, 9, 45, 0);

const PROVIDERS: AgentProviderSummary[] = [
  { id: "claude", label: "Claude Code", available: true, resumable: true, personas: [] },
  { id: "codex", label: "Codex", available: true, resumable: true, personas: [] },
  // composed, not installed: never on the shelf
  { id: "kimi", label: "Kimi", available: false, resumable: false, personas: [] },
];

function install(
  over: Partial<AgentInstall> & Pick<AgentInstall, "provider" | "executable">,
): AgentInstall {
  return {
    realPath: over.executable,
    version: "1.0.0",
    method: "native-installer",
    autoUpdate: "enabled",
    active: true,
    ...over,
  };
}

const CLAUDE = install({
  provider: "claude",
  executable: "/Users/me/.local/bin/claude",
  version: "2.2.0",
  releaseChannel: "stable",
  update: { kind: "native-self-update", command: ["/Users/me/.local/bin/claude", "update"] },
});
const CLAUDE_NPM = install({
  provider: "claude",
  executable: "/opt/homebrew/bin/claude",
  version: "2.1.221",
  method: "npm-global",
  autoUpdate: "disabled",
  active: false,
  update: { kind: "npm-global", command: ["/opt/homebrew/bin/npm", "install", "-g", "cc@latest"] },
});
const CODEX = install({
  provider: "codex",
  executable: "/opt/homebrew/bin/codex",
  version: "0.153.4",
  method: "npm-global",
  update: {
    kind: "npm-global",
    command: ["/opt/homebrew/bin/npm", "install", "-g", "codex@latest"],
  },
});

function release(
  provider: string,
  version: string,
  url = `https://example.com/${provider}/${version}`,
) {
  return {
    provider,
    channel: "stable",
    version,
    url,
    fetchedAt: CHECKED,
    source: { kind: "text", id: `${provider}-stable` },
  };
}

const KEPT: AgentsReleasesResult = {
  releases: [release("claude", "2.3.0"), release("codex", "0.153.4")],
  available: [{ provider: "claude", channel: "stable", version: "2.3.0" }],
  checked: [
    { provider: "claude", at: CHECKED },
    { provider: "codex", at: CHECKED },
  ],
};

function operation(over: Partial<AgentOperation> = {}): AgentOperation {
  return {
    provider: "claude",
    kind: "update",
    state: "running",
    startedAt: CHECKED,
    output: "Checking for updates…\nDownloading 2.3.0\n",
    truncated: false,
    ...over,
  };
}

const FINISHED = operation({
  state: "finished",
  finishedAt: LATER,
  receipt: {
    provider: "claude",
    status: "updated",
    startedAt: CHECKED,
    finishedAt: LATER,
    exitCode: 0,
  },
});

// ── a fake fieldd: named doors, and the operations feed as a push ──

type Door = (params: Record<string, unknown>) => unknown;

interface Fake {
  client: FielddClient;
  calls: (method: string) => unknown[];
  frame: (operations: AgentOperation[]) => Promise<void>;
}

function fake(doors: Record<string, Door>, snapshot: AgentOperation[] = []): Fake {
  let push: ((payload: unknown) => void) | undefined;
  const request = vi.fn(async (method: string, params?: unknown) => {
    const door = doors[method];
    if (door === undefined) throw new Error(`unexpected request: ${method}`);
    return await door((params ?? {}) as Record<string, unknown>);
  });
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    request,
    subscribe: vi.fn(
      async (method: string, _params: unknown, onEvent: (payload: unknown) => void) => {
        if (method !== "agents.operations.subscribe") {
          throw new Error(`unexpected subscription: ${method}`);
        }
        push = onEvent;
        return { subId: "ops", snapshot: { operations: snapshot }, unsubscribe: () => undefined };
      },
    ),
  } as unknown as FielddClient;
  return {
    client,
    calls: (method) =>
      request.mock.calls.filter(([called]) => called === method).map(([, params]) => params),
    frame: async (operations) => {
      await act(async () => push?.({ operations }));
      await settle();
    },
  };
}

function doors(over: Record<string, Door> = {}): Record<string, Door> {
  return {
    "agent.providers": () => ({ providers: PROVIDERS }),
    "agents.installs": () => ({ installs: [CLAUDE, CLAUDE_NPM, CODEX], machineScope: true }),
    "agents.releases": (params) =>
      params.cached === true ? KEPT : { releases: [], available: [], checked: [] },
    ...over,
  };
}

// ── mounting ──

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountSection(
  f: Fake,
): Promise<{ onSubpage: ReturnType<typeof vi.fn>; rootRequest: (n: number) => Promise<void> }> {
  const onSubpage = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const render = async (rootRequest: number): Promise<void> => {
    await act(async () =>
      root?.render(
        createElement(
          FielddProvider,
          { client: f.client },
          createElement(AgentsSection, { platform: "darwin", rootRequest, onSubpage }),
        ),
      ),
    );
    await settle();
  };
  await render(0);
  return { onSubpage, rootRequest: render };
}

const text = (): string => container?.textContent ?? "";

function button(name: string): HTMLButtonElement {
  const buttons = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const found = buttons.find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (found === undefined) {
    throw new Error(
      `no button "${name}" among: ${buttons.map((b) => b.textContent?.trim()).join(" | ")}`,
    );
  }
  return found;
}

const hasButton = (name: string): boolean => {
  try {
    button(name);
    return true;
  } catch {
    return false;
  }
};

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// ── the model ──

describe("agents model — the doors' answers, joined", () => {
  it("puts installed agents on the shelf in puppeteer's order, the active install first, with the offer and its time", () => {
    const shelf = agentShelf({
      providers: PROVIDERS,
      installs: [CODEX, CLAUDE_NPM, CLAUDE],
      releases: KEPT,
      operations: [],
    });
    expect(shelf.map((item) => item.provider)).toEqual(["claude", "codex"]);
    const [claude, codex] = shelf;
    expect(claude?.label).toBe("Claude Code");
    expect(claude?.install.executable).toBe(CLAUDE.executable);
    expect(claude?.others.map((other) => other.executable)).toEqual([CLAUDE_NPM.executable]);
    expect(claude?.available).toEqual({ channel: "stable", version: "2.3.0" });
    expect(claude?.checkedAt).toBe(CHECKED);
    expect(claude?.releaseNotesUrl).toBe("https://example.com/claude/2.3.0");
    expect(codex?.available).toBeUndefined();
    expect(codex?.noFeed).toBe(false);
    expect(codex?.updating).toBe(false);
  });

  it("says why a check learned nothing, or that the agent has no feed, and never links anything but https", () => {
    const shelf = agentShelf({
      providers: PROVIDERS,
      installs: [CLAUDE, CODEX],
      releases: {
        releases: [
          {
            provider: "claude",
            status: "unavailable",
            message: "release endpoint returned 503",
            retryable: true,
          },
        ],
        checked: [
          { provider: "claude", at: CHECKED },
          { provider: "codex", at: CHECKED },
        ],
      },
      operations: [],
    });
    expect(shelf[0]?.checkProblem).toBe("release endpoint returned 503");
    expect(shelf[0]?.noFeed).toBe(false);
    expect(shelf[1]?.checkProblem).toBeUndefined();
    expect(shelf[1]?.noFeed).toBe(true);

    const insecure = agentShelf({
      providers: PROVIDERS,
      installs: [CLAUDE],
      releases: {
        releases: [release("claude", "2.3.0", "http://example.com/notes")],
        checked: [{ provider: "claude", at: CHECKED }],
      },
      operations: [],
    });
    expect(insecure[0]?.releaseNotesUrl).toBeUndefined();
  });

  it("is updating while the feed says so, or while this window's request is in flight", () => {
    const base = { providers: PROVIDERS, installs: [CLAUDE, CODEX], releases: KEPT };
    expect(agentShelf({ ...base, operations: [operation()] })[0]?.updating).toBe(true);
    expect(agentShelf({ ...base, operations: [FINISHED] })[0]?.updating).toBe(false);
    const requested = agentShelf({ ...base, operations: [], requested: new Set(["codex"]) });
    expect(requested.map((item) => item.updating)).toEqual([false, true]);
  });

  it("words the shelf's head, a command and a receipt the way the record does", () => {
    const shelf = (releases: AgentsReleasesResult) =>
      agentShelf({ providers: PROVIDERS, installs: [CLAUDE, CODEX], releases, operations: [] });
    expect(shelfCheckedLine(shelf({ releases: [] }), NOW)).toBe("Not checked yet");
    expect(shelfCheckedLine(shelf(KEPT), NOW)).toBe("Checked 09:41:20 · 1 update");
    expect(shelfCheckedLine(shelf({ ...KEPT, available: [] }), NOW)).toBe(
      "Checked 09:41:20 · everything current",
    );
    expect(
      shelfCheckedLine(
        shelf({
          ...KEPT,
          releases: [
            release("codex", "0.153.4"),
            { provider: "claude", status: "unavailable", message: "offline", retryable: true },
          ],
          available: [],
        }),
        NOW,
      ),
    ).toBe("Checked 09:41:20 · 1 couldn't be checked");

    expect(commandWords(["/Users/me/My Tools/npm", "install", "-g", "x@latest"])).toBe(
      '"/Users/me/My Tools/npm" install -g x@latest',
    );
    const failed = {
      provider: "claude",
      status: "failed" as const,
      startedAt: CHECKED,
      finishedAt: LATER,
      message: "exit code 1.",
    };
    expect(receiptNotice("Claude Code", failed)).toEqual({
      tone: "error",
      text: "Claude Code's update didn't finish: exit code 1. Its page has the updater's output.",
    });
    expect(receiptNotice("Claude Code", { ...failed, status: "updated" }).text).toBe(
      "Claude Code updated.",
    );
  });
});

// ── the controller ──

describe("AgentsSection — the shelf", () => {
  it("opens on the check the machine record kept, and never checks on its own", async () => {
    const f = fake(doors());
    await mountSection(f);
    expect(f.calls("agents.releases")).toEqual([{ cached: true }]);
    expect(text()).toContain("Claude Code");
    expect(text()).toContain("2.2.0 → 2.3.0");
    expect(text()).toContain("Codex");
    expect(text()).toContain("0.153.4 · npm, global");
    expect(text()).toContain("1 update");
    expect(text()).not.toContain("Kimi");
    expect(hasButton("Update Claude Code")).toBe(true);
    expect(hasButton("Update Codex")).toBe(false);
  });

  it("makes Check for updates the one act that reaches the network; its answer replaces the kept one", async () => {
    const f = fake(
      doors({
        "agents.releases": (params) =>
          params.network === true
            ? {
                releases: [release("claude", "2.2.0"), release("codex", "0.153.4")],
                available: [],
                checked: [
                  { provider: "claude", at: LATER },
                  { provider: "codex", at: LATER },
                ],
              }
            : KEPT,
      }),
    );
    await mountSection(f);
    await click(button("Check for updates"));
    expect(f.calls("agents.releases")).toEqual([{ cached: true }, { network: true }]);
    expect(text()).toContain("everything current");
    expect(hasButton("Update Claude Code")).toBe(false);
  });

  it("runs Update through agents.update, says Updating… until the version is read back, then says so once", async () => {
    const answer = deferred<unknown>();
    let updated = false;
    const f = fake(
      doors({
        "agents.update": () => answer.promise,
        "agents.installs": () => ({
          installs: [updated ? { ...CLAUDE, version: "2.3.0" } : CLAUDE, CLAUDE_NPM, CODEX],
          machineScope: true,
        }),
        "agents.releases": () => (updated ? { ...KEPT, available: [] } : KEPT),
      }),
    );
    await mountSection(f);
    expect(f.calls("agents.installs")).toHaveLength(1);

    await click(button("Update Claude Code"));
    expect(f.calls("agents.update")).toEqual([{ provider: "claude" }]);
    expect(button("Updating…").disabled).toBe(true);

    // The feed's frames while this window's own request is in flight never
    // trigger a read of their own: the request reads once, when it settles.
    await f.frame([operation()]);
    await f.frame([FINISHED]);
    expect(f.calls("agents.installs")).toHaveLength(1);

    updated = true;
    await act(async () => answer.resolve({ receipt: FINISHED.receipt }));
    await settle();
    expect(f.calls("agents.installs")).toHaveLength(2);
    expect(text()).toContain("Claude Code updated.");
    expect(text()).toContain("2.3.0 · Native installer");
    expect(hasButton("Updating…")).toBe(false);
    expect(hasButton("Update Claude Code")).toBe(false);
  });

  it("reads again when the feed says an update it did not ask for has finished", async () => {
    const f = fake(doors(), [operation()]);
    await mountSection(f);
    expect(button("Updating…").disabled).toBe(true);
    expect(f.calls("agents.installs")).toHaveLength(1);
    await f.frame([FINISHED]);
    expect(f.calls("agents.installs")).toHaveLength(2);
  });

  it("says a refusal in the section's own words", async () => {
    const f = fake(
      doors({
        "agents.update": () => {
          throw new FielddRpcError("CONFLICT", "an update of claude is already running", true);
        },
      }),
    );
    await mountSection(f);
    await click(button("Update Claude Code"));
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't update Claude Code — an update of claude is already running.",
    );
    expect(hasButton("Update Claude Code")).toBe(true);
  });

  it("shows the empty state when no agent is installed, and looks again when asked", async () => {
    const f = fake(doors({ "agents.installs": () => ({ installs: [], machineScope: true }) }));
    await mountSection(f);
    expect(text()).toContain("No coding agents on this Mac yet");
    await click(button("Look again"));
    expect(f.calls("agents.installs")).toHaveLength(2);
  });

  it("tells a window without agents.manage so, with no retry to press", async () => {
    const refuse = () => {
      throw new FielddRpcError("FORBIDDEN_SCOPE", "scope agents.manage required");
    };
    const f = fake(
      doors({ "agent.providers": refuse, "agents.installs": refuse, "agents.releases": refuse }),
    );
    await mountSection(f);
    expect(text()).toContain("This window can't manage agents");
    expect(hasButton("Try again")).toBe(false);
  });

  it("reads without machine scope, and offers nothing that writes", async () => {
    const f = fake(
      doors({
        "agents.installs": () => ({ installs: [CLAUDE, CLAUDE_NPM, CODEX], machineScope: false }),
      }),
    );
    await mountSection(f);
    expect(text()).toContain("2.2.0 → 2.3.0");
    expect(text()).toContain("can't update them");
    expect(hasButton("Update Claude Code")).toBe(false);
    await click(button("Claude Code"));
    expect(hasButton("Update to 2.3.0")).toBe(false);
  });
});

describe("AgentsSection — an agent's page", () => {
  it("names itself in the header, acts through the doors, and the way back returns focus to its row", async () => {
    const f = fake(doors({ "agents.reveal": () => ({ revealed: true }) }));
    const { onSubpage } = await mountSection(f);
    await click(button("Claude Code"));

    const subpage = onSubpage.mock.calls.at(-1)?.[0] as SettingsSubpage | null;
    expect(subpage).toMatchObject({
      title: "Claude Code",
      description: "Shared by every agent profile",
      backLabel: "Back to Agents",
    });
    expect(document.activeElement?.hasAttribute("data-agents-page-title")).toBe(true);
    expect(hasButton("Update to 2.3.0")).toBe(true);
    expect(text()).toContain("/Users/me/.local/bin/claude update");
    expect(text()).toContain("Other install");

    // the other install is shown, never offered as a choice (the record's every pass)
    expect(text()).toContain("not used, new sessions use the one above");
    expect(hasButton("Use this one")).toBe(false);

    await click(button(`Show in Finder: ${CLAUDE.executable}`));
    await click(button(`Show in Finder: ${CLAUDE_NPM.executable}`));
    expect(f.calls("agents.reveal")).toEqual([
      { provider: "claude", executable: CLAUDE.executable },
      { provider: "claude", executable: CLAUDE_NPM.executable },
    ]);

    await act(async () => subpage?.onBack());
    await settle();
    expect(onSubpage.mock.calls.at(-1)?.[0]).toBeNull();
    expect(document.activeElement?.textContent).toBe("Claude Code");
    expect(document.activeElement?.classList.contains("vf-agents-row-open")).toBe(true);
  });

  it("shows the vendor updater's own output while it runs", async () => {
    const f = fake(doors(), [operation()]);
    await mountSection(f);
    await click(button("Claude Code"));
    expect(text()).toContain("Downloading 2.3.0");
    expect(text()).toContain("Running…");
    expect(button("Updating…").disabled).toBe(true);
  });

  it("returns to the shelf when the Agents nav item is pressed again", async () => {
    const f = fake(doors());
    const { onSubpage, rootRequest } = await mountSection(f);
    await click(button("Claude Code"));
    expect(hasButton("Check for updates")).toBe(false);
    await rootRequest(1);
    expect(hasButton("Check for updates")).toBe(true);
    expect(onSubpage.mock.calls.at(-1)?.[0]).toBeNull();
  });
});

// ── the dialog ──

describe("SettingsDialog — Agents, and a page below it", () => {
  it("puts Agents first under Workspace; a subpage takes the header with its way back", async () => {
    const onBack = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(SettingsDialog, {
          activePage: "agents",
          onSelectPage: () => undefined,
          onClose: () => undefined,
          onUndo: () => undefined,
          onRedo: () => undefined,
          historyBusy: false,
          undoAvailable: false,
          redoAvailable: false,
          subpage: {
            title: "Claude Code",
            description: "Shared by every agent profile",
            backLabel: "Back to Agents",
            onBack,
          },
          children: createElement("p", null, "page"),
        }),
      ),
    );
    const nav = [...(container.querySelectorAll("nav button") ?? [])].map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(nav.indexOf("Agents settings")).toBeGreaterThanOrEqual(0);
    expect(nav.indexOf("Agents settings")).toBe(nav.indexOf("Plugins settings") - 1);
    expect(
      container.querySelector('[aria-label="Agents settings"]')?.getAttribute("aria-current"),
    ).toBe("page");
    expect(container.querySelector("h1")?.textContent).toBe("Claude Code");
    expect(text()).toContain("Shared by every agent profile");
    await click(button("Back to Agents"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
