import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as pin from "../../../scripts/pages-pin.mjs";

const { pagesEngineDevCopy, readPagesEngineEnv, readPagesPin } = pin;

// EY-1 1b (2026-11-19), and the release binary's stream port (2026-11-24): the dev runner's copy of the pages engine
// (scripts/pages-pin.mjs `pagesEngineDevCopy`), on a root of its own: a record in the converter's shape for a made-up
// package, its release "binary" installed as the npm package's, and its source build as a file the launcher names.
// The copy is of the SOURCE BUILD alone. The installed package's binary is the release: it is never copied.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PACKAGE = "made-up-engine";
const PLATFORM = "darwin-arm64";
const SOURCE_ENV = "VIBEFIELD_DEV_PAGES_ENGINE_SOURCE";
const RELEASE = Buffer.from("the release binary: it opens a port");
const BUILT = Buffer.from("the source build: started with the port off");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The record's text, in the converter's shape as the formatter leaves it. */
function recordText({
  release = RELEASE,
  built = BUILT,
  sourceBuild = true,
  starts = "sourceBuild",
}) {
  return [
    "export const PAGES_ENGINE_RECORD = {",
    `  package: "${PACKAGE}",`,
    '  version: "1.0.0",',
    '  tagCommit: "0000000000000000000000000000000000000000",',
    '  npmIntegrity: "sha512-made-up",',
    "  binarySha256: {",
    `    "${PLATFORM}": "${sha(release)}",`,
    "  },",
    ...(sourceBuild
      ? [
          "  sourceBuild: {",
          '    tagCommit: "1111111111111111111111111111111111111111",',
          `    patchSha256: "${sha("a patch")}",`,
          "    binarySha256: {",
          `      "${PLATFORM}": "${sha(built)}",`,
          "    },",
          "  },",
        ]
      : []),
    ...(starts === null ? [] : [`  starts: "${starts}",`]),
    "  core: [",
    "  ],",
    "};",
    'export const PAGES_SCRIPT_SET = { v: 1, engineVersion: "1.0.0", scripts: [] };',
    "",
  ].join("\n");
}

/** A root whose record names RELEASE and BUILT for PLATFORM, with the release installed as the npm package's binary
 * (none when `installed` is null) and `built` as the file a launcher would name. Answers the root, the installed
 * file's path and the built file's. */
function rootWith(dir, { installed = RELEASE, built = BUILT, record = {} } = {}) {
  const root = join(dir, "repo");
  mkdirSync(join(root, "packages", "contracts", "src"), { recursive: true });
  writeFileSync(join(root, "packages", "contracts", "src", "pages-record.ts"), recordText(record));
  const packageDir = join(root, "apps", "desktop", "node_modules", PACKAGE);
  const binary = join(packageDir, "bin", `${PACKAGE}-${PLATFORM}`);
  if (installed !== null) {
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: PACKAGE, version: "1.0.0" }),
    );
    writeFileSync(binary, installed);
  }
  const source = join(dir, "built", PACKAGE);
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, built, { mode: 0o755 });
  return { root, binary, source };
}

function scratch(body) {
  const dir = mkdtempSync(join(tmpdir(), "vf-pages-engine-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the dev runner's engine is its own copy of the source build the launcher names, made once and executable", () => {
  scratch((dir) => {
    const { root, binary, source } = rootWith(dir);
    const sourceMode = statSync(source).mode;
    const devRoot = join(dir, "dev");
    const first = pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source });
    assert.deepEqual(first, {
      path: join(devRoot, "pages-engine", sha(BUILT).slice(0, 16), PACKAGE),
      sha256: sha(BUILT),
      held: 0,
    });
    assert.deepEqual(readFileSync(first.path), BUILT);
    if (process.platform !== "win32") assert.equal(statSync(first.path).mode & 0o777, 0o755);
    // neither the launcher's file nor the installed package's is touched
    assert.equal(statSync(source).mode, sourceMode);
    assert.deepEqual(readFileSync(binary), RELEASE);
    const made = statSync(first.path).mtimeMs;
    assert.deepEqual(pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source }), first);
    assert.equal(statSync(first.path).mtimeMs, made, "a second launch reuses the copy");
  });
});

test("with the variable unset main has no engine: the installed npm binary is never a fallback", () => {
  scratch((dir) => {
    // the install is whole and its binary is the record's release: everything the old copy needed
    const { root } = rootWith(dir);
    const devRoot = join(dir, "dev");
    for (const source of [undefined, ""]) {
      const answer = pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source });
      assert.equal(answer.path, null);
      assert.equal(
        answer.warning,
        `${SOURCE_ENV} is not set, so main has no engine: it names the source build of ${PACKAGE} for ${PLATFORM} (SHA-256 ${sha(BUILT)}); the npm package's binary is never started`,
      );
    }
    assert.equal(existsSync(join(devRoot, "pages-engine")), false);
  });
});

test("the npm package's own binary, handed as the source, is refused by name and never copied", () => {
  scratch((dir) => {
    const { root, binary } = rootWith(dir);
    const devRoot = join(dir, "dev");
    const answer = pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source: binary });
    assert.equal(answer.path, null);
    assert.equal(
      answer.warning,
      `${SOURCE_ENV} names the RELEASE binary of ${PACKAGE} (SHA-256 ${sha(RELEASE)}), which opens a loopback command port and is never started; the record's source build is ${sha(BUILT)}. main has no engine`,
    );
    assert.equal(existsSync(join(devRoot, "pages-engine")), false);
  });
});

test("a file that is not the record's source build is refused with both sums, checked before any copy", () => {
  scratch((dir) => {
    const other = Buffer.from("some other build");
    const { root, source } = rootWith(dir, { built: other });
    const devRoot = join(dir, "dev");
    // the record still names BUILT; the launcher's file holds other bytes
    writeFileSync(
      join(root, "packages", "contracts", "src", "pages-record.ts"),
      recordText({ built: BUILT }),
    );
    const answer = pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source });
    assert.equal(answer.path, null);
    assert.equal(
      answer.warning,
      `${SOURCE_ENV} names a file with SHA-256 ${sha(other)}, and the record's source build is ${sha(BUILT)}: main has no engine`,
    );
    assert.equal(existsSync(join(devRoot, "pages-engine")), false);
  });
});

test("a relative path, a folder and a missing file are no engine, each said in one line", () => {
  scratch((dir) => {
    const { root } = rootWith(dir);
    const devRoot = join(dir, "dev");
    const said = (source) => pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source });
    assert.deepEqual(said("built/engine"), {
      path: null,
      warning: `${SOURCE_ENV} must be an absolute path: main has no engine`,
      held: 0,
    });
    assert.deepEqual(said(join(dir, "built")), {
      path: null,
      warning: `${SOURCE_ENV} names no regular file: main has no engine`,
      held: 0,
    });
    assert.deepEqual(said(join(dir, "built", "absent")), {
      path: null,
      warning: `${SOURCE_ENV} names no readable file (ENOENT): main has no engine`,
      held: 0,
    });
    for (const answer of [said("built/engine"), said(join(dir, "built"))]) {
      assert.equal(answer.warning.includes("\n"), false);
    }
  });
});

test("a copy that no longer holds the record's bytes is made again", () => {
  scratch((dir) => {
    const { root, source } = rootWith(dir);
    const devRoot = join(dir, "dev");
    const { path } = pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source });
    writeFileSync(path, "changed under the runner");
    assert.equal(pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source }).path, path);
    assert.deepEqual(readFileSync(path), BUILT);
  });
});

test("a host the record names no source build for has no engine, whatever the launcher names", () => {
  scratch((dir) => {
    const { root, source } = rootWith(dir);
    const devRoot = join(dir, "dev");
    assert.deepEqual(pagesEngineDevCopy(root, devRoot, { platform: "linux-x64", source }), {
      path: null,
      warning: `the record names no source build of ${PACKAGE} for linux-x64: main has no engine there`,
      held: 0,
    });
    assert.equal(existsSync(join(devRoot, "pages-engine")), false);
  });
});

test("a record that says anything but the source build is started hands main none", () => {
  scratch((dir) => {
    const { root, source } = rootWith(dir, { record: { starts: "release" } });
    const answer = pagesEngineDevCopy(root, join(dir, "dev"), { platform: PLATFORM, source });
    assert.equal(answer.path, null);
    assert.match(
      answer.warning,
      /says main starts "release"; only the source build may be started/,
    );
  });
});

test("an earlier copy under the dev root loses its execute bits: the release's cannot be started by its old path", {
  skip: process.platform === "win32",
}, () => {
  scratch((dir) => {
    const { root, source } = rootWith(dir);
    const devRoot = join(dir, "dev");
    // what a runner before 2026-11-24 left: its 0755 copy of the release binary
    const old = join(devRoot, "pages-engine", sha(RELEASE).slice(0, 16), PACKAGE);
    mkdirSync(dirname(old), { recursive: true });
    writeFileSync(old, RELEASE);
    chmodSync(old, 0o755);
    // with no engine to hand, the old copy is still held
    const none = pagesEngineDevCopy(root, devRoot, { platform: PLATFORM });
    assert.equal(none.path, null);
    assert.equal(none.held, 1);
    assert.equal(statSync(old).mode & 0o777, 0o644);
    // and with one, the source build's copy alone is executable
    chmodSync(old, 0o755);
    const answer = pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source });
    assert.equal(answer.held, 1);
    assert.equal(statSync(old).mode & 0o777, 0o644);
    assert.equal(statSync(answer.path).mode & 0o777, 0o755);
    assert.deepEqual(readFileSync(old), RELEASE, "held, never removed");
    assert.equal(pagesEngineDevCopy(root, devRoot, { platform: PLATFORM, source }).held, 0);
  });
});

test("the pin's reader: both identities of the real record, and which one is started", () => {
  const read = readPagesPin(repo);
  assert.equal(read.starts, "sourceBuild");
  assert.deepEqual(read.binarySha256, {
    "darwin-arm64": "a402fef2489c221b17522aa21f103ca5dc47f00ff5879d4a72c39881544730ab",
  });
  assert.deepEqual(read.sourceBuild, {
    tagCommit: read.tagCommit,
    patchSha256: "08274e8604452e6cfe1c167d98e6c3d63988e353a6c9cbe462d014140c7810f7",
    binarySha256: {
      "darwin-arm64": "f3a53cbce43fe30875d7d785a6f67647af4e96d987b8ea889fee8f0e68213dea",
    },
  });
  assert.deepEqual(pin.pagesRecordProblems(read), []);
});

test("the pin's reader keeps the two identities apart, and throws on a record without a source build", () => {
  scratch((dir) => {
    const { root } = rootWith(dir);
    const read = readPagesPin(root);
    // the record's own tag and release sums, never the nested build's
    assert.equal(read.tagCommit, "0".repeat(40));
    assert.deepEqual(read.binarySha256, { [PLATFORM]: sha(RELEASE) });
    assert.deepEqual(read.sourceBuild, {
      tagCommit: "1".repeat(40),
      patchSha256: sha("a patch"),
      binarySha256: { [PLATFORM]: sha(BUILT) },
    });
    const record = join(root, "packages", "contracts", "src", "pages-record.ts");
    writeFileSync(record, recordText({ sourceBuild: false }));
    assert.throws(() => readPagesPin(root), /PAGES_ENGINE_RECORD has no sourceBuild/);
    writeFileSync(record, recordText({ starts: null }));
    assert.throws(() => readPagesPin(root), /PAGES_ENGINE_RECORD has no starts/);
  });
});

test("preflight's hold says a record whose two identities disagree", () => {
  scratch((dir) => {
    // the fixture's source build is of another tag than its record: one problem, by name
    const { root } = rootWith(dir);
    assert.deepEqual(pin.pagesRecordProblems(readPagesPin(root)), [
      `packages/contracts/src/pages-record.ts: the source build is of commit ${"1".repeat(40)}, and the pin's tag is ${"0".repeat(40)}`,
    ]);
    const same = { ...readPagesPin(root), tagCommit: "1".repeat(40) };
    assert.deepEqual(pin.pagesRecordProblems(same), []);
    assert.deepEqual(pin.pagesRecordProblems({ ...same, starts: "release" }), [
      'packages/contracts/src/pages-record.ts: the record says main starts "release"; only the source build may be started',
    ]);
    const released = { ...same.sourceBuild, binarySha256: { [PLATFORM]: sha(RELEASE) } };
    assert.deepEqual(pin.pagesRecordProblems({ ...same, sourceBuild: released }), [
      `packages/contracts/src/pages-record.ts: the source build for ${PLATFORM} is a release binary's bytes`,
    ]);
  });
});

// The release binary's stream port (2026-11-24): the path of the installed package's binary can never become main's
// engine again. Wall R33 holds a LITERAL of that path to its namers; these rows hold the computed one, which the wall
// does not see: the helpers that place the installed binary serve preflight's hold of the install and nothing else.
test("the dev copy never reads the installed package: only preflight's hold places the npm binary", () => {
  const body = pagesEngineDevCopy.toString();
  assert.doesNotMatch(
    body,
    /pagesEngineBinary|pagesEnginePackageDir|PAGES_ENGINE_IMPORTER|node_modules/,
  );
  const text = readFileSync(join(repo, "scripts", "pages-pin.mjs"), "utf8");
  // each helper: its definition, and its uses inside the helpers and `pagesInstallProblems` alone
  assert.equal(text.split("pagesEngineBinary(").length - 1, 2);
  assert.equal(text.split("pagesEnginePackageDir(").length - 1, 3);
  const hold = text.slice(text.indexOf("export function pagesInstallProblems("));
  assert.equal(hold.split("pagesEngineBinary(").length - 1, 1);
  assert.equal(hold.split("pagesEnginePackageDir(").length - 1, 1);
});

test("no script of the runner, the packaging or the root names the helpers that place the npm binary", () => {
  const folders = ["tooling/dev-runner/src", "apps/desktop/packaging", "scripts"];
  let read = 0;
  for (const folder of folders) {
    for (const name of readdirSync(join(repo, folder))) {
      if (!/\.(?:[cm]?js|ts)$/.test(name) || `${folder}/${name}` === "scripts/pages-pin.mjs")
        continue;
      read += 1;
      assert.doesNotMatch(
        readFileSync(join(repo, folder, name), "utf8"),
        /pagesEngineBinary|pagesEnginePackageDir/,
        `${folder}/${name}`,
      );
    }
  }
  assert.ok(read > 20, "the folders were read");
});

test("the variable the runner sets is contracts', read from registries.ts (EY-1 1b)", () => {
  assert.match(readPagesEngineEnv(repo), /^VIBEFIELD_DEV_[A-Z0-9_]+$/);
  scratch((dir) => {
    mkdirSync(join(dir, "packages", "contracts", "src"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "contracts", "src", "registries.ts"),
      "export const OTHER = 1;\n",
    );
    assert.throws(() => readPagesEngineEnv(dir), /no VIBEFIELD_DEV_PAGES_ENGINE_ENV literal/);
  });
});

test("the variable the launcher sets is the runner's own, a VIBEFIELD_DEV_ name no child of fieldd inherits", () => {
  assert.equal(pin.PAGES_ENGINE_SOURCE_ENV, SOURCE_ENV);
  assert.notEqual(pin.PAGES_ENGINE_SOURCE_ENV, readPagesEngineEnv(repo));
});
