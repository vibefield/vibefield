/**
 * Track FG — the Setup Assistant's steps (FG-D22 A, FG-D23 A; DESIGN.md §8 "The Setup Assistant's glass"). The band
 * along the glass's top is order.ts's own: each pane names the step it stands in (`STEP_OF`), and a variant's chapter
 * is its walk through `nextPane` (`stepsOf`), so no second list can drift from the order TS and AO keep. These rows
 * hold the map to the walk: every pane the wizard can show has its step in its chapter's band, or stands in none, and
 * no step is left with no pane to stand in it.
 */
import { describe, expect, it } from "vitest";
import {
  entryAfterName,
  nextPane,
  type Pane,
  type SetupVariant,
  STEP_OF,
  stepsOf,
  topOf,
  type WizardStep,
} from "../src/boot/onboarding/order";

const VARIANTS: readonly SetupVariant[] = ["fresh", "second-user", "migrated"];

/** Every pane a variant's wizard can show: its top, every resume `entryAfterName` gives, everything `nextPane` reaches
 * from those, and the chooser a second user's Back opens. */
function reachable(variant: SetupVariant): Set<Pane> {
  const seen = new Set<Pane>();
  const queue: Pane[] = [topOf(variant)];
  for (const linked of [false, true]) {
    for (const agentsAnswered of [false, true]) {
      for (const profilesAnswered of [false, true]) {
        for (const historyAnswered of [false, true]) {
          queue.push(
            entryAfterName(variant, { linked, agentsAnswered, profilesAnswered, historyAnswered }),
          );
        }
      }
    }
  }
  if (variant === "second-user") queue.push("users");
  for (let pane = queue.shift(); pane !== undefined; pane = queue.shift()) {
    if (seen.has(pane)) continue;
    seen.add(pane);
    if (pane !== "setting-up" && pane !== "users") queue.push(nextPane(pane, { variant }));
  }
  return seen;
}

describe("the Setup Assistant's steps (FG-D22 A)", () => {
  it("walks each chapter in order.ts's order: You · Agents · Profiles · History · Devices · Setting up", () => {
    const whole: WizardStep[] = ["you", "agents", "profiles", "history", "devices", "setting-up"];
    expect(stepsOf("fresh")).toEqual(whole);
    // a second user starts AT the name pane, with no welcome, and walks the same chapter
    expect(stepsOf("second-user")).toEqual(whole);
    // a migrated field is asked its name, then set up (spec §6, migration)
    expect(stepsOf("migrated")).toEqual(["you", "setting-up"]);
  });

  it("stands every pane in a step, but the welcomes and the chooser, where the band is absent", () => {
    const none = Object.entries(STEP_OF)
      .filter(([, step]) => step === null)
      .map(([pane]) => pane);
    expect(none).toEqual(["welcome", "welcome-back", "users"]);
  });

  it("puts every pane a variant can show in that variant's band, or in none", () => {
    for (const variant of VARIANTS) {
      const band = stepsOf(variant);
      for (const pane of reachable(variant)) {
        const step = STEP_OF[pane];
        expect(step === null || band.includes(step), `${variant}: ${pane} → ${step}`).toBe(true);
      }
    }
  });

  it("maps no pane the wizard can never show, and orphans no step", () => {
    const shown = new Set(VARIANTS.flatMap((variant) => [...reachable(variant)]));
    expect([...shown].sort()).toEqual(Object.keys(STEP_OF).sort());
    const banded = new Set(VARIANTS.flatMap((variant) => stepsOf(variant)));
    for (const step of Object.values(STEP_OF)) {
      if (step !== null) expect(banded.has(step), step).toBe(true);
    }
  });
});
