import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_PINS } from "./contract.mjs";

const TYPES = "packages/field-app/src/godview/monitor/types.ts";
const ROWS = "packages/field-app/src/godview/monitor/window-rows.ts";

/**
 * Independent check of the reported Vibefield overlay, against this checkout.
 * The overlay is vibefield source at the original pin's files. It is not a
 * second puppeteer dataset.
 */
export function verifyOverlay(root) {
  const typesPath = join(root, TYPES);
  const rowsPath = join(root, ROWS);
  let types = "";
  let rows = "";
  const problems = [];
  try {
    types = readFileSync(typesPath, "utf8");
  } catch {
    problems.push("types-unreadable");
  }
  try {
    rows = readFileSync(rowsPath, "utf8");
  } catch {
    problems.push("window-rows-unreadable");
  }
  const alias =
    types.includes('import type { AgentView } from "@vibefield/puppeteer-view-sdk/model"') &&
    types.includes("export type MonitorAgent = AgentView");
  const stale = rows.includes(
    'const stale = row.device.self ? row.stale : facts.standing.get(row.device.id) !== "live"',
  );
  const dropsPeerProfile =
    rows.includes("const { profileSet, visualId: _previous, ...rest } = row") &&
    rows.includes("...(row.device.self && profileSet !== undefined ? { profileSet } : {})");
  if (!alias) problems.push("monitor-agent-alias-not-found");
  if (!stale) problems.push("peer-stale-override-not-found");
  if (!dropsPeerProfile) problems.push("peer-profile-set-drop-not-found");
  const lineOf = (source, needle) => {
    const index = source.indexOf(needle);
    if (index < 0) return null;
    return source.slice(0, index).split("\n").length;
  };
  return {
    verified: problems.length === 0,
    problems,
    sourceRevision: { vibefield: AUDIT_PINS.vibefield },
    files: [
      { path: TYPES, line: lineOf(types, "export type MonitorAgent = AgentView") },
      {
        path: ROWS,
        line: lineOf(rows, "const stale = row.device.self ? row.stale"),
      },
    ],
    fields: [
      {
        fieldId: "field.stale",
        summary:
          "For a peer row, display staleness follows desktop standing !== live. The owner's stale bit is kept only when device.self.",
      },
      {
        fieldId: "field.profileSet",
        summary:
          "profileSet is copied onto the display row only when device.self. A peer's profileSet is dropped.",
      },
    ],
  };
}
