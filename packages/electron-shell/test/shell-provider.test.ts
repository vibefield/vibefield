import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAGES_OUTPUT_EXHAUSTED_MESSAGE,
  SHELL_PROVIDER_METHODS,
  type ShellSurfacesControlResult,
} from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { createNoopLogger } from "@vibefield/logging";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { FielddHandleCoordinator } from "../src/main/fieldd-handle-coordinator";
import { PagesBrokerError } from "../src/main/pages/broker/broker";
import { RecoveringShellProvider, type ShellProviderNative } from "../src/main/shell-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeClient {
  status = "ready";
  readonly requests: Array<{ method: string; params: unknown }> = [];
  private readonly statusListeners = new Set<() => void>();
  private readonly notifications = new Map<string, Set<(params: unknown) => void>>();

  onStatusChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onNotification(method: string, listener: (params: unknown) => void): () => void {
    let set = this.notifications.get(method);
    if (set === undefined) {
      set = new Set();
      this.notifications.set(method, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return method === "shell.provider.register"
      ? { registered: [...SHELL_PROVIDER_METHODS] }
      : { accepted: true };
  }

  emit(method: string, params: unknown): void {
    for (const listener of [...(this.notifications.get(method) ?? [])]) listener(params);
  }

  setStatus(status: string): void {
    this.status = status;
    for (const listener of [...this.statusListeners]) listener();
  }
}

function fakeHandle(bootId: string, client: FakeClient): FielddHandle {
  return {
    info: { bootId, port: 4242 },
    client,
    // item 212 (RV #67) — a handle's liveness, which the coordinator listens to: this one's watch says nothing
    liveness: { kind: "responsive" },
    onLiveness: () => () => undefined,
  } as unknown as FielddHandle;
}

function fakeWindow(visible = true): BrowserWindow {
  const emitter = new EventEmitter() as EventEmitter & {
    isDestroyed(): boolean;
    isMinimized(): boolean;
    isVisible(): boolean;
  };
  emitter.isDestroyed = () => false;
  emitter.isMinimized = () => false;
  emitter.isVisible = () => visible;
  return emitter as unknown as BrowserWindow;
}

function call(
  callId: string,
  method:
    | "shell.dialog.pickFolder"
    | "shell.dialog.pickFile"
    | "shell.dialog.saveFile"
    | "shell.openExternal"
    | "shell.openLink"
    | "shell.openMadeApp"
    | "shell.revealPath"
    | "shell.webcontents.captureArtifactPreview"
    | "shell.renderer.requestReplacement"
    | "shell.surfaces.simulatorDevices"
    | "shell.surfaces.mint"
    | "shell.surfaces.control",
  params: unknown,
) {
  return {
    callId,
    method,
    params,
    caller: { kind: "plugin", pluginId: "vibefield.browser", clientKind: "renderer" },
    deadlineAt: Date.now() + 5_000,
  };
}

async function fixture(
  nativeOverrides?: Partial<ShellProviderNative>,
  logger = createNoopLogger(),
) {
  const client = new FakeClient();
  const handle = fakeHandle("boot-1", client);
  const coordinator = new FielddHandleCoordinator({
    upstreamEnsure: vi.fn(async () => handle) as unknown as FielddSupervisor["ensure"],
  });
  const parent = fakeWindow();
  const native: ShellProviderNative = {
    parentWindow: vi.fn(() => parent),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
    documentsPath: vi.fn(() => "/Users/test/Documents"),
    openExternal: vi.fn(async () => undefined),
    revealPath: vi.fn(),
    openMadeApp: vi.fn(async () => undefined),
    captureArtifactPreview: vi.fn(async () => ({ captured: true as const })),
    requestRendererReplacement: vi.fn(() => ({ requested: true })),
    enumerateSurfaceSources: vi.fn(async () => ({ sources: [] })),
    mintSurfaceTicket: vi.fn(async () => {
      throw { kind: "UNAVAILABLE" };
    }),
    releaseSurface: vi.fn(async () => ({ released: false })),
    listSimulatorDevices: vi.fn(async () => ({ devices: [] })),
    ...nativeOverrides,
  };
  const provider = new RecoveringShellProvider(coordinator, native, logger);
  await coordinator.ensure();
  await vi.waitFor(() =>
    expect(client.requests[0]).toEqual({
      method: "shell.provider.register",
      params: { methods: [...SHELL_PROVIDER_METHODS] },
    }),
  );
  return { client, coordinator, native, parent, provider };
}

describe("RecoveringShellProvider", () => {
  it("validates registration acknowledgments and retries while the client stays ready", async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeClient();
      const request = vi
        .spyOn(client, "request")
        .mockResolvedValueOnce({ registered: ["shell.openExternal"] })
        .mockResolvedValue({
          registered: [...SHELL_PROVIDER_METHODS],
        });
      const upstream = vi.fn(async () => fakeHandle("boot-1", client));
      const coordinator = new FielddHandleCoordinator({
        upstreamEnsure: upstream as unknown as FielddSupervisor["ensure"],
      });
      const native: ShellProviderNative = {
        parentWindow: () => fakeWindow(),
        showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
        showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
        documentsPath: () => "/Users/test/Documents",
        openExternal: vi.fn(async () => undefined),
        revealPath: vi.fn(),
        openMadeApp: vi.fn(async () => undefined),
        captureArtifactPreview: vi.fn(async () => ({ captured: true as const })),
        requestRendererReplacement: vi.fn(() => ({ requested: true })),
        enumerateSurfaceSources: vi.fn(async () => ({ sources: [] })),
        mintSurfaceTicket: vi.fn(async () => {
          throw { kind: "UNAVAILABLE" };
        }),
        releaseSurface: vi.fn(async () => ({ released: false })),
        listSimulatorDevices: vi.fn(async () => ({ devices: [] })),
      };
      const provider = new RecoveringShellProvider(coordinator, native, createNoopLogger());

      await coordinator.ensure();
      await vi.advanceTimersByTimeAsync(0);
      expect(request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(request).toHaveBeenCalledTimes(2);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates and opens only the exact external URL before resolving", async () => {
    const { client, native, provider } = await fixture();
    const url = "https://host.example.ts.net:12000/";
    client.emit(
      "shell.provider.call",
      call("shell-abcdefghijklmnop", "shell.openExternal", { url }),
    );
    await vi.waitFor(() => expect(native.openExternal).toHaveBeenCalledWith(url));
    await vi.waitFor(() =>
      expect(client.requests.at(-1)).toEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-abcdefghijklmnop",
          outcome: { result: { opened: true } },
        },
      }),
    );
    provider.dispose();
  });

  it("GT-8a: opens a terminal link's canonical http(s) URL, and nothing else, in the browser", async () => {
    const { client, native, provider } = await fixture();
    const url = "http://localhost:3000/x";
    client.emit("shell.provider.call", call("shell-linkaaaaaaaaaaaa", "shell.openLink", { url }));
    await vi.waitFor(() => expect(native.openExternal).toHaveBeenCalledWith(url));
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: { callId: "shell-linkaaaaaaaaaaaa", outcome: { result: { opened: true } } },
      }),
    );
    // main's own re-check: an app, a mailto, credentials, a spelling fieldd
    // would have canonicalized — each refused before the browser is asked
    const refusals = [
      "file:///Applications/Calculator.app",
      "mailto:team@example.com",
      "https://user:pass@example.com/",
      "https://example.com",
    ];
    for (const [index, refused] of refusals.entries()) {
      const callId = `shell-linkrefused${index}xxxx`;
      client.emit("shell.provider.call", call(callId, "shell.openLink", { url: refused }));
      await vi.waitFor(() =>
        expect(client.requests).toContainEqual({
          method: "shell.provider.resolve",
          params: {
            callId,
            outcome: {
              error: {
                kind: "PRECONDITION_FAILED",
                message: "the desktop operation failed",
                retryable: false,
              },
            },
          },
        }),
      );
    }
    expect(native.openExternal).toHaveBeenCalledTimes(1);
    expect(native.revealPath).not.toHaveBeenCalled();
    provider.dispose();
  });

  it("MA-D16: hands a made app's local view to the browser by its app and its page's digest, never a path, and says a file that is not there", async () => {
    const appId = "a".repeat(64);
    const digest = "b".repeat(64);
    const openMadeApp = vi.fn(async (params: { appId: string; digest: string }) => {
      // main's own rule (made-app-local.ts) refuses a view that is not on the disk
      if (params.digest === "c".repeat(64)) throw { kind: "NOT_FOUND" };
    });
    const { client, native, provider } = await fixture({ openMadeApp });
    client.emit(
      "shell.provider.call",
      call("shell-madeaaaaaaaaaaaa", "shell.openMadeApp", { appId, digest, path: "/etc/passwd" }),
    );
    // exactly the two words the contract names reach the native side: a stray `path` is dropped
    await vi.waitFor(() => expect(openMadeApp).toHaveBeenCalledWith({ appId, digest }));
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: { callId: "shell-madeaaaaaaaaaaaa", outcome: { result: { opened: true } } },
      }),
    );
    // main's own re-check of the grammar: each refused before anything is looked for
    const refusals = [
      {},
      { appId },
      { appId, digest: "../../../../etc/passwd" },
      { appId: `${"a".repeat(60)}/../`, digest },
      { appId: appId.toUpperCase(), digest },
      { path: "/tmp/page.html" },
    ];
    for (const [index, refused] of refusals.entries()) {
      const callId = `shell-maderefused${index}xxxx`;
      client.emit("shell.provider.call", call(callId, "shell.openMadeApp", refused));
      await vi.waitFor(() =>
        expect(client.requests).toContainEqual({
          method: "shell.provider.resolve",
          params: {
            callId,
            outcome: {
              error: {
                kind: "PRECONDITION_FAILED",
                message: "the desktop operation failed",
                retryable: false,
              },
            },
          },
        }),
      );
    }
    expect(openMadeApp).toHaveBeenCalledTimes(1);
    // a view the disk does not hold: the refusal names no path
    client.emit(
      "shell.provider.call",
      call("shell-madegoneaaaaaaaaaa", "shell.openMadeApp", { appId, digest: "c".repeat(64) }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-madegoneaaaaaaaaaa",
          outcome: {
            error: {
              kind: "NOT_FOUND",
              message: "that app has no local view to open",
              retryable: false,
            },
          },
        },
      }),
    );
    expect(native.openExternal).not.toHaveBeenCalled();
    expect(native.revealPath).not.toHaveBeenCalled();
    provider.dispose();
  });

  it("reveals the exact path fieldd named in the file manager, and refuses a relative one", async () => {
    const { client, native, provider } = await fixture();
    const path = "/Users/test/.local/bin/claude";
    client.emit(
      "shell.provider.call",
      call("shell-revealabcdefghij", "shell.revealPath", { path }),
    );
    await vi.waitFor(() => expect(native.revealPath).toHaveBeenCalledWith(path));
    await vi.waitFor(() =>
      expect(client.requests.at(-1)).toEqual({
        method: "shell.provider.resolve",
        params: { callId: "shell-revealabcdefghij", outcome: { result: { revealed: true } } },
      }),
    );
    client.emit(
      "shell.provider.call",
      call("shell-revealrelativexx", "shell.revealPath", { path: "bin/claude" }),
    );
    await vi.waitFor(() =>
      expect(client.requests.at(-1)).toMatchObject({
        method: "shell.provider.resolve",
        params: { callId: "shell-revealrelativexx", outcome: { error: expect.anything() } },
      }),
    );
    expect(native.revealPath).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it("requests one exact renderer replacement without presenting the result as death proof", async () => {
    const requestRendererReplacement = vi.fn(() => ({ requested: true }));
    const { client, provider } = await fixture({ requestRendererReplacement });
    const callId = "shell-replaceabcdefghi";
    const rendererParticipant = {
      participantId: "renderer:desktop-test:window-1",
      incarnation: "renderer:desktop-test:window-1:document-2",
    };
    client.emit(
      "shell.provider.call",
      call(callId, "shell.renderer.requestReplacement", {
        rendererParticipant,
        reason: "plugin-update-deadline",
      }),
    );

    await vi.waitFor(() =>
      expect(requestRendererReplacement).toHaveBeenCalledWith({
        rendererParticipant,
        reason: "plugin-update-deadline",
      }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: { callId, outcome: { result: { requested: true } } },
      }),
    );
    provider.dispose();
  });

  it("PT-S2 (R11): answers the attach's device list from main's authority, re-parsed — a row carrying a UDID fails the call", async () => {
    const row = {
      deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
      name: "iPhone 17 Pro",
      booted: true,
    };
    const runtimes = ["com.apple.CoreSimulator.SimRuntime.iOS-26-5"];
    const listSimulatorDevices = vi
      .fn()
      .mockResolvedValueOnce({ devices: [row], runtimes })
      .mockResolvedValueOnce({
        devices: [{ ...row, udid: "F93EABF3-4281-4EB5-A5F6-A550FBE95CDC" }],
      })
      .mockRejectedValueOnce({ kind: "UNAVAILABLE" });
    const { client, provider } = await fixture({ listSimulatorDevices });

    client.emit(
      "shell.provider.call",
      call("shell-simdevicesaaaaaa", "shell.surfaces.simulatorDevices", {}),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-simdevicesaaaaaa",
          outcome: { result: { devices: [row], runtimes } },
        },
      }),
    );
    expect(listSimulatorDevices).toHaveBeenCalledWith({}, expect.any(AbortSignal));

    client.emit(
      "shell.provider.call",
      call("shell-simdevicesbbbbbb", "shell.surfaces.simulatorDevices", {}),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: { callId: "shell-simdevicesbbbbbb", outcome: { error: expect.anything() } },
      }),
    );
    expect(JSON.stringify(client.requests)).not.toContain("F93EABF3");

    client.emit(
      "shell.provider.call",
      call("shell-simdevicescccccc", "shell.surfaces.simulatorDevices", {}),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-simdevicescccccc",
          outcome: {
            error: {
              kind: "UNAVAILABLE",
              message: "the live-surface authority is unavailable",
              retryable: true,
            },
          },
        },
      }),
    );
    provider.dispose();
  });

  // EY-1: a page's call as fieldd's pages room sends it
  const pageCall = {
    run: "run-01J8Z3K9",
    surfaceId: "surface_0123456789abcdef",
    window: "read",
    command: { action: "snapshot", interactive: true },
  };
  type ControlSurface = NonNullable<ShellProviderNative["controlSurface"]>;

  function resolved(callId: string, outcome: unknown) {
    return { method: "shell.provider.resolve", params: { callId, outcome } };
  }

  it("EY-1: parses an agent's call on a page through the contract and hands it to the broker with fieldd's signal and deadline", async () => {
    const controlSurface = vi.fn<ControlSurface>(async () => ({ status: "refused", fact: "held" }));
    const { client, provider } = await fixture({ controlSurface });
    const sent = call("shell-controlaaaaaaaaa", "shell.surfaces.control", pageCall);
    client.emit("shell.provider.call", sent);
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual(
        resolved("shell-controlaaaaaaaaa", { result: { status: "refused", fact: "held" } }),
      ),
    );
    const [params, signal, deadlineAt] = controlSurface.mock.calls[0] ?? [];
    expect(params).toEqual(pageCall);
    expect(signal?.aborted).toBe(false);
    expect(deadlineAt).toBe(sent.deadlineAt);
    provider.dispose();
  });

  it("EY-1: answers a page's call UNAVAILABLE while main has no pages broker", async () => {
    const { client, native, provider } = await fixture();
    client.emit(
      "shell.provider.call",
      call("shell-controlbbbbbbbbb", "shell.surfaces.control", pageCall),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual(
        resolved("shell-controlbbbbbbbbb", {
          error: {
            kind: "UNAVAILABLE",
            message: "the live-surface authority is unavailable",
            retryable: true,
          },
        }),
      ),
    );
    expect(native.showOpenDialog).not.toHaveBeenCalled();
    provider.dispose();
  });

  it("EY-1: refuses params that are not a page's call before the broker or any dialog", async () => {
    const controlSurface = vi.fn<ControlSurface>(async () => ({ status: "refused", fact: "gone" }));
    const { client, native, provider } = await fixture({ controlSurface });
    const calls = [
      { callId: "shell-controlccccccccc", params: { purpose: "workspace.export" } },
      { callId: "shell-controlddddddddd", params: { ...pageCall, window: "write" } },
    ];
    for (const { callId, params } of calls) {
      client.emit("shell.provider.call", call(callId, "shell.surfaces.control", params));
      await vi.waitFor(() =>
        expect(client.requests).toContainEqual(
          resolved(callId, {
            error: {
              kind: "PRECONDITION_FAILED",
              message: "the desktop operation failed",
              retryable: false,
            },
          }),
        ),
      );
    }
    expect(controlSurface).not.toHaveBeenCalled();
    expect(native.showOpenDialog).not.toHaveBeenCalled();
    provider.dispose();
  });

  it("EY-1: carries the broker's errors across as their kinds", async () => {
    const controlSurface = vi.fn<ControlSurface>(async () => {
      throw { kind: "TIMEOUT", state: "deadline" };
    });
    const { client, provider } = await fixture({ controlSurface });
    client.emit(
      "shell.provider.call",
      call("shell-controleeeeeeeee", "shell.surfaces.control", pageCall),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual(
        resolved("shell-controleeeeeeeee", {
          error: { kind: "TIMEOUT", message: "the desktop operation failed", retryable: true },
        }),
      ),
    );
    provider.dispose();
  });

  it("EY-1: a pages UNAVAILABLE keeps its state to the room as the fixture says it; any other error stays bare, and main logs the broker's word", async () => {
    const logger = createNoopLogger();
    const warn = vi.spyOn(logger, "warn");
    const outcome: unknown = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../contracts/fixtures/shell-provider-outcome.pages-unavailable.json",
        ),
        "utf8",
      ),
    );
    const errors = [
      new PagesBrokerError("UNAVAILABLE", "not-installed"),
      new PagesBrokerError("UNAVAILABLE", "run-form"),
      new PagesBrokerError("PRECONDITION_FAILED", "signed-in"),
    ];
    const controlSurface = vi.fn<ControlSurface>(async () => {
      throw errors.shift();
    });
    const { client, provider } = await fixture({ controlSurface }, logger);
    const asked = async (callId: string, answer: unknown) => {
      client.emit("shell.provider.call", call(callId, "shell.surfaces.control", pageCall));
      await vi.waitFor(() => expect(client.requests).toContainEqual(resolved(callId, answer)));
    };
    await asked("shell-controlhhhhhhhhh", outcome);
    await asked("shell-controliiiiiiiii", {
      error: {
        kind: "UNAVAILABLE",
        message: "the live-surface authority is unavailable",
        retryable: true,
      },
    });
    await asked("shell-controljjjjjjjjj", {
      error: {
        kind: "PRECONDITION_FAILED",
        message: "the desktop operation failed",
        retryable: false,
      },
    });
    expect(warn).toHaveBeenCalledWith("desktop.pages.control_failed", expect.any(String), {
      kind: "UNAVAILABLE",
      state: "not-installed",
    });
    expect(warn).toHaveBeenCalledWith("desktop.pages.control_failed", expect.any(String), {
      kind: "PRECONDITION_FAILED",
      state: "signed-in",
    });
    provider.dispose();
  });

  it("EY-1: a pages RESOURCE_EXHAUSTED keeps the broker's word to the room as the fixture says it, in words of its own; a preview keeps the preview's", async () => {
    // 2026-11-24: main's provider said a state only for a pages UNAVAILABLE. A run at its count of pages, a desk
    // with no room and an answer too large all crossed bare, in the words of a preview's image budget, and the room
    // could only guess which by the kind of call.
    const outcome = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../contracts/fixtures/shell-provider-outcome.pages-exhausted.json",
        ),
        "utf8",
      ),
    ) as { error: { kind: string; message: string; retryable: boolean; details: unknown } };
    expect(outcome.error.details).toEqual({ service: "pages", state: "run-full" });
    const errors = [
      new PagesBrokerError("RESOURCE_EXHAUSTED", "run-full"),
      new PagesBrokerError("RESOURCE_EXHAUSTED", "desk-full"),
      new PagesBrokerError("RESOURCE_EXHAUSTED", "output-too-large"),
      new PagesBrokerError("RESOURCE_EXHAUSTED", "a-word-off-the-list"),
      new PagesBrokerError("PRECONDITION_FAILED", "run-full"),
    ];
    const controlSurface = vi.fn<ControlSurface>(async () => {
      throw errors.shift();
    });
    const captureArtifactPreview = vi.fn<ShellProviderNative["captureArtifactPreview"]>(
      async () => {
        throw { kind: "RESOURCE_EXHAUSTED" };
      },
    );
    const { client, provider } = await fixture({ controlSurface, captureArtifactPreview });
    const asked = async (callId: string, answer: unknown) => {
      client.emit("shell.provider.call", call(callId, "shell.surfaces.control", pageCall));
      await vi.waitFor(() => expect(client.requests).toContainEqual(resolved(callId, answer)));
    };
    const exhausted = (message: string, state?: string) => ({
      error: {
        kind: "RESOURCE_EXHAUSTED",
        message,
        retryable: false,
        ...(state === undefined ? {} : { details: { service: "pages", state } }),
      },
    });
    await asked("shell-controlkkkkkkkkk", outcome);
    await asked("shell-controllllllllll", exhausted(outcome.error.message, "desk-full"));
    await asked(
      "shell-controlmmmmmmmmm",
      exhausted(PAGES_OUTPUT_EXHAUSTED_MESSAGE, "output-too-large"),
    );
    // a word off the broker's list crosses as no state, and still never in a preview's words
    await asked("shell-controlnnnnnnnnn", exhausted(PAGES_OUTPUT_EXHAUSTED_MESSAGE));
    // the state belongs to its kind: the same word under another kind says nothing
    await asked("shell-controlooooooooo", {
      error: {
        kind: "PRECONDITION_FAILED",
        message: "the desktop operation failed",
        retryable: false,
      },
    });
    // a preview's own budget keeps its own words, and names no service
    const previewId = "shell-previewkkkkkkkkkk";
    client.emit(
      "shell.provider.call",
      call(previewId, "shell.webcontents.captureArtifactPreview", {
        artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        url: "https://host.tail1234.ts.net:12000/",
      }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual(
        resolved(previewId, exhausted("the preview could not fit within the image budget")),
      ),
    );
    provider.dispose();
  });

  it("the broker's words for no room are the ones fieldd's room reads, each by name", () => {
    // main's list of the states a pages RESOURCE_EXHAUSTED may say is held to the room's own reading of them, by
    // its text, until contracts names the list for both
    const room = readFileSync(
      join(import.meta.dirname, "../../fieldd/src/tool-plane/rooms/pages/facts.ts"),
      "utf8",
    );
    const read = [...room.matchAll(/\bsaid === "([a-z-]+)"/gu)].map((match) => match[1]).sort();
    expect(read).toEqual(["desk-full", "output-too-large", "run-full"]);
    const provider = readFileSync(
      join(import.meta.dirname, "../src/main/shell-provider.ts"),
      "utf8",
    );
    const listed = /PAGES_EXHAUSTED_STATES[^=]*=\s*\[([^\]]*)\]/u.exec(provider)?.[1] ?? "";
    expect([...listed.matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]).sort()).toEqual(read);
  });

  it("EY-1 (7b): a mint refused because its page is gone for good says so to the window as the fixture says it; no other state crosses", async () => {
    const outcome: unknown = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../contracts/fixtures/shell-provider-outcome.surfaces-made-closed.json",
        ),
        "utf8",
      ),
    );
    const errors: unknown[] = [
      { kind: "PRECONDITION_FAILED", state: "made-closed" },
      { kind: "PRECONDITION_FAILED" },
      { kind: "PRECONDITION_FAILED", state: "desk-full" },
      { kind: "UNAVAILABLE", state: "made-closed" },
      new PagesBrokerError("PRECONDITION_FAILED", "made-closed"),
    ];
    const mintSurfaceTicket = vi.fn<ShellProviderNative["mintSurfaceTicket"]>(async () => {
      throw errors.shift();
    });
    const { client, provider } = await fixture({ mintSurfaceTicket });
    const params = {
      rendererParticipant: {
        participantId: "renderer:desktop-test:window-1",
        incarnation: "renderer:desktop-test:window-1:document-2",
      },
      source: {
        kind: "browser",
        initialUrl: "https://example.com/",
        profile: { mode: "memory", ref: "run:run-01J8Z3K9" },
        logicalViewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      },
      reuseKey: "pane-made-1",
      made: "surface_fedcba9876543210",
    };
    const asked = async (callId: string, answer: unknown) => {
      client.emit("shell.provider.call", call(callId, "shell.surfaces.mint", params));
      await vi.waitFor(() => expect(client.requests).toContainEqual(resolved(callId, answer)));
    };
    const bare = {
      kind: "PRECONDITION_FAILED",
      message: "the desktop operation failed",
      retryable: false,
    };
    await asked("shell-mintaaaaaaaaaaaa", outcome);
    await asked("shell-mintbbbbbbbbbbbb", { error: bare });
    await asked("shell-mintcccccccccccc", { error: bare });
    await asked("shell-mintdddddddddddd", {
      error: {
        kind: "UNAVAILABLE",
        message: "the live-surface authority is unavailable",
        retryable: true,
      },
    });
    await asked("shell-minteeeeeeeeeeee", { error: bare });
    expect(mintSurfaceTicket).toHaveBeenCalledTimes(5);
    provider.dispose();
  });

  it("EY-1: answers a broker answer outside the contract INTERNAL, and logs its shape, never its content", async () => {
    const logger = createNoopLogger();
    const warn = vi.spyOn(logger, "warn");
    const planted = "page text that must never reach a log";
    // the page's text as a value and as a key: neither may reach the log
    const malformed = { status: "refused", fact: planted, [planted]: planted };
    const controlSurface = vi.fn<ControlSurface>(
      async () => malformed as unknown as ShellSurfacesControlResult,
    );
    const { client, provider } = await fixture({ controlSurface }, logger);
    client.emit(
      "shell.provider.call",
      call("shell-controlggggggggg", "shell.surfaces.control", pageCall),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual(
        resolved("shell-controlggggggggg", {
          error: { kind: "INTERNAL", message: "the desktop operation failed", retryable: false },
        }),
      ),
    );
    expect(warn).toHaveBeenCalledWith("desktop.pages.control_answer_rejected", expect.any(String), {
      issues: expect.any(Number),
      codes: expect.any(String),
      depth: expect.any(Number),
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(planted);
    provider.dispose();
  });

  it("EY-1: aborts the broker's call when fieldd cancels it, and answers nothing after", async () => {
    let seen: AbortSignal | undefined;
    const answer = deferred<ShellSurfacesControlResult>();
    const controlSurface = vi.fn<ControlSurface>((_params, signal) => {
      seen = signal;
      return answer.promise;
    });
    const { client, provider } = await fixture({ controlSurface });
    const callId = "shell-controlfffffffff";
    client.emit("shell.provider.call", call(callId, "shell.surfaces.control", pageCall));
    await vi.waitFor(() => expect(controlSurface).toHaveBeenCalledTimes(1));
    expect(seen?.aborted).toBe(false);
    client.emit("shell.provider.cancel", { callId });
    expect(seen?.aborted).toBe(true);
    answer.resolve({ status: "done", output: { success: true } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      client.requests.some(
        (request) =>
          request.method === "shell.provider.resolve" &&
          (request.params as { callId?: string }).callId === callId,
      ),
    ).toBe(false);
    provider.dispose();
  });

  it("runs one preview capture and aborts it when fieldd cancels", async () => {
    let captureSignal: AbortSignal | undefined;
    const capture = deferred<{ captured: true; title: string }>();
    const captureArtifactPreview = vi.fn<ShellProviderNative["captureArtifactPreview"]>(
      (_params, signal) => {
        captureSignal = signal;
        return capture.promise;
      },
    );
    const { client, provider } = await fixture({ captureArtifactPreview });
    const callId = "shell-previewabcdefghij";
    client.emit(
      "shell.provider.call",
      call(callId, "shell.webcontents.captureArtifactPreview", {
        artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        url: "https://host.tail1234.ts.net:12000/",
      }),
    );
    await vi.waitFor(() => expect(captureArtifactPreview).toHaveBeenCalledTimes(1));
    expect(captureSignal?.aborted).toBe(false);
    client.emit("shell.provider.cancel", { callId });
    expect(captureSignal?.aborted).toBe(true);
    capture.resolve({ captured: true, title: "Late title" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      client.requests.some(
        (request) =>
          request.method === "shell.provider.resolve" &&
          (request.params as { callId?: string }).callId === callId,
      ),
    ).toBe(false);
    provider.dispose();
  });

  it("does not create preview work while the desktop window is hidden", async () => {
    const captureArtifactPreview = vi.fn(async () => ({ captured: true as const }));
    const { client, provider } = await fixture({
      parentWindow: () => fakeWindow(false),
      captureArtifactPreview,
    });
    const callId = "shell-hiddenabcdefghijk";
    client.emit(
      "shell.provider.call",
      call(callId, "shell.webcontents.captureArtifactPreview", {
        artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        url: "https://host.tail1234.ts.net:12000/",
      }),
    );

    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId,
          outcome: {
            error: {
              kind: "UNAVAILABLE",
              message: "preview capture is unavailable",
              retryable: true,
            },
          },
        },
      }),
    );
    expect(captureArtifactPreview).not.toHaveBeenCalled();
    provider.dispose();
  });

  it("parents one native folder picker, carries no default path, and rejects overlap", async () => {
    const picker = deferred<{ canceled: boolean; filePaths: string[] }>();
    const showOpenDialog = vi.fn<ShellProviderNative["showOpenDialog"]>(() => picker.promise);
    const { client, native, parent, provider } = await fixture({ showOpenDialog });
    client.emit(
      "shell.provider.call",
      call("shell-aaaaaaaaaaaaaaaa", "shell.dialog.pickFolder", {
        purpose: "artifact.publish",
      }),
    );
    client.emit(
      "shell.provider.call",
      call("shell-bbbbbbbbbbbbbbbb", "shell.dialog.pickFolder", {
        purpose: "artifact.publish",
      }),
    );
    await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalledTimes(1));
    expect(showOpenDialog.mock.calls[0]?.[0]).toBe(parent);
    expect(showOpenDialog.mock.calls[0]?.[1]).toEqual({
      title: "Choose a folder to publish",
      buttonLabel: "Choose Folder",
      properties: ["openDirectory", "createDirectory"],
    });
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-bbbbbbbbbbbbbbbb",
          outcome: {
            error: {
              kind: "CONFLICT",
              message: "another folder dialog is already open",
              retryable: true,
            },
          },
        },
      }),
    );
    picker.resolve({ canceled: false, filePaths: ["/Users/me/Sites/demo"] });
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-aaaaaaaaaaaaaaaa",
          outcome: { result: { canceled: false, path: "/Users/me/Sites/demo" } },
        },
      }),
    );
    expect(native.parentWindow).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it("ignores a late OS result after fieldd cancels the call", async () => {
    const picker = deferred<{ canceled: boolean; filePaths: string[] }>();
    const { client, provider } = await fixture({
      showOpenDialog: vi.fn(() => picker.promise),
    });
    const callId = "shell-cccccccccccccccc";
    client.emit(
      "shell.provider.call",
      call(callId, "shell.dialog.pickFolder", { purpose: "artifact.publish" }),
    );
    client.emit("shell.provider.cancel", { callId });
    picker.resolve({ canceled: false, filePaths: ["/Users/me/private"] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      client.requests.some(
        (request) =>
          request.method === "shell.provider.resolve" &&
          (request.params as { callId?: string }).callId === callId,
      ),
    ).toBe(false);
    provider.dispose();
  });

  it("parents one file picker for Import, locked to its purpose, under the one-dialog rule", async () => {
    const picker = deferred<{ canceled: boolean; filePaths: string[] }>();
    const showOpenDialog = vi.fn<ShellProviderNative["showOpenDialog"]>(() => picker.promise);
    const { client, native, parent, provider } = await fixture({ showOpenDialog });
    client.emit(
      "shell.provider.call",
      call("shell-importaaaaaaaaaa", "shell.dialog.pickFile", {
        purpose: "terminal.config.import",
      }),
    );
    // one dialog at a time, whichever kind: a save is refused while a pick is up
    client.emit(
      "shell.provider.call",
      call("shell-exportbbbbbbbbbb", "shell.dialog.saveFile", {
        purpose: "terminal.config.export",
        defaultName: "config.ghostty",
      }),
    );
    await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalledTimes(1));
    expect(showOpenDialog.mock.calls[0]?.[0]).toBe(parent);
    expect(showOpenDialog.mock.calls[0]?.[1]).toEqual({
      title: "Import a terminal configuration",
      buttonLabel: "Import",
      properties: ["openFile"],
    });
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-exportbbbbbbbbbb",
          outcome: {
            error: { kind: "CONFLICT", message: "another dialog is already open", retryable: true },
          },
        },
      }),
    );
    expect(native.showSaveDialog).not.toHaveBeenCalled();
    picker.resolve({ canceled: false, filePaths: ["/Users/me/Downloads/theirs.ghostty"] });
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-importaaaaaaaaaa",
          outcome: { result: { canceled: false, path: "/Users/me/Downloads/theirs.ghostty" } },
        },
      }),
    );

    // the purpose lock: another purpose is refused before any dialog exists
    client.emit(
      "shell.provider.call",
      call("shell-importcccccccccc", "shell.dialog.pickFile", { purpose: "artifact.publish" }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-importcccccccccc",
          outcome: {
            error: {
              kind: "PRECONDITION_FAILED",
              message: "the desktop operation failed",
              retryable: false,
            },
          },
        },
      }),
    );
    expect(showOpenDialog).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it("proposes Documents/<name> for Export, asks before replacing, and takes a name, never a path", async () => {
    const showSaveDialog = vi.fn<ShellProviderNative["showSaveDialog"]>(async () => ({
      canceled: false,
      filePath: "/Users/test/Documents/config.ghostty",
    }));
    const { client, parent, provider } = await fixture({ showSaveDialog });
    client.emit(
      "shell.provider.call",
      call("shell-saveaaaaaaaaaaaa", "shell.dialog.saveFile", {
        purpose: "terminal.config.export",
        defaultName: "config.ghostty",
      }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-saveaaaaaaaaaaaa",
          outcome: { result: { canceled: false, path: "/Users/test/Documents/config.ghostty" } },
        },
      }),
    );
    expect(showSaveDialog.mock.calls[0]?.[0]).toBe(parent);
    expect(showSaveDialog.mock.calls[0]?.[1]).toEqual({
      title: "Export the terminal configuration",
      buttonLabel: "Export",
      defaultPath: join("/Users/test/Documents", "config.ghostty"),
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });

    // Electron reports a cancelled save with an empty path
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: "" });
    client.emit(
      "shell.provider.call",
      call("shell-savebbbbbbbbbbbb", "shell.dialog.saveFile", {
        purpose: "terminal.config.export",
        defaultName: "config.ghostty",
      }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: { callId: "shell-savebbbbbbbbbbbb", outcome: { result: { canceled: true } } },
      }),
    );

    // the dialog only ever proposes a bare name: a path is refused before it opens
    client.emit(
      "shell.provider.call",
      call("shell-savecccccccccccc", "shell.dialog.saveFile", {
        purpose: "terminal.config.export",
        defaultName: "../../.zshrc",
      }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-savecccccccccccc",
          outcome: {
            error: {
              kind: "PRECONDITION_FAILED",
              message: "the desktop operation failed",
              retryable: false,
            },
          },
        },
      }),
    );
    expect(showSaveDialog).toHaveBeenCalledTimes(2);
    provider.dispose();
  });

  it("turns a file dialog's answer into a cancel when its window closed underneath it", async () => {
    const picker = deferred<{ canceled: boolean; filePaths: string[] }>();
    const showOpenDialog = vi.fn<ShellProviderNative["showOpenDialog"]>(() => picker.promise);
    const { client, parent, provider } = await fixture({ showOpenDialog });
    client.emit(
      "shell.provider.call",
      call("shell-closedaaaaaaaaaa", "shell.dialog.pickFile", {
        purpose: "terminal.config.import",
      }),
    );
    await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalledTimes(1));
    parent.emit("closed");
    picker.resolve({ canceled: false, filePaths: ["/Users/me/private.ghostty"] });
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: { callId: "shell-closedaaaaaaaaaa", outcome: { result: { canceled: true } } },
      }),
    );
    provider.dispose();
  });

  it("opens no file dialog without a window to parent it", async () => {
    const { client, native, provider } = await fixture({ parentWindow: () => null });
    client.emit(
      "shell.provider.call",
      call("shell-nowindowaaaaaaaa", "shell.dialog.saveFile", {
        purpose: "terminal.config.export",
        defaultName: "config.ghostty",
      }),
    );
    await vi.waitFor(() =>
      expect(client.requests).toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId: "shell-nowindowaaaaaaaa",
          outcome: {
            error: {
              kind: "UNAVAILABLE",
              message: "the primary window is unavailable",
              retryable: true,
            },
          },
        },
      }),
    );
    expect(native.showSaveDialog).not.toHaveBeenCalled();
    provider.dispose();
  });

  it("re-registers after reconnect and detaches the previous handle", async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const handles = [fakeHandle("boot-1", first), fakeHandle("boot-2", second)];
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(handles[0])
      .mockResolvedValueOnce(handles[1]) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator({ upstreamEnsure: upstream });
    const native: ShellProviderNative = {
      parentWindow: () => fakeWindow(),
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
      documentsPath: () => "/Users/test/Documents",
      openExternal: vi.fn(async () => undefined),
      revealPath: vi.fn(),
      openMadeApp: vi.fn(async () => undefined),
      captureArtifactPreview: vi.fn(async () => ({ captured: true as const })),
      requestRendererReplacement: vi.fn(() => ({ requested: true })),
      enumerateSurfaceSources: vi.fn(async () => ({ sources: [] })),
      mintSurfaceTicket: vi.fn(async () => {
        throw { kind: "UNAVAILABLE" };
      }),
      releaseSurface: vi.fn(async () => ({ released: false })),
      listSimulatorDevices: vi.fn(async () => ({ devices: [] })),
    };
    const provider = new RecoveringShellProvider(coordinator, native, createNoopLogger());
    await coordinator.ensure();
    first.setStatus("reconnecting");
    first.setStatus("ready");
    await vi.waitFor(() =>
      expect(
        first.requests.filter((request) => request.method === "shell.provider.register"),
      ).toHaveLength(2),
    );
    await coordinator.ensure();
    await vi.waitFor(() =>
      expect(
        second.requests.filter((request) => request.method === "shell.provider.register"),
      ).toHaveLength(1),
    );
    first.emit(
      "shell.provider.call",
      call("shell-dddddddddddddddd", "shell.openExternal", {
        url: "https://old.example.ts.net:12000/",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(native.openExternal).not.toHaveBeenCalled();
    provider.dispose();
  });
});

it("the Files picker chooses an existing directory with the native provider's parent", async () => {
  const showOpenDialog = vi.fn(async (_parent: unknown, _options: unknown) => ({
    canceled: false,
    filePaths: ["/Users/me/Chosen folder"],
  }));
  const { client, provider, native } = await fixture({ showOpenDialog });
  client.emit(
    "shell.provider.call",
    call("shell-workspaceaaaaaaaa", "shell.dialog.pickFolder", { purpose: "workspace.export" }),
  );
  await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalledOnce());
  expect(showOpenDialog.mock.calls[0]?.[1]).toEqual({
    title: "Choose a folder for Files",
    buttonLabel: "Choose Folder",
    properties: ["openDirectory"],
  });
  expect(native.parentWindow).toHaveBeenCalledOnce();
  await vi.waitFor(() =>
    expect(client.requests).toContainEqual({
      method: "shell.provider.resolve",
      params: {
        callId: "shell-workspaceaaaaaaaa",
        outcome: { result: { canceled: false, path: "/Users/me/Chosen folder" } },
      },
    }),
  );
  provider.dispose();
});

// MA-3c (MA-D10 (b); L11 as ruled: an owed capture runs at the next open on this desktop, and there
// is no window-show event). MA-1a's capture schema carries `allowHosts` in and `digest` out, and the
// provider parses both ends with it, so every row here is a PIN: it passes on the red skeleton and
// holds the provider's half of the slice — allowHosts reach the native capture exactly as fieldd
// validated them, a digest only in its contract grammar, and the hidden-window refusal unchanged.
describe("MA-3c — a made app's capture through the provider", () => {
  const MADE_PARAMS = {
    artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    url: "https://host.tail1234.ts.net:14211/",
    allowHosts: ["cdn.jsdelivr.net", "fonts.gstatic.com"],
  };
  const DIGEST = "9f2c4be1a07d3e5f6c8b1a2d4e6f8091a3b5c7d9e1f20314253647586970a1b2";

  it("PIN: hands a made capture's allowHosts to the native capture exactly, and answers its digest", async () => {
    const captureArtifactPreview = vi.fn<ShellProviderNative["captureArtifactPreview"]>(
      async () => ({ captured: true as const, title: "Made app", digest: DIGEST }),
    );
    const { client, provider } = await fixture({ captureArtifactPreview });
    const callId = "shell-madecaptureaaaaaa";
    client.emit(
      "shell.provider.call",
      call(callId, "shell.webcontents.captureArtifactPreview", MADE_PARAMS),
    );
    await vi.waitFor(() =>
      expect(client.requests, "the provider's answer").toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId,
          outcome: { result: { captured: true, title: "Made app", digest: DIGEST } },
        },
      }),
    );
    expect(captureArtifactPreview, "the native capture's params").toHaveBeenCalledExactlyOnceWith(
      MADE_PARAMS,
      expect.any(AbortSignal),
    );
    provider.dispose();
  });

  it("PIN: refuses allowHosts outside MadeAppReach before any capture work", async () => {
    const captureArtifactPreview = vi.fn(async () => ({ captured: true as const }));
    const { client, provider } = await fixture({ captureArtifactPreview });
    const refused: unknown[] = [
      ["https://cdn.jsdelivr.net"], // a scheme
      ["cdn.jsdelivr.net:443"], // a port
      ["cdn.jsdelivr.net/npm"], // a path
      ["*.jsdelivr.net"], // a wildcard
      ["CDN.jsdelivr.net"], // not canonical
      ["104.16.85.20"], // an IP literal
      ["other.tail1234.ts.net"], // a tailnet name
      [""], // empty
      Array.from({ length: 17 }, (_, index) => `h${index}.example.com`), // past REACH_HOSTS
      "cdn.jsdelivr.net", // not a list
    ];
    const callIds = refused.map(
      (_, index) => `shell-madehostsrefused${String(index).padStart(2, "0")}`,
    );
    refused.forEach((allowHosts, index) => {
      client.emit(
        "shell.provider.call",
        call(callIds[index] ?? "", "shell.webcontents.captureArtifactPreview", {
          ...MADE_PARAMS,
          allowHosts,
        }),
      );
    });
    await vi.waitFor(() =>
      expect(
        callIds.map((callId) =>
          client.requests.some(
            (request) =>
              request.method === "shell.provider.resolve" &&
              (request.params as { callId?: string }).callId === callId,
          ),
        ),
        "every refused call is answered",
      ).toEqual(callIds.map(() => true)),
    );
    for (const callId of callIds) {
      expect(client.requests, `the answer to ${callId}`).toContainEqual({
        method: "shell.provider.resolve",
        params: { callId, outcome: { error: expect.objectContaining({ retryable: false }) } },
      });
    }
    expect(captureArtifactPreview, "the native capture").not.toHaveBeenCalled();
    provider.dispose();
  });

  it("PIN: refuses a native digest that is not lowercase sha256 hex, and never forwards it", async () => {
    const captureArtifactPreview = vi
      .fn<ShellProviderNative["captureArtifactPreview"]>()
      .mockResolvedValueOnce({ captured: true, digest: DIGEST.toUpperCase() })
      .mockResolvedValueOnce({ captured: true, digest: DIGEST.slice(0, 40) });
    const { client, provider } = await fixture({ captureArtifactPreview });
    const callIds = ["shell-madedigestupperaaa", "shell-madedigestshortaaa"];
    for (const callId of callIds) {
      client.emit(
        "shell.provider.call",
        call(callId, "shell.webcontents.captureArtifactPreview", MADE_PARAMS),
      );
      await vi.waitFor(() =>
        expect(client.requests, `the answer to ${callId}`).toContainEqual({
          method: "shell.provider.resolve",
          params: { callId, outcome: { error: expect.objectContaining({ retryable: false }) } },
        }),
      );
    }
    const sent = JSON.stringify(client.requests);
    expect(sent.includes(DIGEST.toUpperCase()), "the upper-case digest reached fieldd").toBe(false);
    expect(sent.includes(DIGEST.slice(0, 40)), "the short digest reached fieldd").toBe(false);
    provider.dispose();
  });

  it("PIN: a made capture still refuses while the window is hidden, and a show tells fieldd nothing (L11)", async () => {
    const captureArtifactPreview = vi.fn(async () => ({ captured: true as const }));
    const hidden = fakeWindow(false);
    const { client, provider } = await fixture({
      parentWindow: () => hidden,
      captureArtifactPreview,
    });
    const callId = "shell-madehiddenaaaaaaa";
    client.emit(
      "shell.provider.call",
      call(callId, "shell.webcontents.captureArtifactPreview", MADE_PARAMS),
    );
    await vi.waitFor(() =>
      expect(client.requests, "the hidden window's answer").toContainEqual({
        method: "shell.provider.resolve",
        params: {
          callId,
          outcome: {
            error: {
              kind: "UNAVAILABLE",
              message: "preview capture is unavailable",
              retryable: true,
            },
          },
        },
      }),
    );
    expect(captureArtifactPreview, "the native capture").not.toHaveBeenCalled();
    // L11 has no show event: the provider holds no listener for one, so nothing can answer a show
    // later. Counted, not waited for.
    const windowEvents = hidden as unknown as EventEmitter;
    expect(
      { show: windowEvents.listenerCount("show"), restore: windowEvents.listenerCount("restore") },
      "the provider's listeners for a show on the window",
    ).toEqual({ show: 0, restore: 0 });
    const before = client.requests.length;
    windowEvents.emit("show");
    windowEvents.emit("restore");
    expect(client.requests.slice(before), "what a show sent fieldd").toEqual([]);
    expect(
      client.requests.map((request) => request.method),
      "every request the provider made",
    ).toEqual(["shell.provider.register", "shell.provider.resolve"]);
    provider.dispose();
  });
});
