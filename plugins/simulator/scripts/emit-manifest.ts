import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitManifest } from "@vibefield/plugin-build";
import { simulatorManifest } from "../src/manifest";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json");
const { unknownKeys } = emitManifest(simulatorManifest, out);
if (unknownKeys.length > 0) console.warn(`unknown manifest keys: ${unknownKeys.join(", ")}`);
console.log(`wrote ${out}`);
