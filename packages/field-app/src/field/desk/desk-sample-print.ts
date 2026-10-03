// THE SEED'S PRINT (DK-3, the orchestrator's ruling 6): the first-run board lays one of each
// reference kind, and a photo needs a picture. This one is DRAWN, not photographed — a 640 × 480
// evening over hills and water, flat-shaded from code at DK-3 (no licence to hold) — and ships as a
// bundled module (base64 text, `?raw`) like the plates, so the seed requests nothing (ruling 8). It
// enters the desk the way any print does: its bytes into the blob store, the print naming their hash.

import printText from "./assets/sample-print.png.b64?raw";
import { base64Bytes } from "./desk-bytes";

export const SAMPLE_PRINT = {
  type: "image/png",
  width: 640,
  height: 480,
  /** The name the store gives the bytes (`hashBytes`: SHA-256, lowercase hex). */
  sha256: "56c2ed364d1d345f4e19dba8a7f3cfb251e6cf53da7e95ffb42112eb94b77be5",
} as const;

export function samplePrintBytes(): Uint8Array<ArrayBuffer> {
  return base64Bytes(printText);
}
