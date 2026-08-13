import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitManifest } from "@vibefield/plugin-build";
import { manifest } from "../src/manifest";

// The §5.2 canonical artifact: `vibefield.plugin.json` is EMITTED from the TS
// source (PA-2: TS authors, JSON is the installed contract). `test/manifest.test.ts`
// pins its freshness the way `gen:check` pins the generated Rust contracts.
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json");
const { unknownKeys } = emitManifest(manifest, out);
if (unknownKeys.length > 0) console.warn(`unknown manifest keys: ${unknownKeys.join(", ")}`);
console.log(`wrote ${out}`);
