import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitManifest } from "@vibefield/plugin-build";
import { browserManifest } from "../src/manifest";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json");
const { unknownKeys } = emitManifest(browserManifest, out);
if (unknownKeys.length > 0) console.warn(`unknown manifest keys: ${unknownKeys.join(", ")}`);
console.log(`wrote ${out}`);
