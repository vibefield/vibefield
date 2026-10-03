import { createElement, type ReactElement, type SVGProps } from "react";
import type { FaceStickerId, FaceStickerOptical } from "./data";
import { type FaceStickerFinish, faceStickerGeometry, faceStickerOptical } from "./svg";

export {
  FACE_STICKER_IDS,
  FACE_STICKERS,
  type FaceStickerDrawing,
  type FaceStickerGroup,
  type FaceStickerId,
  type FaceStickerOptical,
} from "./data";
export {
  FACE_STICKER_DETAIL_AT,
  type FaceStickerFinish,
  faceStickerOptical,
  faceStickerSvg,
  findFaceSticker,
} from "./svg";

export type FaceStickerProps = Omit<
  SVGProps<SVGSVGElement>,
  | "children"
  | "dangerouslySetInnerHTML"
  | "viewBox"
  | "width"
  | "height"
  | "fill"
  | "stroke"
  | "role"
  | "aria-label"
  | "aria-labelledby"
  | "aria-hidden"
> & {
  name: FaceStickerId;
  size?: number;
  optical?: FaceStickerOptical | "auto";
  finish?: FaceStickerFinish;
  /** Omit in an already named control; supply for a standalone meaningful image. */
  label?: string;
};

/** Proposed account artwork. Framing and account policy remain with the existing face layer. */
export function FaceSticker({
  name,
  size = 48,
  optical = "auto",
  finish = "sticker",
  label,
  ...props
}: FaceStickerProps): ReactElement {
  const master = optical === "auto" ? faceStickerOptical(size) : optical;
  const { shapes, grid, edge } = faceStickerGeometry(name, master);
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      fill="currentColor"
      color="#171815"
      stroke="none"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-face-sticker={name}
      data-optical={master}
      data-finish={finish}
    >
      {finish === "sticker" && (
        <g>
          {shapes.map((shape, index) =>
            createElement(shape.tag, {
              ...shape.attrs,
              fill: "#fff",
              stroke: "#fff",
              strokeWidth: edge,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              key: index,
            }),
          )}
        </g>
      )}
      <g>
        {shapes.map((shape, index) => createElement(shape.tag, { ...shape.attrs, key: index }))}
      </g>
    </svg>
  );
}
