// Emits field-native/src/registries.rs from src/registries.ts (NF-D9): the Rust
// plane consumes ports/sockets/env-prefixes/store-names as GENERATED constants —
// the R4 drift class (hand-mirrored registries) exists to kill. Output is
// rustfmt-stable by construction; one formatter per file: its generator.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID, ENV_PREFIXES, FILES, PORTS, SOCKETS, STORES } from "../src/registries";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "field-native",
  "src",
  "registries.rs",
);

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
  "/// File names beneath a daemon's own data directory. The plane that OWNS the",
  "/// file joins the name to its data dir; readers ask that plane for the path.",
  "pub mod files {",
  ...Object.entries(FILES).map(([k, v]) => `    pub const ${k}: &str = "${v}";`),
  "}",
];

writeFileSync(OUT, `${lines.join("\n")}\n`);
console.log("wrote field-native/src/registries.rs");
