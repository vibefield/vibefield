import type { BrowserSurfaceInputRequest } from "./browser-producer";

/** Coalesce only adjacent continuous input. Discrete events, direction changes,
 * geometry changes and different wheel locations are barriers. The caller also
 * fences document, attachment, device and active gestures. */
export function coalesceBrowserInput(
  previous: BrowserSurfaceInputRequest,
  next: BrowserSurfaceInputRequest,
): BrowserSurfaceInputRequest | undefined {
  if (previous.geometryRevision !== next.geometryRevision) return undefined;
  const point = (r: BrowserSurfaceInputRequest) =>
    (r.kind === "mouse" || r.kind === "wheel") &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    r.x >= 0 &&
    r.y >= 0;
  if (!point(previous) || !point(next)) return undefined;
  if (
    previous.kind === "mouse" &&
    next.kind === "mouse" &&
    previous.type === "move" &&
    next.type === "move" &&
    previous.button === undefined &&
    next.button === undefined &&
    (previous.buttons ?? 0) === 0 &&
    (next.buttons ?? 0) === 0 &&
    previous.clickCount === next.clickCount &&
    (next.clickCount === undefined ||
      (Number.isInteger(next.clickCount) && next.clickCount >= 1 && next.clickCount <= 3))
  ) {
    return next;
  }
  if (
    previous.kind !== "wheel" ||
    next.kind !== "wheel" ||
    previous.x !== next.x ||
    previous.y !== next.y
  )
    return undefined;
  const sameDirection = (a: number, b: number) =>
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.sign(a) === Math.sign(b) &&
    Math.abs(a + b) <= 100_000;
  if (!sameDirection(previous.deltaX, next.deltaX) || !sameDirection(previous.deltaY, next.deltaY))
    return undefined;
  return { ...next, deltaX: previous.deltaX + next.deltaX, deltaY: previous.deltaY + next.deltaY };
}
