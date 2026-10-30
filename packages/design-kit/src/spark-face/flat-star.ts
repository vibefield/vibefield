import type { SparkBody, SparkEyes, SparkPoint } from "./engine";

// The flat star (DESIGN.md §2.10): a face where the window has no WebGL2 — its own points and
// palette in SVG, on its disc when framed, two pill eyes, no glow. It is drawn from the same DNA as
// the star, so a face is the same face either way. Coordinates are the star's radii, y down, the
// star's centre at the origin.

export interface FlatStarEye {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FlatStarShape {
  /** the star's outline, an SVG path */
  readonly outline: string;
  readonly eyes: readonly [FlatStarEye, FlatStarEye];
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Where a point's tip is (the engine's own reckoning of a resting point: length, then bend). */
function tipOf([angle, length, , bend]: SparkPoint): readonly [number, number] {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const x = dx * length - dy * bend * length * length;
  const y = dy * length + dx * bend * length * length;
  return [x, -y];
}

function valleyOf(from: SparkPoint, to: SparkPoint, radius: number): readonly [number, number] {
  const ahead = to[0] > from[0] ? to[0] : to[0] + Math.PI * 2;
  const angle = (from[0] + ahead) / 2;
  return [Math.cos(angle) * radius, -Math.sin(angle) * radius];
}

/**
 * The star's outline: through each valley on the core, out to each tip. Each point is one curve
 * whose middle is the tip itself, so a hero point reaches as far as the star's does.
 */
export function flatStarOutline(body: SparkBody): string {
  const points = body.pts;
  const count = points.length;
  if (count < 2) return "";
  const valleyRadius = body.core + body.k / 2;
  const valleys = points.map((point, index) =>
    valleyOf(point, points[(index + 1) % count] as SparkPoint, valleyRadius),
  );
  const start = valleys[count - 1] as readonly [number, number];
  const steps = points.map((point, index) => {
    const before = valleys[(index + count - 1) % count] as readonly [number, number];
    const after = valleys[index] as readonly [number, number];
    const [tipX, tipY] = tipOf(point);
    const controlX = 2 * tipX - (before[0] + after[0]) / 2;
    const controlY = 2 * tipY - (before[1] + after[1]) / 2;
    return `Q${round(controlX)} ${round(controlY)} ${round(after[0])} ${round(after[1])}`;
  });
  return `M${round(start[0])} ${round(start[1])}${steps.join("")}Z`;
}

/** The two pill eyes, larger at the small sizes as the star's are (DESIGN.md §2.10). */
export function flatStarEyes(
  eyes: SparkEyes,
  faceScale: number,
): readonly [FlatStarEye, FlatStarEye] {
  const halfWidth = eyes.w * faceScale;
  const halfHeight = eyes.h * faceScale;
  const gap = Math.max(eyes.gap * (1 + (faceScale - 1) * 0.6), halfWidth * 2.35);
  const eye = (side: -1 | 1): FlatStarEye => ({
    x: round((side * gap) / 2 - halfWidth),
    y: round(-eyes.y - halfHeight),
    width: round(halfWidth * 2),
    height: round(halfHeight * 2),
  });
  return [eye(-1), eye(1)];
}

export function flatStar(body: SparkBody, eyes: SparkEyes, faceScale: number): FlatStarShape {
  return { outline: flatStarOutline(body), eyes: flatStarEyes(eyes, faceScale) };
}
