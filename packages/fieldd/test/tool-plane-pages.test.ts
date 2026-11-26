import type {
  NativeDoorOpen,
  ObjectIntent,
  ShellSurfacesControlParams,
} from "@vibefield/contracts";
import { AuditActionV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import type { DeskKind } from "../src/objects/kinds";
import { type ToolPlaneAudit, ToolPlaneService } from "../src/tool-plane";
import { MCP_MODERN } from "../src/tool-plane/mcp";
import { BROWSER_KIND, type PagesDeps } from "../src/tool-plane/rooms/pages/verbs";
import { type Answer, cleanupWorlds, NOTE, ordinaryWindow, world } from "./desk-fixtures";

// EY-2 (2b, 2026-11-19) — the pages room through the real plane: a browser row reaches the room, its audit line written
// before the act names the page and never what was read on it or typed into it (CP-L6), and the room's facts reach the
// model as the words of its own tool result. Main is a fake here, as in the room's own rows.

afterEach(cleanupWorlds);

const BROWSER: DeskKind = {
  kind: BROWSER_KIND,
  title: "Browser",
  placeable: true,
  concurrency: "many",
  version: 1,
  tools: [],
};

const META = {
  "io.modelcontextprotocol/protocolVersion": MCP_MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
};
const DOOR: NativeDoorOpen = {
  connId: "c-plain",
  laneId: 1,
  state: "open",
  caller: { pid: 4242, startedAtMs: 1793270000000 },
  pane: { terminalSessionId: "sess-plain", depth: 1 },
};

/** What the plane answers a tools/call, as the tests read it. */
type McpAnswer = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string; uri?: string; name?: string; mimeType?: string }[];
};

/** A window that places each made pane under a key of its own, bound to the surface the place names. */
const pagesWindow = (intent: ObjectIntent): Answer | undefined => {
  if (intent.op !== "place") return ordinaryWindow(intent);
  const key = `k-${String((intent as { made?: unknown }).made)}`;
  return {
    ok: true,
    value: { key, kind: intent.kind, title: "Page", now: "", heldByUser: false, onScreen: true },
    inverse: { remove: key },
  };
};

/** `pages: false`: a plane given no pages room. */
function harness(opts: { pages?: boolean } = {}) {
  const h = world({ kinds: [BROWSER, NOTE] });
  h.window(pagesWindow);
  const handlers = new Map<number, (p: Uint8Array) => void>();
  const sent = new Map<number, string>();
  const audited: { action: string; attrs?: Record<string, unknown> }[] = [];
  const audit: ToolPlaneAudit = {
    required: async (_ctx, mutation, effect) => {
      AuditActionV1.parse(mutation.action);
      audited.push({
        action: mutation.action,
        ...(mutation.attrs ? { attrs: mutation.attrs } : {}),
      });
      return effect();
    },
  };
  const calls: ShellSurfacesControlParams[] = [];
  const answers: ((params: ShellSurfacesControlParams) => unknown)[] = [];
  const pages: PagesDeps = {
    objects: h.desk,
    control: async (params) => {
      calls.push(params);
      return (answers.shift() ?? (() => ({ status: "done", output: { success: true, data: {} } })))(
        params,
      );
    },
    stills: { folderFor: () => "/Users/u/stills/run-a", used: () => 0, holds: () => true },
  };
  const plane = new ToolPlaneService({
    native: {
      subscribe: async () => ({ snapshot: { doors: [DOOR] }, dispose: () => undefined }),
      request: async () => ({ closed: true }),
    },
    lanes: {
      onLane: (id, f) => handlers.set(id, f),
      offLane: (id) => handlers.delete(id),
      send: (id, p) => {
        sent.set(id, (sent.get(id) ?? "") + new TextDecoder().decode(p));
        return true;
      },
      flush: async () => undefined,
    },
    runForTerminal: () => ({ runtimeRunId: "run-a", verified: true, profileSet: "work" }),
    personaSets: () => new Map(),
    spark: () => undefined,
    verbs: {
      profileSets: async () => [],
      personaSets: () => new Map(),
      agentLabel: () => undefined,
      models: async () => {
        throw new Error("unused");
      },
      runs: () => [],
      runFacts: () => undefined,
      projects: () => [],
      indexSessionFor: async () => undefined,
      indexPhase: async () => "live",
      indexSessionProfile: async () => ({}),
      timeline: async () => {
        throw new Error("unused");
      },
      search: async () => {
        throw new Error("unused");
      },
    },
    desk: { objects: h.desk },
    ...(opts.pages === false ? {} : { pages }),
    audit,
    version: "0.1.0",
    now: () => 1_000_000,
  });
  const answered = (id: number): McpAnswer | undefined =>
    (sent.get(1) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line: { id: number }) => line.id === id)?.result;
  /** One request on the lane, and its answer. */
  const ask = async (
    id: number,
    method: string,
    params: object,
  ): Promise<McpAnswer | undefined> => {
    handlers.get(1)?.(
      new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`),
    );
    for (let i = 0; i < 200 && answered(id) === undefined; i += 1)
      await new Promise((r) => setTimeout(r, 0));
    return answered(id);
  };
  /** A call in the modern protocol, its version and capabilities on the request. */
  const call = (id: number, name: string, args: object) =>
    ask(id, "tools/call", { _meta: META, name, arguments: args });
  const next = (answer: (params: ShellSurfacesControlParams) => unknown) => answers.push(answer);
  return { h, plane, call, ask, audited, calls, next };
}

const SURFACE = "surface_page_000001";

describe("EY-2: the pages room through the plane", () => {
  it("a new tab and a fill reach the room; the fill's audit line names the page, never what was typed", async () => {
    const { plane, call, audited, calls, next } = harness();
    await plane.ensureStarted();
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      made: [{ surfaceId: SURFACE, url: "https://example.com/", by: "tab" }],
    }));
    const opened = await call(1, "browser_tab_new", { url: "https://example.com/" });
    expect(opened?.isError).toBeUndefined();
    const page = opened?.structuredContent?.page as string;
    expect(page).toMatch(/^vf:obj\//);
    const filled = await call(2, "browser_fill", { page, ref: "@e2", text: "hunter2" });
    expect(filled?.isError).toBeUndefined();
    expect(calls[1]).toEqual({
      run: "run-a",
      surfaceId: SURFACE,
      window: "act",
      command: { action: "fill", selector: "@e2", value: "hunter2" },
    });
    const line = audited.find((a) => a.action === "tools.browser_fill");
    expect(line?.attrs).toMatchObject({ verb: "browser_fill", page });
    expect(JSON.stringify(line)).not.toContain("hunter2");
    expect(JSON.stringify(line)).not.toContain("@e2");
  });

  it("the person's hand on a page reaches the model as held, in the words of its own tool result", async () => {
    const { h, plane, call, calls, next } = harness();
    await plane.ensureStarted();
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      made: [{ surfaceId: SURFACE, url: "https://example.com/", by: "tab" }],
    }));
    const page = (await call(1, "browser_tab_new", {}))?.structuredContent?.page as string;
    h.desk.presence.hold(page, true);
    const refused = await call(2, "browser_read", { page });
    expect(refused?.isError).toBe(true);
    expect(refused?.structuredContent).toBeUndefined();
    expect(refused?.content?.[0]?.text).toMatch(/^held: /);
    expect(calls).toHaveLength(1);
  });

  it("an act main never answered reaches the model as no answer, never as a failure", async () => {
    const { plane, call, next } = harness();
    await plane.ensureStarted();
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      made: [{ surfaceId: SURFACE, url: "https://example.com/", by: "tab" }],
    }));
    const page = (await call(1, "browser_tab_new", {}))?.structuredContent?.page as string;
    next(() => {
      throw new RpcCallError("TIMEOUT", "deadline");
    });
    const refused = await call(2, "browser_click", { page, ref: "@e1" });
    expect(refused?.content?.[0]?.text).toMatch(/^unavailable \(pages: no-answer\): /);
    expect(refused?.content?.[0]?.text).toContain("cannot tell whether this happened");
  });

  it("a still reaches the model as a link to its file, and as its path in the words", async () => {
    const { plane, call, next } = harness();
    await plane.ensureStarted();
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      made: [{ surfaceId: SURFACE, url: "https://example.com/", by: "tab" }],
    }));
    const page = (await call(1, "browser_tab_new", {}))?.structuredContent?.page as string;
    const path = "/Users/u/stills/run-a/still 1.png";
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      still: { path, mime: "image/png", width: 10, height: 10, bytes: 99 },
    }));
    const still = await call(2, "browser_screenshot", { page });
    expect(still?.isError).toBeUndefined();
    expect(still?.content?.[0]?.type).toBe("text");
    expect(still?.content?.[0]?.text).toContain(path);
    expect(still?.content?.[1]).toEqual({
      type: "resource_link",
      uri: "file:///Users/u/stills/run-a/still%201.png",
      name: "still 1.png",
      mimeType: "image/png",
    });
    expect(still?.content).toHaveLength(2);
  });

  it("a caller on the 2025-03-26 protocol, which has no links, has the still's path in the words alone", async () => {
    const { plane, ask, next } = harness();
    await plane.ensureStarted();
    await ask(1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "old", version: "1" },
    });
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      made: [{ surfaceId: SURFACE, url: "https://example.com/", by: "tab" }],
    }));
    const page = (await ask(2, "tools/call", { name: "browser_tab_new", arguments: {} }))
      ?.structuredContent?.page as string;
    const path = "/Users/u/stills/run-a/still-1.png";
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      still: { path, mime: "image/png", width: 10, height: 10, bytes: 99 },
    }));
    const still = await ask(3, "tools/call", { name: "browser_screenshot", arguments: { page } });
    expect(still?.content).toEqual([{ type: "text", text: expect.stringContaining(path) }]);
  });

  it("a plane given no pages room answers its rows unavailable", async () => {
    const { plane, call } = harness({ pages: false });
    await plane.ensureStarted();
    const refused = await call(1, "browser_tab_new", {});
    expect(refused?.isError).toBe(true);
    expect(refused?.content?.[0]?.text).toMatch(/^unavailable/);
  });
});

describe("F7: the run's own page taken off the desk is closed, in the room and in main (2026-11-24)", () => {
  it("canvas_remove of the run's own page closes its page, and a later call on it is gone without reaching main", async () => {
    const { plane, call, calls, next } = harness();
    await plane.ensureStarted();
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      made: [{ surfaceId: SURFACE, url: "https://example.com/", by: "tab" }],
    }));
    const page = (await call(1, "browser_tab_new", {}))?.structuredContent?.page as string;
    const removed = await call(2, "canvas_remove", { ref: page });
    expect(removed?.isError).toBeUndefined();
    // the page's own close, which main answers itself: never the run's end
    expect(calls[1]).toEqual({
      run: "run-a",
      surfaceId: SURFACE,
      window: "act",
      command: { action: "close" },
    });
    const after = await call(3, "browser_click", { page, ref: "@e1" });
    expect(after?.content?.[0]?.text).toMatch(/^gone: /);
    expect(calls).toHaveLength(2);
  });
});

describe("el7 F5: the call's audit line names only what the row's own input says (2026-11-24)", () => {
  it("an agent's own `session` on a pages row, whose input names none, never lands in the line", async () => {
    const { plane, call, audited, next } = harness();
    await plane.ensureStarted();
    next(() => ({
      status: "done",
      output: { success: true, data: {} },
      made: [{ surfaceId: SURFACE, url: "https://example.com/", by: "tab" }],
    }));
    const page = (await call(1, "browser_tab_new", {}))?.structuredContent?.page as string;
    const forged = "s".repeat(1024);
    await call(2, "browser_click", { page, ref: "@e1", session: forged });
    const line = audited.find((a) => a.action === "tools.browser_click");
    expect(line?.attrs).toMatchObject({ verb: "browser_click", page });
    expect(line?.attrs).not.toHaveProperty("session");
    expect(JSON.stringify(audited)).not.toContain(forged);
  });
});
