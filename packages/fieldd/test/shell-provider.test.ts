import { type CallerContext, SHELL_PROVIDER_METHODS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import { ShellProviderBroker, type ShellProviderTransport } from "../src/shell-provider";

function shellContext(): CallerContext {
  return {
    principal: { kind: "shell-main", tokenId: "tk_shell", scopes: [] },
    transport: "ws-loopback",
    receivedAt: Date.now(),
    clientKind: "shell-main",
  };
}

function pluginContext(signal?: AbortSignal): CallerContext {
  return {
    principal: { kind: "plugin", id: "vibefield.browser", scopes: ["shell.open"] },
    transport: "ws-loopback",
    receivedAt: Date.now(),
    clientKind: "renderer",
    ...(signal !== undefined ? { signal } : {}),
  };
}

function transport(): ShellProviderTransport & {
  notifications: Array<{ method: string; params: unknown }>;
  live: boolean;
} {
  const value = {
    identity: {},
    notifications: [] as Array<{ method: string; params: unknown }>,
    live: true,
    notify(method: "shell.provider.call" | "shell.provider.cancel", params: unknown) {
      if (!value.live) return false;
      value.notifications.push({ method, params });
      return true;
    },
  };
  return value;
}

const METHODS = SHELL_PROVIDER_METHODS;

function notificationCallId(lane: ReturnType<typeof transport>, index: number): string {
  const params = lane.notifications.at(index)?.params;
  if (typeof params !== "object" || params === null || !("callId" in params)) {
    throw new Error("missing shell provider call notification");
  }
  return String(params.callId);
}

describe("ShellProviderBroker", () => {
  it("requires the bound shell principal and the exact static method set", () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    expect(() => broker.register(pluginContext(), lane, { methods: METHODS })).toThrowError(
      RpcCallError,
    );
    expect(() =>
      broker.register(shellContext(), lane, { methods: ["shell.openExternal"] }),
    ).toThrowError(/match the enabled static method set/);
    expect(broker.register(shellContext(), lane, { methods: METHODS })).toEqual({
      registered: [...METHODS],
    });
    expect(broker.register(shellContext(), lane, { methods: METHODS })).toEqual({
      registered: [...METHODS],
    });
    expect(() => broker.register(shellContext(), transport(), { methods: METHODS })).toThrowError(
      /already connected/,
    );
  });

  it("dispatches sanitized caller facts and validates a successful result", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    const result = broker.call(pluginContext(), "shell.openExternal", {
      url: "https://host.example.ts.net:12000/",
    });
    const notification = lane.notifications[0];
    expect(notification).toMatchObject({
      method: "shell.provider.call",
      params: {
        method: "shell.openExternal",
        caller: { kind: "plugin", pluginId: "vibefield.browser", clientKind: "renderer" },
      },
    });
    const callId = notificationCallId(lane, 0);
    expect(
      broker.resolve(shellContext(), lane, {
        callId,
        outcome: { result: { opened: true } },
      }),
    ).toEqual({ accepted: true });
    await expect(result).resolves.toEqual({ opened: true });
  });

  it("dispatches bounded preview capture only through the internal broker door", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    expect(broker.provides("shell.webcontents.captureArtifactPreview")).toBe(false);
    broker.register(shellContext(), lane, { methods: METHODS });
    expect(broker.provides("shell.webcontents.captureArtifactPreview")).toBe(true);
    const result = broker.callInternal("shell.webcontents.captureArtifactPreview", {
      artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      url: "https://host.tail1234.ts.net:12000/",
    });
    expect(lane.notifications[0]).toMatchObject({
      method: "shell.provider.call",
      params: {
        method: "shell.webcontents.captureArtifactPreview",
        caller: { kind: "local-token", clientKind: "fieldd" },
      },
    });
    const callId = notificationCallId(lane, 0);
    expect(
      broker.resolve(shellContext(), lane, {
        callId,
        outcome: { result: { captured: true, title: "Workbench" } },
      }),
    ).toEqual({ accepted: true });
    await expect(result).resolves.toEqual({ captured: true, title: "Workbench" });
    await expect(
      broker.callInternal("shell.webcontents.captureArtifactPreview", {
        artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        url: "https://evil.example:12000/",
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    broker.withdraw(lane);
    expect(broker.provides("shell.webcontents.captureArtifactPreview")).toBe(false);
  });

  it("rejects provider loss and ignores its late answer", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    const result = broker.call(pluginContext(), "shell.dialog.pickFolder", {
      purpose: "artifact.publish",
    });
    const callId = notificationCallId(lane, 0);
    broker.withdraw(lane);
    await expect(result).rejects.toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(
      broker.resolve(shellContext(), lane, {
        callId,
        outcome: { result: { canceled: true } },
      }),
    ).toEqual({ accepted: false });
  });

  it("keeps pending ownership across idempotent same-transport registration", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    const result = broker.call(pluginContext(), "shell.dialog.pickFolder", {
      purpose: "artifact.publish",
    });
    broker.register(shellContext(), lane, { methods: METHODS });
    broker.withdraw(lane);
    await expect(result).rejects.toMatchObject({ kind: "UNAVAILABLE", retryable: true });
  });

  it("refuses a shell dispatch from a non-loopback caller even with scope", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    await expect(
      broker.call({ ...pluginContext(), transport: "ws-tailnet" }, "shell.openExternal", {
        url: "https://host.example.ts.net:12000/",
      }),
    ).rejects.toMatchObject({ kind: "FORBIDDEN_SCOPE" });
    expect(lane.notifications).toEqual([]);
  });

  it("cancels on caller loss and never accepts malformed provider output", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    const controller = new AbortController();
    const abandoned = broker.call(pluginContext(controller.signal), "shell.dialog.pickFolder", {
      purpose: "artifact.publish",
    });
    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    expect(lane.notifications.at(-1)?.method).toBe("shell.provider.cancel");

    const invalid = broker.call(pluginContext(), "shell.openExternal", {
      url: "https://host.example.ts.net:12000/",
    });
    const callId = notificationCallId(lane, -1);
    broker.resolve(shellContext(), lane, { callId, outcome: { result: { opened: false } } });
    await expect(invalid).rejects.toMatchObject({ kind: "INTERNAL", retryable: false });
  });

  it("GT-7: holds the file dialogs to their contracts — one purpose, a bare name, an absolute answer", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    // refused before main is ever asked
    await expect(
      broker.callInternal("shell.dialog.pickFile", { purpose: "artifact.publish" }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    await expect(
      broker.callInternal("shell.dialog.saveFile", {
        purpose: "terminal.config.export",
        defaultName: "../../.zshrc",
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(lane.notifications).toEqual([]);

    // a visible dialog has no theater deadline; and a RELATIVE answer never
    // reaches the service that would write there (it would resolve against
    // fieldd's own working directory)
    const saving = broker.callInternal("shell.dialog.saveFile", {
      purpose: "terminal.config.export",
      defaultName: "config.ghostty",
    });
    expect(lane.notifications[0]).toMatchObject({
      method: "shell.provider.call",
      params: {
        method: "shell.dialog.saveFile",
        caller: { kind: "local-token", clientKind: "fieldd" },
        deadlineAt: Number.MAX_SAFE_INTEGER,
      },
    });
    broker.resolve(shellContext(), lane, {
      callId: notificationCallId(lane, 0),
      outcome: { result: { canceled: false, path: "exports/config.ghostty" } },
    });
    await expect(saving).rejects.toMatchObject({ kind: "INTERNAL", retryable: false });
  });

  it("GT-8a: holds a terminal link to its contract before main is asked, and bounds the hand-off", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    // refused before main is ever asked: a scheme main must never open, the
    // spelling fieldd's door always canonicalizes, credentials, a file
    for (const url of [
      "mailto:team@example.com",
      "https://example.com",
      "https://user:pass@example.com/",
      "file:///tmp/run.command",
    ]) {
      await expect(broker.callInternal("shell.openLink", { url }), url).rejects.toMatchObject({
        kind: "PRECONDITION_FAILED",
      });
    }
    expect(lane.notifications).toEqual([]);

    const before = Date.now();
    const opening = broker.callInternal("shell.openLink", { url: "http://localhost:3000/x" });
    expect(lane.notifications[0]).toMatchObject({
      method: "shell.provider.call",
      params: {
        method: "shell.openLink",
        params: { url: "http://localhost:3000/x" },
        caller: { kind: "local-token", clientKind: "fieldd" },
      },
    });
    // the same OS hand-off as openExternal, with the same five seconds
    const notified = lane.notifications[0]?.params as { deadlineAt?: number } | undefined;
    const deadlineAt = notified?.deadlineAt ?? Number.NaN;
    expect(deadlineAt).toBeGreaterThanOrEqual(before + 5_000);
    expect(deadlineAt).toBeLessThanOrEqual(Date.now() + 5_000);
    broker.resolve(shellContext(), lane, {
      callId: notificationCallId(lane, 0),
      outcome: { result: { opened: true } },
    });
    await expect(opening).resolves.toEqual({ opened: true });
  });
});
