import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { SERVED_TOOLS } from "../gen/tools";
import {
  PAGES_DAEMON_ACTIONS,
  PAGES_RUN_PANES_MAX,
  PAGES_TOOL_LIMITS,
  PAGES_WAIT_MAX_MS,
} from "../src/pages";
import { SHELL_SURFACES_RUN_ACTIONS, SURFACE_AUTHORITY_LIMITS } from "../src/shell";
import { TOOL_SCHEMAS, TOOLS } from "../src/tools";

// EY-2's 2a (2026-11-19): the pages rows' inputs and outputs. Each row takes the pin's own arguments less those the
// room drops, names its page as a desk object and a part of it as `ref`, and answers with the page it answered.

const schemas = TOOL_SCHEMAS as Record<string, { input: z.ZodTypeAny; output: z.ZodTypeAny }>;
const io = (name: string) => {
  const s = schemas[name];
  expect(s, `${name} has no schemas`).toBeDefined();
  return s!;
};
const pages = TOOLS.filter((t) => t.family === "pages");
const page = "vf:obj/a1b2c3d4";

// Each row's input after the drops, in the order the room names them.
const INPUTS: Record<string, string[]> = {
  browser_tools_profiles: [],
  browser_open: ["page", "url"],
  browser_read: ["page", "filter", "outline", "raw"],
  browser_snapshot: [
    "page",
    "compact",
    "delta",
    "depth",
    "full",
    "includeUrls",
    "interactive",
    "within",
  ],
  browser_back: ["page"],
  browser_forward: ["page"],
  browser_reload: ["page"],
  browser_click: ["page", "ref"],
  browser_fill: ["page", "ref", "text"],
  browser_type: ["page", "ref", "text", "delayMs"],
  browser_press: ["page", "key"],
  browser_check: ["page", "ref"],
  browser_uncheck: ["page", "ref"],
  browser_select: ["page", "ref", "values"],
  browser_scroll: ["page", "ref", "direction", "amount"],
  browser_wait_ms: ["page", "ms"],
  browser_wait_for_selector: ["page", "ref", "waitTimeoutMs"],
  browser_wait_for_text: ["page", "text", "waitTimeoutMs"],
  browser_wait_for_load: ["page", "state", "waitTimeoutMs"],
  browser_screenshot: [
    "page",
    "ref",
    "annotate",
    "format",
    "fullPage",
    "ifChanged",
    "quality",
    "threshold",
  ],
  browser_get_text: ["page", "ref"],
  browser_get_url: ["page"],
  browser_get_title: ["page"],
  browser_tab_new: ["url", "label"],
  browser_tab_list: [],
  browser_tab_switch: ["page"],
  browser_tab_close: ["page"],
  browser_eval: ["page", "script"],
  browser_close: [],
};

// The engine's shared arguments (the broker's) and each row's own that reach past the page.
const SHARED_DROPS = [
  "allowedDomains",
  "caCert",
  "clearCaCert",
  "extraArgs",
  "idleTimeout",
  "namespace",
  "restore",
  "restoreCheckFn",
  "restoreCheckText",
  "restoreCheckUrl",
  "restoreSave",
  "session",
  "timeoutMs",
  "useSystemCa",
];
const ROW_DROPS: Record<string, string[]> = {
  browser_open: ["headed", "webgpu", "webmcp"],
  browser_read: ["url", "llms", "requireMd", "readTimeoutMs"],
  browser_type: ["clear"],
  browser_click: ["newTab", "human"],
  browser_screenshot: ["path", "screenshotDir"],
  browser_close: ["all"],
};

const projected = (name: string) => {
  const tool = SERVED_TOOLS.find((t) => t.name === name);
  expect(tool, `${name} is not projected`).toBeDefined();
  return tool!.inputSchema as {
    properties?: Record<string, unknown>;
    required?: readonly string[];
  };
};

describe("the pages rows' inputs (2a)", () => {
  it("takes the pin's own arguments, less the engine's shared ones and each row's that reach past the page", () => {
    expect(Object.keys(INPUTS)).toEqual(pages.map((t) => t.name));
    for (const t of pages) {
      const input = projected(t.name);
      expect(Object.keys(input.properties ?? {}), t.name).toEqual(INPUTS[t.name]);
      for (const drop of [...SHARED_DROPS, ...(ROW_DROPS[t.name] ?? [])])
        expect(input.properties ?? {}, `${t.name} drops ${drop}`).not.toHaveProperty(drop);
    }
  });

  it("names the page as a desk object, required on a page's row and never on open's, and on no other row", () => {
    for (const t of pages) {
      const input = projected(t.name);
      const required = input.required ?? [];
      if (t.scope === "object" && t.name !== "browser_open")
        expect(required, t.name).toContain("page");
      else expect(required, t.name).not.toContain("page");
      if (t.scope !== "object") expect(input.properties ?? {}, t.name).not.toHaveProperty("page");
    }
    expect(io("browser_open").input.safeParse({}).success).toBe(true);
    expect(io("browser_open").input.safeParse({ page, url: "https://example.com/" }).success).toBe(
      true,
    );
    for (const bad of ["surface_0123456789abcdef", "vf:obj/short", ""])
      expect(io("browser_read").input.safeParse({ page: bad }).success, bad).toBe(false);
    expect(io("browser_click").input.safeParse({ page, ref: "@e12" }).success).toBe(true);
    expect(io("browser_click").input.safeParse({ page, ref: "" }).success).toBe(false);
  });

  it("bounds every wait below the control call's deadline, and a typing's whole time with it", () => {
    expect(PAGES_WAIT_MAX_MS).toBe(SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS - 5_000);
    const ok = (name: string, input: object) => io(name).input.safeParse(input).success;
    expect(ok("browser_wait_ms", { page, ms: PAGES_WAIT_MAX_MS })).toBe(true);
    expect(ok("browser_wait_ms", { page, ms: PAGES_WAIT_MAX_MS + 1 })).toBe(false);
    const waits: [string, object][] = [
      ["browser_wait_for_selector", { page, ref: "#done" }],
      ["browser_wait_for_text", { page, text: "Saved" }],
      ["browser_wait_for_load", { page, state: "networkidle" }],
    ];
    for (const [name, input] of waits) {
      expect(ok(name, input), name).toBe(true);
      expect(ok(name, { ...input, waitTimeoutMs: PAGES_WAIT_MAX_MS }), name).toBe(true);
      expect(ok(name, { ...input, waitTimeoutMs: PAGES_WAIT_MAX_MS + 1 }), name).toBe(false);
      expect(ok(name, { ...input, waitTimeoutMs: 0 }), name).toBe(false);
    }
    const { TEXT_CHARS, TYPE_DELAY_MS_MAX } = PAGES_TOOL_LIMITS;
    const type = { page, ref: "@e3", text: "hello" };
    expect(ok("browser_type", { ...type, delayMs: TYPE_DELAY_MS_MAX })).toBe(true);
    expect(ok("browser_type", { ...type, delayMs: TYPE_DELAY_MS_MAX + 1 })).toBe(false);
    expect(ok("browser_type", { ...type, text: "x".repeat(TEXT_CHARS) })).toBe(true);
    expect(ok("browser_type", { ...type, text: "x".repeat(TEXT_CHARS + 1) })).toBe(false);
    // the pause times the length: exactly the cap passes, one key more does not
    const keys = PAGES_WAIT_MAX_MS / TYPE_DELAY_MS_MAX;
    expect(
      ok("browser_type", { ...type, text: "x".repeat(keys), delayMs: TYPE_DELAY_MS_MAX }),
    ).toBe(true);
    expect(
      ok("browser_type", { ...type, text: "x".repeat(keys + 1), delayMs: TYPE_DELAY_MS_MAX }),
    ).toBe(false);
    expect(ok("browser_screenshot", { page, quality: 101 })).toBe(false);
    expect(ok("browser_screenshot", { page, threshold: 1.5 })).toBe(false);
    expect(ok("browser_select", { page, ref: "#size", values: [] })).toBe(false);
  });
});

describe("the pages rows' answers (2a)", () => {
  const made = { page: "vf:obj/b2c3d4e5", url: "about:blank", by: "popup" };
  const ACTS = [
    "browser_open",
    "browser_back",
    "browser_forward",
    "browser_reload",
    "browser_click",
    "browser_fill",
    "browser_type",
    "browser_press",
    "browser_check",
    "browser_uncheck",
    "browser_select",
    "browser_scroll",
    "browser_eval",
  ];
  const READS = [
    "browser_read",
    "browser_snapshot",
    "browser_wait_ms",
    "browser_wait_for_selector",
    "browser_wait_for_text",
    "browser_wait_for_load",
    "browser_get_text",
    "browser_get_url",
    "browser_get_title",
    "browser_tab_switch",
  ];
  const out = (name: string, value: object) => io(name).output.safeParse(value).success;

  it("names the page an act acted on and the panes it made, each the run's own desk object", () => {
    for (const name of ACTS) {
      expect(toolRowReadOnly(name), name).toBe(false);
      expect(out(name, { page, result: { ok: true } }), name).toBe(true);
      expect(out(name, { page, result: null, made: [made] }), name).toBe(true);
      const many = Array.from({ length: PAGES_RUN_PANES_MAX + 1 }, () => made);
      for (const bad of [
        { result: { ok: true } },
        { page, result: null, made: many },
        { page, result: null, made: [{ ...made, by: "window" }] },
        {
          page,
          result: null,
          made: [{ surfaceId: "surface_0123456789abcdef", url: made.url, by: "tab" }],
        },
      ])
        expect(out(name, bad), `${name} ${JSON.stringify(bad).slice(0, 60)}`).toBe(false);
    }
  });

  it("names the page a read read", () => {
    for (const name of READS) {
      expect(toolRowReadOnly(name), name).toBe(true);
      expect(out(name, { page, result: "Example Domain" }), name).toBe(true);
      expect(out(name, { result: "Example Domain" }), name).toBe(false);
    }
  });

  it("answers a still with its file, a new tab with its pane, the list with the current page, and a close with what it gave back", () => {
    expect(ACTS.length + READS.length + 6).toBe(pages.length);
    expect(out("browser_screenshot", { page, file: "/srv/run-01J8Z3K9/still-1.png" })).toBe(true);
    expect(out("browser_screenshot", { page })).toBe(true);
    expect(out("browser_screenshot", { page, file: "still-1.png" })).toBe(false);
    expect(out("browser_tab_new", { page, made: [{ ...made, by: "tab" }] })).toBe(true);
    expect(out("browser_tab_new", { page, made: [] })).toBe(false);
    const listed = { page, url: "https://example.com/", handed: false, current: true };
    expect(out("browser_tab_list", { pages: [listed] })).toBe(true);
    expect(out("browser_tab_list", { pages: [{ ...listed, current: undefined }] })).toBe(false);
    for (const name of ["browser_tab_close", "browser_close"]) {
      expect(out(name, { closed: [page], returned: ["vf:obj/c3d4e5f6"] }), name).toBe(true);
      expect(out(name, { closed: [page] }), name).toBe(false);
    }
    expect(out("browser_tools_profiles", { rows: ["browser_read", "browser_click"] })).toBe(true);
  });
});

describe("the pages rows' engine actions (EY-2)", () => {
  it("names each action the rows send once, sorted, and leaves the run's rebind to the run form", () => {
    expect([...PAGES_DAEMON_ACTIONS]).toEqual([...PAGES_DAEMON_ACTIONS].sort());
    expect(new Set(PAGES_DAEMON_ACTIONS).size).toBe(PAGES_DAEMON_ACTIONS.length);
    expect(PAGES_DAEMON_ACTIONS).toHaveLength(25);
    // every run-form action but fieldd's own rebind is a row's too: the run's list and close
    const rows: readonly string[] = PAGES_DAEMON_ACTIONS;
    expect(SHELL_SURFACES_RUN_ACTIONS.filter((action) => !rows.includes(action))).toEqual([
      "rebind",
    ]);
  });
});

function toolRowReadOnly(name: string): boolean | undefined {
  return TOOLS.find((t) => t.name === name)?.readOnly;
}

describe("the pages rows' words say what each does (2026-11-24)", () => {
  const words = (name: string) => TOOLS.find((t) => t.name === name)?.description ?? "";

  it("browser_close closes the pages and gives the handed ones back, and says a page can be opened again", () => {
    // C1: the agent's close is not the run's end, so its words never promise the session is over
    expect(words("browser_close")).not.toMatch(/End your browser session/);
    expect(words("browser_close")).toMatch(/open a page again/);
    expect(words("browser_close")).toMatch(/go back to them/);
  });

  it("browser_open says its page opens on the user's desk, the browser to use when they ask for one there", () => {
    // L3: an agent asked for a browser "on my desk" opened another browser on the user's machine
    expect(words("browser_open")).toMatch(
      /^Open a page in a browser pane on the user's VibeField desk/,
    );
    expect(words("browser_open")).toMatch(/not another browser on their computer/);
  });
});
