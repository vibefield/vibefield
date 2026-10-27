import { type ReactElement, useEffect, useMemo, useRef } from "react";
import { encode } from "uqr";

// TS-2 (track TS, TS-D6) — the phone's way in: the SAME sign-in address the
// browser got, drawn as a code a trusted phone scans to finish the sign-in
// there (Tailscale documents exactly this: "add a device with a QR code").
// Encoded locally, with no network: uqr, whose algorithm is modified from
// Project Nayuki's QR-Code-generator. Drawn on a canvas, black on white in both
// themes — a scanner reads contrast, not a theme (DESIGN.md §8 "The Connect
// pane": `--vf-qr-ink` on `--vf-qr-ground`).

/** The modules of `text` as rows of booleans (true = dark), with a two-module
 * quiet border; medium error correction, so a phone held at an angle reads it. */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: "M", border: 2 }).data;
}

export function SignInQr({
  text,
  size = 148,
  label,
}: {
  text: string;
  /** CSS pixels, square */
  size?: number;
  /** what the code is, for a screen reader ("Scan to sign in on your phone") */
  label: string;
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const matrix = useMemo(() => qrMatrix(text), [text]);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d") ?? null;
    if (canvas === null || context === null) return; // no 2-D context (a test DOM): the label stands
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    const styles = getComputedStyle(canvas);
    const ground = styles.getPropertyValue("--vf-qr-ground").trim();
    const ink = styles.getPropertyValue("--vf-qr-ink").trim();
    const cells = matrix.length;
    const cell = canvas.width / cells;
    context.fillStyle = ground.length > 0 ? ground : "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = ink.length > 0 ? ink : "black";
    for (let y = 0; y < cells; y += 1) {
      const row = matrix[y] ?? [];
      for (let x = 0; x < cells; x += 1) {
        if (row[x] === true) {
          // whole device pixels, so no seam shows between modules
          const left = Math.floor(x * cell);
          const top = Math.floor(y * cell);
          context.fillRect(
            left,
            top,
            Math.ceil((x + 1) * cell) - left,
            Math.ceil((y + 1) * cell) - top,
          );
        }
      }
    }
  }, [matrix, size]);

  return (
    <div className="vf-door-qr">
      <canvas
        ref={ref}
        role="img"
        aria-label={label}
        data-modules={matrix.length}
        style={{ width: size, height: size }}
      />
    </div>
  );
}
