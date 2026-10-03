import { describe, expect, it } from "vitest";
import { logoMobiusPhase, logoViewTilt } from "../../design-kit/src/logo/motion";
import { DEFAULT_LOGO, normalizeLogo } from "../../design-kit/src/logo/parameters";

describe("continuous Möbius motion", () => {
  it("keeps the viewing angle readable even for deep, low loops", () => {
    for (const height of [0.18, 0.38, 0.65]) {
      for (const depth of [0, 0.22, 0.6]) {
        for (const rollAngle of [-30, 0, 30]) {
          const p = normalizeLogo({
            height,
            depth,
            rollAngle,
            asymmetry: 0.3,
            roundness: 0.8,
          });
          const angle = logoViewTilt(p);
          const displacement = Math.abs(p.depth * Math.tan(angle));
          const smallerLobe = (p.height * (1 - Math.abs(p.asymmetry))) / (1 + p.roundness);
          expect(Math.abs(angle)).toBeLessThan((40 * Math.PI) / 180);
          expect(displacement).toBeLessThan(smallerLobe * 0.61);
        }
      }
    }
  });

  it("circulates at constant speed through the former reversal point", () => {
    const p = { ...DEFAULT_LOGO, rollSpeed: 1 };
    for (const time of [1, 2, 3, 4, 5])
      expect(logoMobiusPhase(p, time) - logoMobiusPhase(p, time - 1)).toBeCloseTo(1, 10);
    expect(logoMobiusPhase(p, Math.PI * 2)).toBeCloseTo(logoMobiusPhase(p, 0), 10);
  });

  it("supports holding the twist and reversing circulation", () => {
    const still = { ...DEFAULT_LOGO, rollSpeed: 0 };
    expect(logoMobiusPhase(still, 30)).toBe(logoMobiusPhase(still, 0));
    expect(logoMobiusPhase({ ...DEFAULT_LOGO, rollSpeed: -DEFAULT_LOGO.rollSpeed }, 1)).toBeCloseTo(
      2 * Math.PI - logoMobiusPhase(DEFAULT_LOGO, 1),
      10,
    );
  });

  it("keeps phase small for GPU precision during long sessions", () => {
    const p = { ...DEFAULT_LOGO, rollSpeed: 2 };
    const time = 60 * 60 * 24;
    const phase = logoMobiusPhase(p, time);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(2 * Math.PI);
    expect(logoMobiusPhase(p, time + Math.PI)).toBeCloseTo(phase, 9);
  });
});
