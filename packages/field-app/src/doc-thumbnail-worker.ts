import type { DocThumbnailScene, DocThumbnailWidget } from "./doc-thumbnail-scene";

const WIDTH = 640;
const HEIGHT = 400;
const OUTER_PAD = 34;

interface RenderRequest {
  id: number;
  scene: DocThumbnailScene;
}

interface RenderResponse {
  id: number;
  blob?: Blob;
  error?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse): void;
};

scope.onmessage = (event) => {
  const { id, scene } = event.data;
  void render(scene).then(
    (blob) => scope.postMessage({ id, blob }),
    (error: unknown) =>
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
};

async function render(scene: DocThumbnailScene): Promise<Blob> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas unavailable");

  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawGround(ctx);

  if (scene.widgets.length === 0) {
    ctx.fillStyle = "rgba(40, 40, 48, 0.32)";
    ctx.font = "600 18px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Empty field", WIDTH / 2, HEIGHT / 2);
    return canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
  }

  const view = resolveView(scene.widgets);
  const scale = Math.min((WIDTH - OUTER_PAD * 2) / view.w, (HEIGHT - OUTER_PAD * 2) / view.h);
  const ox = WIDTH / 2 - (view.x + view.w / 2) * scale;
  const oy = HEIGHT / 2 - (view.y + view.h / 2) * scale;
  const sx = (x: number): number => ox + x * scale;
  const sy = (y: number): number => oy + y * scale;

  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, 2.5 * Math.min(scale, 1));
  ctx.strokeStyle = "rgba(87, 94, 120, 0.22)";
  for (const wire of scene.wires) {
    const ax = sx(wire.fromX);
    const ay = sy(wire.fromY);
    const bx = sx(wire.toX);
    const by = sy(wire.toY);
    const bend = Math.max(18, Math.abs(bx - ax) * 0.42);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(ax + bend, ay, bx - bend, by, bx, by);
    ctx.stroke();
  }

  for (const widget of scene.widgets) drawWidget(ctx, widget, sx, sy, scale);
  return canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
}

function drawGround(ctx: OffscreenCanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(45, 48, 60, 0.10)";
  for (let y = 8; y < HEIGHT; y += 12) {
    for (let x = 8; x < WIDTH; x += 12) {
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function resolveView(widgets: DocThumbnailWidget[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const widget of widgets) {
    minX = Math.min(minX, widget.x);
    minY = Math.min(minY, widget.y);
    maxX = Math.max(maxX, widget.x + widget.w);
    maxY = Math.max(maxY, widget.y + widget.h);
  }
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const pad = Math.max(60, Math.min(180, Math.max(contentW, contentH) * 0.06));
  return { x: minX - pad, y: minY - pad, w: contentW + pad * 2, h: contentH + pad * 2 };
}

function drawWidget(
  ctx: OffscreenCanvasRenderingContext2D,
  widget: DocThumbnailWidget,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
): void {
  const x = sx(widget.x);
  const y = sy(widget.y);
  const w = Math.max(2, widget.w * scale);
  const h = Math.max(2, widget.h * scale);
  const radius = Math.max(2, Math.min(14, 22 * scale, w / 3, h / 3));

  ctx.save();
  ctx.shadowColor = "rgba(35, 38, 50, 0.16)";
  ctx.shadowBlur = Math.min(16, Math.max(2, 10 * scale));
  ctx.shadowOffsetY = Math.min(8, Math.max(1, 5 * scale));
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = resolveFill(ctx, widget.background, widget.type, x, y, w, h);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(0.75, Math.min(1.5, scale));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
  ctx.stroke();

  if (w >= 34 && h >= 20) {
    const inset = Math.max(3, Math.min(10, 8 * scale));
    ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
    roundedRect(ctx, x + inset, y + inset, Math.min(w * 0.42, 56), Math.max(2, 4 * scale), 99);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.20)";
    roundedRect(
      ctx,
      x + inset,
      y + inset + Math.max(5, 8 * scale),
      Math.min(w * 0.62, 82),
      Math.max(1.5, 3 * scale),
      99,
    );
    ctx.fill();
  }
  ctx.restore();
}

function resolveFill(
  ctx: OffscreenCanvasRenderingContext2D,
  css: string,
  type: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string | CanvasGradient {
  const colors = css.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
  if (colors.length >= 2) {
    const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
    colors.slice(0, 4).forEach((color, index, picked) => {
      gradient.addColorStop(index / Math.max(1, picked.length - 1), color);
    });
    return gradient;
  }
  if (colors.length === 1) return colors[0]!;
  if (/^(rgb|hsl)a?\(/.test(css.trim())) return css;
  const palette = ["#a9b8ff", "#ffc89b", "#9edcc1", "#d4b2f1", "#f3aeba", "#91c5e8"];
  return palette[stableHash(type) % palette.length]!;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function roundedRect(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
