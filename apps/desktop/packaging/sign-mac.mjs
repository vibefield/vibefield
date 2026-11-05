// LP-6 (2026-11-05) — the release overlay's macOS signer (electron-builder.release.yml `mac.sign`), electron-builder's
// own with one difference: per-binary entitlements.
//
// electron-builder 26.15.7 has no per-file entitlements. Its `getOptionsForFile` (app-builder-lib
// `out/mac/MacTargetHelper.js`) gives the app `entitlements` and every other signed path `entitlementsInherit`, so
// before LP-6 each Rust daemon, the Go sidecar and the native helpers carried allow-jit, which none of them uses.
// Its one door is `mac.sign`: given a function, `MacPackager.doSign` calls it with the very options it would hand its
// default signer (`out/macPackager.js`: `customSign ? customSign(opts, this) : sign({ ...opts, identity })`) and then
// notarizes exactly as before (`sign()` → `notarizeIfProvided`). So this hook:
//   1. refuses an executable or bundle in `bin/` that BIN_PROFILES (codesign-entitlements.mjs) does not name, before
//      anything is signed: a new binary is a decision about its entitlements, never a silent default;
//   2. wraps `optionsForFile` (what @electron/osx-sign asks for each path it signs) so every `none` entry of `bin/`
//      is signed with entitlements.mac.native.plist, and everything else keeps electron-builder's own mapping (the
//      app: entitlements.mac.plist; fieldd, Electron's frameworks and helpers: entitlements.mac.inherit.plist);
//   3. hands that to electron-builder's own signer, app-builder-lib's `macCodeSign.sign` (@electron/osx-sign's
//      `signAsync` under electron-builder's retry), reached through the electron-builder this package pins.
// The identity it signs with is electron-builder's: the certificate's SHA-1 where it has one (codesign takes either;
// dmg-builder signs the DMG by the same hash).
//
// Rejected alternatives: osx-sign's `optionsForFile` alone is not configurable from electron-builder's YAML; a re-sign
// after electron-builder would break the notarization ticket electron-builder already stapled; `notarize: false` plus
// a second notarization step would duplicate the credential handling run-macos-release.mjs preflights.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIN_PROFILES,
  BIN_ROOT,
  readBinEntries,
  unclassifiedBinEntries,
  withBinEntitlements,
} from "./codesign-entitlements.mjs";

/** The no-entitlement plist every `none` entry of `bin/` is signed with. */
export const NATIVE_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "entitlements.mac.native.plist",
);

/** electron-builder's own signer, `sign` of app-builder-lib's `out/codeSign/macCodeSign.js` — the function its default
 * path calls — resolved through THIS package's electron-builder (pnpm keeps app-builder-lib beside it, not here). */
export function builderSigner() {
  const fromHere = createRequire(import.meta.url);
  const fromBuilder = createRequire(fromHere.resolve("electron-builder"));
  const { sign } = fromBuilder("app-builder-lib/out/codeSign/macCodeSign.js");
  if (typeof sign !== "function") {
    throw new Error(
      "app-builder-lib's out/codeSign/macCodeSign.js exports no sign() — the electron-builder pin moved under LP-6's hook",
    );
  }
  return sign;
}

/** The hook's body, with the signer handed in (the test's seam): the census, then the signer on the mapped options. */
export async function signWithBinEntitlements(options, sign) {
  const binDir = join(options.app, ...BIN_ROOT);
  const unclassified = unclassifiedBinEntries(readBinEntries(binDir));
  if (unclassified.length > 0) {
    throw new Error(
      `LP-6: ${unclassified.map((name) => `bin/${name}`).join(", ")} ${unclassified.length === 1 ? "is" : "are"} ` +
        "signed code no entitlement profile names — add a row to BIN_PROFILES " +
        "(apps/desktop/packaging/codesign-entitlements.mjs): `none` unless V8 or another JIT runs in it",
    );
  }
  const jit = [...BIN_PROFILES].filter(([, profile]) => profile === "jit").map(([name]) => name);
  console.log(
    `  • per-binary entitlements  allow-jit: the app, Electron's helpers, bin/${jit.join(", bin/")}; ` +
      "none: every other entry of bin/",
  );
  return sign({
    ...options,
    optionsForFile: withBinEntitlements(options.optionsForFile, options.app, NATIVE_ENTITLEMENTS),
  });
}

/** electron-builder's `mac.sign` hook (`CustomMacSign`: the options, and the packager, which this does not need).
 * Default-exported and named nothing else: electron-builder takes a module's `sign` export before its default. */
export default async function signVibeField(options) {
  return signWithBinEntitlements(options, builderSigner());
}
