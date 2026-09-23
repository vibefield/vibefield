// @vitest-environment happy-dom
/**
 * THE PICKER'S ROWS (AC-4) — the catalog's decision, on the deck's provider picker.
 *
 * Since AC-1 an `agent.providers` row can say what VibeField decided about its
 * agent: `status` (supported · preview · deprecated), `offers` (the
 * capabilities VibeField claims) and `history` (the index's state for it on
 * this device). The picker draws those three and nothing else — never the id
 * (AR-L1) — and this file holds it to that twice: the rules as pure functions
 * (`provider-picker.ts`), and the same rules on the real monitor stage, where
 * the bar's SPAWN, the list view's own create gesture and the persona choice
 * all have to agree.
 *
 * The door's answer is the CONTRACT's own fixture (`agent-providers.valid.json`,
 * which AC-1 gave the new fields: claude supported · indexed with one managed
 * persona, pi preview · unindexed), parsed by the same `AgentProvidersResult`
 * the deck's door parses with — so a shape that moves in `packages/contracts`
 * fails here rather than drifting into the bar. The states the fixture does not
 * carry (deprecated, declined, a row that denies a capability) are the
 * fixture's own rows with one field changed, back through the contract on the
 * way in. Two shapes are built as the WIRE carries them instead, because the
 * contract of one build cannot describe the other's: a daemon before AC-3
 * (no decision at all — AC-3 makes `status` and `offers` required) and a newer
 * one (a status or history word this build never heard of — AC-3 opens both).
 *
 * What it holds:
 *   1. the badge is the decision's word — Preview and Deprecated; nothing for
 *      supported, NOTHING for a row with no status (a daemon before AC-3), an
 *      unknown word carried in its own spelling, and a declined row not listed
 *   2. the new-session verb is withdrawn for a deprecated row (and an unknown
 *      status): SPAWN is absent, and the view's own create gesture is refused
 *      out loud, before the door
 *   3. the persona choice follows `offers.personas`
 *   4. the history state wears the deck's degraded idiom and describes the picker
 *   5. the label is the door's, then the catalog's — never a name typed here
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  type AccountUsagePort,
  type HistoryPort,
  monitorParameterDefaults,
  monitorViewFor,
} from "@vibecook/puppeteer-views";
import { createInlineSwarmPhysicsDriver } from "@vibecook/puppeteer-views/physics";
import { AgentProviderSummary, AgentProvidersResult, catalogEntry } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import {
  defaultProviderId,
  newSessionRefusal,
  personaChoices,
  providerBadge,
  providerHistoryClaim,
  providerListed,
  providerOptionText,
  providerPickerLabel,
  providerStartsSessions,
} from "../src/godview/monitor/provider-picker";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";
import { setSwarmPhysicsDriverFactory } from "../src/godview/views/swarm/swarm-physics-driver";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");

/** The contract's fixture, through the door's own parse. */
function fixtureProviders(): AgentProviderSummary[] {
  const raw = JSON.parse(readFileSync(join(FIXTURES, "agent-providers.valid.json"), "utf8"));
  return AgentProvidersResult.parse(raw).providers;
}

const [CLAUDE, PI] = fixtureProviders() as [AgentProviderSummary, AgentProviderSummary];

/** A fixture row with some fields changed, back through the contract. */
function row(base: AgentProviderSummary, patch: Record<string, unknown>): AgentProviderSummary {
  return AgentProviderSummary.parse({ ...base, ...patch });
}

/** The same row as a daemon before AC-3 sends it: no decision at all. Built as
 * the wire carries it, not through the contract — from AC-3 the contract
 * requires `status` and `offers`, so this is exactly the shape it no longer
 * describes, and the picker must still draw it as it always did. */
function undecided(base: AgentProviderSummary): AgentProviderSummary {
  const { status: _status, offers: _offers, history: _history, mark: _mark, ...rest } = base;
  return rest as AgentProviderSummary;
}

/** A row as a NEWER daemon may send it: a word this build never heard of.
 * Built as the wire carries it, for the same reason — AC-3 opens `status` and
 * `history` on the wire, and the contract this branch builds against may not. */
function newer(base: AgentProviderSummary, patch: Record<string, unknown>): AgentProviderSummary {
  return { ...base, ...patch } as unknown as AgentProviderSummary;
}

/** A deprecated agent, installed, carrying managed personas it no longer offers. */
const DEPRECATED = row(CLAUDE, { id: "hermes", label: "Hermes", status: "deprecated" });
/** A declined agent that reached the renderer anyway (fieldd should never send one). */
const DECLINED = row(PI, { id: "declined-agent", label: "Declined agent", status: "declined" });

const CHECKED_AT = "2026-09-22T00:00:00.000Z";

function unreachableHistory(): HistoryPort {
  const status = { reachable: false, detail: "no index in this fixture", checkedAt: CHECKED_AT };
  return {
    status: async () => status,
    facts: async () => [],
    search: async () => ({ status, answered: false, hits: [], clipped: false }),
  };
}

function emptyUsage(): AccountUsagePort {
  return {
    snapshot: async () => ({ refreshedAt: CHECKED_AT, entries: [] }),
    subscribe: () => () => undefined,
  };
}

interface FakeDoor extends MonitorDoor {
  spawn: ReturnType<typeof vi.fn>;
}

/** A door whose only interesting answer is the provider list: the fold is
 * empty and the mesh serves nothing, so the stage is quiet and the bar is the
 * whole of what is under test. */
function fakeDoor(providers: readonly AgentProviderSummary[]): FakeDoor {
  return {
    listHosts: vi.fn(async () => []),
    attach: vi.fn(async () => ({ state: "attached" as const, sessionId: "r", readWrite: true })),
    observe: vi.fn(({ onFrame }) => {
      onFrame([]);
      return () => undefined;
    }),
    providers: vi.fn(async () => providers),
    spawn: vi.fn(async () => ({
      state: "spawned" as const,
      sessionId: "born-1",
      runtimeRunId: "run-born",
      label: "Claude Code",
    })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    history: unreachableHistory(),
    usage: emptyUsage(),
  };
}

const PANES: MonitorPaneFacts = {
  sessionIds: ["pane-1"],
  activeSessionId: "pane-1",
  sessions: [
    { id: "pane-1", exited: false, createdAtMs: 5, cwd: "/project/scratch" } as SessionSummary,
  ],
};

let root: Root | null = null;
let container: HTMLElement | null = null;
let markers: GodviewMonitorFacts[] = [];

beforeEach(() => {
  markers = [];
  localStorage.clear();
  // happy-dom has no Worker: the package's own inline driver, as the monitor
  // fixture uses — the list view below never starts it, the swarm would.
  setSwarmPhysicsDriverFactory((options) => createInlineSwarmPhysicsDriver(options));
  // The stage announces itself on every change: kept, for the marker row.
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("GODVIEW_MONITOR ")) {
      markers.push(JSON.parse(line.slice("GODVIEW_MONITOR ".length)) as GodviewMonitorFacts);
    }
  });
});

const latestPicker = (): GodviewMonitorFacts["picker"] | undefined =>
  markers[markers.length - 1]?.picker;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setSwarmPhysicsDriverFactory(undefined);
  vi.restoreAllMocks();
});

/** The real stage on the list view (it draws without WebGPU, and its toolbar
 * carries the view's own create gesture), fed by `door`. */
async function mountPicker(door: MonitorDoor): Promise<HTMLElement> {
  const view = monitorViewFor("list");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor
          view={view}
          parameters={monitorParameterDefaults(view.parameterGroups)}
          door={door}
          panes={PANES}
        />
      </GodviewAgentsProvider>,
    );
  });
  return container;
}

const providerSelect = (host: HTMLElement): HTMLSelectElement => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Agent provider"]');
  if (select === null) throw new Error("the provider picker never mounted");
  return select;
};
const optionTexts = (host: HTMLElement): string[] =>
  [...providerSelect(host).options].map((option) => option.textContent ?? "");
const personaSelect = (host: HTMLElement): HTMLSelectElement | null =>
  host.querySelector<HTMLSelectElement>('select[aria-label="Agent persona"]');
const spawnButton = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(".vf-godview-spawn");
const historyState = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>(".vf-godview-provider-history");
const ackText = (host: HTMLElement): string =>
  host.querySelector(".vf-monitor-ack")?.textContent ?? "";

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the picker's rules (provider-picker.ts)", () => {
  it("reads the contract's fixture as AC-1 wrote it — the rows this file leans on", () => {
    // A guard on the premise: if the fixture stops carrying the new fields,
    // every row below would pass for the wrong reason (all of them "no status").
    expect(CLAUDE).toMatchObject({ id: "claude", status: "supported", history: "indexed" });
    expect(CLAUDE.offers?.personas).toBe(true);
    expect(CLAUDE.personas.map((persona) => persona.kind)).toEqual(["managed"]);
    expect(PI).toMatchObject({
      id: "pi",
      status: "preview",
      history: "unindexed",
      available: false,
    });
  });

  it("badges preview and deprecated only — nothing for supported, nothing for a row with no status", () => {
    expect(providerBadge(PI)).toBe("Preview");
    expect(providerBadge(DEPRECATED)).toBe("Deprecated");
    expect(providerBadge(CLAUDE)).toBeNull();
    expect(providerBadge(DECLINED)).toBeNull();
    expect(providerBadge(undecided(PI))).toBeNull();
    expect(providerOptionText(CLAUDE)).toBe("Claude Code");
    expect(providerOptionText(PI)).toBe("Pi · Preview (not installed)");
    expect(providerOptionText(DEPRECATED)).toBe("Hermes · Deprecated");
    // a daemon before AC-3: exactly the text the picker always drew
    expect(providerOptionText(undecided(PI))).toBe("Pi (not installed)");
  });

  it("lists every visible status and every undecided row, never a declined one", () => {
    expect(providerListed(CLAUDE)).toBe(true);
    expect(providerListed(PI)).toBe(true);
    expect(providerListed(DEPRECATED)).toBe(true);
    expect(providerListed(undecided(CLAUDE))).toBe(true);
    expect(providerListed(DECLINED)).toBe(false);
  });

  it("offers a new session under supported and preview, never under deprecated or a denied spawn", () => {
    expect(providerStartsSessions(CLAUDE)).toBe(true);
    expect(providerStartsSessions(PI)).toBe(true);
    expect(providerStartsSessions(undecided(PI))).toBe(true);
    expect(providerStartsSessions(DEPRECATED)).toBe(false);
    expect(newSessionRefusal(DEPRECATED)).toBe("Hermes is deprecated — it starts no new sessions");
    const noSpawn = row(PI, { offers: { ...PI.offers, spawn: false } });
    expect(providerStartsSessions(noSpawn)).toBe(false);
    expect(newSessionRefusal(noSpawn)).toBe("Pi starts no new sessions here");
    expect(newSessionRefusal(CLAUDE)).toBeNull();
  });

  it("chooses, on arrival, an installed row that starts sessions — never a deprecated one first", () => {
    expect(defaultProviderId([DEPRECATED, PI, CLAUDE])).toBe("claude");
    // nothing installed starts sessions: the first row that does, installed or not
    expect(defaultProviderId([DEPRECATED, PI])).toBe("pi");
    expect(defaultProviderId([DEPRECATED])).toBe("hermes");
    expect(defaultProviderId([])).toBeNull();
  });

  it("offers a persona choice only where the row claims personas and there is a choice to make", () => {
    // claude claims personas and lists a managed one: the native default, then Kim
    expect(personaChoices(CLAUDE)).toEqual([
      { value: "", label: "Default" },
      { value: "claude:9a3d", label: "Kim" },
    ]);
    // the same list under a row that does not claim personas: no choice at all
    expect(personaChoices(row(CLAUDE, { offers: { ...CLAUDE.offers, personas: false } }))).toEqual(
      [],
    );
    // a daemon before AC-3 claims nothing, so it draws what it always drew
    expect(personaChoices(undecided(CLAUDE))).toEqual([]);
    // a deprecated row starts nothing, so it offers no one to start as
    expect(personaChoices(DEPRECATED)).toEqual([]);
    // a list holding only the native default is not a choice
    const nativeOnly = row(CLAUDE, {
      personas: [
        { ...CLAUDE.personas[0], profileId: "claude:native-default", kind: "native-default" },
      ],
    });
    expect(personaChoices(nativeOnly)).toEqual([]);
    // the native default's own label, when the door lists it, names the default
    const both = row(CLAUDE, {
      personas: [
        {
          ...CLAUDE.personas[0],
          profileId: "claude:native-default",
          kind: "native-default",
          label: "Personal",
        },
        ...CLAUDE.personas,
      ],
    });
    expect(personaChoices(both).map((choice) => choice.label)).toEqual(["Personal", "Kim"]);
  });

  it("says the history state only when it is degraded, and only for a row that claims history", () => {
    expect(providerHistoryClaim(PI)).toBe("history not indexed");
    expect(providerHistoryClaim(row(PI, { history: "unavailable" }))).toBe("history unavailable");
    // the routine state and the absent one are quiet
    expect(providerHistoryClaim(CLAUDE)).toBeNull();
    expect(providerHistoryClaim(undecided(PI))).toBeNull();
    // a row with no history to index has nothing to be degraded
    const noHistory = row(PI, { history: "unavailable", offers: { ...PI.offers, history: false } });
    expect(providerHistoryClaim(noHistory)).toBeNull();
  });

  it("carries a word this build never heard of — listed in its own spelling, offering nothing", () => {
    // a newer daemon's decision (AC-3 opens `status` on the wire): carried, never a refusal
    const unknown = newer(row(PI, { available: true }), { status: "experimental" });
    expect(providerListed(unknown)).toBe(true);
    expect(providerBadge(unknown)).toBe("Experimental");
    expect(providerOptionText(unknown)).toBe("Pi · Experimental");
    expect(providerStartsSessions(unknown)).toBe(false);
    expect(newSessionRefusal(unknown)).toBe("Pi is experimental — it starts no new sessions");
    expect(personaChoices(newer(CLAUDE, { status: "experimental" }))).toEqual([]);
    // …and a history state this build cannot name is said as sent, never
    // swallowed into the quiet that means "indexed"
    expect(providerHistoryClaim(newer(PI, { history: "rebuilding" }))).toBe("history rebuilding");
  });

  it("names a row by the door's label, then the catalog's, then the id — never a name typed here", () => {
    // a blank wire label (the contract's `min(1)` admits a space) falls to the
    // catalog's row for the id, read through `catalogEntry`
    const blank = row(PI, { label: " " });
    expect(providerPickerLabel(blank)).toBe(catalogEntry("pi")?.label);
    expect(providerPickerLabel(blank)).not.toBe(" ");
    // an id this build never decided on keeps its own id
    expect(providerPickerLabel(row(PI, { id: "newer-agent", label: " " }))).toBe("newer-agent");
    // the door's label wins whenever it says something
    expect(providerPickerLabel(row(PI, { label: "Pi (wire)" }))).toBe("Pi (wire)");
  });
});

describe("the picker on the monitor stage", () => {
  it("draws the fixture's decision in each row: the preview word on pi, nothing on claude", async () => {
    const host = await mountPicker(fakeDoor([CLAUDE, PI]));
    expect(optionTexts(host)).toEqual(["Claude Code", "Pi · Preview (not installed)"]);
    const [claude, pi] = [...providerSelect(host).options];
    expect(claude?.getAttribute("data-status")).toBe("supported");
    expect(pi?.getAttribute("data-status")).toBe("preview");
    // the installed, supported row is chosen, and it offers a new session
    expect(providerSelect(host).value).toBe("claude");
    expect(spawnButton(host)).not.toBeNull();
  });

  it("draws NOTHING new for rows with no status — a daemon before AC-3 gets the old picker", async () => {
    const door = fakeDoor([undecided(CLAUDE), undecided(PI)]);
    const host = await mountPicker(door);
    // the exact texts the picker drew before AC-4, with the fixture's labels
    expect(optionTexts(host)).toEqual(["Claude Code", "Pi (not installed)"]);
    for (const option of providerSelect(host).options) {
      expect(option.hasAttribute("data-status")).toBe(false);
    }
    expect(historyState(host)).toBeNull();
    // the fixture's claude lists a managed persona, but claims nothing: no choice
    expect(personaSelect(host)).toBeNull();
    // …and the verb is the old verb, with the old request
    await act(async () => spawnButton(host)?.click());
    expect(door.spawn).toHaveBeenCalledTimes(1);
    expect(door.spawn.mock.calls[0]?.[0]).toEqual({ provider: "claude" });
  });

  it("does not list a declined row", async () => {
    const host = await mountPicker(fakeDoor([CLAUDE, DECLINED, PI]));
    expect(optionTexts(host)).toEqual(["Claude Code", "Pi · Preview (not installed)"]);
  });

  it("badges a deprecated row and withdraws its new session — SPAWN absent, the view's gesture refused", async () => {
    const door = fakeDoor([DEPRECATED, CLAUDE]);
    const host = await mountPicker(door);
    expect(optionTexts(host)).toEqual(["Hermes · Deprecated", "Claude Code"]);
    // the deprecated row is listed first but not chosen first
    expect(providerSelect(host).value).toBe("claude");
    expect(spawnButton(host)).not.toBeNull();

    await choose(providerSelect(host), "hermes");
    expect(providerSelect(host).value).toBe("hermes");
    // the chrome's verb is gone, not dimmed…
    expect(spawnButton(host)).toBeNull();
    // …no persona is offered to start as (the row lists Kim, and starts nothing)…
    expect(personaSelect(host)).toBeNull();
    // …and the view's own create gesture, which cannot be withdrawn, is
    // refused out loud before the door is asked
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(door.spawn).not.toHaveBeenCalled();
    expect(ackText(host)).toBe("Hermes is deprecated — it starts no new sessions");

    // choosing an offered row brings the verb back
    await choose(providerSelect(host), "claude");
    expect(spawnButton(host)).not.toBeNull();
  });

  it("offers the persona choice where the row claims personas, and spawns as the persona chosen", async () => {
    const door = fakeDoor([CLAUDE, PI]);
    const host = await mountPicker(door);
    const personas = personaSelect(host);
    expect(personas, "claude claims personas and lists Kim").not.toBeNull();
    expect([...(personas?.options ?? [])].map((option) => option.textContent)).toEqual([
      "Default",
      "Kim",
    ]);
    // the default is the native default: the request the picker always sent
    expect(personas?.value).toBe("");
    await act(async () => spawnButton(host)?.click());
    expect(door.spawn.mock.calls[0]?.[0]).toEqual({ provider: "claude" });

    await choose(personas as HTMLSelectElement, "claude:9a3d");
    expect(spawnButton(host)?.title).toBe("spawn Claude Code as Kim in the active pane");
    await act(async () => spawnButton(host)?.click());
    expect(door.spawn.mock.calls[1]?.[0]).toEqual({ provider: "claude", profileId: "claude:9a3d" });

    // a persona belongs to one provider: choosing another row drops it
    await choose(providerSelect(host), "pi");
    expect(personaSelect(host), "pi claims personas but lists none — no choice").toBeNull();
    await choose(providerSelect(host), "claude");
    expect(personaSelect(host)?.value).toBe("");
  });

  it("draws no persona choice for a row that does not claim personas, whatever its list holds", async () => {
    const denied = row(CLAUDE, { offers: { ...CLAUDE.offers, personas: false } });
    const door = fakeDoor([denied]);
    const host = await mountPicker(door);
    expect(personaSelect(host)).toBeNull();
    await act(async () => spawnButton(host)?.click());
    expect(door.spawn.mock.calls[0]?.[0]).toEqual({ provider: "claude" });
  });

  it("says a degraded history in the deck's unavailable idiom, and the state describes the picker", async () => {
    const host = await mountPicker(fakeDoor([CLAUDE, row(PI, { available: true })]));
    // claude's history is indexed: the routine state says nothing
    expect(historyState(host)).toBeNull();
    expect(providerSelect(host).hasAttribute("aria-describedby")).toBe(false);

    await choose(providerSelect(host), "pi");
    const state = historyState(host);
    expect(state?.textContent).toBe("history not indexed");
    expect(providerSelect(host).getAttribute("aria-describedby")).toBe(state?.id);
    // a state, not a control: it sits in the bar beside the picker, and a
    // preview row still offers its new session
    expect(state?.closest(".vf-godview-header")).not.toBeNull();
    expect(spawnButton(host)).not.toBeNull();
  });

  it("names the history as unavailable when the index cannot be asked for the agent", async () => {
    const host = await mountPicker(fakeDoor([row(CLAUDE, { history: "unavailable" })]));
    expect(historyState(host)?.textContent).toBe("history unavailable");
  });

  it("asks the door again when it says the index moved: the history state and the persona list follow the daemon, and the choice made survives", async () => {
    // the review's finding: providers() was asked once per door, and the
    // history state and the persona list are live daemon facts
    let listener: (() => void) | null = null;
    let answer: readonly AgentProviderSummary[] = [
      row(CLAUDE, { history: "unavailable", personas: [] }),
      row(PI, { available: true }),
    ];
    const door: FakeDoor = {
      ...fakeDoor([]),
      providers: vi.fn(async () => answer),
      indexChanges: vi.fn((fn: () => void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      }),
    };
    const host = await mountPicker(door);
    expect(door.providers).toHaveBeenCalledTimes(1);
    expect(historyState(host)?.textContent).toBe("history unavailable");
    expect(personaSelect(host)).toBeNull();
    // the user picks pi meanwhile…
    await choose(providerSelect(host), "pi");
    // …the daemon comes up: claude's history is indexed and its persona is back
    answer = [CLAUDE, row(PI, { available: true })];
    await act(async () => {
      listener?.();
    });
    expect(door.providers).toHaveBeenCalledTimes(2);
    expect(providerSelect(host).value).toBe("pi"); // the choice survives
    await choose(providerSelect(host), "claude");
    expect(historyState(host)).toBeNull();
    expect(personaSelect(host)).not.toBeNull();
    // the dispose reaches the door's subscription when the deck goes
    act(() => root?.unmount());
    root = null;
    expect(listener).toBeNull();
  });

  it("carries a newer daemon's unknown status on the stage — its own word, no SPAWN, the gesture refused", async () => {
    const door = fakeDoor([
      CLAUDE,
      newer(row(PI, { available: true }), { status: "experimental" }),
    ]);
    const host = await mountPicker(door);
    expect(optionTexts(host)).toEqual(["Claude Code", "Pi · Experimental"]);
    await choose(providerSelect(host), "pi");
    expect(spawnButton(host)).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(door.spawn).not.toHaveBeenCalled();
    expect(ackText(host)).toBe("Pi is experimental — it starts no new sessions");
  });

  it("tells a harness what the picker draws, on the stage's own marker", async () => {
    // The smoke reads the stage through GODVIEW_MONITOR rather than a
    // screenshot; the picker's facts ride the same line, and they are the
    // DRAWN facts — the same rows, words and verbs the bar shows.
    const host = await mountPicker(fakeDoor([CLAUDE, PI, DEPRECATED]));
    expect(latestPicker()).toEqual({
      rows: [
        { id: "claude", badge: null },
        { id: "pi", badge: "Preview" },
        { id: "hermes", badge: "Deprecated" },
      ],
      selected: "claude",
      spawn: true,
      history: null,
      personas: 2,
    });
    await choose(providerSelect(host), "pi");
    expect(latestPicker()).toMatchObject({
      selected: "pi",
      spawn: true,
      history: "history not indexed",
      personas: 0,
    });
    await choose(providerSelect(host), "hermes");
    expect(latestPicker()).toMatchObject({ selected: "hermes", spawn: false, personas: 0 });
  });

  it("marks a daemon before AC-3 on the marker as it draws it: rows without a single badge", async () => {
    await mountPicker(fakeDoor([undecided(CLAUDE), undecided(PI)]));
    expect(latestPicker()).toEqual({
      rows: [
        { id: "claude", badge: null },
        { id: "pi", badge: null },
      ],
      selected: "claude",
      spawn: true,
      history: null,
      personas: 0,
    });
  });
});

describe("the picker's stylesheet (godview.css)", () => {
  const godview = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "godview", "godview.css"),
    "utf8",
  );

  it("wears the deck's ONE degraded rule for the history state — reused, never a second reading", () => {
    // The same selector list as GT-5c's unavailable chip, so the state and the
    // mesh's degraded sentence cannot drift apart in weight or hue.
    const rule = godview.match(
      /^\.vf-monitor-remote-unavailable-chip,\n\.vf-godview-provider-history \{([^}]*)\}/m,
    )?.[1];
    expect(rule, "the history state is not on the unavailable chip's rule").toBeDefined();
    expect(rule).toContain("color: var(--text-faint)");
    // no §2.5 hue and no literal colour: an unindexed agent has not failed
    expect(rule).not.toMatch(/--vf-(?:orange|red|green)|#[\da-f]{3,8}\b/i);
    // …and that shared list is the class's ONLY appearance: no rule of its own
    // anywhere later in the sheet quietly re-styles the state
    expect(godview.match(/\.vf-godview-provider-history\b/g)).toHaveLength(1);
  });

  it("marks the pickers no-drag, so a click inside the bar's drag region reaches them", () => {
    // The bar drags the window (`bar.css`), and every control the package draws
    // is `no-drag`; VibeField's selects ride its trailing slot with no wrapper,
    // so their own class must say it.
    const rule = godview.match(/^\.vf-godview-bar-select \{([^}]*)\}/m)?.[1] ?? "";
    expect(rule).toContain("-webkit-app-region: no-drag");
  });
});
