import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CATALOG_READERS,
  AGENT_OPERATION_OUTPUT_BYTES,
  type AgentDistributionRecord,
  type AgentsOperationsResult,
  LAYOUT,
} from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import type { AgentInstallation, UpdateReceipt } from "@vibefield/puppeteer-core";
import type {
  AgentRuntime,
  ReleaseCheckResult,
  UpdateInstallationOptions,
  UpdatePlan,
} from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentDistributionService,
  DistributionRecordStore,
  displayTail,
  type RevealPath,
} from "../src/agent-distribution";
import { RpcCallError } from "../src/native-link";
import { renderTerminalText } from "../src/terminal-text";

// The distribution doors' service against a scripted runtime: what the
// Agents settings section needs from it — a kept release check re-judged
// against today's installs, the command Update will run, the updater's own
// output while it runs, one update per provider, and Show in Finder for an
// inventoried path only. The daemon-level rows are in agent-runtime.test.ts.

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const NOW = () => new Date("2026-09-23T09:41:20.000Z");

function install(overrides: Partial<AgentInstallation> = {}): AgentInstallation {
  return {
    provider: "claude",
    executable: "/Users/test/.local/bin/claude",
    realPath: "/Users/test/.local/share/claude/versions/2.1.266",
    version: "2.1.266",
    method: "native-installer",
    autoUpdate: "enabled",
    releaseChannel: "stable",
    detectedAt: "2026-09-23T09:00:00.000Z",
    warnings: [],
    origin: "path",
    active: true,
    ...overrides,
  };
}

function check(overrides: Partial<ReleaseCheckResult> = {}): ReleaseCheckResult {
  return {
    provider: "claude",
    checkedAt: "2026-09-23T09:41:20.000Z",
    releases: [
      {
        provider: "claude",
        channel: "stable",
        version: "2.1.270",
        fetchedAt: "2026-09-23T09:41:20.000Z",
        source: { kind: "text", id: "vendor-stable" },
      },
    ],
    behind: [{ channel: "stable", version: "2.1.270" }],
    available: { channel: "stable", version: "2.1.270" },
    failures: [],
    ...overrides,
  };
}

function receipt(overrides: Partial<UpdateReceipt> = {}): UpdateReceipt {
  return {
    provider: "claude",
    status: "updated",
    startedAt: "2026-09-23T09:42:00.000Z",
    finishedAt: "2026-09-23T09:42:30.000Z",
    exitCode: 0,
    transcriptPath: "/private/updates/claude-1.log",
    message: "updated from 2.1.266 to 2.1.270",
    ...overrides,
  };
}

interface Script {
  installs: AgentInstallation[];
  checks?: (network: boolean) => ReleaseCheckResult;
  plan?: (
    executable: string,
  ) =>
    | UpdatePlan
    | { status: "unavailable"; provider: string; message: string; retryable: boolean };
  update?: (options: UpdateInstallationOptions) => Promise<UpdateReceipt>;
  nativeUpdateCheck?: boolean;
  /** sees every inventory read the service asks for (and may fail it) */
  onInspect?: (options: { providerId?: string; refresh?: boolean }) => void;
}

function scriptedRuntime(script: Script): AgentRuntime {
  const runtime: Partial<AgentRuntime> = {
    distributionProviders: () => [
      {
        id: "claude",
        label: "Claude",
        commands: ["claude"],
        npmPackages: [],
        brewNames: [],
        detectors: [],
        nativeUpdateCheck: script.nativeUpdateCheck ?? false,
      },
    ],
    inspectInstallations: async (options) => {
      script.onInspect?.(options ?? {});
      return script.installs.filter(
        (entry) => options?.providerId === undefined || entry.provider === options.providerId,
      );
    },
    checkReleases: async ({ network }) => (script.checks ?? (() => check()))(network === true),
    planUpdate: async ({ executable }) =>
      script.plan?.(executable ?? "") ?? {
        provider: "claude",
        executable: executable ?? "",
        recipe: { kind: "native-self-update", argv: [executable ?? "", "update"] },
        argv: [executable ?? "", "update"],
      },
    updateInstallation: async (options) => (script.update ?? (async () => receipt()))(options),
  };
  return runtime as AgentRuntime;
}

function service(
  script: Script,
  options: { machine?: boolean; reveal?: RevealPath | null } = {},
): { distribution: AgentDistributionService; root: string; store: DistributionRecordStore | null } {
  const root = mkdtempSync(join(tmpdir(), "vf-distribution-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const logger = createNoopLogger();
  const store =
    options.machine === false
      ? null
      : new DistributionRecordStore({ rootReal: root, now: NOW, logger });
  const distribution = new AgentDistributionService({
    runtime: scriptedRuntime(script),
    catalog: AGENT_CATALOG_READERS,
    store,
    revealPath: () => (options.reveal === undefined ? null : options.reveal),
    now: NOW,
    logger,
  });
  cleanup.push(() => distribution.dispose());
  return { distribution, root, store };
}

const readRecord = (root: string): AgentDistributionRecord =>
  JSON.parse(readFileSync(join(root, ...LAYOUT.MACHINE_DISTRIBUTION_FILE), "utf8"));

describe("the output a person reads while an update runs", () => {
  it("drops colour, titles and stray control bytes; a backspace overwrites as a terminal's does", () => {
    expect(renderTerminalText("\u001b[32mok\u001b[0m\u001b]0;title\u0007 x\u0008y\n")).toBe("ok y");
  });

  it("keeps what a terminal would have left on a line after its carriage returns", () => {
    expect(displayTail("Downloading 10%\rDownloading 50%\rDownloading 100%\nDone\n").output).toBe(
      "Downloading 100%\nDone",
    );
    // a trailing return is a redraw that never came: the last draw stands
    expect(displayTail("50%\r100%\r").output).toBe("100%");
    expect(displayTail("a\r\nb\r\n").output).toBe("a\nb");
  });

  it("settles a spinner that redraws by cursor moves and erases (OpenCode 1.18's upgrade, byte for byte)", () => {
    const frames = [
      "\u001b[35m◒\u001b[39m  Upgrading",
      "\u001b[999D\u001b[J\u001b[35m◐\u001b[39m  Upgrading.",
      "\u001b[999D\u001b[J\u001b[35m◓\u001b[39m  Upgrading..",
      "\u001b[999D\u001b[J\u001b[32m◇\u001b[39m  Upgrade complete\n",
    ];
    const raw = `\u001b[90m┌\u001b[39m  Upgrade\n${frames.join("")}\u001b[?25h\u001b[90m└\u001b[39m  Done\n`;
    expect(renderTerminalText(raw)).toBe("┌  Upgrade\n◇  Upgrade complete\n└  Done");
  });

  it("clears an erased line, and rewrites lines a cursor went back up to", () => {
    expect(renderTerminalText("progress 10%\r\u001b[2Kdone\n")).toBe("done");
    expect(renderTerminalText("pull a\npull b\n\u001b[2A\u001b[2Ka ok\n\u001b[2Kb ok\n")).toBe(
      "a ok\nb ok",
    );
    // a sequence cut at the end of what arrived so far draws nothing yet
    expect(renderTerminalText("half\u001b[3")).toBe("half");
  });

  it("bounds cursor motion, never text: a hostile move cannot pad a line out, a long line stays whole", () => {
    const started = Date.now();
    const moved = renderTerminalText("a\u001b[999999999Cb\u001b[99999999Bc");
    expect(Date.now() - started).toBeLessThan(500);
    expect(moved).toBe(`a${" ".repeat(1023)}bc`);
    const long = "x".repeat(5_000);
    expect(renderTerminalText(`${long}\n`)).toBe(long);
  });

  it("keeps the last lines within the bound, starting on a whole line, and says it dropped some", () => {
    const line = `${"x".repeat(99)}\n`;
    const raw = line.repeat(Math.ceil((AGENT_OPERATION_OUTPUT_BYTES * 2) / line.length));
    const { output, truncated } = displayTail(raw);
    expect(truncated).toBe(true);
    expect(output.length).toBeLessThanOrEqual(AGENT_OPERATION_OUTPUT_BYTES);
    expect(output.startsWith("x".repeat(99))).toBe(true);
    expect(displayTail("short\n")).toEqual({ output: "short", truncated: false });
  });
});

describe("the inventory — read at boot, answered at once, read again when a person asks", () => {
  it("answers installs from puppeteer's inventory, and reads the Mac again only on refresh", async () => {
    const reads: Array<{ providerId?: string; refresh?: boolean }> = [];
    const { distribution } = service({
      installs: [install()],
      onInspect: (options) => reads.push(options),
    });
    await distribution.installs();
    await distribution.installs("claude", { refresh: true });
    expect(reads).toEqual([{ refresh: false }, { providerId: "claude", refresh: true }]);
  });

  it("warms the inventory once at boot, and a read that fails there degrades nothing", async () => {
    const reads: Array<{ providerId?: string; refresh?: boolean }> = [];
    const { distribution } = service({
      installs: [install()],
      onInspect: (options) => reads.push(options),
    });
    distribution.warm();
    await vi.waitFor(() => expect(reads).toEqual([{}]));

    const failing = service({
      installs: [install()],
      onInspect: () => {
        throw new Error("a version command hung");
      },
    });
    // an unhandled rejection would fail this run; the service says it and moves on
    failing.distribution.warm();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

describe("agents.installs — what Update will run, named before anyone presses it", () => {
  it("projects each install's plan: the vendor's command, a manual recipe's own words, or nothing when no plan formed", async () => {
    const { distribution } = service({
      installs: [
        install(),
        install({
          executable: "/opt/node/bin/claude",
          realPath: "/opt/node/lib/claude/cli.js",
          active: false,
        }),
        install({ executable: "/weird/claude", realPath: "/weird/claude", active: false }),
      ],
      plan: (executable) =>
        executable === "/opt/node/bin/claude"
          ? {
              provider: "claude",
              executable,
              recipe: { kind: "manual", instructions: "reinstall from the vendor site" },
            }
          : executable === "/weird/claude"
            ? { status: "unavailable", provider: "claude", message: "no plan", retryable: false }
            : {
                provider: "claude",
                executable,
                recipe: { kind: "native-self-update", argv: [executable, "update"] },
                argv: [executable, "update"],
              },
    });
    const { installs } = await distribution.installs("claude");
    expect(installs[0]?.update).toEqual({
      kind: "native-self-update",
      command: ["/Users/test/.local/bin/claude", "update"],
    });
    expect(installs[0]?.releaseChannel).toBe("stable");
    expect(installs[1]?.update).toEqual({
      kind: "manual",
      instructions: "reinstall from the vendor site",
    });
    expect(installs[2]).not.toHaveProperty("update");
  });

  it("names an install script by its URL, never by the bash plumbing around it", async () => {
    const { distribution } = service({
      installs: [install({ provider: "claude" })],
      plan: (executable) => ({
        provider: "claude",
        executable,
        recipe: {
          kind: "installer-script",
          url: "https://example.com/install.sh",
          env: { EXAMPLE_NO_MODIFY_PATH: "1" },
        },
        argv: [
          "/bin/bash",
          "-c",
          "curl … | bash",
          "puppeteer-update",
          "https://example.com/install.sh",
        ],
      }),
    });
    const { installs } = await distribution.installs("claude");
    expect(installs[0]?.update).toEqual({
      kind: "installer-script",
      url: "https://example.com/install.sh",
    });
  });
});

describe("agents.releases — a check is kept, and the cached answer never checks", () => {
  it("keeps a check that consulted the network in the machine record and answers what is available", async () => {
    const { distribution, root } = service({ installs: [install()] });
    const answer = await distribution.releases({ network: true });
    expect(answer.available).toEqual([
      { provider: "claude", channel: "stable", version: "2.1.270" },
    ]);
    expect(answer.checked).toEqual([{ provider: "claude", at: "2026-09-23T09:41:20.000Z" }]);
    expect(readRecord(root).providers["claude"]).toMatchObject({
      lastCheckedAt: "2026-09-23T09:41:20.000Z",
      lastReleases: [expect.objectContaining({ version: "2.1.270", channel: "stable" })],
    });
  });

  it("does not keep a check that consulted nothing (no oracle, the network off)", async () => {
    const { distribution, root } = service({
      installs: [install()],
      checks: () => {
        const { available: _none, ...learnedNothing } = check({ releases: [], behind: [] });
        return learnedNothing;
      },
    });
    const answer = await distribution.releases({});
    expect(answer.checked).toEqual([]);
    expect(() => readRecord(root)).toThrow(); // nothing was written
  });

  it("answers `cached` from the record alone, re-judged against the install as it is now", async () => {
    const script: Script = { installs: [install()] };
    const checks = vi.fn(() => check());
    script.checks = checks;
    const { distribution } = service(script);
    await distribution.releases({ network: true });
    expect(checks).toHaveBeenCalledTimes(1);

    const before = await distribution.releases({ cached: true });
    expect(checks).toHaveBeenCalledTimes(1); // nothing ran
    expect(before.available).toEqual([
      { provider: "claude", channel: "stable", version: "2.1.270" },
    ]);
    expect(before.checked).toEqual([{ provider: "claude", at: "2026-09-23T09:41:20.000Z" }]);

    // the update landed since: the same kept check now offers nothing
    script.installs = [install({ version: "2.1.270" })];
    const after = await distribution.releases({ cached: true });
    expect(after.available).toEqual([]);
    expect(after.releases).toEqual(before.releases);
  });

  it("answers an empty cache honestly before the first check, and without a machine scope", async () => {
    const { distribution } = service({ installs: [install()] });
    expect(await distribution.releases({ cached: true })).toEqual({
      releases: [],
      available: [],
      checked: [],
    });
    const { distribution: bare } = service({ installs: [install()] }, { machine: false });
    expect(await bare.releases({ cached: true })).toEqual({
      releases: [],
      available: [],
      checked: [],
    });
  });
});

describe("agents.update and its operation", () => {
  it("publishes the updater's own output as it runs, then the receipt — and keeps the receipt in the record", async () => {
    let options: UpdateInstallationOptions | undefined;
    let finish: (value: UpdateReceipt) => void = () => undefined;
    const { distribution, root } = service({
      installs: [install()],
      update: (given) => {
        options = given;
        return new Promise<UpdateReceipt>((resolve) => {
          finish = resolve;
        });
      },
    });
    const frames: AgentsOperationsResult[] = [];
    distribution.subscribeOperations((snapshot) => frames.push(snapshot));
    expect(distribution.operationsSnapshot()).toEqual({ operations: [] });

    const updating = distribution.update("claude");
    await vi.waitFor(() => expect(options).toBeDefined());
    options?.onOutput?.("\u001b[1mCurrent version: 2.1.266\u001b[0m\n");
    options?.onOutput?.("Installing update... 10%\rInstalling update... 100%\n");
    await vi.waitFor(() =>
      expect(frames.at(-1)?.operations[0]).toMatchObject({
        provider: "claude",
        kind: "update",
        state: "running",
        output: "Current version: 2.1.266\nInstalling update... 100%",
        truncated: false,
      }),
    );

    finish(
      receipt({
        before: install({ version: "2.1.266" }),
        after: install({ version: "2.1.270" }),
      }),
    );
    const result = await updating;
    expect(result.receipt).toEqual({
      provider: "claude",
      status: "updated",
      startedAt: "2026-09-23T09:42:00.000Z",
      finishedAt: "2026-09-23T09:42:30.000Z",
      exitCode: 0,
      message: "updated from 2.1.266 to 2.1.270",
      fromVersion: "2.1.266",
      toVersion: "2.1.270",
    });
    expect(result.receipt).not.toHaveProperty("transcriptPath");
    await vi.waitFor(() =>
      expect(frames.at(-1)?.operations[0]).toMatchObject({
        state: "finished",
        finishedAt: "2026-09-23T09:41:20.000Z",
        receipt: { status: "updated" },
      }),
    );
    expect(readRecord(root).providers["claude"]?.lastUpdate).toMatchObject({ status: "updated" });
  });

  it("stops a running update through its signal, and marks the receipt stopped; with nothing running, says so", async () => {
    let signal: AbortSignal | undefined;
    const { distribution } = service({
      installs: [install()],
      update: (given) => {
        signal = given.signal;
        return new Promise<UpdateReceipt>((resolve) => {
          given.signal?.addEventListener("abort", () =>
            resolve(
              receipt({ status: "failed", message: "update command stopped before it finished" }),
            ),
          );
        });
      },
    });
    expect(distribution.stop("claude")).toEqual({ stopped: false });
    const updating = distribution.update("claude");
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);
    expect(distribution.stop("claude")).toEqual({ stopped: true });
    const { receipt: stopped } = await updating;
    expect(stopped).toMatchObject({ status: "failed", stopped: true });
    expect(distribution.operationsSnapshot().operations[0]).toMatchObject({
      state: "finished",
      receipt: { stopped: true },
    });
    // stopping what already finished stops nothing
    expect(distribution.stop("claude")).toEqual({ stopped: false });
  });

  it("runs one update per provider at a time: a second is a retryable CONFLICT, never two updaters", async () => {
    let finish: (value: UpdateReceipt) => void = () => undefined;
    const update = vi.fn(
      () =>
        new Promise<UpdateReceipt>((resolve) => {
          finish = resolve;
        }),
    );
    const { distribution } = service({ installs: [install()], update });
    const first = distribution.update("claude");
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const second = distribution.update("claude").then(
      () => null,
      (error: unknown) => error,
    );
    const refusal = (await second) as RpcCallError;
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect(refusal.kind).toBe("CONFLICT");
    expect(refusal.retryable).toBe(true);
    finish(receipt());
    await first;
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("an updater that throws leaves a finished operation, never a stuck 'running' one", async () => {
    const { distribution } = service({
      installs: [install()],
      update: async () => {
        throw new Error("runtime disposed");
      },
    });
    await expect(distribution.update("claude")).rejects.toThrow("runtime disposed");
    expect(distribution.operationsSnapshot().operations[0]?.state).toBe("finished");
  });

  it("refuses without a machine scope, before anything runs", async () => {
    const update = vi.fn(async () => receipt());
    const { distribution } = service({ installs: [install()], update }, { machine: false });
    const refusal = (await distribution
      .update("claude")
      .catch((error: unknown) => error)) as RpcCallError;
    expect(refusal.kind).toBe("UNAVAILABLE");
    expect(refusal.details).toMatchObject({ service: "agents", state: "no-machine-scope" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("agents.reveal — Show in Finder for an inventoried install only", () => {
  it("reveals the launcher the row shows, by the path the inventory holds", async () => {
    const reveal = vi.fn(async () => undefined);
    const { distribution } = service({ installs: [install()] }, { reveal });
    await expect(
      distribution.reveal({ provider: "claude", executable: "/Users/test/.local/bin/claude" }),
    ).resolves.toEqual({ revealed: true });
    // named by its real path, it is still the same install
    await distribution.reveal({
      provider: "claude",
      executable: "/Users/test/.local/share/claude/versions/2.1.266",
    });
    expect(reveal).toHaveBeenNthCalledWith(1, "/Users/test/.local/bin/claude");
    expect(reveal).toHaveBeenNthCalledWith(2, "/Users/test/.local/bin/claude");
  });

  it("never reveals a path the inventory does not hold", async () => {
    const reveal = vi.fn(async () => undefined);
    const { distribution } = service({ installs: [install()] }, { reveal });
    const refusal = (await distribution
      .reveal({ provider: "claude", executable: "/etc/passwd" })
      .catch((error: unknown) => error)) as RpcCallError;
    expect(refusal.kind).toBe("NOT_FOUND");
    expect(reveal).not.toHaveBeenCalled();
  });

  it("says so when no desktop shell is attached", async () => {
    const { distribution } = service({ installs: [install()] }, { reveal: null });
    const refusal = (await distribution
      .reveal({ provider: "claude", executable: "/Users/test/.local/bin/claude" })
      .catch((error: unknown) => error)) as RpcCallError;
    expect(refusal.kind).toBe("UNAVAILABLE");
    expect(refusal.details).toMatchObject({ service: "shell", state: "no-shell-provider" });
  });
});
