import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./temp-dir";

// OB custody, C1 — the one thing `buildSupervisor` does for custody: at `sealed` it hands
// the supervisor this user root's custody (the hand-off, the child check, the marks it gives back), and at `files`
// it hands nothing, so the supervisor takes the path it takes today. `electron` and the supervisor are mocked, the
// house way (fieldd-native.test.ts): what is proven is what the pair would be built with.

const stub = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
}));
vi.mock("@vibefield/fieldd-supervisor", () => ({
  createFielddSupervisor: (opts: Record<string, unknown>) => {
    stub.created.push(opts);
    return {};
  },
}));

const { buildSupervisor } = await import("../src/main/fieldd");
const { resolveDevelopmentResources } = await import("../src/main/resources");

afterEach(() => {
  stub.created.length = 0;
});

/** A development tree with fieldd's bundle in it (buildSupervisor refuses a missing launch target). */
function devTree() {
  const repoRoot = tempDir("vf-custody-repo-");
  mkdirSync(join(repoRoot, "packages", "fieldd", "dist"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"), "");
  return resolveDevelopmentResources({ repoRoot, electronExecPath: "/electron" });
}

type Built = Parameters<typeof buildSupervisor>[0];

function build(custody?: Built["custody"]): Record<string, unknown> {
  buildSupervisor({
    mode: "dev",
    rendererPolicyMode: "dev",
    root: tmpdir(),
    resources: devTree(),
    viteUrl: "http://localhost:5173",
    logRoot: tmpdir(),
    logger: createNoopLogger(),
    ...(custody === undefined ? {} : { custody }),
  });
  const built = stub.created.at(-1);
  if (built === undefined) throw new Error("no supervisor was built");
  return built;
}

describe("buildSupervisor — the pair's custody (C1)", () => {
  it("hands the supervisor this user root's custody at `sealed`, and nothing at `files`", () => {
    const handoff = vi.fn(() => ({
      v: 1 as const,
      shell: "a1".repeat(32),
      pairing: "b2".repeat(32),
      records: "c3".repeat(32),
    }));
    const custody: NonNullable<Built["custody"]> = {
      handoff,
      verifyChild: async () => true,
      noted: () => undefined,
    };
    const sealed = build(custody);
    expect(sealed["custody"]).toBe(custody);
    // building a pair asks for no secret: the hand-off is made when the supervisor spawns, and rides stdin alone
    expect(handoff).not.toHaveBeenCalled();
    expect(JSON.stringify([sealed["environment"], sealed["spawn"]])).not.toMatch(/a1a1|b2b2|c3c3/u);

    // `files`: the supervisor is built as it is today, with no custody option at all
    expect(build()).not.toHaveProperty("custody");
  });
});
