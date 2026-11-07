import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_TARGET_LABEL } from "../validation/contract.mjs";

const AUDIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function sourceUrl(link) {
  const sha = link?.sha ?? link?.commit ?? "";
  const path = link?.path ?? link?.file ?? "";
  const line = link?.lineStart ?? link?.line;
  const end = link?.lineEnd ?? link?.endLine;
  if (!sha || !path) return "";
  const repo =
    link?.repo ??
    (String(path).includes("field-app/") || String(path).includes("fieldd/")
      ? "vibefield"
      : "puppeteer");
  const base =
    repo === "vibefield"
      ? "https://github.com/vibefield/vibefield"
      : repo === "puppeteer"
        ? "https://github.com/vibefield/puppeteer"
        : "";
  if (!base) return "";
  const hash = line ? (end && end !== line ? `#L${line}-L${end}` : `#L${line}`) : "";
  return `${base}/blob/${sha}/${String(path).replace(/^\//, "")}${hash}`;
}

function pinFor(cell, repo) {
  const pins = cell?.runtime?.raw?.pins ?? {};
  return repo === "vibefield" ? pins.vibefield : pins.puppeteer;
}

function repoForPath(path) {
  return /field-app\/|fieldd\/|apps\/desktop\//.test(path) ? "vibefield" : "puppeteer";
}

/** Envelope sources plus every path the transform effect itself cites. */
export function flowAnchors(cell) {
  const seen = new Set();
  const anchors = [];
  const add = (link, label) => {
    const url = sourceUrl(link);
    const key = url || `${link?.path}:${link?.lineStart ?? link?.line}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    anchors.push({
      label,
      url,
      path: link?.path ?? link?.file ?? "",
      line: link?.lineStart ?? link?.line ?? "",
    });
  };
  for (const link of cell?.runtime?.sources ?? []) {
    add(link, link.symbol || link.path || "source");
  }
  for (const step of cell?.runtime?.transforms ?? []) {
    if (step?.source) add(step.source, step.name || step.source.symbol || "transform");
    const effect = step?.effect ?? "";
    for (const match of effect.matchAll(
      /((?:packages|apps)\/[\w./-]+\.(?:ts|tsx|js|mjs)):(\d+)(?:-(\d+))?/g,
    )) {
      const path = match[1];
      const repo = repoForPath(path);
      add(
        {
          repo,
          sha: pinFor(cell, repo),
          path,
          lineStart: Number(match[2]),
          lineEnd: match[3] ? Number(match[3]) : undefined,
        },
        step.name || path,
      );
    }
  }
  return anchors;
}

function wrap(text, width, limit = 8) {
  const words = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, limit);
}

/** Sentences the envelope itself uses for a fork. Not inferred from step order. */
function branchSentences(effect) {
  const patterns = [
    /[^.]*\btakes the guarded increment\b[^.]*\./gi,
    /[^.]*\btakes the skip branch\b[^.]*\./gi,
    /[^.]*\bdoes not take the skip branch\b[^.]*\./gi,
    /[^.]*\breaches neither arm\b[^.]*\./gi,
    /The trace stops\./g,
    /[^.]*\bbefore pricing\b[^.]*\./gi,
    /If costUsd is missing[^.]*\./g,
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of String(effect ?? "").matchAll(pattern)) {
      const sentence = match[0].replace(/\s+/g, " ").trim();
      if (sentence && !found.includes(sentence)) found.push(sentence);
    }
  }
  return found.slice(0, 3);
}

function edgeLabel(step, next) {
  if (!next) return "then";
  if (/The trace stops\./.test(step.effect ?? "") && next.name === "omission-consequence") {
    return "no usage emitted";
  }
  if (step.name === "envelope-translation" && next.name === "price-before-reduce")
    return "then price";
  if (step.name === "price-before-reduce" && next.name === "reduce-after-price")
    return "then reduce";
  return "then";
}

function mmdText(cell) {
  if (!cell?.mmdPath) return "";
  const file = join(AUDIT_ROOT, "evidence", ...cell.mmdPath.split("/").slice(-2));
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8");
}

function diagramNote(cell, steps) {
  const mmd = mmdText(cell);
  if (!mmd) {
    return "No sibling .mmd for this adapter and field. This diagram is the envelope's sourced transforms, not an invented graph and not an execution log.";
  }
  const missing = steps
    .filter((step) => step.name && !mmd.includes(step.name))
    .map((step) => step.name);
  if (missing.length === 0) {
    return "Sibling .mmd names these steps. This diagram uses the envelope effects and line anchors. Not an execution log.";
  }
  return `Sibling .mmd omits envelope steps: ${missing.join(", ")}. This diagram follows the envelope, not that shorter file. Not an execution log.`;
}

/** Detailed flowchart from the envelope. Boxes carry the effect and a source link. */
export function renderFlowSvg(cell) {
  const runtime = cell?.runtime;
  const admitted = runtime?.status === "loaded";
  const title = cell?.field
    ? `${cell.field.id} · ${cell.adapter?.id ?? "adapter"} · ${cell.state?.id ?? "state"}`
    : "No field selected";
  const steps = (runtime?.transforms ?? []).map((step) => {
    const link = step?.source ?? null;
    const line =
      link?.path && link?.lineStart
        ? `${link.path}:${link.lineStart}${link.lineEnd && link.lineEnd !== link.lineStart ? `-${link.lineEnd}` : ""}`
        : "";
    return {
      name: step?.name ?? "step",
      effect: step?.effect ?? "",
      line,
      href: link ? sourceUrl(link) : "",
    };
  });
  const note = admitted
    ? diagramNote(cell, steps)
    : "No trace file. Nothing is drawn as a completed path.";
  if (!admitted || steps.length === 0) {
    return emptySvg(title, note, cell);
  }
  const width = 920;
  const boxW = 860;
  const placed = [];
  let y = 72;
  for (const step of steps) {
    const effectLines = wrap(step.effect, 96);
    const shown = effectLines.join(" ");
    const branches = branchSentences(step.effect).filter((sentence) => !shown.includes(sentence));
    const branchLines = branches.flatMap((sentence) => wrap(sentence, 90, 3));
    const height = 36 + effectLines.length * 16 + branchLines.length * 16 + (step.line ? 22 : 8);
    placed.push({ ...step, y, height, effectLines, branchLines });
    y += height + 28;
  }
  const height = y + 36;
  const bodies = placed
    .map((step) => {
      const texts = step.effectLines
        .map(
          (line, index) =>
            `<text x="36" y="${step.y + 42 + index * 16}" fill="var(--vf-godview-dark-text-main)" font-size="12">${escapeXml(line)}</text>`,
        )
        .join("");
      const branches = step.branchLines
        .map(
          (line, index) =>
            `<text x="36" y="${step.y + 42 + step.effectLines.length * 16 + index * 16}" fill="var(--vf-godview-dark-working-text)" font-size="12">${escapeXml(line)}</text>`,
        )
        .join("");
      const link = step.href
        ? `<a href="${escapeXml(step.href)}" target="_blank"><text x="36" y="${step.y + 42 + (step.effectLines.length + step.branchLines.length) * 16 + 16}" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="11" text-decoration="underline">${escapeXml(step.line)}</text></a>`
        : "";
      return `<g>
        <rect x="24" y="${step.y}" width="${boxW}" height="${step.height}" rx="9" fill="var(--vf-godview-dark-panel-bg)" stroke="var(--vf-godview-dark-panel-border)"/>
        <text x="36" y="${step.y + 22}" fill="var(--vf-godview-dark-text-main)" font-size="13">${escapeXml(step.name)}</text>
        ${texts}
        ${branches}
        ${link}
      </g>`;
    })
    .join("");
  const edges = placed
    .slice(0, -1)
    .map((step, index) => {
      const y1 = step.y + step.height;
      const y2 = placed[index + 1].y;
      const mid = (y1 + y2) / 2;
      return `<line x1="454" y1="${y1}" x2="454" y2="${y2}" stroke="var(--vf-godview-dark-text-muted)"/>
        <text x="462" y="${mid + 4}" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="11">${escapeXml(edgeLabel(step, placed[index + 1]))}</text>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(`${AUDIT_TARGET_LABEL}. ${note} End-to-end proven: ${cell?.endToEnd?.proven === true ? "yes" : "no"}.`)}</desc>
  <rect width="100%" height="100%" fill="var(--vf-godview-dark-monitor-bg)"/>
  <text x="24" y="28" fill="var(--vf-godview-dark-text-main)" font-size="14">${escapeXml(title)}</text>
  <text x="24" y="50" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="12">${escapeXml(note)}</text>
  ${edges}
  ${bodies}
</svg>`;
}

function emptySvg(title, note, cell) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="920" height="160" viewBox="0 0 920 160" role="img">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(`${AUDIT_TARGET_LABEL}. ${note}`)}</desc>
  <rect width="100%" height="100%" fill="var(--vf-godview-dark-monitor-bg)"/>
  <text x="24" y="48" fill="var(--vf-godview-dark-text-main)" font-size="14">${escapeXml(title)}</text>
  <text x="24" y="80" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="12">${escapeXml(note)}</text>
  <text x="24" y="110" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="12">${escapeXml(cell?.endToEnd?.reason ?? "")}</text>
</svg>`;
}
