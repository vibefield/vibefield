import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_PLACEABLE_LIVE,
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

/** A plugin's record as fieldd holds it. Where a row says nothing of where the plugin came from, it was installed. */
const record = (
  id: string,
  enabled: boolean,
  objects: unknown[],
  requested: string[] = [],
  granted: string[] = requested,
  source: PluginRecord["source"] = "registry",
) =>
  ({
    id,
    enabled,
    source,
    requestedCapabilities: requested,
    grantedCapabilities: granted,
    contributions: { objects },
  }) as unknown as PluginRecord;

/** Every place a plugin can come from (contracts' PluginSource). */
const SOURCES = ["bundled", "dev-linked", "registry", "sideload"] as const;

/** A plugin of the product as its own manifest declares it, read from its folder and never copied. */
const official = (folder: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../plugins", folder, "vibefield.plugin.json"),
      "utf8",
    ),
  ) as { id: string; capabilities: string[]; contributes: { objects: unknown[] } };

/** The one kind the door's list names under the Simulator's pair (contracts' AGENT_PLACEABLE_LIVE). */
const [PHONE = ""] = AGENT_PLACEABLE_LIVE["ios-simulator"];

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

  it("keeps the bundled browser pane a room's kind and a live page's: an agent opens one with the room's row, never canvas_place (R-2; item 581 overturned 2026-11-24)", () => {
    // the pane as its manifest declares and asks: the door's list names no kind under the browser's pair, so the
    // overturn leaves it unplaceable for both reasons, and canvas_place would open it in the desk's signed-in profile
    const manifest = official("browser-pane");
    expect(AGENT_PLACEABLE_LIVE.browser).toEqual([]);
    for (const source of SOURCES) {
      const [kind] = pluginDeskKinds(
        [
          record(
            manifest.id,
            true,
            manifest.contributes.objects,
            manifest.capabilities,
            manifest.capabilities,
            source,
          ),
        ],
        () => undefined,
      );
      expect(kind, source).toMatchObject({
        kind: manifest.id,
        room: "pages",
        livePages: true,
        placeable: false,
      });
    }
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

  it("keeps a kind whose plugin asks a live face's whole pair from an agent, whatever the person granted and wherever the plugin came from (item 581; still the rule for every kind the door's list does not name)", () => {
    for (const pair of Object.values(LIVE_PAGE_SCOPES))
      for (const source of SOURCES) {
        // asked, but revoked by the person's toggle: the request decides, so a re-grant never wakes an agent's object
        const [kind] = pluginDeskKinds(
          [record("com.live", true, [object("live.page", agentHalf)], [...pair], [], source)],
          () => undefined,
        );
        expect(kind, `${source}: ${pair.join("+")}`).toMatchObject({
          placeable: false,
          livePages: true,
        });
      }
  });

  it("lets an agent place the bundled iOS Simulator, by what its own manifest declares and asks, whatever the person granted (item 581 overturned, 2026-11-24)", () => {
    // read at the source, never copied from the list: a kind or a pair renamed in one place and not the other turns this red
    const manifest = official("simulator");
    expect(AGENT_PLACEABLE_LIVE["ios-simulator"]).toEqual([manifest.id]);
    for (const granted of [manifest.capabilities, []]) {
      const [phone] = pluginDeskKinds(
        [
          record(
            manifest.id,
            true,
            manifest.contributes.objects,
            manifest.capabilities,
            granted,
            "bundled",
          ),
        ],
        () => undefined,
      );
      expect(phone).toMatchObject({ kind: manifest.id, placeable: true, tools: [] });
      expect(phone?.livePages).toBeUndefined();
      expect(phone?.room).toBeUndefined();
    }
  });

  it("keeps an iOS Simulator that is not the bundled one the user's to add: a plugin from anywhere else can take the kind's name, never its place on the list", () => {
    const manifest = official("simulator");
    for (const source of SOURCES.filter((from) => from !== "bundled")) {
      const [phone] = pluginDeskKinds(
        [
          record(
            manifest.id,
            true,
            manifest.contributes.objects,
            manifest.capabilities,
            manifest.capabilities,
            source,
          ),
        ],
        () => undefined,
      );
      expect(phone, source).toMatchObject({ placeable: false, livePages: true });
    }
  });

  it("reads the door's list kind by kind: a bundled plugin's other kind under the same pair stays the user's to add", () => {
    const pair = [...LIVE_PAGE_SCOPES["ios-simulator"]];
    const [named, other] = pluginDeskKinds(
      [
        record(
          PHONE,
          true,
          [object(PHONE, agentHalf), object(`${PHONE}.other`, agentHalf)],
          pair,
          pair,
          "bundled",
        ),
      ],
      () => undefined,
    );
    expect(named).toMatchObject({ kind: PHONE, placeable: true });
    expect(named?.livePages).toBeUndefined();
    expect(other).toMatchObject({ kind: `${PHONE}.other`, placeable: false, livePages: true });
  });

  it("keeps a named kind the user's to add under any pair the list does not name it for", () => {
    const own = LIVE_PAGE_SCOPES["ios-simulator"];
    for (const [source, pair] of Object.entries(LIVE_PAGE_SCOPES)) {
      if (source === "ios-simulator") continue;
      // the other pair alone, and beside its own: a page in the desk's profile or another app's window is still live
      for (const requested of [[...pair], [...own, ...pair]]) {
        const [kind] = pluginDeskKinds(
          [record(PHONE, true, [object(PHONE, agentHalf)], requested, requested, "bundled")],
          () => undefined,
        );
        expect(kind, requested.join("+")).toMatchObject({ placeable: false, livePages: true });
      }
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
