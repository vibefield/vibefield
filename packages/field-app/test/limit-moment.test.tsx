// @vitest-environment happy-dom

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
  FIXTURE_WORK,
} from "../src/design-system/profiles-fixtures";
import { settingsOpening } from "../src/field/shell-presentation";
import { publishSettingsDoor, resetSettingsDoorForTest } from "../src/frame/settings-door";
import { LimitMoment, LimitMomentCard } from "../src/godview/LimitMoment";
import { type FieldHost, setHost } from "../src/host";
import { limitMoment, windowWords } from "../src/setup/limit-moment";

// AO-6b (track AO; AO-D11 ruled A and AO-D15 ruled (a) by James 2026-10-27) —
// the limit moment: a plan at 90% or more of one of its windows, while This Mac
// is the only profile, offers a profile once on Godview's claims strip. Add a
// profile… opens Agent Profiles' New profile…; either act retires it.

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

/** This Mac's readings as the profiles' fixture holds them: no window past 64%. */
const READINGS: readonly AgentAccountUsageEntry[] = FIXTURE_PROFILES_CONTEXT.usage;

/** The unkeyed reading of the agent that names This Mac's `index`th plan, with
 * its window of `minutes` at `percent` (or a metric changed by `change`). */
function raised(
  index: number,
  change: (
    metric: AgentAccountUsageEntry["metrics"][number],
  ) => AgentAccountUsageEntry["metrics"][number],
  usage: readonly AgentAccountUsageEntry[] = READINGS,
): AgentAccountUsageEntry[] {
  const plan = FIXTURE_NATIVE.plans?.[index];
  const namer = FIXTURE_NATIVE.personas.find((persona) => persona.profileId === plan?.namedBy);
  return usage.map((entry) =>
    namer !== undefined && entry.provider === namer.provider && entry.profileId === undefined
      ? { ...entry, metrics: entry.metrics.map(change) }
      : entry,
  );
}
const windowAt =
  (minutes: number, percent: number) => (metric: AgentAccountUsageEntry["metrics"][number]) =>
    metric.kind === "window" && metric.durationMinutes === minutes
      ? { ...metric, usedPercent: percent }
      : metric;

const retired = (): SetupLedger => ({
  ...emptySetupLedger(),
  moments: { limit: { state: "retired", at: "2026-10-27T16:00:00.000Z" } },
});

describe("whether the limit moment speaks (the rule)", () => {
  it("says nothing while every window is under 90%", () => {
    expect(limitMoment([FIXTURE_NATIVE], READINGS, emptySetupLedger())).toBeNull();
  });

  it("names the fullest window at 90% or more, the plan as This Mac's page names it", () => {
    const usage = raised(1, windowAt(300, 95.6), raised(0, windowAt(10_080, 92)));
    expect(limitMoment([FIXTURE_NATIVE], usage, emptySetupLedger())).toEqual({
      service: FIXTURE_NATIVE.plans?.[1]?.service,
      title: "ChatGPT Pro",
      usedPercent: 95,
      window: "5 hours",
    });
    expect(
      limitMoment([FIXTURE_NATIVE], raised(0, windowAt(10_080, 90)), emptySetupLedger()),
    ).toMatchObject({ title: "Claude Max", usedPercent: 90, window: "7 days" });
    expect(
      limitMoment([FIXTURE_NATIVE], raised(0, windowAt(10_080, 89.9)), emptySetupLedger()),
    ).toBeNull();
  });

  it("never speaks for a budget, or a standby allowance drawn on after the plan's limits", () => {
    const budget = raised(0, (metric) =>
      metric.kind === "budget" ? { ...metric, usedPercent: 99 } : metric,
    );
    expect(limitMoment([FIXTURE_NATIVE], budget, emptySetupLedger())).toBeNull();
    const standby = raised(0, (metric) =>
      metric.kind === "window" && metric.durationMinutes === 10_080
        ? { ...metric, usedPercent: 99, group: { id: "reserve", label: "Reserve", standby: true } }
        : metric,
    );
    expect(limitMoment([FIXTURE_NATIVE], standby, emptySetupLedger())).toBeNull();
  });

  it("speaks only while This Mac is the only profile, never once retired, and only once all three answered", () => {
    const usage = raised(0, windowAt(10_080, 92));
    expect(limitMoment([FIXTURE_NATIVE, FIXTURE_WORK], usage, emptySetupLedger())).toBeNull();
    expect(limitMoment([FIXTURE_WORK], usage, emptySetupLedger())).toBeNull();
    expect(limitMoment([FIXTURE_NATIVE], usage, retired())).toBeNull();
    expect(limitMoment(null, usage, emptySetupLedger())).toBeNull();
    expect(limitMoment([FIXTURE_NATIVE], null, emptySetupLedger())).toBeNull();
    expect(limitMoment([FIXTURE_NATIVE], usage, null)).toBeNull();
  });

  it("reads only a reading that is available", () => {
    const usage = raised(0, windowAt(10_080, 92)).map((entry) =>
      entry.metrics.some((metric) => metric.usedPercent === 92)
        ? { ...entry, state: "unavailable" as const }
        : entry,
    );
    expect(limitMoment([FIXTURE_NATIVE], usage, emptySetupLedger())).toBeNull();
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
  resetSettingsDoorForTest();
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

describe("the card (the shipping face the catalog mounts)", () => {
  it("says the plan, the window's use, the question and its two acts", async () => {
    const fact = limitMoment([FIXTURE_NATIVE], raised(0, windowAt(10_080, 92)), emptySetupLedger());
    if (fact === null) throw new Error("the fixture should speak");
    const onAddProfile = vi.fn();
    await mount(createElement(LimitMomentCard, { fact, onAddProfile, onNotNow: () => undefined }));
    expect(container?.querySelector(".vf-monitor-moment-plan")?.textContent).toBe("Claude Max");
    expect(container?.querySelector(".vf-monitor-moment-use")?.textContent).toBe("92% · 7 days");
    expect(container?.querySelector(".vf-monitor-moment-title")?.textContent).toBe(
      "Another subscription?",
    );
    expect(container?.querySelector(".vf-monitor-moment-voice")?.textContent).toBe(
      "Add it as a profile and keep working. Each profile keeps its own sign-ins.",
    );
    await act(async () => button("Add a profile…").click());
    expect(onAddProfile).toHaveBeenCalledTimes(1);
    expect(button("Not now")).toBeDefined();
  });

  it("holds Add a profile… while no frame lends Settings", async () => {
    const fact = limitMoment([FIXTURE_NATIVE], raised(0, windowAt(10_080, 92)), emptySetupLedger());
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

/** fieldd as the claims strip asks it: This Mac's profiles, the usage, the
 * ledger — each a subscription's snapshot — and every write recorded. */
function fieldd(opts: {
  sets?: readonly AgentProfileSet[];
  usage?: readonly AgentAccountUsageEntry[];
  ledger?: SetupLedger;
  refuse?: boolean;
}): FielddClient {
  const snapshots: Record<string, unknown> = {
    "setup.subscribe": opts.ledger ?? emptySetupLedger(),
    "agents.profileSets.subscribe": {
      sets: opts.sets ?? [FIXTURE_NATIVE],
      signIn: [],
      identity: [],
      signOut: [],
      reading: false,
    },
    "agents.usage.subscribe": {
      entries: opts.usage ?? raised(0, windowAt(10_080, 92)),
      generatedAt: "2026-10-27T16:00:00.000Z",
    },
  };
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (!(method in snapshots)) throw new Error(`unexpected subscription: ${method}`);
      return { subId: method, snapshot: snapshots[method], unsubscribe: (): void => undefined };
    }),
    request: vi.fn(async (method: string) => {
      if (opts.refuse === true && method === "setup.moment") throw new Error("not writable");
      return { ok: true };
    }),
  } as unknown as FielddClient;
}

const mountStrip = (client: FielddClient) =>
  mount(createElement(FielddProvider, { client }, createElement(LimitMoment)));

describe("the claims strip's moment (the controller)", () => {
  it("opens Agent Profiles' New profile… and retires the moment with Add a profile…", async () => {
    const open = vi.fn();
    publishSettingsDoor({ open });
    const client = fieldd({});
    await mountStrip(client);
    await settled();
    expect(container?.querySelector(".vf-monitor-moment-use")?.textContent).toBe("92% · 7 days");
    await act(async () => button("Add a profile…").click());
    expect(open).toHaveBeenCalledWith("new-profile");
    expect(client.request).toHaveBeenCalledWith("setup.moment", {
      moment: "limit",
      state: "retired",
    });
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
  });

  it("retires it with Not now, opens nothing, and leaves even when the write is refused", async () => {
    const open = vi.fn();
    publishSettingsDoor({ open });
    const client = fieldd({ refuse: true });
    await mountStrip(client);
    await settled();
    await act(async () => button("Not now").click());
    await settled();
    expect(client.request).toHaveBeenCalledWith("setup.moment", {
      moment: "limit",
      state: "retired",
    });
    expect(open).not.toHaveBeenCalled();
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
  });

  it("draws nothing once retired, beside a second profile, or under the line", async () => {
    await mountStrip(fieldd({ ledger: retired() }));
    await settled();
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
    await act(async () => root?.unmount());
    container?.remove();

    await mountStrip(fieldd({ sets: [FIXTURE_NATIVE, FIXTURE_WORK] }));
    await settled();
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
    await act(async () => root?.unmount());
    container?.remove();

    await mountStrip(fieldd({ usage: READINGS }));
    await settled();
    expect(container?.querySelector(".vf-monitor-moment")).toBeNull();
  });
});
