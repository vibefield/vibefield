// @vitest-environment happy-dom

// VT-4b (track VT, 2026-11-24; DESIGN.md §8 "Vitals", Incidents; §9 "Vitals' words") — the window's incidents: their
// words, the feed that folds them, and the view's button, list, marks and opened line. The readings are the
// catalog's own fixture, so the plate a person looks at and the rows below are one page.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VitalsPlate } from "../src/design-system/VitalsPreview";
import {
  VITALS_FIXTURE_OLD_INCIDENT,
  vitalsFixtureIncidents,
  vitalsFixtureLogs,
  vitalsFixtureModel,
  vitalsFixtureOff,
  vitalsFixtureSnapshot,
} from "../src/design-system/vitals-fixtures";
import { VitalsView } from "../src/vitals/VitalsView";
import { EMPTY_FEED, reduceFeed } from "../src/vitals/vitals-feed";
import {
  EMPTY_INCIDENTS,
  INCIDENT_WORDS,
  incidentCountWords,
  incidentLineWords,
  incidentTone,
  incidentWhatWords,
  incidentWhenWords,
  type VitalsIncidentSummaryV1,
  withIncidentList,
  withIncidentWhole,
} from "../src/vitals/vitals-incidents";
import { clockWords } from "../src/vitals/vitals-words";

const here = dirname(fileURLToPath(import.meta.url));
const design = (): string =>
  readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");

const summary = (over: Partial<VitalsIncidentSummaryV1>): VitalsIncidentSummaryV1 => ({
  id: "mwtxk4b4-0a1b2c3d",
  kind: "exit",
  at: 1_795_478_530_000,
  subject: { group: "fieldd", role: "rosettad", pid: 4244 },
  complete: true,
  ...over,
});

describe("VT-4b — the words, as DESIGN.md says them", () => {
  it("says each kind in one phrase, then how where it was said", () => {
    const said = [
      incidentWhatWords(
        summary({
          kind: "crash",
          detail: { errorName: "TypeError", message: "x is not a function" },
        }),
      ),
      incidentWhatWords(summary({ kind: "exit", detail: { code: 1 } })),
      incidentWhatWords(summary({ kind: "exit", detail: { signal: "SIGKILL" } })),
      incidentWhatWords(summary({ kind: "exit", detail: { reason: "crashed", code: 11 } })),
      incidentWhatWords(summary({ kind: "exit", detail: { reason: "oom" } })),
      incidentWhatWords(summary({ kind: "error", detail: { errorName: "TypeError" } })),
      incidentWhatWords(summary({ kind: "unresponsive" })),
      incidentWhatWords(summary({ kind: "unresponsive", endedAt: 1_795_478_534_200 })),
      incidentWhatWords(summary({ kind: "loop-held", endedAt: 1_795_478_536_000 })),
      incidentWhatWords(summary({ kind: "budget-broken" })),
    ];
    expect(said).toEqual([
      "ended on an error nobody caught · TypeError: x is not a function",
      "exited unexpectedly · code 1",
      "exited unexpectedly · SIGKILL",
      "exited unexpectedly · crashed",
      "exited unexpectedly · oom",
      "met an error nobody caught · TypeError",
      "stopped responding",
      "stopped responding · for 4.2 s",
      "held its loop near 100% · for 6 s",
      "had an incident",
    ]);
    const doc = design();
    for (const phrase of [
      '"ended on an error nobody caught"',
      '"· TypeError: x is not a function"',
      '"exited unexpectedly"',
      '"· code 1"',
      '"· SIGKILL"',
      '"· crashed"',
      '"· oom"',
      '"met an error nobody caught"',
      '"stopped responding"',
      '"· for 4.2 s"',
      '"held its loop near 100%"',
      '"· for 6 s"',
      '"had an incident"',
    ])
      expect(doc, phrase).toContain(phrase);
  });

  it("says the button, the moment and the line in DESIGN.md's words", () => {
    const doc = design();
    expect(incidentCountWords(1)).toBe("1 incident");
    expect(incidentCountWords(3)).toBe("3 incidents");
    expect(doc).toContain('"1 incident" or "3 incidents"');
    const at = new Date(2026, 10, 22, 14, 2, 10).getTime();
    expect(incidentWhenWords(at)).toBe("22 Nov 14:02:10");
    expect(doc).toContain('"22 Nov 14:02:10"');
    expect(
      incidentLineWords(
        summary({
          kind: "unresponsive",
          endedAt: 1_795_478_534_200,
          subject: { group: "shell", role: "window" },
        }),
      ),
    ).toBe("Desk window stopped responding · for 4.2 s");
    expect(doc).toContain('"Desk window stopped responding · for 4.2 s"');
    expect(doc).toContain(`"${INCIDENT_WORDS.kept}"`);
  });

  it("gives a death or an error the failure's hue and a hang attention's, as §2.5 does", () => {
    expect(["crash", "exit", "error"].map(incidentTone)).toEqual(["failure", "failure", "failure"]);
    expect(["unresponsive", "loop-held", "unknown"].map(incidentTone)).toEqual([
      "attention",
      "attention",
      "attention",
    ]);
    const doc = design();
    expect(doc).toContain("`--vf-red` for a process that ended or an error nobody caught");
    expect(doc).toContain("`--vf-orange` for a page that stopped responding or a loop held");
    // the recorder's own state is still never orange or red
    expect(doc).toContain("Orange and red are never a state of Vitals itself.");
    expect(doc).toContain("never a state of Vitals itself. A mark takes no press");
  });
});

describe("VT-4b — the feed folds incidents", () => {
  it("lists the census's summaries from its snapshot and its deltas, and none from a fieldd before them", () => {
    const incidents = vitalsFixtureIncidents();
    let feed = reduceFeed(EMPTY_FEED, {
      kind: "vitals",
      event: "snapshot",
      payload: vitalsFixtureSnapshot(),
    });
    expect(feed.incidents.list).toEqual([]);
    feed = reduceFeed(feed, {
      kind: "vitals",
      event: "delta",
      payload: { incidents: incidents.list },
    });
    expect(feed.incidents.list.map((one) => one.kind)).toEqual([
      "loop-held",
      "unresponsive",
      "exit",
    ]);
    expect(feed.model.samples).toHaveLength(300);
    feed = reduceFeed(feed, {
      kind: "vitals",
      event: "snapshot",
      payload: { ...vitalsFixtureSnapshot(), incidents: incidents.list.slice(0, 1) },
    });
    expect(feed.incidents.list).toHaveLength(1);
  });

  it("keeps an incident main read whole, says one it could not, and drops a frame that does not parse", () => {
    const incidents = vitalsFixtureIncidents();
    const whole = incidents.wholes.get(VITALS_FIXTURE_OLD_INCIDENT);
    let feed = reduceFeed(EMPTY_FEED, {
      kind: "vitals",
      event: "delta",
      payload: { incidents: incidents.list },
    });
    feed = reduceFeed(feed, { kind: "incident", event: "snapshot", payload: whole });
    expect(feed.incidents.wholes.get(VITALS_FIXTURE_OLD_INCIDENT)?.samples).toHaveLength(61);
    feed = reduceFeed(feed, { kind: "incident", event: "snapshot", payload: { id: "nope" } });
    expect(feed.rejected).toBe(1);
    feed = reduceFeed(feed, { kind: "incident", event: "down", id: "mwtxk4b4-0a1b2c3d" });
    expect(feed.incidents.missing.has("mwtxk4b4-0a1b2c3d")).toBe(false); // not listed, so not kept
    feed = reduceFeed(feed, { kind: "incident", event: "down", id: "mwtxj0c0-77aa00ff" });
    expect(feed.incidents.missing.has("mwtxj0c0-77aa00ff")).toBe(true);
  });

  it("reads a whole again once its summary moved on, and forgets one no longer kept", () => {
    const incidents = vitalsFixtureIncidents();
    const whole = incidents.wholes.get(VITALS_FIXTURE_OLD_INCIDENT);
    let state = withIncidentWhole(withIncidentList(EMPTY_INCIDENTS, incidents.list), whole);
    expect(state?.wholes.size).toBe(1);
    const moved = incidents.list.map((one) =>
      one.id === VITALS_FIXTURE_OLD_INCIDENT ? { ...one, endedAt: one.at + 1_000 } : one,
    );
    state = withIncidentList(state ?? EMPTY_INCIDENTS, moved);
    expect(state.wholes.size).toBe(0);
    state = withIncidentWhole(state, whole);
    state = withIncidentList(state ?? EMPTY_INCIDENTS, []);
    expect(state.wholes.size).toBe(0);
  });
});

describe("VT-4b — the view", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (element: Parameters<Root["render"]>[0]): void => act(() => root.render(element));
  const text = (selector: string): string[] =>
    [...host.querySelectorAll(selector)].map((element) => element.textContent ?? "");
  const press = (element: Element | null | undefined): void =>
    act(() => {
      (element as HTMLElement | null)?.click();
    });
  const view = (props: Record<string, unknown> = {}) =>
    createElement(VitalsView, {
      model: vitalsFixtureModel(),
      logs: vitalsFixtureLogs(),
      incidents: vitalsFixtureIncidents(),
      ...props,
    });

  it("says how many are kept, marks the ones inside the lanes in their hue, and offers no empty list", () => {
    render(view());
    expect(text(".vf-vitals__incidents")).toEqual(["3 incidents"]);
    expect(host.querySelector(".vf-vitals__incidents")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    // the two inside the five minutes: a hairline and a band each, by hue; the old one is not on the lanes
    const tones = (selector: string) =>
      [...host.querySelectorAll(selector)].map((mark) => mark.getAttribute("data-tone"));
    expect(tones(".vf-vitals__incident-mark")).toEqual(["attention", "attention"]);
    expect(tones(".vf-vitals__incident-band")).toEqual(["attention", "attention"]);
    expect(host.querySelector(".vf-vitals__incident-list")).toBeNull();

    render(view({ incidents: EMPTY_INCIDENTS }));
    expect(host.querySelector(".vf-vitals__incidents")).toBeNull();
    expect(host.querySelector(".vf-vitals__incident-marks")).toBeNull();
  });

  it("opens the list, newest first, each with its dot, moment, who and what", () => {
    render(view());
    press(host.querySelector(".vf-vitals__incidents"));
    expect(text(".vf-vitals__incident-who")).toEqual(["fieldd", "Desk window", "rosettad"]);
    expect(text(".vf-vitals__incident-what")).toEqual([
      "held its loop near 100% · for 11 s",
      "stopped responding · for 4.2 s",
      "exited unexpectedly · code 101",
    ]);
    expect(
      [...host.querySelectorAll(".vf-vitals__incident-dot")].map((dot) =>
        dot.getAttribute("data-tone"),
      ),
    ).toEqual(["attention", "attention", "failure"]);
    // a second press closes it
    press(host.querySelector(".vf-vitals__incidents"));
    expect(host.querySelector(".vf-vitals__incident-list")).toBeNull();
  });

  it("holds the lanes at an opened incident's moment and says what happened; a second press lets go", () => {
    render(view());
    press(host.querySelector(".vf-vitals__incidents"));
    const desk = [...host.querySelectorAll(".vf-vitals__incident")][1];
    press(desk);
    const incident = vitalsFixtureIncidents().list[1] as VitalsIncidentSummaryV1;
    expect(desk?.getAttribute("aria-pressed")).toBe("true");
    expect(text(".vf-vitals__when")).toEqual([`At ${clockWords(incident.at)}`]);
    expect(host.querySelector(".vf-vitals__held")).not.toBeNull();
    expect(text(".vf-vitals__incident-line")).toEqual([
      "Desk window stopped responding · for 4.2 s",
    ]);
    press(desk);
    expect(text(".vf-vitals__when")).toEqual(["Now"]);
    expect(host.querySelector(".vf-vitals__incident-line")).toBeNull();
  });

  it("asks the host for an older one whole, once, and draws nothing of it until it comes", () => {
    const asked: string[] = [];
    const without = { ...vitalsFixtureIncidents(), wholes: new Map() };
    render(view({ incidents: without, onOpenIncident: (id: string) => asked.push(id) }));
    press(host.querySelector(".vf-vitals__incidents"));
    press([...host.querySelectorAll(".vf-vitals__incident")][2]);
    render(view({ incidents: without, onOpenIncident: (id: string) => asked.push(id) }));
    expect(asked).toEqual([VITALS_FIXTURE_OLD_INCIDENT]);
    // the lanes stay live, and the line says it
    expect(text(".vf-vitals__when")).toEqual(["Now"]);
    expect(text(".vf-vitals__incident-line")).toEqual(["rosettad exited unexpectedly · code 101"]);
  });

  it("draws an older one from the minute kept with it, and Escape returns the lanes to now", () => {
    render(view({ initialIncident: VITALS_FIXTURE_OLD_INCIDENT }));
    const old = vitalsFixtureIncidents().list[2] as VitalsIncidentSummaryV1;
    expect(text(".vf-vitals__when")).toEqual([`At ${clockWords(old.at)}`]);
    expect(text(".vf-vitals__incident-kept")).toEqual([` ${INCIDENT_WORDS.kept}`]);
    // its own minute: one tick at most, and the old incident's own mark on it
    expect(host.querySelectorAll(".vf-vitals__tick").length).toBeLessThanOrEqual(2);
    expect(
      [...host.querySelectorAll(".vf-vitals__incident-mark")].map((mark) =>
        mark.getAttribute("data-tone"),
      ),
    ).toEqual(["failure"]);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(text(".vf-vitals__when")).toEqual(["Now"]);
    expect(host.querySelector(".vf-vitals__incident-list")).toBeNull();
  });

  it("keeps the list while the recorder is off, and an opened one still draws its own minute", () => {
    render(
      view({ model: vitalsFixtureOff(), logs: [], initialIncident: VITALS_FIXTURE_OLD_INCIDENT }),
    );
    expect(text(".vf-vitals__incidents")).toEqual(["3 incidents"]);
    expect(text(".vf-vitals__incident-kept")).toEqual([` ${INCIDENT_WORDS.kept}`]);
    expect(host.querySelectorAll(".vf-vitals__row").length).toBeGreaterThan(0);
  });

  it("stands the catalog's incident plate on the shipping view", () => {
    render(createElement(VitalsPlate, { state: "incident" }));
    expect(
      host.querySelector(".vf-ds-vitals-plate[data-state='incident'] > .vf-vitals"),
    ).not.toBeNull();
    expect(text(".vf-vitals__incident")).toHaveLength(3);
    expect(text(".vf-vitals__incident-kept")).toHaveLength(1);
  });

  it("uses tokens alone, and its sheet names the two status hues and no others", () => {
    const sheet = readFileSync(join(here, "..", "src", "vitals", "vitals-incidents.css"), "utf8");
    expect(sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sheet).not.toMatch(/rgba?\(/);
    const hues = new Set(sheet.match(/--vf-(?:red|orange|green|yellow|cyan|select)\b/g));
    expect([...hues].sort()).toEqual(["--vf-orange", "--vf-red"]);
  });
});
