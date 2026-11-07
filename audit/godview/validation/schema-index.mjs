import { AUDIT_PINS, REQUIRED_COUNTS } from "./contract.mjs";
import { citationGate } from "./revision.mjs";

/**
 * Normalization seam for GV-AUDIT2's schema. Stable ids and shapes are read
 * off the document. This module does not invent a parallel catalog and does
 * not treat declared capabilities as runtime proof.
 */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeLink(raw) {
  if (!isObject(raw)) return null;
  const path =
    typeof raw.file === "string" ? raw.file : typeof raw.path === "string" ? raw.path : "";
  const sha =
    typeof raw.commit === "string" ? raw.commit : typeof raw.sha === "string" ? raw.sha : "";
  if (!path || !sha || typeof raw.repo !== "string") return null;
  const line = numberOrNull(raw.line ?? raw.lines?.[0]);
  const endLine = numberOrNull(raw.endLine ?? raw.lines?.[1]);
  return {
    repo: raw.repo,
    sha,
    path,
    ...(line === null ? {} : { line }),
    ...(endLine === null ? {} : { endLine }),
    ...(typeof raw.url === "string" ? { url: raw.url } : {}),
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function linksOf(value) {
  if (Array.isArray(value)) return value.map(normalizeLink).filter(Boolean);
  const one = normalizeLink(value);
  return one ? [one] : [];
}

export function walkCitations(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) walkCitations(item, found);
    return found;
  }
  const link = normalizeLink(node);
  if (link) found.push(link);
  for (const value of Object.values(node)) walkCitations(value, found);
  return found;
}

function resolveRef(schema, node) {
  if (!isObject(node)) return null;
  if (typeof node.$ref !== "string") return node;
  const match = /^#\/\$defs\/([^/]+)$/.exec(node.$ref);
  if (!match) return node;
  const def = schema.$defs?.[match[1]];
  return isObject(def) ? def : node;
}

function propertiesOf(schema, node, seen = new Set()) {
  const resolved = resolveRef(schema, node);
  if (!isObject(resolved) || seen.has(resolved)) return {};
  seen.add(resolved);
  const props = { ...(resolved.properties ?? {}) };
  for (const part of resolved.allOf ?? []) {
    Object.assign(props, propertiesOf(schema, part, seen));
  }
  return props;
}

export function shapeFor(schema, fieldPath, layer) {
  const segments = fieldPath.split(".").filter(Boolean);
  const preferred = layer === "window" ? "AgentView" : "MonitorAgentRow";
  const startName = schema.$defs?.[preferred] ? preferred : "MonitorAgentRow";
  let node = schema.$defs?.[startName];
  const trail = [startName];
  for (const segment of segments) {
    const props = propertiesOf(schema, node);
    const next = props[segment];
    if (!next) {
      if (startName !== "AgentView" && schema.$defs?.AgentView) {
        const viewProps = propertiesOf(schema, schema.$defs.AgentView);
        if (segments.length === 1 && viewProps[segment]) {
          return shapeNode(schema, viewProps[segment], ["AgentView", segment]);
        }
      }
      return { found: false, trail, path: fieldPath };
    }
    trail.push(segment);
    node = next;
  }
  return shapeNode(schema, node, trail);
}

function shapeNode(schema, node, trail) {
  const resolved = resolveRef(schema, node) ?? node;
  const ref = typeof node.$ref === "string" ? node.$ref : null;
  const enumValues = Array.isArray(resolved.enum)
    ? resolved.enum
    : Array.isArray(node.enum)
      ? node.enum
      : null;
  return {
    found: true,
    trail,
    ref,
    type: resolved.type ?? node.type ?? null,
    enumValues,
    xTsType: node["x-ts-type"] ?? resolved["x-ts-type"] ?? null,
    description: node.description ?? resolved.description ?? null,
    source: normalizeLink(node["x-source"]) ?? normalizeLink(resolved["x-source"]),
    additionalProperties: resolved.additionalProperties ?? null,
    propertyNames: Object.keys(propertiesOf(schema, resolved)).sort(),
    required: Array.isArray(resolved.required) ? [...resolved.required].sort() : [],
  };
}

function classifyField(raw) {
  const classification = isObject(raw) ? raw : {};
  return {
    modelSupported: classification["model-supported"] === true,
    adapterEmittable:
      typeof classification["adapter-emittable"] === "string"
        ? classification["adapter-emittable"]
        : "unknown",
    uiReachable:
      typeof classification["UI-reachable"] === "string"
        ? classification["UI-reachable"]
        : "unknown",
  };
}

export function normalizeModel(schema) {
  const problems = [];
  if (!isObject(schema) || !isObject(schema["x-audit"])) {
    return { status: "unrecognized", problems: ["schema-missing-x-audit"] };
  }
  const audit = schema["x-audit"];
  const pins = isObject(audit.pins) ? audit.pins : {};
  if (pins.vibefield !== AUDIT_PINS.vibefield) problems.push("schema-vibefield-pin");
  if (pins.puppeteer !== AUDIT_PINS.puppeteer) problems.push("schema-puppeteer-pin");

  const sourceRevision = {
    vibefield: AUDIT_PINS.vibefield,
    puppeteer: AUDIT_PINS.puppeteer,
  };

  const states = (Array.isArray(audit.states) ? audit.states : []).map((state) => ({
    id: String(state.id ?? ""),
    axis: String(state.axis ?? ""),
    scope: String(state.scope ?? ""),
    predicate: String(state.predicate ?? ""),
    transitionRule: String(state.transitionRule ?? ""),
    proof: String(state.proof ?? ""),
    adapterFamily: state.adapterFamily ?? null,
    evidence: linksOf(state.evidence),
    sourceRevision,
  }));

  const fields = (Array.isArray(audit.fields) ? audit.fields : []).map((field) => ({
    id: String(field.id ?? ""),
    path: String(field.path ?? ""),
    layer: String(field.layer ?? ""),
    typescriptType: String(field.typescriptType ?? ""),
    optional: field.optional === true,
    nullable: field.nullable === true,
    defaultValue: field.default ?? null,
    derivation: String(field.derivation ?? ""),
    classification: classifyField(field.classification),
    adapterFamily: typeof field.adapterFamily === "string" ? field.adapterFamily : null,
    consumers: Array.isArray(field.consumers)
      ? field.consumers.map((consumer) => ({
          view: String(consumer.view ?? ""),
          evidence: linksOf(consumer.evidence),
        }))
      : [],
    reachability: isObject(field.adapterReachability) ? field.adapterReachability : {},
    evidence: linksOf(field.evidence),
    shape: shapeFor(schema, String(field.path ?? ""), String(field.layer ?? "")),
    sourceRevision,
  }));

  const views = (Array.isArray(audit.views) ? audit.views : []).map((view) => ({
    id: String(view.id ?? ""),
    name: String(view.name ?? ""),
    fieldIds: Array.isArray(view.fields) ? view.fields.map((field) => String(field.id ?? "")) : [],
    fieldEvidence: Array.isArray(view.fields)
      ? view.fields.map((field) => ({
          id: String(field.id ?? ""),
          evidence: linksOf(field.evidence),
        }))
      : [],
    consumerCompleteness: String(view.consumerCompleteness ?? ""),
    notes: String(view.notes ?? ""),
    registryEvidence: linksOf(view.registryEvidence),
    manifestEvidence: linksOf(view.manifest),
    sourceRevision,
  }));

  const adapters = (Array.isArray(audit.adapters) ? audit.adapters : []).map((adapter) => ({
    id: String(adapter.id ?? ""),
    name: String(adapter.name ?? ""),
    notes: String(adapter.notes ?? ""),
    evidence: linksOf(adapter.builtinEvidence),
    sourceRevision,
  }));

  const api = (Array.isArray(audit.api) ? audit.api : []).map((entry) => ({
    id: String(entry.id ?? ""),
    name: String(entry.name ?? ""),
    role: String(entry.role ?? ""),
    types: Array.isArray(entry.types) ? entry.types.map(String) : [],
    note: typeof entry.note === "string" ? entry.note : "",
    evidence: linksOf(entry.evidence),
    sourceRevision,
  }));

  const capabilityCells = [];
  if (isObject(audit.capabilityMatrix)) {
    for (const adapterId of Object.keys(audit.capabilityMatrix).sort()) {
      const families = audit.capabilityMatrix[adapterId];
      if (!isObject(families)) continue;
      for (const family of Object.keys(families).sort()) {
        const cell = families[family];
        capabilityCells.push({
          adapterId,
          family,
          support: isObject(cell) && typeof cell.support === "string" ? cell.support : "unknown",
          actorScope: isObject(cell) ? (cell.actorScope ?? null) : null,
          latency: isObject(cell) ? (cell.latency ?? null) : null,
          source: isObject(cell) && typeof cell.source === "string" ? cell.source : "",
          limitations:
            isObject(cell) && Array.isArray(cell.limitations) ? cell.limitations.map(String) : [],
          evidence: linksOf(isObject(cell) ? cell.evidence : null),
          declaration: true,
          provesUnreachable: false,
          sourceRevision,
        });
      }
    }
  }

  const restrictions = (
    Array.isArray(audit.adapterRestrictions) ? audit.adapterRestrictions : []
  ).map((entry) => ({
    adapter: String(entry.adapter ?? ""),
    family: String(entry.family ?? ""),
    fieldIds: Array.isArray(entry.fieldIds) ? entry.fieldIds.map(String) : [],
    stateIds: Array.isArray(entry.stateIds) ? entry.stateIds.map(String) : [],
    result: String(entry.result ?? ""),
    limitation: String(entry.limitation ?? ""),
    evidence: linksOf(entry.evidence),
    sourceRevision,
  }));

  const architecture = (Array.isArray(audit.architecture) ? audit.architecture : []).map(
    (stage) => ({
      stage: String(stage.stage ?? ""),
      type: String(stage.type ?? ""),
      evidence: linksOf(stage.evidence),
      sourceRevision,
    }),
  );

  const statusEnum = Array.isArray(schema.$defs?.AgentStatus?.enum)
    ? [...schema.$defs.AgentStatus.enum]
    : [];
  const declaredCapabilityCells = capabilityCells.filter(
    (cell) => cell.support !== "unknown",
  ).length;
  const observed = {
    statusEnumValues: statusEnum.length,
    statusEnum,
    stateEntries: states.length,
    fieldEntries: fields.length,
    apiEntries: api.length,
    views: views.length,
    adapters: adapters.length,
    declaredCapabilityCells,
    capabilityMatrixEntries: capabilityCells.length,
    unknownCapabilityCells: capabilityCells.length - declaredCapabilityCells,
    contractFieldEntries: Array.isArray(audit.contractFields) ? audit.contractFields.length : 0,
    schemaDefinitions: isObject(schema.$defs) ? Object.keys(schema.$defs).length : 0,
    adapterRestrictionEntries: restrictions.length,
    rowTopLevelFields: Object.keys(schema.$defs?.MonitorAgentRow?.properties ?? {}).length,
    windowOverlayTopLevelFields: Object.keys(schema.$defs?.AgentView?.properties ?? {}).length,
  };

  const citations = walkCitations(audit);
  const citationProblems = [];
  for (const link of citations) {
    const gate = citationGate(link);
    if (!gate.admit) {
      citationProblems.push({
        code: gate.code,
        repo: link.repo,
        sha: link.sha,
        path: link.path,
      });
    }
  }

  return {
    status: problems.length === 0 ? "loaded" : "pin-mismatch",
    problems,
    citationProblems,
    sourceRevision,
    scope: typeof audit.scope === "string" ? audit.scope : "",
    completeness: typeof audit.completeness === "string" ? audit.completeness : "",
    dependencyVerification: isObject(audit.dependencyVerification)
      ? audit.dependencyVerification
      : null,
    unknowns: Array.isArray(audit.unknowns) ? audit.unknowns.map(String) : [],
    combinationConstraints: Array.isArray(audit.combinationConstraints)
      ? audit.combinationConstraints.map((entry) => ({
          id: String(entry.id ?? ""),
          result: String(entry.result ?? ""),
          predicate: String(entry.predicate ?? ""),
          evidence: linksOf(entry.evidence),
        }))
      : [],
    reportedCounts: isObject(audit.counts) ? audit.counts : {},
    observed,
    requiredCounts: REQUIRED_COUNTS,
    states,
    fields,
    views,
    adapters,
    api,
    capabilityCells,
    restrictions,
    architecture,
    contractFieldIds: Array.isArray(audit.contractFields)
      ? audit.contractFields.map((field) => String(field.id ?? ""))
      : [],
  };
}
