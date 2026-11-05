// LSF-4's entitlement reader (apps/desktop/packaging/codesign-entitlements.mjs): the release gate reads a signed
// binary's entitlements as codesign's XML plist. Codesign's own text form, which the gate once read as "no key at all"
// (the first signed nightly's "V8 JIT entitlement is absent"), is refused in words.
//
// LP-6: and the per-binary policy the release signer (packaging/sign-mac.mjs) and the gate share — fieldd and the app
// keep allow-jit, every other entry of Contents/Resources/bin is signed with no entitlement, and an executable the
// table does not name refuses the signing before anything is signed. With that hook set, electron-builder no longer
// reports a missing identity, so the overlay's afterSign reads the app's release signature back (the review's row).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALLOW_JIT,
  BIN_PROFILES,
  ENTITLEMENT_ARGS,
  entitlementFailures,
  entitlementKeys,
  entitlementProfile,
  MH_EXECUTE,
  machOFileType,
  readBinEntries,
  unclassifiedBinEntries,
  withBinEntitlements,
} from "../../../apps/desktop/packaging/codesign-entitlements.mjs";
import signVibeField, {
  afterSign,
  assertBuilderSigned,
  builderSigner,
  NATIVE_ENTITLEMENTS,
  signWithBinEntitlements,
} from "../../../apps/desktop/packaging/sign-mac.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const XML = `Executable=/x/VibeField
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>`;
const TEXT = `Executable=/x/VibeField
[Dict]
	[Key] com.apple.security.cs.allow-jit
	[Value]
		[Bool] true`;

test("the XML plist's keys are read; a signature with no entitlements reads as none", () => {
  assert.deepEqual(entitlementKeys(XML), ["com.apple.security.cs.allow-jit"]);
  assert.deepEqual(entitlementKeys("Executable=/x/VibeField\n"), []);
});

test("codesign's text form is refused in words, never read as an app without entitlements", () => {
  assert.throws(() => entitlementKeys(TEXT), /text form, not the XML plist asked for \(--xml\)/);
});

test("on this Mac: a copy signed with packaging/entitlements.mac.plist reads allow-jit with --xml, and the old reading is refused", (t) => {
  if (process.platform !== "darwin") return t.skip("codesign is macOS's");
  const dir = mkdtempSync(join(tmpdir(), "vf-entitlements-"));
  try {
    const bin = join(dir, "VibeField");
    copyFileSync("/usr/bin/true", bin);
    const plist = join(repo, "apps", "desktop", "packaging", "entitlements.mac.plist");
    const sign = spawnSync("codesign", ["--force", "--sign", "-", "--entitlements", plist, bin], {
      encoding: "utf8",
    });
    assert.equal(sign.status, 0, sign.stderr);
    const read = (args) => {
      const run = spawnSync("codesign", [...args, bin], { encoding: "utf8" });
      return `${run.stdout}\n${run.stderr}`;
    };
    assert.ok(entitlementKeys(read(ENTITLEMENT_ARGS)).includes("com.apple.security.cs.allow-jit"));
    assert.throws(() => entitlementKeys(read(["--display", "--entitlements", "-"])), /text form/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PACKAGING = join(repo, "apps", "desktop", "packaging");
const BIN = "Contents/Resources/bin";

test("LP-6: fieldd alone in bin keeps the JIT; every other entry of bin is none; outside bin is electron-builder's", () => {
  assert.equal(entitlementProfile(`${BIN}/fieldd`), "jit");
  for (const name of [
    "field-native",
    "field-terminal-host",
    "field-freeway-host",
    "rosettad",
    "sidecar-slim",
    "live-surface-capture-helper",
  ])
    assert.equal(entitlementProfile(`${BIN}/${name}`), "none", name);
  // the screenshot helper's bundle and the executable sealed inside it
  assert.equal(entitlementProfile(`${BIN}/field-screenshot-helper.app`), "none");
  assert.equal(
    entitlementProfile(`${BIN}/field-screenshot-helper.app/Contents/MacOS/field-screenshot-helper`),
    "none",
  );
  // a library or a data file needs no row of its own: none
  assert.equal(entitlementProfile(`${BIN}/mille.darwin-arm64.node`), "none");
  assert.equal(entitlementProfile(`${BIN}/live-surface-adapter.node`), "none");
  assert.equal(entitlementProfile(`${BIN}/loro_wasm_bg.wasm`), "none");
  // the app, Electron's own code and anything outside the bundle: electron-builder's mapping stands
  for (const path of [
    "",
    "Contents/MacOS/VibeField",
    "Contents/Frameworks/VibeField Helper (Renderer).app",
    "Contents/Frameworks/Electron Framework.framework",
    "Contents/Resources/app.asar.unpacked/node_modules/x/x.node",
    BIN,
    "../elsewhere/fieldd",
  ])
    assert.equal(entitlementProfile(path), null, path);
  // the table is the decision: exactly one JIT entry
  assert.deepEqual(
    [...BIN_PROFILES].filter(([, profile]) => profile === "jit").map(([name]) => name),
    ["fieldd"],
  );
});

test("LP-6: the signer's per-file options swap only a none path's entitlements, and keep everything else", () => {
  const app = "/out/mac-arm64/VibeField.app";
  const seen = [];
  const builder = (filePath) => {
    seen.push(filePath);
    return {
      entitlements: filePath === app ? "app.plist" : "inherit.plist",
      hardenedRuntime: true,
      timestamp: undefined,
      additionalArguments: [],
    };
  };
  const mapped = withBinEntitlements(builder, app, "/native.plist");
  assert.equal(mapped(app).entitlements, "app.plist");
  assert.equal(
    mapped(`${app}/Contents/Frameworks/VibeField Helper (GPU).app`).entitlements,
    "inherit.plist",
  );
  assert.equal(mapped(`${app}/${BIN}/fieldd`).entitlements, "inherit.plist");
  const native = mapped(`${app}/${BIN}/field-native`);
  assert.deepEqual(native, {
    entitlements: "/native.plist",
    hardenedRuntime: true,
    timestamp: undefined,
    additionalArguments: [],
  });
  assert.equal(
    mapped(`${app}/${BIN}/field-screenshot-helper.app/Contents/MacOS/field-screenshot-helper`)
      .entitlements,
    "/native.plist",
  );
  // electron-builder is still asked for every path, so its Hardened Runtime and timestamp stand everywhere
  assert.equal(seen.length, 5);
  assert.throws(() => withBinEntitlements(undefined, app, "/native.plist"), /no optionsForFile/u);
});

/** A thin 64-bit arm64 Mach-O header of `filetype` (2 MH_EXECUTE, 8 MH_BUNDLE): enough for `isMachO` and
 * `machOFileType`, on every platform. */
function machOHeader(filetype) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0xfeedfacf, 0); // the bytes cf fa ed fe
  header.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  header.writeUInt32LE(filetype, 12);
  return header;
}

/** A bin/ with a Mach-O header for each executable and library, on every platform. A library is staged 0755 on
 * purpose: its header, not its mode, says it is not a program. */
function stageBin(t, names) {
  const app = mkdtempSync(join(tmpdir(), "vf-lp6-"));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  const bin = join(app, "Contents", "Resources", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, kind] of Object.entries(names)) {
    const path = join(bin, name);
    if (kind === "bundle") mkdirSync(join(path, "Contents", "MacOS"), { recursive: true });
    else if (kind === "script") writeFileSync(path, "#!/bin/sh\nexit 0\n");
    else if (kind === "data") writeFileSync(path, "export {};\n");
    else writeFileSync(path, machOHeader(kind === "library" ? 8 : 2));
    if (kind === "exec" || kind === "script" || kind === "library") chmodSync(path, 0o755);
  }
  return { app, bin };
}

test("LP-6: a Mach-O's kind is its header's filetype — thin, or a fat file's first slice — never its mode", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vf-lp6-type-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const thin = join(dir, "thin");
  writeFileSync(thin, machOHeader(MH_EXECUTE));
  assert.equal(machOFileType(thin), MH_EXECUTE);
  const library = join(dir, "library.node");
  writeFileSync(library, machOHeader(8));
  chmodSync(library, 0o755);
  assert.equal(machOFileType(library), 8);
  // fat (big-endian header): one fat_arch whose slice starts at 4096
  const fat = Buffer.alloc(4096 + 16);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(1, 4);
  fat.writeUInt32BE(0x0100000c, 8);
  fat.writeUInt32BE(4096, 16);
  fat.writeUInt32BE(16, 20);
  machOHeader(MH_EXECUTE).copy(fat, 4096);
  writeFileSync(join(dir, "fat"), fat);
  assert.equal(machOFileType(join(dir, "fat")), MH_EXECUTE);
  // too short to say: null (readBinEntries then falls back to the executable bit)
  writeFileSync(join(dir, "short"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
  assert.equal(machOFileType(join(dir, "short")), null);
  if (process.platform === "darwin") assert.equal(machOFileType("/usr/bin/true"), MH_EXECUTE);
});

test("LP-6: an executable or a bundle the table does not name is unclassified; libraries, data and scripts are not", (t) => {
  const { bin } = stageBin(t, {
    fieldd: "exec",
    "field-native": "exec",
    "field-screenshot-helper.app": "bundle",
    "mille.darwin-arm64.node": "library",
    "service-harness.mjs": "data",
    "mystery-daemon": "exec",
    "Mystery.app": "bundle",
    "launcher.sh": "script",
  });
  const entries = readBinEntries(bin);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    [
      "Mystery.app",
      "field-native",
      "field-screenshot-helper.app",
      "fieldd",
      "launcher.sh",
      "mille.darwin-arm64.node",
      "mystery-daemon",
      "service-harness.mjs",
    ],
  );
  const mille = entries.find((entry) => entry.name === "mille.darwin-arm64.node");
  assert.deepEqual(mille, {
    name: "mille.darwin-arm64.node",
    bundle: false,
    machO: true,
    executable: false,
  });
  assert.deepEqual(unclassifiedBinEntries(entries), ["Mystery.app", "mystery-daemon"]);
});

test("LP-6: the hook refuses an unclassified binary BEFORE anything is signed, and signs a classified bin mapped", async (t) => {
  const refused = stageBin(t, { fieldd: "exec", "new-daemon": "exec" });
  let called = false;
  await assert.rejects(
    signWithBinEntitlements({ app: refused.app, optionsForFile: () => ({}) }, async () => {
      called = true;
    }),
    /LP-6: bin\/new-daemon is signed code no entitlement profile names/u,
  );
  assert.equal(called, false);

  const ok = stageBin(t, {
    fieldd: "exec",
    "field-native": "exec",
    "desktop-haptics.node": "library",
  });
  let handed;
  await signWithBinEntitlements(
    {
      app: ok.app,
      identity: "0123456789ABCDEF0123456789ABCDEF01234567",
      optionsForFile: () => ({ entitlements: "inherit.plist", hardenedRuntime: true }),
    },
    async (options) => {
      handed = options;
    },
  );
  assert.equal(handed.identity, "0123456789ABCDEF0123456789ABCDEF01234567");
  assert.equal(handed.optionsForFile(join(ok.bin, "fieldd")).entitlements, "inherit.plist");
  assert.equal(
    handed.optionsForFile(join(ok.bin, "field-native")).entitlements,
    NATIVE_ENTITLEMENTS,
  );
  assert.equal(
    handed.optionsForFile(join(ok.bin, "desktop-haptics.node")).entitlements,
    NATIVE_ENTITLEMENTS,
  );
});

test("LP-6: the release overlay signs through the hook, which reaches electron-builder's own signer", () => {
  const overlay = readFileSync(join(PACKAGING, "electron-builder.release.yml"), "utf8");
  assert.match(overlay, /^ {2}sign: packaging\/sign-mac\.mjs$/mu);
  assert.match(
    overlay,
    /^ {2}entitlementsInherit: packaging\/entitlements\.mac\.inherit\.plist$/mu,
  );
  assert.equal(typeof signVibeField, "function");
  // electron-builder takes a module's `sign` export before its default: the hook must be the default alone
  assert.equal(NATIVE_ENTITLEMENTS, join(PACKAGING, "entitlements.mac.native.plist"));
  assert.equal(typeof builderSigner(), "function");
});

test("LP-6 review: with mac.sign set, an app electron-builder could not sign stops the build at afterSign, naming the cause", async () => {
  // the overlay wires the check at the top level, the hook module's `afterSign` export
  const overlay = readFileSync(join(PACKAGING, "electron-builder.release.yml"), "utf8");
  assert.match(overlay, /^afterSign: packaging\/sign-mac\.mjs$/mu);
  assert.match(overlay, /^ {2}forceCodeSigning: true$/mu);
  assert.equal(typeof afterSign, "function");

  const context = {
    electronPlatformName: "darwin",
    appOutDir: join(tmpdir(), "release", "mac-arm64"),
    packager: { appInfo: { productFilename: "VibeField" } },
  };
  // a signed app: the release signature is read from the app electron-builder made, against apps/desktop's identity
  let asked;
  await assertBuilderSigned(context, async (root, files, what) => {
    asked = { root, files, what };
  });
  assert.deepEqual(asked, {
    root: join(PACKAGING, ".."),
    files: [join(context.appOutDir, "VibeField.app")],
    what: "app",
  });

  // a skipped signing (no identity in the keychain): refused, with the reason forceCodeSigning no longer gives
  await assert.rejects(
    assertBuilderSigned(context, async () => {
      throw new Error("code object is not signed at all");
    }),
    (error) => {
      assert.match(
        error.message,
        /^LP-6: electron-builder left .*VibeField\.app without the release signature/u,
      );
      assert.match(error.message, /no longer trips forceCodeSigning/u);
      assert.match(error.message, /keychain or in CSC_LINK/u);
      assert.match(error.message, /\(code object is not signed at all\)$/u);
      return true;
    },
  );

  // another platform's pass asks nothing
  let called = false;
  await assertBuilderSigned({ ...context, electronPlatformName: "win32" }, async () => {
    called = true;
  });
  assert.equal(called, false);
});

test("LP-6: the three plists — the app's and the inherited one grant allow-jit alone, the native one grants nothing", () => {
  const keys = (file) => entitlementKeys(readFileSync(join(PACKAGING, file), "utf8"));
  assert.deepEqual(keys("entitlements.mac.plist"), [ALLOW_JIT]);
  assert.deepEqual(keys("entitlements.mac.inherit.plist"), [ALLOW_JIT]);
  assert.deepEqual(keys("entitlements.mac.native.plist"), []);
});

test("LP-6: the gate's policy — jit holds allow-jit and nothing else, none holds nothing", () => {
  assert.deepEqual(entitlementFailures("jit", [ALLOW_JIT]), []);
  assert.deepEqual(entitlementFailures("jit", []), ["V8 JIT entitlement is absent"]);
  assert.deepEqual(entitlementFailures("jit", [ALLOW_JIT, "com.apple.security.get-task-allow"]), [
    "unexpected entitlements: com.apple.security.get-task-allow",
  ]);
  assert.deepEqual(entitlementFailures("none", []), []);
  assert.deepEqual(entitlementFailures("none", [ALLOW_JIT]), [
    `entitlements a native binary has no use for: ${ALLOW_JIT}`,
  ]);
  assert.throws(() => entitlementFailures(null, []), /unknown entitlement profile/u);
});

test("on this Mac: a copy signed with entitlements.mac.native.plist reads no key, and passes the none policy", (t) => {
  if (process.platform !== "darwin") return t.skip("codesign is macOS's");
  const dir = mkdtempSync(join(tmpdir(), "vf-entitlements-"));
  try {
    const bin = join(dir, "field-native");
    copyFileSync("/usr/bin/true", bin);
    const sign = spawnSync(
      "codesign",
      [
        "--force",
        "--sign",
        "-",
        "--options",
        "runtime",
        "--entitlements",
        NATIVE_ENTITLEMENTS,
        bin,
      ],
      { encoding: "utf8" },
    );
    assert.equal(sign.status, 0, sign.stderr);
    const run = spawnSync("codesign", [...ENTITLEMENT_ARGS, bin], { encoding: "utf8" });
    const keys = entitlementKeys(`${run.stdout}\n${run.stderr}`);
    assert.deepEqual(keys, []);
    assert.deepEqual(entitlementFailures("none", keys), []);
    // and it still runs under the Hardened Runtime with nothing granted
    assert.equal(spawnSync(bin).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
