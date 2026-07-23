import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitManifest } from "@vibefield/plugin-build";
import { kvManifest } from "../src/manifest";

// The §5.2 canonical artifact: vibefield.plugin.json is EMITTED from the TS
// source (PA-2: TS authors, JSON is the installed contract); the manifest
// test pins freshness the way gen:check pins contracts.rs.
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json");
const { unknownKeys } = emitManifest(kvManifest, out);
if (unknownKeys.length > 0) console.warn(`unknown manifest keys: ${unknownKeys.join(", ")}`);
console.log(`wrote ${out}`);
