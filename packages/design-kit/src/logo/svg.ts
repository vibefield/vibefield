import { type LogoParameters, normalizeLogo } from "./parameters";

/** A flat, editable outline of the shader's curve at t=0, including taper and crossing order. */
export function logoSvg(input: LogoParameters, background = false): string {
  const p = normalizeLogo(input);
  const angle = (p.rotation * Math.PI) / 180;
  const curve = (t: number): [number, number] => {
    const c = Math.cos(t),
      s = Math.sin(t);
    const x = (p.width * c) / (1 + p.roundness * s * s);
    const y = (p.height * Math.sin(2 * t) * (1 + p.asymmetry * c)) / (1 + p.roundness * s * s);
    return [
      (x * Math.cos(angle) - y * Math.sin(angle)) * p.scale,
      (x * Math.sin(angle) + y * Math.cos(angle)) * p.scale,
    ];
  };
  const contour = (start: number, end: number): string => {
    const sides: string[][] = [[], []];
    for (let i = 0; i <= 256; i++) {
      const t = start + ((end - start) * i) / 256;
      const [x, y] = curve(t);
      const a = curve(t - 0.001),
        b = curve(t + 0.001);
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      const w = p.thickness * p.scale * (1 + p.taper * Math.sin(t + 0.7));
      for (let side = 0; side < 2; side++) {
        const direction = side * 2 - 1;
        sides[side]!.push(
          `${(500 + (x - (dy / length) * w * direction) * 390).toFixed(3)},${(500 + (y + (dx / length) * w * direction) * 390).toFixed(3)}`,
        );
      }
    }
    return `M${sides[0]!.join("L")}L${sides[1]!.reverse().join("L")}Z`;
  };
  // Two half strips preserve the GPU triangle strip's painter order at the crossing.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" fill="${p.ink}"><title>VibeField — living mark</title>${background ? `<path fill="${p.background}" d="M0 0h1000v1000H0z"/>` : ""}<path d="${contour(0, Math.PI)}"/><path d="${contour(Math.PI, Math.PI * 2)}"/></svg>`;
}
