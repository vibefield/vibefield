// @vitest-environment happy-dom
/**
 * THE LAUNCHER'S CATALOG SPECIMEN (QL-1, pass 3 §19), rendered.
 *
 * The specimen mounts the SHIPPING chrome over fixture door answers
 * (`ui-system-boundaries` holds it to that); this file holds it to showing
 * every face §19 names, on both grounds, so a state the model stops producing
 * — or a fixture that stops reaching it — is red here rather than a blank
 * card in the catalog.
 */

import { type LauncherPort, PaneLauncher } from "@vibecook/puppeteer-views/launcher";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaneLauncherPreview } from "../src/design-system/PaneLauncherPreview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<PaneLauncherPreview />);
  return host;
}

const specimen = (host: HTMLElement, id: string): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(`[data-vf-pane-launcher="catalog-${id}"]`),
];

const launchSpecimen = (host: HTMLElement, id: string): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(`[data-vf-pane-launch="catalog-${id}"]`),
];

describe("the empty pane launcher's catalog specimen", () => {
  it("shows every §19 face on both grounds, with the host's ground token set", () => {
    const host = render();
    for (const id of [
      "rest",
      "hover",
      "cant-launch",
      "resting",
      "focus",
      "typed-here",
      "typed-all",
      "no-match",
      "catching-up",
      "not-answering",
      "narrow",
      "short",
    ]) {
      expect(specimen(host, id), id).toHaveLength(2);
    }
    for (const id of ["launch-starting", "launch-opening"]) {
      expect(launchSpecimen(host, id), id).toHaveLength(2);
    }
    const decks = [...host.querySelectorAll<HTMLElement>(".vf-ds-pane-frame-deck")];
    expect(decks).toHaveLength(2);
    for (const deck of decks) {
      expect(deck.style.getPropertyValue("--vf-pane-launcher-ground")).not.toBe("");
      expect(deck.style.getPropertyValue("--vf-godview-terminal-ink")).not.toBe("");
    }
  });

  it("reaches each state through the shipping model, not by hand", () => {
    const host = render();
    const [rest] = specimen(host, "rest");
    // ten agents at most, the catalog's rows through the shipping projection
    expect(rest?.querySelectorAll(".vf-pane-launcher-agent").length).toBe(10);
    expect(
      specimen(host, "hover")[0]?.querySelector(".vf-pane-launcher-preview")?.textContent,
    ).toMatch(/ · its defaults$/);
    const cant = specimen(host, "cant-launch")[0];
    expect(cant?.querySelector(".vf-pane-launcher-agent.is-off small")?.textContent).toBe(
      "not installed",
    );
    expect(cant?.querySelector(".vf-pane-launcher-failure")?.textContent).toMatch(
      /can’t launch: not installed$/,
    );
    expect(
      specimen(host, "resting")[0]?.querySelector(".vf-pane-launcher.is-resting"),
    ).not.toBeNull();
    expect(specimen(host, "resting")[0]?.querySelector(".vf-pane-launcher-agent")).toBeNull();

    const focus = specimen(host, "focus")[0];
    expect(focus?.querySelector(".vf-pane-launcher-grp")?.textContent).toBe("Latest in puppeteer");
    expect(focus?.querySelector(".vf-pane-launcher-row.is-cur")).not.toBeNull();

    const typed = specimen(host, "typed-here")[0];
    expect(typed?.querySelector(".vf-pane-launcher-row mark")?.textContent?.toLowerCase()).toBe(
      "ledger",
    );
    expect(typed?.querySelector(".vf-pane-launcher-ev")).not.toBeNull();

    const all = specimen(host, "typed-all")[0];
    expect(
      [...(all?.querySelectorAll(".vf-pane-launcher-grp") ?? [])].map((g) => g.textContent),
    ).toEqual(["In puppeteer", "Elsewhere"]);
    expect(all?.querySelector(".vf-pane-launcher-row.is-gone")?.textContent).toContain(
      "folder is gone",
    );

    expect(
      specimen(host, "no-match")[0]?.querySelector(".vf-pane-launcher-empty")?.textContent,
    ).toContain("zeppelin");
    expect(
      specimen(host, "catching-up")[0]?.querySelector(".vf-pane-launcher-status")?.textContent,
    ).toBe("History is catching up · 1,204 of 3,880 sessions read");
    expect(
      specimen(host, "not-answering")[0]?.querySelector(".vf-pane-launcher-empty")?.textContent,
    ).toContain("isn’t answering");
    // QL-2: the launch's faces are the shipping chrome at a moment of the wait.
    const starting = launchSpecimen(host, "launch-starting")[0];
    expect(starting?.className).toBe("vf-pane-launch is-starting is-lit is-waiting");
    expect(starting?.querySelector(".vf-pane-launch-caption span")?.textContent).toBe(
      "starting · 2.4s",
    );
    expect(
      starting?.querySelector(".vf-pane-launch-mark svg, .vf-pane-launch-mark span"),
    ).not.toBeNull();
    const opening = launchSpecimen(host, "launch-opening")[0];
    expect(opening?.className).toBe("vf-pane-launch is-opening is-lit is-waiting");
    expect(opening?.querySelector(".vf-pane-launch-caption span")?.textContent).toBe(
      "opening · 3.1s",
    );
    expect(specimen(host, "short")[0]?.querySelector(".vf-pane-launcher.is-short")).not.toBeNull();
  });

  it("says can't-launch in the SHIPPING launcher's own words — the real component, clicked, is the source", async () => {
    // The catalog's face is static markup built with the launcher's own
    // `cantLaunchLine`; this holds it to what the COMPONENT says on a click:
    // the real launcher, mounted in a pane and its unavailable agent clicked,
    // must say the same sentence with the same label and reason.
    const [cant] = specimen(render(), "cant-launch");
    const off = cant?.querySelector(".vf-pane-launcher-agent.is-off");
    const label = off?.querySelector(".vf-pane-launcher-nm")?.textContent ?? "";
    const reason = off?.querySelector("small")?.textContent ?? "";
    const catalogSays = cant?.querySelector(".vf-pane-launcher-failure")?.textContent;
    expect(label).not.toBe("");

    const pane = document.createElement("div");
    document.body.append(pane);
    const root = createRoot(document.createElement("div"));
    const onLaunch = vi.fn();
    const port: LauncherPort = {
      recent: vi.fn(async () => ({ status: { readiness: "ready" as const }, sessions: [] })),
      launch: vi.fn(async () => ({ accepted: true as const })),
      resume: vi.fn(async () => ({ accepted: true as const })),
    };
    await act(async () => {
      root.render(
        <PaneLauncher
          pane={pane}
          paneId="pane-1"
          sessionId="shell-1"
          active
          agents={[{ providerId: "catalog-agent", label, unavailable: reason }]}
          port={port}
          scope="here"
          onScopeChange={() => undefined}
          onUsed={() => undefined}
          onLaunch={onLaunch}
          register={() => undefined}
        />,
      );
    });
    await act(async () => {
      pane.querySelector<HTMLButtonElement>(".vf-pane-launcher-agent")?.click();
    });
    const componentSays = pane.querySelector(".vf-pane-launcher-failure")?.textContent;
    act(() => root.unmount());
    pane.remove();
    expect(componentSays).toBeDefined();
    expect(catalogSays).toBe(componentSays);
    expect(port.launch).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
