import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitManifest } from "@vibefield/plugin-build";
import { fieldToolsManifest } from "../src/manifest";

// C1d — the §5.2 canonical artifact: vibefield.plugin.json is EMITTED from the
// TS source (PA-2); the manifest test pins freshness like gen:check.
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json");
const { unknownKeys } = emitManifest(fieldToolsManifest, out);
if (unknownKeys.length > 0) console.warn(`unknown manifest keys: ${unknownKeys.join(", ")}`);
console.log(`wrote ${out}`);
