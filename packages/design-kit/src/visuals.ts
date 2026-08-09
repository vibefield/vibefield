export interface GradientStop {
  /** 0..1 along the 135° diagonal (top-left → bottom-right). */
  readonly offset: number;
  readonly color: string;
}

/** The shared card gradient as CSS, usable without loading the runtime chrome. */
export const gradientCss = (stops: readonly GradientStop[]): string =>
  `linear-gradient(135deg, ${stops.map((stop) => `${stop.color} ${(stop.offset * 100).toFixed(0)}%`).join(", ")})`;
