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

const CITE = /((?:packages|apps)\/[\w./-]+\.(?:ts|tsx|js|mjs)):(\d+)(?:-(\d+))?/g;

function stepLinks(step, cell, known = []) {
  const links = [];
  const add = (link) => {
    const path = link?.path ?? link?.file ?? "";
    const lineStart = link?.lineStart ?? link?.line;
    if (!path || lineStart == null) return;
    const key = `${path}:${lineStart}`;
    if (links.some((item) => `${item.path}:${item.lineStart}` === key)) return;
    const repo = link?.repo ?? repoForPath(path);
    links.push({
      repo,
      sha: link?.sha ?? link?.commit ?? pinFor(cell, repo),
      path,
      lineStart,
      lineEnd: link?.lineEnd ?? link?.endLine,
    });
  };
  if (step?.source) add(step.source);
  const effect = String(step?.effect ?? "");
  for (const match of effect.matchAll(CITE)) {
    add({
      path: match[1],
      lineStart: Number(match[2]),
      lineEnd: match[3] ? Number(match[3]) : undefined,
    });
  }
  for (const match of effect.matchAll(/(?<![\w./-])([\w.-]+\.ts):(\d+)(?:-(\d+))?/g)) {
    const hit = known.find((link) => String(link.path ?? "").endsWith(`/${match[1]}`));
    if (!hit) continue;
    add({
      ...hit,
      lineStart: Number(match[2]),
      lineEnd: match[3] ? Number(match[3]) : undefined,
    });
  }
  return links;
}

function armEdge(role) {
  if (role === "taken-arm") return "taken arm";
  if (role === "not-taken-arm") return "not taken";
  if (role === "alternate-host") return "alternate host, not a sequence";
  if (role === "not-this-run") return "not this run";
  return "stated rule, not a recorded sample";
}

function ledgerArms(step, flags) {
  const effect = step.effect ?? "";
  if (!/increments priced/i.test(effect) || !/unpriced/i.test(effect) || !/skipped/i.test(effect)) {
    return [];
  }
  const pricedZero = /priced stays 0|priced stay 0/i.test(effect);
  let priced = "stated-arm";
  let unpriced = "stated-arm";
  let skip = "stated-arm";
  if (flags.guarded) {
    unpriced = "taken-arm";
    skip = "not-taken-arm";
    if (pricedZero) priced = "not-taken-arm";
  } else if (flags.skipTaken) {
    skip = "taken-arm";
    unpriced = "not-taken-arm";
    if (pricedZero) priced = "not-taken-arm";
  }
  return [
    ["priced", "priced increment", priced, "Finite nonnegative costUsd increments priced."],
    [
      "unpriced",
      "unpriced increment",
      unpriced,
      "Missing costUsd increments unpriced only when canonical, pricing, or cost is set.",
    ],
    [
      "skip",
      "skip arm",
      skip,
      "A sample with none of those is skipped and does not increment unpriced.",
    ],
  ].map(([id, name, role, text]) => ({
    id: `${step.name}#${id}`,
    name,
    role,
    parent: step.name,
    text,
  }));
}

function coverageArms(step) {
  const effect = step.effect ?? "";
  if (
    !/complete/i.test(effect) ||
    !/partial/i.test(effect) ||
    !/omits|priced 0|pricedCount = 0/i.test(effect)
  ) {
    return [];
  }
  const omitTaken = /priced stays 0|priced stay 0|stay on priced 0|priced 0 omits/i.test(effect);
  const role = (taken) => (omitTaken ? (taken ? "taken-arm" : "not-taken-arm") : "stated-arm");
  return [
    [
      "complete",
      "complete",
      role(false),
      "priced above 0 and unpriced 0 is complete. The USD total may be 0.",
    ],
    ["partial", "partial", role(false), "priced above 0 and unpriced above 0 is partial."],
    ["priced-zero", "priced zero", role(true), "priced 0 omits this run's costUsd."],
  ].map(([id, name, armRole, text]) => ({
    id: `${step.name}#${id}`,
    name,
    role: armRole,
    parent: step.name,
    text,
  }));
}

function costArms(step) {
  const effect = step.effect ?? "";
  if (!/omits field\.cost/i.test(effect) || !/retained/i.test(effect)) return [];
  const omittedHere = /costOf returned undefined/i.test(effect);
  const role = (taken) => (omittedHere ? (taken ? "taken-arm" : "not-taken-arm") : "stated-arm");
  return [
    ["omit", "cost omitted", role(true), "costOf returns undefined and the row omits field.cost."],
    ["retained", "retained total", role(false), "A retained costUsd is the across-epochs sum."],
  ].map(([id, name, armRole, text]) => ({
    id: `${step.name}#${id}`,
    name,
    role: armRole,
    parent: step.name,
    text,
  }));
}

function pathEdge(prev, next, flags) {
  if (prev.name === "handler-omits-usage" && next.name === "omission-consequence") {
    return { label: "no usage emitted", sequences: false };
  }
  if (prev.name === "envelope-translation" && next.name === "price-before-reduce") {
    return { label: "before pricing", sequences: true };
  }
  if (
    next.name === "reduce-after-price" &&
    /after priceUsageUpdates|already rewrote/i.test(next.effect ?? "")
  ) {
    return {
      label:
        flags.priceNotCalled || flags.neither
          ? "after the selector, priceUsage not called"
          : "runs after pricing",
      sequences: true,
    };
  }
  if (flags.neither && next.name === "coverage-decision") {
    return { label: "ledger loop did not run", sequences: false };
  }
  if (
    (prev.name === "epoch-observe" || prev.name === "epoch-retention") &&
    next.name === "history-aggregate"
  ) {
    return { label: "after the host reading", sequences: false };
  }
  return { label: "envelope order", sequences: false };
}

function mmdText(cell) {
  if (!cell?.mmdPath) return "";
  const file = join(AUDIT_ROOT, "evidence", ...cell.mmdPath.split("/").slice(-2));
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8");
}

function diagramNote(cell, steps) {
  const mmd = mmdText(cell);
  const tail =
    " Dashed boxes are not this run, a stated arm, or an alternate host. An envelope-order edge is the file order, not a runtime chain. Not an execution log.";
  if (!mmd) {
    return `No sibling .mmd for this adapter and field. This diagram is the envelope.${tail}`;
  }
  const names = steps.map((step) => step.name);
  if (names.includes("handler-omits-usage") && !/costOf/i.test(mmd)) {
    return `Sibling .mmd is a shorter alternate reference. It does not state costOf. It is not this diagram and not proof the omission is absent.${tail}`;
  }
  return `Sibling .mmd is an alternate drawing. Step names are not compared. This diagram follows the envelope.${tail}`;
}

/**
 * Envelope graph. Path nodes stay in file order. A step the effect says this
 * adapter does not enter is not on that path. Arms and host alternatives are
 * side nodes. No edge is labeled "then".
 */
export function flowGraph(cell) {
  const raw = cell?.runtime?.transforms ?? [];
  const steps = raw.map((step) => ({
    id: step?.name ?? "step",
    name: step?.name ?? "step",
    effect: step?.effect ?? "",
    source: step?.source ?? null,
    links: [],
    role: "path",
  }));
  const known = [
    ...(cell?.runtime?.sources ?? []),
    ...raw.map((step) => step?.source).filter(Boolean),
  ];
  for (const step of steps) step.links = stepLinks(step, cell, known);
  const all = steps.map((step) => step.effect).join("\n");
  const flags = {
    priceNotCalled: /does not call priceUsage/i.test(all),
    neither: /reaches neither arm/i.test(all) && /loop does not run/i.test(all),
    guarded: /takes the guarded increment/i.test(all),
    skipTaken: /takes the skip branch/i.test(all) && !/does not take the skip branch/i.test(all),
    currentHost: /current mode|this path/i.test(all),
  };
  for (const step of steps) {
    if (step.name === "priceUsage" && (flags.priceNotCalled || flags.neither))
      step.role = "not-this-run";
    if (step.name === "ledger-counts" && flags.neither) step.role = "not-this-run";
    if (step.name === "godview-accumulate" || step.name === "vibefield-current-epoch") {
      step.role = "alternate-host";
    }
  }
  const nodes = [...steps];
  for (const step of steps) {
    if (step.role !== "path") continue;
    const arms =
      step.name === "ledger-counts"
        ? ledgerArms(step, flags)
        : step.name === "coverage-decision"
          ? coverageArms(step)
          : step.name === "row-cost"
            ? costArms(step)
            : [];
    nodes.push(...arms);
  }
  const edges = [];
  const path = steps.filter((step) => step.role === "path");
  for (let index = 0; index < path.length - 1; index += 1) {
    const relation = pathEdge(path[index], path[index + 1], flags);
    edges.push({
      from: path[index].id,
      to: path[index + 1].id,
      label: relation.label,
      sequences: relation.sequences,
    });
  }
  const hostAnchor =
    steps.find((step) => step.name === "epoch-observe") ??
    steps.find((step) => step.name === "epoch-retention");
  for (const step of steps) {
    if (step.role === "not-this-run") {
      const anchor =
        step.name === "priceUsage"
          ? (steps.find((item) => item.name === "priceUsageUpdates") ??
            steps.find((item) => item.name === "price-before-reduce"))
          : (steps.find((item) => item.name === "buildUsageIndex") ??
            steps.find((item) => item.name === "usage-index-stream"));
      if (anchor) {
        edges.push({ from: anchor.id, to: step.id, label: "not this run", sequences: false });
      }
    }
    if (step.role === "alternate-host" && hostAnchor) {
      const label =
        step.name === "vibefield-current-epoch" && flags.currentHost
          ? "VibeField current, this reading"
          : step.name === "godview-accumulate"
            ? "Godview accumulate, other host"
            : "alternate host, not a sequence";
      edges.push({ from: hostAnchor.id, to: step.id, label, sequences: false });
    }
  }
  for (const arm of nodes) {
    if (!arm.parent) continue;
    edges.push({ from: arm.parent, to: arm.id, label: armEdge(arm.role), sequences: false });
  }
  return {
    nodes,
    edges,
    note: diagramNote(cell, steps),
    flags,
  };
}

function linkLabel(link) {
  const end = link.lineEnd && link.lineEnd !== link.lineStart ? `-${link.lineEnd}` : "";
  return `${link.path}:${link.lineStart}${end}`;
}

function roleTitle(node) {
  if (node.role === "not-this-run") return `${node.name} — not this run`;
  if (node.role === "taken-arm") return `${node.name} — taken`;
  if (node.role === "not-taken-arm") return `${node.name} — not taken`;
  if (node.role === "stated-arm") return `${node.name} — stated rule`;
  if (node.role === "alternate-host") return `${node.name} — alternate host`;
  return node.name;
}

/** Detailed flowchart from the envelope. A dashed box is not a runtime successor. */
export function renderFlowSvg(cell) {
  const admitted = cell?.runtime?.status === "loaded";
  const title = cell?.field
    ? `${cell.field.id} · ${cell.adapter?.id ?? "adapter"} · ${cell.state?.id ?? "state"}`
    : "No field selected";
  const graph = admitted ? flowGraph(cell) : null;
  const note = graph?.note ?? "No trace file. Nothing is drawn as a completed path.";
  const path = graph?.nodes.filter((node) => node.role === "path") ?? [];
  if (!admitted || path.length === 0) return emptySvg(title, note, cell);
  const width = 1280;
  const noteLines = wrap(note, 108, 3);
  let y = 40 + noteLines.length * 22;
  const placed = new Map();
  const rows = [];
  for (const node of path) {
    const effectLines = wrap(node.effect, 96, 5);
    const links = (node.links ?? []).slice(0, 4);
    const boxHeight = 48 + effectLines.length * 22 + links.length * 20 + 8;
    const sides = (graph?.nodes ?? []).filter(
      (item) =>
        item.parent === node.id ||
        graph.edges.some(
          (edge) =>
            edge.from === node.id && edge.to === item.id && !edge.sequences && item.role !== "path",
        ),
    );
    const sideNodes = [];
    let sideX = 32;
    let sideY = y + boxHeight + 36;
    let sideBottom = sideY;
    for (const side of sides) {
      const lines = wrap(side.text || side.effect, 36, 3);
      const sideHeight = 64 + lines.length * 20;
      if (sideX + 400 > width - 24) {
        sideX = 32;
        sideY = sideBottom + 16;
      }
      sideNodes.push({ ...side, x: sideX, y: sideY, height: sideHeight, lines });
      sideBottom = Math.max(sideBottom, sideY + sideHeight);
      sideX += 416;
    }
    const rowHeight = Math.max(boxHeight, sideBottom - y);
    placed.set(node.id, { ...node, y, height: boxHeight, effectLines, links, rowHeight });
    for (const side of sideNodes) placed.set(side.id, side);
    rows.push({ node, sideNodes });
    y += rowHeight + 36;
  }
  const height = y + 24;
  const bodies = rows
    .map(({ node, sideNodes }) => {
      const box = placed.get(node.id);
      const texts = box.effectLines
        .map(
          (line, index) =>
            `<text x="48" y="${box.y + 48 + index * 22}" fill="var(--vf-godview-dark-text-main)" font-size="15">${escapeXml(line)}</text>`,
        )
        .join("");
      const links = box.links
        .map((link, index) => {
          const href = sourceUrl(link);
          const textY = box.y + 48 + box.effectLines.length * 22 + index * 20;
          const label = linkLabel(link);
          return href
            ? `<a href="${escapeXml(href)}" target="_blank"><text x="48" y="${textY}" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="14" text-decoration="underline">${escapeXml(label)}</text></a>`
            : "";
        })
        .join("");
      const sides = sideNodes
        .map((side) => {
          const lines = side.lines
            .map(
              (line, index) =>
                `<text x="${side.x + 36}" y="${side.y + 46 + index * 20}" fill="var(--vf-godview-dark-text-main)" font-size="14">${escapeXml(line)}</text>`,
            )
            .join("");
          const mid = side.y + side.height / 2;
          const points = `${side.x + 18},${mid} ${side.x + 36},${side.y + 8} ${side.x + 364},${side.y + 8} ${side.x + 382},${mid} ${side.x + 364},${side.y + side.height - 8} ${side.x + 36},${side.y + side.height - 8}`;
          return `<g data-role="${escapeXml(side.role)}" data-step="${escapeXml(side.id)}">
            <polygon points="${points}" fill="var(--vf-godview-dark-panel-bg)" stroke="var(--vf-godview-dark-working-text)" stroke-width="2" stroke-dasharray="6 4"/>
            <text x="${side.x + 36}" y="${side.y + 28}" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="14">${escapeXml(roleTitle(side))}</text>
            ${lines}
          </g>`;
        })
        .join("");
      return `<g data-role="path" data-step="${escapeXml(node.id)}">
        <rect x="32" y="${box.y}" width="1216" height="${box.height}" rx="12" fill="var(--vf-godview-dark-panel-bg)" stroke="var(--vf-godview-dark-panel-border)"/>
        <text x="48" y="${box.y + 28}" fill="var(--vf-godview-dark-text-main)" font-size="18">${escapeXml(node.name)}</text>
        ${texts}
        ${links}
      </g>${sides}`;
    })
    .join("");
  const edges = (graph?.edges ?? [])
    .map((edge) => {
      const from = placed.get(edge.from);
      const to = placed.get(edge.to);
      if (!from || !to) return "";
      const dashed = edge.sequences ? "" : ' stroke-dasharray="4 3"';
      if (to.role && to.role !== "path") {
        const y1 = from.y + from.height;
        const x2 = (to.x ?? 32) + 191;
        return `<g data-edge="${escapeXml(`${edge.from} ${edge.to}`)}" data-label="${escapeXml(edge.label)}" data-sequences="false">
          <line x1="640" y1="${y1}" x2="${x2}" y2="${to.y}" stroke="var(--vf-godview-dark-working-text)" stroke-width="1.5"${dashed}/>
          <text x="${Math.min(x2, 900)}" y="${to.y - 6}" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="14">${escapeXml(edge.label)}</text>
        </g>`;
      }
      const y1 = from.y + from.rowHeight;
      const y2 = to.y;
      const mid = (y1 + y2) / 2;
      return `<g data-edge="${escapeXml(`${edge.from} ${edge.to}`)}" data-label="${escapeXml(edge.label)}" data-sequences="${edge.sequences ? "true" : "false"}">
        <line x1="640" y1="${y1}" x2="640" y2="${y2}" stroke="var(--vf-godview-dark-text-muted)" stroke-width="1.5"${dashed}/>
        <text x="652" y="${mid}" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="14">${escapeXml(edge.label)}</text>
      </g>`;
    })
    .join("");
  const caption = noteLines
    .map(
      (line, index) =>
        `<text x="32" y="${28 + index * 22}" fill="var(--vf-godview-dark-chrome-text-secondary)" font-size="15">${escapeXml(line)}</text>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(`${AUDIT_TARGET_LABEL}. ${note} End-to-end proven: ${cell?.endToEnd?.proven === true ? "yes" : "no"}.`)}</desc>
  <rect width="100%" height="100%" fill="var(--vf-godview-dark-monitor-bg)"/>
  ${caption}
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
