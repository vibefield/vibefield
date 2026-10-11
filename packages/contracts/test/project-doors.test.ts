// PJ-3 — the `project.*` doors' contract (project-doors.ts; PJ-D15 (a);
// build-pj23.md D8–D10; P1/P2 RULED (a) 2026-10-08): the five rows as the
// registry declares them, P1's request rule (a place by `PlaceRef`, never a
// path — wherever a path-carrying key sits), the anchor a request may name,
// the acts' shapes, and the tolerant reader on an answer. The fixtures parse
// in fixtures.test.ts; the doors themselves are fieldd's (project-doors.test.ts
// there, and the phone's witness over the real door).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import {
  PROJECT_PATH_KEYS,
  ProjectGetParams,
  ProjectIntentParams,
  ProjectListParams,
  ProjectSessionsParams,
  ProjectSummary,
  pathKeyIn,
} from "../src/project-doors";
import { PROJECT_DOORS } from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

const REF = { device: "dev-a", placeId: "pl_1" };

describe("PJ-3 — the project doors in the registry (D8)", () => {
  it("declares the reads on project.read and the act on settings.manage", () => {
    const rows = METHODS.filter((m) => m.method.startsWith("project.")).map((m) => ({
      method: m.method,
      scope: m.scope,
      idempotent: m.idempotent,
      locality: m.locality,
      subscription: m.subscription ?? false,
    }));
    expect(rows).toEqual([
      // served from this desktop's merged view: the index.projects precedent
      {
        method: "project.list",
        scope: "project.read",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      {
        method: "project.get",
        scope: "project.read",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      {
        method: "project.sessions",
        scope: "project.read",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      // PJ-4 — the merged figures: reads of the same aggregate
      {
        method: "project.figures",
        scope: "project.read",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      {
        method: "project.figuresDay",
        scope: "project.read",
        idempotent: true,
        locality: "federate",
        subscription: false,
      },
      {
        method: "project.subscribe",
        scope: "project.read",
        idempotent: true,
        locality: "stream",
        subscription: { shape: "rows", cadenceFloorMs: PROJECT_DOORS.CHANGES_MIN_INTERVAL_MS },
      },
      // an act on the library: sync (doc.rename's precedent); a desktop
      // window's scope (P2); every act carries its own time, so no blind repeat
      {
        method: "project.intent",
        scope: "settings.manage",
        idempotent: false,
        locality: "sync",
        subscription: false,
      },
    ]);
  });

  it("sits right after the index doors it amends (DS §6.4)", () => {
    const names = METHODS.map((m) => m.method);
    expect(names.indexOf("project.list")).toBe(names.indexOf("index.session.subscribe") + 1);
  });
});

describe("P1 (a) — a request names a place by PlaceRef, never by a path", () => {
  it("finds a path-carrying key wherever it sits, and says where", () => {
    expect(pathKeyIn({ key: "k", places: [REF, { ...REF, path: "/Users/me/x" }] })).toBe(
      "places.1.path",
    );
    expect(pathKeyIn({ op: "link", place: { ...REF, cwd: "/x" } })).toBe("place.cwd");
    expect(pathKeyIn({ path: "/x" })).toBe("path");
    expect(pathKeyIn({ key: "k", places: [REF] })).toBeUndefined();
    // every key the rule names, at the top and in a place
    for (const key of PROJECT_PATH_KEYS) {
      expect(pathKeyIn({ [key]: "/x" }), key).toBe(key);
      expect(pathKeyIn({ place: { ...REF, [key]: "/x" } }), key).toBe(`place.${key}`);
    }
  });

  it("refuses one in every request shape, with the reason a door carries", () => {
    const refused = [
      ProjectListParams.safeParse({ path: "/Users/me/app" }),
      ProjectListParams.safeParse({ devices: ["dev-a"], cwd: "/Users/me/app" }),
      ProjectGetParams.safeParse({ key: "p1:x", path: "/Users/me/app" }),
      ProjectSessionsParams.safeParse({ key: "p1:x", places: [{ ...REF, path: "/Users/me" }] }),
      ProjectIntentParams.safeParse({ key: "p1:x", op: "link", place: { ...REF, path: "/x" } }),
      ProjectIntentParams.safeParse({ key: "p1:x", op: "split", place: { ...REF, folder: "x" } }),
      ProjectIntentParams.safeParse({ key: "p1:x", op: "rename", name: "a", rootPath: "/x" }),
    ];
    for (const result of refused) {
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain("path-in-request");
    }
    // and the same asks without it pass
    expect(ProjectSessionsParams.safeParse({ key: "p1:x", places: [REF] }).success).toBe(true);
    expect(ProjectIntentParams.safeParse({ key: "p1:x", op: "link", place: REF }).success).toBe(
      true,
    );
  });

  it("takes an anchor that is evidence or an opaque place, never a folder", () => {
    const ok = (anchor: string) => ProjectGetParams.safeParse({ anchor }).success;
    expect(ok(`root:${"a".repeat(40)}`)).toBe(true);
    expect(ok(`root:${"b".repeat(64)}`)).toBe(true);
    expect(ok("remote:github.com/acme/app")).toBe(true);
    expect(ok("place:pl_4c1e9a0b7d2f6e8a1b3c5d7e")).toBe(true);
    // a local-path remote spells a folder; a place anchor is an id, not a path
    expect(ok("remote:local:/Users/me/app")).toBe(false);
    expect(ok("place:/Users/me/app")).toBe(false);
    expect(ok("place:C:\\src\\app")).toBe(false);
    expect(ok("root:not-a-sha")).toBe(false);
    expect(ok("/Users/me/app")).toBe(false);
  });

  it("takes exactly one of key or anchor", () => {
    expect(ProjectGetParams.safeParse({}).success).toBe(false);
    expect(ProjectGetParams.safeParse({ key: "p1:x", anchor: "place:pl_1" }).success).toBe(false);
    expect(ProjectGetParams.safeParse({ key: "p1:x" }).success).toBe(true);
  });
});

describe("P2 (a) — the acts", () => {
  it("knows six acts, each with its own argument", () => {
    const asks = [
      { op: "rename", name: "VibeField" },
      { op: "pin", pinned: true },
      { op: "hide", hidden: false },
      { op: "link", place: REF },
      { op: "split", place: REF },
      { op: "dismiss", with: "p1:other" },
    ];
    for (const ask of asks)
      expect(ProjectIntentParams.safeParse({ key: "p1:x", ...ask }).success, ask.op).toBe(true);
    // an act it does not know, or one missing its argument, is refused
    expect(ProjectIntentParams.safeParse({ key: "p1:x", op: "delete" }).success).toBe(false);
    expect(ProjectIntentParams.safeParse({ key: "p1:x", op: "link" }).success).toBe(false);
    expect(ProjectIntentParams.safeParse({ key: "p1:x", op: "rename", name: "   " }).success).toBe(
      false,
    );
    expect(
      ProjectIntentParams.safeParse({
        key: "p1:x",
        op: "rename",
        name: "x".repeat(PROJECT_DOORS.NAME_MAX + 1),
      }).success,
    ).toBe(false);
  });
});

describe("the tolerant reader on an answer", () => {
  it("reads a newer place class as folder and a newer bucket as no bucket, keeping unknown keys", () => {
    const { "//": _note, ...summary } = fixture("project-summary.valid.json");
    const places = summary["places"] as Array<Record<string, unknown>>;
    const parsed = ProjectSummary.parse({
      ...summary,
      kind: "monorepo",
      bucket: "archive",
      pinned: true,
      places: [{ ...places[0], class: "submodule" }],
    }) as ProjectSummary & { pinned?: unknown };
    expect(parsed.kind).toBe("folder");
    expect(parsed.bucket).toBeNull();
    expect(parsed.places[0]?.class).toBe("folder");
    expect(parsed.pinned).toBe(true);
  });

  it("J11 — a desktop's Home is a project on one device; Temporary is the only bucket", () => {
    const { "//": _note, ...home } = fixture("project-summary.home.json");
    const parsed = ProjectSummary.parse(home);
    expect(parsed).toMatchObject({ kind: "home", bucket: null, nameFrom: "home" });
    expect(parsed.devices).toHaveLength(1);
    expect(parsed.places.every((place) => place.ref.device === parsed.devices[0])).toBe(true);
    // the retired Home bucket reads as no bucket; Temporary stays one
    expect(ProjectSummary.parse({ ...home, bucket: "home" }).bucket).toBeNull();
    expect(ProjectSummary.parse({ ...home, kind: "temp", bucket: "temp" }).bucket).toBe("temp");
  });

  it("the tailnet fixture is the window's with what D10 strips taken out", () => {
    const { "//": _a, ...window } = fixture("project-summary.valid.json");
    const { "//": _b, ...tailnet } = fixture("project-summary.tailnet.json");
    const stripped = {
      ...window,
      places: (window["places"] as Array<Record<string, unknown>>).map(
        ({ path: _path, ...place }) => place,
      ),
      anchors: (window["anchors"] as string[]).filter((anchor) => anchor.startsWith("place:")),
    };
    expect(tailnet).toEqual(stripped);
    expect(JSON.stringify(tailnet)).not.toMatch(/\/Users\/|github\.com|root:/);
  });
});
