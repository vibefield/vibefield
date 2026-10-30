import { EventEmitter } from "node:events";
import { join } from "node:path";
import { SHELL_PROVIDER_METHODS } from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { createNoopLogger } from "@vibefield/logging";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { FielddHandleCoordinator } from "../src/main/fieldd-handle-coordinator";
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
    | "shell.revealPath"
    | "shell.webcontents.captureArtifactPreview"
    | "shell.renderer.requestReplacement"
    | "shell.surfaces.simulatorDevices",
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

async function fixture(nativeOverrides?: Partial<ShellProviderNative>) {
  const client = new FakeClient();
  const handle = fakeHandle("boot-1", client);
  const coordinator = new FielddHandleCoordinator(
    vi.fn(async () => handle) as unknown as FielddSupervisor["ensure"],
  );
  const parent = fakeWindow();
  const native: ShellProviderNative = {
    parentWindow: vi.fn(() => parent),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
    documentsPath: vi.fn(() => "/Users/test/Documents"),
    openExternal: vi.fn(async () => undefined),
    revealPath: vi.fn(),
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
  const provider = new RecoveringShellProvider(coordinator, native, createNoopLogger());
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
      const coordinator = new FielddHandleCoordinator(
        vi.fn(async () => fakeHandle("boot-1", client)) as unknown as FielddSupervisor["ensure"],
      );
      const native: ShellProviderNative = {
        parentWindow: () => fakeWindow(),
        showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
        showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
        documentsPath: () => "/Users/test/Documents",
        openExternal: vi.fn(async () => undefined),
        revealPath: vi.fn(),
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
    const coordinator = new FielddHandleCoordinator(
      vi
        .fn()
        .mockResolvedValueOnce(handles[0])
        .mockResolvedValueOnce(handles[1]) as unknown as FielddSupervisor["ensure"],
    );
    const native: ShellProviderNative = {
      parentWindow: () => fakeWindow(),
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
      documentsPath: () => "/Users/test/Documents",
      openExternal: vi.fn(async () => undefined),
      revealPath: vi.fn(),
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
