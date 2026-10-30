// @vitest-environment happy-dom

import type { SetupLedger } from "@vibefield/contracts";
import { emptySetupLedger } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalWaitRow } from "../src/account/approval-wait";
import { FIXTURE_LIMIT_USAGE } from "../src/design-system/limit-moment-fixtures";
import {
  FIXTURE_NATIVE,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_PROFILES_NOW,
} from "../src/design-system/profiles-fixtures";
import { onShellPresentationRequest } from "../src/field/shell-presentation";
import { ApprovalWaitCard, ApprovalWaitMoment } from "../src/godview/ApprovalWaitMoment";
import { ClaimsStripMoment } from "../src/godview/ClaimsStripMoment";
import {
  type MonitorAccountFacts,
  MonitorAccountFactsContext,
} from "../src/godview/monitor/account-facts";
import { MonitorMomentRowsContext } from "../src/godview/monitor/moment-rows";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { type FieldHost, setHost } from "../src/host";

// TS-4b (TS-D20 ruled A, TS-D20b ruled A, by James 2026-10-29; DESIGN.md §8
// "Asking again") — the line said once as a long approval clears, written
// asked before it shows, and gone at ×, at its act, or at the agent's next
// state change; on the claims strip, one moment at a time, the limit moment
// first.

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

const T0 = Date.UTC(2026, 10, 2, 16, 0, 0);
const MIN = 60_000;

const agent = (overrides: Partial<ApprovalWaitRow> = {}): ApprovalWaitRow => ({
  id: "a1",
  kind: "agent",
  status: "blocked",
  statusSince: T0,
  alive: true,
  wait: { kind: "permission", since: T0 },
  device: { self: true },
  project: { name: "vibe-field" },
  provider: { id: "claude-code", label: "Claude Code" },
  ...overrides,
});
const answered = (at: number, status = "working"): ApprovalWaitRow =>
  agent({ status, statusSince: at, wait: undefined });

const putOff = (): SetupLedger => ({
  ...emptySetupLedger(),
  steps: { devices: { state: "later", at: "2026-10-28T09:00:00.000Z" } },
});

/** fieldd as the strip asks it: the ledger and the preferences by subscription,
 * the inventory by request (the limit moment's), every write recorded. */
function fieldd(opts: { ledger?: SetupLedger; connectAsks?: boolean }) {
  const subscribe = vi.fn(async (method: string) => {
    const snapshot =
      method === "setup.subscribe"
        ? (opts.ledger ?? putOff())
        : method === "storage.appPreferences.subscribe"
          ? { connectAsks: opts.connectAsks ?? true }
          : undefined;
    if (snapshot === undefined) throw new Error(`unexpected subscription: ${method}`);
    return { subId: method, snapshot, unsubscribe: (): void => undefined };
  });
  const request = vi.fn(async (method: string, _params?: unknown) =>
    method === "agents.installs" ? { installs: FIXTURE_PROFILES_CONTEXT.installs } : { ok: true },
  );
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe,
    request,
  } as unknown as FielddClient;
  return { client, request };
}

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
  vi.useRealTimers();
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function settled(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The strip's moment over the rows its host lends, read again at each `show`. */
async function strip(client: FielddClient, offersConnect = true) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const show = async (rows: readonly ApprovalWaitRow[]): Promise<void> => {
    await act(async () =>
      root?.render(
        createElement(
          FielddProvider,
          { client },
          createElement(ApprovalWaitMoment, { rows, offersConnect }),
        ),
      ),
    );
    await settled();
  };
  return show;
}

const row = (): Element | null =>
  container?.querySelector('section.vf-monitor-moment[data-moment="approval-wait"]') ?? null;
const momentWrites = (request: ReturnType<typeof fieldd>["request"]) =>
  request.mock.calls.filter(([method]) => method === "setup.moment").map(([, params]) => params);

describe("the approval line (the controller)", () => {
  it("is said once as a long approval clears, written asked before it shows", async () => {
    const { client, request } = fieldd({});
    const show = await strip(client);
    await show([agent()]);
    expect(row()).toBeNull();
    await show([answered(T0 + 14 * MIN)]);
    expect(row()?.querySelector(".vf-monitor-moment-title")?.textContent).toBe(
      "It waited 14m for you.",
    );
    expect(row()?.querySelector(".vf-monitor-moment-plan > span:last-child")?.textContent).toBe(
      "vibe-field",
    );
    expect(momentWrites(request)).toEqual([
      { moment: "connect-ask:approval-wait", state: "asked" },
    ]);
    // the next state change takes it away, and a second long wait is not said in this window
    const later = T0 + 20 * MIN;
    await show([agent({ statusSince: later, wait: { kind: "permission", since: later } })]);
    expect(row()).toBeNull();
    await show([answered(T0 + 40 * MIN)]);
    expect(row()).toBeNull();
    expect(momentWrites(request)).toHaveLength(1);
  });

  it("says nothing with the switch off, to someone who never put Devices off, or once connected", async () => {
    for (const [opts, offers] of [
      [{ connectAsks: false }, true],
      [{ ledger: emptySetupLedger() }, true],
      [{}, false],
    ] as const) {
      const { client, request } = fieldd(opts);
      const show = await strip(client, offers);
      await show([agent()]);
      await show([answered(T0 + 14 * MIN)]);
      expect(row()).toBeNull();
      expect(momentWrites(request)).toEqual([]);
      await act(async () => root?.unmount());
      root = null;
      container?.remove();
    }
  });

  it("asks for the Connect door with its act, and goes back the way it came at ×", async () => {
    const asked: string[] = [];
    const stop = onShellPresentationRequest((command) => asked.push(command));
    const { client } = fieldd({});
    const show = await strip(client);
    await show([agent()]);
    await show([answered(T0 + 14 * MIN)]);
    const connect = Array.from(row()?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Connect your devices",
    );
    await act(async () => connect?.click());
    expect(asked).toEqual(["open-connect"]);
    expect(row()).toBeNull();
    stop();
    await act(async () => root?.unmount());
    root = null;
    container?.remove();

    const again = fieldd({});
    const showAgain = await strip(again.client);
    await showAgain([agent()]);
    await showAgain([answered(T0 + 14 * MIN)]);
    const dismiss = row()?.querySelector<HTMLButtonElement>('button[aria-label="Not now"]');
    await act(async () => dismiss?.click());
    expect(row()?.hasAttribute("data-leaving")).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(row()).toBeNull();
    expect(momentWrites(again.request)).toHaveLength(1);
  });
});

describe("the strip's one moment, the limit moment first (TS-D20b)", () => {
  const AT_THE_LINE: MonitorAccountFacts = { sets: [FIXTURE_NATIVE], usage: FIXTURE_LIMIT_USAGE };
  const UNDER: MonitorAccountFacts = {
    sets: [FIXTURE_NATIVE],
    usage: FIXTURE_PROFILES_CONTEXT.usage,
  };

  beforeEach(() => {
    // the profiles' fixture reads its windows' resets at its own clock
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXTURE_PROFILES_NOW);
  });

  /** The claims strip as the stage lends it its account facts and its rows. */
  async function claims(client: FielddClient) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    return async (facts: MonitorAccountFacts, rows: readonly ApprovalWaitRow[]): Promise<void> => {
      await act(async () =>
        root?.render(
          createElement(
            FielddProvider,
            { client },
            createElement(
              MonitorAccountFactsContext.Provider,
              { value: facts },
              createElement(
                MonitorMomentRowsContext.Provider,
                { value: rows as unknown as readonly MonitorAgent[] },
                createElement(ClaimsStripMoment, {
                  openNewProfile: () => undefined,
                  offersConnect: true,
                }),
              ),
            ),
          ),
        ),
      );
      await settled();
    };
  }
  const limitRow = (): Element | null =>
    container?.querySelector("section.vf-monitor-moment:not([data-moment])") ?? null;
  const notNowOnTheLimit = async (): Promise<void> => {
    const notNow = Array.from(limitRow()?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Not now",
    );
    await act(async () => notNow?.click());
    await settled();
  };

  it("does not say the line while the limit moment shows, and says the next once it leaves", async () => {
    const { client, request } = fieldd({});
    const show = await claims(client);
    await show(AT_THE_LINE, [agent()]);
    expect(limitRow()).not.toBeNull();
    await show(AT_THE_LINE, [answered(T0 + 14 * MIN)]);
    expect(row()).toBeNull();
    expect(momentWrites(request)).toEqual([]);
    await notNowOnTheLimit();
    expect(limitRow()).toBeNull();
    const later = T0 + 20 * MIN;
    await show(AT_THE_LINE, [
      agent({ statusSince: later, wait: { kind: "permission", since: later } }),
    ]);
    await show(AT_THE_LINE, [answered(later + 12 * MIN)]);
    expect(row()?.querySelector(".vf-monitor-moment-title")?.textContent).toBe(
      "It waited 12m for you.",
    );
    expect(momentWrites(request)).toEqual([
      { moment: "limit", state: "retired" },
      { moment: "connect-ask:approval-wait", state: "asked" },
    ]);
  });

  it("stands a said line aside while the limit moment comes, and back once it leaves", async () => {
    const { client } = fieldd({});
    const show = await claims(client);
    await show(UNDER, [agent()]);
    const cleared = [answered(T0 + 14 * MIN)];
    await show(UNDER, cleared);
    expect(row()).not.toBeNull();
    await show(AT_THE_LINE, cleared);
    expect(limitRow()).not.toBeNull();
    expect(row()).toBeNull();
    await notNowOnTheLimit();
    expect(limitRow()).toBeNull();
    expect(row()).not.toBeNull();
  });
});

describe("the row (the shipping face the catalog mounts)", () => {
  it("names the agent by its project, says the wait and the phone's line, with its two acts", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const fact = { rowId: "a1", clearedAt: T0, waitedMs: 72 * MIN, project: "vibe-field" };
    await act(async () =>
      root?.render(
        createElement(ApprovalWaitCard, {
          fact,
          onConnect: () => undefined,
          onDismiss: () => undefined,
        }),
      ),
    );
    const section = row();
    const title = section?.querySelector(".vf-monitor-moment-title");
    expect(title?.textContent).toBe("It waited 1h 12m for you.");
    expect(section?.getAttribute("aria-labelledby")).toBe(title?.id);
    const line = document.getElementById(section?.getAttribute("aria-describedby") ?? "");
    expect(line?.textContent).toBe("Your phone can show and answer requests like this one.");
    expect(
      Array.from(section?.querySelectorAll("button") ?? []).map(
        (button) => button.getAttribute("aria-label") ?? button.textContent,
      ),
    ).toEqual(["Connect your devices", "Not now"]);
  });
});
