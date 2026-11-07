import { PROVENANCE_STAGES } from "./contract.mjs";
import { citationGate } from "./revision.mjs";

/**
 * A per-datum provenance path is valid only when the trace states its nodes
 * and edges. Missing stages stay missing. An explicit inapplicable stage may
 * be skipped. Nothing here invents a producer.
 */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stageIndex(stage) {
  return PROVENANCE_STAGES.indexOf(stage);
}

export function validateProvenance(provenance) {
  const findings = [];
  if (provenance == null) {
    return {
      status: "missing",
      findings: [{ code: "provenance-missing", message: "No provenance object was supplied." }],
    };
  }
  if (
    !isObject(provenance) ||
    !Array.isArray(provenance.nodes) ||
    !Array.isArray(provenance.edges)
  ) {
    return {
      status: "incomplete",
      findings: [{ code: "provenance-unstated", message: "Nodes and edges must both be stated." }],
    };
  }

  const byId = new Map();
  for (const raw of provenance.nodes) {
    if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") {
      findings.push({ code: "node-without-id", message: "A provenance node has no id." });
      continue;
    }
    if (byId.has(raw.id)) {
      findings.push({ code: "duplicate-node", message: raw.id });
    }
    if (!PROVENANCE_STAGES.includes(raw.stage)) {
      findings.push({ code: "unknown-stage", message: `${raw.id} ${String(raw.stage)}` });
    }
    const applicability = raw.applicability === "inapplicable" ? "inapplicable" : "applicable";
    if (
      raw.applicability !== undefined &&
      raw.applicability !== "applicable" &&
      raw.applicability !== "inapplicable"
    ) {
      findings.push({ code: "bad-node-applicability", message: raw.id });
    }
    if (
      applicability === "inapplicable" &&
      !(typeof raw.reason === "string" && raw.reason.trim())
    ) {
      findings.push({ code: "inapplicable-without-reason", message: raw.id });
    }
    const evidence = Array.isArray(raw.evidence)
      ? raw.evidence
      : raw.evidence
        ? [raw.evidence]
        : [];
    if (applicability === "applicable" && evidence.length === 0) {
      findings.push({ code: "node-without-evidence", message: raw.id });
    }
    for (const link of evidence) {
      const gate = citationGate(link.commit ? link : { ...link, commit: link.sha });
      if (!gate.admit)
        findings.push({ code: gate.code, message: `${raw.id} ${link.path ?? link.file ?? ""}` });
    }
    byId.set(raw.id, { ...raw, applicability, evidence });
  }

  const invalidNow = findings.some((finding) =>
    ["node-without-id", "duplicate-node", "unknown-stage", "bad-node-applicability"].includes(
      finding.code,
    ),
  );
  if (invalidNow) return { status: "invalid", findings };

  const adj = new Map([...byId.keys()].map((id) => [id, []]));
  for (const edge of provenance.edges) {
    if (!isObject(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") {
      findings.push({ code: "bad-edge", message: "An edge is missing from/to." });
      continue;
    }
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      findings.push({ code: "dangling-edge", message: `${edge.from} -> ${edge.to}` });
      continue;
    }
    const from = stageIndex(byId.get(edge.from).stage);
    const to = stageIndex(byId.get(edge.to).stage);
    if (edge.from === edge.to || to < from) {
      findings.push({ code: "backward-edge", message: `${edge.from} -> ${edge.to}` });
    }
    adj.get(edge.from).push(edge.to);
  }

  const color = new Map();
  let cycle = false;
  const visit = (id) => {
    color.set(id, 1);
    for (const next of adj.get(id) ?? []) {
      const mark = color.get(next) ?? 0;
      if (mark === 1) cycle = true;
      else if (mark === 0) visit(next);
    }
    color.set(id, 2);
  };
  for (const id of byId.keys()) if ((color.get(id) ?? 0) === 0) visit(id);
  if (cycle) findings.push({ code: "cycle", message: "Provenance edges contain a cycle." });

  if (
    findings.some((finding) =>
      [
        "dangling-edge",
        "backward-edge",
        "bad-edge",
        "cycle",
        "inapplicable-without-reason",
      ].includes(finding.code),
    )
  ) {
    return { status: "invalid", findings };
  }

  const byStage = new Map(PROVENANCE_STAGES.map((stage) => [stage, []]));
  for (const node of byId.values()) {
    if (byStage.has(node.stage)) byStage.get(node.stage).push(node);
  }
  for (const stage of PROVENANCE_STAGES) {
    if (byStage.get(stage).length === 0) {
      findings.push({ code: "missing-stage", message: stage });
    }
  }

  for (const edge of provenance.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const from = stageIndex(byId.get(edge.from).stage);
    const to = stageIndex(byId.get(edge.to).stage);
    for (let index = from + 1; index < to; index += 1) {
      const stage = PROVENANCE_STAGES[index];
      const nodes = byStage.get(stage);
      if (nodes.length === 0) findings.push({ code: "edge-jumps-missing-stage", message: stage });
      else if (nodes.some((node) => node.applicability === "applicable")) {
        findings.push({ code: "edge-jumps-applicable-stage", message: stage });
      }
    }
  }

  const producers = [...byId.values()].filter(
    (node) => node.stage === "producer" && node.applicability === "applicable",
  );
  const renderers = [...byId.values()].filter(
    (node) => node.stage === "renderer" && node.applicability === "applicable",
  );
  const seen = new Set();
  const stack = producers.map((node) => node.id);
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adj.get(id) ?? []) stack.push(next);
  }
  if (producers.length === 0) findings.push({ code: "no-producer", message: "producer" });
  if (renderers.length === 0) findings.push({ code: "no-renderer", message: "renderer" });
  if (
    producers.length > 0 &&
    renderers.length > 0 &&
    !renderers.some((node) => seen.has(node.id))
  ) {
    findings.push({ code: "no-path-to-renderer", message: "producer does not reach renderer" });
  }
  for (const node of byId.values()) {
    if (node.applicability === "applicable" && !seen.has(node.id)) {
      findings.push({ code: "node-not-reachable", message: node.id });
    }
  }

  const hard = findings.some((finding) =>
    [
      "no-path-to-renderer",
      "node-not-reachable",
      "edge-jumps-applicable-stage",
      "no-producer",
      "no-renderer",
    ].includes(finding.code),
  );
  if (hard) return { status: "invalid", findings };
  if (findings.length > 0) return { status: "incomplete", findings };
  return { status: "valid", findings: [] };
}
