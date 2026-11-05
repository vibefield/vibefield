// Item 181 (2026-11-05): the Mac app's usage strings, held to ONE table both ways. electron-builder.yml's
// `mac.extendInfo` (the words macOS shows when something asks for a protected resource) and the app's entitlements
// (entitlements.mac.plist) must agree with it: a class the hardened runtime gates prompts only with BOTH its string and
// its entitlement, an entitlement never ships without its string, and every key is one Apple documents.
//
// The three states (prod-builder, 11:41Z–11:48Z; VF-PM's FINAL 11:48Z):
//   "prompted"       a string; plus its entitlement when the hardened runtime gates the class;
//   "walled"         a gated class with its string and NO entitlement: refused with no prompt on a signed package;
//                    on an unsigned package of ours opened by LaunchServices the string makes a prompt where its
//                    absence is TCC's kill. Opening one is James's call, per class (EL7);
//   "walled-by-kill" no string (null in extendInfo, which the builder deletes) and no surface of ours reaching it.
// The audit behind each row: lanes/lp-wave1/item181/audit.md (vibe-field-42), its findings in LANDED "Item 181".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const REPO = join(import.meta.dirname, "..", "..", "..");
const read = (path) => readFileSync(join(REPO, path), "utf8");

/** The hardened runtime's resource-access entitlements, exactly as Apple lists them (security/hardened-runtime). */
const HARDENED = {
  camera: "com.apple.security.device.camera",
  audioInput: "com.apple.security.device.audio-input",
  appleEvents: "com.apple.security.automation.apple-events",
  addressbook: "com.apple.security.personal-information.addressbook",
  calendars: "com.apple.security.personal-information.calendars",
  photos: "com.apple.security.personal-information.photos-library",
  location: "com.apple.security.personal-information.location",
};

/** THE table: every key the app declares, its state, and the entitlement that gates it, if one does. */
const TABLE = [
  { key: "NSCameraUsageDescription", state: "walled", gate: HARDENED.camera },
  { key: "NSMicrophoneUsageDescription", state: "walled", gate: HARDENED.audioInput },
  { key: "NSAppleEventsUsageDescription", state: "walled", gate: HARDENED.appleEvents },
  { key: "NSContactsUsageDescription", state: "walled", gate: HARDENED.addressbook },
  { key: "NSCalendarsFullAccessUsageDescription", state: "walled", gate: HARDENED.calendars },
  // EventKit's reminders ride the calendars entitlement; the hardened runtime lists none of their own
  { key: "NSRemindersFullAccessUsageDescription", state: "walled", gate: HARDENED.calendars },
  // the same two under their pre-macOS 14 names, which iTerm2 and Ghostty carry: a program built on an older SDK may
  // ask by them, and a missing one is TCC's kill on an unsigned package
  { key: "NSCalendarsUsageDescription", state: "walled", gate: HARDENED.calendars },
  { key: "NSRemindersUsageDescription", state: "walled", gate: HARDENED.calendars },
  { key: "NSPhotoLibraryUsageDescription", state: "walled", gate: HARDENED.photos },
  { key: "NSLocationUsageDescription", state: "walled", gate: HARDENED.location },
  { key: "NSLocationWhenInUseUsageDescription", state: "walled", gate: HARDENED.location },
  // speech recognition has no entitlement of its own, and records through the microphone
  { key: "NSSpeechRecognitionUsageDescription", state: "walled", gate: HARDENED.audioInput },
  // entitlement-free: these prompt as VibeField today
  { key: "NSBluetoothAlwaysUsageDescription", state: "prompted" },
  { key: "NSAudioCaptureUsageDescription", state: "prompted" },
  { key: "NSDesktopFolderUsageDescription", state: "prompted" },
  { key: "NSDocumentsFolderUsageDescription", state: "prompted" },
  { key: "NSDownloadsFolderUsageDescription", state: "prompted" },
  { key: "NSRemovableVolumesUsageDescription", state: "prompted" },
  { key: "NSNetworkVolumesUsageDescription", state: "prompted" },
  { key: "NSFileProviderDomainUsageDescription", state: "prompted" },
  { key: "NSLocalNetworkUsageDescription", state: "prompted" },
  { key: "NSAppDataUsageDescription", state: "prompted" },
  { key: "NSAppBundlesUsageDescription", state: "prompted" },
  { key: "NSSystemAdministrationUsageDescription", state: "prompted" },
  // deprecated (Apple); Electron's plist carries it, so it is nulled to leave the package
  { key: "NSBluetoothPeripheralUsageDescription", state: "walled-by-kill" },
];

/** Apple's documented usage keys this table may use (Bundle Resources, Protected resources; read 2026-11-05). A key
 * outside it is a typo or a new decision, and either way a red. */
const APPLE_KEYS = new Set([
  "NSAppBundlesUsageDescription",
  "NSAppDataUsageDescription",
  "NSAppleEventsUsageDescription",
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCalendarsFullAccessUsageDescription",
  "NSCalendarsUsageDescription",
  "NSCalendarsWriteOnlyAccessUsageDescription",
  "NSCameraUsageDescription",
  "NSContactsUsageDescription",
  "NSDesktopFolderUsageDescription",
  "NSDocumentsFolderUsageDescription",
  "NSDownloadsFolderUsageDescription",
  "NSFileProviderDomainUsageDescription",
  "NSFileProviderPresenceUsageDescription",
  "NSLocalNetworkUsageDescription",
  "NSLocationUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSNetworkVolumesUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSRemindersFullAccessUsageDescription",
  "NSRemindersUsageDescription",
  "NSRemovableVolumesUsageDescription",
  "NSSpeechRecognitionUsageDescription",
  "NSSystemAdministrationUsageDescription",
]);

/** `mac.extendInfo` as written: `    Key: "words"` or `    Key: null`, comments allowed; any other line under it is a
 * red, so a reshaped block cannot slip past this reader. */
export function extendInfo(yaml) {
  const lines = yaml.split("\n");
  const at = lines.indexOf("  extendInfo:");
  assert.ok(at > -1, "electron-builder.yml has a mac.extendInfo block");
  const out = new Map();
  for (const line of lines.slice(at + 1)) {
    if (/^ {4}#/u.test(line)) continue;
    const m = /^ {4}([A-Za-z]+): (?:null|"([^"\\]+)")$/u.exec(line);
    if (m) {
      assert.ok(!out.has(m[1]), `${m[1]} declared twice`);
      out.set(m[1], m[2] ?? null);
      continue;
    }
    if (line === "" || /^ {0,2}\S/u.test(line)) break;
    assert.fail(`extendInfo: a line this test cannot read: ${line}`);
  }
  return out;
}

const plistKeys = (path) => [...read(path).matchAll(/<key>([^<]+)<\/key>/gu)].map((m) => m[1]);
const BUILDER = read("apps/desktop/packaging/electron-builder.yml");
const DECLARED = extendInfo(BUILDER);
const APP_ENTITLEMENTS = new Set(plistKeys("apps/desktop/packaging/entitlements.mac.plist"));

test("item 181: extendInfo declares exactly the table's keys, each one Apple documents", () => {
  assert.deepEqual([...DECLARED.keys()].sort(), TABLE.map((r) => r.key).sort());
  for (const { key } of TABLE)
    assert.ok(APPLE_KEYS.has(key), `${key} is not a key Apple documents`);
  assert.equal(new Set(TABLE.map((r) => r.key)).size, TABLE.length, "each key once");
});

test("item 181: a string for every row but walled-by-kill, and no Electron generic text left", () => {
  for (const { key, state } of TABLE) {
    const words = DECLARED.get(key);
    if (state === "walled-by-kill")
      assert.equal(words, null, `${key}: null, so the builder deletes it`);
    else assert.ok(typeof words === "string" && words.length > 20, `${key}: its words`);
    assert.doesNotMatch(
      words ?? "",
      /This app needs access to/u,
      `${key} still reads as Electron's`,
    );
    // the words say who asks: VibeField, or a program in one of its terminals
    if (words !== null) assert.match(words, /VibeField/u, `${key}: says who asks`);
  }
  assert.ok(
    !/extendInfo/u.test(read("apps/desktop/packaging/electron-builder.release.yml")),
    "the overlay keeps the base's",
  );
});

test("item 181: a gated class prompts only with its entitlement; no entitlement ships without its string", () => {
  const gates = new Set(Object.values(HARDENED));
  for (const { key, state, gate } of TABLE) {
    if (gate !== undefined)
      assert.ok(gates.has(gate), `${key}: ${gate} is not a hardened-runtime entitlement`);
    if (state === "walled") {
      assert.ok(gate !== undefined, `${key}: walled means gated`);
      assert.ok(!APP_ENTITLEMENTS.has(gate), `${key}: walled, yet the app holds ${gate}`);
    }
    if (state === "prompted" && gate !== undefined) {
      assert.ok(
        APP_ENTITLEMENTS.has(gate),
        `${key}: prompted and gated, so the app must hold ${gate}`,
      );
    }
  }
  // the other way: every resource-access entitlement the app holds has a prompted row with its string
  for (const entitlement of APP_ENTITLEMENTS) {
    if (!gates.has(entitlement)) continue;
    const rows = TABLE.filter((r) => r.gate === entitlement && r.state === "prompted");
    assert.ok(
      rows.length > 0,
      `${entitlement} ships without a prompted usage string (TCC kills the asker)`,
    );
    for (const { key } of rows)
      assert.ok(typeof DECLARED.get(key) === "string", `${key}: its string`);
  }
  // every class the hardened runtime gates is decided in the table
  for (const gate of gates)
    assert.ok(
      TABLE.some((r) => r.gate === gate),
      `${gate}: no row decides it`,
    );
});

test("item 181: the resource entitlements live on the app alone, never the inherited or native profiles", () => {
  const gates = new Set(Object.values(HARDENED));
  for (const path of [
    "apps/desktop/packaging/entitlements.mac.inherit.plist",
    "apps/desktop/packaging/entitlements.mac.native.plist",
  ]) {
    const held = plistKeys(path).filter((k) => gates.has(k));
    assert.deepEqual(
      held,
      [],
      `${path} holds a resource entitlement: the app's main executable is the responsible code`,
    );
  }
});

test("item 181: the reader refuses a line it cannot read, never skips it", () => {
  assert.deepEqual(
    [
      ...extendInfo(
        'mac:\n  extendInfo:\n    # a note\n    NSA: "w"\n    NSB: null\n  binaries:\n',
      ),
    ],
    [
      ["NSA", "w"],
      ["NSB", null],
    ],
  );
  assert.throws(
    () => extendInfo("mac:\n  extendInfo:\n    NSA: words without quotes\n"),
    /cannot read/u,
  );
  assert.throws(
    () => extendInfo('mac:\n  extendInfo:\n    NSA: "a"\n    NSA: "b"\n'),
    /declared twice/u,
  );
});

test("item 181: the files this test reads are its Nx inputs, so an edit to one re-runs it", () => {
  const { inputs } = JSON.parse(read("tooling/dev-runner/project.json")).targets.test;
  for (const path of [
    "apps/desktop/packaging/electron-builder.yml",
    "apps/desktop/packaging/electron-builder.release.yml",
    "apps/desktop/packaging/entitlements.mac.plist",
    "apps/desktop/packaging/entitlements.mac.inherit.plist",
    "apps/desktop/packaging/entitlements.mac.native.plist",
  ]) {
    assert.ok(inputs.includes(`{workspaceRoot}/${path}`), path);
  }
});
