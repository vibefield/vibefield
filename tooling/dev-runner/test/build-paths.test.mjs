// LP-6b (item 170): THE release switch and the build-path remap every shipped native build takes under it
// (scripts/build-paths.mjs) — field-native's release entry, rosettad's and mille's sibling builds, a go sibling's — each
// through the door that APPENDS to the flags cargo would otherwise have used, never clobbering them. Unset, every build is
// the plain one, so a development build in the shared target directory keeps its cache. And the stage's one rewrite on
// macOS: mille's .node leaves with `@rpath/<file>` as its own install name, signed ad hoc, before electron-builder runs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  RELEASE_BUILD_ARGS,
  releaseInvocation,
} from "../../../apps/desktop/packaging/build-native-release.mjs";
import {
  cargoRemap,
  configRustflags,
  envRustflags,
  envTargetRustflags,
  napiRemapEnv,
  REMAP_SWITCH,
  readConfigRustflags,
  remapFlags,
  remapRequested,
  setInstallName,
} from "../../../scripts/build-paths.mjs";
import { builderPathCounts } from "../../../scripts/host-links.mjs";
import {
  goBuildArgs,
  pnpmRunDirs,
  siblingCargoInvocation,
  siblingPnpmEnv,
} from "../../../scripts/siblings.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ON = { [REMAP_SWITCH]: "1" };
// a host with no real directories behind it: nothing resolves, no config file exists
const HOST = { CARGO_HOME: "/nowhere/cargo-home", RUSTUP_HOME: "/nowhere/rustup-home" };
const unresolved = () => null;

test('the switch is VIBEFIELD_REMAP_BUILD_PATHS: "1" remaps, unset, empty or "0" does not, anything else is refused', () => {
  assert.equal(REMAP_SWITCH, "VIBEFIELD_REMAP_BUILD_PATHS");
  assert.equal(remapRequested(ON), true);
  for (const env of [{}, { [REMAP_SWITCH]: "" }, { [REMAP_SWITCH]: "0" }])
    assert.equal(remapRequested(env), false, JSON.stringify(env));
  for (const value of ["true", "yes", "2"])
    assert.throws(() => remapRequested({ [REMAP_SWITCH]: value }), /the switch is "1"/);
});

test("the remap: the roots, CARGO_HOME and RUSTUP_HOME, each as given and as its real path, shortest prefix first", () => {
  const real = new Map([["/Users/me/.cargo", "/Volumes/ssd/cargo-home"]]);
  assert.deepEqual(
    remapFlags({
      roots: [
        ["/Users/me/src/vibe-field", "/vibefield"],
        ["/Volumes/SamsungRed/rust/target", "/target"],
        [null, "/target"],
      ],
      env: {},
      home: "/Users/me",
      realpath: (path) => real.get(path) ?? path,
    }),
    [
      "--remap-path-prefix=/Users/me/.cargo=/cargo",
      "--remap-path-prefix=/Users/me/.rustup=/rustup",
      "--remap-path-prefix=/Volumes/ssd/cargo-home=/cargo",
      "--remap-path-prefix=/Users/me/src/vibe-field=/vibefield",
      "--remap-path-prefix=/Volumes/SamsungRed/rust/target=/target",
    ],
  );
  // CI's own homes, given in the environment: the target nested in the checkout is written by its own, later mapping
  assert.deepEqual(
    remapFlags({
      roots: [
        ["/Users/runner/work/vibefield/rosetta-pin", "/rosetta"],
        ["/Users/runner/work/vibefield/rosetta-pin/target", "/target"],
      ],
      env: { CARGO_HOME: "/Users/runner/.cargo/", RUSTUP_HOME: "/Users/runner/.rustup" },
      home: "/nowhere",
      realpath: unresolved,
    }),
    [
      "--remap-path-prefix=/Users/runner/.cargo=/cargo",
      "--remap-path-prefix=/Users/runner/.rustup=/rustup",
      "--remap-path-prefix=/Users/runner/work/vibefield/rosetta-pin=/rosetta",
      "--remap-path-prefix=/Users/runner/work/vibefield/rosetta-pin/target=/target",
    ],
  );
});

test("a config file's rustflags are read as build or target, by table header or dotted key", () => {
  assert.deepEqual(configRustflags('[build]\ntarget-dir = "/Volumes/ssd/t"\n'), {
    build: false,
    target: false,
  });
  assert.deepEqual(configRustflags('[build]\nrustflags = ["-C", "debuginfo=1"]\n'), {
    build: true,
    target: false,
  });
  assert.deepEqual(configRustflags('build.rustflags = "-Dwarnings"\n'), {
    build: true,
    target: false,
  });
  assert.deepEqual(
    configRustflags('[target.aarch64-apple-darwin]\nlinker = "cc"\nrustflags = ["-C", "x"]\n'),
    { build: false, target: true },
  );
  assert.deepEqual(
    configRustflags(`[target.'cfg(target_os = "macos")']\nrustflags = ["-C", "x"]\n`),
    { build: false, target: true },
  );
  assert.deepEqual(configRustflags('target.x86_64-apple-darwin.rustflags = ["-C", "y"]\n'), {
    build: false,
    target: true,
  });
  // a comment, an array element holding '=', a [[table]] and a key that only ends in the word are none of them
  assert.deepEqual(
    configRustflags(
      '# rustflags = ["-C"]\n[build]\nnot-rustflags = 1\nflags = [\n  "--remap-path-prefix=/a=/b",\n]\n[[alias]]\nrustflags = 1\n',
    ),
    { build: false, target: false },
  );
});

test("review: a dotted key's quoted '=', an inline table and a quoted key are read where cargo reads them", () => {
  // the key's '=' is the first OUTSIDE quotes: a cfg's own '=' is part of the key
  assert.deepEqual(configRustflags(`target.'cfg(target_os = "macos")'.rustflags = ["-C", "x"]\n`), {
    build: false,
    target: true,
  });
  assert.deepEqual(
    configRustflags(`target."cfg(all(unix, target_arch = \\"aarch64\\"))".rustflags = ["-C"]\n`),
    { build: false, target: true },
  );
  // inline tables, one line each (TOML's rule), at any depth
  assert.deepEqual(
    configRustflags('target = { aarch64-apple-darwin = { rustflags = ["-C", "x"] } }\n'),
    { build: false, target: true },
  );
  assert.deepEqual(
    configRustflags('[target]\naarch64-apple-darwin = { linker = "cc", rustflags = ["-C"] }\n'),
    { build: false, target: true },
  );
  assert.deepEqual(configRustflags('build = { rustflags = ["-C", "debuginfo=1"] }\n'), {
    build: true,
    target: false,
  });
  // a quoted key segment is the same key
  assert.deepEqual(configRustflags('[build]\n"rustflags" = ["-C"]\n'), {
    build: true,
    target: false,
  });
  // none of these: a cfg table's linker, [env]'s RUSTFLAGS (a variable for rustc's children, not cargo's flags), an
  // inline table that does not name the key, a multi-line array's '=' inside its strings
  assert.deepEqual(
    configRustflags(
      `[target.'cfg(target_os = "macos")']\nlinker = "cc"\n[env]\nRUSTFLAGS = { value = "-C x", force = true }\n[build]\nx = { y = "rustflags = 1" }\nrustdocflags = [\n  "--cfg=rustflags=1",\n]\n`,
    ),
    { build: false, target: false },
  );
});

test("review: CARGO_TARGET_<TRIPLE>_RUSTFLAGS is target rustflags — refused by both doors unless cargo was ignoring it anyway", () => {
  const flags = ["--remap-path-prefix=/w=/rosetta"];
  const target = { CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS: "-C target-cpu=apple-m1" };
  assert.deepEqual(envTargetRustflags({ ...target, CARGO_TARGET_DIR: "/t", RUSTFLAGS: "-D" }), [
    "CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS",
  ]);
  assert.deepEqual(envTargetRustflags({ CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER: "cc" }), []);
  // a cargo we run: cargo would drop every build.rustflags, ours too — refused by name
  assert.throws(
    () => cargoRemap({ args: ["build"], env: { ...target }, flags }),
    /CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS sets target rustflags, so cargo would ignore the remap's build\.rustflags/,
  );
  // … unless the environment's own flags already override it: appended there, as before
  assert.equal(
    cargoRemap({ args: ["build"], env: { ...target, RUSTFLAGS: "-Dwarnings" }, flags }).door,
    "CARGO_ENCODED_RUSTFLAGS",
  );
  // napi's RUSTFLAGS would replace it: refused by name
  assert.throws(
    () => napiRemapEnv({ env: { ...target }, flags }),
    /CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS sets rustflags, which napi's RUSTFLAGS would replace/,
  );
});

test("the config files cargo reads for a build in a directory: every .cargo/ above it, then CARGO_HOME's", () => {
  const files = {
    "/w/mille-pin/.cargo/config.toml": '[build]\nrustflags = ["-C", "a"]\n',
    "/w/.cargo/config": '[build]\ntarget-dir = "/t"\n',
    "/h/config.toml": '[target.aarch64-apple-darwin]\nrustflags = ["-C", "b"]\n',
  };
  const read = (path) => files[path] ?? null;
  assert.deepEqual(
    readConfigRustflags("/w/mille-pin/packages/mille", { env: { CARGO_HOME: "/h" }, read }),
    [
      { file: "/w/mille-pin/.cargo/config.toml", build: true, target: false },
      { file: "/h/config.toml", build: false, target: true },
    ],
  );
  assert.deepEqual(readConfigRustflags("/elsewhere", { env: {}, home: "/nobody", read }), []);
});

test("a cargo WE run: --config build.rustflags (joined with a config's own) unless the environment carries flags, then appended there", () => {
  const flags = [
    "--remap-path-prefix=/Users/John Doe/.cargo=/cargo",
    "--remap-path-prefix=/w=/vibefield",
  ];
  // no environment flags: cargo's own config arrays join, so the flags ride --config, a space in a path intact
  const plain = cargoRemap({ args: RELEASE_BUILD_ARGS, env: { PATH: "/bin" }, flags });
  assert.equal(plain.door, "--config build.rustflags");
  assert.deepEqual(plain.args, [
    "--config",
    'build.rustflags=["--remap-path-prefix=/Users/John Doe/.cargo=/cargo","--remap-path-prefix=/w=/vibefield"]',
    ...RELEASE_BUILD_ARGS,
  ]);
  assert.deepEqual(plain.env, { PATH: "/bin" });
  // a config's build.rustflags is joined, not refused
  const joined = cargoRemap({
    args: ["build"],
    env: {},
    flags,
    configs: [{ file: "/w/.cargo/config.toml", build: true, target: false }],
  });
  assert.equal(joined.door, "--config build.rustflags");
  // the environment's RUSTFLAGS is folded in as cargo splits it, then dropped: CARGO_ENCODED_RUSTFLAGS is read first
  assert.deepEqual(
    cargoRemap({
      args: ["build"],
      env: { RUSTFLAGS: "  -C target-cpu=native   -Dwarnings " },
      flags,
    }),
    {
      args: ["build"],
      env: {
        CARGO_ENCODED_RUSTFLAGS: ["-C", "target-cpu=native", "-Dwarnings", ...flags].join("\x1f"),
      },
      door: "CARGO_ENCODED_RUSTFLAGS",
    },
  );
  // an encoded list is appended to as it stands (and wins over RUSTFLAGS, as in cargo); an empty one is still "set"
  assert.deepEqual(
    cargoRemap({
      args: ["build"],
      env: { CARGO_ENCODED_RUSTFLAGS: "-C\x1fdebuginfo=1", RUSTFLAGS: "-Dwarnings" },
      flags,
    }).env,
    { CARGO_ENCODED_RUSTFLAGS: ["-C", "debuginfo=1", ...flags].join("\x1f") },
  );
  assert.deepEqual(envRustflags({ CARGO_ENCODED_RUSTFLAGS: "" }), []);
  assert.equal(envRustflags({}), null);
  // a config's TARGET rustflags would make cargo drop every build.rustflags, ours too: refused, by name
  assert.throws(
    () =>
      cargoRemap({
        args: ["build"],
        env: {},
        flags,
        configs: [{ file: "/h/config.toml", build: false, target: true }],
      }),
    /\/h\/config\.toml sets target rustflags, so cargo would ignore the remap's build\.rustflags/,
  );
  // … unless the environment's flags already override every config: then appended there, as above
  assert.equal(
    cargoRemap({
      args: ["build"],
      env: { RUSTFLAGS: "-Dwarnings" },
      flags,
      configs: [{ file: "/h/config.toml", build: false, target: true }],
    }).door,
    "CARGO_ENCODED_RUSTFLAGS",
  );
});

test("napi's door is RUSTFLAGS, composed as napi reads it; whitespace and a config's rustflags are refused", () => {
  const flags = ["--remap-path-prefix=/w/mille-pin=/mille", "--remap-path-prefix=/h=/cargo"];
  assert.deepEqual(napiRemapEnv({ env: { PATH: "/bin" }, flags }), {
    env: { PATH: "/bin", RUSTFLAGS: flags.join(" ") },
    door: "RUSTFLAGS",
  });
  // napi reads `RUSTFLAGS ?? CARGO_BUILD_RUSTFLAGS`: both are kept ahead of ours
  assert.equal(
    napiRemapEnv({ env: { CARGO_BUILD_RUSTFLAGS: "-C opt-level=3" }, flags }).env.RUSTFLAGS,
    ["-C", "opt-level=3", ...flags].join(" "),
  );
  assert.equal(
    napiRemapEnv({ env: { RUSTFLAGS: "-Dwarnings", CARGO_BUILD_RUSTFLAGS: "-C x" }, flags }).env
      .RUSTFLAGS,
    ["-Dwarnings", ...flags].join(" "),
  );
  // cargo reads CARGO_ENCODED_RUSTFLAGS before napi's RUSTFLAGS: appended there
  assert.deepEqual(napiRemapEnv({ env: { CARGO_ENCODED_RUSTFLAGS: "-Dwarnings" }, flags }), {
    env: { CARGO_ENCODED_RUSTFLAGS: ["-Dwarnings", ...flags].join("\x1f") },
    door: "CARGO_ENCODED_RUSTFLAGS",
  });
  assert.throws(
    () => napiRemapEnv({ env: {}, flags: ["--remap-path-prefix=/Users/John Doe/.cargo=/cargo"] }),
    /holds whitespace, which RUSTFLAGS \(napi's door\) splits on/,
  );
  assert.throws(
    () =>
      napiRemapEnv({
        env: {},
        flags,
        configs: [{ file: "/w/mille-pin/.cargo/config.toml", build: true, target: false }],
      }),
    /\/w\/mille-pin\/\.cargo\/config\.toml sets rustflags, which napi's RUSTFLAGS would replace/,
  );
});

test("field-native's release build: plain without the switch; under it, the checkout and its target remapped through --config", () => {
  assert.deepEqual(releaseInvocation({ env: { PATH: "/bin" } }), {
    args: RELEASE_BUILD_ARGS,
    env: { PATH: "/bin" },
    flags: [],
    door: null,
  });
  const on = releaseInvocation({
    repo: "/Users/runner/work/vibefield/vibefield",
    env: { ...ON, CARGO_HOME: "/Users/runner/.cargo", RUSTUP_HOME: "/Users/runner/.rustup" },
    targetDir: "/Users/runner/work/vibefield/vibefield/target",
    realpath: unresolved,
  });
  assert.deepEqual(on.flags, [
    "--remap-path-prefix=/Users/runner/.cargo=/cargo",
    "--remap-path-prefix=/Users/runner/.rustup=/rustup",
    "--remap-path-prefix=/Users/runner/work/vibefield/vibefield=/vibefield",
    "--remap-path-prefix=/Users/runner/work/vibefield/vibefield/target=/target",
  ]);
  assert.equal(on.door, "--config build.rustflags");
  assert.deepEqual(on.args, [
    "--config",
    `build.rustflags=${JSON.stringify(on.flags)}`,
    ...RELEASE_BUILD_ARGS,
  ]);
  // the caller's RUSTFLAGS: the environment door, its flags first
  const folded = releaseInvocation({
    repo: "/w",
    env: { ...ON, ...HOST, RUSTFLAGS: "-Dwarnings" },
    realpath: unresolved,
  });
  assert.deepEqual(folded.args, RELEASE_BUILD_ARGS);
  assert.equal(folded.env.CARGO_ENCODED_RUSTFLAGS.split("\x1f")[0], "-Dwarnings");
  assert.equal(folded.env.RUSTFLAGS, undefined);
  // a target config with no environment flags refuses before cargo runs
  assert.throws(
    () =>
      releaseInvocation({
        repo: "/w",
        env: { ...ON, ...HOST },
        configs: [{ file: "/w/.cargo/config.toml", build: false, target: true }],
        realpath: unresolved,
      }),
    /sets target rustflags/,
  );
});

test("rosettad's build: plain without the switch; under it, its checkout (/rosetta) and its own target (/target) remapped", () => {
  const args = ["build", "--release", "-p", "rosettad"];
  const off = siblingCargoInvocation({
    name: "rosetta",
    dir: "/nowhere/rosetta-pin",
    args,
    env: HOST,
  });
  assert.deepEqual(off, { args, env: HOST, remap: null });
  const on = siblingCargoInvocation({
    name: "rosetta",
    dir: "/nowhere/rosetta-pin",
    args,
    env: { ...ON, ...HOST },
    targetDirOf: (dir) => {
      assert.equal(dir, "/nowhere/rosetta-pin");
      return "/Volumes/SamsungRed/rust-target/rosetta-pin";
    },
    realpath: unresolved,
  });
  assert.deepEqual(on.remap.flags, [
    "--remap-path-prefix=/nowhere/cargo-home=/cargo",
    "--remap-path-prefix=/nowhere/rosetta-pin=/rosetta",
    "--remap-path-prefix=/nowhere/rustup-home=/rustup",
    "--remap-path-prefix=/Volumes/SamsungRed/rust-target/rosetta-pin=/target",
  ]);
  assert.equal(on.remap.door, "--config build.rustflags");
  assert.deepEqual(on.args.slice(2), args);
  assert.equal(on.env.RUSTFLAGS, undefined);
  assert.equal(on.env.CARGO_ENCODED_RUSTFLAGS, undefined);
});

test("mille's napi build: RUSTFLAGS under the switch, the lane override's target remapped; never for an install or a non-cargo sibling", () => {
  const off = siblingPnpmEnv(
    { ...HOST, CARGO_TARGET_DIR: "/lane/target" },
    { name: "mille", dir: "/nowhere/mille-pin", build: true, isCargo: () => true },
  );
  assert.deepEqual(off, {
    env: { ...HOST, CARGO_TARGET_DIR: "/lane/target/siblings/mille" },
    remap: null,
  });
  const on = siblingPnpmEnv(
    { ...ON, ...HOST, CARGO_TARGET_DIR: "/lane/target" },
    {
      name: "mille",
      dir: "/nowhere/mille-pin",
      build: true,
      isCargo: () => true,
      targetDirOf: () => assert.fail("the override names the target"),
      realpath: unresolved,
    },
  );
  assert.equal(on.remap.door, "RUSTFLAGS");
  assert.deepEqual(on.remap.flags, [
    "--remap-path-prefix=/nowhere/mille-pin=/mille",
    "--remap-path-prefix=/nowhere/cargo-home=/cargo",
    "--remap-path-prefix=/nowhere/rustup-home=/rustup",
    "--remap-path-prefix=/lane/target/siblings/mille=/target",
  ]);
  assert.equal(on.env.RUSTFLAGS, on.remap.flags.join(" "));
  assert.equal(on.env.CARGO_TARGET_DIR, "/lane/target/siblings/mille");
  // no override: the target cargo names for the checkout
  assert.match(
    siblingPnpmEnv(
      { ...ON, ...HOST },
      {
        name: "mille",
        dir: "/nowhere/mille-pin",
        build: true,
        isCargo: () => true,
        targetDirOf: () => "/Volumes/SamsungRed/rust/target",
        realpath: unresolved,
      },
    ).env.RUSTFLAGS,
    /--remap-path-prefix=\/Volumes\/SamsungRed\/rust\/target=\/target$/,
  );
  // an install, and a sibling whose checkout holds no cargo workspace (ice's TypeScript), stay plain
  assert.equal(
    siblingPnpmEnv(
      { ...ON, ...HOST },
      { name: "mille", dir: "/nowhere/mille-pin", isCargo: () => true },
    ).remap,
    null,
  );
  assert.equal(
    siblingPnpmEnv(
      { ...ON, ...HOST },
      { name: "ice", dir: "/nowhere/ice", build: true, isCargo: () => false },
    ).remap,
    null,
  );
});

test("review: a pnpm run executes in the package its --filter names, mapped by the lock's packages", () => {
  const packages = {
    "@vibecook/mille": "packages/mille",
    "@vibecook/mille-ui": "packages/mille-ui",
  };
  assert.deepEqual(
    pnpmRunDirs("/w/mille-pin", packages, ["--filter", "@vibecook/mille", "build"]),
    {
      dirs: ["/w/mille-pin/packages/mille"],
      unmapped: [],
    },
  );
  assert.deepEqual(
    pnpmRunDirs("/w/mille-pin", packages, ["--filter=@vibecook/mille-ui", "build"]),
    {
      dirs: ["/w/mille-pin/packages/mille-ui"],
      unmapped: [],
    },
  );
  assert.deepEqual(pnpmRunDirs("/w/mille-pin", packages, ["-F", "@vibecook/other", "build"]), {
    dirs: [],
    unmapped: ["@vibecook/other"],
  });
  // no filter: pnpm runs at the checkout
  assert.deepEqual(pnpmRunDirs("/w/ice", packages, ["build"]), { dirs: ["/w/ice"], unmapped: [] });
});

test("review: mille's napi build reads the cargo configs from packages/mille upward — where napi runs cargo — and refuses one there", () => {
  // the lock's mille entry, as siblings.lock.json writes it
  const entry = {
    packages: { "@vibecook/mille": "packages/mille", "@vibecook/mille-ui": "packages/mille-ui" },
    pnpm: {
      build: ["--filter", "@vibecook/mille", "build"],
      afterBuild: ["--filter", "@vibecook/mille-ui", "build"],
    },
  };
  const root = mkdtempSync(join(tmpdir(), "vf-napi-cwd-"));
  const dir = join(root, "mille-pin");
  try {
    for (const pkg of Object.values(entry.packages))
      mkdirSync(join(dir, pkg, ".cargo"), { recursive: true });
    const asked = [];
    const run = () =>
      siblingPnpmEnv(
        { ...ON, ...HOST },
        {
          name: "mille",
          dir,
          entry,
          build: true,
          isCargo: () => true,
          targetDirOf: (cwd) => {
            asked.push(cwd);
            return "/Volumes/SamsungRed/rust/target";
          },
          realpath: unresolved,
        },
      );
    // no config anywhere: RUSTFLAGS, and the target asked of cargo where each run executes, remapped once
    const plain = run();
    assert.equal(plain.remap.door, "RUSTFLAGS");
    assert.deepEqual(asked, [join(dir, "packages/mille"), join(dir, "packages/mille-ui")]);
    assert.equal(
      plain.remap.flags.filter((flag) => flag.endsWith("=/target")).join(" "),
      "--remap-path-prefix=/Volumes/SamsungRed/rust/target=/target",
    );
    // a config in the PACKAGE directory — never on the walk from the checkout's root — is refused by name
    const config = join(dir, "packages/mille/.cargo/config.toml");
    writeFileSync(config, '[build]\nrustflags = ["-C", "target-cpu=apple-m1"]\n');
    assert.throws(run, (error) =>
      error.message.startsWith(`${config} sets rustflags, which napi's RUSTFLAGS would replace`),
    );
    // a filter the lock does not map: the remap cannot know where cargo runs, so it refuses
    assert.throws(
      () =>
        siblingPnpmEnv(
          { ...ON, ...HOST },
          {
            name: "mille",
            dir,
            entry: { ...entry, pnpm: { build: ["--filter", "@vibecook/elsewhere", "build"] } },
            build: true,
            isCargo: () => true,
            targetDirOf: () => null,
            realpath: unresolved,
          },
        ),
      /packages map no directory for --filter @vibecook\/elsewhere/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a go sibling's build adds -trimpath under the switch, and only then", () => {
  assert.deepEqual(goBuildArgs("/r/target/debug/sidecar-slim", {}), [
    "build",
    "-o",
    "/r/target/debug/sidecar-slim",
    ".",
  ]);
  assert.deepEqual(goBuildArgs("/r/target/debug/sidecar-slim", ON), [
    "build",
    "-trimpath",
    "-o",
    "/r/target/debug/sidecar-slim",
    ".",
  ]);
});

test("release.yml's build job sets the switch, and nothing else in .github or the scripts does; the switch is read in one helper", () => {
  const release = readFileSync(join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
  const build = release.slice(release.indexOf("\n  build:\n"), release.indexOf("\n  sign:\n"));
  assert.match(
    build,
    /\n {4}env:\n(?: {6}#[^\n]*\n| {6}[A-Z_]+: [^\n]+\n)* {6}VIBEFIELD_REMAP_BUILD_PATHS: "1"\n/u,
  );
  assert.equal(
    release.split("VIBEFIELD_REMAP_BUILD_PATHS:").length,
    2,
    "set once, in the build job",
  );
  const github = join(REPO_ROOT, ".github");
  const yamls = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.ya?ml$/u.test(entry.name)) yamls.push(join(dir, entry.name));
  };
  walk(github);
  for (const file of yamls.filter((f) => !f.endsWith(join("workflows", "release.yml"))))
    assert.doesNotMatch(readFileSync(file, "utf8"), /VIBEFIELD_REMAP_BUILD_PATHS/u, file);
  // the builds ask remapRequested, never the variable itself
  for (const rel of [
    "apps/desktop/packaging/build-native-release.mjs",
    "scripts/siblings.mjs",
    "scripts/stage-package.mjs",
  ]) {
    const source = readFileSync(join(REPO_ROOT, rel), "utf8");
    assert.doesNotMatch(
      source,
      /env\.VIBEFIELD_REMAP_BUILD_PATHS|\[["']VIBEFIELD_REMAP_BUILD_PATHS/u,
      rel,
    );
  }
  assert.match(
    readFileSync(join(REPO_ROOT, "apps/desktop/packaging/build-native-release.mjs"), "utf8"),
    /if \(!remapRequested\(env\)\)/u,
  );
});

test("mille's install name: install_name_tool -id, THEN an ad hoc signature; a failed rewrite signs nothing", () => {
  const calls = [];
  const staged = "/stage/bin/mille.darwin-arm64.node";
  setInstallName(staged, "@rpath/mille.darwin-arm64.node", {
    run: (command, args) => calls.push([command, args]),
  });
  assert.deepEqual(calls, [
    ["install_name_tool", ["-id", "@rpath/mille.darwin-arm64.node", staged]],
    ["codesign", ["--force", "--sign", "-", staged]],
  ]);
  const ran = [];
  assert.throws(
    () =>
      setInstallName("/x.node", "@rpath/x.node", {
        run: (command) => {
          ran.push(command);
          if (command === "install_name_tool")
            throw new Error("install_name_tool: larger updated load commands do not fit");
        },
      }),
    /do not fit/,
  );
  assert.deepEqual(ran, ["install_name_tool"]);
});

test("on this Mac: a dylib named by its target path leaves with @rpath, a valid ad hoc signature and no builder path", (t) => {
  if (process.platform !== "darwin") return t.skip("install_name_tool and codesign are macOS's");
  if (spawnSync("cc", ["--version"]).status !== 0) return t.skip("no C compiler to make a dylib");
  // Item 249 (2026-11-08, 249b): the SDK is named, as build-screenshot-helper.mjs names it: one
  // lookup, handed to cc as `-isysroot`. A bare `cc` links against xcrun's DEFAULT SDK, which need
  // not be the selected Xcode's: on vf-m2 this row went red at the link (run 221, the Command Line
  // Tools' 27.2 under Xcode 26.3's ld, which cannot read its `.tbd` stubs).
  const sdk = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  assert.equal(sdk.status, 0, sdk.stderr);
  const sysroot = sdk.stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), "vf-install-name-"));
  try {
    writeFileSync(join(dir, "x.c"), "int mille_probe(void) { return 42; }\n");
    const node = join(dir, "mille.darwin-arm64.node");
    // the shape napi's build leaves: a cdylib whose own name is the target's deps path
    const built = join(
      dir,
      "target",
      "aarch64-apple-darwin",
      "release",
      "deps",
      "libmille_binding.dylib",
    );
    const cc = spawnSync(
      "cc",
      [
        "-isysroot",
        sysroot,
        "-dynamiclib",
        "-o",
        node,
        join(dir, "x.c"),
        `-Wl,-install_name,${built}`,
      ],
      {
        encoding: "utf8",
      },
    );
    assert.equal(cc.status, 0, cc.stderr);
    const id = () =>
      spawnSync("otool", ["-D", node], { encoding: "utf8" }).stdout.trim().split("\n").at(-1);
    assert.equal(id(), built);
    assert.equal(builderPathCounts(node, ["/release/deps/"])["/release/deps/"], 1);
    setInstallName(node, "@rpath/mille.darwin-arm64.node");
    assert.equal(id(), "@rpath/mille.darwin-arm64.node");
    // the old name's bytes left with it: the gate's marker counts none
    assert.equal(builderPathCounts(node, ["/release/deps/"])["/release/deps/"], 0);
    const verify = spawnSync("codesign", ["--verify", "--strict", node], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(
      spawnSync("codesign", ["-dv", node], { encoding: "utf8" }).stderr,
      /Signature=adhoc/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the stage rewrites mille's install name on macOS after the copy, and stages before electron-builder on every release path", () => {
  const stage = readFileSync(join(REPO_ROOT, "scripts/stage-package.mjs"), "utf8");
  assert.match(stage, /import \{ setInstallName \} from "\.\/build-paths\.mjs";/u);
  const copy = stage.indexOf("copyFileSync(f.abs, dest);");
  const rewrite = stage.search(/setInstallName\(mille, `@rpath\/\$\{MILLE_NATIVE\}`\)/u);
  assert.ok(copy > -1 && rewrite > copy, "the rewrite follows the copy");
  assert.match(stage.slice(copy, rewrite), /if \(process\.platform === "darwin"\) \{/u);
  // package:mac:release (run-macos-release.mjs; release.yml's signed path): the stage, its verify, then electron-builder
  const driver = readFileSync(
    join(REPO_ROOT, "apps/desktop/packaging/run-macos-release.mjs"),
    "utf8",
  );
  const staged = driver.indexOf('run("pnpm", ["run", "package:stage"])');
  assert.ok(staged > -1, "the driver stages");
  assert.ok(
    staged < driver.indexOf('"packaging/run-electron-builder.mjs"'),
    "before electron-builder",
  );
  // package:stage ends in the stager
  const desktop = JSON.parse(readFileSync(join(REPO_ROOT, "apps/desktop/package.json"), "utf8"));
  assert.match(
    desktop.scripts["package:stage"],
    /&& node \.\.\/\.\.\/scripts\/stage-package\.mjs$/u,
  );
  // release.yml's unsigned path: its stage step, then electron-builder
  const release = readFileSync(join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
  const build = release.slice(release.indexOf("\n  build:\n"), release.indexOf("\n  sign:\n"));
  const unsignedStage = build.indexOf("pnpm run package:stage");
  assert.ok(unsignedStage > -1);
  assert.ok(unsignedStage < build.indexOf("node packaging/run-electron-builder.mjs --mac"));
});
