import { EventEmitter } from "node:events";
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
      ? { registered: ["shell.dialog.pickFolder", "shell.openExternal"] }
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

function fakeWindow(): BrowserWindow {
  const emitter = new EventEmitter() as EventEmitter & { isDestroyed(): boolean };
  emitter.isDestroyed = () => false;
  return emitter as unknown as BrowserWindow;
}

function call(
  callId: string,
  method: "shell.dialog.pickFolder" | "shell.openExternal",
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
    openExternal: vi.fn(async () => undefined),
    ...nativeOverrides,
  };
  const provider = new RecoveringShellProvider(coordinator, native, createNoopLogger());
  await coordinator.ensure();
  await vi.waitFor(() =>
    expect(client.requests[0]).toEqual({
      method: "shell.provider.register",
      params: { methods: ["shell.dialog.pickFolder", "shell.openExternal"] },
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
          registered: ["shell.dialog.pickFolder", "shell.openExternal"],
        });
      const coordinator = new FielddHandleCoordinator(
        vi.fn(async () => fakeHandle("boot-1", client)) as unknown as FielddSupervisor["ensure"],
      );
      const native: ShellProviderNative = {
        parentWindow: () => fakeWindow(),
        showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
        openExternal: vi.fn(async () => undefined),
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
      openExternal: vi.fn(async () => undefined),
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
