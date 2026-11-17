// @vitest-environment happy-dom
/**
 * Agent Profiles' catalog plate for a plan's tier (DESIGN.md §8 "A plan's tier";
 * docs/UI_SYSTEM.md's meaningful states): the SHIPPING page over Studio, a fixture profile whose
 * plans carry made-up tiers. A label is the badge after its card's title; a tier not read wears
 * the empty dashed capsule only beside a labelled card of its family; a plan whose agent says it
 * has none, or one alone in its family, draws nothing; and the plan's spoken name joins the
 * title and the label with a space.
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

async function mountPlate(): Promise<HTMLElement> {
  const element = document.createElement("div");
  document.body.append(element);
  host = element;
  const mounted = createRoot(element);
  root = mounted;
  await act(async () => {
    mounted.render(<ProfilesSettingsPreview state="plan tiers" onSubpage={() => undefined} />);
  });
  return element;
}

describe("Agent Profiles' catalog plate: a plan's tier", () => {
  it("is a state the catalog offers", () => {
    expect(PROFILES_FIXTURE_STATES).toContain("plan tiers");
  });

  it("draws each card's tier after its title: a badge, an empty capsule, or nothing", async () => {
    const page = await mountPlate();
    const card = (plan: string): HTMLElement | null =>
      page.querySelector<HTMLElement>(`.vf-profiles-plan[data-plan="${plan}"]`);
    const title = (plan: string): Element | null | undefined =>
      card(plan)?.querySelector("h4.vf-profiles-plan-title");
    const mark = (plan: string): Element | null | undefined =>
      title(plan)?.querySelector(".vf-plan-tier");

    // a label as given, after the title's words; the 8-character one whole (the cap is the eye's)
    for (const [plan, label] of [
      ["anthropic", "20x"],
      ["openai", "200"],
      ["xai", "Business"],
    ] as const) {
      expect(mark(plan)?.textContent, plan).toBe(label);
      expect(mark(plan)?.hasAttribute("data-unread"), plan).toBe(false);
      expect(mark(plan)?.getAttribute("aria-hidden"), plan).toBe("true");
      expect(title(plan)?.firstElementChild?.className, plan).toBe("vf-profiles-plan-title-words");
    }
    expect(card("openai")?.querySelector(".vf-profiles-plan-title-words")?.textContent).toBe(
      "ChatGPT Pro",
    );
    // ChatGPT Pro's second sign-in, not read, beside the family's "200": the empty capsule
    expect(mark("openai-2")?.hasAttribute("data-unread")).toBe(true);
    expect(mark("openai-2")?.textContent).toBe("");
    // Claude Max whose agent says it has none, beside "20x", and Copilot alone: nothing
    expect(title("anthropic-2")?.querySelector(".vf-plan-tier")).toBeNull();
    expect(title("github")?.querySelector(".vf-plan-tier")).toBeNull();
  });

  it("says the plan with its tier as one name, and the title alone with no badge", async () => {
    const page = await mountPlate();
    const lines = (plan: string): string | null | undefined =>
      page
        .querySelector(`.vf-profiles-plan[data-plan="${plan}"] .vf-profiles-usage[role="list"]`)
        ?.getAttribute("aria-label");
    expect(lines("openai")).toBe("ChatGPT Pro 200 usage");
    expect(lines("anthropic")).toBe("Claude Max 20x usage");
    expect(lines("openai-2")).toBe("ChatGPT Pro usage");
    expect(lines("anthropic-2")).toBe("Claude Max usage");
    // the card's heading reads the same name: the label once, after a space, the capsule never
    const heading = page.querySelector('.vf-profiles-plan[data-plan="openai"] h4');
    const read = [...(heading?.childNodes ?? [])]
      .filter((node) => !(node instanceof Element && node.getAttribute("aria-hidden") === "true"))
      .map((node) => node.textContent)
      .join("");
    expect(read).toBe("ChatGPT Pro 200");
  });
});
