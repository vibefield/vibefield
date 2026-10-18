// BP-1b's gate (scripts/host-links.mjs) and its one release-build entry (apps/desktop/packaging/build-native-release.mjs):
// a packaged Mach-O's dependency load commands are read from `otool -l` — never a dylib's own install name — and any path
// outside /usr/lib, /System or the bundle is refused; the launch check runs each native binary's `--version`; the release
// build is --locked (its HARFBUZZ_SYS_NO_PKG_CONFIG=1 retired with harfbuzz-sys at the EL8 to ghosttea 0.13.5).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RELEASE_BUILD_ARGS } from "../../../apps/desktop/packaging/build-native-release.mjs";
import {
  auditHostLinks,
  dependencyCommandsOf,
  hostLinks,
  imageCommands,
  isMachO,
  LAUNCHED,
  launchCheck,
} from "../../../scripts/host-links.mjs";

const HOMEBREW = "/opt/homebrew/opt/harfbuzz/lib/libharfbuzz.0.dylib";

/** A thin 64-bit little-endian Mach-O image's header and load commands: a dylib's own name first (LC_ID_DYLIB), then
 * `loads` as [cmd, name] (an rpath among them, which is no dependency). */
function image(loads) {
  const command = (cmd, name, nameAt) => {
    const size = Math.ceil((nameAt + Buffer.byteLength(name) + 1) / 8) * 8;
    const b = Buffer.alloc(size);
    b.writeUInt32LE(cmd, 0);
    b.writeUInt32LE(size, 4);
    b.writeUInt32LE(nameAt, 8);
    b.write(name, nameAt);
    return b;
  };
  const cmds = [
    command(0xd, "/Volumes/build/target/release/deps/libthing.dylib", 24),
    ...loads.map(([cmd, name]) => command(cmd, name, cmd === 0x8000001c ? 12 : 24)),
  ];
  const body = Buffer.concat(cmds);
  const head = Buffer.alloc(32);
  head.writeUInt32LE(0xfeedfacf, 0);
  head.writeUInt32LE(0x0100000c, 4);
  head.writeUInt32LE(6, 12);
  head.writeUInt32LE(cmds.length, 16);
  head.writeUInt32LE(body.length, 20);
  return Buffer.concat([head, body]);
}
const LOADS = [
  [0xc, "/usr/lib/libSystem.B.dylib"],
  [0xc, HOMEBREW],
  [0x80000018, "@rpath/Electron Framework.framework/Electron Framework"],
  [0x8000001c, "/usr/local/lib"],
  [0x8000001f, "/System/Library/Frameworks/CoreText.framework/Versions/A/CoreText"],
];

test("the dependencies are the load commands that load, never a dylib's own install name or an rpath", () => {
  assert.deepEqual(imageCommands(image(LOADS)), [
    { cmd: "LC_LOAD_DYLIB", name: "/usr/lib/libSystem.B.dylib" },
    { cmd: "LC_LOAD_DYLIB", name: HOMEBREW },
    { cmd: "LC_LOAD_WEAK_DYLIB", name: "@rpath/Electron Framework.framework/Electron Framework" },
    {
      cmd: "LC_REEXPORT_DYLIB",
      name: "/System/Library/Frameworks/CoreText.framework/Versions/A/CoreText",
    },
  ]);
});

test("a host link is any dependency outside /usr/lib, /System and the bundle's own paths", () => {
  assert.deepEqual(hostLinks(imageCommands(image(LOADS))), [
    { cmd: "LC_LOAD_DYLIB", name: HOMEBREW },
  ]);
  for (const name of ["/usr/local/lib/libz.dylib", "/Volumes/build/x.dylib", "/Users/me/lib.dylib"])
    assert.equal(hostLinks([{ cmd: "LC_LOAD_DYLIB", name }]).length, 1, name);
  for (const name of ["/usr/lib/libc++.1.dylib", "@loader_path/x.dylib", "@executable_path/../x"])
    assert.equal(hostLinks([{ cmd: "LC_LOAD_DYLIB", name }]).length, 0, name);
});

test("a fat file is read architecture by architecture, and a name with parentheses is read whole", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    const thin = image(LOADS);
    const fat = Buffer.alloc(4096 + thin.length);
    fat.writeUInt32BE(0xcafebabe, 0);
    fat.writeUInt32BE(1, 4);
    fat.writeUInt32BE(0x0100000c, 8);
    fat.writeUInt32BE(4096, 16);
    fat.writeUInt32BE(thin.length, 20);
    fat.writeUInt32BE(12, 24);
    thin.copy(fat, 4096);
    const helper = join(dir, "VibeField Helper (GPU)");
    writeFileSync(helper, fat);
    assert.deepEqual(
      dependencyCommandsOf(helper).map((c) => c.name),
      imageCommands(thin).map((c) => c.name),
    );
    assert.deepEqual(auditHostLinks(dir), [
      `HOST LINK  VibeField Helper (GPU): LC_LOAD_DYLIB ${HOMEBREW}`,
    ]);
    writeFileSync(join(dir, "broken"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    assert.match(
      auditHostLinks(dir).find((p) => p.startsWith("UNREADABLE")) ?? "",
      /^UNREADABLE {2}broken: /,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("on this Mac the reader agrees with otool -arch all -l (every architecture), and a system binary has no host link", (t) => {
  if (process.platform !== "darwin") return t.skip("a macOS binary to read");
  const otool = spawnSync("otool", ["-arch", "all", "-l", "/usr/bin/true"], {
    encoding: "utf8",
  }).stdout;
  const named = [
    ...otool.matchAll(
      /cmd (LC_LOAD_DYLIB|LC_LOAD_WEAK_DYLIB|LC_REEXPORT_DYLIB)\n.*\n\s*name (\S+) /g,
    ),
  ].map((m) => m[2]);
  assert.deepEqual(
    dependencyCommandsOf("/usr/bin/true").map((c) => c.name),
    named,
  );
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    copyFileSync("/usr/bin/true", join(dir, "true"));
    assert.deepEqual(auditHostLinks(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Mach-O is told by its magic; a Java class file's shared magic is not one", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    const file = (name, bytes) => {
      const path = join(dir, name);
      writeFileSync(path, Buffer.from(bytes));
      return path;
    };
    assert.equal(isMachO(file("thin64", [0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0])), true);
    assert.equal(isMachO(file("fat", [0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2])), true);
    assert.equal(isMachO(file("class", [0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34])), false);
    assert.equal(isMachO(file("text", [0x23, 0x21, 0x2f, 0x62])), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the launch check runs each native binary's --version: a name said and exit 0 passes, anything else is said", (t) => {
  if (process.platform === "win32") return t.skip("a shell stand-in");
  const dir = mkdtempSync(join(tmpdir(), "vf-host-links-"));
  try {
    const stand = (name, body) => {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
    };
    // F1: the floor's whole set is launched — the freeway host beside the floor and its cell
    assert.deepEqual(LAUNCHED, ["field-native", "field-terminal-host", "field-freeway-host"]);
    for (const name of LAUNCHED) stand(name, `echo "${name} 0.1.0"`);
    assert.deepEqual(launchCheck(dir), []);
    stand("field-terminal-host", 'echo "dyld: Library not loaded" >&2; exit 134');
    const problems = launchCheck(dir);
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /^field-terminal-host: --version exited 134 — dyld: Library not loaded$/,
    );
    // a host from before it answered --version (`unknown flag`, exit 2) is refused the same way
    stand("field-terminal-host", 'echo "field-terminal-host 0.1.0"');
    stand("field-freeway-host", 'echo "field-freeway-host: unknown flag: --version" >&2; exit 2');
    assert.deepEqual(launchCheck(dir), [
      "field-freeway-host: --version exited 2 — field-freeway-host: unknown flag: --version",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("THE release build of field-native is --locked", () => {
  assert.deepEqual(RELEASE_BUILD_ARGS, ["build", "--release", "--locked", "-p", "field-native"]);
});
