// MK-6 (2026-11-14) — the plugin list's development seam (registry-seam.ts): the list a development
// fieldd reads, and the public key that verifies it, named by FIELDD_PLUGIN_REGISTRY_URL and _KEY.
// Both or neither; a packaged fieldd refuses either; a refusal names the variables and never their
// values. bin.ts calls it before it writes a root or loads the daemon, beside the debug swarm's
// `debugSwarmCorpusOf`; that call and its order are held on fieldd's own bundle by
// registry-seam-packaged.test.ts (swarm-replay-packaged.test.ts's harness).
import {
  FIELDD_PLUGIN_REGISTRY_KEY_ENV,
  FIELDD_PLUGIN_REGISTRY_URL_ENV,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { pluginRegistryOf } from "../src/registry-seam";

const LIST = "file:///tmp/vf-market-fixture-test/listed/index.json";
/** a public key's shape only: nothing verifies here */
const PUBLIC = "MCowBQYDK2VwAyEAseamtestseamtestseamtestseamtestseamtes=";

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
});
