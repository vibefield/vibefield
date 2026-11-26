import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("item 517: holds fieldd's captures to one at a time, as Electron's provider does", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    const calls = () => lane.notifications.filter((n) => n.method === "shell.provider.call");
    const settle = async () => {
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    };
    // a live artifact's capture and a made app's, asked by their two services at once
    const first = broker.callInternal("shell.webcontents.captureArtifactPreview", {
      artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      url: "https://host.tail1234.ts.net:12000/",
    });
    const second = broker.callInternal("shell.webcontents.captureArtifactPreview", {
      artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      url: "https://host.tail1234.ts.net:12001/",
    });
    await settle();
    expect(calls()).toHaveLength(1);
    expect(
      broker.resolve(shellContext(), lane, {
        callId: notificationCallId(lane, 0),
        outcome: { result: { captured: true } },
      }),
    ).toEqual({ accepted: true });
    await expect(first).resolves.toEqual({ captured: true });
    await settle();
    expect(calls()).toHaveLength(2);
    expect(calls()[1]).toMatchObject({
      params: { params: { artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAW" } },
    });
    broker.resolve(shellContext(), lane, {
      callId: notificationCallId(lane, 1),
      outcome: { result: { captured: true } },
    });
    await expect(second).resolves.toEqual({ captured: true });
  });

  it("EY-1: a provider error's details reach the waiting call as the fixture says them, and none when it says none", async () => {
    const outcome = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../contracts/fixtures/shell-provider-outcome.pages-unavailable.json",
        ),
        "utf8",
      ),
    ) as { error: { details: unknown } };
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    const said = broker.call(pluginContext(), "shell.dialog.pickFolder", {
      purpose: "artifact.publish",
    });
    expect(
      broker.resolve(shellContext(), lane, { callId: notificationCallId(lane, 0), outcome }),
    ).toEqual({ accepted: true });
    await expect(said).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: outcome.error.details,
    });
    const bare = broker.call(pluginContext(), "shell.dialog.pickFolder", {
      purpose: "artifact.publish",
    });
    broker.resolve(shellContext(), lane, {
      callId: notificationCallId(lane, 1),
      outcome: { error: { kind: "UNAVAILABLE", message: "unavailable", retryable: true } },
    });
    const error = await bare.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RpcCallError);
    expect((error as RpcCallError).details).toBeUndefined();
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

  it("item 588: tells each new registration once, never a repeat on the same transport, and again after a loss", () => {
    const broker = new ShellProviderBroker();
    let told = 0;
    const stop = broker.onRegistered(() => {
      told += 1;
    });
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    expect(told, "a shell that can draw is here").toBe(1);
    broker.register(shellContext(), lane, { methods: METHODS });
    expect(told, "a repeat on the same transport is not new").toBe(1);
    expect(() => broker.register(shellContext(), transport(), { methods: METHODS })).toThrow(
      /already connected/,
    );
    expect(told, "a refused registration tells nothing").toBe(1);
    broker.withdraw(lane);
    const next = transport();
    broker.register(shellContext(), next, { methods: METHODS });
    expect(told, "a provider after a loss is new").toBe(2);
    stop();
    broker.withdraw(next);
    broker.register(shellContext(), transport(), { methods: METHODS });
    expect(told, "a stopped listener hears nothing").toBe(2);
  });

  it("item 588: a listener that throws never refuses the shell's registration, nor silences the others", () => {
    const broker = new ShellProviderBroker();
    broker.onRegistered(() => {
      throw new Error("scripted listener failure");
    });
    let told = 0;
    broker.onRegistered(() => {
      told += 1;
    });
    expect(broker.register(shellContext(), transport(), { methods: METHODS })).toEqual({
      registered: [...METHODS],
    });
    expect(told).toBe(1);
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

  it("MA-D16: holds a made app's local open to an app and a digest before main is asked, never a path", async () => {
    const broker = new ShellProviderBroker();
    const lane = transport();
    broker.register(shellContext(), lane, { methods: METHODS });
    const appId = "a".repeat(64);
    const digest = "b".repeat(64);
    for (const params of [
      {},
      { appId },
      { appId, digest: "../../../etc/passwd" },
      { appId: "../x", digest },
      { appId: appId.toUpperCase(), digest },
      { path: "/tmp/page.html" },
    ]) {
      await expect(
        broker.callInternal("shell.openMadeApp", params as never),
        JSON.stringify(params),
      ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    }
    expect(lane.notifications).toEqual([]);

    const before = Date.now();
    const opening = broker.callInternal("shell.openMadeApp", { appId, digest });
    expect(lane.notifications[0]).toMatchObject({
      method: "shell.provider.call",
      params: {
        method: "shell.openMadeApp",
        params: { appId, digest },
        caller: { kind: "local-token", clientKind: "fieldd" },
      },
    });
    // the same OS hand-off as openLink, with the same five seconds
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
