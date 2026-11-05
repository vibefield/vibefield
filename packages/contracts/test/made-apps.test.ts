import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalogIdForKind } from "../src/agent-catalog";
import {
  IndexApp,
  IndexAppsCatalogDelta,
  IndexAppsCatalogOpen,
  IndexAppsCatalogSnapshotPage,
  IndexAppsResult,
  IndexAppsSource,
  IndexArtifactEntry,
  IndexArtifactEntryRow,
  IndexArtifactPageResponse,
  IndexArtifactPublicationRow,
  IndexArtifactsResult,
  IndexCatalogApp,
  MADE_APP_AVAILABILITIES,
  MadeAppAvailability,
} from "../src/agent-index";
import {
  ARTIFACT_LIMITS,
  ArtifactCatalogEntry,
  ArtifactId,
  ArtifactMarkParams,
  ArtifactMarkResult,
  ArtifactOpenResult,
  ArtifactStatus,
  ArtifactView,
  artifactRootUrlClaim,
  Blake3Hex,
  MADE_APP_FOLD_KEY_CHARS,
  MADE_APP_PORT_DOMAIN,
  MADE_APP_PREVIEWS_PORT_DOMAIN,
  MadeAppFoldKey,
  MadeAppHostedUrl,
  MadeAppId,
  MadeAppIntentRow,
  MadeAppIntentRows,
  MadeAppOpenRefusal,
  MadeAppPreview,
  MadeAppRegistry,
  MadeAppServeRecord,
  madeAppFoldKey,
  madeAppPreviewUrl,
  Sha256Hex,
} from "../src/artifacts";
import { ErrorData } from "../src/errors";
import { LAYOUT, MADE_APP_LIMITS, MADE_APP_OPEN } from "../src/registries";

// MA-1a (`draft/thinking-mini-apps.md` v0.2, RULED 2026-11-05; the build plan's §1 as the lead
// ruled it) — the made apps' contract, held where a reader would trip: no path ever reaches a row
// or a door, rosetta's grammars and open words, the fold key, the preview with no URL, and the
// numbers and refusal words every side reads.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

const HEX = "cdc9b5a0f9dddc659b00fa9702977bd55d1ed957ec08b4f0b446e468922d818c";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const STUDIO = "https://studio.tail1234.ts.net:14211/";
const FOLD_KEY = "native:claude-code:review";
const row = () => IndexCatalogApp.parse(fixture("index-catalog-app.valid")) as IndexCatalogApp;
const parses = (schema: z.ZodTypeAny, value: unknown) => schema.safeParse(value).success;

describe("no path ever reaches a made app's row or door (MA §4.2, EL2)", () => {
  const forbidden = {
    path: "/tmp/checkout.html",
    recoveredFrom: "/archive/checkout.html",
    recovered_from: "/archive/checkout.html",
    asset: { url: "/api/assets/b021.html" },
  };

  it("refuses each path-bearing key on the row, the fold's row and Versions' entry", () => {
    const fold = (fixture("index-apps.fold") as { rows: object[] }).rows[0];
    const entry = (fixture("index-artifacts.valid") as { entries: object[] }).entries[0];
    const shapes = [
      [IndexCatalogApp, fixture("index-catalog-app.valid") as object],
      [IndexApp, fold],
      [IndexArtifactEntry, entry],
    ] as const;
    for (const [schema, valid] of shapes) {
      expect(parses(schema, valid)).toBe(true);
      for (const [key, value] of Object.entries(forbidden)) {
        expect(parses(schema, { ...valid, [key]: value }), key).toBe(false);
      }
    }
  });

  it("declares no path, no recovered-from path and no asset or its URL on any door's shape", () => {
    const pathy = /path|recovered_?from|^asset|^url$/i;
    const isNever = (field: unknown) =>
      field instanceof z.ZodOptional && field.unwrap() instanceof z.ZodNever;
    const declared = (shape: Record<string, unknown>) =>
      Object.keys(shape).filter((key) => pathy.test(key) && !isNever(shape[key]));
    const shapes = [
      IndexCatalogApp.shape,
      IndexApp.shape,
      IndexArtifactEntry.shape,
      IndexAppsSource.shape,
      MadeAppPreview.shape,
    ];
    for (const shape of shapes) expect(declared(shape)).toEqual([]);
    // the mirror reads rosetta's entry without naming its path or its asset's URL: fieldd has
    // no typed road to either, and `recovered_from` is read for one bit
    expect(Object.keys(IndexArtifactPublicationRow.shape)).not.toContain("path");
    const asset = IndexArtifactEntryRow.shape.asset.unwrap().unwrap();
    expect(Object.keys(asset.shape)).toEqual(["digest", "media_type", "byte_len"]);
  });

  it("reads rosetta's page as the mirror; only a projection without the paths is an entry", () => {
    const page = IndexArtifactPageResponse.parse(fixture("index-artifacts-response.rosetta-29"));
    const wire = page.entries[0]!;
    const publication = wire.publication;
    // the golden carries both paths and the asset's URL; the mirror keeps them, unread
    expect((publication as Record<string, unknown>).path).toBe("/tmp/checkout.html");
    expect(wire.recovered_from).toBe("/archive/checkout.html");
    // the projection a producer writes: VibeField's vocabulary, the paths dropped
    const projected = {
      device: "dev-a",
      presentationId: publication.id,
      appId: publication.artifact_id,
      sessionId: publication.session_id,
      timelineId: publication.timeline_id,
      title: publication.title,
      filename: publication.filename,
      hostedUrl: publication.url ?? undefined,
      nativeId: publication.native_id ?? undefined,
      version: publication.version ?? undefined,
      publishedAt: publication.published_at ?? undefined,
      capturedAt: wire.captured_at ?? undefined,
      availability: wire.availability,
      recovered: wire.recovered_from !== null && wire.recovered_from !== undefined,
      mediaType: wire.asset?.media_type,
      byteLen: wire.asset?.byte_len,
      digest: wire.asset?.digest,
      kind: wire.agent,
      provider: catalogIdForKind(wire.agent),
      versions: wire.presentations,
    };
    const door = IndexArtifactEntry.parse(projected);
    expect(door.recovered).toBe(true);
    expect(door.hostedUrl).toBe("https://claude.ai/code/artifact/review");
    expect(JSON.stringify(door)).not.toMatch(/\/tmp\/|\/archive\/|\/api\/assets\//);
    // the same valid projection with one of rosetta's path keys spread back in is refused, so
    // the refusal can only be that key's
    const leaks = [
      ["path", (publication as Record<string, unknown>).path],
      ["recovered_from", wire.recovered_from],
      ["asset", wire.asset],
    ] as const;
    for (const [key, value] of leaks) {
      expect(value, key).toBeDefined();
      expect(parses(IndexArtifactEntry, { ...projected, [key]: value }), key).toBe(false);
    }
  });

  it("keeps the filename a basename", () => {
    const names = ["a/b.html", "a\\b.html", "/checkout.html", ".", "..", "x\u0000.html", ""];
    for (const filename of names) {
      expect(parses(IndexCatalogApp, { ...row(), filename }), filename).toBe(false);
    }
    expect(parses(IndexCatalogApp, { ...row(), filename: "..checkout.html" })).toBe(true);
  });
});

describe("rosetta's grammars: 64-hex identities and two digests, never a ULID (H1, H8)", () => {
  const bad = [HEX.toUpperCase(), HEX.slice(1), `${HEX}0`, `sha256:${HEX}`, `g${HEX.slice(1)}`];

  it("admits lowercase 64-hex and nothing else", () => {
    for (const schema of [MadeAppId, Blake3Hex, Sha256Hex]) {
      expect(parses(schema, HEX)).toBe(true);
      for (const value of bad) expect(parses(schema, value), value).toBe(false);
    }
  });

  it("keeps a made app out of ArtifactId, and an artifact's ULID out of a made app's id", () => {
    expect(parses(ArtifactId, HEX)).toBe(false);
    expect(parses(MadeAppId, ULID)).toBe(false);
    expect(parses(IndexCatalogApp, { ...row(), appId: ULID })).toBe(false);
  });
});

describe("rosetta's availability words are open: a word it does not know reads unknown", () => {
  it("passes the six words through and folds anything else to unknown", () => {
    expect(MADE_APP_AVAILABILITIES).toEqual([
      "captured",
      "not_captured",
      "missing",
      "too_large",
      "unsupported",
      "changed_during_read",
      "unknown",
    ]);
    for (const word of MADE_APP_AVAILABILITIES) {
      expect(MadeAppAvailability.parse(word)).toBe(word);
    }
    expect(MadeAppAvailability.parse("captured_partially")).toBe("unknown");
    expect(MadeAppAvailability.parse(undefined)).toBe("unknown");
    expect(MadeAppAvailability.parse(7)).toBe("unknown");
  });

  it("costs the row its state, never the row (the child-session golden)", () => {
    const child = IndexCatalogApp.parse(fixture("index-catalog-app.child-session"));
    expect(child.availability).toBe("unknown");
    expect(child.rootSessionId).toBe("ses-9b2f0c7d");
    expect(child.droppedFiles).toBe(2);
    expect(child.description).toBe("A bar chart of the week's tokens, one bar per day.");
  });
});

describe("the hosted link: https only, bounded, never fetched", () => {
  it("admits an https link with a host and refuses everything else", () => {
    expect(parses(MadeAppHostedUrl, "https://claude.ai/code/artifact/review")).toBe(true);
    const refused = [
      "http://claude.ai/code/artifact/review",
      "ftp://claude.ai/x",
      "javascript:alert(1)",
      "https://user:pw@claude.ai/x",
      "https://claude.ai/a b",
      "https://",
      "claude.ai/code/artifact/review",
      "",
    ];
    for (const link of refused) expect(parses(MadeAppHostedUrl, link), link).toBe(false);
  });

  it("is bounded at ARTIFACT_LIMITS.URL_CHARS", () => {
    const base = "https://claude.ai/";
    const at = (length: number) => `${base}${"a".repeat(length - base.length)}`;
    expect(parses(MadeAppHostedUrl, at(ARTIFACT_LIMITS.URL_CHARS))).toBe(true);
    expect(parses(MadeAppHostedUrl, at(ARTIFACT_LIMITS.URL_CHARS + 1))).toBe(false);
  });

  it("costs a row the link it cannot read, never the row", () => {
    const parsed = IndexCatalogApp.parse({ ...row(), hostedUrl: "http://claude.ai/x" });
    expect(parsed.hostedUrl).toBeUndefined();
    expect(parsed.appId).toBe(row().appId);
    const long = IndexCatalogApp.parse({ ...row(), nativeId: "n".repeat(257) });
    expect(long.nativeId).toBeUndefined();
  });
});

describe("what a reader cannot read: a fact costs itself, an identity or a join the row", () => {
  const unreadable = {
    kind: "Claude Code",
    provider: "claude code",
    publishedAt: "soon",
    capturedAt: "soon",
    byteLen: -1,
  };

  it("drops the catalog row's unreadable optional facts and keeps the row", () => {
    const read = IndexCatalogApp.parse({ ...row(), ...unreadable });
    for (const key of Object.keys(unreadable)) {
      expect((read as Record<string, unknown>)[key], key).toBeUndefined();
    }
    expect(read.appId).toBe(row().appId);
    expect(read.title).toBe(row().title);
  });

  it("refuses the catalog row a bad identity, or a join whose absence would say something", () => {
    const strict = [
      ["device", ""],
      ["sessionId", ""],
      ["timelineId", 7],
      ["projectId", ""],
      ["rootSessionId", 7],
    ] as const;
    for (const [key, value] of strict) {
      expect(parses(IndexCatalogApp, { ...row(), [key]: value }), key).toBe(false);
    }
  });

  it("holds Versions' entry to the same rule", () => {
    const entry = (fixture("index-artifacts.valid") as { entries: object[] }).entries[0]!;
    const facts = { ...unreadable, sessionTitle: 7, projectName: 7 };
    const read = IndexArtifactEntry.parse({ ...entry, ...facts });
    for (const key of Object.keys(facts)) {
      expect((read as Record<string, unknown>)[key], key).toBeUndefined();
    }
    for (const [key, value] of [
      ["sessionId", ""],
      ["projectId", ""],
      ["projectKey", "a b"],
    ] as const) {
      expect(parses(IndexArtifactEntry, { ...entry, [key]: value }), key).toBe(false);
    }
  });
});

describe("the peer door's frames declare the owner's standing (libraryReady, previewsBase)", () => {
  it("carries both on the open answer's two arms and on a delta", () => {
    const resumed = IndexAppsCatalogOpen.parse(fixture("index-apps-catalog-open.resumed"));
    expect(resumed).toMatchObject({ libraryReady: false, previewsBase: STUDIO });
    const reset = IndexAppsCatalogOpen.parse(fixture("index-apps-catalog-open.snapshot"));
    expect(reset).toMatchObject({ snapshot: { libraryReady: true, previewsBase: STUDIO } });
    const delta = IndexAppsCatalogDelta.parse(fixture("index-apps-catalog-delta.valid"));
    expect(delta).toMatchObject({ libraryReady: true, previewsBase: STUDIO });
    for (const shape of [IndexAppsCatalogDelta.shape, IndexAppsCatalogSnapshotPage.shape]) {
      expect(Object.keys(shape)).toEqual(expect.arrayContaining(["libraryReady", "previewsBase"]));
    }
  });

  it("costs a frame a standing it cannot read, never the frame, and reads an older owner's silence", () => {
    const delta = IndexAppsCatalogDelta.parse(fixture("index-apps-catalog-delta.valid"));
    const off = { ...delta, libraryReady: "yes", previewsBase: `${STUDIO}previews/` };
    const read = IndexAppsCatalogDelta.parse(off);
    expect(read.libraryReady).toBeUndefined();
    expect(read.previewsBase).toBeUndefined();
    expect(read.upserts).toHaveLength(1);
    const older = { ...delta, libraryReady: undefined, previewsBase: undefined };
    expect(parses(IndexAppsCatalogDelta, older)).toBe(true);
    const epoch = { epoch: "apps-1", revision: 3 };
    const quiet = IndexAppsCatalogOpen.parse({ resumed: epoch, previewsBase: "https://x.ts.net/" });
    expect(quiet).toEqual({ resumed: epoch });
  });
});

describe("previewsBase: a root URL on AH's range, and the image's address derived from it", () => {
  const source = (previewsBase: unknown) => {
    const standing = { device: "dev-a", self: true, state: "live", rows: 0, previewsBase };
    return IndexAppsSource.parse(standing).previewsBase;
  };

  it("admits a root https URL on a port in 10000..19999, with or without its slash", () => {
    const admitted = [
      STUDIO,
      "https://studio.tail1234.ts.net:14211",
      "https://studio.tail1234.ts.net:10000/",
      "https://studio.tail1234.ts.net:19999/",
    ];
    for (const base of admitted) expect(source(base), base).toBe(base);
  });

  it("strips anything else, and keeps the source", () => {
    const stripped = [
      "https://studio.tail1234.ts.net:9999/",
      "https://studio.tail1234.ts.net:20000/",
      "https://studio.tail1234.ts.net/",
      "https://studio.tail1234.ts.net:443/",
      "https://studio.tail1234.ts.net:014211/",
      "http://studio.tail1234.ts.net:14211/",
      "https://studio.tail1234.ts.net:14211/previews/",
      "https://studio.tail1234.ts.net:14211/?v=1",
      "https://studio.tail1234.ts.net:14211/#x",
      "https://me@studio.tail1234.ts.net:14211/",
      "https://STUDIO.tail1234.ts.net:14211/",
      "https://studio.tail1234.ts.net.:14211/",
      "https://studio%2etail1234.ts.net:14211/",
      "https://localhost:14211/",
      7,
    ];
    for (const base of stripped) expect(source(base), String(base)).toBeUndefined();
    const claim = { raw: STUDIO, hostname: "studio.tail1234.ts.net", port: 14211 };
    expect(artifactRootUrlClaim(STUDIO)).toEqual(claim);
  });

  it("derives the image's address from the base and the preview, never from the row", () => {
    const preview = { id: "01JC4MA0PV0000000000000001", digest: HEX };
    const image = `01JC4MA0PV0000000000000001/thumbnail.jpg?v=${HEX}`;
    const laptop = "https://laptop.tail1234.ts.net:16820";
    expect(madeAppPreviewUrl(STUDIO, preview)).toBe(`${STUDIO}${image}`);
    expect(madeAppPreviewUrl(laptop, preview)).toBe(`${laptop}/${image}`);
    expect(madeAppPreviewUrl(`${STUDIO}x/`, preview)).toBeUndefined();
    // the preview has no URL of its own: one is refused rather than carried
    const captured = (fixture("index-catalog-app.valid") as { preview: object }).preview;
    expect(parses(MadeAppPreview, captured)).toBe(true);
    expect(parses(MadeAppPreview, { ...captured, url: `${STUDIO}x` })).toBe(false);
  });
});

describe("the fold key: one spelling, composed by every daemon, compared by every client", () => {
  const app = { device: "dev-a", appId: HEX };
  const hostedUrl = "https://claude.ai/x";

  it("is the native id under its agent's kind, else the hosted link, else the app on its desktop", () => {
    const native = { ...app, kind: "claude-code", nativeId: "review", hostedUrl };
    expect(madeAppFoldKey(native)).toBe("native:claude-code:review");
    expect(madeAppFoldKey({ ...app, hostedUrl })).toBe(`hosted:${hostedUrl}`);
    expect(madeAppFoldKey(app)).toBe(`app:dev-a:${HEX}`);
    expect(madeAppFoldKey({ ...app, kind: "claude-code", nativeId: "" })).toBe(`app:dev-a:${HEX}`);
  });

  it("keeps two agents' equal native ids apart, and one agent's page one app across desktops", () => {
    // rosetta scopes a native id to one runtime (its kind and data root), so the kind is in the key
    const codex = madeAppFoldKey({ ...app, kind: "codex", nativeId: "review" });
    expect(codex).toBe("native:codex:review");
    expect(codex).not.toBe(madeAppFoldKey({ ...app, kind: "claude-code", nativeId: "review" }));
    const laptop = { device: "dev-b", appId: "f".repeat(64), kind: "claude-code" };
    expect(madeAppFoldKey({ ...laptop, nativeId: "review" })).toBe(FOLD_KEY);
    // a kind the row lost has no native form: the app folds less, never wrongly
    expect(madeAppFoldKey({ ...app, nativeId: "review", hostedUrl })).toBe(`hosted:${hostedUrl}`);
    const unread = IndexCatalogApp.parse({ ...row(), kind: "Claude Code" });
    expect(unread.kind).toBeUndefined();
    expect(madeAppFoldKey(unread)).toBe(`hosted:${unread.hostedUrl}`);
  });

  it("is what every fold golden carries for its serving row", () => {
    const goldens = ["valid", "mesh", "tailnet", "fold"].map((variant) => `index-apps.${variant}`);
    for (const name of goldens) {
      for (const served of IndexAppsResult.parse(fixture(name)).rows) {
        expect(served.foldKey, name).toBe(madeAppFoldKey(served));
        expect(served.appKey, name).toBe(`${served.device}:${served.appId}`);
      }
    }
  });

  it("refuses a key with no known prefix, and bounds the longest form", () => {
    expect(parses(MadeAppFoldKey, "review")).toBe(false);
    expect(parses(MadeAppFoldKey, "native:")).toBe(false);
    expect(MADE_APP_FOLD_KEY_CHARS).toBe("hosted:".length + ARTIFACT_LIMITS.URL_CHARS);
    const link = `https://claude.ai/${"a".repeat(ARTIFACT_LIMITS.URL_CHARS - 18)}`;
    const longest = `hosted:${link}`;
    expect(longest.length).toBe(MADE_APP_FOLD_KEY_CHARS);
    expect(parses(MadeAppFoldKey, longest)).toBe(true);
    expect(parses(MadeAppFoldKey, `${longest}a`)).toBe(false);
  });

  it("keeps the fold's goldens whole through the parse (no fact quietly dropped)", () => {
    const fold = IndexAppsResult.parse(fixture("index-apps.fold"));
    const served = fold.rows[0]!;
    expect(served.devices).toHaveLength(2);
    expect(served.kept).toBe(true);
    expect(served.preview?.digest).toBe(row().preview?.digest);
    const bases = fold.sources.map((s) => s.previewsBase);
    expect(bases).toEqual([STUDIO, "https://laptop.tail1234.ts.net:16820"]);
    const mesh = IndexAppsResult.parse(fixture("index-apps.mesh"));
    const standing = mesh.sources.map((s) => [s.state, s.libraryReady]);
    expect(standing).toEqual([
      ["live", true],
      ["asleep", false],
    ]);
    const versions = IndexArtifactsResult.parse(fixture("index-artifacts.valid"));
    expect(versions.entries.map((e) => e.recovered)).toEqual([false, true]);
  });
});

describe("the acts: artifact.open's answers and refusals, artifact.mark's set semantics", () => {
  it("reads a state it does not know as starting, and drops a url or reach it cannot read", () => {
    expect(ArtifactOpenResult.parse({ state: "serving-elsewhere" }).state).toBe("starting");
    const synthesized = ArtifactOpenResult.parse({ state: "serving", url: "https://x.ts.net/" });
    expect(synthesized.url).toBeUndefined();
    const hosts = (n: number) => Array.from({ length: n }, (_, i) => `h${i}.example.com`);
    const wide = hosts(MADE_APP_LIMITS.REACH_HOSTS + 1);
    expect(ArtifactOpenResult.parse({ state: "serving", reach: wide }).reach).toBeUndefined();
    const serving = ArtifactOpenResult.parse(fixture("artifact-open.serving"));
    expect(serving.url).toBe("https://studio.tail1234.ts.net:13377");
    expect(serving.reach).toEqual(["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"]);
  });

  it("names its refusals in MADE_APP_OPEN's words, each an UNAVAILABLE naming its desktop", () => {
    const refusals = [
      ["error-data.apps-export-unbuilt", MADE_APP_OPEN.STATE_EXPORT_UNBUILT, false],
      ["error-data.apps-not-kept", MADE_APP_OPEN.STATE_NOT_KEPT, false],
      ["error-data.apps-reading", MADE_APP_OPEN.STATE_READING, true],
    ] as const;
    for (const [name, state, retryable] of refusals) {
      const data = ErrorData.parse(fixture(name));
      expect(data.kind, name).toBe("UNAVAILABLE");
      expect(data.retryable, name).toBe(retryable);
      const details = MadeAppOpenRefusal.parse(data.details);
      expect(details.service, name).toBe(MADE_APP_OPEN.SERVICE);
      expect(details.state, name).toBe(state);
      expect(details.device, name).toBeDefined();
    }
    const indexWords = { service: "index", state: "not-kept" };
    expect(parses(MadeAppOpenRefusal, indexWords)).toBe(false);
  });

  it("marks with at least one flag, and answers both", () => {
    const foldKey = FOLD_KEY;
    expect(parses(ArtifactMarkParams, { foldKey })).toBe(false);
    expect(parses(ArtifactMarkParams, { foldKey, hidden: false })).toBe(true);
    expect(parses(ArtifactMarkParams, { foldKey: "review", kept: true })).toBe(false);
    expect(parses(ArtifactMarkResult, { foldKey, kept: true })).toBe(false);
    expect(parses(ArtifactMarkResult, { foldKey, kept: true, hidden: false })).toBe(true);
  });

  it("keeps intent as present-only flags, bounded by MADE_APP_LIMITS.INTENTS", () => {
    const intent = MadeAppIntentRow.parse(fixture("made-app-intent.valid"));
    expect(intent).toMatchObject({ foldKey: FOLD_KEY, kept: true });
    expect(intent.hidden).toBeUndefined();
    const cleared = { foldKey: FOLD_KEY, kept: false, updatedAt: 1 };
    expect(parses(MadeAppIntentRow, cleared)).toBe(false);
    const one = { foldKey: FOLD_KEY, updatedAt: 1 };
    const rows = (n: number) => parses(MadeAppIntentRows, Array(n).fill(one));
    expect(rows(MADE_APP_LIMITS.INTENTS)).toBe(true);
    expect(rows(MADE_APP_LIMITS.INTENTS + 1)).toBe(false);
  });
});

describe("the origin's private serve registry", () => {
  it("reads a serve state it does not know as closed: nothing listens until a person opens it", () => {
    const registry = MadeAppRegistry.parse(fixture("made-app-registry.valid"));
    expect(registry.apps.map((a) => a.state)).toEqual(["open", "closed"]);
    const record = registry.apps[0]!;
    expect(MadeAppServeRecord.parse({ ...record, state: "kept" }).state).toBe("closed");
    expect(parses(MadeAppServeRecord, { ...record, listenPort: 9999 })).toBe(false);
    expect(parses(MadeAppServeRecord, { ...record, listenPort: 20000 })).toBe(false);
  });

  it("names the port rule's two domains, apart from AH's", () => {
    expect(MADE_APP_PORT_DOMAIN).toBe("made-app-port-v1\0");
    expect(MADE_APP_PREVIEWS_PORT_DOMAIN).toBe("made-app-previews-v1\0");
    const domains = [MADE_APP_PORT_DOMAIN, MADE_APP_PREVIEWS_PORT_DOMAIN, "artifact-port-v1\0"];
    expect(new Set(domains).size).toBe(3);
  });

  it("keeps the made rows beside AH's previews and the history catalog's replicas", () => {
    expect(LAYOUT.ARTIFACT_MADE_DIR).toEqual(["artifacts", "made"]);
    expect(LAYOUT.ARTIFACT_MADE_PREVIEWS_DIR).toEqual(["artifacts", "made-previews"]);
    expect(LAYOUT.MESH_APPS_DIR).toEqual(["mesh", "apps"]);
    expect(LAYOUT.ARTIFACT_MADE_DIR[0]).toBe(LAYOUT.ARTIFACT_PREVIEWS_DIR[0]);
    expect(LAYOUT.MESH_APPS_DIR[0]).toBe(LAYOUT.MESH_CATALOG_DIR[0]);
  });
});

describe("MADE_APP_LIMITS and MADE_APP_OPEN are pinned (a move is a deliberate edit)", () => {
  it("pins the made apps' numbers", () => {
    expect(MADE_APP_LIMITS).toEqual({
      ROWS: 4096,
      WALK_PAGE: 100,
      WALK_RESTARTS: 3,
      REREAD_DELAY_MS: 2_000,
      REREAD_MIN_INTERVAL_MS: 10_000,
      REREAD_PAGE: 20,
      IDLE_CLOSE_MS: 24 * 60 * 60_000,
      OPEN_WAIT_MS: 4_000,
      DESCRIPTION_CHARS: 512,
      REACH_HOSTS: 16,
      INTENTS: 4096,
      NATIVE_ID_CHARS: 256,
    });
  });

  it("pins the open's refusal words", () => {
    expect(MADE_APP_OPEN).toEqual({
      SERVICE: "apps",
      STATE_EXPORT_UNBUILT: "export-unbuilt",
      STATE_NOT_KEPT: "not-kept",
      STATE_TOO_LARGE: "too-large",
      STATE_UNSUPPORTED: "unsupported",
      STATE_READING: "library-reading",
      STATE_EXPORT_FAILED: "export-failed",
      STATE_NOT_LINKED: "not-linked",
      STATE_INTENT_UNBUILT: "intent-unbuilt",
      RESOURCE: "apps",
    });
  });
});

describe("a made app never rides the live artifacts' view (H2)", () => {
  it("leaves ArtifactView's kind the two live words, and refuses a third", () => {
    expect(ArtifactView.shape.kind.options).toEqual(["proxy", "folder"]);
    expect(ArtifactCatalogEntry.shape.kind.options).toEqual(["proxy", "folder"]);
    expect(ArtifactStatus.shape.kind.options).toEqual(["proxy", "folder"]);
    const view = fixture("artifact-view.valid") as object;
    expect(parses(ArtifactView, view)).toBe(true);
    expect(parses(ArtifactView, { ...view, kind: "made" })).toBe(false);
  });
});
