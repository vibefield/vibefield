import type { LogoParameters } from "./parameters";

/** A fixed viewing angle that leaves both lobes visible while the ribbon twists locally. */
export function logoViewTilt(p: LogoParameters): number {
  const radians = Math.PI / 180;
  // Bound depth's projected displacement relative to the height of the smaller lobe.
  // A deep, low ribbon needs a shallower arc to keep its crossing in view.
  const limit = Math.min(
    40 * radians,
    Math.atan(
      (0.6 * p.height * (1 - Math.abs(p.asymmetry))) /
        ((1 + p.roundness) * Math.max(p.depth, 0.0001)),
    ),
  );
  return limit * Math.tanh((p.rollAngle * radians) / limit);
}

/** Constant-speed circulation, wrapped before uploading to f32 GPU uniforms. */
export function logoMobiusPhase(p: LogoParameters, time: number): number {
  const turn = Math.PI * 2;
  return (((time * p.rollSpeed) % turn) + turn) % turn;
}
