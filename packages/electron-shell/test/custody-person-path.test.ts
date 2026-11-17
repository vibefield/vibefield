import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CUSTODY } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERSON_PATH_MARK,
  type PersonPathSpawn,
  resolvePersonPath,
  spawnPersonPathChild,
} from "../src/main/login-shell";
import { tempDir } from "./temp-dir";

// OB custody meets ESP-18 (item 341) — at `sealed` a pair's supervisor is built with BOTH the pair's custody and the
// hook that asks the person's login shell for PATH. The hook takes no argument, so nothing of custody can ride it;
// these rows hold what the login shell is spawned with all the same: no secret of the hand-off, no variable of
// VibeField's own (the custody flags among them, were one ever in main's environment), and no stdin to be written
// on. `electron` and the supervisor are mocked, the house way (fieldd-person-path.test.ts): what is proven is what
// the supervisor would be built with and what its hook then spawns. The rows assert by booleans (item 320).

type Created = {
  custody?: unknown;
  spawnEnvironment?: () => Promise<Readonly<Record<string, string>>>;
};

const stub = vi.hoisted(() => ({ created: [] as Created[] }));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
}));
vi.mock("@vibefield/fieldd-supervisor", () => ({
  createFielddSupervisor: (opts: Created) => {
    stub.created.push(opts);
    return {};
  },
}));

const { buildSupervisor } = await import("../src/main/fieldd");
const { resolvePackagedResources } = await import("../src/main/resources");

afterEach(() => {
  stub.created.length = 0;
});

const HANDOFF = {
  v: 1 as const,
  shell: "d6".repeat(32),
  pairing: "e7".repeat(32),
  records: "f8".repeat(32),
};
const SECRETS = [HANDOFF.shell, HANDOFF.pairing, HANDOFF.records];
const ANSWER = "/sentinel-join/bin:/usr/bin:/bin";
const OWN_PREFIXES = ["FIELD_", "FIELDD_", "VIBEFIELD_", "VF_"];

/** A packaged layout on disk: fieldd (buildSupervisor refuses a missing launch target) and the staged identity
 * (WP8c: it refuses a package with no anchor for its own plugins). */
function packagedLayout() {
  const resourcesPath = tempDir("vf-custody-person-path-");
  mkdirSync(join(resourcesPath, "bin"));
  writeFileSync(join(resourcesPath, "bin", "fieldd"), "");
  mkdirSync(join(resourcesPath, "identity"));
  copyFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "contracts",
      "fixtures",
      "staged-release-identity.valid.json",
    ),
    join(resourcesPath, "identity", "release-identity.json"),
  );
  writeFileSync(join(resourcesPath, "identity", "trust-root.json"), "{}");
  writeFileSync(join(resourcesPath, "identity", "trust-root.json.sig"), "");
  return resolvePackagedResources({
    resourcesPath,
    electronExecPath: join(resourcesPath, "VibeField"),
    platform: "darwin",
  });
}

type Built = Parameters<typeof buildSupervisor>[0];

describe("buildSupervisor at `sealed` — the login shell the pair's PATH is asked of", () => {
  it("the login shell is spawned with nothing of custody", async () => {
    const spawned: Array<{ shell: string; args: readonly string[]; env: Record<string, string> }> =
      [];
    const spawn: PersonPathSpawn = (shell, args, env) => {
      spawned.push({ shell, args, env: { ...env } });
      return {
        done: Promise.resolve({
          code: 0,
          stdout: `${PERSON_PATH_MARK}${ANSWER}\n${PERSON_PATH_MARK}`,
        }),
        killGroup: () => undefined,
      };
    };
    const handoff = vi.fn(() => HANDOFF);
    const custody: NonNullable<Built["custody"]> = {
      handoff,
      verifyChild: async () => true,
      noted: () => undefined,
    };
    // main's environment at its worst: custody puts nothing in it, and were a flag or a secret ever there under a
    // name of VibeField's own, the login shell would still inherit neither
    const mainEnvironment: Record<string, string> = {
      PATH: "/usr/bin:/bin",
      HOME: "/nonexistent-home",
      [CUSTODY.ENV]: CUSTODY.STDIN,
      [CUSTODY.NATIVE_ENV]: CUSTODY.STDIN,
      VIBEFIELD_SENTINEL_JOIN: HANDOFF.shell,
      FIELDD_SENTINEL_JOIN: HANDOFF.pairing,
      FIELD_SENTINEL_JOIN: HANDOFF.records,
    };
    const personPath = async (): Promise<string | undefined> => {
      const answer = await resolvePersonPath({
        mode: "production",
        platform: "darwin",
        shell: "/bin/zsh",
        home: "/nonexistent-home",
        env: mainEnvironment,
        spawn,
        exists: () => false,
        now: () => 0,
        log: { info: () => undefined },
        shimDirectories: [],
      });
      return answer?.path;
    };
    buildSupervisor({
      mode: "production",
      rendererPolicyMode: "production",
      root: tmpdir(),
      resources: packagedLayout(),
      viteUrl: "http://localhost:5173",
      logRoot: tmpdir(),
      logger: createNoopLogger(),
      personPath,
      custody,
    });
    const built = stub.created.at(-1);
    // one supervisor, built with both: the pair's custody as it came, and the hook
    expect(built?.custody === custody).toBe(true);
    expect(typeof built?.spawnEnvironment === "function").toBe(true);
    const answer = (await built?.spawnEnvironment?.()) ?? {};
    expect(Object.keys(answer).join(",") === "PATH" && answer["PATH"] === ANSWER).toBe(true);
    // asking for the PATH asked custody for nothing
    expect(handoff.mock.calls.length === 0).toBe(true);
    expect(spawned.length === 1).toBe(true);
    const child = spawned[0];
    const said = JSON.stringify([child?.shell, child?.args, child?.env, answer]);
    expect(SECRETS.some((secret) => said.includes(secret))).toBe(false);
    const names = Object.keys(child?.env ?? { unset: "" });
    expect(names.includes("PATH")).toBe(true);
    const own = (name: string): boolean => OWN_PREFIXES.some((prefix) => name.startsWith(prefix));
    expect(names.some(own)).toBe(false);
  });

  // The seam above takes a shell, its arguments and an environment: it has no stdin to hand. This row holds the
  // same of the production spawn itself, on a real child that says what its own stdin is.
  const node = process.platform !== "win32" && existsSync(process.execPath);
  it.skipIf(!node)("the production spawn gives the login shell no stdin", async () => {
    const tells = [
      'const { fstatSync } = require("node:fs");',
      'let kind = "other";',
      "try {",
      "  const stat = fstatSync(0);",
      '  if (stat.isCharacterDevice()) kind = "device";',
      '  else if (stat.isFIFO()) kind = "pipe";',
      '  else if (stat.isSocket()) kind = "socket";',
      '  else if (stat.isFile()) kind = "file";',
      "} catch {",
      '  kind = "closed";',
      "}",
      "process.stdout.write(kind);",
    ].join("\n");
    const child = spawnPersonPathChild(process.execPath, ["-e", tells], { PATH: "/usr/bin:/bin" });
    const { code, stdout } = await child.done;
    // the null device: nothing can be written to it for the child to read
    expect(code === 0 && stdout === "device").toBe(true);
  });
});
