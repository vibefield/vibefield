/**
 * GT-8a — the deck's half of a terminal link. The helper asks fieldd's
 * `terminal.link.open` and nothing else, and it never throws into ghosttea's
 * pointer handler: a refused link is an ordinary answer, logged quietly by
 * scheme and kind — never by the URL, which can carry a token.
 */
import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTerminalLink, type TerminalLinkClient } from "../src/godview/terminal-links";
import {
  getRendererLogger,
  type RendererLogFields,
  type RendererLogger,
  type RendererLoggerBindings,
  setRendererLogger,
} from "../src/logging";

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
        bindings: { component: "godview.links" },
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
