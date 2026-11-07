import { AUDIT_TARGET_LABEL } from "../validation/contract.mjs";

const SECTIONS = [
  ["producer", "Producer"],
  ["transforms", "Transforms"],
  ["merge", "Merge"],
  ["transport", "Transport"],
  ["renderer", "Renderer"],
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sectionText(runtime, key) {
  if (!runtime || runtime.status === "pending") return "pending";
  if (runtime.status === "mixed-input") return "mixed input";
  if (key === "producer") return runtime.producer?.name ?? "stated";
  if (key === "transforms") return `${runtime.transforms?.length ?? 0} stated`;
  if (key === "merge") return runtime.merge?.strategy ?? "stated";
  if (key === "transport") return runtime.transport?.channel ?? "stated";
  if (key === "renderer") return runtime.renderer?.component ?? "stated";
  return "stated";
}

/** SVG for one cell. Pending sections stay pending. Arrows appear only for an admitted trace. */
export function renderFlowSvg(cell) {
  const runtime = cell?.runtime;
  const admitted = runtime?.status === "loaded";
  const title = cell?.field
    ? `${cell.field.id} · ${cell.adapter?.id ?? "adapter"} · ${cell.state?.id ?? "state"}`
    : "No field selected";
  const width = 980;
  const height = 220;
  const boxW = 150;
  const gap = 36;
  const boxes = SECTIONS.map(([key, label], index) => {
    const x = 24 + index * (boxW + gap);
    return { key, label, x, text: sectionText(runtime, key) };
  });
  const rects = boxes
    .map(
      (box) => `<g>
        <rect x="${box.x}" y="78" width="${boxW}" height="78" rx="9" fill="var(--vf-godview-dark-panel-bg)" stroke="var(--vf-godview-dark-panel-border)" stroke-dasharray="${admitted ? "0" : "4 3"}"/>
        <text x="${box.x + 12}" y="104" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="11">${escapeXml(box.label)}</text>
        <text x="${box.x + 12}" y="128" fill="var(--vf-godview-dark-text-main)" font-size="13">${escapeXml(box.text)}</text>
      </g>`,
    )
    .join("");
  const arrows = admitted
    ? boxes
        .slice(0, -1)
        .map((box, index) => {
          const x1 = box.x + boxW;
          const x2 = boxes[index + 1].x;
          return `<line x1="${x1 + 4}" y1="117" x2="${x2 - 4}" y2="117" stroke="var(--vf-godview-dark-text-muted)" />`;
        })
        .join("")
    : "";
  const caption = admitted
    ? "Section order from the trace file. This is not an execution log."
    : "No trace file. The five names are the envelope's sections, shown pending.";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(`${AUDIT_TARGET_LABEL}. ${caption} End-to-end proven: ${cell?.endToEnd?.proven === true ? "yes" : "no"}. ${cell?.endToEnd?.reason ?? ""}`)}</desc>
  <rect width="100%" height="100%" fill="var(--vf-godview-dark-monitor-bg)"/>
  <text x="24" y="28" fill="var(--vf-godview-dark-text-main)" font-size="14">${escapeXml(title)}</text>
  <text x="24" y="50" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="12">${escapeXml(AUDIT_TARGET_LABEL)}</text>
  ${arrows}
  ${rects}
  <text x="24" y="186" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="12">${escapeXml(caption)}</text>
</svg>`;
}
