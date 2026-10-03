import { type CSSProperties, createElement, type ReactElement, type SVGProps } from "react";
import { FIELD_MARKS, type FieldIconName } from "./data";

export { FIELD_ICON_NAMES, FIELD_MARKS, type FieldIconFamily, type FieldIconName } from "./data";
export { type FieldIconFinish, fieldIconSvg } from "./svg";

import type { FieldIconFinish } from "./svg";

export type FieldIconProps = Omit<
  SVGProps<SVGSVGElement>,
  | "children"
  | "dangerouslySetInnerHTML"
  | "viewBox"
  | "width"
  | "height"
  | "fill"
  | "stroke"
  | "strokeWidth"
  | "role"
  | "aria-label"
  | "aria-labelledby"
  | "aria-hidden"
> & {
  name: FieldIconName;
  size?: number;
  /** Sticker adds opaque white backing and the die-cut keyline. */
  finish?: FieldIconFinish;
  /** Decorative inside a labelled control; label independent images. */
  label?: string;
};

/** Original two-ink drawings. No runtime, account, provider, or canvas dependencies. */
export function FieldIcon({
  name,
  size,
  finish = "artwork",
  label,
  style,
  ...props
}: FieldIconProps): ReactElement {
  const mark = FIELD_MARKS[name];
  const box =
    size ??
    (mark.family === "Brand"
      ? 64
      : mark.family === "Identity" || mark.family === "Agents"
        ? 48
        : mark.family === "Workspace"
          ? 32
          : mark.family === "States"
            ? 28
            : 24);
  const sticker = finish === "sticker";
  const appearance: CSSProperties = sticker
    ? ({
        color: "var(--vf-sticker-ink, #171815)",
        "--vf-sticker-paper": "#fff",
        ...style,
      } as CSSProperties)
    : (style ?? {});
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width={box}
      height={box}
      viewBox={`0 0 ${mark.grid} ${mark.grid}`}
      fill="currentColor"
      stroke="none"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={appearance}
      data-field-icon={name}
      data-finish={finish}
    >
      {sticker && (
        <g>
          {mark.shapes.map((shape, index) =>
            createElement(shape.tag, {
              ...shape.attrs,
              fill: "#fff",
              stroke: "#fff",
              strokeWidth: mark.grid * 0.072,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              key: index,
            }),
          )}
        </g>
      )}
      {mark.shapes.map((shape, index) => createElement(shape.tag, { ...shape.attrs, key: index }))}
    </svg>
  );
}
