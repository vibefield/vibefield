// DT-3c — canvas box → surface logical coordinates (LSF §10.2).
//
// The law this module exists to keep: input coordinates are CSS LOGICAL pixels
// in the surface's `logicalSize` space, mapped ONCE by the sender against the
// geometry of the frame the user is actually looking at, and NEVER re-scaled
// by raster size or visibleRect downstream. The double-scaling bug class the
// foundation regression-tests main-side gets its renderer-side witness here.
//
// Pure functions, no DOM types beyond structural facts — the view feeds them
// event offsets and the displayed frame's geometry; tests feed them numbers.

import type {
  LiveSurfaceGeometryV1,
  LiveSurfaceKeyModifiersV1,
  LiveSurfacePointerButtonV1,
} from "@vibefield/contracts";

export interface SurfaceViewBox {
  readonly width: number;
  readonly height: number;
}

export interface SurfaceViewPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Map an event offset inside the canvas element's CSS box to surface logical
 * coordinates, or null when the point misses the drawn content.
 *
 * The canvas bitmap is sized to the frame's visibleRect and fitted into the
 * element box with `object-fit: contain`, so the box can carry letterbox bars
 * the surface never painted. A click in a bar is a click on nothing: null,
 * not a clamp — clamping would teleport it onto the page's edge.
 */
export function mapPointerToLogical(
  box: SurfaceViewBox,
  offset: SurfaceViewPoint,
  geometry: LiveSurfaceGeometryV1,
): SurfaceViewPoint | null {
  const attrWidth = geometry.visibleRect.width;
  const attrHeight = geometry.visibleRect.height;
  if (box.width <= 0 || box.height <= 0 || attrWidth <= 0 || attrHeight <= 0) return null;

  // object-fit: contain — one uniform scale, centered content.
  const scale = Math.min(box.width / attrWidth, box.height / attrHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const contentWidth = attrWidth * scale;
  const contentHeight = attrHeight * scale;
  const padX = (box.width - contentWidth) / 2;
  const padY = (box.height - contentHeight) / 2;

  const contentX = offset.x - padX;
  const contentY = offset.y - padY;
  if (contentX < 0 || contentY < 0 || contentX > contentWidth || contentY > contentHeight) {
    return null;
  }

  // Canvas bitmap space is the frame's visibleRect cut of coded space; logical
  // space is proportional to CODED space (`logicalSize` describes the full
  // coded raster), so the visibleRect origin offsets before the ratio applies.
  const codedX = geometry.visibleRect.x + contentX / scale;
  const codedY = geometry.visibleRect.y + contentY / scale;
  const logicalX = codedX * (geometry.logicalSize.width / geometry.codedSize.width);
  const logicalY = codedY * (geometry.logicalSize.height / geometry.codedSize.height);

  return {
    x: Math.min(Math.max(logicalX, 0), geometry.logicalSize.width),
    y: Math.min(Math.max(logicalY, 0), geometry.logicalSize.height),
  };
}

/** DOM `MouseEvent.button` → the wire's button vocabulary; null for buttons
 * the lane does not carry (back/forward thumbs stay with the canvas). */
export function pointerButtonFromDom(button: number): LiveSurfacePointerButtonV1 | null {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return null;
}

export interface DomModifierFacts {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export function keyModifiersFromDom(event: DomModifierFacts): LiveSurfaceKeyModifiersV1 {
  return {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

/**
 * The committed text a key press types, or null when it types nothing.
 *
 * A single-character `key` with no command modifier is ordinary typing and
 * rides the text lane (CDP key events alone insert nothing); anything held
 * under ctrl/meta is a shortcut, and multi-character keys ("Enter", "Tab",
 * "ArrowLeft") are special keys the producer maps to virtual key codes.
 */
export function printableTextOf(event: DomModifierFacts & { readonly key: string }): string | null {
  if (event.ctrlKey || event.metaKey) return null;
  if ([...event.key].length !== 1) return null;
  return event.key;
}
