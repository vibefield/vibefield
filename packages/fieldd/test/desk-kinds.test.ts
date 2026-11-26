import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DESK_KINDS,
  LIVE_PAGE_SCOPES,
  OBJECT_LIMITS,
  type PluginRecord,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { deskKinds, pluginDeskKinds } from "../src/objects/kinds";

// OB-3b — the one seam a kind is read through (OB-L2): the built-ins' table, and each enabled plugin's kinds, a guide
// read from the plugin's own folder. A kind with no agent half can be placed and named, and gives no tools.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const agentHalf = {
  summary: "A mind map.",
  concurrency: "one",
  faces: [{ type: "ref" }],
  guide: "./assets/agent/guide.md",
  tools: [
    {
      name: "outline",
      readOnly: true,
      description: "Read it.",
      input: { type: "object", properties: {} },
    },
  ],
};

const object = (type: string, agent?: unknown) => ({
  type,
  title: type,
  schemaVersion: 3,
  ...(agent !== undefined ? { agent } : {}),
});

const record = (
  id: string,
  enabled: boolean,
  objects: unknown[],
  requested: string[] = [],
  granted: string[] = requested,
) =>
  ({
    id,
    enabled,
    requestedCapabilities: requested,
    grantedCapabilities: granted,
    contributions: { objects },
  }) as unknown as PluginRecord;

describe("the kinds a desk knows (OB-L2)", () => {
  it("reads the built-ins from the table, each by its type", () => {
    const kinds = deskKinds();
    expect(kinds.map((k) => k.kind)).toEqual(DESK_KINDS.map((k) => k.type));
    const note = kinds.find((k) => k.kind === "desk.note");
    const table = DESK_KINDS.find((k) => k.type === "desk.note");
    expect(note).toMatchObject({
      title: table?.title,
      version: table?.version,
      summary: table?.agent.summary,
      guide: table?.agent.guide,
      concurrency: table?.agent.concurrency,
    });
    expect(note?.tools.map((t) => t.name)).toEqual(table?.agent.tools.map((t) => t.name));
  });

  it("reads a kind whose tools are a room's rows as that room's, and never placeable by the desk (R-2)", () => {
    const kinds = pluginDeskKinds(
      [
        record("vibefield.browser-pane", true, [
          object("vibefield.browser-pane", {
            summary: "A web page.",
            concurrency: "one",
            faces: [{ type: "ref" }],
            tools: [],
            room: "pages",
          }),
        ]),
      ],
      () => undefined,
    );
    expect(kinds[0]).toMatchObject({ room: "pages", placeable: false, tools: [] });
  });

  it("keeps a kind that is both a room's and a live page's unplaceable for both reasons (R-2 with item 581)", () => {
    // the browser pane as its manifest asks (read, never copied) with a room-naming agent half, as 2g gives it
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../plugins/browser-pane/vibefield.plugin.json"),
        "utf8",
      ),
    ) as { id: string; capabilities: string[] };
    const [kind] = pluginDeskKinds(
      [
        record(
          manifest.id,
          true,
          [
            object(manifest.id, {
              summary: "A web page.",
              concurrency: "one",
              faces: [{ type: "ref" }],
              tools: [],
              room: "pages",
            }),
          ],
          manifest.capabilities,
        ),
      ],
      () => undefined,
    );
    expect(kind).toMatchObject({ room: "pages", livePages: true, placeable: false });
  });

  it("keeps Print from being placed", () => {
    expect(deskKinds().find((k) => k.kind === "desk.photo")?.placeable).toBe(false);
  });

  it("adds an enabled plugin's kinds, its guide read from the plugin's folder, its version the schema's", () => {
    const root = mkdtempSync(join(tmpdir(), "vf-kinds-"));
    roots.push(root);
    mkdirSync(join(root, "assets", "agent"), { recursive: true });
    writeFileSync(join(root, "assets", "agent", "guide.md"), "Read the outline first.");
    const [map] = pluginDeskKinds(
      [record("com.a", true, [object("a.map", agentHalf)])],
      () => root,
    );
    expect(map).toMatchObject({
      kind: "a.map",
      placeable: true,
      concurrency: "one",
      summary: "A mind map.",
      guide: "Read the outline first.",
      version: 3,
    });
    expect(map?.tools.map((t) => t.name)).toEqual(["outline"]);
    expect(deskKinds([map as never]).at(-1)?.kind).toBe("a.map");
  });

  it("gives a kind with no agent half no tools, and an agent no way to place it: no gesture opens a plugin's kind", () => {
    const [plain] = pluginDeskKinds([record("com.a", true, [object("a.plain")])], () => undefined);
    expect(plain).toMatchObject({ kind: "a.plain", placeable: false, concurrency: "many" });
    expect(plain?.tools).toEqual([]);
    expect(plain?.guide).toBeUndefined();
  });

  it("names the plugin a guide came from, and reads no more of it than the bound in bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "vf-kinds-"));
    roots.push(root);
    mkdirSync(join(root, "assets", "agent"), { recursive: true });
    writeFileSync(join(root, "assets", "agent", "guide.md"), "é".repeat(OBJECT_LIMITS.GUIDE_BYTES));
    const [map] = pluginDeskKinds(
      [{ ...record("com.a", true, [object("a.map", agentHalf)]), title: "Mind Maps" }],
      () => root,
    );
    expect(map?.guideFrom).toBe("Mind Maps");
    expect(Buffer.byteLength(map?.guide ?? "")).toBeLessThanOrEqual(OBJECT_LIMITS.GUIDE_BYTES);
    expect(map?.guide?.endsWith("\uFFFD")).toBe(false);
  });

  it("keeps a kind whose plugin asks a live face's whole pair from an agent, whatever the person granted (item 581)", () => {
    for (const pair of Object.values(LIVE_PAGE_SCOPES)) {
      // asked, but revoked by the person's toggle: the request decides, so a re-grant never wakes an agent's object
      const [kind] = pluginDeskKinds(
        [record("com.live", true, [object("live.page", agentHalf)], [...pair], [])],
        () => undefined,
      );
      expect(kind, pair.join("+")).toMatchObject({ placeable: false, livePages: true });
    }
  });

  it("keeps the official live plugins' kinds from an agent, by what their own manifests request (item 581)", () => {
    // read at the source, never copied from the list: a pair renamed in one place and not the other turns this red
    for (const folder of ["browser-pane", "simulator"]) {
      const manifest = JSON.parse(
        readFileSync(
          join(import.meta.dirname, "../../../plugins", folder, "vibefield.plugin.json"),
          "utf8",
        ),
      ) as { id: string; capabilities: string[] };
      const [kind] = pluginDeskKinds(
        [
          record(
            manifest.id,
            true,
            [object(manifest.id, agentHalf)],
            manifest.capabilities,
            manifest.capabilities,
          ),
        ],
        () => undefined,
      );
      expect(kind, manifest.id).toMatchObject({ placeable: false, livePages: true });
    }
  });

  it("lets an agent place a kind whose plugin asks only half a pair: nothing live opens on it (item 581)", () => {
    for (const scope of new Set(Object.values(LIVE_PAGE_SCOPES).flat())) {
      const [kind] = pluginDeskKinds(
        [record("com.half", true, [object("half.map", agentHalf)], [scope])],
        () => undefined,
      );
      expect(kind, scope).toMatchObject({ placeable: true });
      expect(kind?.livePages, scope).toBeUndefined();
    }
  });

  it("goes without a guide the plugin no longer ships, and skips a disabled plugin", () => {
    const root = mkdtempSync(join(tmpdir(), "vf-kinds-"));
    roots.push(root);
    const [map] = pluginDeskKinds(
      [record("com.a", true, [object("a.map", agentHalf)])],
      () => root,
    );
    expect(map?.guide).toBeUndefined();
    expect(
      pluginDeskKinds([record("com.b", false, [object("b.map", agentHalf)])], () => root),
    ).toEqual([]);
  });
});
