import {
  FIELDD_PLUGIN_REGISTRY_KEY_ENV,
  FIELDD_PLUGIN_REGISTRY_URL_ENV,
} from "@vibefield/contracts";

// MK-6 (2026-11-14) — THE PLUGIN LIST'S DEVELOPMENT SEAM. No build configures a plugin list
// (DESIGN.md §8 "Plugins — the frame's second popup": Discover says "Nothing to discover yet" in
// every build until the registry rung, TD §9 TD-4), so outside fieldd's own tests nothing reaches
// the catalog's read, the install card's doors or the updates check. The smoke that gates the
// Plugins popup (`pnpm smoke:market`, desk-gates row 37) stages a signed list of its own on file://
// with keys it mints in memory, and hands fieldd the list's address and its PUBLIC key here, as
// smoke:bundled hands fieldd the trust anchor through FIELDD_TRUST_ROOT (bin.ts).
//
// Both or neither. A list with no key to verify it is never read (`plugin-install.ts`,
// `registryConfigured`), and a key with no list is nothing, so one alone is refused at boot by
// name rather than read as none. The words of a refusal name the variables and never their
// values. Refused when packaged, twice, as the debug swarm is: bin.ts fails the boot of a single
// executable handed either (`pluginRegistryOf`), and the shell blanks both for a packaged fieldd
// (main/fieldd.ts). A build's own list is the registry rung's, never this seam's.

/** The two values `RegistryInstallConfig` takes, as the seam hands them over. */
export interface PluginRegistrySeam {
  readonly registryUrl: string;
  readonly registryPublicKey: string;
}

/** The plugin list this development fieldd reads, or undefined when none is named. Throws on a
 * packaged fieldd handed either variable, on one without the other, and on an address that is not
 * file://, http:// or https://. */
export function pluginRegistryOf(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): PluginRegistrySeam | undefined {
  const url = env[FIELDD_PLUGIN_REGISTRY_URL_ENV] ?? "";
  const key = env[FIELDD_PLUGIN_REGISTRY_KEY_ENV] ?? "";
  if (url === "" && key === "") return undefined;
  if (packaged) {
    throw new Error(
      `${FIELDD_PLUGIN_REGISTRY_URL_ENV} or ${FIELDD_PLUGIN_REGISTRY_KEY_ENV} is set, and a packaged fieldd reads no plugin list from its environment: it is a development seam (MK-6); unset both`,
    );
  }
  if (url === "" || key === "") {
    const set = url === "" ? FIELDD_PLUGIN_REGISTRY_KEY_ENV : FIELDD_PLUGIN_REGISTRY_URL_ENV;
    const unset = url === "" ? FIELDD_PLUGIN_REGISTRY_URL_ENV : FIELDD_PLUGIN_REGISTRY_KEY_ENV;
    throw new Error(
      `${set} is set without ${unset}: a plugin list and the key that verifies it come together (MK-6); set both or neither`,
    );
  }
  if (!/^(?:file|https?):\/\//u.test(url)) {
    throw new Error(
      `${FIELDD_PLUGIN_REGISTRY_URL_ENV} is not a file://, http:// or https:// address (MK-6)`,
    );
  }
  return { registryUrl: url, registryPublicKey: key };
}
