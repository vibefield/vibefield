/**
 * GT-8 — a terminal link, from the window's one runtime to fieldd. The helper
 * asks fieldd's `terminal.link.open` and nothing else, and it never throws into
 * ghosttea's pointer handler: a refused link is an ordinary answer, logged
 * quietly by scheme and kind — never by the URL, which can carry a token. The
 * runtime's opener (GT-8b) asks for WEB links only: ghosttea's hook names no
 * session, so a file link cannot be told from a peer's path.
 */
import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRendererLogger,
  type RendererLogFields,
  type RendererLogger,
  type RendererLoggerBindings,
  setRendererLogger,
} from "../src/logging";
import {
  openTerminalLink,
  type TerminalLinkClient,
  terminalLinkOpener,
} from "../src/terminal/links";

interface LogLine {
  level: string;
  event: string;
  bindings: RendererLoggerBindings;
  attrs: RendererLogFields | undefined;
}

function recordingLogger(lines: LogLine[], bindings: RendererLoggerBindings = {}): RendererLogger {
  const at =
    (level: string) =>
    (event: string, _message: string, third?: unknown, fourth?: RendererLogFields): void => {
      // error/fatal carry the error third; the rest carry attrs there
      const attrs =
        level === "error" || level === "fatal" ? fourth : (third as RendererLogFields | undefined);
      lines.push({ level, event, bindings, attrs });
    };
  return {
    child: (child) => recordingLogger(lines, { ...bindings, ...child }),
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    fatal: at("fatal"),
    isLevelEnabled: () => true,
  };
}

function client(answer: () => Promise<unknown>): TerminalLinkClient & {
  calls: Array<{ method: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    request: (method, params) => {
      calls.push({ method, params });
      return answer();
    },
  };
}

let previous: RendererLogger;
let lines: LogLine[];

beforeEach(() => {
  previous = getRendererLogger();
  lines = [];
  setRendererLogger(recordingLogger(lines));
});

afterEach(() => {
  setRendererLogger(previous);
});

describe("openTerminalLink", () => {
  it("asks fieldd's link door with the URL exactly as ghosttea handed it", async () => {
    const fieldd = client(() => Promise.resolve({ outcome: "opened" }));
    await expect(openTerminalLink(fieldd, "http://localhost:3000/x")).resolves.toBeUndefined();
    expect(fieldd.calls).toEqual([
      { method: "terminal.link.open", params: { url: "http://localhost:3000/x" } },
    ]);
    expect(lines).toEqual([]);
  });

  it("swallows a refusal and logs it by scheme and kind, never by the URL", async () => {
    const fieldd = client(() =>
      Promise.reject(
        new FielddRpcError("PRECONDITION_FAILED", "terminal link refused: only web links", false),
      ),
    );
    const link = "mailto:someone@example.com?subject=token-9c2e";
    await expect(openTerminalLink(fieldd, link)).resolves.toBeUndefined();
    expect(lines).toEqual([
      {
        level: "warn",
        event: "renderer.terminal.link_not_opened",
        bindings: { component: "terminal.links" },
        attrs: { scheme: "mailto", kind: "PRECONDITION_FAILED" },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("token-9c2e");
    expect(JSON.stringify(lines)).not.toContain("example.com");
  });

  it("swallows a door that is not there, or a transport that failed, the same way", async () => {
    await openTerminalLink(
      client(() =>
        Promise.reject(
          new FielddRpcError("FORBIDDEN_SCOPE", "requires terminal.link", false, {
            required: "terminal.link",
          }),
        ),
      ),
      "HTTPS://example.com/",
    );
    await openTerminalLink(
      client(() => Promise.reject(new Error("socket closed"))),
      "not a link at all",
    );
    expect(lines.map((line) => line.attrs)).toEqual([
      { scheme: "https", kind: "FORBIDDEN_SCOPE" },
      { scheme: "unknown", kind: "unknown" },
    ]);
  });

  it("never throws into the runtime, even when the client throws before it answers", async () => {
    const throwing: TerminalLinkClient = {
      request: () => {
        throw new Error("no connection yet");
      },
    };
    await expect(openTerminalLink(throwing, "https://example.com/")).resolves.toBeUndefined();
    expect(lines).toHaveLength(1);
  });
});

describe("terminalLinkOpener — the runtime platform's openExternal (GT-8b)", () => {
  it("asks fieldd for a web link, http as well as https", async () => {
    const fieldd = client(() => Promise.resolve({ outcome: "opened" }));
    const open = terminalLinkOpener(fieldd);
    await expect(open("http://localhost:3000/x")).resolves.toBeUndefined();
    await open("https://example.com/docs");
    expect(fieldd.calls).toEqual([
      { method: "terminal.link.open", params: { url: "http://localhost:3000/x" } },
      { method: "terminal.link.open", params: { url: "https://example.com/docs" } },
    ]);
    expect(lines).toEqual([]);
  });

  it("never asks for a file link — it could be a peer's path — nor any other scheme", async () => {
    const fieldd = client(() => Promise.resolve({ outcome: "revealed" }));
    const open = terminalLinkOpener(fieldd);
    for (const link of [
      "file:///Users/me/project/src/main.rs",
      "file:///Applications/Calculator.app",
      "mailto:someone@example.com",
      "ftp://example.com/",
    ]) {
      await expect(open(link), link).resolves.toBeUndefined();
    }
    expect(fieldd.calls).toEqual([]);
    expect(lines.map((line) => [line.level, line.event, line.attrs])).toEqual([
      ["info", "renderer.terminal.link_not_asked", { scheme: "file" }],
      ["info", "renderer.terminal.link_not_asked", { scheme: "file" }],
      ["info", "renderer.terminal.link_not_asked", { scheme: "mailto" }],
      ["info", "renderer.terminal.link_not_asked", { scheme: "ftp" }],
    ]);
    // the path is never logged, only its scheme
    expect(JSON.stringify(lines)).not.toContain("Calculator");
  });

  it("carries a refused web link through the same quiet path as openTerminalLink", async () => {
    const fieldd = client(() =>
      Promise.reject(new FielddRpcError("PRECONDITION_FAILED", "credentials", false)),
    );
    await expect(
      terminalLinkOpener(fieldd)("https://user:pass@example.com/"),
    ).resolves.toBeUndefined();
    expect(fieldd.calls).toHaveLength(1);
    expect(lines.map((line) => line.attrs)).toEqual([
      { scheme: "https", kind: "PRECONDITION_FAILED" },
    ]);
  });
});
