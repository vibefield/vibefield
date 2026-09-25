// GT-8a — terminal links (GT-D22): fieldd's policy door for `terminal.link.open`.
// The policy is driven directly (both platforms' file URLs, from any host); the
// door over a scripted shell and a recording audit; and one daemon-level run
// through the real broker, a fake Electron main and the audit on disk — so the
// rows that say "main is never asked" watch the channel main listens on.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CallerContext,
  SHELL_PROVIDER_METHODS,
  ShellProviderCallParams,
  SOCKETS,
  TerminalLinkOpenResult,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AuditMutation, AuditMutationOutcome } from "../src/audit-service";
import { bootstrap, type FielddDaemon, verifyAuditSegment } from "../src/index";
import { RpcCallError } from "../src/native-link";
import {
  createTerminalLinkDoor,
  type TerminalLinkAudit,
  type TerminalLinkShell,
  terminalLinkTarget,
} from "../src/terminal-links";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.reverse()) {
    try {
      await dispose();
    } catch {
      /* already-stopped daemons and dead sockets are fine */
    }
  }
  cleanup = [];
});

// Built, never typed: an invisible character in the source is its own hazard.
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const BELL = String.fromCodePoint(0x07);

describe("GT-D22 — what one terminal link may do", () => {
  it("opens http and https, in the URL standard's own spelling", () => {
    expect(terminalLinkTarget("http://localhost:3000/x")).toEqual({
      kind: "web",
      scheme: "http",
      url: "http://localhost:3000/x",
    });
    // what the browser receives is the standard's spelling, never the text as typed
    expect(terminalLinkTarget("https://example.com")).toEqual({
      kind: "web",
      scheme: "https",
      url: "https://example.com/",
    });
    expect(terminalLinkTarget("HTTPS://Example.COM/a?q=1#top")).toEqual({
      kind: "web",
      scheme: "https",
      url: "https://example.com/a?q=1#top",
    });
    expect(terminalLinkTarget("https://bücher.example/")).toMatchObject({
      url: "https://xn--bcher-kva.example/",
    });
    expect(terminalLinkTarget("http://[::1]:5173/")).toMatchObject({
      kind: "web",
      url: "http://[::1]:5173/",
    });
  });

  it("SHOWS a local file and never hands it to the browser — an app, a .command, a folder", () => {
    expect(terminalLinkTarget("file:///Applications/Calculator.app", "darwin")).toEqual({
      kind: "file",
      path: "/Applications/Calculator.app",
    });
    expect(terminalLinkTarget("file:///tmp/my%20project/source.ts#L42", "darwin")).toEqual({
      kind: "file",
      path: "/tmp/my project/source.ts",
    });
    expect(terminalLinkTarget("file://localhost/tmp/run.command", "darwin")).toEqual({
      kind: "file",
      path: "/tmp/run.command",
    });
    // Windows' own spelling, decoded the way Windows decodes it — from any host
    expect(terminalLinkTarget("file:///C:/Users/me/My%20Docs/a.ts", "win32")).toEqual({
      kind: "file",
      path: "C:\\Users\\me\\My Docs\\a.ts",
    });
  });

  it("refuses every other scheme", () => {
    for (const raw of [
      "mailto:team@example.com",
      "ftp://example.com/",
      "ftps://example.com/",
      "javascript:alert(1)",
      "data:text/html,hi",
      "vscode://file/tmp/source.ts",
      "x-man-page://ls",
      "ssh://host.example",
      "smb://host.example/share",
    ]) {
      // refused by the scheme rule itself, not only by the web contract behind it
      expect(terminalLinkTarget(raw, "darwin"), raw).toEqual({
        kind: "refused",
        reason: "only web links (http, https) and file links do anything from a terminal",
      });
    }
  });

  it("refuses a web link with credentials, or past the bound once percent-encoded", () => {
    for (const raw of [
      "https://user:pass@example.com/",
      "https://user@example.com/",
      "http://:secret@localhost:3000/",
    ]) {
      expect(terminalLinkTarget(raw), raw).toMatchObject({ kind: "refused" });
    }
    // 3000 characters as typed, 18000 once the standard encodes them
    const long = `https://example.com/${"é".repeat(3000)}`;
    expect(long.length).toBeLessThan(8192);
    expect(terminalLinkTarget(long)).toMatchObject({ kind: "refused" });
  });

  it("refuses what the parser would repair, before anything is parsed", () => {
    for (const raw of [
      `https://exa${ZERO_WIDTH_SPACE}mple.com/`,
      `https://example.com/${BELL}`,
      " https://example.com/",
      "https://example.com/a b",
      "https://example.com\\@evil.example/",
      `file:///tmp/${RIGHT_TO_LEFT_OVERRIDE}gnp.command`,
      "file:///tmp/a b",
    ]) {
      expect(terminalLinkTarget(raw, "darwin"), JSON.stringify(raw)).toMatchObject({
        kind: "refused",
      });
    }
    // the reason for the rule: repaired, the first would have opened example.com
    expect(new URL(`https://exa${ZERO_WIDTH_SPACE}mple.com/`).href).toBe("https://example.com/");
  });

  it("refuses a file link that names no absolute path on this device", () => {
    const cases: Array<[string, NodeJS.Platform]> = [
      // the standard reads this as /relative.ts: a name promoted to the root
      ["file:relative.ts", "darwin"],
      ["file:/tmp/source.ts", "darwin"],
      // another machine's path
      ["file://workstation/tmp/source.ts", "darwin"],
      // a UNC path: revealing it is a network connection to that host
      ["file://server/share/a.txt", "win32"],
      // an encoded separator
      ["file:///tmp/a%2Fb", "darwin"],
      // no drive on Windows
      ["file:///tmp/source.ts", "win32"],
      // what the decoding would put in a name: a NUL, a newline, an override
      ["file:///tmp/%00x", "darwin"],
      ["file:///tmp/%0Anext.command", "darwin"],
      ["file:///tmp/%E2%80%AEgnp.command", "darwin"],
      // past the path bound (4096) while inside the link bound (8192)
      [`file:///${"a/".repeat(2100)}x`, "darwin"],
    ];
    for (const [raw, platform] of cases) {
      expect(terminalLinkTarget(raw, platform), `${platform} ${raw.slice(0, 60)}`).toMatchObject({
        kind: "refused",
      });
    }
  });

  it("refuses what is not an absolute URL at all", () => {
    for (const raw of ["", "not a link", "/tmp/source.ts", "example.com", "http://"]) {
      expect(terminalLinkTarget(raw), JSON.stringify(raw)).toMatchObject({ kind: "refused" });
    }
  });
});

/** Main's two doors as a script: every call kept, each answered as main does. */
function scriptedShell(
  fail?: RpcCallError,
): TerminalLinkShell & { calls: Array<{ door: string; params: unknown }> } {
  const calls: Array<{ door: string; params: unknown }> = [];
  return {
    calls,
    openLink: async (params) => {
      calls.push({ door: "openLink", params });
      if (fail !== undefined) throw fail;
      return { opened: true };
    },
    revealPath: async (params) => {
      calls.push({ door: "revealPath", params });
      if (fail !== undefined) throw fail;
      return { revealed: true };
    },
  };
}

/** attempt → effect → outcome, recorded rather than written. */
function recordingAudit(): TerminalLinkAudit & {
  entries: Array<{ mutation: AuditMutation; outcome?: AuditMutationOutcome; failed?: unknown }>;
} {
  const entries: Array<{
    mutation: AuditMutation;
    outcome?: AuditMutationOutcome;
    failed?: unknown;
  }> = [];
  return {
    entries,
    async required(_ctx, mutation, effect, describe) {
      const entry: (typeof entries)[number] = { mutation };
      entries.push(entry);
      try {
        const value = await effect();
        entry.outcome = describe?.(value) ?? {};
        return value;
      } catch (error) {
        entry.failed = error;
        throw error;
      }
    },
  };
}

function windowContext(transport: CallerContext["transport"] = "ws-loopback"): CallerContext {
  return {
    principal: { kind: "local-token", tokenId: "tk_window", scopes: ["terminal.link"] },
    transport,
    receivedAt: Date.now(),
    clientKind: "renderer",
  };
}

/** The refusal a call settles with — a failed row if it resolved instead. */
async function refusalOf(promise: Promise<unknown>): Promise<RpcCallError> {
  const outcome = await promise.then(
    (value: unknown) => ({ settled: "resolved" as const, value }),
    (error: unknown) => ({ settled: "rejected" as const, error }),
  );
  if (outcome.settled === "resolved") {
    throw new Error(`expected a refusal, got ${JSON.stringify(outcome.value)}`);
  }
  expect(outcome.error).toBeInstanceOf(RpcCallError);
  return outcome.error as RpcCallError;
}

describe("the terminal.link.open door", () => {
  it("opens a web link through shell.openLink, audited by opener and scheme alone", async () => {
    const shell = scriptedShell();
    const audit = recordingAudit();
    const door = createTerminalLinkDoor({ shell, audit, platform: "darwin" });
    const link = "HTTPS://example.com/private?token=secret-7f3a";
    expect(TerminalLinkOpenResult.parse(await door(windowContext(), { url: link }))).toEqual({
      outcome: "opened",
    });
    expect(shell.calls).toEqual([
      { door: "openLink", params: { url: "https://example.com/private?token=secret-7f3a" } },
    ]);
    expect(audit.entries).toEqual([
      {
        mutation: {
          action: "terminal.link.open",
          target: { kind: "shell-operation", id: "system-browser" },
          attrs: { scheme: "https" },
        },
        outcome: { outcome: "succeeded" },
      },
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain("secret-7f3a");
    expect(JSON.stringify(audit.entries)).not.toContain("example.com");
  });

  it("reveals a file link in the file manager and never opens it", async () => {
    const shell = scriptedShell();
    const audit = recordingAudit();
    const door = createTerminalLinkDoor({ shell, audit, platform: "darwin" });
    expect(await door(windowContext(), { url: "file:///Applications/Calculator.app" })).toEqual({
      outcome: "revealed",
    });
    expect(shell.calls).toEqual([
      { door: "revealPath", params: { path: "/Applications/Calculator.app" } },
    ]);
    expect(audit.entries.map((entry) => entry.mutation)).toEqual([
      {
        action: "terminal.link.open",
        target: { kind: "shell-operation", id: "file-manager" },
        attrs: { scheme: "file" },
      },
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain("Calculator");
  });

  it("refuses a link the policy will not open before the audit and before main", async () => {
    const shell = scriptedShell();
    const audit = recordingAudit();
    const door = createTerminalLinkDoor({ shell, audit, platform: "darwin" });
    for (const url of [
      "mailto:team@example.com",
      "https://user:pass@example.com/",
      "file:relative.ts",
      "file://workstation/tmp/source.ts",
    ]) {
      const refusal = await refusalOf(door(windowContext(), { url }));
      expect(refusal.kind, url).toBe("PRECONDITION_FAILED");
      expect(refusal.message, url).toMatch(/^terminal link refused: /);
      // the refusal names the rule, never the link
      expect(refusal.message, url).not.toContain(url);
    }
    expect(shell.calls).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("refuses a malformed call the same way", async () => {
    const shell = scriptedShell();
    const audit = recordingAudit();
    const door = createTerminalLinkDoor({ shell, audit });
    for (const params of [undefined, {}, { url: 42 }, { url: "" }, { url: "x".repeat(8193) }]) {
      expect((await refusalOf(door(windowContext(), params))).kind).toBe("PRECONDITION_FAILED");
    }
    expect(shell.calls).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("refuses a caller off this machine, whatever it holds — the broker's own posture", async () => {
    const shell = scriptedShell();
    const audit = recordingAudit();
    const door = createTerminalLinkDoor({ shell, audit });
    for (const transport of ["ws-tailnet", "inproc-port", "uds"] as const) {
      const refusal = await refusalOf(
        door(windowContext(transport), { url: "https://example.com/" }),
      );
      expect(refusal.kind, transport).toBe("FORBIDDEN_SCOPE");
    }
    expect(shell.calls).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("records main's failure as the audited outcome, never a success", async () => {
    const unavailable = new RpcCallError(
      "UNAVAILABLE",
      "desktop shell provider is unavailable",
      true,
    );
    const shell = scriptedShell(unavailable);
    const audit = recordingAudit();
    const door = createTerminalLinkDoor({ shell, audit });
    expect((await refusalOf(door(windowContext(), { url: "https://example.com/" }))).kind).toBe(
      "UNAVAILABLE",
    );
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.failed).toBe(unavailable);
    expect(audit.entries[0]?.outcome).toBeUndefined();
  });
});

async function openRpc(daemon: FielddDaemon, token: string, clientKind: string): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, token, clientKind);
  return rpc;
}

function providerCalls(rpc: WsRpc): ShellProviderCallParams[] {
  return rpc.notifications
    .filter((notification) => notification.method === "shell.provider.call")
    .map((notification) => ShellProviderCallParams.parse(notification.params));
}

/** Answer the `index`th provider call once it arrives, the way main does. */
async function answerCall(
  shell: WsRpc,
  index: number,
  result: unknown,
): Promise<ShellProviderCallParams> {
  await until(() => providerCalls(shell).length > index);
  const call = providerCalls(shell)[index];
  if (call === undefined) throw new Error(`provider call ${index} never arrived`);
  await shell.call("shell.provider.resolve", { callId: call.callId, outcome: { result } });
  return call;
}

async function readAuditRecords(dataDir: string): Promise<AuditRecordV1[]> {
  const records: AuditRecordV1[] = [];
  const root = join(dataDir, "audit");
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const verified = await verifyAuditSegment(join(root, name));
    expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
    records.push(...verified.records);
  }
  return records;
}

describe("terminal.link.open through the daemon", () => {
  it("reaches Electron main's browser and file manager as fieldd, and audits neither link", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-links-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await native.start();
    cleanup.push(() => native.stop());
    const daemon = await bootstrap({ dataDir, controlPort: 0 });
    cleanup.push(() => daemon.stop());

    const shell = await openRpc(daemon, daemon.shellToken, "shell-main");
    await shell.call("shell.provider.register", { methods: [...SHELL_PROVIDER_METHODS] });
    // a window token as Electron main mints it: the door's own scope
    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["terminal.link"],
      label: "window-links",
      rendererParticipant: {
        participantId: "renderer:desktop-test:window-links",
        incarnation: "renderer:desktop-test:window-links:document-1",
      },
    })) as { token: string };
    const win = await openRpc(daemon, minted.token, "renderer");

    const webLink = "http://localhost:3000/callback?token=secret-7f3a";
    const opening = win.call("terminal.link.open", { url: webLink });
    const openCall = await answerCall(shell, 0, { opened: true });
    expect(openCall).toMatchObject({
      method: "shell.openLink",
      params: { url: webLink },
      // an internal door: main sees fieldd, never the window that clicked
      caller: { clientKind: "fieldd" },
    });
    // the browser hand-off is bounded, unlike a dialog a person answers
    expect(openCall.deadlineAt).toBeGreaterThan(Date.now());
    expect(openCall.deadlineAt).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(TerminalLinkOpenResult.parse(await opening)).toEqual({ outcome: "opened" });

    const windows = process.platform === "win32";
    const fileLink = windows
      ? "file:///C:/Users/me/Private%20Sites/run.command"
      : "file:///Users/me/Private%20Sites/run.command";
    const filePath = windows
      ? "C:\\Users\\me\\Private Sites\\run.command"
      : "/Users/me/Private Sites/run.command";
    const revealing = win.call("terminal.link.open", { url: fileLink });
    expect(await answerCall(shell, 1, { revealed: true })).toMatchObject({
      method: "shell.revealPath",
      params: { path: filePath },
      caller: { clientKind: "fieldd" },
    });
    expect(TerminalLinkOpenResult.parse(await revealing)).toEqual({ outcome: "revealed" });

    // refused before main is asked anything
    const refused = await win.callErr("terminal.link.open", { url: "mailto:team@example.com" });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(providerCalls(shell)).toHaveLength(2);

    // the scope gate: `shell.open` alone reaches nothing here — not in a window
    // that holds it beside the terminal's own scope, and not in a plugin that
    // was granted it (the ruling: a plugin must not reach this door unclicked)
    const shellOpenWindow = (await shell.call("system.mintWindowToken", {
      scopes: ["shell.open", "terminal.attach"],
      label: "window-shell-open",
      rendererParticipant: {
        participantId: "renderer:desktop-test:window-shell-open",
        incarnation: "renderer:desktop-test:window-shell-open:document-1",
      },
    })) as { token: string };
    const plugin = daemon.tokens.mint(["shell.open"], "browser-plugin", {
      pluginId: "vibefield.browser",
    });
    for (const [label, token] of [
      ["window", shellOpenWindow.token],
      ["plugin", plugin.token],
    ] as const) {
      const holder = await openRpc(daemon, token, "renderer");
      const forbidden = await holder.callErr("terminal.link.open", { url: webLink });
      expect(forbidden.data?.kind, label).toBe("FORBIDDEN_SCOPE");
      expect(forbidden.data?.details, label).toEqual({ required: "terminal.link" });
    }
    expect(providerCalls(shell)).toHaveLength(2);

    await daemon.stop();
    const records = (await readAuditRecords(dataDir)).filter(
      (record) => record.action === "terminal.link.open",
    );
    expect(records).toMatchObject([
      {
        phase: "attempt",
        target: { kind: "shell-operation", id: "system-browser" },
        attrs: { scheme: "http" },
      },
      { phase: "outcome", outcome: "succeeded" },
      {
        phase: "attempt",
        target: { kind: "shell-operation", id: "file-manager" },
        attrs: { scheme: "file" },
      },
      { phase: "outcome", outcome: "succeeded" },
    ]);
    const persisted = readdirSync(join(dataDir, "audit"))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => readFileSync(join(dataDir, "audit", name), "utf8"))
      .join("\n");
    for (const secret of ["secret-7f3a", "localhost:3000", "Private", "run.command", "mailto"]) {
      expect(persisted, secret).not.toContain(secret);
    }
  });
});
