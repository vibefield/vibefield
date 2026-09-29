import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuiltinProviders } from "@vibecook/puppeteer-builtin-providers";
import type { AgentHost } from "@vibecook/puppeteer-core";
import { type AgentRuntime, createAgentRuntime } from "@vibecook/puppeteer-runtime";
import {
  materializeShims,
  prepareSpawnThroughLaunch,
  type SpawnThroughLaunchRequest,
  spawnThroughLayout,
} from "@vibecook/puppeteer-runtime/spawn-through";
import { AGENT_CATALOG_READERS } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_GATEWAY_STRICT, offeredLaunch } from "../src/agent-gateway";

const roots: string[] = [];
const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const additional = ["grok", "kimi", "opencode", "hermes", "antigravity", "copilot", "pi"];
function runtimeFor(root: string): AgentRuntime {
  const host = { spawnTerminal: vi.fn(), automateTerminal: vi.fn() } as unknown as AgentHost;
  const runtime = createAgentRuntime({
    host,
    defaultCwd: root,
    providers: createBuiltinProviders({ home: root }),
  });
  runtimes.push(runtime);
  return runtime;
}

describe("the pinned builtin grammars earn VibeField's catalog launchers", () => {
  it("materializes all nine vendor offerings under strict without promoting preview status", async () => {
    const root = await mkdtemp(join(tmpdir(), "vf-catalog-shims-"));
    roots.push(root);
    const runtime = runtimeFor(root);
    const home = join(root, "shims");
    const providers = runtime.launchProviders();
    const offered = offeredLaunch({
      launchProviders: providers,
      catalog: AGENT_CATALOG_READERS,
      executables: new Map(providers.map((provider) => [provider.id, process.execPath])),
      shimDirectory: spawnThroughLayout(home).shimDirectory,
    });
    expect(offered.providers.map((provider) => provider.id).sort()).toEqual(
      ["claude", "codex", ...additional].sort(),
    );
    for (const id of additional) {
      expect(AGENT_CATALOG_READERS.entry(id)).toMatchObject({
        status: "preview",
        offers: { invoke: true },
      });
    }
    expect(AGENT_CATALOG_READERS.entry("acp")?.offers.invoke).toBe(false);
    const script = join(root, "fixture-shim.cjs");
    await writeFile(script, "// fixture: never executed\n");
    await materializeShims({
      home,
      names: offered.names,
      script,
      runtime: { command: process.execPath },
      strict: AGENT_GATEWAY_STRICT,
    });
    expect((await readdir(spawnThroughLayout(home).shimDirectory)).sort()).toEqual(
      [...offered.names].sort(),
    );
    for (const name of offered.names) {
      expect(await readFile(join(spawnThroughLayout(home).shimDirectory, name), "utf8")).toContain(
        "PUPPETEER_SHIM_STRICT='1'",
      );
    }
  });

  it.each(additional)(
    "%s help reaches the real adapter and bypasses custody and preparation",
    async (id) => {
      const runtime = runtimeFor(tmpdir());
      const prepare = vi.spyOn(runtime, "prepareInvocation");
      const resolveTerminal = vi.fn(async () => ({ terminalSessionId: "pane" }));
      const request: SpawnThroughLaunchRequest = {
        type: "launch",
        token: "test",
        providerId: id,
        cwd: tmpdir(),
        argv: ["--help"],
        environment: {},
        pid: 456,
        parentPid: 123,
        interactive: true,
      };
      const result = await prepareSpawnThroughLaunch(request, {
        runtime,
        strict: AGENT_GATEWAY_STRICT,
        resolveTerminal,
        onAdopted: vi.fn(),
      });
      expect(result).toMatchObject({ action: "fallback", code: "passthrough" });
      expect(prepare).not.toHaveBeenCalled();
      expect(resolveTerminal).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["opencode", ["--help", "--help=false"]],
    ["opencode", ["--version", "--version=false"]],
    ["opencode", ["--help", "false"]],
    ["hermes", ["chat", "--quiet"]],
    ["hermes", ["chat", "--oneshot"]],
    ["hermes", ["--oneshot", ""]],
    ["hermes", ["chat", "--tui", "-q", "hello", "--oneshot"]],
    ["antigravity", ["--version=true"]],
  ] as const)("%s mode regression %j is refused in a Godview pane", async (id, argv) => {
    const runtime = runtimeFor(tmpdir());
    const prepare = vi.spyOn(runtime, "prepareInvocation");
    const resolveTerminal = vi.fn(async () => ({ terminalSessionId: "pane" }));
    const result = await prepareSpawnThroughLaunch(
      {
        type: "launch",
        token: "test",
        providerId: id,
        cwd: tmpdir(),
        argv: [...argv],
        environment: {},
        pid: 456,
        parentPid: 123,
        interactive: true,
      },
      { runtime, strict: AGENT_GATEWAY_STRICT, resolveTerminal, onAdopted: vi.fn() },
    );
    expect(result).toMatchObject({ action: "refuse", code: "rejected-argument", placed: true });
    expect(resolveTerminal).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });
});
