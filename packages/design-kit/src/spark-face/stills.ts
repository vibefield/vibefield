import {
  placeSparkBuddy,
  type SparkEngine,
  type Sparklings,
  type SparkRgb,
  sparkBuddyOptions,
} from "./engine";
import type { SparkStatus } from "./statuses";

// A still (DESIGN.md §2.10): a face that is not moving, drawn once by the window's one small WebGL2
// canvas and kept as a picture. The canvas is laid out out of sight (spark-face.css), so the engine
// measures it true; the pictures are kept by everything that changes them, the last 256.

export interface StillFace {
  readonly seed: number;
  readonly status: SparkStatus;
  readonly size: number;
  readonly framed: boolean;
  /** the ground behind the face, for its cut ring */
  readonly cut: SparkRgb;
  /** A free face's box over its size: FREE_FACE_ROOM unless said. 1 draws it edge to edge, with no room for its
   * props, as Godview's views draw a host's picture inside their own box (TH-3, 2026-11-19). */
  readonly room?: number;
}

/** A free face's picture is half again its box, so its props (thought dots, Zzz, hearts) are whole. */
export const FREE_FACE_ROOM = 1.5;

const KEEP = 256;
const pictures = new Map<string, string>();
let canvas:
  | { readonly element: HTMLCanvasElement; readonly engine: SparkEngine }
  | null
  | undefined;

function stillCanvas(
  engines: Sparklings,
): { readonly element: HTMLCanvasElement; readonly engine: SparkEngine } | null {
  if (canvas !== undefined) return canvas;
  const element = document.createElement("canvas");
  element.className = "vf-spark-still-canvas";
  document.body.append(element);
  try {
    canvas = { element, engine: new engines.Engine(element, { max: 1, preserve: true }) };
  } catch {
    // no WebGL2 in this window: every face is the flat star
    element.remove();
    canvas = null;
  }
  return canvas;
}

/** A free face's room where it is not the default, else null (a framed face has none): a key names it only then,
 * so every key a face without one makes is the key it made before. */
function roomOf(face: StillFace): number | null {
  return face.framed || face.room === undefined || face.room === FREE_FACE_ROOM ? null : face.room;
}

export function stillKey(face: StillFace, pixelRatio: number): string {
  const cut = face.cut.map((channel) => Math.round(channel * 255)).join(",");
  const fields = [
    face.seed,
    face.status,
    face.size,
    face.framed ? "framed" : "free",
    cut,
    pixelRatio,
  ];
  const room = roomOf(face);
  return (room === null ? fields : [...fields, `room=${room}`]).join("|");
}

/** The face's picture, or null where the window has no WebGL2 (the face is then the flat star). */
export function drawStill(engines: Sparklings, face: StillFace): string | null {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const key = stillKey(face, pixelRatio);
  const kept = pictures.get(key);
  if (kept !== undefined) {
    pictures.delete(key);
    pictures.set(key, kept);
    return kept;
  }
  const still = stillCanvas(engines);
  if (!still) return null;
  const box = face.framed ? face.size : face.size * (roomOf(face) ?? FREE_FACE_ROOM);
  still.element.style.setProperty("--vf-spark-still-box", `${box}px`);
  still.engine.resize();
  still.engine.clear();
  const buddy = still.engine.add(new engines.Buddy(sparkBuddyOptions(engines, face, face.cut)));
  placeSparkBuddy(buddy, box / 2, box / 2, face.size, face.framed);
  still.engine.render(0, { frozen: true });
  const picture = still.element.toDataURL("image/png");
  still.engine.clear();
  pictures.set(key, picture);
  if (pictures.size > KEEP) {
    const oldest = pictures.keys().next().value;
    if (oldest !== undefined) pictures.delete(oldest);
  }
  return picture;
}
