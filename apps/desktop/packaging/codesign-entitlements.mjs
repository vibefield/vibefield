// LSF-4's entitlement reader (2026-10-26; the first signed nightly, run 40272843651) — the keys a signed binary's
// entitlements hold, read from `codesign --display --entitlements - --xml`. Without `--xml`, a modern codesign prints
// its own text form (`[Dict] [Key] com.apple.security.cs.allow-jit [Value] [Bool] true`). The release gate matched
// `<key>` in that and read NO key from a correctly signed app: it said "V8 JIT entitlement is absent" for an app
// signed with packaging/entitlements.mac.plist. So the XML form is asked for, and the text form, if it ever comes
// back, is refused in words rather than read as "none".
//
// LP-6 (2026-11-05) — and which entitlements each signed path GETS. Until LP-6 every nested binary inherited
// entitlements.mac.inherit.plist (allow-jit), because electron-builder 26.15.7 maps entitlements by three cases only
// (the app; a Library/LoginItems helper; everything else: `entitlementsInherit` — app-builder-lib
// `out/mac/MacTargetHelper.js` `getOptionsForFile`). The Rust daemons, the Go sidecar and the native helpers execute no
// JIT, so least privilege is none at all. The ONE table below says which entry of `Contents/Resources/bin` is which;
// packaging/sign-mac.mjs signs by it, and verify-live-surface-release.mjs reads every signature back against it.
import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { isMachO } from "../../../scripts/host-links.mjs";

/** codesign's arguments for a binary's entitlements, as an XML plist on stdout. */
export const ENTITLEMENT_ARGS = ["--display", "--entitlements", "-", "--xml"];

/** The entitlement keys in codesign's output. An XML plist yields its `<key>`s (none for an unsigned or bare
 * signature, which prints no plist, or for one signed with an empty dictionary). Codesign's text form throws: the
 * caller asked for XML and must not read it as empty. */
export function entitlementKeys(output) {
  if (/\[Key\]/u.test(output) && !output.includes("<plist")) {
    throw new Error(
      "codesign printed its text form, not the XML plist asked for (--xml) — the entitlements cannot be read",
    );
  }
  return Array.from(output.matchAll(/<key>([^<]+)<\/key>/gu), (match) => match[1]).sort();
}

/** V8's JIT under the Hardened Runtime: the one entitlement a signed VibeField grants anything. */
export const ALLOW_JIT = "com.apple.security.cs.allow-jit";

/** Where the app's sidecars live, flat (EDP-22/23; `bin/` in scripts/stage-package.mjs), as segments of a path
 * inside the bundle. */
export const BIN_ROOT = ["Contents", "Resources", "bin"];

/** The signing profile of each executable entry of `bin/`:
 * - `jit` — signed with entitlements.mac.inherit.plist (allow-jit): V8 runs in it.
 * - `none` — signed with entitlements.mac.native.plist (no key): native code with no JIT.
 * A library or a data file in `bin/` needs no row (it is `none`); an executable or a bundle that has none is
 * refused at signing and at the gate (`unclassifiedBinEntries`), so a new one is a decision, never a default. */
export const BIN_PROFILES = new Map([
  // The Node SEA (WP9): V8's JIT, the reason allow-jit exists at all. Its files-host role is the same executable.
  ["fieldd", "jit"],
  // field-native's release set (the floor's, scripts/native-floor.mjs): Rust.
  ["field-native", "none"],
  ["field-terminal-host", "none"],
  ["field-freeway-host", "none"],
  // AR-8: rosetta's history daemon, Rust.
  ["rosettad", "none"],
  // AH-1b: truffle's mesh sidecar, Go.
  ["sidecar-slim", "none"],
  // LSF-4: the ScreenCaptureKit helper, Objective-C++. Screen Recording is a TCC consent, not an entitlement.
  ["live-surface-capture-helper", "none"],
  // SNAP-D5/D9: the screenshot helper, a Swift bundle (ScreenCaptureKit; TCC keys its consent on the bundle).
  ["field-screenshot-helper.app", "none"],
]);

/** The profile a path inside the app is signed with: `jit` or `none` for an entry of `bin/` and everything inside it
 * (an entry the table does not name is `none`: a library or a data file, which no entitlement binds), or null outside
 * `bin/`, where electron-builder's own mapping stands (the app: entitlements.mac.plist; Electron's frameworks and
 * helpers: entitlements.mac.inherit.plist). */
export function entitlementProfile(pathInApp) {
  const parts = pathInApp.split(/[\\/]/u).filter((part) => part !== "" && part !== ".");
  if (parts.length <= BIN_ROOT.length) return null;
  if (BIN_ROOT.some((segment, index) => parts[index] !== segment)) return null;
  return BIN_PROFILES.get(parts[BIN_ROOT.length]) ?? "none";
}

/** electron-builder's per-file signing options (`optionsForFile`, which @electron/osx-sign calls for every path it
 * signs), with `entitlements` replaced by `nativePlist` wherever the profile is `none`. Every other option (the
 * Hardened Runtime, the timestamp, the requirements) is electron-builder's, unchanged, and a `jit` or out-of-`bin/`
 * path keeps electron-builder's own entitlements. */
export function withBinEntitlements(optionsForFile, app, nativePlist) {
  if (typeof optionsForFile !== "function") {
    throw new Error(
      "electron-builder handed the signer no optionsForFile — the entitlements cannot be mapped",
    );
  }
  return (filePath) => {
    const options = optionsForFile(filePath);
    if (entitlementProfile(relative(app, filePath)) !== "none") return options;
    return { ...options, entitlements: nativePlist };
  };
}

/** Each top-level entry of a `bin/` directory as the policy reads it: a bundle (`.app`, `.framework` — what the signer
 * seals as one), a Mach-O file, and whether that Mach-O is executable. */
export function readBinEntries(binDir) {
  return readdirSync(binDir, { withFileTypes: true })
    .map((entry) => {
      const path = join(binDir, entry.name);
      const bundle = entry.isDirectory() && /\.(app|framework)$/u.test(entry.name);
      const machO = entry.isFile() && lstatSync(path).size >= 4 && isMachO(path);
      const executable = machO && (lstatSync(path).mode & 0o111) !== 0;
      return { name: entry.name, bundle, machO, executable };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The entries no profile names that must have one: an executable Mach-O or a bundle. A library or a data file is
 * signed `none` and needs no row. */
export function unclassifiedBinEntries(entries) {
  return entries
    .filter((entry) => (entry.executable || entry.bundle) && !BIN_PROFILES.has(entry.name))
    .map((entry) => entry.name);
}

/** What a signed binary's entitlement keys must be for its profile, one line per failure: `jit` holds allow-jit and
 * nothing else; `none` holds nothing. */
export function entitlementFailures(profile, keys) {
  if (profile === "jit") {
    const failures = [];
    if (!keys.includes(ALLOW_JIT)) failures.push("V8 JIT entitlement is absent");
    const unexpected = keys.filter((key) => key !== ALLOW_JIT);
    if (unexpected.length > 0) failures.push(`unexpected entitlements: ${unexpected.join(", ")}`);
    return failures;
  }
  if (profile === "none") {
    return keys.length === 0
      ? []
      : [`entitlements a native binary has no use for: ${keys.join(", ")}`];
  }
  throw new Error(`unknown entitlement profile: ${String(profile)}`);
}
