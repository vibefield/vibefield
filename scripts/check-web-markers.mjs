#!/usr/bin/env node
// SP-4c / item 373 (2026-11-13) — the app web host compiles
// only under `#if DEBUG || VF_WEB_RELAY`, and the archive check (`apps/ios/scripts/testflight.sh`) refuses a Release
// app that carries either of its two web markers while ship-gates.txt holds an OPEN line. This is the source side:
// - each marker stands ONLY inside that gate's own branch (never its #else, never a comment or string outside it);
// - the script tag stands only in FieldWeb's Host folder;
// - item 522 (2026-11-17): no app source outside FieldWeb names the host or its navigation type, gated or not, so no
//   view mounts the web host before its filtering front stands. It is unconditional. It lifts only in the front's own
//   green commit, which changes this rule and its self-test rows in the same breath as `FieldWebAppHost.open` comes
//   to take the front, so that a host without its front is then a compile error;
// - each marker stands somewhere, so a rename cannot leave the archive check searching for a name nothing carries;
// - ship-gates.txt reads in its four forms, and anything else fails closed;
// - no source and no app plist names a server-trust override: a developer's phone runs Debug builds, so a
//   Debug-only override would be a door on it. The rig's trust lives in the TEST target alone.
// Test targets are not scanned: no test is compiled into the app. `--self-test` runs its own cases.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SOURCES = ["apps/ios/VibeFieldKit/Sources", "apps/ios/App"];
const HOST = "apps/ios/VibeFieldKit/Sources/FieldWeb/Host/";
const WEB = "apps/ios/VibeFieldKit/Sources/FieldWeb/";
const SHIP_GATES = "apps/ios/ship-gates.txt";
export const GATE = "DEBUG || VF_WEB_RELAY";
export const MARKERS = [
  { name: "FieldWebAppHost", only: null },
  { name: "vibefield.web-host.document-start.v1", only: HOST },
];
export const TRUST_NAMES = [
  "URLCredential(trust:",
  "didReceive challenge",
  "respondTo challenge",
  "didReceiveAuthenticationChallenge",
  "NSURLAuthenticationMethodServerTrust",
  "SecTrustSetAnchorCertificates",
  "SecTrustSetExceptions",
  "NSAllowsArbitraryLoads",
];
/** A use that stands, by path and exact count (R23b's form). None at main bf9ebb21c (read 2026-11-13 02:03Z). */
const TRUST_ALLOWED = {};
/** Item 522: the types that mount the web host, named in no app source outside FieldWeb. */
export const MOUNT_NAMES = ["FieldWebAppHost", "FieldWebAppNavigation"];

/** Each line of an app source outside FieldWeb that names a type which mounts the web host (item 522). */
export function mountFindings(path, text) {
  if (!SOURCES.some((dir) => path.startsWith(`${dir}/`)) || path.startsWith(WEB)) return [];
  const findings = [];
  text.split("\n").forEach((line, index) => {
    for (const name of MOUNT_NAMES) {
      if (line.includes(name))
        findings.push(`${path}:${index + 1}: ${name} outside FieldWeb (item 522: no front yet)`);
    }
  });
  return findings;
}

/** Each trust-override name one file holds past its allowed count. */
export function trustFindings(path, text, allowed = TRUST_ALLOWED) {
  const findings = [];
  for (const name of TRUST_NAMES) {
    const count = text.split(name).length - 1;
    const may = allowed[path]?.[name] ?? 0;
    if (count > may) findings.push(`${path}: names ${name} ${count} times, ${may} allowed`);
  }
  return findings;
}

const condition = (text) =>
  text
    .replace(/\/\/.*$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** Each place in one Swift file where a marker stands outside the gate, and its count inside it. */
export function scan(path, text) {
  const findings = [];
  const inside = new Map(MARKERS.map((marker) => [marker.name, 0]));
  const branches = [];
  text.split("\n").forEach((line, index) => {
    const at = `${path}:${index + 1}`;
    const directive = line.trim();
    const opened = /^#if\s+(.+)$/.exec(directive);
    if (opened) {
      branches.push(condition(opened[1]) === GATE);
      return;
    }
    if (/^#(elseif|else)\b/.test(directive)) {
      if (branches.length === 0) findings.push(`${at}: #else with no #if`);
      else branches[branches.length - 1] = false;
      return;
    }
    if (/^#endif\b/.test(directive)) {
      if (branches.length === 0) findings.push(`${at}: #endif with no #if`);
      else branches.pop();
      return;
    }
    for (const marker of MARKERS) {
      if (!line.includes(marker.name)) continue;
      const gated = branches.includes(true);
      const placed = marker.only === null || path.startsWith(marker.only);
      if (gated && placed) inside.set(marker.name, inside.get(marker.name) + 1);
      else if (!gated) findings.push(`${at}: ${marker.name} outside #if ${GATE}`);
      else findings.push(`${at}: ${marker.name} outside ${marker.only}`);
    }
  });
  if (branches.length > 0) findings.push(`${path}: an #if with no #endif`);
  return { findings, inside };
}

/** ship-gates.txt: blank, `#…`, `SHIP-GATE <item> <name> OPEN`, `SHIP-GATE <item> <name> CLOSED <sha>`. */
export function readGates(text) {
  const findings = [];
  const open = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const gate = /^SHIP-GATE (\S+) (\S+) (OPEN|CLOSED [0-9a-f]{7,40})$/.exec(trimmed);
    if (!gate) findings.push(`${SHIP_GATES}:${index + 1}: not a gate line`);
    else if (gate[3] === "OPEN") open.push(`${gate[1]} ${gate[2]}`);
  });
  return { findings, open };
}

function files(dir, ending) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = `${dir}/${name}`;
    if (/Tests?$/.test(name)) return [];
    if (statSync(join(ROOT, path)).isDirectory()) return files(path, ending);
    return name.endsWith(ending) ? [path] : [];
  });
}

function check() {
  const findings = [];
  const totals = new Map(MARKERS.map((marker) => [marker.name, 0]));
  for (const path of SOURCES.flatMap((dir) => files(dir, ".swift"))) {
    const text = readFileSync(join(ROOT, path), "utf8");
    const result = scan(path, text);
    findings.push(...result.findings, ...trustFindings(path, text), ...mountFindings(path, text));
    for (const [name, count] of result.inside) totals.set(name, totals.get(name) + count);
  }
  for (const path of files("apps/ios/App", ".plist")) {
    findings.push(...trustFindings(path, readFileSync(join(ROOT, path), "utf8")));
  }
  for (const [name, count] of totals) {
    if (count === 0) findings.push(`${name} stands nowhere: rename it in testflight.sh too`);
  }
  let gates;
  try {
    gates = readGates(readFileSync(join(ROOT, SHIP_GATES), "utf8"));
  } catch {
    gates = { findings: [`${SHIP_GATES} is missing`], open: [] };
  }
  findings.push(...gates.findings);
  return { findings, totals, open: gates.open };
}

function selfTest() {
  const host = `${HOST}FieldWebAppHost.swift`;
  const home = "apps/ios/VibeFieldKit/Sources/FieldHome/Apps/Open/AppOpenScreen.swift";
  const rows = "apps/ios/VibeFieldKit/Tests/FieldWebTests/Host/HostRowsTests.swift";
  const tag = `let t = "${MARKERS[1].name}"`;
  const gated = (...lines) => [`#if ${GATE}`, ...lines, "#endif"].join("\n");
  const cases = [
    ["the host, gated", host, gated("final class FieldWebAppHost {}", tag), 0],
    ["a comment on the #if", host, [`#if ${GATE} // the gate`, tag, "#endif"].join("\n"), 0],
    ["nested inside the gate", host, gated("#if os(iOS)", tag, "#endif"), 0],
    ["item 522: the type in a gated FieldHome view", home, gated("FieldWebAppHost()"), 1],
    [
      "item 522: the navigation type in a FieldHome view",
      home,
      "let n: FieldWebAppNavigation? = nil",
      1,
    ],
    [
      "item 522: the host in FieldWeb's own Host folder",
      host,
      gated("let h: FieldWebAppHost? = nil"),
      0,
    ],
    ["item 522: a test target naming the host", rows, gated("let h = FieldWebAppHost.self"), 0],
    ["in the gate's #else", host, gated("#else", "let h: FieldWebAppHost? = nil"), 1],
    [
      "a comment outside the gate, outside FieldWeb",
      home,
      "/// Mounts FieldWebAppHost.\nstruct S {}",
      2,
    ],
    ["DEBUG alone is not the gate", host, ["#if DEBUG", tag, "#endif"].join("\n"), 1],
    ["the script tag outside Host, gated", home, gated(tag), 1],
    ["an #if with no #endif", host, `#if ${GATE}\nfinal class FieldWebAppHost {}`, 1],
    [
      "a trust override, gated",
      host,
      gated("FieldWebAppHost()", tag, "URLCredential(trust: t)"),
      1,
    ],
    ["a trust word in a plist", "apps/ios/App/Info.plist", "<key>NSAllowsArbitraryLoads</key>", 1],
  ];
  let failed = 0;
  for (const [label, path, text, want] of cases) {
    const got = path.endsWith(".plist")
      ? trustFindings(path, text).length
      : scan(path, text).findings.length +
        trustFindings(path, text).length +
        mountFindings(path, text).length;
    if (got !== want) {
      failed += 1;
      console.error(`self-test: ${label}: ${got} findings, want ${want}`);
    }
  }
  const gateCases = [
    ["SHIP-GATE item-373 sp4d-relay OPEN\n", 0, 1],
    ["# the gates\n\nSHIP-GATE item-373 sp4d-relay CLOSED 0123abcd\n", 0, 0],
    ["SHIP-GATE item-373 sp4d-relay open\n", 1, 0],
    ["SHIP-GATE item-373 OPEN\n", 1, 0],
    ["SHIP-GATE item-373 sp4d-relay CLOSED\n", 1, 0],
  ];
  for (const [text, wantFindings, wantOpen] of gateCases) {
    const got = readGates(text);
    if (got.findings.length !== wantFindings || got.open.length !== wantOpen) {
      failed += 1;
      const said = `${got.findings.length} findings, ${got.open.length} open`;
      console.error(`self-test: ship-gates ${JSON.stringify(text)}: ${said}`);
    }
  }
  const all = cases.length + gateCases.length;
  console.log(`check-web-markers self-test: ${all - failed} of ${all}`);
  return failed === 0;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest() ? 0 : 1);
} else {
  const { findings, totals, open } = check();
  for (const finding of findings) console.error(finding);
  const counts = [...totals].map(([name, count]) => `${name} ${count}`).join(", ");
  const said = `${findings.length} findings; gated: ${counts}; open ${open.length}`;
  console.log(`check-web-markers: ${said}`);
  process.exit(findings.length === 0 ? 0 : 1);
}
