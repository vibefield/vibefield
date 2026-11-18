#!/usr/bin/env node
// SP-4c / item 373 (2026-11-13) — the app web host compiles
// only under `#if DEBUG || VF_WEB_RELAY`, and the archive check (`apps/ios/scripts/testflight.sh`, its `web_gate`)
// refuses an archive whose app carries either of its two web markers while ship-gates.txt holds an OPEN line. Each
// marker is a literal only the host's code carries (the front's queue label, the document-start script's tag), never
// a type or file name: a plain Release build keeps the gated host file's source and object paths (an archive drops
// them; item 541's rows on real apps, 2026-11-18), which a name would match in an app that carries none of the host.
// The front's label is also the prefix of its system dial's label, in the same file and gate, so it stands more than
// once, and an app with the host reads it more than once: the archive check asks only for one or more.
// Corrected 2026-11-18 (item 541): from SP-4c until that day this said so while testflight.sh read neither the
// markers nor the gates; item 541 built the refusal. This is the source side:
// - each marker stands ONLY inside that gate's own branch (never its #else, never a comment or string outside it);
// - both markers stand only in FieldWeb's Host folder;
// - items 522 and 524 (2026-11-17, 2026-11-18): outside FieldWeb, the host and its navigation type are named only by
//   the one view that mounts the web host, the open app's page (FieldHome/Apps/Open/AppsWebPage.swift), and there
//   only on as many lines as MOUNT_ALLOWED counts; any other source naming them, gated or not, is a finding. Item
//   522's filtering front stands (the host opens a page only through it); item 524 measured what WebRTC and
//   WebTransport reach around it (ICE leaves; apps/ios/ship-gates.txt holds item 524's gate OPEN), and its ruling
//   (2026-11-18) let this one view mount it. Zero lines there is no finding, so this rule stands before the view;
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
  { name: "vibefield.web-front", only: HOST },
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
/** Items 522 and 524: the types that mount the web host, named outside FieldWeb only where MOUNT_ALLOWED says. */
export const MOUNT_NAMES = ["FieldWebAppHost", "FieldWebAppNavigation"];
/** The one view that mounts the web host, by path and its exact count of lines naming those types (R23b's form): a
 * line more or fewer there, or any other file, is a finding until this table says so. */
const MOUNT_ALLOWED = { "apps/ios/VibeFieldKit/Sources/FieldHome/Apps/Open/AppsWebPage.swift": 3 };

/** An app source outside FieldWeb that names a type which mounts the web host where MOUNT_ALLOWED does not count it. */
export function mountFindings(path, text, allowed = MOUNT_ALLOWED) {
  if (!SOURCES.some((dir) => path.startsWith(`${dir}/`)) || path.startsWith(WEB)) return [];
  const lines = [];
  text.split("\n").forEach((line, index) => {
    if (MOUNT_NAMES.some((name) => line.includes(name))) lines.push(index + 1);
  });
  const may = allowed[path] ?? 0;
  if (lines.length === 0 || lines.length === may) return [];
  if (may === 0)
    return lines.map((at) => `${path}:${at}: the web host's types in no view that may mount it`);
  return [`${path}: names the web host's types on ${lines.length} lines, ${may} allowed`];
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
  const page = "apps/ios/VibeFieldKit/Sources/FieldHome/Apps/Open/AppsWebPage.swift";
  const rows = "apps/ios/VibeFieldKit/Tests/FieldWebTests/Host/HostRowsTests.swift";
  const front = `let q = DispatchQueue(label: "${MARKERS[0].name}")`;
  const tag = `let t = "${MARKERS[1].name}"`;
  const gated = (...lines) => [`#if ${GATE}`, ...lines, "#endif"].join("\n");
  const cases = [
    ["the host, gated", host, gated("final class FieldWebAppHost {}", front, tag), 0],
    ["a comment on the #if", host, [`#if ${GATE} // the gate`, tag, "#endif"].join("\n"), 0],
    ["nested inside the gate", host, gated("#if os(iOS)", tag, "#endif"), 0],
    [
      "items 522, 524: the type in a gated FieldHome view that may not mount it",
      home,
      gated("FieldWebAppHost()"),
      1,
    ],
    [
      "item 524: the open app's page, naming the host on its three allowed lines",
      page,
      gated(
        "var host: FieldWebAppHost?",
        "try await FieldWebAppHost.open()",
        "catch FieldWebAppHost.Failure.noProxy",
      ),
      0,
    ],
    [
      "item 524: the open app's page, naming the host on two of its three lines",
      page,
      gated("var host: FieldWebAppHost?", "try await FieldWebAppHost.open()"),
      1,
    ],
    [
      "item 524: the open app's page, naming the host on a fourth line",
      page,
      gated(
        "var host: FieldWebAppHost?",
        "FieldWebAppHost.open()",
        "FieldWebAppHost.Failure",
        "FieldWebAppHost.self",
      ),
      1,
    ],
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
    ["in the gate's #else", host, gated("#else", front), 1],
    [
      "the host's type name alone is no marker: outside the gate in its own folder",
      host,
      "// FieldWebAppHost.swift",
      0,
    ],
    [
      "a comment outside the gate, outside FieldWeb",
      home,
      '/// Mounts FieldWebAppHost through "vibefield.web-front".\nstruct S {}',
      2,
    ],
    ["DEBUG alone is not the gate", host, ["#if DEBUG", tag, "#endif"].join("\n"), 1],
    ["the script tag outside Host, gated", home, gated(tag), 1],
    ["the front's label outside Host, gated", home, gated(front), 1],
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
