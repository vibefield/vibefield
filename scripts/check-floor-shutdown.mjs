#!/usr/bin/env node
// Item 443 (2026-11-15) — a floor a field-native test boots is stopped in the same function. Item 196 wrote the
// rule into `packages/field-native/tests/mgmt_server.rs` ("Every row that boots a floor ends with
// `daemon.shutdown().await`"): a floor still running when its `TempDir` drops leaves cells it is still starting, and
// they bind their sockets inside the removal and keep the root. `tests/door.rs` and `tests/door_bridge.rs` never took
// it, and every whole test run under load left a `.tmpXXXXXX/native/run` root with two sockets and two crumbs.
// This makes the rule a gate, beside the temp-root rule in `check:walls`.
//
// What it reads: each `.rs` file git lists under `packages/field-native/tests/` (item 252's listing), comments and
// the inside of string and char literals blanked. A FLOOR is a call of field_native's `bootstrap` or
// `bootstrap_with_logging` (in a file that imports it, or called as `field_native::bootstrap`), or of a function of
// the same file whose return type names `RunningDaemon` (a boot helper: it hands its floor to its caller, which owes
// the stop). Every other function, test or helper, that boots a floor must:
//   - bind it by a `let` (a name, or the name at `RunningDaemon`'s place in a helper's tuple; `_` binds nothing), and
//   - call `<name>.shutdown()` after that `let` and before the name is bound again (a second floor under the same
//     name owes its own stop), in the same function. `timeout(…, daemon.shutdown())` counts.
// A boot whose statement expects it to fail (`expect_err`, `unwrap_err`, `is_err`) starts no floor.
//
// What it cannot read: a floor handed to a helper in another file, or moved into a struct or into a function that
// stops it (name each in ALLOW with its reason), and a stop on one branch only (a test that stops its floor on one
// path passes here). The leftover witness (a run under a fresh TMPDIR, then a count of what is left) is the measure;
// this is the cheap net. The lib's own `src/` tests are not read.
//
// Usage: node scripts/check-floor-shutdown.mjs [--root <dir>] [--self-test]
//   exit 0 when every floor is stopped; exit 1 with each `file:line` of a floor that is not, and each ALLOW entry
//   that names nothing. --self-test runs the rule on fixtures in a temp git repository (removed after).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { git, repoFiles } from "./repo-files.mjs";

/** Each exception: `{ file, fn, reason }`. Empty at 60a75602a1b1, once door.rs and door_bridge.rs stop theirs. */
const ALLOW = [];

const TESTS = /^packages\/field-native\/tests\/.+\.rs$/;
const IMPORTS_BOOTSTRAP = /\buse\s+field_native::[^;]*\bbootstrap\b|\bfield_native::bootstrap\s*\(/;
const BOOTSTRAPS = ["bootstrap", "bootstrap_with_logging"];
const EXPECTS_FAILURE = /\b(?:expect_err|unwrap_err|is_err)\b/;
const TEST_ATTR = /#\[\s*(?:tokio::)?test\b/;
const CHAR_LITERAL = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|.)|[^\\'\n])'/;
const LET = /^\s*let\s+(?:mut\s+)?(\([^=]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]*)?=/;

/** `code` with every comment and the inside of every string and char literal blanked to spaces, its newlines
 * kept, so each offset and line is the source's. */
function blank(code) {
  const out = code.split("");
  const n = code.length;
  const wipe = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === "/" && d === "/") {
      const end = code.indexOf("\n", i);
      const j = end < 0 ? n : end;
      wipe(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        const pair = code.slice(j, j + 2);
        if (pair === "/*" || pair === "*/") {
          depth += pair === "/*" ? 1 : -1;
          j += 2;
        } else j += 1;
      }
      wipe(i, j);
      i = j;
      continue;
    }
    const raw = /^b?r(#*)"/.exec(code.slice(i, i + 64));
    if (raw !== null && !/[A-Za-z0-9_]/.test(code[i - 1] ?? "")) {
      const close = `"${raw[1]}`;
      const start = i + raw[0].length;
      const end = code.indexOf(close, start);
      const j = end < 0 ? n : end;
      wipe(start, j);
      i = j + close.length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && code[j] !== '"') j += code[j] === "\\" ? 2 : 1;
      wipe(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === "'") {
      // a char literal; a lifetime (`'a`) has no closing quote here and is left as it stands
      const ch = CHAR_LITERAL.exec(code.slice(i, i + 16));
      if (ch !== null) {
        wipe(i + 1, i + ch[0].length - 1);
        i += ch[0].length;
        continue;
      }
    }
    i += 1;
  }
  return out.join("");
}

/** The offset of the bracket that closes the one at `open` (`{`/`}`), or the text's end. */
function closing(clean, open) {
  let depth = 0;
  for (let k = open; k < clean.length; k++) {
    if (clean[k] === "{") depth += 1;
    else if (clean[k] === "}") {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return clean.length;
}

/** The top-level parts of a parenthesised list's inside, split at its commas. */
function topLevelParts(inside) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k < inside.length; k++) {
    const c = inside[k];
    if ("([{<".includes(c)) depth += 1;
    else if (")]}>".includes(c) && inside[k - 1] !== "-") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(inside.slice(from, k));
      from = k + 1;
    }
  }
  parts.push(inside.slice(from));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** Every `fn` with a body: name, body [open, close], whether a test attribute stands on it, and — for a boot
 * helper — where `RunningDaemon` stands in what it returns (-1: the whole value). */
function functions(clean) {
  const found = [];
  for (const m of clean.matchAll(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    let depth = 0;
    let k = m.index + m[0].length;
    for (; k < clean.length; k++) {
      const c = clean[k];
      if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth -= 1;
      else if (depth === 0 && (c === "{" || c === ";")) break;
    }
    if (clean[k] !== "{") continue; // a declaration without a body
    const header = clean.slice(m.index, k);
    const before = clean.slice(0, m.index);
    const lead = before.slice(Math.max(before.lastIndexOf("}"), before.lastIndexOf(";")) + 1);
    const ret = header.includes("->") ? header.slice(header.lastIndexOf("->") + 2).trim() : "";
    let handsOut = null;
    if (/\bRunningDaemon\b/.test(ret)) {
      if (ret.startsWith("(")) {
        const parts = topLevelParts(ret.slice(1, ret.lastIndexOf(")")));
        handsOut = parts.findIndex((p) => /\bRunningDaemon\b/.test(p));
      } else handsOut = -1;
    }
    found.push({
      name: m[1],
      at: m.index,
      open: k,
      close: closing(clean, k),
      test: TEST_ATTR.test(lead),
      handsOut,
    });
  }
  return found;
}

const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One file's floors: how many are booted, and each one not stopped, as `{ line, fn, why }`. */
function floorsOf(source) {
  const clean = blank(source);
  const fns = functions(clean);
  const helpers = new Map(fns.filter((f) => f.handsOut !== null).map((f) => [f.name, f.handsOut]));
  const callees = [...helpers.keys()];
  if (IMPORTS_BOOTSTRAP.test(clean)) callees.push(...BOOTSTRAPS);
  if (callees.length === 0) return { booted: 0, misses: [] };
  const names = callees.map(escapeRe).join("|");
  const CALL = new RegExp(`(?<![\\w.])(?:field_native::)?(${names})\\s*\\(`, "g");
  let booted = 0;
  const misses = [];
  for (const f of fns) {
    if (f.handsOut !== null) continue; // a boot helper: its caller owes the stop
    const body = clean.slice(f.open + 1, f.close);
    const base = f.open + 1;
    for (const call of body.matchAll(CALL)) {
      if (/\bfn\s+$/.test(body.slice(Math.max(0, call.index - 8), call.index))) continue;
      const head = body.slice(0, call.index);
      const start = Math.max(...[";", "{", "}"].map((c) => head.lastIndexOf(c))) + 1;
      let end = call.index;
      for (let depth = 0; end < body.length; end++) {
        const c = body[end];
        if ("([{".includes(c)) depth += 1;
        else if (")]}".includes(c)) {
          depth -= 1;
          if (depth < 0) break;
        } else if (c === ";" && depth === 0) break;
      }
      const statement = body.slice(start, end);
      if (EXPECTS_FAILURE.test(statement)) continue;
      booted += 1;
      const line = lineOf(clean, base + call.index);
      const miss = (why) => misses.push({ line, fn: f.name, why });
      const bound = LET.exec(statement);
      if (bound === null) {
        miss("a floor no `let` binds: nothing in this function can stop it");
        continue;
      }
      const at = helpers.get(call[1]) ?? -1;
      let name = bound[1];
      if (name.startsWith("(")) {
        const parts = topLevelParts(name.slice(1, -1));
        name = at >= 0 ? (parts[at] ?? "").replace(/^mut\s+/, "") : "";
      } else if (at >= 0) name = "";
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name === "_") {
        miss("a floor bound to no name (`_` or a pattern the gate cannot read)");
        continue;
      }
      const after = body.slice(end);
      const n = escapeRe(name);
      const again = new RegExp(`\\blet\\s+(?:mut\\s+)?(?:\\([^=]*\\b${n}\\b[^=]*\\)|${n}\\b)`);
      const next = again.exec(after);
      const span = next === null ? after : after.slice(0, next.index);
      if (!new RegExp(`\\b${n}\\s*\\.\\s*shutdown\\s*\\(\\s*\\)`).test(span)) {
        miss(`\`${name}\` is never stopped: end with \`${name}.shutdown().await\``);
      }
    }
  }
  return { booted, misses };
}

/** Every listed test file's floors under `root`, the ALLOW entries applied. */
function findUnstoppedFloors(root, allow = ALLOW) {
  const files = repoFiles(root).filter((rel) => TESTS.test(rel));
  let booted = 0;
  const misses = [];
  const used = new Set();
  for (const file of files) {
    const found = floorsOf(readFileSync(join(root, file), "utf8"));
    booted += found.booted;
    for (const miss of found.misses) {
      const hit = allow.findIndex((a) => a.file === file && a.fn === miss.fn);
      if (hit >= 0) used.add(hit);
      else misses.push(`${file}:${miss.line}  fn ${miss.fn}: ${miss.why} (item 443)`);
    }
  }
  allow.forEach((a, i) => {
    if (used.has(i)) return;
    misses.push(`${a.file}  ALLOW names fn ${a.fn}, which leaves no floor running (stale)`);
  });
  return { read: files.length, booted, misses };
}

// --- self-test ---------------------------------------------------------------
// A line marked `// NAMED` must be named, and no other. The fieldd file is never read; the untracked one is.
const USE = "use field_native::{bootstrap, config::NativeConfig, RunningDaemon};";
const FIXTURES = [
  {
    file: "packages/field-native/tests/p1.rs",
    lines: [
      USE,
      "async fn boot() -> (tempfile::TempDir, RunningDaemon) {",
      "    let dir = tempfile::tempdir().unwrap();",
      "    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))",
      "        .await",
      "        .unwrap();",
      "    (dir, daemon)",
      "}",
      "#[tokio::test]",
      "async fn never_stopped() {",
      "    let (_dir, daemon) = boot().await; // NAMED",
      "    assert!(daemon.state.door.info().is_some());",
      "    // daemon.shutdown().await; a comment is no stop",
      "}",
      "#[tokio::test]",
      "async fn stopped() {",
      "    let (_dir, daemon) = boot().await;",
      "    daemon.shutdown().await;",
      "}",
      "#[tokio::test]",
      "async fn the_second_floor_is_never_stopped() {",
      "    let (dir, daemon) = boot().await;",
      "    daemon.shutdown().await;",
      "    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf())) // NAMED",
      "        .await",
      '        .expect("bootstrap");',
      '    let _ = "daemon.shutdown()";',
      "    let _ = daemon.state.door.open_count();",
      "}",
    ],
  },
  {
    file: "packages/field-native/tests/helper.rs",
    lines: [
      USE,
      "async fn boot_at(dir: &std::path::Path) -> (",
      "    RunningDaemon,",
      "    u32,",
      ") {",
      "    (bootstrap(NativeConfig::for_data_dir(dir.to_path_buf())).await.unwrap(), 1)",
      "}",
      "async fn count_doors(dir: &std::path::Path) -> usize {",
      "    let (daemon, _n) = boot_at(dir).await; // NAMED",
      "    daemon.state.door.open_count()",
      "}",
      "#[tokio::test]",
      "async fn a_bounded_stop() {",
      "    let dir = tempfile::tempdir().unwrap();",
      "    let (daemon, _) = boot_at(dir.path()).await;",
      "    tokio::time::timeout(std::time::Duration::from_secs(30), daemon.shutdown())",
      "        .await",
      "        .unwrap();",
      "}",
      "#[tokio::test]",
      "async fn an_unbound_floor() {",
      "    let dir = tempfile::tempdir().unwrap();",
      "    let _ = boot_at(dir.path()).await; // NAMED",
      "}",
      "#[test]",
      "fn a_refused_boot_is_no_floor() {",
      "    let rt = tokio::runtime::Runtime::new().unwrap();",
      "    rt.block_on(async {",
      '        bootstrap(NativeConfig::for_data_dir("/n".into())).await.expect_err("no");',
      "    });",
      "}",
    ],
  },
  {
    // freeway_host.rs's shape: a function of its own named bootstrap, and field_native's not imported
    file: "packages/field-native/tests/own_bootstrap.rs",
    lines: [
      "fn bootstrap() -> serde_json::Value {",
      "    serde_json::json!({})",
      "}",
      "#[test]",
      "fn writes_its_own_bootstrap_line() {",
      "    let line = bootstrap();",
      "    assert!(line.is_object());",
      "}",
    ],
  },
  {
    file: "packages/fieldd/test/not_read.rs",
    lines: [
      USE,
      "#[tokio::test]",
      "async fn never_read() {",
      '    let daemon = bootstrap(NativeConfig::for_data_dir("/n".into())).await.unwrap();',
      "}",
    ],
  },
  {
    // item 252: untracked and not ignored, it is read before it is staged
    file: "packages/field-native/tests/twin.rs",
    untracked: true,
    lines: [
      "use field_native::{",
      "    bootstrap,",
      "    config::{NativeConfig},",
      "};",
      "#[tokio::test]",
      "async fn a_stop_in_a_raw_string_is_no_stop() {",
      "    let daemon = field_native::bootstrap(NativeConfig::default()).await.unwrap(); // NAMED",
      '    let _ = r#"daemon.shutdown().await"#;',
      "    let _ = '}';",
      "}",
    ],
  },
];

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), "vf-floor-shutdown-"));
  try {
    git(tmp, ["init", "-q"]);
    for (const { file, lines } of FIXTURES) {
      mkdirSync(dirname(join(tmp, file)), { recursive: true });
      writeFileSync(join(tmp, file), `${lines.join("\n")}\n`);
    }
    const tracked = FIXTURES.filter((f) => !f.untracked).map((f) => f.file);
    git(tmp, ["add", "-f", "--", ...tracked]);
    const want = FIXTURES.filter((f) => f.file.startsWith("packages/field-native/")).flatMap((f) =>
      f.lines.flatMap((text, i) => (text.includes("// NAMED") ? [`${f.file}:${i + 1}`] : [])),
    );
    const { read, booted, misses } = findUnstoppedFloors(tmp, []);
    const named = misses.map((m) => m.split("  ")[0]).sort();
    let ok = read === 4 && booted === 8;
    const counts = `${read} test files read (4), ${booted} floors booted (8)`;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${counts}`);
    const exact = JSON.stringify(named) === JSON.stringify([...want].sort());
    console.log(`  ${exact ? "PASS" : "FAIL"}  names exactly the ${want.length} marked lines`);
    if (!exact) for (const m of misses) console.log(`        named: ${m}`);
    ok &&= exact;
    const allowed = findUnstoppedFloors(tmp, [
      { file: "packages/field-native/tests/p1.rs", fn: "never_stopped", reason: "self-test" },
      { file: "packages/field-native/tests/p1.rs", fn: "stopped", reason: "self-test: stale" },
    ]).misses;
    const took = !allowed.some((m) => m.includes("fn never_stopped:"));
    const stale = allowed.some((m) => m.includes("ALLOW names fn stopped"));
    console.log(`  ${took ? "PASS" : "FAIL"}  an ALLOW entry takes its miss`);
    console.log(`  ${stale ? "PASS" : "FAIL"}  an ALLOW entry that names nothing is named stale`);
    ok &&= took && stale;
    console.log(ok ? "\nfloor self-test: all passed" : "\nfloor self-test: FAILURES present");
    return ok;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- entry -------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

const at = args.indexOf("--root");
const root = resolve(at >= 0 ? (args[at + 1] ?? ".") : join(import.meta.dirname, ".."));
const { read, booted, misses } = findUnstoppedFloors(root);
if (read === 0) {
  console.error(`check-floor-shutdown: FAIL — no field-native test file under ${root}`);
  process.exit(1);
}
if (misses.length > 0) {
  for (const miss of misses) console.error(miss);
  console.error(
    `\ncheck-floor-shutdown: FAIL — ${misses.length} floor(s) left running by a field-native ` +
      "test (item 443). End the function with `daemon.shutdown().await` before its TempDir " +
      "drops, as tests/mgmt_server.rs does (item 196).",
  );
  process.exit(1);
}
const files = `${read} field-native test files`;
console.log(`check-floor-shutdown: clean — ${booted} floors booted in ${files}; all stopped`);
