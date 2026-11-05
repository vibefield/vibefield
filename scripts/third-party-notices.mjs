#!/usr/bin/env node
// Third-party notices (LP-5, the 0.9 launch): what the shipped apps include that others made, each
// with the licence text its licence requires us to pass on. Deterministic and offline: it reads files
// already on disk — the built bundles, node_modules, Cargo.lock graphs and the crate sources cargo
// extracted, a Go binary's own embedded build info, the SwiftPM checkouts — and never the network.
//
// Two outputs:
//   desktop  THIRD_PARTY_NOTICES.txt, plain text grouped by licence, every distinct licence text
//            once with the components it covers. GENERATED AT STAGE TIME by scripts/stage-package.mjs
//            into the stage's `legal/` (electron-builder ships it to Contents/Resources/legal/).
//   --ios    apps/ios/App/Resources/acknowledgements.json for the iPhone and iPad app, generated on
//            a Mac that holds the SwiftPM checkouts and COMMITTED (the iOS build runs no Node).
//
// WHY STAGE TIME FOR THE DESKTOP, not a committed snapshot (LP-5's choice, the more robust of the two):
//   - The notices then describe exactly the bits that stage ships. A snapshot goes stale at every
//     dependency move (a Dependabot bump, an EL8 event) and its freshness test needs the very
//     sources stage time already has, so it would add a second truth without removing a dependency.
//   - The release build runs with no dependency cache (EDP §12.1) but BUILDS field-native, rosettad
//     and mille's engine itself (release.yml `build`: `pnpm siblings:build`, prepare-mille,
//     `package:stage` → build:native-release), so cargo has extracted every crate it linked into
//     `$CARGO_HOME/registry/src` before the stager runs. A crate in a Cargo.lock graph whose source is
//     ABSENT was therefore not built for this host and is not in the package: it is skipped and
//     counted, never guessed. A root's own direct dependency missing means the binary was not built
//     here, which is a gap (fatal for a release stage).
//   - The ONE input a release host cannot have is the Go module cache behind the npm-prebuilt mesh
//     sidecar (`@vibecook/truffle-sidecar-*`; no Go toolchain runs in a release). That piece alone is
//     committed: apps/desktop/packaging/notices/go-modules.json, written by `--refresh-go-modules` on
//     a host with the cache, and checked at every stage against the module list the sidecar binary
//     itself embeds (Go build info). The sidecar moves only in an EL8 event, so the check fires
//     exactly then.
//
// What it reads for the desktop:
//   - npm, BUNDLED: the esbuild bundles keep a `// <path>` comment per module (main, preload, fieldd's
//     SEA bundle and its workers), so the packages are read off the bundles themselves. The renderer
//     (Vite, minified) keeps none, so it is the production-dependency closure of @vibefield/field-app
//     (dependencies and optionalDependencies, never devDependencies; a peer is satisfied by its host's
//     own dependency, so peers are not followed), plus the bundled plugins' closures. Build tools
//     whose OUTPUT ships are named too: tailwindcss (its preflight is in the CSS), vite (its preload
//     helper), esbuild (its runtime helpers).
//   - cargo: field-native and its two host binaries (this repo's Cargo.lock), rosettad (the rosetta
//     checkout's lock) and mille's Node-API engine (the lock of the checkout its addon was built in,
//     or, once mille is released, its prebuilt package's own files — `milleEngine`), walked from the
//     root crates over normal and build edges whose `cfg(...)` holds for this target. rosetta is the
//     owner's own and UNLICENSED: it is listed as VibeField's own component, never as third-party.
//     Code others made that a crate compiles in or links beyond its root licence is a component of
//     its own (NATIVE_LINKS): Ghostty's VT core (libghostty-vt, MIT) and the simdutf, Highway, Wuffs
//     and Zig compiler_rt its static library carries (ghosttea-vt-sys), libwebp (libwebp-sys), zstd
//     (zstd-sys), and fiat-crypto and once_cell (ring). A crate that compiles native code with licence
//     files below its root, or with none at all, and no NATIVE_LINKS row is a gap.
//   - Go: the sidecar's build info, its texts from the committed snapshot.
//   - Vendored art: the desk's handwriting fonts (OFL-1.1), Simple Icons' OS marks (CC0-1.0), Lobe
//     Icons' agent marks (MIT), and the CC BY 3.0 credit for "Sparks from Fire" while ghosttea-react
//     (whose WGSL effects include its port) is in the renderer.
//   - A required attribution no text carries is a gap (REQUIRED_DESKTOP, REQUIRED_IOS): the guard
//     against a graph change silently dropping Ghostty's notice or the CC BY credit.
//   - Beside the notices, the stager copies Electron's LICENSE and LICENSES.chromium.html (finding:
//     electron-builder 26.15.7 DELETES both from a macOS app — app-builder-lib
//     `out/electron/electronMac.js:219-220` unlinks them — so no macOS VibeField has shipped them) and
//     Node.js's LICENSE for the fieldd SEA (a copy of the Node that runs the stager).
//
// Usage:
//   node scripts/third-party-notices.mjs [--root <repo>] [--out <file>]
//       the desktop notices from a built tree (`pnpm build`, fieldd's dist), printed summary; --out writes them
//   node scripts/third-party-notices.mjs --ios --checkouts <SourcePackages/checkouts> [--artifacts <SourcePackages/artifacts>] [--gomodcache <dir>]
//       writes apps/ios/App/Resources/acknowledgements.json (--out to write elsewhere)
//   node scripts/third-party-notices.mjs --refresh-go-modules [--gomodcache <dir>]
//       rewrites apps/desktop/packaging/notices/go-modules.json from the installed sidecar binary
//
// Node >=22 ESM, builtins only.
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RULE = "=".repeat(80);
const THIN = "-".repeat(80);
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";
export const GO_SNAPSHOT = "apps/desktop/packaging/notices/go-modules.json";
export const IOS_OUTPUT = "apps/ios/App/Resources/acknowledgements.json";

// ---- texts: normalising, naming, classifying -------------------------------------------------------
/** One spelling per text, so two copies of one licence dedupe whatever their line endings. */
export function normalizeText(raw) {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/** One line of words: what two copies of a text that differ only in wrapping or indent share. */
const collapse = (body) => normalizeText(body).replace(/\s+/g, " ").trim();

/**
 * A text's id: the first 12 hex of the SHA-256 of its words (whitespace collapsed), so two copies
 * that differ only in wrapping or indentation are one text — stable across runs and versions.
 */
export function textId(body) {
  return createHash("sha256").update(collapse(body)).digest("hex").slice(0, 12);
}

/** The licence groups, in the order the file reads them. */
export const KIND_ORDER = [
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "BSD-2-Clause",
  "ISC",
  "0BSD",
  "Zlib",
  "Unicode",
  "BSL-1.0",
  "MPL-2.0",
  "CDLA-Permissive-2.0",
  "OFL-1.1",
  "CC-BY-3.0",
  "CC0-1.0",
  "Unlicense",
  "MIT-0",
  "BlueOak-1.0.0",
  "PSF-2.0",
  "LGPL",
  "GPL",
  "AGPL",
  "Patent grant",
  "Notices",
  "Other",
];

/** Licences whose terms reach the source: their components carry a Source line in the notices. */
export const COPYLEFT = new Set(["MPL-2.0", "LGPL", "GPL", "AGPL"]);

/**
 * A text's words for classifying it: the comment markers a licence copied out of a source header keeps at each
 * line's start (`// `, `# `, ` * `, `/*`) are not its words (untrusted's LICENSE.txt is ISC written as `//` lines).
 * Classification only: a text's id and its printed body keep every character.
 */
const wordsOf = (body) =>
  collapse(
    normalizeText(body)
      .split("\n")
      .map((line) => line.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?|#+|;+)[ \t]?/, ""))
      .join("\n"),
  );

/**
 * Which licence a text is, read from its words (a NOTICE file is a notice whatever it quotes). The
 * title-bearing licences are read from the text's head first: the MPL's own text names the GPL, and an
 * Apache appendix can quote anything, so "mentions" is not "is". MIT and MIT-0 differ by the attribution
 * clause alone, which the X11 spelling writes as "this permission notice (including the next paragraph) shall be
 * included" (bytemuck's): MIT, never the no-attribution MIT-0.
 */
export function classifyText(body, file = "") {
  const t = wordsOf(body);
  const head = t.slice(0, 400);
  if (/notice|third[-_ ]?party/i.test(file)) return "Notices";
  if (/Mozilla Public License,? (Version|v\.?) ?2\.0/i.test(head)) return "MPL-2.0";
  if (/Apache License,? Version 2\.0/i.test(head)) return "Apache-2.0";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(head)) return "AGPL";
  if (/GNU (LESSER|LIBRARY) GENERAL PUBLIC LICENSE/i.test(head)) return "LGPL";
  if (/GNU GENERAL PUBLIC LICENSE/i.test(head)) return "GPL";
  if (/Apache License,? Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/Mozilla Public License,? (Version|v\.?) ?2\.0/i.test(t)) return "MPL-2.0";
  if (/SIL OPEN FONT LICENSE/i.test(t)) return "OFL-1.1";
  if (/Boost Software License/i.test(t)) return "BSL-1.0";
  if (/Community Data License Agreement/i.test(t)) return "CDLA-Permissive-2.0";
  if (/UNICODE LICENSE V3|Unicode, Inc\.|UNICODE, INC\./.test(t)) return "Unicode";
  if (/free and unencumbered software released into the public domain/i.test(t)) return "Unlicense";
  if (/CC0 1\.0 Universal|Creative Commons Zero|\bCC0[- ]1\.0\b/i.test(t)) return "CC0-1.0";
  if (/creativecommons\.org\/licenses\/by\/3\.0|Attribution 3\.0|\bCC BY 3\.0\b/i.test(t))
    return "CC-BY-3.0";
  if (/Permission is hereby granted, free of charge/i.test(t))
    return /above copyright notice and this permission notice(?:\s*\([^)]*\))?\s*shall be included/i.test(
      t,
    )
      ? "MIT"
      : "MIT-0";
  if (/Redistribution and use in source and binary forms/i.test(t))
    return /Neither the name|names of (its|the) contributors|name of the copyright holder nor/i.test(
      t,
    )
      ? "BSD-3-Clause"
      : "BSD-2-Clause";
  if (/Permission to use, copy, modify, and\/?or distribute this software for any purpose/i.test(t))
    return /provided that the above copyright notice/i.test(t) ? "ISC" : "0BSD";
  if (/provided ['‘’"]?as-is['‘’"]?, without any express or implied warranty/i.test(t))
    return "Zlib";
  if (/Additional IP Rights Grant \(Patents\)/i.test(t)) return "Patent grant";
  if (/Blue ?Oak Model License/i.test(t)) return "BlueOak-1.0.0";
  if (/Python Software Foundation/i.test(t)) return "PSF-2.0";
  return "Other";
}

/**
 * A text's group from its words and the names of the files that carry it — each file's own name, never the directory
 * it sits in (`third_party/fiat/LICENSE` is a licence, whatever its folder is called).
 */
const NOTICE_NAME = /notice|third[-_ ]?party/i;
function kindOfText(body, files) {
  const names = [...files].map((f) => basename(f));
  return names.length > 0 && names.every((f) => NOTICE_NAME.test(f))
    ? "Notices"
    : classifyText(body);
}

/** The group a DECLARED licence expression reads under when its package ships no text. */
export function kindOfExpression(expr) {
  if (!expr) return "Other";
  const first = String(expr)
    .replace(/[()]/g, " ")
    .split(/\s+|\//)
    .find((tok) => tok && !/^(AND|OR|WITH)$/i.test(tok));
  if (!first) return "Other";
  const id = first.replace(/-(only|or-later)$/, "").replace(/\+$/, "");
  if (/^Unicode/i.test(id)) return "Unicode";
  if (/^LGPL/i.test(id)) return "LGPL";
  if (/^AGPL/i.test(id)) return "AGPL";
  if (/^GPL/i.test(id)) return "GPL";
  if (/^OFL/i.test(id)) return "OFL-1.1";
  if (/^CC-BY-3/i.test(id)) return "CC-BY-3.0";
  const known = KIND_ORDER.find((k) => k.toLowerCase() === id.toLowerCase());
  return known ?? "Other";
}

// ---- the ledger: components and the texts they carry ------------------------------------------------
const ECOSYSTEM_ORDER = ["npm", "crate", "go", "swift", "asset", "other"];
/** Each ecosystem's words: one, several (in a sentence), and its heading in the index. */
const ECOSYSTEM_LABEL = {
  npm: ["npm package", "npm packages", "npm packages"],
  crate: ["Rust crate", "Rust crates", "Rust crates"],
  go: ["Go module", "Go modules", "Go modules"],
  swift: ["Swift package", "Swift packages", "Swift packages"],
  asset: ["font or piece of art", "fonts and art", "Fonts and art"],
  other: ["other component", "other components", "Other components"],
};

/** Where a component's source can be had, for the licences whose terms reach it. */
export function sourceUrl(c) {
  if (c.ecosystem === "npm") return `https://www.npmjs.com/package/${c.name}/v/${c.version}`;
  if (c.ecosystem === "crate") return `https://crates.io/crates/${c.name}/${c.version}`;
  if (c.ecosystem === "go" && c.name.includes("."))
    return `https://pkg.go.dev/${c.name}@${c.version}`;
  return null;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const componentOrder = (a, b) =>
  ECOSYSTEM_ORDER.indexOf(a.ecosystem) - ECOSYSTEM_ORDER.indexOf(b.ecosystem) ||
  byText(a.name.toLowerCase(), b.name.toLowerCase()) ||
  byText(a.name, b.name) ||
  byText(a.version, b.version);

/** A run's ledger. Components dedupe by ecosystem/name/version; texts by their normalised hash. */
export function createLedger() {
  const components = new Map();
  const texts = new Map();
  const ledger = {
    components,
    texts,
    /** Problems that make the output wrong (unreadable input). */
    errors: [],
    /** Gaps: a component whose licence could not be established. Fatal for a release stage. */
    gaps: [],
    /** What was deliberately left out, with why (counted in the summary, never in the file). */
    skipped: [],
    addText(body, file = "") {
      const normalized = normalizeText(body);
      if (!normalized) return null;
      const id = textId(normalized);
      // Read order never shows: of two spellings of one text (they differ only in wrapping) the smaller is kept,
      // and a text reads as a notice only when every file that carries it is named as one.
      const existing = texts.get(id);
      if (existing) {
        if (file) existing.files.add(file);
        if (normalized < existing.body) existing.body = normalized;
        existing.kind = kindOfText(existing.body, existing.files);
        return id;
      }
      const files = new Set(file ? [file] : []);
      texts.set(id, { id, body: normalized, kind: kindOfText(normalized, files), files });
      return id;
    },
    add({ ecosystem, name, version = "", licence = null, texts: given = [], role, own, note }) {
      const key = `${ecosystem}\u0000${name}\u0000${version}`;
      const ids = given.map((t) => ledger.addText(t.body, t.file)).filter(Boolean);
      const existing = components.get(key);
      if (existing) {
        for (const id of ids) if (!existing.texts.includes(id)) existing.texts.push(id);
        existing.texts.sort();
        if (!existing.licence && licence) existing.licence = licence;
        if (role && !existing.roles.includes(role)) existing.roles.push(role);
        existing.roles.sort();
        if (own) existing.own = true;
        if (note && !existing.note) existing.note = note;
        return existing;
      }
      const component = {
        ecosystem,
        name,
        version: String(version ?? ""),
        licence: licence ? String(licence) : null,
        texts: [...new Set(ids)].sort(),
        roles: role ? [role] : [],
        own: own === true,
        note: note ?? null,
      };
      components.set(key, component);
      return component;
    },
  };
  return ledger;
}

/** Wrap a list of names to the file's width, under a hanging indent. */
function wrapList(lead, items, width = 80, indent = "  ") {
  const lines = [];
  let line = lead;
  for (const [i, item] of items.entries()) {
    const piece = i === items.length - 1 ? item : `${item},`;
    if (line.length + 1 + piece.length > width && line.trim() !== lead.trim()) {
      lines.push(line);
      line = `${indent}${piece}`;
    } else line = line.endsWith(" ") || line === "" ? `${line}${piece}` : `${line} ${piece}`;
  }
  lines.push(line);
  return lines.join("\n");
}

const label = (c) => (c.version ? `${c.name} ${c.version}` : c.name);

/**
 * The plain-text notices. Same ledger, same bytes: every list is sorted, no time or host is
 * written, and only the texts some component uses appear.
 */
export function renderNotices(
  ledger,
  { product = "VibeField", version = "", externals = [] } = {},
) {
  const all = [...ledger.components.values()].sort(componentOrder);
  const own = all.filter((c) => c.own);
  const third = all.filter((c) => !c.own);
  const used = new Map();
  for (const c of third)
    for (const id of c.texts) {
      if (!used.has(id)) used.set(id, []);
      used.get(id).push(c);
    }
  const declaredOnly = third.filter((c) => c.texts.length === 0);
  const out = [];
  const title = `${product}${version ? ` ${version}` : ""} — third-party notices`;
  out.push(title, "=".repeat(title.length), "");
  out.push(
    `${product} includes software and art that others made. Each component below is used`,
    "under its own licence. The index names every component and the licence texts that",
    "cover it; the texts follow, grouped by licence, each distinct text given once with the",
    "components it covers.",
    "",
  );
  if (externals.length > 0) {
    out.push("In this folder, beside this file:");
    for (const e of externals) out.push(`  ${e.file} — ${e.what}`);
    out.push("");
  }
  const counts = ECOSYSTEM_ORDER.map((e) => [e, third.filter((c) => c.ecosystem === e).length])
    .filter(([, n]) => n > 0)
    .map(([e, n]) => `${n} ${n === 1 ? ECOSYSTEM_LABEL[e][0] : ECOSYSTEM_LABEL[e][1]}`);
  out.push(`Components: ${third.length} (${counts.join(", ")})`);
  out.push(`Distinct licence texts: ${used.size}`);
  out.push("");
  if (own.length > 0) {
    out.push(RULE, `${product.toUpperCase()}'S OWN COMPONENTS`, RULE, "");
    out.push(
      `These are ${product}'s own, made by its owner and not licensed separately; they are`,
      "listed so the inventory is whole.",
      "",
    );
    for (const c of own) out.push(`  ${label(c)}${c.note ? ` — ${c.note}` : ""}`);
    out.push("");
  }
  out.push(RULE, "COMPONENT INDEX", RULE, "");
  for (const eco of ECOSYSTEM_ORDER) {
    const group = third.filter((c) => c.ecosystem === eco);
    if (group.length === 0) continue;
    out.push(ECOSYSTEM_LABEL[eco][2], "");
    for (const c of group) {
      const kinds = [...new Set(c.texts.map((id) => ledger.texts.get(id).kind))];
      const lic = c.licence ?? kinds.join(", ");
      const docs = c.texts.length > 0 ? c.texts.join(", ") : "no licence file in the package";
      out.push(`  ${label(c)}`);
      out.push(`    Licence: ${lic || "not declared"}`);
      if (c.roles.length > 0) out.push(`    In ${product}: ${c.roles.join("; ")}`);
      if (c.note) out.push(`    Note: ${c.note}`);
      out.push(`    Texts: ${docs}`);
      const copyleft =
        kinds.some((k) => COPYLEFT.has(k)) || COPYLEFT.has(kindOfExpression(c.licence));
      if (copyleft && sourceUrl(c)) out.push(`    Source: ${sourceUrl(c)} (unmodified)`);
    }
    out.push("");
  }
  out.push(RULE, "LICENCE TEXTS", RULE, "");
  for (const kind of KIND_ORDER) {
    const texts = [...used.keys()]
      .map((id) => ledger.texts.get(id))
      .filter((t) => t.kind === kind)
      .sort(
        (a, b) => byText(label(used.get(a.id)[0]), label(used.get(b.id)[0])) || byText(a.id, b.id),
      );
    const bare = declaredOnly.filter((c) => kindOfExpression(c.licence) === kind);
    if (texts.length === 0 && bare.length === 0) continue;
    out.push(RULE, kind, RULE, "");
    for (const t of texts) {
      const users = used.get(t.id).map(label);
      out.push(THIN);
      out.push(`${t.id}${t.files.size > 0 ? ` · ${[...t.files].sort().join(", ")}` : ""}`);
      out.push(wrapList("Used by:", users, 80, "  "));
      out.push(THIN, "", t.body, "");
    }
    if (bare.length > 0) {
      out.push(THIN);
      out.push(
        wrapList(
          `Also under ${kind}, as each package declares (it ships no licence file of its own):`,
          bare.map((c) => `${label(c)} (${c.licence ?? "not declared"})`),
          80,
          "  ",
        ),
      );
      out.push("");
    }
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * The iOS acknowledgements: the same ledger as JSON for the Settings page to draw. `texts` holds each
 * distinct text once; a component names the ids it uses. Sorted, so the same inputs give the same bytes.
 */
export function renderAcknowledgements(ledger, meta = {}) {
  const all = [...ledger.components.values()].sort(componentOrder);
  const usedIds = new Set(all.flatMap((c) => c.texts));
  const texts = [...usedIds]
    .sort()
    .map((id) => ledger.texts.get(id))
    .map((t) => ({ id: t.id, kind: t.kind, files: [...t.files].sort(), body: t.body }));
  const doc = {
    schema: 1,
    note:
      "GENERATED by `node scripts/third-party-notices.mjs --ios` (LP-5) from the SwiftPM checkouts the " +
      "pins below name. Never edit by hand; regenerate when a pin moves.",
    ...meta,
    components: all.map((c) => ({
      ecosystem: c.ecosystem,
      name: c.name,
      version: c.version,
      licence: c.licence ?? [...new Set(c.texts.map((id) => ledger.texts.get(id).kind))].join(", "),
      ...(c.roles.length > 0 ? { roles: c.roles } : {}),
      ...(c.note ? { note: c.note } : {}),
      ...(c.own ? { own: true } : {}),
      texts: c.texts,
    })),
    texts,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ---- licence files on disk --------------------------------------------------------------------------
const LICENCE_FILE =
  /^(licen[cs]e|copying|notice|notices|copyright|unlicense|patents|third[-_]party[-_]notices|credits)([-._].*)?$/i;
const CODE_EXT = /\.(go|rs|[cm]?[jt]sx?|py|sh|json|toml|ya?ml|html?|c|h|swift|zig|in)$/i;

/** The licence texts a package or crate carries at its root, sorted by file name. */
export function licenceFiles(dir) {
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of names.sort((a, b) => byText(a.name, b.name))) {
    if (!LICENCE_FILE.test(entry.name) || CODE_EXT.test(entry.name)) continue;
    const abs = join(dir, entry.name);
    try {
      if (!statSync(abs).isFile()) continue;
      const body = readFileSync(abs, "utf8");
      if (normalizeText(body)) out.push({ file: entry.name, body });
    } catch {}
  }
  return out;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const realOrNull = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};
const inside = (child, parent) => child === parent || child.startsWith(parent + sep);

// ---- npm --------------------------------------------------------------------------------------------
/** The module paths an esbuild bundle names in its `// <path>` comments (one per bundled module). */
export function bundleModulePaths(source) {
  const out = new Set();
  for (const m of source.matchAll(
    /^\/\/ ((?:\.\.\/)*[^\s/][^\s]*\.(?:[cm]?[jt]sx?|json|node|wasm|css))$/gm,
  ))
    out.add(m[1]);
  return [...out].sort();
}

/** The package directory a module path belongs to: its innermost `node_modules/<name>`. */
export function nodeModulesPackage(path) {
  const parts = path.split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0 || at + 1 >= parts.length) return null;
  const scoped = parts[at + 1].startsWith("@");
  if (scoped && at + 2 >= parts.length) return null;
  return parts.slice(0, at + (scoped ? 3 : 2)).join("/");
}

/** Node's resolution of a bare package name from a directory, to the package's real directory. */
export function resolvePackage(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    if (basename(dir) !== "node_modules") {
      const candidate = join(dir, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return realOrNull(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The nearest directory at or above `dir` with a package.json that names a package. */
function namedPackageDir(dir, stop) {
  let at = dir;
  for (;;) {
    const file = join(at, "package.json");
    if (existsSync(file)) {
      try {
        if (readJson(file).name) return at;
      } catch {}
    }
    const parent = dirname(at);
    if (parent === at || (stop && !inside(parent, stop))) return null;
    at = parent;
  }
}

function npmLicence(pkg) {
  const raw = pkg.license ?? pkg.licenses;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((l) => l?.type ?? String(l)).join(" OR ");
  return raw.type ?? null;
}

const OWNER_SCOPES = ["@vibefield/", "@vibecook/"];

/**
 * One npm package into the ledger. A package inside the repository and outside node_modules is
 * VibeField's own workspace and is not listed; an owner-scoped UNLICENSED package is the owner's own.
 * A linked sibling package with no licence file of its own takes its checkout's root licence.
 */
export function addNpmPackage(ledger, dir, { repoRoot, role } = {}) {
  const real = realOrNull(dir) ?? dir;
  if (repoRoot && inside(real, repoRoot) && !real.split(sep).includes("node_modules")) return null;
  let pkg;
  try {
    pkg = readJson(join(real, "package.json"));
  } catch {
    ledger.errors.push(`unreadable package.json in ${relativeTo(repoRoot, real)}`);
    return null;
  }
  const licence = npmLicence(pkg);
  let texts = licenceFiles(real);
  const seeFile = /^SEE LICEN[CS]E IN (.+)$/i.exec(licence ?? "")?.[1];
  if (seeFile && existsSync(join(real, seeFile)))
    texts = [...texts, { file: seeFile, body: readFileSync(join(real, seeFile), "utf8") }];
  const isLicence = (t) => !/notice|third|credit|patent/i.test(t.file);
  if (!texts.some(isLicence) && !real.split(sep).includes("node_modules")) {
    // A `link:` sibling package (mille, mille-ui): the checkout's root carries the licence.
    let at = dirname(real);
    while (at !== dirname(at)) {
      const found = licenceFiles(at).filter(isLicence);
      if (found.length > 0) {
        texts = [...texts, ...found];
        break;
      }
      if (existsSync(join(at, ".git"))) break;
      at = dirname(at);
    }
  }
  const owner = OWNER_SCOPES.some((s) => pkg.name?.startsWith(s));
  if (/^UNLICEN[SC]ED$/i.test(licence ?? "")) {
    if (owner)
      return ledger.add({
        ecosystem: "npm",
        name: pkg.name,
        version: pkg.version,
        own: true,
        note: "the owner's own, not licensed separately",
      });
    ledger.gaps.push(
      `${pkg.name} ${pkg.version} declares UNLICENSED — no licence is granted to ship it`,
    );
  }
  if (texts.length === 0 && !licence)
    ledger.gaps.push(
      `${pkg.name} ${pkg.version} (npm) carries no licence file and declares no licence`,
    );
  return ledger.add({
    ecosystem: "npm",
    name: pkg.name,
    version: pkg.version,
    licence,
    texts,
    role,
  });
}

function relativeTo(root, abs) {
  if (!root) return abs;
  const rel = relative(root, abs);
  return rel.startsWith("..") ? basename(abs) : rel;
}

/**
 * The npm packages an esbuild bundle carries, read off its module comments. `base` is the directory
 * esbuild resolved those paths against (the bundling package's own).
 */
export function collectBundle(ledger, { file, base, repoRoot, role }) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    ledger.errors.push(`no bundle at ${relativeTo(repoRoot, file)} — build it first`);
    return 0;
  }
  const paths = bundleModulePaths(source);
  if (paths.length === 0) {
    // A minified bundle keeps no module comments; attributing nothing would be a silent lie.
    ledger.errors.push(
      `${relativeTo(repoRoot, file)} names no modules (minified?) — its packages cannot be read off it`,
    );
    return 0;
  }
  const dirs = new Set();
  for (const p of paths) {
    const pkgPath = nodeModulesPackage(p);
    if (pkgPath) {
      const dir = resolve(base, pkgPath);
      if (existsSync(join(dir, "package.json"))) dirs.add(realOrNull(dir) ?? dir);
      else
        ledger.errors.push(
          `${relativeTo(repoRoot, file)} names ${pkgPath}, which is not installed`,
        );
      continue;
    }
    const abs = resolve(base, p);
    if (repoRoot && inside(abs, repoRoot)) continue; // the repository's own source
    const dir = namedPackageDir(dirname(abs));
    if (dir) dirs.add(realOrNull(dir) ?? dir);
    else ledger.errors.push(`${relativeTo(repoRoot, file)} names ${p}, outside any package`);
  }
  for (const dir of [...dirs].sort()) addNpmPackage(ledger, dir, { repoRoot, role });
  return dirs.size;
}

/**
 * Whether an installed package is for this host, by its own `os` and `cpu` fields (npm's rule: a
 * `!`-prefixed entry excludes, any plain entry restricts). pnpm installs another platform's optional
 * package only under `supportedArchitectures`; when one is on disk anyway it still does not ship.
 */
export function forThisHost(dir, platform = process.platform, arch = process.arch) {
  let pkg;
  try {
    pkg = readJson(join(dir, "package.json"));
  } catch {
    return true;
  }
  const allows = (list, value) => {
    if (!Array.isArray(list) || list.length === 0) return true;
    if (list.includes(`!${value}`)) return false;
    const plain = list.filter((v) => !String(v).startsWith("!"));
    return plain.length === 0 || plain.includes(value);
  };
  return allows(pkg.os, platform) && allows(pkg.cpu, arch);
}

/**
 * The production-dependency closure of workspace packages: dependencies and installed
 * optionalDependencies, transitively; never devDependencies; peers are their host's to declare.
 */
export function collectClosure(
  ledger,
  { roots, repoRoot, role, platform = process.platform, arch = process.arch },
) {
  const seen = new Set();
  const queue = roots.map((r) => realOrNull(r) ?? r);
  while (queue.length > 0) {
    const dir = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let pkg;
    try {
      pkg = readJson(join(dir, "package.json"));
    } catch {
      ledger.errors.push(`unreadable package.json in ${relativeTo(repoRoot, dir)}`);
      continue;
    }
    addNpmPackage(ledger, dir, { repoRoot, role });
    const deps = [
      ...Object.keys(pkg.dependencies ?? {}).map((name) => ({ name, optional: false })),
      ...Object.keys(pkg.optionalDependencies ?? {}).map((name) => ({ name, optional: true })),
    ].sort((a, b) => byText(a.name, b.name));
    for (const dep of deps) {
      const target = resolvePackage(dir, dep.name);
      if (target && dep.optional && !forThisHost(target, platform, arch)) {
        ledger.skipped.push(`${dep.name} (npm; an optional package for another platform)`);
        continue;
      }
      if (target) queue.push(target);
      else if (!dep.optional && !pkg.optionalDependencies?.[dep.name])
        ledger.gaps.push(`${pkg.name} depends on ${dep.name}, which is not installed`);
    }
  }
  return seen.size;
}

// ---- cargo ------------------------------------------------------------------------------------------
/** Cargo.lock's packages: name, version, source (null for a path member) and dependency strings. */
export function parseCargoLock(text) {
  const packages = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const get = (key) => new RegExp(`^${key} = "([^"]*)"`, "m").exec(block)?.[1] ?? null;
    const list = /^dependencies = \[([\s\S]*?)\]/m.exec(block)?.[1] ?? "";
    packages.push({
      name: get("name"),
      version: get("version"),
      source: get("source"),
      deps: [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\s*\(.*\)$/, "")),
    });
  }
  return packages;
}

/** TOML's dotted key, honouring quoted segments (`target."cfg(unix)".dependencies`). */
export function splitDottedKey(raw) {
  const parts = [];
  let i = 0;
  const s = raw.trim();
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === '"') {
      let v = "";
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          v += s[i + 1];
          i += 2;
        } else v += s[i++];
      }
      parts.push(v);
      i++;
    } else if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      parts.push(s.slice(i + 1, end < 0 ? s.length : end));
      i = end < 0 ? s.length : end + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) break;
      parts.push(m[0]);
      i += m[0].length;
    }
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === ".") i++;
    else break;
  }
  return parts;
}

/** Strip a TOML comment and report the line's bracket balance, both outside strings. */
function scanLine(line) {
  let out = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (quote === '"' && ch === "\\") {
        out += line[i + 1] ?? "";
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "#") break;
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    out += ch;
  }
  return { text: out.trim(), depth };
}

const DEP_KIND = {
  dependencies: "normal",
  "dev-dependencies": "dev",
  dev_dependencies: "dev",
  "build-dependencies": "build",
  build_dependencies: "build",
};

function depTableOf(parts) {
  if (parts.length >= 1 && DEP_KIND[parts[0]])
    return parts.length <= 2 ? { kind: DEP_KIND[parts[0]], target: null, name: parts[1] } : null;
  if (parts[0] === "target" && parts.length >= 3 && DEP_KIND[parts[2]])
    return parts.length <= 4
      ? { kind: DEP_KIND[parts[2]], target: parts[1], name: parts[3] }
      : null;
  return null;
}

const unquote = (v) =>
  /^"((?:[^"\\]|\\.)*)"/.exec(v.trim())?.[1] ?? /^'([^']*)'/.exec(v.trim())?.[1] ?? null;

/**
 * What a Cargo.toml says about its package and its dependency declarations: each declaration's
 * table key, the crate it names (`package = …` renames), its kind and its target condition.
 */
export function parseManifest(text) {
  const out = {
    name: null,
    version: null,
    license: null,
    licenseFile: null,
    links: null,
    deps: [],
    workspace: null,
  };
  let table = [];
  let depth = 0;
  let current = null;
  let multiline = null;
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    // A multi-line string ("""…""" or '''…''') is skipped whole: a line inside it is not TOML.
    if (multiline) {
      if (lines[li].includes(multiline)) multiline = null;
      continue;
    }
    const opener = /=\s*("""|''')/.exec(lines[li]);
    if (opener && lines[li].split(opener[1]).length === 2) {
      multiline = opener[1];
      continue;
    }
    const { text: line, depth: delta } = scanLine(lines[li]);
    if (depth > 0) {
      depth += delta;
      continue;
    }
    if (!line) continue;
    if (line.startsWith("[[")) {
      table = ["[["];
      current = null;
      continue;
    }
    if (line.startsWith("[")) {
      table = splitDottedKey(line.slice(1, line.lastIndexOf("]")));
      current = null;
      const dep = depTableOf(table);
      if (dep?.name) {
        current = { key: dep.name, crate: dep.name, kind: dep.kind, target: dep.target };
        out.deps.push(current);
      }
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = splitDottedKey(line.slice(0, eq));
    const value = line.slice(eq + 1).trim();
    if (delta > 0) depth += delta;
    const dep = depTableOf(table);
    if (dep && !dep.name) {
      let rec = out.deps.find(
        (d) => d.key === key[0] && d.kind === dep.kind && d.target === dep.target,
      );
      if (!rec) {
        rec = { key: key[0], crate: key[0], kind: dep.kind, target: dep.target };
        out.deps.push(rec);
      }
      const renamed = /(?:^|[{,\s])package\s*=\s*"([^"]+)"/.exec(value)?.[1];
      if (renamed) rec.crate = renamed;
      if (key[1] === "package") rec.crate = unquote(value) ?? rec.crate;
      if (
        /(?:^|[{,\s])optional\s*=\s*true/.test(value) ||
        (key[1] === "optional" && value === "true")
      )
        rec.optional = true;
      continue;
    }
    if (current && key.length === 1 && key[0] === "package") {
      current.crate = unquote(value) ?? current.crate;
      continue;
    }
    if (current && key.length === 1 && key[0] === "optional") {
      current.optional = value === "true";
      continue;
    }
    if (table.length === 1 && table[0] === "package" && key.length === 1) {
      if (key[0] === "name") out.name = unquote(value);
      else if (key[0] === "version") out.version = unquote(value);
      else if (key[0] === "license") out.license = unquote(value);
      else if (key[0] === "license-file") out.licenseFile = unquote(value);
      else if (key[0] === "links") out.links = unquote(value);
      continue;
    }
    if (table.length === 1 && table[0] === "package" && key[1] === "workspace") {
      if (key[0] === "license") out.license = out.license ?? { workspace: true };
      if (key[0] === "version") out.version = out.version ?? { workspace: true };
      continue;
    }
    if (table[0] === "workspace") {
      out.workspace ??= { members: [], version: null, license: null };
      if (table.length === 1 && key[0] === "members") {
        let arr = value;
        let at = li;
        let bal = scanLine(arr).depth;
        while (bal > 0 && at + 1 < lines.length) {
          at++;
          const next = scanLine(lines[at]);
          arr += ` ${next.text}`;
          bal += next.depth;
        }
        out.workspace.members = [...arr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
        li = at;
        depth = 0;
      } else if (table[1] === "package" && table.length === 2) {
        if (key[0] === "version") out.workspace.version = unquote(value);
        if (key[0] === "license") out.workspace.license = unquote(value);
      }
    }
  }
  return out;
}

/** A `cfg(...)` expression, or a bare target triple, against a target's facts. */
export function cfgMatches(spec, target) {
  if (!spec) return true;
  const m = /^cfg\(([\s\S]*)\)$/.exec(spec.trim());
  if (!m) return spec.trim() === target.triple;
  const tokens = [];
  const src = m[1];
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (/\s/.test(ch)) i++;
    else if ("(),=".includes(ch)) {
      tokens.push({ v: ch, p: true });
      i++;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new Error(`cfg: cannot read ${spec}`);
      tokens.push({ v: src.slice(i + 1, end), s: true });
      i = end + 1;
    } else {
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))?.[0];
      if (!id) throw new Error(`cfg: cannot read ${spec}`);
      tokens.push({ v: id });
      i += id.length;
    }
  }
  let i = 0;
  const pred = () => {
    const t = tokens[i++];
    if (!t || t.p || t.s) throw new Error(`cfg: cannot read ${spec}`);
    if (tokens[i]?.v === "(" && tokens[i].p) {
      i++;
      const args = [];
      while (!(tokens[i]?.v === ")" && tokens[i].p)) {
        args.push(pred());
        if (tokens[i]?.v === "," && tokens[i].p) i++;
      }
      i++;
      if (t.v === "all") return args.every(Boolean);
      if (t.v === "any") return args.some(Boolean);
      if (t.v === "not") return !args[0];
      return false;
    }
    if (tokens[i]?.v === "=" && tokens[i].p) {
      i++;
      const want = tokens[i++].v;
      const have = target.cfg[t.v];
      return Array.isArray(have) ? have.includes(want) : have === want;
    }
    return target.flags.includes(t.v);
  };
  return pred();
}

/** The build target's cfg facts — the stage host's, which is the package's (EDP-22/23). */
export function hostTarget(platform = process.platform, arch = process.arch) {
  const a = { arm64: "aarch64", x64: "x86_64" }[arch] ?? arch;
  const os = { darwin: "macos", win32: "windows", linux: "linux" }[platform] ?? platform;
  const family = platform === "win32" ? "windows" : "unix";
  const features =
    a === "aarch64"
      ? [
          "aes",
          "crc",
          "dit",
          "dotprod",
          "fp16",
          "fp-armv8",
          "lse",
          "neon",
          "rcpc",
          "rdm",
          "sha2",
          "sha3",
        ]
      : platform === "darwin"
        ? ["cmpxchg16b", "fxsr", "sse", "sse2", "sse3", "ssse3", "sse4.1"]
        : ["fxsr", "sse", "sse2"];
  return {
    triple:
      platform === "darwin"
        ? `${a}-apple-darwin`
        : platform === "win32"
          ? `${a}-pc-windows-msvc`
          : `${a}-unknown-linux-gnu`,
    flags: [family],
    cfg: {
      target_os: os,
      target_family: [family],
      target_arch: a,
      target_vendor: platform === "darwin" ? "apple" : platform === "win32" ? "pc" : "unknown",
      target_env: platform === "win32" ? "msvc" : platform === "linux" ? "gnu" : "",
      target_abi: "",
      target_pointer_width: "64",
      target_endian: "little",
      target_has_atomic: ["8", "16", "32", "64", "ptr"],
      target_feature: features,
      panic: "unwind",
    },
  };
}

/** cargo's extracted registry sources: `$CARGO_HOME/registry/src/<index>/`. */
export function cargoRegistryDirs(env = process.env) {
  const home = env.CARGO_HOME ?? join(homedir(), ".cargo");
  const src = join(home, "registry", "src");
  try {
    return readdirSync(src)
      .sort()
      .map((d) => join(src, d));
  } catch {
    return [];
  }
}

function workspaceMembers(workspaceRoot) {
  const members = new Map();
  let root;
  try {
    root = parseManifest(readFileSync(join(workspaceRoot, "Cargo.toml"), "utf8"));
  } catch {
    return { members, root: null };
  }
  const dirs = [];
  for (const pattern of root.workspace?.members ?? []) {
    if (pattern.endsWith("/*")) {
      const parent = join(workspaceRoot, pattern.slice(0, -2));
      try {
        for (const d of readdirSync(parent).sort()) dirs.push(join(parent, d));
      } catch {}
    } else dirs.push(join(workspaceRoot, pattern));
  }
  if (root.name) dirs.push(workspaceRoot);
  for (const dir of dirs) {
    try {
      const m = parseManifest(readFileSync(join(dir, "Cargo.toml"), "utf8"));
      if (m.name) members.set(m.name, { dir, manifest: m });
    } catch {}
  }
  return { members, root };
}

/**
 * A Cargo.lock graph into the ledger: walked from `roots` over the normal and build edges whose
 * target condition holds, a workspace member's dev edges never followed. A registry crate whose
 * extracted source is absent was not built on this host and is skipped; a ROOT's direct dependency
 * absent is a gap (the binary was not built here). The workspace's own path members are first-party
 * (`ownerName` null) or the named sibling (one component, or the owner's own when it has no licence).
 */
export function collectCargo(
  ledger,
  { lockFile, workspaceRoot, roots, target, registryDirs, role, sibling = null },
) {
  let lock;
  try {
    lock = parseCargoLock(readFileSync(lockFile, "utf8"));
  } catch {
    ledger.errors.push(`no Cargo.lock at ${lockFile}`);
    return { crates: 0, skipped: 0 };
  }
  const byName = new Map();
  for (const p of lock) {
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name).push(p);
  }
  const { members, root } = workspaceMembers(workspaceRoot);
  const sourceDir = (p) => {
    for (const reg of registryDirs) {
      const dir = join(reg, `${p.name}-${p.version}`);
      if (existsSync(join(dir, "Cargo.toml"))) return dir;
    }
    return null;
  };
  const manifestOf = new Map();
  const manifest = (p) => {
    const key = `${p.name} ${p.version}`;
    if (manifestOf.has(key)) return manifestOf.get(key);
    let m = null;
    if (!p.source) m = members.get(p.name)?.manifest ?? null;
    else {
      const dir = sourceDir(p);
      if (dir)
        try {
          m = parseManifest(readFileSync(join(dir, "Cargo.toml"), "utf8"));
        } catch {}
    }
    manifestOf.set(key, m);
    return m;
  };
  const resolveDep = (dep) => {
    const [name, version] = dep.split(" ");
    const cands = byName.get(name) ?? [];
    return version ? cands.find((c) => c.version === version) : cands[0];
  };
  // An edge holds when the parent declares the child as a normal or build dependency whose target
  // condition holds; `optional` says every such declaration is feature-gated (a workspace member's
  // optional dependency is in the lock under all features, built only when its feature is on).
  const edge = (parent, child) => {
    const m = manifest(parent);
    if (!m) return { holds: true, optional: false }; // nothing to read: the source check decides
    const decls = m.deps.filter((d) => d.crate === child.name);
    if (decls.length === 0) return { holds: true, optional: false };
    // A condition this reader cannot parse is taken to hold: a notice too many costs a line, one too few a licence.
    const holds = (spec) => {
      try {
        return cfgMatches(spec, target);
      } catch {
        return true;
      }
    };
    const live = decls.filter((d) => d.kind !== "dev" && holds(d.target));
    return { holds: live.length > 0, optional: live.length > 0 && live.every((d) => d.optional) };
  };
  const seen = new Set();
  const stack = [];
  for (const r of roots) {
    const p = byName.get(r)?.[0];
    if (!p) ledger.errors.push(`${basename(dirname(lockFile))}'s Cargo.lock has no crate ${r}`);
    else stack.push({ p, direct: false, optional: false, parent: null });
  }
  let crates = 0;
  let skipped = 0;
  let siblingSeen = false;
  while (stack.length > 0) {
    const { p, direct, optional, parent } = stack.pop();
    const key = `${p.name} ${p.version}`;
    if (seen.has(key)) continue;
    if (!p.source) {
      seen.add(key);
      siblingSeen = true;
    } else if (p.source.startsWith("registry+")) {
      const dir = sourceDir(p);
      if (!dir) {
        // Not marked seen: another path may still reach it as a required dependency.
        if (direct && !optional)
          ledger.gaps.push(
            `${p.name} ${p.version}: ${parent} depends on it and its source is not extracted — ` +
              "was the binary built on this host?",
          );
        else if (
          !ledger.skipped.includes(`${key} (crate; not built for this target on this host)`)
        ) {
          skipped++;
          ledger.skipped.push(`${key} (crate; not built for this target on this host)`);
        }
        continue;
      }
      seen.add(key);
      const m = manifest(p);
      const texts = licenceFiles(dir);
      if (typeof m?.licenseFile === "string" && existsSync(join(dir, m.licenseFile))) {
        const file = basename(m.licenseFile);
        if (!texts.some((t) => t.file === file))
          texts.push({ file, body: readFileSync(join(dir, m.licenseFile), "utf8") });
      }
      const licence = typeof m?.license === "string" ? m.license.replace(/\//g, " OR ") : null;
      if (texts.length === 0 && !licence)
        ledger.gaps.push(
          `${p.name} ${p.version} (crate) carries no licence file and declares no licence`,
        );
      ledger.add({ ecosystem: "crate", name: p.name, version: p.version, licence, texts, role });
      crates++;
      // Code others made that a crate compiles in or links, beyond what its root licence covers: a component each.
      const linked = NATIVE_LINKS[p.name]?.(dir, { name: p.name, version: p.version, role });
      for (const row of linked?.components ?? []) ledger.add(row);
      for (const gap of linked?.gaps ?? []) ledger.gaps.push(gap);
      // ... and the guard for the next one: a crate that compiles native code with licence files below its root
      // (a vendored library's own), or with no licence text at all, is a gap until NATIVE_LINKS names it.
      if (!NATIVE_LINKS[p.name] && compilesNative(m)) {
        const below = vendoredLicenceFiles(dir, m);
        if (below.length > 0 || texts.length === 0)
          ledger.gaps.push(
            `${p.name} ${p.version} compiles native code ` +
              (below.length > 0
                ? `whose licence files below its root (${below.join(", ")}) are not read`
                : "and carries no licence text of its own") +
              " — add its row to NATIVE_LINKS in scripts/third-party-notices.mjs",
          );
      }
    } else {
      seen.add(key);
      ledger.gaps.push(`${p.name} ${p.version}: source ${p.source} is not read by this tool`);
    }
    for (const dep of [...p.deps].sort().reverse()) {
      const child = resolveDep(dep);
      if (!child) {
        ledger.errors.push(
          `${basename(lockFile)}: ${p.name} names ${dep}, which the lock does not hold`,
        );
        continue;
      }
      const e = edge(p, child);
      // Optional is inherited: a path member reached only through a feature-gated edge may not be built at all, so
      // its own dependencies' absence is not a gap either.
      if (e.holds)
        stack.push({
          p: child,
          direct: !p.source,
          optional: e.optional || optional,
          parent: p.name,
        });
    }
  }
  if (sibling && siblingSeen) {
    const lic = root?.workspace?.license ?? null;
    const texts = licenceFiles(workspaceRoot);
    if (!lic && texts.length === 0)
      ledger.add({
        ecosystem: "crate",
        name: sibling.name,
        version: root?.workspace?.version ?? "",
        own: true,
        note: sibling.ownNote ?? "the owner's own, not licensed separately",
      });
    else
      ledger.add({
        ecosystem: "crate",
        name: sibling.name,
        version: root?.workspace?.version ?? "",
        licence: lic,
        texts,
        role,
      });
  }
  return { crates, skipped };
}

// ---- Go ---------------------------------------------------------------------------------------------
/**
 * The module list a Go binary embeds (`go version -m`'s source): Go 1.18+'s inline build info, with a
 * text scan as the fallback. Replacements (`=>`) stand in for the module they replace.
 */
export function goBuildInfo(buf) {
  const magic = Buffer.from("\xff Go buildinf:", "latin1");
  const at = buf.indexOf(magic);
  let goVersion = null;
  let modinfo = null;
  if (at >= 0 && (buf[at + 15] & 2) !== 0) {
    let p = at + 32;
    const read = () => {
      let n = 0;
      let shift = 0;
      let b;
      do {
        b = buf[p++];
        n += (b & 0x7f) * 2 ** shift;
        shift += 7;
      } while (b & 0x80);
      const bytes = buf.subarray(p, p + n);
      p += n;
      return bytes;
    };
    goVersion = read().toString("utf8");
    let mod = read();
    if (mod.length >= 33 && mod[mod.length - 17] === 0x0a) mod = mod.subarray(16, mod.length - 16);
    modinfo = mod.toString("utf8");
  }
  if (!modinfo) {
    const text = buf.toString("latin1");
    const start = text.search(/(^|\n)path\t/);
    if (start < 0) return null;
    modinfo = text.slice(start, start + 65536);
    goVersion ??= /go1\.\d+(\.\d+)?/.exec(text)?.[0] ?? null;
  }
  const info = { goVersion, path: null, main: null, deps: [], build: {} };
  const lines = modinfo.split("\n");
  const seen = new Set();
  for (const line of lines) {
    const f = line.split("\t");
    if (f[0] === "path") info.path = f[1];
    else if (f[0] === "mod") info.main = { path: f[1], version: f[2] };
    else if (f[0] === "dep") {
      const key = `${f[1]}@${f[2]}`;
      if (seen.has(key)) break; // a second copy of the same block (the fallback's scan)
      seen.add(key);
      info.deps.push({ path: f[1], version: f[2] });
    } else if (f[0] === "=>" && info.deps.length > 0) {
      info.deps[info.deps.length - 1] = { path: f[1], version: f[2] };
    } else if (f[0] === "build") {
      const eq = f[1].indexOf("=");
      if (eq > 0) info.build[f[1].slice(0, eq)] = f[1].slice(eq + 1);
    }
  }
  return info;
}

/** The module cache: --gomodcache, $GOMODCACHE, go's env file, $GOPATH/pkg/mod, ~/go/pkg/mod. */
export function goModCacheDir(env = process.env, flag = null) {
  if (flag) return flag;
  if (env.GOMODCACHE) return env.GOMODCACHE;
  const envFiles = [
    join(homedir(), "Library", "Application Support", "go", "env"),
    join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "go", "env"),
  ];
  for (const file of envFiles) {
    try {
      const m = /^GOMODCACHE=(.+)$/m.exec(readFileSync(file, "utf8"));
      if (m) return m[1].trim();
    } catch {}
  }
  const gopath = env.GOPATH?.split(":")[0] ?? join(homedir(), "go");
  return join(gopath, "pkg", "mod");
}

/** The module cache's case encoding: each capital letter becomes `!` and its lower case. */
export const goEscape = (s) => s.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

/** A module's licence texts from the module cache, or null when the cache does not hold it. */
export function goModuleTexts(cache, path, version) {
  const dir = join(cache, `${goEscape(path)}@${goEscape(version)}`);
  if (!existsSync(dir)) return null;
  return licenceFiles(dir);
}

/** Go's own licence (the standard library linked into every Go binary), from a cached toolchain. */
export function goStdlibTexts(cache, goVersion) {
  const parent = join(cache, "golang.org");
  let names = [];
  try {
    names = readdirSync(parent)
      .filter((n) => n.startsWith(`toolchain@v0.0.1-${goVersion}.`))
      .sort();
  } catch {}
  for (const n of names) {
    const texts = licenceFiles(join(parent, n));
    if (texts.length > 0) return texts;
  }
  return null;
}

/**
 * A Go binary's modules into the ledger. Texts come from `snapshot` (the committed record) first,
 * then from a module cache when one is given; a module neither holds is a gap.
 */
export function collectGo(ledger, { info, snapshot = null, cache = null, role, binary }) {
  const fromSnapshot = (path, version) => {
    const row = snapshot?.modules?.find((m) => m.path === path && m.version === version);
    return row
      ? row.texts.map((id) => ({ file: snapshot.texts[id].file, body: snapshot.texts[id].body }))
      : null;
  };
  const std = snapshot?.go?.find((g) => g.version === info.goVersion);
  const stdTexts = std
    ? std.texts.map((id) => ({ file: snapshot.texts[id].file, body: snapshot.texts[id].body }))
    : cache
      ? goStdlibTexts(cache, info.goVersion)
      : null;
  if (!stdTexts)
    ledger.gaps.push(
      `${binary}: Go ${info.goVersion}'s licence is not recorded — refresh the Go notices`,
    );
  ledger.add({
    ecosystem: "go",
    name: "Go (standard library and runtime)",
    version: info.goVersion ?? "",
    texts: stdTexts ?? [],
    role,
  });
  for (const dep of info.deps) {
    const texts =
      fromSnapshot(dep.path, dep.version) ??
      (cache ? goModuleTexts(cache, dep.path, dep.version) : null);
    if (!texts || texts.length === 0)
      ledger.gaps.push(
        `${binary}: ${dep.path} ${dep.version} has no recorded licence — refresh the Go notices`,
      );
    ledger.add({ ecosystem: "go", name: dep.path, version: dep.version, texts: texts ?? [], role });
  }
}

/** The committed Go record for the sidecar: every module the binary embeds, with its texts. */
export function goSnapshot(infos, cache, sidecar) {
  const texts = {};
  const keep = (list) =>
    list.map((t) => {
      const body = normalizeText(t.body);
      const id = textId(body);
      texts[id] = { file: t.file, body };
      return id;
    });
  const modules = new Map();
  const go = new Map();
  const missing = [];
  for (const info of infos) {
    if (info.goVersion && !go.has(info.goVersion)) {
      const std = goStdlibTexts(cache, info.goVersion);
      if (std) go.set(info.goVersion, { version: info.goVersion, texts: keep(std).sort() });
      else missing.push(`Go ${info.goVersion}`);
    }
    for (const dep of info.deps) {
      const key = `${dep.path}@${dep.version}`;
      if (modules.has(key)) continue;
      const found = goModuleTexts(cache, dep.path, dep.version);
      if (!found || found.length === 0) missing.push(key);
      else modules.set(key, { path: dep.path, version: dep.version, texts: keep(found).sort() });
    }
  }
  const sortedTexts = Object.fromEntries(
    Object.keys(texts)
      .sort()
      .map((k) => [k, texts[k]]),
  );
  return {
    doc: {
      schema: 1,
      note:
        "GENERATED by `node scripts/third-party-notices.mjs --refresh-go-modules` (LP-5) from the Go " +
        "module cache: the licence texts of every Go module the mesh sidecar binary embeds, which a " +
        "release host cannot read (no Go toolchain runs there). The stager checks the installed " +
        "sidecar's own build info against this file; refresh it in the EL8 event that moves the sidecar.",
      sidecar,
      go: [...go.values()].sort((a, b) => byText(a.version, b.version)),
      modules: [...modules.values()].sort(
        (a, b) => byText(a.path, b.path) || byText(a.version, b.version),
      ),
      texts: sortedTexts,
    },
    missing,
  };
}

// ---- vendored art (the hand-kept rows: what ships as copied pixels or paths, not as a package) ----
export const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Ghostty's licence, as the Ghostty VT bundle ghosttea-vt-sys links carries it (`ghostty-vt/LICENSES/Ghostty.txt`
// in its build output) and as ghosttea's THIRD_PARTY_NOTICES.md quotes it. The crate's source holds only ghosttea's
// own LICENSE, and the bundle lands in cargo's build directory, whose hashed name is no stable input; the text is
// MIT with one copyright line, so it is kept here and the revision is read from the crate (`artifacts.json`).
export const GHOSTTY_LICENCE = `MIT License\n\nCopyright (c) 2024 Mitchell Hashimoto, Ghostty contributors\n\n${MIT_BODY}`;

// Highway's BSD-3-Clause half (it is Apache-2.0 OR BSD-3-Clause), verbatim as numpy 2.4.4 vendors Highway's LICENSE.
const HIGHWAY_BSD = `Copyright (c) The Highway Project Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1.  Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.

2.  Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.

3.  Neither the name of the copyright holder nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

/**
 * The libraries Ghostty VT's static library carries beside Ghostty's own code. Neither the bundle's `LICENSES/` (it
 * holds Ghostty.txt alone) nor its `sbom.spdx.json` (it names Ghostty VT alone) carries them, so each text is kept
 * here WORD FOR WORD (an MIT grant in MIT_BODY's wrapping, which keeps its text id) as read on 2026-11-05 from a
 * copy of that project's own licence: simdutf's from Node.js v26.5.0's
 * LICENSE (deps/v8/third_party/simdutf), Highway's BSD-3-Clause half from numpy 2.4.4's vendored copy, Wuffs's MIT
 * half from Chromium's licences as Electron ships them, and Zig's from Zig 0.17.0's LICENSE (the Zig ghosttea-vt-sys's
 * build recipe names; compiler_rt is Zig's own runtime library, under Zig's licence). A dual-licensed library is
 * carried under the half whose text is named.
 */
export const GHOSTTY_VT_LIBRARIES = {
  simdutf: {
    name: "simdutf",
    licence: "Apache-2.0 OR MIT",
    file: "LICENSE-MIT (simdutf)",
    body: `Copyright 2021 The simdutf authors\n\n${MIT_BODY}`,
    line: /Copyright 2021 The simdutf authors/,
  },
  highway: {
    name: "Highway",
    licence: "Apache-2.0 OR BSD-3-Clause",
    file: "LICENSE-BSD3 (Highway)",
    body: HIGHWAY_BSD,
    line: /Copyright \(c\) The Highway Project Authors/,
  },
  wuffs: {
    name: "Wuffs",
    licence: "Apache-2.0 OR MIT",
    file: "LICENSE-MIT (Wuffs)",
    body: `Copyright 2023 The Wuffs Authors\n\n${MIT_BODY}`,
    line: /Copyright 2023 The Wuffs Authors/,
  },
  compiler_rt: {
    name: "Zig compiler_rt",
    licence: "MIT",
    file: "LICENSE (Zig)",
    body: `The MIT License (Expat)\n\nCopyright (c) Zig contributors\n\n${MIT_BODY}`,
    line: /Copyright \(c\) Zig contributors/,
  },
};

/**
 * What Ghostty VT's static library carries, by the Ghostty commit it was built from (the commit ghosttea-vt-sys's
 * `artifacts.json` and ghosttea's iOS notices both name). MEASURED, never inferred: `ar -t` on the bundle
 * ghosttea-vt-sys 0.14.0 downloads (`ghostty-vt/lib/libghostty-vt.a`) and on GhostteaAppleNative's archive (every
 * slice) lists simdutf.o, highway_zcu.o with per_target.o and targets.o, wuffs-v0.4.o and compiler_rt.o, and `nm` on
 * the shipped field-terminal-host finds simdutf, hwy and wuffs symbols (2026-11-05). A commit this table does not hold
 * is a gap until someone measures it, which fires exactly at the EL8 that moves ghosttea.
 */
export const GHOSTTY_VT_BUNDLED = {
  "83fb95624b0439ee660c2679b43b38c8b63769cd": ["simdutf", "highway", "wuffs", "compiler_rt"],
};

/** The rows for what Ghostty VT's library carries at `commit`, or the gap that says it is not measured. */
export function ghosttyVtBundled(commit, role) {
  const keys = GHOSTTY_VT_BUNDLED[commit];
  if (!keys)
    return {
      components: [],
      gaps: [
        `Ghostty VT ${commit || "(no commit)"}: what its static library carries beside Ghostty is not measured — ` +
          "list its members (`ar -t libghostty-vt.a`) and add the commit to GHOSTTY_VT_BUNDLED",
      ],
    };
  return {
    components: keys.map((key) => {
      const lib = GHOSTTY_VT_LIBRARIES[key];
      return {
        ecosystem: "other",
        name: lib.name,
        version: `in Ghostty VT ${commit.slice(0, 8)}`,
        licence: lib.licence,
        texts: [{ file: lib.file, body: lib.body }],
        role,
      };
    }),
    gaps: [],
  };
}

/** A component whose texts are files of a crate's own tree (`files`, crate-relative); a file gone is a gap. */
function treeRow(dir, crate, { files, ...row }) {
  const texts = [];
  const gaps = [];
  for (const rel of files) {
    const abs = join(dir, rel);
    if (existsSync(abs)) texts.push({ file: rel, body: readFileSync(abs, "utf8") });
    else
      gaps.push(
        `${crate.name} ${crate.version}: ${rel} is gone — ${row.name}'s licence is not read`,
      );
  }
  return { components: [{ ecosystem: "other", ...row, texts }], gaps };
}

/**
 * Code others made that a crate compiles in or links beyond what its root licence covers, keyed by the crate: each
 * gives `{ components, gaps }`. The crates here were found by reading every crate of the desktop graphs that compiles
 * native code (2026-11-05); the guard in collectCargo (`compilesNative`, `vendoredLicenceFiles`) makes the next one a
 * gap rather than a silent omission.
 */
export const NATIVE_LINKS = {
  // Ghostty's VT core, downloaded as a static library and linked into the terminal cell, and what that library carries.
  "ghosttea-vt-sys": (dir) => {
    let commit = "";
    try {
      commit = readJson(join(dir, "artifacts.json"))?.source?.commit ?? "";
    } catch {}
    const bundled = ghosttyVtBundled(
      commit,
      "inside Ghostty VT's static library (libghostty-vt), linked into field-native's terminal",
    );
    return {
      components: [
        {
          ecosystem: "other",
          name: "Ghostty VT (libghostty-vt)",
          version: commit,
          licence: "MIT",
          texts: [{ file: "LICENSE (Ghostty)", body: GHOSTTY_LICENCE }],
          role: "the terminal engine, linked into field-native's terminal through ghosttea-vt-sys",
        },
        ...bundled.components,
      ],
      gaps: bundled.gaps,
    };
  },
  // libwebp's C, compiled from vendor/ by its build script. The crate declares MIT for its binding and carries no
  // licence file at its root; libwebp's BSD-3-Clause and its patent grant live in vendor/ alone.
  "libwebp-sys": (dir, crate) => {
    let version = "";
    try {
      version =
        /AC_INIT\(\[libwebp\],\s*\[([^\]]+)\]/.exec(
          readFileSync(join(dir, "vendor/configure.ac"), "utf8"),
        )?.[1] ?? "";
    } catch {}
    return treeRow(dir, crate, {
      name: "libwebp",
      version,
      licence: "BSD-3-Clause",
      files: ["vendor/COPYING", "vendor/PATENTS"],
      role: `${crate.role}: WebP images, compiled in by libwebp-sys ${crate.version}`,
    });
  },
  // zstd's C, compiled from zstd/. zstd is BSD-3-Clause OR GPL-2.0-only; its BSD text alone is carried (zstd/COPYING
  // is the GPL alternative, never the licence VibeField takes). The crate's root copy is an older Facebook spelling.
  "zstd-sys": (dir, crate) =>
    treeRow(dir, crate, {
      name: "Zstandard (zstd)",
      version: /\+zstd\.(.+)$/.exec(crate.version)?.[1] ?? "",
      licence: "BSD-3-Clause",
      note: "zstd is BSD-3-Clause OR GPL-2.0-only; it is used here under BSD-3-Clause",
      files: ["zstd/LICENSE"],
      role: `${crate.role}: compression, compiled in by zstd-sys ${crate.version}`,
    }),
  // ring's root LICENSE points to the licences of the code it took in: fiat-crypto's generated field arithmetic
  // (third_party/fiat) and its once_cell polyfill.
  ring: (dir, crate) => {
    const fiat = treeRow(dir, crate, {
      name: "fiat-crypto",
      version: `in ring ${crate.version}`,
      licence: "Apache-2.0",
      files: ["third_party/fiat/LICENSE"],
      role: `${crate.role}: compiled into ring`,
    });
    const onceCell = treeRow(dir, crate, {
      name: "once_cell",
      version: `in ring ${crate.version}`,
      licence: "MIT OR Apache-2.0",
      files: ["src/polyfill/once_cell/LICENSE-APACHE", "src/polyfill/once_cell/LICENSE-MIT"],
      role: `${crate.role}: ring's polyfill`,
    });
    return {
      components: [...fiat.components, ...onceCell.components],
      gaps: [...fiat.gaps, ...onceCell.gaps],
    };
  },
};

/** Whether a crate compiles native code: it build-depends on `cc` or `cmake` (an optional one too). */
export function compilesNative(manifest) {
  return Boolean(manifest?.deps.some((d) => d.kind === "build" && /^(cc|cmake)$/.test(d.crate)));
}

/**
 * Licence files below a crate's root where vendored native code keeps its own: `vendor/` and each directory in it,
 * each directory in `third_party/` (or `third-party/`), and the directory its `links` key names. Crate-relative, sorted.
 */
export function vendoredLicenceFiles(dir, manifest) {
  const subdirs = (rel) => {
    try {
      return readdirSync(join(dir, rel), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `${rel}/${e.name}`);
    } catch {
      return [];
    }
  };
  const places = [
    "vendor",
    ...subdirs("vendor"),
    ...subdirs("third_party"),
    ...subdirs("third-party"),
    ...(manifest?.links && /^[A-Za-z0-9_.-]+$/.test(manifest.links) ? [manifest.links] : []),
  ];
  const out = new Set();
  for (const rel of places)
    for (const t of licenceFiles(join(dir, rel))) out.add(`${rel}/${t.file}`);
  return [...out].sort();
}

// Lobe Icons' npm packages ship no LICENSE file; the copyright line is the one their README states
// ("Copyright © 2023 LobeHub. This project is MIT licensed.", @lobehub/icons-static-svg 1.94.0).
const LOBE_ICONS = {
  ecosystem: "asset",
  name: "Lobe Icons",
  version: "@lobehub/icons-static-svg 1.94.0",
  licence: "MIT",
  texts: [
    {
      file: "LICENSE (Lobe Icons)",
      body: `MIT License\n\nCopyright (c) 2023 LobeHub\n\n${MIT_BODY}`,
    },
  ],
};

// CC0 asks for nothing; the row says where the marks come from and that each is its owner's trademark.
const SIMPLE_ICONS = {
  ecosystem: "asset",
  name: "Simple Icons",
  version: "16.13.0",
  licence: "CC0-1.0",
  texts: [
    {
      file: "Simple Icons",
      body:
        "The operating-system marks are from Simple Icons (https://simpleicons.org), dedicated to the\n" +
        "public domain under CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/).\n" +
        "Each mark remains a trademark of its owner and names that owner's operating system.",
    },
  ],
};

// CC BY 3.0 asks for the authors, the licence's link and a word that the work was adapted.
const SPARKS_FROM_FIRE = {
  ecosystem: "asset",
  name: "Sparks from Fire (shader)",
  version: "",
  licence: "CC-BY-3.0",
  role: "the terminal's ember effect",
  texts: [
    {
      file: "Sparks from Fire",
      body:
        "“Sparks from Fire”, a shader by Jan Mróz, adapted for Ghostty by Alex Sherwin and ported by\n" +
        "ghosttea; used here as ghosttea ships it. Licensed under the Creative Commons Attribution 3.0\n" +
        "Unported licence (CC BY 3.0): https://creativecommons.org/licenses/by/3.0/\n" +
        "This is an adaptation of the original work; neither its author nor its adapters endorse VibeField.",
    },
  ],
};

/** The desktop's vendored rows; `file` paths are repository-relative. */
export const DESKTOP_VENDORED = [
  {
    ecosystem: "asset",
    name: "Caveat (font)",
    version: "2.000",
    licence: "OFL-1.1",
    textFile: "packages/field-app/src/field/desk/assets/fonts/OFL.txt",
    role: "the desk's handwriting",
  },
  {
    ecosystem: "asset",
    name: "Kalam (font)",
    version: "2.001",
    licence: "OFL-1.1",
    textFile: "packages/field-app/src/field/desk/assets/fonts/OFL.txt",
    role: "the desk's handwriting",
  },
  { ...SIMPLE_ICONS, role: "the desktops' OS marks (packages/field-app/src/godview/os-marks.tsx)" },
  { ...LOBE_ICONS, role: "the agents' marks (drawn by the puppeteer and rosetta views)" },
  // ghosttea-react's WGSL port of the ember effect ships in the renderer. Its THIRD_PARTY_NOTICES.md names the
  // authors; CC BY 3.0 also asks for the licence's link and a word that the work was adapted, which this row adds.
  {
    ...SPARKS_FROM_FIRE,
    role: "the terminal's ember effect (ghosttea-react's port, in the renderer)",
    when: (ledger) =>
      [...ledger.components.values()].some((c) => c.name === "@vibecook/ghosttea-react"),
  },
];

/** Build tools whose OUTPUT ships in the bundles, resolved from the package that uses each. */
export const BUILD_OUTPUT = [
  {
    name: "tailwindcss",
    from: "packages/electron-shell",
    role: "its generated CSS (preflight) is in the renderer's stylesheet",
  },
  {
    name: "vite",
    from: "packages/electron-shell",
    role: "its module-preload helper is in the renderer",
  },
  { name: "esbuild", from: "packages/fieldd", role: "its runtime helpers are in the Node bundles" },
];

/** The esbuild bundles: each file, the directory its module comments are relative to, and its role. */
export const NODE_BUNDLES = [
  {
    file: "packages/electron-shell/dist/main/index.cjs",
    base: "packages/electron-shell",
    role: "the app's main process",
  },
  {
    file: "packages/electron-shell/dist/preload/index.cjs",
    base: "packages/electron-shell",
    role: "the app's preload",
  },
  {
    file: "packages/fieldd/dist/bin.cjs",
    base: "packages/fieldd",
    role: "fieldd (the bundle its executable embeds)",
  },
  {
    file: "packages/fieldd/dist/files-host.cjs",
    base: "packages/fieldd",
    role: "fieldd's files worker",
  },
  {
    file: "packages/fieldd/dist/service-harness.mjs",
    base: "packages/fieldd",
    role: "fieldd's plugin service harness",
  },
  {
    file: "packages/fieldd/dist/agent-shim.cjs",
    base: "packages/fieldd",
    role: "fieldd's agent shim",
  },
];

/** Attributions a notices file must carry, whatever the graph: the guard against a silent drop. */
// Each test reads a line only that attribution carries: Ghostty's copyright line, not its author's name alone
// (mitchellh/go-ps, a Go module of the sidecar, is MIT under the same name and would satisfy a bare match).
const GHOSTTY_LINE = /Copyright \(c\) 2024 Mitchell Hashimoto, Ghostty contributors/;
const hasCrate = (ledger, name) =>
  [...ledger.components.values()].some((c) => c.ecosystem === "crate" && c.name === name);
// Each library Ghostty VT's static library carries, required while a Ghostty VT in the ledger is at a commit whose
// measured members include it (GHOSTTY_VT_BUNDLED).
const GHOSTTY_VT_REQUIRED = Object.entries(GHOSTTY_VT_LIBRARIES).map(([key, lib]) => ({
  what: `${lib.name}'s licence (inside Ghostty VT's static library)`,
  test: lib.line,
  when: (ledger) =>
    [...ledger.components.values()].some(
      (c) => /^Ghostty VT\b/.test(c.name) && GHOSTTY_VT_BUNDLED[c.version]?.includes(key),
    ),
}));
export const REQUIRED_DESKTOP = [
  {
    what: "Ghostty's MIT notice (the terminal engine, through ghosttea-vt-sys)",
    test: GHOSTTY_LINE,
  },
  ...GHOSTTY_VT_REQUIRED,
  // Each test reads a line only that library's text carries: React's MIT is also "Meta Platforms, Inc. and affiliates".
  {
    what: "libwebp's BSD-3-Clause notice (compiled in by libwebp-sys)",
    test: /Copyright \(c\) 2010, Google Inc\. All rights reserved\.\s+Redistribution/,
    when: (ledger) => hasCrate(ledger, "libwebp-sys"),
  },
  {
    what: "libwebp's WebM patent grant (compiled in by libwebp-sys)",
    test: /codecs distributed by Google as part of the WebM Project/,
    when: (ledger) => hasCrate(ledger, "libwebp-sys"),
  },
  {
    what: "Zstandard's BSD-3-Clause notice (compiled in by zstd-sys)",
    test: /For Zstandard software\s+Copyright \(c\) Meta Platforms, Inc\. and affiliates\./,
    when: (ledger) => hasCrate(ledger, "zstd-sys"),
  },
  {
    what: "the CC BY 3.0 credit for Sparks from Fire (ghosttea-react's effects)",
    test: /Jan Mróz[\s\S]*creativecommons\.org\/licenses\/by\/3\.0/,
    when: (ledger) =>
      [...ledger.components.values()].some((c) => c.name === "@vibecook/ghosttea-react"),
  },
];
export const REQUIRED_IOS = [
  { what: "Ghostty's MIT notice (the terminal engine, through ghosttea)", test: GHOSTTY_LINE },
  ...GHOSTTY_VT_REQUIRED,
  {
    what: "Tailscale's BSD-3-Clause licence (TailscaleKit)",
    test: /Tailscale Inc|Tailscale & AUTHORS/,
  },
  {
    what: "the CC BY 3.0 credit for Sparks from Fire",
    test: /Jan Mróz[\s\S]*creativecommons\.org\/licenses\/by\/3\.0/,
  },
];

function checkRequired(ledger, required) {
  const bodies = [...ledger.texts.values()].map((t) => t.body);
  for (const r of required) {
    if (r.when && !r.when(ledger)) continue;
    if (!bodies.some((b) => r.test.test(b)))
      ledger.gaps.push(`missing a required attribution: ${r.what}`);
  }
}

function addVendored(ledger, rows, repoRoot) {
  for (const { when, ...row } of rows) {
    if (when && !when(ledger)) continue;
    const texts = row.texts ? [...row.texts] : [];
    if (row.textFile) {
      const abs = join(repoRoot, row.textFile);
      if (existsSync(abs))
        texts.push({ file: basename(row.textFile), body: readFileSync(abs, "utf8") });
      else ledger.gaps.push(`${row.name}: its licence file ${row.textFile} is gone`);
    }
    ledger.add({ ...row, texts });
  }
}

// ---- the desktop -----------------------------------------------------------------------------------
/**
 * Where the mille engine a stage ships was made, read off the addon itself: fieldd's build copies it from
 * `@vibecook/mille` as fieldd resolves it (packages/fieldd/scripts/files-host-build.mjs `installedMilleNativeFile`,
 * the one reader, so the two never disagree). An addon inside a checkout was built there by cargo, so the nearest
 * Cargo.lock above it is its graph (`{ cargo }`); one inside node_modules is a released platform package, whose own
 * licence and notices files speak for it (`{ npm }`). Never the lock's checkout by name: at mille's release
 * (`needsCheckout` false, RD-5) the checkout may be gone, or present at a revision the shipped binary was not built
 * from. `null` where mille ships no engine for this host; `{ problem }` when the engine cannot be found.
 */
export async function milleEngine(repoRoot) {
  const fielddRoot = join(repoRoot, "packages/fieldd");
  let found;
  try {
    const { installedMilleNativeFile } = await import(
      "../packages/fieldd/scripts/files-host-build.mjs"
    );
    found = installedMilleNativeFile(fielddRoot);
  } catch (error) {
    return {
      problem: `mille's native engine is not installed beside fieldd (${error.code ?? error.message}) — its crates cannot be read`,
    };
  }
  if (found === null) return null;
  const file = realOrNull(found.file);
  if (!file)
    return {
      problem: `mille's native engine ${basename(found.file)} is not built — its crates cannot be read`,
    };
  if (file.split(sep).includes("node_modules")) {
    const dir = namedPackageDir(dirname(file));
    return dir
      ? { npm: dir }
      : {
          problem: `mille's native engine ${basename(file)} is in no package — its licence cannot be read`,
        };
  }
  for (let at = dirname(file); ; at = dirname(at)) {
    if (existsSync(join(at, "Cargo.lock"))) return { cargo: at };
    if (existsSync(join(at, ".git")) || dirname(at) === at)
      return {
        problem: `mille's native engine ${basename(file)} was built in a checkout with no Cargo.lock — its crates cannot be read`,
      };
  }
}

/** A released native package's notices for what it links: a package that carries none leaves its crates unlisted. */
const NOTICES_NAME = /^(third[-_]party[-_]notices|notices?)([-._].*)?$/i;

/**
 * Every input the desktop notices read, from a repository root. Exported so a test (or another tool)
 * can name a fixture's inputs instead.
 */
export async function desktopInputs(repoRoot, { sidecarPath = null, env = process.env } = {}) {
  const { readLock, rosettadBinary, siblingDir } = await import("./siblings.mjs");
  const { BUNDLED_PLUGINS } = await import("../apps/desktop/packaging/bundled-list.mjs");
  const lock = readLock(repoRoot);
  const sibling = (name) =>
    lock?.siblings?.[name] ? siblingDir(repoRoot, lock.siblings[name]) : null;
  // rosettad is optional in a stage (stage-package.mjs): its crates are listed only when it is built.
  const rosettad = rosettadBinary(repoRoot);
  const rosettadBuilt = Boolean(rosettad?.path && existsSync(rosettad.path));
  const platform = `${process.platform}-${process.arch}`;
  const sidecar =
    sidecarPath ??
    join(
      repoRoot,
      "apps/desktop/node_modules/@vibecook",
      `truffle-sidecar-${platform}`,
      "bin",
      process.platform === "win32" ? "sidecar-slim.exe" : "sidecar-slim",
    );
  const rosetta = sibling("rosetta");
  const mille = await milleEngine(repoRoot);
  const desktopPkg = readJson(join(repoRoot, "apps/desktop/package.json"));
  return {
    repoRoot,
    version: desktopPkg.version,
    bundles: NODE_BUNDLES.map((b) => ({
      ...b,
      file: join(repoRoot, b.file),
      base: join(repoRoot, b.base),
    })),
    closures: [
      { roots: [join(repoRoot, "packages/field-app")], role: "the app's renderer" },
      { roots: BUNDLED_PLUGINS.map((p) => join(repoRoot, p)), role: "the bundled plugins" },
    ],
    buildOutput: BUILD_OUTPUT.map((b) => ({ ...b, from: join(repoRoot, b.from) })),
    cargo: [
      {
        lockFile: join(repoRoot, "Cargo.lock"),
        workspaceRoot: repoRoot,
        roots: ["field-native"],
        role: "field-native, the terminal cell and the freeway host",
      },
      ...(rosetta && rosettadBuilt
        ? [
            {
              lockFile: join(rosetta, "Cargo.lock"),
              workspaceRoot: rosetta,
              roots: ["rosettad"],
              role: "rosettad (agent history)",
              sibling: {
                name: "rosetta",
                ownNote: "agent history (rosettad and its crates); the owner's own, UNLICENSED",
              },
            },
          ]
        : []),
      // mille's engine as the stage ships it (milleEngine): built from a checkout, that checkout's graph
      ...(mille?.cargo
        ? [
            {
              lockFile: join(mille.cargo, "Cargo.lock"),
              workspaceRoot: mille.cargo,
              roots: ["mille-binding"],
              role: "mille's native file engine",
              sibling: { name: "mille (Rust crates)" },
            },
          ]
        : []),
    ],
    // ... or a released platform package, which must carry the notices for what it links
    packages: mille?.npm
      ? [
          {
            dir: mille.npm,
            role: "mille's native file engine (its released package)",
            native: true,
          },
        ]
      : [],
    problems: mille?.problem ? [mille.problem] : [],
    sidecar,
    goSnapshotFile: join(repoRoot, GO_SNAPSHOT),
    goCache: env.VIBEFIELD_NOTICES_GOMODCACHE ?? null,
    vendored: DESKTOP_VENDORED,
    target: hostTarget(),
    registryDirs: cargoRegistryDirs(env),
  };
}

/** The desktop notices from explicit inputs (`desktopInputs`, or a test's fixture). */
export function desktopNotices(inputs, { externals = [] } = {}) {
  const ledger = createLedger();
  // Real, as every package directory below is resolved: a root reached through a link (macOS's /var) still owns
  // its workspace's packages.
  const repoRoot = realOrNull(inputs.repoRoot) ?? inputs.repoRoot;
  for (const b of inputs.bundles) collectBundle(ledger, { ...b, repoRoot });
  for (const c of inputs.closures) collectClosure(ledger, { ...c, repoRoot });
  for (const b of inputs.buildOutput ?? []) {
    const dir = resolvePackage(b.from, b.name);
    if (dir) addNpmPackage(ledger, dir, { repoRoot, role: b.role });
    else ledger.gaps.push(`${b.name} is not installed beside ${relativeTo(repoRoot, b.from)}`);
  }
  for (const g of inputs.cargo)
    collectCargo(ledger, { ...g, target: inputs.target, registryDirs: inputs.registryDirs });
  for (const p of inputs.packages ?? []) {
    const c = addNpmPackage(ledger, p.dir, { repoRoot, role: p.role });
    // A prebuilt native package links crates others made, its owner's own or not; their notices are its to carry.
    if (c && p.native && !licenceFiles(p.dir).some((t) => NOTICES_NAME.test(t.file)))
      ledger.gaps.push(
        `${c.name} ${c.version} is a prebuilt native package with no third-party notices for the crates it links — ` +
          "ask its owner to ship them, or build it from its pinned checkout",
      );
  }
  for (const p of inputs.problems ?? []) ledger.errors.push(p);
  if (inputs.sidecar) {
    if (!existsSync(inputs.sidecar))
      ledger.gaps.push(`no mesh sidecar at ${relativeTo(repoRoot, inputs.sidecar)}`);
    else {
      const pkgDir = nodeModulesPackage(inputs.sidecar.split(sep).join("/"));
      if (pkgDir) addNpmPackage(ledger, resolve(pkgDir), { repoRoot, role: "the mesh sidecar" });
      else
        ledger.gaps.push(
          "the mesh sidecar is not an installed package — its own licence is not read",
        );
      const info = goBuildInfo(readFileSync(inputs.sidecar));
      if (!info)
        ledger.gaps.push("the mesh sidecar carries no Go build info — its Go modules are unknown");
      else {
        let snapshot = null;
        try {
          snapshot = readJson(inputs.goSnapshotFile);
        } catch {}
        collectGo(ledger, {
          info,
          snapshot,
          cache: inputs.goCache,
          role: "the mesh sidecar",
          binary: "the mesh sidecar",
        });
      }
    }
  }
  addVendored(ledger, inputs.vendored ?? [], repoRoot);
  checkRequired(ledger, inputs.required ?? REQUIRED_DESKTOP);
  const text = renderNotices(ledger, { version: inputs.version, externals });
  return { text, ledger };
}

/** What the stager ships beside the notices, each with the words the notices use for it. */
export function stageExternals({ repoRoot, execPath = process.execPath }) {
  const nodeLicence = [
    join(dirname(execPath), "LICENSE"),
    join(dirname(execPath), "..", "LICENSE"),
  ].find((p) => existsSync(p));
  return [
    {
      stage: "legal/LICENSE.electron.txt",
      from: join(repoRoot, "apps/desktop/node_modules/electron/dist/LICENSE"),
      file: "LICENSE.electron.txt",
      what: "Electron's licence (the app's runtime)",
    },
    {
      stage: "legal/LICENSES.chromium.html",
      from: join(repoRoot, "apps/desktop/node_modules/electron/dist/LICENSES.chromium.html"),
      file: "LICENSES.chromium.html",
      what: "the licences of Chromium and the components Electron bundles",
    },
    {
      stage: "legal/LICENSE.node.txt",
      from: nodeLicence ?? null,
      file: "LICENSE.node.txt",
      what: `Node.js ${process.version}'s licence, with the components it bundles (fieldd's runtime)`,
      optional: true,
    },
  ];
}

/**
 * The stager's door. Generates the notices from the tree the stage was built from; with `write`,
 * puts them at `legal/THIRD_PARTY_NOTICES.txt` in the stage. Returns the staged path, the text,
 * hard problems (an unreadable input) and gaps (a component whose licence is unknown).
 */
export async function stageNotices({ repoRoot, stageDir, sidecarPath = null, write = true }) {
  const inputs = await desktopInputs(repoRoot, { sidecarPath });
  const externals = stageExternals({ repoRoot }).filter((e) => e.from && existsSync(e.from));
  const { text, ledger } = desktopNotices(inputs, { externals });
  const rel = `legal/${NOTICES_FILE}`;
  if (write) writeFileSync(join(stageDir, rel), text, { mode: 0o644 });
  const third = [...ledger.components.values()].filter((c) => !c.own);
  return {
    rel,
    text,
    problems: ledger.errors,
    gaps: ledger.gaps,
    summary:
      `${third.length} components, ${new Set(third.flatMap((c) => c.texts)).size} distinct licence texts` +
      (ledger.skipped.length > 0
        ? `, ${ledger.skipped.length} left out (another platform's, or not built on this host)`
        : ""),
  };
}

// ---- iOS ---------------------------------------------------------------------------------------------
/**
 * ghosttea's generated iOS notices (apple/GhostteaApp/Resources/THIRD-PARTY-NOTICES.txt): a component
 * index (name, version, licence, document ids) and the documents themselves.
 */
export function parseGhostteaNotices(text) {
  const lines = normalizeText(text).split("\n");
  const components = [];
  const documents = new Map();
  const indexAt = lines.indexOf("COMPONENT INDEX");
  const docsAt = lines.indexOf("LICENSE DOCUMENTS");
  if (indexAt < 0 || docsAt < 0) return null;
  for (let i = indexAt + 2; i < docsAt; i++) {
    const line = lines[i];
    if (!line || line.startsWith(" ")) continue;
    const sp = line.lastIndexOf(" ");
    const comp = {
      name: sp > 0 ? line.slice(0, sp) : line,
      version: sp > 0 ? line.slice(sp + 1) : "",
      licence: null,
      documents: [],
    };
    for (let j = i + 1; j < docsAt && lines[j].startsWith("  "); j++) {
      const l = lines[j].trim();
      if (l.startsWith("License:")) comp.licence = l.slice(8).trim();
      if (l.startsWith("Documents:"))
        comp.documents = l
          .slice(10)
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
    }
    components.push(comp);
  }
  let i = docsAt + 2;
  while (i < lines.length) {
    if (lines[i] !== RULE) {
      i++;
      continue;
    }
    const head = /^(LICENSE-\d+) · (.+)$/.exec(lines[i + 1] ?? "");
    if (!head) {
      i++;
      continue;
    }
    let j = i + 2;
    while (j < lines.length && lines[j] !== THIN) j++;
    let k = j + 1;
    while (k < lines.length && lines[k] !== RULE) k++;
    documents.set(head[1], { file: head[2], body: lines.slice(j + 1, k).join("\n") });
    i = k;
  }
  return { components, documents };
}

/** The index of the `)` closing the `(` at `open`, outside strings and `//` comments (-1 when unbalanced). */
function closingParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === "\\") i++;
    } else if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * A Package.swift's targets: name → { deps }. Each declaration is read to its own closing parenthesis, so a
 * one-line `.target(name:path:)` never swallows its neighbour; a dependency is any quoted name in its
 * `dependencies:` list (a `.product(name:package:)` names a product, never one of this package's targets).
 */
export function swiftTargets(manifest) {
  const targets = new Map();
  let inside = -1; // a `.target(name:)` INSIDE a declaration is a dependency on it, never a declaration
  for (const m of manifest.matchAll(
    /\.(?:target|binaryTarget|executableTarget|testTarget|plugin)\(/g,
  )) {
    if (m.index < inside) continue;
    const lineStart = manifest.lastIndexOf("\n", m.index) + 1;
    if (manifest.slice(lineStart, m.index).includes("//")) continue; // a comment's example
    const open = m.index + m[0].length - 1;
    const close = closingParen(manifest, open);
    if (close < 0) continue;
    inside = close;
    const body = manifest.slice(open + 1, close);
    const name = /^\s*name:\s*"([^"]+)"/.exec(body)?.[1];
    if (!name || targets.has(name)) continue;
    const at = body.search(/\bdependencies:\s*\[/);
    let deps = [];
    if (at >= 0) {
      const start = body.indexOf("[", at);
      let depth = 0;
      let end = start;
      for (; end < body.length; end++) {
        if (body[end] === "[") depth++;
        else if (body[end] === "]" && --depth === 0) break;
      }
      deps = [...body.slice(start + 1, end).matchAll(/(\.product\(\s*name:\s*)?"([A-Za-z0-9_]+)"/g)]
        .filter((d) => !d[1])
        .map((d) => d[2])
        .filter((d, i, all) => all.indexOf(d) === i);
    }
    targets.set(name, { deps });
  }
  return targets;
}

export function reachableTargets(targets, from) {
  const seen = new Set();
  const stack = [...from];
  while (stack.length > 0) {
    const t = stack.pop();
    if (seen.has(t) || !targets.has(t)) continue;
    seen.add(t);
    for (const d of targets.get(t).deps) if (targets.has(d)) stack.push(d);
  }
  return seen;
}

// Components of ghosttea's iOS notices, keyed to the ghosttea target whose BINARY carries their code: one is listed
// only while the kit's products reach that target. OpenSSL and libssh2 are wrapped by CGhostteaSSH, which the kit does
// not link, but their objects are members of GhostteaAppleNative's static archive (`nm -gU libghosttea-apple-native.a`
// lists libssh2_* and EVP_* symbols, 2026-11-05), which it does. Whether the app's link drops those members cannot be
// read without linking the app, so they are listed: a notice for code that may not ship costs a line, a missing one
// for code that does breaks its licence. Measure the archived app (`nm` on its executable) before narrowing this.
const GHOSTTEA_COMPONENT_TARGET = [
  { component: /^OpenSSL$/, target: "GhostteaAppleNative" },
  { component: /^libssh2$/, target: "GhostteaAppleNative" },
];

/**
 * The ecosystem of a component in ghosttea's iOS notices, whose index names no kind. A crate is a lower-case name at a
 * semver version (`anyhow 1.0.103`); a native library its archive carries is "other" whatever its name looks like
 * (`libssh2 libssh2-1.11.1` is C, and no crates.io page of that name and version exists).
 */
export function ghostteaEcosystem(c) {
  if (/^(TailscaleKit|Truffle Swift)$/.test(c.name)) return "swift";
  if (GHOSTTEA_COMPONENT_TARGET.some((g) => g.component.test(c.name))) return "other";
  const semver = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(c.version ?? "");
  return semver && /^[a-z0-9_-]+$/.test(c.name) ? "crate" : "other";
}

export const IOS_VENDORED = [
  { ...LOBE_ICONS, role: "the agents' marks" },
  { ...SIMPLE_ICONS, role: "the desktops' OS marks" },
  SPARKS_FROM_FIRE,
];

function gitHead(dir) {
  try {
    const head = readFileSync(join(dir, ".git", "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (ref) return readFileSync(join(dir, ".git", ref), "utf8").trim();
  } catch {}
  return null;
}

/**
 * The iOS acknowledgements. Reads the kit's Package.resolved pins and the SwiftPM checkouts at those
 * pins (refused on a mismatch); ghosttea's own reviewed iOS notices for the terminal, its Rust crates
 * and its fonts, filtered to the ghosttea targets the kit's products reach; truffle and TailscaleKit;
 * TailscaleKit's Go modules from its binary's build info; and the hand-kept art rows.
 */
export function iosAcknowledgements({
  repoRoot,
  checkouts,
  artifacts = null,
  goCache = null,
  goSnapshot: snap = null,
}) {
  const ledger = createLedger();
  const kit = join(repoRoot, "apps/ios/VibeFieldKit");
  const resolved = readJson(join(kit, "Package.resolved"));
  const pins = Object.fromEntries(
    (resolved.pins ?? []).map((p) => [
      p.identity,
      { version: p.state?.version ?? null, revision: p.state?.revision ?? null },
    ]),
  );
  for (const [identity, pin] of Object.entries(pins)) {
    const head = gitHead(join(checkouts, identity));
    if (head !== pin.revision)
      ledger.errors.push(
        `the ${identity} checkout is at ${head ?? "no revision"}, not Package.resolved's ${pin.revision} — resolve the kit first`,
      );
  }
  const kitManifest = readFileSync(join(kit, "Package.swift"), "utf8");
  const products = (pkg) =>
    [
      ...kitManifest.matchAll(
        new RegExp(`\\.product\\(name: "([A-Za-z0-9_]+)", package: "${pkg}"\\)`, "g"),
      ),
    ].map((m) => m[1]);

  // ghosttea: its own reviewed notices for what its iOS build links.
  const ghosttea = join(checkouts, "ghosttea");
  const ghostteaNotices = join(ghosttea, "apple/GhostteaApp/Resources/THIRD-PARTY-NOTICES.txt");
  let reach = null;
  try {
    reach = reachableTargets(
      swiftTargets(readFileSync(join(ghosttea, "Package.swift"), "utf8")),
      products("ghosttea"),
    );
  } catch {}
  const parsed = existsSync(ghostteaNotices)
    ? parseGhostteaNotices(readFileSync(ghostteaNotices, "utf8"))
    : null;
  if (!parsed)
    ledger.errors.push(
      "ghosttea's iOS notices (apple/GhostteaApp/Resources/THIRD-PARTY-NOTICES.txt) are missing or unreadable",
    );
  else
    for (const c of parsed.components) {
      const gated = GHOSTTEA_COMPONENT_TARGET.find((g) => g.component.test(c.name));
      if (gated && reach && !reach.has(gated.target)) {
        ledger.skipped.push(
          `${c.name} ${c.version} (only ghosttea's ${gated.target}, which the kit does not link)`,
        );
        continue;
      }
      // ghosttea's own app links truffle; the kit links it directly, and its rows below read truffle's checkout.
      if (/^(TailscaleKit|Truffle Swift)$/.test(c.name) && products("truffle").length > 0) {
        ledger.skipped.push(`${c.name} ${c.version} (listed from the kit's own truffle checkout)`);
        continue;
      }
      const texts = c.documents
        .map((id) => parsed.documents.get(id))
        .filter(Boolean)
        .map((d) => ({ file: d.file, body: d.body }));
      const font = /\.(ttf|otf)$/i.test(c.name);
      ledger.add({
        ecosystem: font ? "asset" : ghostteaEcosystem(c),
        name: c.name,
        version: c.version,
        licence: c.licence,
        texts,
        role: font ? "the terminal's fonts" : "the terminal (ghosttea)",
      });
      // ghosttea's notices name Ghostty VT alone; GhostteaAppleNative's archive carries what its library carries too.
      if (c.name === "Ghostty VT") {
        const bundled = ghosttyVtBundled(
          c.version,
          "inside Ghostty VT, in ghosttea's native library (GhostteaAppleNative)",
        );
        for (const row of bundled.components) ledger.add(row);
        for (const gap of bundled.gaps) ledger.gaps.push(gap);
      }
    }
  ledger.add({
    ecosystem: "swift",
    name: "ghosttea",
    version: pins.ghosttea?.version ?? "",
    licence: "MIT",
    texts: licenceFiles(ghosttea),
    role: "the terminal",
  });

  // truffle, and the TailscaleKit it carries.
  const truffle = join(checkouts, "truffle");
  ledger.add({
    ecosystem: "swift",
    name: "truffle",
    version: pins.truffle?.version ?? "",
    licence: "MIT",
    texts: licenceFiles(truffle),
    role: "the private network",
  });
  const vendor = join(truffle, "apple/Vendor");
  const readme = existsSync(join(vendor, "README.md"))
    ? readFileSync(join(vendor, "README.md"), "utf8")
    : "";
  const tsRevision = /\| Revision \| `([0-9a-f]+)` \|/.exec(readme)?.[1] ?? "";
  const tsLicence = join(vendor, "TAILSCALE-LICENSE");
  if (!existsSync(tsLicence))
    ledger.gaps.push(
      "truffle's apple/Vendor/TAILSCALE-LICENSE is missing — TailscaleKit's licence is not read",
    );
  ledger.add({
    ecosystem: "swift",
    name: "TailscaleKit",
    version: tsRevision,
    licence: "BSD-3-Clause",
    texts: existsSync(tsLicence)
      ? [{ file: "TAILSCALE-LICENSE", body: readFileSync(tsLicence, "utf8") }]
      : [],
    role: "the private network (libtailscale)",
  });
  const binary = artifacts
    ? join(
        artifacts,
        "truffle/TailscaleKit/TailscaleKit.xcframework/ios-arm64/TailscaleKit.framework/TailscaleKit",
      )
    : null;
  if (binary && existsSync(binary)) {
    const info = goBuildInfo(readFileSync(binary));
    if (info)
      collectGo(ledger, {
        info,
        snapshot: snap,
        cache: goCache,
        role: "TailscaleKit",
        binary: "TailscaleKit",
      });
    else ledger.gaps.push("TailscaleKit carries no Go build info — its Go modules are unknown");
  } else
    ledger.gaps.push(
      "TailscaleKit's binary is not under --artifacts (SourcePackages/artifacts) — its Go modules are not listed",
    );

  addVendored(ledger, IOS_VENDORED, repoRoot);
  checkRequired(ledger, REQUIRED_IOS);
  const json = renderAcknowledgements(ledger, {
    pins: Object.fromEntries(Object.entries(pins).sort(([a], [b]) => byText(a, b))),
    tailscaleKit: tsRevision,
  });
  return { json, ledger };
}

// ---- CLI ---------------------------------------------------------------------------------------------
async function main(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repoRoot = resolve(value("--root") ?? fileURLToPath(new URL("..", import.meta.url)));
  const out = value("--out");
  const report = (ledger, what) => {
    for (const e of ledger.errors) console.error(`  ERROR  ${e}`);
    for (const g of ledger.gaps) console.error(`  GAP    ${g}`);
    const third = [...ledger.components.values()].filter((c) => !c.own);
    console.log(
      `${what}: ${third.length} components, ${new Set(third.flatMap((c) => c.texts)).size} distinct licence texts, ` +
        `${ledger.skipped.length} skipped, ${ledger.errors.length} errors, ${ledger.gaps.length} gaps`,
    );
    return ledger.errors.length === 0 ? 0 : 1;
  };

  if (argv.includes("--refresh-go-modules")) {
    const cache = goModCacheDir(process.env, value("--gomodcache"));
    const desktop = readJson(join(repoRoot, "apps/desktop/package.json"));
    const rows = Object.entries(desktop.optionalDependencies ?? {}).filter(([n]) =>
      n.startsWith("@vibecook/truffle-sidecar-"),
    );
    const infos = [];
    for (const [name] of rows) {
      const dir = resolvePackage(join(repoRoot, "apps/desktop"), name);
      if (!dir) continue;
      const bin = readdirSync(join(dir, "bin")).find((f) => f.startsWith("sidecar-slim"));
      const info = bin ? goBuildInfo(readFileSync(join(dir, "bin", bin))) : null;
      if (info) infos.push(info);
    }
    if (infos.length === 0) {
      console.error("no installed sidecar binary to read — `pnpm install` first");
      return 1;
    }
    const versions = [...new Set(rows.map(([, v]) => v))];
    const { doc, missing } = goSnapshot(infos, cache, {
      package: "@vibecook/truffle-sidecar-*",
      version: versions.join(" "),
    });
    if (missing.length > 0) {
      console.error(`the module cache at ${cache} lacks: ${missing.join(", ")}`);
      return 1;
    }
    const file = out ? resolve(out) : join(repoRoot, GO_SNAPSHOT);
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(
      `wrote ${relativeTo(repoRoot, file)}: Go ${doc.go.map((g) => g.version).join(", ")}, ${doc.modules.length} modules`,
    );
    return 0;
  }

  if (argv.includes("--ios")) {
    const checkouts =
      value("--checkouts") ?? join(repoRoot, "apps/ios/VibeFieldKit/.build/checkouts");
    if (!existsSync(checkouts)) {
      console.error(
        `no SwiftPM checkouts at ${checkouts} — pass --checkouts <DerivedData>/SourcePackages/checkouts`,
      );
      return 1;
    }
    const artifacts = value("--artifacts") ?? join(dirname(checkouts), "artifacts");
    let snap = null;
    try {
      snap = readJson(join(repoRoot, GO_SNAPSHOT));
    } catch {}
    const { json, ledger } = iosAcknowledgements({
      repoRoot,
      checkouts,
      artifacts,
      goCache: goModCacheDir(process.env, value("--gomodcache")),
      goSnapshot: snap,
    });
    const status = report(ledger, "iOS acknowledgements");
    if (status !== 0 || ledger.gaps.length > 0) {
      console.error("not written: resolve the errors and gaps above");
      return 1;
    }
    const file = out ? resolve(out) : join(repoRoot, IOS_OUTPUT);
    writeFileSync(file, json);
    console.log(`wrote ${relativeTo(repoRoot, file)}`);
    return 0;
  }

  const inputs = await desktopInputs(repoRoot);
  inputs.goCache = value("--gomodcache") ?? inputs.goCache;
  if (value("--go-snapshot")) inputs.goSnapshotFile = resolve(value("--go-snapshot"));
  const externals = stageExternals({ repoRoot }).filter((e) => e.from && existsSync(e.from));
  const { text, ledger } = desktopNotices(inputs, { externals });
  const status = report(ledger, "desktop notices");
  if (out) {
    writeFileSync(resolve(out), text);
    console.log(`wrote ${out}`);
  }
  if (argv.includes("--skipped")) for (const s of ledger.skipped) console.log(`  skipped  ${s}`);
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
