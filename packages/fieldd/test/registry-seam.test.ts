// MK-6 (2026-11-14) — the plugin list's development seam (registry-seam.ts): the list a development
// fieldd reads, and the public key that verifies it, named by FIELDD_PLUGIN_REGISTRY_URL and _KEY.
// Both or neither; a packaged fieldd refuses either; a refusal names the variables and never their
// values. bin.ts calls it before it writes a root or loads the daemon, beside the debug swarm's
// `debugSwarmCorpusOf`; that call and its order are held on fieldd's own bundle by
// registry-seam-packaged.test.ts (swarm-replay-packaged.test.ts's harness). The single executable's
// own reading is build-fieldd-sea.mjs --verify's probe H (item 435), which spells the names and the
// packaged refusal again; this file's last row holds that copy equal to the source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELDD_PLUGIN_REGISTRY_KEY_ENV,
  FIELDD_PLUGIN_REGISTRY_URL_ENV,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { pluginRegistryOf } from "../src/registry-seam";

const LIST = "file:///tmp/vf-market-fixture-test/listed/index.json";
/** a public key's shape only: nothing verifies here */
const PUBLIC = "MCowBQYDK2VwAyEAseamtestseamtestseamtestseamtestseamtes=";
/** The SEA build script: its --verify boots the executable with this seam set and holds stderr to
 * the refusal word for word (probe H). It imports no TypeScript, so it spells the two names and the
 * words again; read here as text, never run. */
const SEA_SCRIPT = join(
  fileURLToPath(import.meta.url),
  "../../../../apps/desktop/packaging/build-fieldd-sea.mjs",
);

const env = (url?: string, key?: string): Record<string, string | undefined> => ({
  ...(url !== undefined ? { [FIELDD_PLUGIN_REGISTRY_URL_ENV]: url } : {}),
  ...(key !== undefined ? { [FIELDD_PLUGIN_REGISTRY_KEY_ENV]: key } : {}),
});

describe("pluginRegistryOf — the plugin list's development seam (MK-6)", () => {
  it("names no list when neither is set, or both are empty (the shell's blank)", () => {
    expect(pluginRegistryOf(env(), false)).toBeUndefined();
    expect(pluginRegistryOf(env("", ""), false)).toBeUndefined();
    expect(pluginRegistryOf(env("", ""), true)).toBeUndefined();
  });

  it("hands a development fieldd the list and its key, as RegistryInstallConfig takes them", () => {
    expect(pluginRegistryOf(env(LIST, PUBLIC), false)).toEqual({
      registryUrl: LIST,
      registryPublicKey: PUBLIC,
    });
    const https = "https://plugins.example.test/index.json";
    expect(pluginRegistryOf(env(https, PUBLIC), false)?.registryUrl).toBe(https);
  });

  it("refuses a packaged fieldd handed either half, and says neither value", () => {
    for (const [url, key] of [
      [LIST, PUBLIC],
      [LIST, undefined],
      [undefined, PUBLIC],
    ] as const) {
      let said = "";
      expect(() => {
        try {
          pluginRegistryOf(env(url, key), true);
        } catch (error) {
          said = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }).toThrow(/a packaged fieldd reads no plugin list from its environment/u);
      expect(said).not.toContain(LIST);
      expect(said).not.toContain(PUBLIC);
    }
  });

  it("refuses one half without the other in development, naming which is missing", () => {
    expect(() => pluginRegistryOf(env(LIST, undefined), false)).toThrow(
      `${FIELDD_PLUGIN_REGISTRY_URL_ENV} is set without ${FIELDD_PLUGIN_REGISTRY_KEY_ENV}`,
    );
    expect(() => pluginRegistryOf(env(undefined, PUBLIC), false)).toThrow(
      `${FIELDD_PLUGIN_REGISTRY_KEY_ENV} is set without ${FIELDD_PLUGIN_REGISTRY_URL_ENV}`,
    );
  });

  it("refuses an address of any other kind, without saying it", () => {
    for (const url of ["/tmp/index.json", "ftp://example.test/index.json", "index.json"]) {
      let said = "";
      try {
        pluginRegistryOf(env(url, PUBLIC), false);
      } catch (error) {
        said = error instanceof Error ? error.message : String(error);
      }
      expect(said).toMatch(/is not a file:\/\/, http:\/\/ or https:\/\/ address/u);
      expect(said).not.toContain(url);
    }
  });

  it("refuses a packaged fieldd in the words probe H holds on the executable (item 435)", () => {
    let said = "";
    try {
      pluginRegistryOf(env(LIST, PUBLIC), true);
    } catch (error) {
      said = error instanceof Error ? error.message : String(error);
    }
    const names = `${FIELDD_PLUGIN_REGISTRY_URL_ENV} or ${FIELDD_PLUGIN_REGISTRY_KEY_ENV}`;
    expect(said.startsWith(names), said).toBe(true);
    const script = readFileSync(SEA_SCRIPT, "utf8");
    for (const [name, value] of [
      ["PLUGIN_REGISTRY_URL_ENV", FIELDD_PLUGIN_REGISTRY_URL_ENV],
      ["PLUGIN_REGISTRY_KEY_ENV", FIELDD_PLUGIN_REGISTRY_KEY_ENV],
    ] as const) {
      expect(script, `build-fieldd-sea.mjs spells ${name}`).toContain(
        `const ${name} = ${JSON.stringify(value)};`,
      );
    }
    // the words after the two names: one literal there, after bin.ts's prefix and the names
    expect(script, "build-fieldd-sea.mjs spells the refusal's words").toContain(
      JSON.stringify(said.slice(names.length)),
    );
  });
});
