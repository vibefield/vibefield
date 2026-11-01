// The contrast of small words on what stands behind them, MEASURED from the window's own capture (DK-16's method,
// shared since FG-O2): the chip cut from the capture's pixels, its ground the glass or the floor the words stand on,
// its ink the glyphs' cores, and their WCAG 2 ratio. smoke:canvas reads a peer's chip on the lit mat by it
// (smoke-peers.ts), and smoke:first-run the Setup Assistant's small words over the field (smoke-first-run.ts).

/** WCAG relative luminance of an sRGB colour (0–255). */
export function luminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The contrast of two colours (WCAG 2), ≥ 1. */
export function contrast(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The chip's ink and ground as MEASURED from its captured pixels (BGRA, Electron's `toBitmap`): the ground is the median
 * of the half of the pixels nearest the chip's mean (the glass), the ink the mean of the 2 % farthest from the ground (the
 * glyphs' cores) — and their contrast.
 */
export function measureChip(bgra: Uint8Array): {
  ground: [number, number, number];
  ink: [number, number, number];
  ratio: number;
} {
  const px: [number, number, number][] = [];
  for (let i = 0; i + 3 < bgra.length; i += 4)
    px.push([bgra[i + 2] as number, bgra[i + 1] as number, bgra[i] as number]);
  const mean = [0, 1, 2].map(
    (c) => px.reduce((s, p) => s + (p[c] as number), 0) / Math.max(1, px.length),
  );
  const dist = (p: readonly number[], q: readonly number[]): number =>
    Math.hypot(
      (p[0] as number) - (q[0] as number),
      (p[1] as number) - (q[1] as number),
      (p[2] as number) - (q[2] as number),
    );
  const byMean = [...px].sort((p, q) => dist(p, mean) - dist(q, mean));
  const near = byMean.slice(0, Math.max(1, Math.floor(byMean.length / 2)));
  const median = (c: number): number => {
    const v = near.map((p) => p[c] as number).sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)] as number;
  };
  const ground: [number, number, number] = [median(0), median(1), median(2)];
  const far = [...px].sort((p, q) => dist(q, ground) - dist(p, ground));
  const core = far.slice(0, Math.max(1, Math.floor(far.length * 0.02)));
  const ink = [0, 1, 2].map((c) =>
    Math.round(core.reduce((s, p) => s + (p[c] as number), 0) / core.length),
  ) as [number, number, number];
  return { ground, ink, ratio: Math.round(contrast(ground, ink) * 10) / 10 };
}

/**
 * A box of a whole window's capture (BGRA, Electron's `toBitmap`) cut out as a BGRA of its own, for `measureChip`: the
 * window's size and the box in the same CSS px, the capture's scale read from its own pixel count (2 to the px on a
 * Retina screen), the box widened to whole pixels and kept inside the capture. Null when the box holds no pixel, or
 * the capture is not the window's size at one scale.
 */
export function cutChip(
  bgra: Uint8Array,
  view: { readonly width: number; readonly height: number },
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Uint8Array | null {
  const scale = Math.sqrt(bgra.length / 4 / (view.width * view.height));
  const w = Math.round(view.width * scale);
  const h = Math.round(view.height * scale);
  if (w * h * 4 !== bgra.length) return null;
  const x0 = Math.max(0, Math.floor(box.x * scale));
  const y0 = Math.max(0, Math.floor(box.y * scale));
  const x1 = Math.min(w, Math.ceil((box.x + box.width) * scale));
  const y1 = Math.min(h, Math.ceil((box.y + box.height) * scale));
  if (x1 <= x0 || y1 <= y0) return null;
  const chip = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
  for (let y = y0; y < y1; y += 1)
    chip.set(bgra.subarray((y * w + x0) * 4, (y * w + x1) * 4), (y - y0) * (x1 - x0) * 4);
  return chip;
}
