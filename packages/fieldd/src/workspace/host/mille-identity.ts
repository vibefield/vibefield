import { buildIdentity } from "@vibecook/mille";

/** What the ready line says about the engine this generation loaded: the
 * package's version and the native addon's own (a stale `.node` cannot pose
 * as the pinned one — mille's `buildIdentity`, made for exactly that). */
export function milleIdentity(): { packageVersion: string; nativeVersion: string } {
  const identity = buildIdentity();
  return { packageVersion: identity.packageVersion, nativeVersion: identity.nativeVersion };
}
