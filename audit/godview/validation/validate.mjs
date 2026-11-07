#!/usr/bin/env node
// GV-AUDIT1 gate. Checks the foundation contracts. Does not vendor the model
// slice or re-run the package comparison.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const PINS = {
  vibefield: "433505fd0f224f4cda540d642661b13848c0ef82",
  puppeteer: "748d015a7e393112e0a91dad80111fdf5abe6583",
};
export const SHIPPED_TAG_COMMIT = "52d09c8e84951b9a355a6700eac2dfc1290a9fa0";
export const MODEL_COMMIT = "49fc12da0fadc34e25c227fa2f03dcce2e09dbaa";
export const PACKAGE_CHECK_COMMIT = "d53a0fa24ca7341fe5858329c9399eac6baf6b53";

const OWNED_ELSEWHERE = [
  "contracts/model.schema.json",
  "contracts/model.md",
  "contracts/model.validation.json",
  "validation/package-pin-check.md",
];

const COMPETING_NAMES = new Set([
  "unified-model.json",
  "fields.json",
  "field-catalog.json",
  "monitor-model.json",
]);

export function run(repoRoot) {
  const root = join(repoRoot, "audit", "godview");
  const failures = [];
  const waivers = [];
  const fail = (gate, message) => failures.push({ gate, message });
  const files = walk(root);
  const docs = new Map();
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const rel = relative(root, file);
    try {
      docs.set(rel, JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      fail("gate.json-parse", `${rel}: ${error.message}`);
    }
  }
  const cache = new Map();
  const check = (rel, schemaRel) => {
    const data = docs.get(rel);
    const schemaPath = join(root, schemaRel);
    if (data === undefined) {
      fail("gate.schema-subset", `missing ${rel}`);
      return;
    }
    for (const error of validateSchema(schemaPath, data, cache)) {
      fail("gate.schema-subset", `${rel}: ${error}`);
    }
  };
  check("contracts/manifest.json", "contracts/manifest.schema.json");
  check("contracts/ids.json", "contracts/ids.schema.json");
  check("plan/topology.json", "contracts/topology.schema.json");
  check("plan/completeness-matrix.json", "contracts/matrix.schema.json");

  const manifest = docs.get("contracts/manifest.json");
  const ids = docs.get("contracts/ids.json");
  const matrix = docs.get("plan/completeness-matrix.json");
  const gatesDoc = docs.get("validation/gates.json");
  const topology = docs.get("plan/topology.json");

  if (manifest) checkBaseline(manifest, fail);
  if (ids && matrix) checkIds(ids, matrix, fail);
  if (matrix && gatesDoc && ids) checkMatrix(matrix, gatesDoc, ids, root, fail);
  checkOwnedElsewhere(root, fail, waivers);
  checkTraces(root, docs, ids, cache, fail);
  checkFixtures(root, docs, cache, fail);
  checkFlows(root, docs, cache, fail);
  for (const [rel, data] of docs) checkLines(rel, data, fail);

  const report = {
    ok: failures.length === 0,
    pins: PINS,
    notShipped: "0.3.3",
    modelCommit: MODEL_COMMIT,
    packageCheckCommit: PACKAGE_CHECK_COMMIT,
    packageCheckVerifiedByThisSlice: false,
    waivers,
    counts: {
      jsonFiles: docs.size,
      matrixRows: matrix?.rows?.length ?? 0,
      adapters: ids?.adapters?.length ?? 0,
      views: ids?.views?.length ?? 0,
    },
    failures,
  };
  if (topology?.auditBaseline?.warning) report.warning = topology.auditBaseline.warning;
  return report;
}

function checkBaseline(manifest, fail) {
  const base = manifest.auditBaseline;
  const shipped = manifest.notShippedPackage;
  if (!base || !shipped) return;
  if (base.puppeteer !== PINS.puppeteer || base.vibefield !== PINS.vibefield) {
    fail("gate.baseline-not-shipped", "audit baseline does not match the frozen pins");
  }
  if (base.puppeteer === shipped.shippedTagCommit || shipped.equivalentToAuditPin !== false) {
    fail("gate.baseline-not-shipped", "shipped 0.3.3 must not be treated as the audit pin");
  }
  if (manifest.pins?.puppeteer?.sha !== PINS.puppeteer) {
    fail("gate.pins", "puppeteer pin drifted");
  }
  if (manifest.pins?.vibefield?.sha !== PINS.vibefield) {
    fail("gate.pins", "vibefield pin drifted");
  }
  if (
    manifest.modelSlice?.commit !== MODEL_COMMIT ||
    manifest.modelSlice?.cherryPickedHere !== false
  ) {
    fail("gate.model-slice-ref", "model slice reference drifted or was cherry-picked");
  }
  if (manifest.packageComparison?.thisSliceVerified !== false) {
    fail(
      "gate.baseline-not-shipped",
      "this slice must not claim it re-verified the package comparison",
    );
  }
  if (manifest.packageComparison?.commit !== PACKAGE_CHECK_COMMIT) {
    fail("gate.baseline-not-shipped", "package comparison commit drifted");
  }
}

function checkIds(ids, matrix, fail) {
  const suffixes = ids.adapters.map((row) => row.suffix);
  const sorted = [...suffixes].sort();
  if (suffixes.join() !== sorted.join()) fail("gate.ids", "adapters are not in byte order");
  const cut = Math.ceil(sorted.length / 2);
  const first = sorted.slice(0, cut).map((suffix) => `adapter.${suffix}`);
  const second = sorted.slice(cut).map((suffix) => `adapter.${suffix}`);
  if (ids.halves["GV-AUDIT3"].join() !== first.join()) {
    fail("gate.adapter-halves", "GV-AUDIT3 half drifted");
  }
  if (ids.halves["GV-AUDIT4"].join() !== second.join()) {
    fail("gate.adapter-halves", "GV-AUDIT4 half drifted");
  }
  for (const row of ids.adapters) {
    if (row.id !== `adapter.${row.suffix}`) fail("gate.ids", `${row.id} suffix mismatch`);
    if (ids.doNotMint.includes(row.id)) fail("gate.ids", `${row.id} is denied`);
  }
  const views = ["view.list", "view.rain", "view.swarm", "view.spend", "view.timeline"];
  if (ids.views.map((view) => view.id).join() !== views.join()) {
    fail("gate.ids", "view ids drifted from the model slice order");
  }
  const rowIds = new Set(matrix.rows.map((row) => row.id));
  for (const denied of ids.doNotMint) {
    if (rowIds.has(denied)) fail("gate.ids", `${denied} is not a foundation id`);
  }
  if (ids.modelSlice !== MODEL_COMMIT) fail("gate.model-slice-ref", "ids modelSlice drifted");
}

function checkMatrix(matrix, gatesDoc, ids, root, fail) {
  const idsSeen = new Set();
  for (const row of matrix.rows) {
    if (idsSeen.has(row.id)) fail("gate.matrix-coverage", `duplicate row ${row.id}`);
    idsSeen.add(row.id);
  }
  for (const adapter of ids.adapters) {
    if (!idsSeen.has(adapter.id)) fail("gate.matrix-coverage", `missing ${adapter.id}`);
  }
  for (const view of ids.views) {
    if (!idsSeen.has(view.id)) fail("gate.matrix-coverage", `missing ${view.id}`);
  }
  for (const gate of gatesDoc.gates) {
    if (!idsSeen.has(gate)) fail("gate.matrix-coverage", `missing ${gate}`);
  }
  if (matrix.pins?.puppeteer !== PINS.puppeteer || matrix.pins?.vibefield !== PINS.vibefield) {
    fail("gate.pins", "matrix pins drifted");
  }
  const fragments = join(root, "plan", "matrix-fragments");
  if (!statSafe(fragments)?.isDirectory()) return;
  for (const name of readdirSync(fragments)) {
    if (!name.endsWith(".json")) continue;
    const rel = join("plan", "matrix-fragments", name);
    const data = JSON.parse(readFileSync(join(root, rel), "utf8"));
    const owner = name.replace(/\.json$/u, "");
    if (data.owner !== owner) fail("gate.matrix-coverage", `${rel} owner mismatch`);
    for (const error of validateSchema(join(root, "contracts/matrix-fragment.schema.json"), data)) {
      fail("gate.schema-subset", `${rel}: ${error}`);
    }
  }
}

function checkOwnedElsewhere(root, fail, waivers) {
  for (const rel of OWNED_ELSEWHERE) {
    if (statSafe(join(root, rel))) {
      fail(
        "gate.model-slice-ref",
        `${rel} is owned by another slice and must not be vendored here`,
      );
    }
  }
  waivers.push("model files and package-pin-check.md are absent here by ownership");
  const files = walk(root);
  for (const file of files) {
    const base = file.split("/").at(-1);
    const rel = relative(root, file);
    if (base === "model.schema.json" || base === "model.md" || base === "model.validation.json") {
      if (!OWNED_ELSEWHERE.includes(rel)) fail("gate.no-competing-model", rel);
    }
    if (COMPETING_NAMES.has(base)) fail("gate.no-competing-model", rel);
  }
}

function checkTraces(root, docs, ids, cache, fail) {
  const evidence = join(root, "evidence");
  const allowed = new Set((ids?.adapters ?? []).map((row) => row.suffix));
  for (const file of walk(evidence).filter((item) => item.endsWith(".json"))) {
    const rel = relative(root, file);
    const data = docs.get(rel) ?? JSON.parse(readFileSync(file, "utf8"));
    for (const error of validateSchema(
      join(root, "contracts/provenance.schema.json"),
      data,
      cache,
    )) {
      fail("gate.provenance-envelope", `${rel}: ${error}`);
    }
    const parts = rel.split("/");
    if (parts.length !== 3 || parts[0] !== "evidence") {
      fail("gate.trace-paths", `${rel} is not evidence/<adapterSuffix>/<fieldPath>.json`);
      continue;
    }
    const suffix = parts[1];
    const fieldPath = parts[2].replace(/\.json$/u, "");
    if (!allowed.has(suffix)) fail("gate.trace-paths", `${rel} unknown adapter`);
    if (data.adapterId !== `adapter.${suffix}`) fail("gate.trace-paths", `${rel} adapterId`);
    if (data.fieldId !== `field.${fieldPath}`) fail("gate.trace-paths", `${rel} fieldId`);
    if (ids?.doNotMint?.includes(data.fieldId)) fail("gate.ids", `${rel} mints ${data.fieldId}`);
    checkObservation(rel, data.observation, fail);
  }
}

function checkObservation(rel, observation, fail) {
  if (!observation) return;
  const empty = ["absent", "unsupported", "unknown"];
  if (empty.includes(observation.presence) && Object.hasOwn(observation, "literal")) {
    fail("gate.absence-not-zero", `${rel} stores a literal for ${observation.presence}`);
  }
  if (observation.literal === 0 && observation.zeroIsObserved !== true) {
    fail("gate.absence-not-zero", `${rel} uses 0 without zeroIsObserved`);
  }
  if (observation.synthetic === true && !(observation.syntheticLabel?.length >= 12)) {
    fail("gate.synthetic-labels", `${rel} synthetic observation needs a label`);
  }
}

function checkFixtures(root, docs, cache, fail) {
  for (const file of walk(join(root, "fixtures")).filter((item) => item.endsWith(".json"))) {
    const rel = relative(root, file);
    const data = docs.get(rel) ?? JSON.parse(readFileSync(file, "utf8"));
    for (const error of validateSchema(join(root, "contracts/fixture.schema.json"), data, cache)) {
      fail("gate.fixtures", `${rel}: ${error}`);
    }
    if (data.origin === "synthetic" && !(data.syntheticLabel?.length >= 12)) {
      fail("gate.synthetic-labels", `${rel} needs syntheticLabel`);
    }
  }
}

function checkFlows(root, docs, cache, fail) {
  for (const file of walk(join(root, "flows")).filter((item) => item.endsWith(".json"))) {
    const rel = relative(root, file);
    const data = docs.get(rel) ?? JSON.parse(readFileSync(file, "utf8"));
    for (const error of validateSchema(join(root, "contracts/flow.schema.json"), data, cache)) {
      fail("gate.flows-reach-ingestion", `${rel}: ${error}`);
    }
    if (!data.nodes?.some((node) => node.layer === "ingestion")) {
      fail("gate.flows-reach-ingestion", `${rel} has no ingestion node`);
    }
    const nodeIds = new Set((data.nodes ?? []).map((node) => node.id));
    for (const edge of data.edges ?? []) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        fail("gate.flows-reach-ingestion", `${rel} edge ${edge.from}->${edge.to}`);
      }
    }
  }
}

function checkLines(rel, data, fail) {
  walkValue(data, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (typeof value.lineStart === "number" && typeof value.lineEnd === "number") {
      if (value.lineEnd < value.lineStart) fail("gate.line-ranges", `${rel} line range`);
    }
    if (
      (value.repo === "vibefield" || value.repo === "puppeteer") &&
      typeof value.sha === "string"
    ) {
      if (value.sha !== PINS[value.repo])
        fail("gate.line-ranges", `${rel} sha is not the audit pin`);
    }
  });
}

export function validateSchema(schemaPath, data, cache = new Map()) {
  const errors = [];
  const doc = load(schemaPath, cache);
  checkNode(doc, data, doc, schemaPath, "$", errors, cache);
  return errors;
}

function checkNode(schema, data, doc, schemaPath, path, errors, cache) {
  if (schema.$ref) {
    const resolved = resolveRef(schemaPath, schema.$ref, cache);
    checkNode(resolved.schema, data, resolved.doc, resolved.path, path, errors, cache);
    return;
  }
  if (schema.allOf) {
    for (const sub of schema.allOf) checkNode(sub, data, doc, schemaPath, path, errors, cache);
  }
  if (schema.anyOf && !schema.anyOf.some((sub) => quiet(sub, data, doc, schemaPath, cache))) {
    errors.push(`${path} matched no anyOf`);
  }
  if (schema.oneOf) {
    const count = schema.oneOf.filter((sub) => quiet(sub, data, doc, schemaPath, cache)).length;
    if (count !== 1) errors.push(`${path} matched ${count} oneOf`);
  }
  if (schema.not && quiet(schema.not, data, doc, schemaPath, cache))
    errors.push(`${path} matched not`);
  if (schema.if) {
    const branch = quiet(schema.if, data, doc, schemaPath, cache) ? schema.then : schema.else;
    if (branch) checkNode(branch, data, doc, schemaPath, path, errors, cache);
  }
  if (Object.hasOwn(schema, "const") && !same(data, schema.const)) errors.push(`${path} const`);
  if (schema.enum && !schema.enum.some((item) => same(data, item))) errors.push(`${path} enum`);
  if (schema.type && !typeOk(schema.type, data)) errors.push(`${path} type ${schema.type}`);
  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength)
      errors.push(`${path} minLength`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(data))
      errors.push(`${path} pattern`);
  }
  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${path} minimum`);
    if (schema.maximum !== undefined && data > schema.maximum) errors.push(`${path} maximum`);
  }
  if (schema.required || schema.properties || schema.additionalProperties !== undefined) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      errors.push(`${path} object`);
    } else {
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(data, key)) errors.push(`${path}.${key} required`);
      }
      for (const key of Object.keys(data)) {
        if (schema.properties?.[key]) {
          checkNode(
            schema.properties[key],
            data[key],
            doc,
            schemaPath,
            `${path}.${key}`,
            errors,
            cache,
          );
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}.${key} additional`);
        }
      }
    }
  }
  if (schema.items) {
    if (!Array.isArray(data)) errors.push(`${path} array`);
    else {
      if (schema.minItems !== undefined && data.length < schema.minItems)
        errors.push(`${path} minItems`);
      if (schema.maxItems !== undefined && data.length > schema.maxItems)
        errors.push(`${path} maxItems`);
      for (let index = 0; index < data.length; index += 1) {
        checkNode(schema.items, data[index], doc, schemaPath, `${path}[${index}]`, errors, cache);
      }
    }
  }
}

function quiet(schema, data, doc, schemaPath, cache) {
  const errors = [];
  checkNode(schema, data, doc, schemaPath, "$", errors, cache);
  return errors.length === 0;
}

function resolveRef(schemaPath, ref, cache) {
  const hash = ref.indexOf("#");
  const filePart = hash === -1 ? ref : ref.slice(0, hash);
  const frag = hash === -1 ? "" : ref.slice(hash + 1);
  const path = filePart ? join(dirname(schemaPath), filePart) : schemaPath;
  const doc = load(path, cache);
  if (!frag) return { schema: doc, doc, path };
  let node = doc;
  for (const part of frag.replace(/^\//u, "").split("/")) {
    node = node?.[part];
    if (node === undefined) throw new Error(`unresolved ${ref}`);
  }
  return { schema: node, doc, path };
}

function load(path, cache) {
  const hit = cache.get(path);
  if (hit) return hit;
  const doc = JSON.parse(readFileSync(path, "utf8"));
  cache.set(path, doc);
  return doc;
}

function typeOk(type, data) {
  if (type === "object") return data !== null && typeof data === "object" && !Array.isArray(data);
  if (type === "array") return Array.isArray(data);
  if (type === "integer") return typeof data === "number" && Number.isInteger(data);
  if (type === "null") return data === null;
  return typeof data === type;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function walk(dir) {
  if (!statSafe(dir)?.isDirectory()) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function walkValue(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walkValue(item, visit);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkValue(item, visit);
  }
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const report = run(join(import.meta.dirname, "..", "..", ".."));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}
