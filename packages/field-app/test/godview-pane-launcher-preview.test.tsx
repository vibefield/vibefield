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

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaneLauncherPreview } from "../src/design-system/PaneLauncherPreview";

function render(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<PaneLauncherPreview />);
  return host;
}

const specimen = (host: HTMLElement, id: string): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(`[data-vf-pane-launcher="catalog-${id}"]`),
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
      "launching",
      "narrow",
      "short",
    ]) {
      expect(specimen(host, id), id).toHaveLength(2);
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
    expect(
      specimen(host, "launching")[0]?.querySelector(".vf-pane-launcher-agent.is-press"),
    ).not.toBeNull();
    expect(specimen(host, "short")[0]?.querySelector(".vf-pane-launcher.is-short")).not.toBeNull();
  });
});
