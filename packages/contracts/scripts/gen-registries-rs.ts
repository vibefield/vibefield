// Emits field-native/src/registries.rs from src/registries.ts (NF-D9): the Rust
// plane consumes ports/sockets/env-prefixes/store-names as GENERATED constants —
// the R4 drift class (hand-mirrored registries) exists to kill. Output is
// rustfmt-stable by construction; one formatter per file: its generator.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_ID,
  CELL_SUPERVISION,
  ENV_PREFIXES,
  FILES,
  LAYOUT,
  MESH_CONTROL_LIMITS,
  PORTS,
  SOCKETS,
  STORES,
  TERMINAL_SCROLLBACK_CLASS_BYTES,
} from "../src/registries";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "field-native", "src", "registries.rs");
// Committed machine artifact for non-TS consumers (dev-runner .mjs) — UA-D10.
const LAYOUT_JSON = join(HERE, "..", "gen", "layout.json");

const lines: string[] = [
  "// GENERATED from @vibefield/contracts src/registries.ts — do not edit.",
  "// Regenerate: `pnpm gen` (root) or `pnpm --filter @vibefield/contracts gen:rust`.",
  "// NF-D9: registries reach Rust by generation, never by retyping (drift class R4).",
  "",
  `pub const APP_ID: &str = "${APP_ID}";`,
  "",
  "/// Env prefixes joining Ghosttea's strip list (G1′/EL7) — daemon secrets",
  "/// never enter agent PTYs.",
  `pub const ENV_PREFIXES: &[&str] = &[${ENV_PREFIXES.map((p) => `"${p}"`).join(", ")}];`,
  "",
  "pub mod ports {",
  ...Object.entries(PORTS).map(([k, v]) => `    pub const ${k}: u16 = ${v};`),
  "}",
  "",
  "/// Socket file names under the daemon run dirs; paths are stable across",
  "/// restarts (external-mode law).",
  "pub mod sockets {",
  ...Object.entries(SOCKETS).map(([k, v]) => `    pub const ${k}: &str = "${v}";`),
  "}",
  "",
  "pub mod stores {",
  ...Object.entries(STORES).map(([k, v]) => `    pub const ${k}: &str = "${v}";`),
  "}",
  "",
  "pub mod mesh_control_limits {",
  ...Object.entries(MESH_CONTROL_LIMITS).map(([k, v]) => `    pub const ${k}: usize = ${v};`),
  "}",
  "",
  "/// TC-D6(c) — per-class scrollback BYTE caps, enforced at the native create",
  "/// seam (agents < interactive; the fleet-memory lever).",
  "pub mod terminal_scrollback_class_bytes {",
  ...Object.entries(TERMINAL_SCROLLBACK_CLASS_BYTES).map(
    ([k, v]) => `    pub const ${k}: usize = ${v};`,
  ),
  "}",
  "",
  "/// TC-S2 — the floor's supervision budget for a field-terminal-host cell.",
  "/// One authority with the TS side; see registries.ts for the rationale.",
  "pub mod cell_supervision {",
  ...Object.entries(CELL_SUPERVISION).map(([k, v]) => `    pub const ${k}: u64 = ${v};`),
  "}",
  "",
  "/// File names beneath a daemon's own data directory. The plane that OWNS the",
  "/// file joins the name to its data dir; readers ask that plane for the path.",
  "pub mod files {",
  ...Object.entries(FILES).map(([k, v]) => `    pub const ${k}: &str = "${v}";`),
  "}",
  "",
  "/// UA-D10 — the on-disk layout under a data root, as segments. One authority;",
  "/// consumers join, never respell. Pinned by fixtures/layout.vector.json.",
  "pub mod layout {",
  ...Object.entries(LAYOUT).map(
    ([k, v]) => `    pub const ${k}: &[&str] = &[${v.map((s) => `"${s}"`).join(", ")}];`,
  ),
  "    /// Every entry, for the cross-language fixture test.",
  "    pub const ALL: &[(&str, &[&str])] = &[",
  ...Object.keys(LAYOUT).map((k) => `        ("${k}", ${k}),`),
  "    ];",
  "}",
];

writeFileSync(OUT, `${lines.join("\n")}\n`);
console.log("wrote field-native/src/registries.rs");
mkdirSync(dirname(LAYOUT_JSON), { recursive: true });
writeFileSync(LAYOUT_JSON, `${JSON.stringify(LAYOUT, null, 2)}\n`);
console.log("wrote contracts/gen/layout.json");
