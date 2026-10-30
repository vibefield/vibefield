// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAccountUsageEntry, AgentProfileSet, SetupLedger } from "@vibefield/contracts";
import { emptySetupLedger } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_NATIVE,
  FIXTURE_PROFILES_CONTEXT,
  FIXTURE_PROFILES_NOW,
  FIXTURE_WORK,
} from "../src/design-system/profiles-fixtures";
import { settingsOpening } from "../src/field/shell-presentation";
import { LimitMoment, LimitMomentCard } from "../src/godview/LimitMoment";
import {
  type MonitorAccountFacts,
  MonitorAccountFactsContext,
} from "../src/godview/monitor/account-facts";
import { type FieldHost, setHost } from "../src/host";
import {
  type LimitMomentFact,
  limitCandidates,
  limitMoment,
  unplannedAtTheLine,
  windowWords,
} from "../src/setup/limit-moment";
import { PROFILES_WORDS } from "../src/setup/profiles-words";

// AO-6b (track AO; AO-D11 ruled A and AO-D15 ruled (a) by James 2026-10-27),
// one row since AO-6b3 (his "go with your lean" the same day) — the limit
// moment: a plan at 90% or more of one of its windows, while This Mac is the
// only profile, offers a profile once on Godview's claims strip, for what Agent
// Profiles shows. Add a profile… opens Agent Profiles' New profile…; either act
// retires it.

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

type Metric = AgentAccountUsageEntry["metrics"][number];

/** This Mac's readings as the profiles' fixture holds them: no window past 64%. */
const READINGS: readonly AgentAccountUsageEntry[] = FIXTURE_PROFILES_CONTEXT.usage;
/** what fieldd's inventory lists as installed on This Mac (the fixture's) */
const INSTALLED: ReadonlySet<string> = new Set(
  FIXTURE_PROFILES_CONTEXT.installs.map((install) => install.provider),
);
const NOW = FIXTURE_PROFILES_NOW;

/** The unkeyed reading of the agent that names This Mac's `index`th plan,
 * changed by `change` (its metrics, or the whole entry). */
function reading(
  index: number,
  change: (entry: AgentAccountUsageEntry) => AgentAccountUsageEntry,
  usage: readonly AgentAccountUsageEntry[] = READINGS,
): AgentAccountUsageEntry[] {
  const plan = FIXTURE_NATIVE.plans?.[index];
  const namer = FIXTURE_NATIVE.personas.find((persona) => persona.profileId === plan?.namedBy);
  return usage.map((entry) =>
    namer !== undefined && entry.provider === namer.provider && entry.profileId === undefined
      ? change(entry)
      : entry,
  );
}
const raised = (
  index: number,
  change: (metric: Metric) => Metric,
  usage: readonly AgentAccountUsageEntry[] = READINGS,
): AgentAccountUsageEntry[] =>
  reading(index, (entry) => ({ ...entry, metrics: entry.metrics.map(change) }), usage);
const windowAt =
  (minutes: number, percent: number) =>
  (metric: Metric): Metric =>
    metric.kind === "window" && metric.durationMinutes === minutes
      ? { ...metric, usedPercent: percent }
      : metric;

const retired = (): SetupLedger => ({
  ...emptySetupLedger(),
  moments: { limit: { state: "retired", at: "2026-10-27T16:00:00.000Z" } },
});

/** The rule, whole: the candidates at the line, then the one Agent Profiles shows. */
function speaks(
  sets: readonly AgentProfileSet[] | null,
  usage: readonly AgentAccountUsageEntry[] | null,
  ledger: SetupLedger | null = emptySetupLedger(),
  installed: ReadonlySet<string> | null = INSTALLED,
): LimitMomentFact | null {
  return limitMoment(limitCandidates({ sets, usage, ledger, now: NOW }), installed);
}

describe("whether the limit moment speaks (the rule)", () => {
  it("says nothing while every window is under 90%", () => {
    expect(speaks([FIXTURE_NATIVE], READINGS)).toBeNull();
  });

  it("names the fullest window at 90% or more, rounded as the usage column rounds, the plan as This Mac's page names it", () => {
    const usage = raised(1, windowAt(300, 95.6), raised(0, windowAt(10_080, 92)));
    expect(speaks([FIXTURE_NATIVE], usage)).toEqual({
      service: FIXTURE_NATIVE.plans?.[1]?.service,
      title: "ChatGPT Pro",
      usedPercent: 96,
      window: "5 hours",
    });
    expect(speaks([FIXTURE_NATIVE], raised(0, windowAt(10_080, 90)))).toMatchObject({
      title: "Claude Max",
      usedPercent: 90,
      window: "7 days",
    });
    expect(speaks([FIXTURE_NATIVE], raised(0, windowAt(10_080, 89.9)))).toBeNull();
  });

  it("says the part of the plan a window meters, as Agent Profiles heads it", () => {
    const opus: Metric = {
      id: "7d-opus",
      label: "OPUS",
      kind: "window",
      usedPercent: 95,
      durationMinutes: 10_080,
      resetsAt: new Date(NOW.getTime() + 70 * 3_600_000).toISOString(),
      group: { id: "scope:opus", label: "Opus only" },
    };
    const usage = reading(0, (entry) => ({ ...entry, metrics: [...entry.metrics, opus] }));
    const fact = speaks([FIXTURE_NATIVE], usage);
    expect(fact).toEqual({
      service: FIXTURE_NATIVE.plans?.[0]?.service,
      title: "Claude Max",
      usedPercent: 95,
      window: "7 days",
      part: "Opus only",
    });
    expect(PROFILES_WORDS.limitUse(95, "7 days", fact?.part)).toBe("95% · Opus only · 7 days");
  });

  it("never speaks for a budget, a standby allowance, or a window already past its reset", () => {
    const budget = raised(0, (metric) =>
      metric.kind === "budget" ? { ...metric, usedPercent: 99 } : metric,
    );
    expect(speaks([FIXTURE_NATIVE], budget)).toBeNull();
    const standby = raised(0, (metric) =>
      metric.kind === "window" && metric.durationMinutes === 10_080
        ? { ...metric, usedPercent: 99, group: { id: "reserve", label: "Reserve", standby: true } }
        : metric,
    );
    expect(speaks([FIXTURE_NATIVE], standby)).toBeNull();
    const reset = raised(0, (metric) =>
      metric.kind === "window" && metric.durationMinutes === 10_080
        ? { ...metric, usedPercent: 92, resetsAt: new Date(NOW.getTime() - 60_000).toISOString() }
        : metric,
    );
    expect(speaks([FIXTURE_NATIVE], reset)).toBeNull();
    // a window that says no reset is read as it stands
    const unstamped = raised(0, (metric) => {
      if (metric.kind !== "window" || metric.durationMinutes !== 10_080) return metric;
      const { resetsAt: _reset, ...rest } = metric;
      return { ...rest, usedPercent: 92 };
    });
    expect(speaks([FIXTURE_NATIVE], unstamped)).toMatchObject({ usedPercent: 92 });
  });

  it("reads a reading kept after a failed refresh, never a failed one or an expired sign-in's", () => {
    const at92 = raised(0, windowAt(10_080, 92));
    const kept = reading(0, (entry) => ({ ...entry, state: "rate-limited", stale: true }), at92);
    expect(speaks([FIXTURE_NATIVE], kept)).toMatchObject({ title: "Claude Max", usedPercent: 92 });
    const failed = reading(0, (entry) => ({ ...entry, state: "unavailable" }), at92);
    expect(speaks([FIXTURE_NATIVE], failed)).toBeNull();
    const expired = reading(
      0,
      (entry) => ({ ...entry, state: "unauthenticated", stale: true }),
      at92,
    );
    expect(speaks([FIXTURE_NATIVE], expired)).toBeNull();
  });

  it("speaks only for a plan whose card Agent Profiles shows: an agent of it installed, its account named", () => {
    const usage = raised(0, windowAt(10_080, 92));
    expect(speaks([FIXTURE_NATIVE], usage, emptySetupLedger(), new Set(["codex"]))).toBeNull();
    // until the inventory answers, nothing is known to be installed
    expect(speaks([FIXTURE_NATIVE], usage, emptySetupLedger(), null)).toBeNull();
    const unnamed: AgentProfileSet = {
      ...FIXTURE_NATIVE,
      plans: (FIXTURE_NATIVE.plans ?? []).map((plan, index) =>
        index === 0 ? { ...plan, account: { plan: "max" } } : plan,
      ),
    };
    expect(speaks([unnamed], usage)).toBeNull();
  });

  it("speaks only while This Mac is the only profile, never once retired, and only once all three answered", () => {
    const usage = raised(0, windowAt(10_080, 92));
    expect(speaks([FIXTURE_NATIVE, FIXTURE_WORK], usage)).toBeNull();
    expect(speaks([FIXTURE_WORK], usage)).toBeNull();
    expect(speaks([FIXTURE_NATIVE], usage, retired())).toBeNull();
    // only retired silences it: a moment's other state (TS-4's `asked`) is no answer here
    expect(
      speaks([FIXTURE_NATIVE], usage, {
        ...emptySetupLedger(),
        moments: { limit: { state: "asked", at: "2026-10-27T16:00:00.000Z" } },
      }),
    ).not.toBeNull();
    expect(speaks(null, usage)).toBeNull();
    expect(speaks([FIXTURE_NATIVE], null)).toBeNull();
    expect(speaks([FIXTURE_NATIVE], usage, null)).toBeNull();
  });

  it("knows a sign-in at the line that no plan names yet (an account signed in after fieldd read its identities)", () => {
    const usage = raised(0, windowAt(10_080, 92));
    const unplanned: AgentProfileSet = {
      ...FIXTURE_NATIVE,
      plans: (FIXTURE_NATIVE.plans ?? []).slice(1),
    };
    const input = { sets: [unplanned], usage, ledger: emptySetupLedger(), now: NOW };
    expect(unplannedAtTheLine(input)).toBe(true);
    expect(limitCandidates(input)).toEqual([]);
    expect(unplannedAtTheLine({ ...input, sets: [FIXTURE_NATIVE] })).toBe(false);
    expect(unplannedAtTheLine({ ...input, usage: READINGS })).toBe(false);
    expect(unplannedAtTheLine({ ...input, ledger: retired() })).toBe(false);
  });

  it("says a window's length as a person says it, or the adapter's label when it has none", () => {
    const metric = { id: "w", label: "5H", kind: "window", usedPercent: 91 };
    expect(windowWords({ ...metric, durationMinutes: 10_080 })).toBe("7 days");
    expect(windowWords({ ...metric, durationMinutes: 1440 })).toBe("1 day");
    expect(windowWords({ ...metric, durationMinutes: 300 })).toBe("5 hours");
    expect(windowWords({ ...metric, durationMinutes: 60 })).toBe("1 hour");
    expect(windowWords({ ...metric, durationMinutes: 90 })).toBe("90 minutes");
    expect(windowWords(metric)).toBe("5H");
  });
});

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string): string => readFileSync(join(PACKAGE_ROOT, path), "utf8");
const sheet = read("src/godview/godview.css");
/** One rule's declarations, by its exact selector at a line's start. */
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sheet.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
};

describe("the row's stylesheet, held to DESIGN.md §8 and §2.7 (AO-6b3)", () => {
  it("reads its number in Godview's attention ink, per Godview's own mode, from the tokens DESIGN.md names", () => {
    expect(rule(".vf-monitor-moment-use")).toContain("color: var(--vf-monitor-ink-attention)");
    expect(rule(".vf-godview-tweak-panel.theme-light")).toContain(
      "--vf-monitor-ink-attention: var(--vf-godview-light-ink-attention)",
    );
    expect(rule(".vf-godview-tweak-panel.theme-dark")).toContain(
      "--vf-monitor-ink-attention: var(--vf-godview-dark-ink-attention)",
    );
    const tokens = read("../design-kit/src/tokens.css");
    expect(tokens).toContain("--vf-godview-light-ink-attention: #b25e00;");
    expect(tokens).toContain("--vf-godview-dark-ink-attention: #ff9f0a;");
    const design = read("../../DESIGN.md");
    expect(design).toContain(
      "| attention ink (a state word that has to be read, §2.5) | `#B25E00` `--vf-godview-light-ink-attention` | `#FF9F0A` `--vf-godview-dark-ink-attention` |",
    );
  });

  it("keeps the primary's label on hover: the acts hover as the deck fault's Try again, its ink with its ground", () => {
    const hover = rule(".vf-monitor-moment-act:hover:not(:disabled)");
    expect(hover).toContain("color: var(--text-main)");
    expect(hover).toContain("background: var(--control-hover-bg)");
    expect(sheet).toMatch(
      /^\.vf-godview-deck-fault-retry:hover,\n\.vf-monitor-moment-act:hover:not\(:disabled\) \{/m,
    );
  });

  it("wraps and widens the strip only while the row shows; otherwise its chips shrink on one line", () => {
    expect(rule(".vf-monitor-claims")).not.toContain("flex-wrap");
    const holding = rule(".vf-monitor-claims:has(> .vf-monitor-moment)");
    expect(holding).toContain("flex-wrap: wrap");
    expect(holding).toContain("width: max-content");
  });

  it("enters with the profile notice's fade, and none under Reduce Motion or with Godview's animations off", () => {
    expect(rule(".vf-monitor-moment")).toContain("transition: opacity 300ms ease-out");
    expect(sheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.vf-monitor-moment \{\s*transition: none;/,
    );
    expect(rule('.vf-godview[data-godview-animations="off"] .vf-monitor-moment')).toContain(
      "transition: none",
    );
  });
});

describe("where Add a profile… opens Settings", () => {
  it("is Agent Profiles on its New profile… form; the other targets keep their pages", () => {
    expect(settingsOpening("new-profile")).toEqual({ page: "profiles", profiles: { kind: "new" } });
    expect(settingsOpening("account")).toEqual({ page: "account" });
    expect(settingsOpening("devices")).toEqual({ page: "devices" });
    expect(settingsOpening("general")).toEqual({ page: "general" });
    expect(settingsOpening("diagnostics")).toEqual({ page: "general" });
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

const AT_92 = raised(0, windowAt(10_080, 92));

describe("the row (the shipping face the catalog mounts)", () => {
  it("says the plan, the window's use and the question in one row with its two acts; the voice is the primary's description", async () => {
    const fact = speaks([FIXTURE_NATIVE], AT_92);
    if (fact === null) throw new Error("the fixture should speak");
    const onAddProfile = vi.fn();
    await mount(createElement(LimitMomentCard, { fact, onAddProfile, onNotNow: () => undefined }));
    const row = container?.querySelector("section.vf-monitor-moment");
    expect(row?.querySelector(".vf-monitor-moment-plan")?.textContent).toBe("Claude Max");
    expect(row?.querySelector(".vf-monitor-moment-use")?.textContent).toBe("92% · 7 days");
    const title = row?.querySelector(".vf-monitor-moment-title");
    expect(title?.textContent).toBe("Another subscription?");
    expect(row?.getAttribute("aria-labelledby")).toBe(title?.id);
    // the voice: not drawn, said as Add a profile…'s description
    const add = button("Add a profile…");
    const voice = document.getElementById(add.getAttribute("aria-describedby") ?? "");
    expect(voice?.textContent).toBe(
      "Add it as a profile and keep working. Each profile keeps its own sign-ins.",
    );
    expect(voice?.hidden).toBe(true);
    await act(async () => add.click());
    expect(onAddProfile).toHaveBeenCalledWith(add);
    expect(button("Not now")).toBeDefined();
  });

  it("holds Add a profile… while Settings cannot take a new page", async () => {
    const fact = speaks([FIXTURE_NATIVE], AT_92);
    if (fact === null) throw new Error("the fixture should speak");
    await mount(
      createElement(LimitMomentCard, {
        fact,
        canAdd: false,
        onAddProfile: () => undefined,
        onNotNow: () => undefined,
      }),
    );
    expect(button("Add a profile…").disabled).toBe(true);
    expect(button("Not now").disabled).toBe(false);
  });
});

/** fieldd as the moment asks it: the ledger by subscription (the only one it
 * opens), the inventory and the identities by request, every write recorded. */
function fieldd(opts: { ledger?: SetupLedger; refuse?: boolean; noInventory?: boolean }) {
  const subscribe = vi.fn(async (method: string) => {
    if (method !== "setup.subscribe") throw new Error(`unexpected subscription: ${method}`);
    return {
      subId: method,
      snapshot: opts.ledger ?? emptySetupLedger(),
      unsubscribe: (): void => undefined,
    };
  });
  const request = vi.fn(async (method: string) => {
    if (method === "agents.installs") {
      if (opts.noInventory === true) throw new Error("the inventory is not answering");
      return { installs: FIXTURE_PROFILES_CONTEXT.installs };
    }
    if (method === "setup.moment" && opts.refuse === true) throw new Error("not writable");
    return { ok: true };
  });
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe,
    request,
  } as unknown as FielddClient;
  return { client, subscribe, request };
}

/** Godview's cover as the moment sits in it: the head's view circles (the
 * current one pressed), and the claims strip lent the stage's facts. */
function mountStrip(
  client: FielddClient,
  facts: MonitorAccountFacts,
  openNewProfile?: () => void,
): Promise<void> {
  return mount(
    createElement(
      "div",
      { className: "vf-godview" },
      createElement(
        "div",
        { role: "group", "aria-label": "Monitor view" },
        createElement("button", { type: "button", "aria-pressed": false }, "Swarm"),
        createElement("button", { type: "button", "aria-pressed": true }, "List"),
      ),
      createElement(
        FielddProvider,
        { client },
        createElement(
          MonitorAccountFactsContext.Provider,
          { value: facts },
          createElement(LimitMoment, { openNewProfile, now: NOW }),
        ),
      ),
    ),
  );
}

const STAGE: MonitorAccountFacts = { sets: [FIXTURE_NATIVE], usage: AT_92 };

describe("the claims strip's moment (the controller)", () => {
  it("speaks from the stage's own facts and opens no feed of its own: the ledger, then the inventory once", async () => {
    const { client, subscribe, request } = fieldd({});
    await mountStrip(client, STAGE, () => undefined);
    await settled();
    expect(container?.querySelector(".vf-monitor-moment-use")?.textContent).toBe("92% · 7 days");
    expect(subscribe.mock.calls.map(([method]) => method)).toEqual(["setup.subscribe"]);
    expect(request.mock.calls.filter(([method]) => method === "agents.installs")).toHaveLength(1);
  });

  it("opens Agent Profiles' New profile… and retires the moment with Add a profile…, the keyboard handed to the view's circle", async () => {
    const open = vi.fn();
    const { client, request } = fieldd({});
    await mountStrip(client, STAGE, open);
    await settled();
    const add = button("Add a profile…");
    add.focus();
    await act(async () => add.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("setup.moment", { moment: "limit", state: "retired" });
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
    expect(document.activeElement?.textContent).toBe("List");
  });

  it("retires it with Not now, opens nothing, and leaves even when the write is refused", async () => {
    const open = vi.fn();
    const { client, request } = fieldd({ refuse: true });
    await mountStrip(client, STAGE, open);
    await settled();
    const notNow = button("Not now");
    notNow.focus();
    await act(async () => notNow.click());
    await settled();
    expect(request).toHaveBeenCalledWith("setup.moment", { moment: "limit", state: "retired" });
    expect(open).not.toHaveBeenCalled();
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
    expect(document.activeElement?.textContent).toBe("List");
  });

  it("holds Add a profile… while Settings is open (no page can be asked of it)", async () => {
    const { client } = fieldd({});
    await mountStrip(client, STAGE);
    await settled();
    expect(button("Add a profile…").disabled).toBe(true);
    expect(button("Not now").disabled).toBe(false);
  });

  it("draws nothing once retired, beside a second profile, under the line, or before the inventory answers", async () => {
    const quiet = async (
      setup: ReturnType<typeof fieldd>,
      facts: MonitorAccountFacts,
    ): Promise<void> => {
      await mountStrip(setup.client, facts, () => undefined);
      await settled();
      expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
      await act(async () => root?.unmount());
      container?.remove();
    };
    await quiet(fieldd({ ledger: retired() }), STAGE);
    await quiet(fieldd({}), { sets: [FIXTURE_NATIVE, FIXTURE_WORK], usage: AT_92 });
    const under = fieldd({});
    await quiet(under, { sets: [FIXTURE_NATIVE], usage: READINGS });
    // under the line, the inventory is never asked
    expect(under.request.mock.calls.some(([method]) => method === "agents.installs")).toBe(false);
    await quiet(fieldd({ noInventory: true }), STAGE);
    await quiet(fieldd({}), { sets: null, usage: AT_92 });
  });

  it("asks fieldd once to read the identities again when a sign-in at the line has no plan to name it", async () => {
    const unplanned: AgentProfileSet = {
      ...FIXTURE_NATIVE,
      plans: (FIXTURE_NATIVE.plans ?? []).slice(1),
    };
    const { client, request } = fieldd({});
    await mountStrip(client, { sets: [unplanned], usage: AT_92 }, () => undefined);
    await settled();
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
    const asks = request.mock.calls.filter(([method]) => method === "agents.profileSets.list");
    expect(asks).toEqual([["agents.profileSets.list", { refresh: true }]]);
  });
});
