import assert from "node:assert/strict";
import test from "node:test";
import { extensionKeys, renderModule, supportTable } from "../../../scripts/gen-ghostty-keys.mjs";

// GT-7 + the EL8 to ghosttea 0.13.1 (2026-10-23): the key catalog's generator (scripts/gen-ghostty-keys.mjs). Two
// authorities, two lists: Ghostty's schema (`known-keys.txt`) and ghosttea's own keys (`GHOSTTEA_EXTENSION_KEYS`). A key
// `support_for_key` classifies must come from one of them, never both and never neither.

const LIB = (extensions, arms) => `pub const GHOSTTY_CONFIG_COMPAT_VERSION: &str = "1.3.1";
${extensions === null ? "" : `pub const GHOSTTEA_EXTENSION_KEYS: &[&str] = &[${extensions.map((key) => JSON.stringify(key)).join(", ")}];`}
pub fn support_for_key(key: &str) -> ConfigSupport {
    match key {
        ${arms}
        _ => ConfigSupport::Unsupported,
    }
}
`;

const ARMS = `"font-size" | "minimum-contrast"
        | "ghosttea-light-adaptation" => ConfigSupport::Applied,
        "keybind" => ConfigSupport::Parsed,`;

test("ghosttea's own keys are read from the crate's declaration, single- or multi-line, and none before 0.13.0", () => {
  assert.deepEqual(extensionKeys(LIB(["ghosttea-light-adaptation"], ARMS)), [
    "ghosttea-light-adaptation",
  ]);
  assert.deepEqual(
    extensionKeys(
      `pub const GHOSTTEA_EXTENSION_KEYS: &[&str] = &[\n    "ghosttea-b",\n    "ghosttea-a",\n];`,
    ),
    ["ghosttea-a", "ghosttea-b"],
  );
  assert.deepEqual(extensionKeys(LIB(null, `"font-size" => ConfigSupport::Applied,`)), []);
  assert.throws(
    () => extensionKeys(`pub static GHOSTTEA_EXTENSION_KEYS: [&str; 1] = ["x"];`),
    /changed its shape/,
  );
});

test("the module: Ghostty's schema in GHOSTTY_KEYS exactly, ghosttea's own keys beside it, each with its support", () => {
  const module = renderModule({
    version: "0.13.1",
    knownKeys: "font-size\nminimum-contrast\nkeybind\nbackground\n",
    lib: LIB(["ghosttea-light-adaptation"], ARMS),
  });
  const list = (name) =>
    module
      .slice(module.indexOf(`export const ${name}:`))
      .split("\n];")[0]
      .split("\n")
      .filter((line) => line.startsWith("  { key"));
  assert.deepEqual(list("GHOSTTY_KEYS"), [
    '  { key: "background", support: "unsupported" },',
    '  { key: "font-size", support: "applied" },',
    '  { key: "keybind", support: "parsed" },',
    '  { key: "minimum-contrast", support: "applied" },',
  ]);
  assert.deepEqual(list("GHOSTTEA_EXTENSION_KEYS"), [
    '  { key: "ghosttea-light-adaptation", support: "applied" },',
  ]);
  assert.match(module, /version: "0\.13\.1",/);
  assert.match(module, /ghostty: "1\.3\.1",/);
});

test("before ghosttea had keys of its own, the extension list is empty and GHOSTTY_KEYS is unchanged", () => {
  const module = renderModule({
    version: "0.12.0",
    knownKeys: "font-size\n",
    lib: LIB(null, `"font-size" => ConfigSupport::Applied,`),
  });
  assert.match(
    module,
    /GHOSTTEA_EXTENSION_KEYS: readonly \{ key: string; support: GhosttyKeySupport \}\[\] = \[\];/,
  );
  assert.match(module, /\{ key: "font-size", support: "applied" \},/);
});

test("a classified key in NEITHER list refuses, and so does a key in BOTH: the generator never guesses a schema", () => {
  assert.throws(
    () =>
      renderModule({
        version: "0.13.1",
        knownKeys: "font-size\nminimum-contrast\nkeybind\n",
        lib: LIB([], ARMS),
      }),
    /support_for_key names ghosttea-light-adaptation, which the schema does not know/,
  );
  assert.throws(
    () =>
      renderModule({
        version: "0.13.1",
        knownKeys: "font-size\nminimum-contrast\nkeybind\nghosttea-light-adaptation\n",
        lib: LIB(["ghosttea-light-adaptation"], ARMS),
      }),
    /ghosttea-light-adaptation is both a Ghostty key and a ghosttea extension/,
  );
  assert.equal(supportTable(LIB([], ARMS)).get("keybind"), "parsed");
});
