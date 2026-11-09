// @vitest-environment happy-dom
/**
 * Agent Profiles' catalog plate for a window read before its reset (docs/UI_SYSTEM.md's meaningful states; DESIGN.md
 * §8): the SHIPPING page over a fixture reading three hours old, whose five hours reset ten minutes ago. It says the
 * reading's age where the reset stood, unlit, and the running week keeps its reset.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProfilesSettingsPreview } from "../src/design-system/ProfilesSettingsPreview";
import { PROFILES_FIXTURE_STATES } from "../src/design-system/profiles-fixtures";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("Agent Profiles' catalog plate: a window read before its reset", () => {
  it("is a state the catalog offers", () => {
    expect(PROFILES_FIXTURE_STATES).toContain("read before reset");
  });

  it("says the reading's age where the five hours' reset stood, unlit, and the week keeps its reset", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const mounted = createRoot(host);
    root = mounted;
    await act(async () => {
      mounted.render(
        <ProfilesSettingsPreview state="read before reset" onSubpage={() => undefined} />,
      );
    });

    const card = host.querySelector<HTMLElement>('.vf-profiles-plan[data-plan="anthropic"]');
    const lines = [...(card?.querySelectorAll<HTMLElement>(".vf-profiles-usage-line") ?? [])];
    const said = (lead: string) =>
      lines.find((line) => line.getAttribute("aria-label")?.startsWith(lead));

    const fiveHours = said("5H:");
    expect(fiveHours?.getAttribute("aria-label")).toBe("5H: 100% used, as of 3h ago");
    expect(fiveHours?.querySelector(".vf-profiles-usage-reset")?.textContent).toBe("as of 3h ago");
    // the age is not a reset: no reset mark before it, and the line is unlit
    expect(fiveHours?.querySelector(".vf-profiles-reset")).toBeNull();
    expect(fiveHours?.classList.contains("is-hot")).toBe(false);

    expect(said("7D:")?.getAttribute("aria-label")).toContain("38% used, resets");
  });
});
