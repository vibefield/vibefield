// electron-builder afterPack hook — the fuse flip, in the one position
// electron-security-packaging.md §9.2 allows:
//
//   package app.asar and platform bundle
//   → FLIP FUSES on the packaged copy      ← this hook
//   → read back and compare every fuse     ← this hook
//   → sign nested binaries and the app
//   → notarize, audit, smoke, publish
//
// Two laws it exists to keep. ESP-1: fuses are flipped ONLY on the copied
// packaged application, never on the development Electron in node_modules —
// which is why this runs on `context.appOutDir` and nothing else. And §9.2:
// nothing may mutate the executable after signing, so flipping has to happen
// before the signer runs, not in a later step that would silently invalidate
// the signature.
//
// The readback is not ceremony. `flipFuses` reports what it wrote; only reading
// the wire back off the artifact proves what the artifact CARRIES — that is the
// difference between "we asked for this" and "this is what ships".
import { join } from "node:path";
import { FuseState, FuseV1Options, flipFuses, getCurrentFuseWire } from "@electron/fuses";
import { compareWire, fuseConfigFromMatrix, reconcileWithEnum } from "./fuse-matrix.mjs";

/** Where the Electron binary lives inside a packaged app, per platform. */
function electronBinary(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const name = packager.appInfo.productFilename;
  if (electronPlatformName === "darwin") {
    return join(appOutDir, `${name}.app`, "Contents", "MacOS", name);
  }
  if (electronPlatformName === "win32") return join(appOutDir, `${name}.exe`);
  return join(appOutDir, packager.executableName ?? name);
}

export default async function afterPack(context) {
  const target = electronBinary(context);
  const label = `${context.electronPlatformName}-${context.arch}`;

  // Schema reconciliation FIRST: if this Electron's fuse wire has grown or
  // renamed a fuse, every existing expectation would still pass while the new
  // one shipped at its default. §9.1 wants that reviewed, so it is fatal here.
  const drift = reconcileWithEnum(FuseV1Options);
  const problems = [
    ...drift.missing.map((n) => `fuse ${n} exists in @electron/fuses but not in the matrix`),
    ...drift.extra.map((n) => `matrix names ${n}, which @electron/fuses does not expose`),
    ...drift.misindexed.map((m) => `wire index disagreement — ${m}`),
    ...drift.unexpressed.map((n) => `fuse ${n} has no expectation in FUSE_MATRIX`),
  ];
  if (problems.length > 0) {
    throw new Error(
      `fuse matrix is out of date with @electron/fuses (ESP §9.1):\n  ${problems.join("\n  ")}`,
    );
  }

  // strictlyRequireAllFuses makes the tool itself refuse a partial config — the
  // same guard as above, enforced by the library rather than by us.
  // resetAdHocDarwinSignature: flipping rewrites the binary and invalidates any
  // existing signature; on Apple Silicon an unsigned mach-o will not execute at
  // all, so the ad-hoc signature must be re-applied as part of the flip.
  await flipFuses(target, {
    version: "1",
    strictlyRequireAllFuses: true,
    resetAdHocDarwinSignature: context.electronPlatformName === "darwin",
    ...fuseConfigFromMatrix(),
  });

  const wire = await getCurrentFuseWire(target);
  const { ok, mismatches, transitional } = compareWire(wire, { state: FuseState });
  if (!ok) {
    throw new Error(
      `fuse readback mismatch on ${label} (§9.2 — the artifact does not carry what we asked ` +
        `for):\n  ${mismatches.join("\n  ")}`,
    );
  }

  console.log(`  • fuses flipped and verified  target=${label}`);
  for (const t of transitional) console.log(`  • fuse TRANSITIONAL-REQUIRED  ${t}`);
}
