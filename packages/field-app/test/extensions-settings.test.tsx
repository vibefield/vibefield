// @vitest-environment happy-dom
/**
 * Extensions on a profile's page (AR-S4b; the design record's pass 24, L2):
 * the lens fieldd sends, worded for the grid — a row per name some agent
 * holds as its own, a cell per agent in pass 24's states, the rest counted
 * beneath — then drawn read-only, and fed by `agents.extensions.subscribe`
 * with "Read again" asking `agents.extensions.list` to read every agent anew.
 * The lens is the contracts fixture, the one fieldd's shape is checked by.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentsExtensionsListResult } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_EXTENSIONS } from "../src/design-system/extensions-fixtures";
import { ProfileExtensions } from "../src/panels/agents/ExtensionsSection";
import { ProfileExtensionsView } from "../src/panels/agents/ExtensionsView";
import {
  builtFromWords,
  extensionGrid,
  holdingWords,
  readWords,
} from "../src/panels/agents/extensions-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "fixtures",
  "agents-extensions.valid.json",
);
const RAW: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
const LENS = AgentsExtensionsListResult.parse(RAW);

it("draws the catalog from the contracts fixture itself", () => {
  expect(FIXTURE_EXTENSIONS).toEqual(RAW);
});

const cellOf = (key: "servers" | "skills", name: string, provider: string) =>
  extensionGrid(LENS, key)
    .rows.find((row) => row.name === name)
    ?.cells.find((cell) => cell.provider === provider)?.cell;

describe("the Extensions model", () => {
  it("lists a name some agent holds as its own, and counts the rest beneath", () => {
    const servers = extensionGrid(LENS, "servers");
    // sentry is only a project's server in Claude: it stays on Claude's own list
    expect(servers.rows.map((row) => row.name)).toEqual(["linear", "postgres"]);
    expect(servers.more).toBe(
      "1 more comes with a plugin, an app or one project; it stays on its agent’s own list.",
    );
    const skills = extensionGrid(LENS, "skills");
    // a plugin's skill and a built-in one are not the profile's to list
    expect(skills.rows.map((row) => row.name)).toEqual(["release-notes", "sql-review"]);
    expect(skills.more).toBe(
      "2 more are built into an agent, or come with a plugin or your organization; they stay on each agent’s own list.",
    );
  });

  it("says what each agent holds, in pass 24's states and words", () => {
    expect(cellOf("servers", "linear", "claude")).toEqual({
      s: "on",
      attn: false,
      why: "On · signed in",
    });
    // Codex reads a variable Claude's does not: the second of two versions
    expect(cellOf("servers", "linear", "codex")).toEqual({
      s: "on",
      attn: true,
      why: "On · a different server under the same name",
    });
    expect(cellOf("servers", "linear", "grok")).toEqual({
      s: "lent",
      from: "claude",
      why: "Grok loads Claude’s linear from This Mac, in every profile",
    });
    expect(cellOf("servers", "linear", "opencode")).toEqual({
      s: "app",
      on: false,
      why: "Off · changed in OpenCode",
    });
    expect(cellOf("servers", "postgres", "codex")).toEqual({
      s: "off",
      why: "Off · Codex keeps its settings",
    });
    expect(cellOf("servers", "postgres", "grok")).toEqual({ s: "off", why: "Off" });
    expect(cellOf("servers", "linear", "kimi")).toMatchObject({
      s: "unread",
      why: "Kimi could not be read: extension inventory failed for kimi",
    });
    // a switchable skill in the shared folder is on or off; one Grok cannot switch is fixed
    expect(cellOf("skills", "release-notes", "codex")).toMatchObject({ s: "on" });
    expect(cellOf("skills", "release-notes", "grok")).toMatchObject({ s: "fixed" });
    expect(cellOf("skills", "sql-review", "claude")).toEqual({
      s: "off",
      why: "Off · Claude keeps its settings",
    });
  });

  it("heads each column with what is particular about the agent", () => {
    const heads = extensionGrid(LENS, "servers").heads;
    expect(heads.map((head) => [head.provider, head.caveat])).toEqual([
      ["claude", ""],
      ["codex", ""],
      ["grok", "+ Claude’s"],
      ["opencode", "in the app"],
      ["kimi", "not read"],
    ]);
    // OpenCode's skills were read but for the ones it downloads at start: what was read shows
    expect(
      extensionGrid(LENS, "skills").heads.find((head) => head.provider === "opencode"),
    ).toMatchObject({
      caveat: "partly read",
      why: "Not all of OpenCode’s skills could be read: skills from `skills.urls` are downloaded when OpenCode starts and are not read here",
    });
    expect(cellOf("skills", "release-notes", "opencode")).toMatchObject({ s: "unread" });
  });

  it("words a row's fact, the I1 line and a holding's detail", () => {
    const servers = extensionGrid(LENS, "servers");
    expect(servers.rows[0]).toMatchObject({
      name: "linear",
      twoVersions: true,
      glyph: "globe",
      fact: "Two versions · https://mcp.linear.app/mcp",
    });
    expect(servers.rows[1]).toMatchObject({ glyph: "prompt", twoVersions: true });
    expect(extensionGrid(LENS, "skills").rows[0]?.fact).toBe(
      "~/.agents/skills · Drafts release notes from merged pull requests",
    );
    expect(builtFromWords(LENS, "Work")).toEqual({
      text: "Built from what Work’s agents already have: 2 servers and 2 skills. Nothing in the agents changed.",
      twoVersions: ["linear", "postgres"],
    });
    const grok = LENS.servers[0]?.cells.grok?.[0];
    expect(holdingWords(LENS, grok!)).toEqual({
      origin: "Loaded from Claude, on This Mac",
      detail: "on · https://mcp.linear.app/mcp · sends Authorization",
      place: "~/.claude.json",
    });
    expect(readWords(LENS, new Date("2026-09-25T09:03:10.000Z"))).toBe("Read 3 minutes ago");
    expect(readWords({ ...LENS, reading: true }, new Date())).toBe("Reading the agents…");
  });
});

// ── drawn ──

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

describe("ProfileExtensionsView", () => {
  it("draws two read-only grids, and opens a row in place to each agent's own holding", async () => {
    await mount(
      createElement(ProfileExtensionsView, {
        lens: LENS,
        profile: "Work",
        now: new Date("2026-09-25T09:00:30.000Z"),
      }),
    );
    const grids = container?.querySelectorAll("[data-ext-grid]");
    expect([...(grids ?? [])].map((grid) => grid.getAttribute("data-ext-grid"))).toEqual([
      "servers",
      "skills",
    ]);
    expect(container?.querySelector("[data-ext-built]")?.textContent).toContain(
      "linear, postgres are two different servers under one name.",
    );
    const cell = container?.querySelector(
      '[aria-label="linear for Grok: Grok loads Claude’s linear from This Mac, in every profile"]',
    );
    expect(cell).not.toBeNull();
    // read-only: nothing in a cell is a control
    expect(container?.querySelectorAll("td button")).toHaveLength(0);
    const name = container?.querySelector<HTMLButtonElement>('[data-ext-row="linear"] button');
    expect(name?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => name?.click());
    const detail = container?.querySelector(".vf-ext-detail");
    expect(detail?.textContent).toContain("Codex · Its own");
    expect(detail?.textContent).toContain("reads LINEAR_TOKEN");
    expect(container?.textContent).toContain("Read just now");
  });

  it("says it is reading before the first read, and keeps the lists beside a refusal", async () => {
    await mount(createElement(ProfileExtensionsView, { lens: null, profile: "Work" }));
    expect(container?.textContent).toContain("Reading what Work’s agents hold…");
    await act(async () =>
      root?.render(
        createElement(ProfileExtensionsView, {
          lens: LENS,
          profile: "Work",
          error: "Could not read the agents again — boom.",
        }),
      ),
    );
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not read the agents again — boom.",
    );
    expect(container?.querySelector('[data-ext-grid="servers"]')).not.toBeNull();
  });
});

describe("ProfileExtensions (the controller)", () => {
  it("subscribes for the profile, draws each frame, and reads again when asked", async () => {
    let push: ((frame: unknown) => void) | undefined;
    const request = vi.fn(async (method: string, params?: unknown) => {
      expect(method).toBe("agents.extensions.list");
      expect(params).toEqual({ set: "work", refresh: true });
      push?.(LENS);
      return LENS;
    });
    const subscribe = vi.fn(
      async (method: string, params: unknown, onData: (frame: unknown) => void) => {
        expect(method).toBe("agents.extensions.subscribe");
        expect(params).toEqual({ set: "work" });
        push = onData;
        return {
          subId: "extensions:work",
          snapshot: { ...LENS, reading: true, readAt: undefined, servers: [], skills: [] },
          unsubscribe: () => undefined,
        };
      },
    );
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request,
      subscribe,
    } as unknown as FielddClient;
    await mount(
      createElement(
        FielddProvider,
        { client },
        createElement(ProfileExtensions, { set: "work", profile: "Work" }),
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container?.textContent).toContain("Reading what Work’s agents hold…");
    await act(async () => push?.(LENS));
    expect(container?.querySelector('[data-ext-grid="servers"]')).not.toBeNull();
    const again = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Read again",
    );
    await act(async () => again?.click());
    expect(request).toHaveBeenCalledTimes(1);
  });
});
