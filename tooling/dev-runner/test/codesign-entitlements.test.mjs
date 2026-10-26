// LSF-4's entitlement reader (apps/desktop/packaging/codesign-entitlements.mjs): the release gate reads a signed
// binary's entitlements as codesign's XML plist. Codesign's own text form, which the gate once read as "no key at all"
// (the first signed nightly's "V8 JIT entitlement is absent"), is refused in words.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ENTITLEMENT_ARGS,
  entitlementKeys,
} from "../../../apps/desktop/packaging/codesign-entitlements.mjs";

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
