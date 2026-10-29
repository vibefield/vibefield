// AU-1 — the updater's view grows (`currentVersion`, `stagedAt`, `lastApply`), and the persisted state learns what an
// apply landed as (`UpdateLastApply.from`/`trigger`/`landed`, `UpdateClientStateFile.staged`). Every persisted addition
// is TOLERANT: an older app reads a newer state.json (a channel downgrade, EDP-36), and a malformed field drops alone —
// never the whole file, which `state-store.ts` would move aside, resetting `declined` and `remembered`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StagedReleaseIdentity } from "../src/release-identity";
import {
  BETA_TAG_PATTERN,
  compareDottedVersions,
  compareReleaseVersions,
  NIGHTLY_TAG_PATTERN,
  RELEASE_NOTES_LIMITS,
  ReleaseManifest,
  ReleaseNotes,
  releaseChannelOf,
  releaseName,
  releaseTagOf,
  STABLE_TAG_PATTERN,
  UpdateCheckResult,
  UpdateClientStateFile,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateMoveResult,
  UpdateView,
} from "../src/update-policy";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const golden = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

const CUR = "0.1.0-nightly.20261027";
const NEXT = "0.1.0-nightly.20261028";

/** The landed state file with one part of it replaced. */
function landedWith(patch: {
  readonly lastApply?: Record<string, unknown>;
  readonly staged?: unknown;
}): Record<string, unknown> {
  const doc = golden("update-client-state.landed.json");
  const lastApply = doc["lastApply"] as Record<string, unknown>;
  return {
    ...doc,
    ...(patch.lastApply !== undefined ? { lastApply: { ...lastApply, ...patch.lastApply } } : {}),
    ...("staged" in patch ? { staged: patch.staged } : {}),
  };
}

describe("AU-1 — the persisted apply record and the staged clock (tolerant)", () => {
  it("parses the landed record: from, trigger, landed and staged", () => {
    const state = UpdateClientStateFile.parse(golden("update-client-state.landed.json"));
    expect(state.lastApply).toMatchObject({
      version: NEXT,
      branch: "installing",
      audited: true,
      from: CUR,
      trigger: "restart",
      landed: { at: 1793178007000, outcome: "installed" },
    });
    expect(state.staged).toEqual({ version: NEXT, at: 1792400400000 });
  });

  it("reads an older app's record with every AU-1 field absent, and no staged clock", () => {
    const state = UpdateClientStateFile.parse(golden("update-client-state.last-apply.json"));
    expect(state.lastApply).not.toBeNull();
    expect(state.lastApply?.from).toBeUndefined();
    expect(state.lastApply?.trigger).toBeUndefined();
    expect(state.lastApply?.landed).toBeUndefined();
    expect(state.staged).toBeNull();
  });

  it("drops a malformed landed, trigger or from alone, and keeps the file", () => {
    const badLanded = UpdateClientStateFile.safeParse(
      landedWith({ lastApply: { landed: { at: -1, outcome: "maybe" } } }),
    );
    expect(badLanded.success).toBe(true);
    expect(badLanded.data?.lastApply?.landed).toBeUndefined();
    expect(badLanded.data?.lastApply?.from).toBe(CUR);
    expect(badLanded.data?.declined).toEqual([]);

    // a trigger a NEWER app wrote that this one does not know drops alone, never refuses the file
    const badTrigger = UpdateClientStateFile.safeParse(
      landedWith({ lastApply: { trigger: "logout" } }),
    );
    expect(badTrigger.success).toBe(true);
    expect(badTrigger.data?.lastApply?.trigger).toBeUndefined();
    expect(badTrigger.data?.lastApply?.landed).toEqual({ at: 1793178007000, outcome: "installed" });

    const badFrom = UpdateClientStateFile.safeParse(landedWith({ lastApply: { from: 7 } }));
    expect(badFrom.success).toBe(true);
    expect(badFrom.data?.lastApply?.from).toBeUndefined();
    expect(badFrom.data?.lastApply?.trigger).toBe("restart");
  });

  it("reads a malformed staged clock as nothing staged, and keeps the file", () => {
    for (const staged of ["soon", { version: "", at: 1 }, { version: NEXT, at: -5 }, 3]) {
      const parsed = UpdateClientStateFile.safeParse(landedWith({ staged }));
      expect(parsed.success, JSON.stringify(staged)).toBe(true);
      expect(parsed.data?.staged).toBeNull();
      expect(parsed.data?.lastApply?.landed?.outcome).toBe("installed");
    }
  });

  it("still REFUSES an unknown branch: that enum never grows", () => {
    // an older app reading a branch it does not know would move the whole file aside (`state-store.ts`)
    const parsed = UpdateClientStateFile.safeParse(landedWith({ lastApply: { branch: "quit" } }));
    expect(parsed.success).toBe(false);
  });
});

describe("AU-1 — the view's new fields", () => {
  it("reads today's view unchanged (the tolerant-reader witness)", () => {
    const view = UpdateView.parse(golden("update-view.pre-au1.json"));
    expect(view.currentVersion).toBeUndefined();
    expect(view.stagedAt).toBeUndefined();
    expect(view.lastApply).toBeUndefined();
  });

  it("carries the running version, the staged clock and the judged last apply", () => {
    expect(UpdateView.parse(golden("update-view.idle.json")).currentVersion).toBe(CUR);
    expect(UpdateView.parse(golden("update-view.staged-since.json")).stagedAt).toBe(1792400400000);
    expect(UpdateView.parse(golden("update-view.updated.json")).lastApply).toEqual({
      version: NEXT,
      from: CUR,
      outcome: "installed",
      at: 1793178007000,
      trigger: "restart",
      thisLaunch: true,
    });
    expect(UpdateView.parse(golden("update-view.not-applied.json")).lastApply?.outcome).toBe(
      "not-applied",
    );
  });

  it("refuses a lastApply outcome it does not know (main and the preload are one build)", () => {
    const view = golden("update-view.updated.json");
    const lastApply = view["lastApply"] as Record<string, unknown>;
    expect(
      UpdateView.safeParse({ ...view, lastApply: { ...lastApply, outcome: "maybe" } }).success,
    ).toBe(false);
  });
});

describe("AU-1 — the two doors' shapes", () => {
  it("answers a person's check with an outcome, and a version when one was found", () => {
    expect(UpdateCheckResult.parse(golden("update-check-result.up-to-date.json"))).toEqual({
      outcome: "up-to-date",
    });
    expect(UpdateCheckResult.parse(golden("update-check-result.found.json"))).toEqual({
      outcome: "found",
      version: NEXT,
    });
    expect(UpdateCheckResult.safeParse({ outcome: "maybe" }).success).toBe(false);
  });

  it("asks for one version, and answers ok or a refusal in main's words", () => {
    expect(UpdateDownloadRequest.safeParse({ version: "" }).success).toBe(false);
    expect(UpdateDownloadRequest.safeParse({ version: NEXT, path: "/tmp/x" }).success).toBe(false);
    expect(UpdateDownloadResult.parse({ ok: true })).toEqual({ ok: true });
    expect(
      UpdateDownloadResult.parse({
        ok: false,
        reason: "yanked",
        words: { message: "VibeField didn't download the update", detail: "It was withdrawn." },
      }),
    ).toMatchObject({ ok: false, reason: "yanked" });
    expect(UpdateDownloadResult.safeParse({ ok: false }).success).toBe(false);
  });
});

describe("AU-1 (LC-2) — releaseName: one friendly name for a version", () => {
  it("names a nightly by the UTC day its version carries", () => {
    expect(releaseName(NEXT)).toBe("the Oct 28 nightly");
    expect(releaseName(NEXT, { start: true })).toBe("The Oct 28 nightly");
    expect(releaseName("0.1.0-nightly.20261002")).toBe("the Oct 2 nightly");
  });

  it("says a nightly whose day is not a real date as its exact version", () => {
    expect(releaseName("0.1.0-nightly.20261399")).toBe("VibeField 0.1.0-nightly.20261399");
    expect(releaseName("0.1.0-nightly.20260230", { start: true })).toBe(
      "VibeField 0.1.0-nightly.20260230",
    );
  });

  it("names a beta, a stable and anything else", () => {
    expect(releaseName("0.2.0-beta.3")).toBe("VibeField 0.2.0 beta 3");
    expect(releaseName("0.2.0")).toBe("VibeField 0.2.0");
    expect(releaseName("0.2.0", { start: true })).toBe("VibeField 0.2.0");
    expect(releaseName("dev")).toBe("VibeField dev");
  });
});

// AU-3a (X24) — the rows moved here from electron-shell's decide.test.ts with the two orders themselves.
describe("AU-3a (X24) — one version order, main's and the window's", () => {
  it("compares dotted versions, failing closed on a part that is not a number", () => {
    expect(compareDottedVersions("15.1.0", "15.0")).toBeGreaterThan(0);
    expect(compareDottedVersions("14.6.1", "15")).toBeLessThan(0);
    expect(compareDottedVersions("15", "15.0.0")).toBe(0);
    expect(compareDottedVersions("15.x", "15")).toBeNaN();
  });

  it("orders release versions by semver precedence, never as strings", () => {
    expect(compareReleaseVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareReleaseVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
    expect(compareReleaseVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(
      compareReleaseVersions("1.0.0-nightly.20261016", "1.0.0-nightly.20261015"),
    ).toBeGreaterThan(0);
    expect(compareReleaseVersions(NEXT, CUR)).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareReleaseVersions("1.x.0", "1.0.0")).toBeNaN();
  });
});

// AU-3 (LC-20) — a version's channel by its shape: the window says older or newer only within one channel.
describe("AU-3 (LC-20) — releaseChannelOf: a version's channel by its shape", () => {
  it("names the three shapes release-plan.mjs writes, and null for anything else", () => {
    expect(releaseChannelOf(CUR)).toBe("nightly");
    expect(releaseChannelOf("0.2.0-beta.3")).toBe("beta");
    expect(releaseChannelOf("0.2.0")).toBe("stable");
    expect(releaseChannelOf("dev")).toBeNull();
    expect(releaseChannelOf("0.2.0-rc.1")).toBeNull();
    expect(releaseChannelOf("0.1.0-nightly.2026102")).toBeNull();
  });
});

// AU-7 (AU-G8; LC-10, LC-37) — where the app runs, and the Move door's answer.
describe("AU-7 — the view's location and the Move door", () => {
  it("carries the three locations, absent off macOS (today's views have none)", () => {
    expect(UpdateView.parse(golden("update-view.read-only.json")).location).toBe("read-only");
    expect(UpdateView.parse(golden("update-view.elsewhere.json")).location).toBe("elsewhere");
    expect(UpdateView.parse(golden("update-view.idle.json")).location).toBeUndefined();
    const view = golden("update-view.idle.json");
    expect(UpdateView.parse({ ...view, location: "applications" }).location).toBe("applications");
    // main and the preload are one build: a location it does not know is a wire error, never a guess
    expect(UpdateView.safeParse({ ...view, location: "downloads" }).success).toBe(false);
  });

  it("answers proceed or cancel, or a refusal before anything stops", () => {
    expect(UpdateMoveResult.parse(golden("update-move-result.proceed.json"))).toEqual({
      ok: true,
      outcome: "proceed",
    });
    expect(UpdateMoveResult.parse(golden("update-move-result.busy.json"))).toEqual({
      ok: false,
      reason: "busy",
    });
    expect(UpdateMoveResult.parse({ ok: true, outcome: "cancel" })).toEqual({
      ok: true,
      outcome: "cancel",
    });
    expect(UpdateMoveResult.safeParse({ ok: true }).success).toBe(false);
    expect(UpdateMoveResult.safeParse({ ok: true, outcome: "moved" }).success).toBe(false);
    expect(UpdateMoveResult.safeParse({ ok: false }).success).toBe(false);
  });
});

// AU-6 (AU-D10 A; LC-19; EDP §11.1 as amended) — a release's notes are signed plain text inside its manifest: a line is
// one line of text, never markup; the manifest declares them loosely so an installed client's chain never refuses on
// them; the persisted copies are tolerant; the one link is main's, composed from two tags (`releaseTagOf`).
describe("AU-6 — releaseTagOf: the tag a release version was published under", () => {
  it("inverts release-plan.mjs's three shapes, and is null for anything else", () => {
    expect(releaseTagOf(NEXT)).toBe("nightly-20261028");
    expect(releaseTagOf("0.2.0-beta.3")).toBe("v0.2.0-beta.3");
    expect(releaseTagOf("0.2.0")).toBe("v0.2.0");
    expect(releaseTagOf("dev")).toBeNull();
    expect(releaseTagOf("0.2.0-rc.1")).toBeNull();
    expect(releaseTagOf("0.1.0-nightly.2026102")).toBeNull();
    expect(releaseTagOf("v0.2.0")).toBeNull();
  });

  it("names a tag the channel heads' own patterns accept", () => {
    expect(NIGHTLY_TAG_PATTERN.test(releaseTagOf(CUR) ?? "")).toBe(true);
    expect(BETA_TAG_PATTERN.test(releaseTagOf("0.2.0-beta.3") ?? "")).toBe(true);
    expect(STABLE_TAG_PATTERN.test(releaseTagOf("0.2.0") ?? "")).toBe(true);
  });
});

describe("AU-6 — ReleaseNotes: signed plain text, bounded", () => {
  const LOG = golden("release-manifest.notes-log.json")["notes"] as Record<string, unknown>;
  const WRITTEN = golden("release-manifest.notes-written.json")["notes"] as Record<string, unknown>;
  const written = (lines: unknown[]) => ReleaseNotes.safeParse({ ...WRITTEN, lines }).success;
  const log = (patch: Record<string, unknown>) =>
    ReleaseNotes.safeParse({ ...LOG, ...patch }).success;
  const changes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ track: `T${i + 1}`, text: "a change" }));

  it("holds the limits LC-19 rules", () => {
    expect(RELEASE_NOTES_LIMITS).toEqual({
      WRITTEN_LINES: 8,
      LOG_LINES: 4,
      LINE_CHARS: 200,
      TRACK_CHARS: 24,
    });
  });

  it("reads both manifest fixtures' notes", () => {
    const fromLog = ReleaseNotes.parse(LOG);
    expect(fromLog.kind).toBe("log");
    expect(fromLog).toMatchObject({
      since: { version: CUR, tag: "nightly-20261027" },
      commits: 103,
      product: 58,
    });
    expect(fromLog.lines).toHaveLength(4);
    const fromWritten = ReleaseNotes.parse(WRITTEN);
    expect(fromWritten.kind).toBe("written");
    expect(fromWritten.since).toBeNull();
    expect(fromWritten.lines).toHaveLength(3);
  });

  it("refuses a ninth written line and a fifth log line, and takes exactly the limit", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`);
    expect(written(eight)).toBe(true);
    expect(written([...eight, "line 9"])).toBe(false);
    expect(written([])).toBe(false);
    expect(log({ lines: changes(4) })).toBe(true);
    expect(log({ lines: changes(5) })).toBe(false);
    // a night whose subjects are all docs says its count alone
    expect(log({ lines: [] })).toBe(true);
  });

  it("refuses a line over 200 characters, and a track over 24", () => {
    expect(written(["x".repeat(200)])).toBe(true);
    expect(written(["x".repeat(201)])).toBe(false);
    expect(log({ lines: [{ track: "T".repeat(24), text: "a change" }] })).toBe(true);
    expect(log({ lines: [{ track: "T".repeat(25), text: "a change" }] })).toBe(false);
  });

  it("refuses a second line, a control character and a format character (bidi override, zero width)", () => {
    for (const text of [
      "two\nlines",
      "a\ttab",
      "a line separator",
      "reversed \u202etxt.exe",
      "zero\u200bwidth",
    ]) {
      expect(written([text]), JSON.stringify(text)).toBe(false);
      expect(log({ lines: [{ track: "AU", text }] }), JSON.stringify(text)).toBe(false);
    }
    // plain text that is not ASCII is still plain text
    expect(written(["Settings → Updates says what's new"])).toBe(true);
  });

  it("refuses a log whose product count exceeds its commits, and a log with no since", () => {
    expect(log({ product: 103 })).toBe(true);
    expect(log({ product: 104 })).toBe(false);
    expect(log({ since: null })).toBe(false);
    expect(ReleaseNotes.safeParse({ ...LOG, kind: "markdown" }).success).toBe(false);
  });
});

// The release manifest exactly as every app through `dba4e1d6e` parses it (`update-policy.ts`), frozen HERE and never
// imported: it is what an installed client already runs, and a new manifest's notes must ride past it.
const SHIPPED_PLANES = ["shell", "fieldd", "field-native"] as const;
const SHIPPED_V1 = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
    tag: z.string().min(1).max(128),
    channel: z.enum(["nightly", "beta", "stable"]),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    builds: z.record(
      z.string().min(1).max(32),
      z.record(
        z.enum(SHIPPED_PLANES),
        z.object({
          digest: z.string().regex(/^[0-9a-f]{64}$/),
          files: z.number().int().nonnegative(),
          members: z.array(z.string().min(1).max(256)).max(64).optional(),
        }),
      ),
    ),
    touched: z.array(z.enum(SHIPPED_PLANES)),
    previous: z.string().min(1).max(128).nullable(),
  })
  .passthrough()
  .superRefine((manifest, ctx) => {
    for (const [platform, planes] of Object.entries(manifest.builds)) {
      const native = planes["field-native"];
      if (native === undefined) continue;
      const members = native.members;
      if (members === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builds", platform, "field-native", "members"],
          message: "the field-native plane names its members",
        });
        continue;
      }
      const sorted = [...new Set(members)].sort();
      if (sorted.length !== members.length || sorted.some((m, i) => m !== members[i]))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builds", platform, "field-native", "members"],
          message: "members are sorted and unique",
        });
      if (members.length !== native.files)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builds", platform, "field-native", "files"],
          message: "files counts the members",
        });
    }
  });

describe("AU-6 — the manifest carries the notes additively, at schemaVersion 1", () => {
  const NOTES_MANIFESTS = [
    "release-manifest.notes-log.json",
    "release-manifest.notes-written.json",
  ];

  it("SHIPPED_V1: an app already installed reads a manifest with notes, and keeps them", () => {
    for (const name of NOTES_MANIFESTS) {
      const doc = golden(name);
      const parsed = SHIPPED_V1.safeParse(doc);
      expect(parsed.success, name).toBe(true);
      expect(parsed.data?.["notes"], name).toEqual(doc["notes"]);
    }
  });

  it("this app's schema reads them too, and the notes inside read as ReleaseNotes", () => {
    for (const name of NOTES_MANIFESTS) {
      const manifest = ReleaseManifest.parse(golden(name));
      expect(ReleaseNotes.safeParse(manifest.notes).success, name).toBe(true);
    }
    // the manifest without notes is unchanged
    expect(ReleaseManifest.parse(golden("release-manifest.valid.json")).notes).toBeUndefined();
  });

  it("declares them loosely: notes this client cannot read never refuse the manifest (verify-chain drops them)", () => {
    const manifest = {
      ...golden("release-manifest.notes-log.json"),
      notes: { kind: "markdown", html: "<b>What's new</b>" },
    };
    const parsed = ReleaseManifest.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(ReleaseNotes.safeParse(parsed.data?.notes).success).toBe(false);
  });
});

describe("AU-6 — the persisted notes (tolerant) and the view's", () => {
  it("keeps the staged version's notes and the apply's copy in the state file", () => {
    const state = UpdateClientStateFile.parse(golden("update-client-state.notes.json"));
    expect(state.staged?.notes).toMatchObject({ kind: "log", commits: 103, product: 58 });
    expect(state.lastApply?.notes).toEqual(state.staged?.notes);
    // a state an AU-1 app wrote has none
    const older = UpdateClientStateFile.parse(golden("update-client-state.landed.json"));
    expect(older.staged?.notes).toBeUndefined();
    expect(older.lastApply?.notes).toBeUndefined();
  });

  it("drops malformed notes alone: the staged clock, the record and the file stay", () => {
    const doc = golden("update-client-state.notes.json");
    const staged = doc["staged"] as Record<string, unknown>;
    const lastApply = doc["lastApply"] as Record<string, unknown>;
    const bad = { kind: "log", since: null, commits: 1, product: 9, lines: ["<b>x</b>"] };
    const parsed = UpdateClientStateFile.safeParse({
      ...doc,
      staged: { ...staged, notes: bad },
      lastApply: { ...lastApply, notes: bad },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.staged).toMatchObject({ version: NEXT, at: 1792400400000 });
    expect(parsed.data?.staged?.notes).toBeUndefined();
    expect(parsed.data?.lastApply?.notes).toBeUndefined();
    expect(parsed.data?.lastApply?.landed).toEqual({ at: 1793178007000, outcome: "installed" });
  });

  it("carries the staged version's notes with main's comparison, and when this build was made", () => {
    const view = UpdateView.parse(golden("update-view.staged-notes.json"));
    expect(view.notes?.version).toBe(NEXT);
    expect(view.notes?.body.kind).toBe("log");
    expect(view.notes?.compareUrl).toBe(
      "https://github.com/vibefield/vibefield/compare/nightly-20261027...nightly-20261028",
    );
    expect(view.builtAt).toBe(1793091600000);
    const updated = UpdateView.parse(golden("update-view.updated-notes.json"));
    expect(updated.lastApply?.notes?.version).toBe(NEXT);
    expect(updated.lastApply?.notes?.body.kind).toBe("log");
    // the views before AU-6 have neither
    const before = UpdateView.parse(golden("update-view.staged-since.json"));
    expect(before.notes).toBeUndefined();
    expect(before.builtAt).toBeUndefined();
  });

  it("refuses a comparison that is not a URL, bad notes and a bad build time (main and the preload are one build)", () => {
    const view = golden("update-view.staged-notes.json");
    const notes = view["notes"] as Record<string, unknown>;
    expect(
      UpdateView.safeParse({ ...view, notes: { ...notes, compareUrl: "compare/a...b" } }).success,
    ).toBe(false);
    expect(
      UpdateView.safeParse({ ...view, notes: { ...notes, body: { kind: "html" } } }).success,
    ).toBe(false);
    expect(UpdateView.safeParse({ ...view, builtAt: -1 }).success).toBe(false);
    expect(UpdateView.safeParse({ ...view, builtAt: 1.5 }).success).toBe(false);
  });
});

describe("AU-6 (LC-18; X8) — the staged identity's build time", () => {
  it("reads builtAt as a UTC instant, and none from a stage cut before AU-6", () => {
    const built = StagedReleaseIdentity.parse(golden("staged-release-identity.built-at.json"));
    expect(built.builtAt).toBe("2026-10-28T09:00:00.000Z");
    const older = StagedReleaseIdentity.parse(golden("staged-release-identity.valid.json"));
    expect(older.builtAt).toBeUndefined();
  });

  it("refuses a time with an offset (git's %cI): the stager writes UTC, strictly", () => {
    const identity = golden("staged-release-identity.built-at.json");
    const parses = (builtAt: string) =>
      StagedReleaseIdentity.safeParse({ ...identity, builtAt }).success;
    expect(parses("2026-10-28T02:00:00-07:00")).toBe(false);
    expect(parses("Oct 28")).toBe(false);
    expect(parses("2026-10-28T09:00:00Z")).toBe(true);
  });
});
