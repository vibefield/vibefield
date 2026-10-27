import type { ReactElement } from "react";

// Tailscale's logomark, kept exact (DESIGN.md §13, TS-D4). The geometry is the
// media kit's own (Tailscale_MediaKit_10-2025 → Tailscale_icon_blk_rgb.svg): a
// 169-unit box, nine dots of radius 18 at 30.5 · 84.5 · 138.5, the middle row
// and the bottom centre solid, the other five at 40%. It is drawn in its own
// ink (`--vf-tailscale-ink`: #1E1E1F on light, white on dark), never in one
// colour and never under the toolkit's 48 × 48 px floor. The default 56 puts
// the dots themselves at 48. It is a vendor mark, not a glyph: the glyph test
// allows this file its one inline SVG, as it allows the OS marks theirs.
// "Tailscale is a registered trademark of Tailscale Inc."

const AT = [30.5, 84.5, 138.5] as const;
/** The solid dots, as "column,row": the middle row and the bottom centre. */
const SOLID = new Set(["0,1", "1,1", "2,1", "1,2"]);

/** The Brand Toolkit's floor: the mark is never drawn smaller than this. */
export const TAILSCALE_MARK_MIN = 48;

export function TailscaleMark({
  size = 56,
  className,
}: {
  /** CSS pixels; anything under the toolkit's 48 is drawn at 48. */
  size?: number;
  className?: string;
}): ReactElement {
  const drawn = Math.max(size, TAILSCALE_MARK_MIN);
  return (
    <svg
      viewBox="0 0 169 169"
      width={drawn}
      height={drawn}
      role="img"
      aria-label="Tailscale"
      className={`vf-ts-mark${className !== undefined ? ` ${className}` : ""}`}
      fill="currentColor"
    >
      {AT.flatMap((cy, row) =>
        AT.map((cx, column) => (
          <circle
            key={`${column},${row}`}
            cx={cx}
            cy={cy}
            r={18}
            {...(SOLID.has(`${column},${row}`) ? {} : { fillOpacity: 0.4 })}
          />
        )),
      )}
    </svg>
  );
}
