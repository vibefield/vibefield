// AU-1 — the updater's view grows (`currentVersion`, `stagedAt`, `lastApply`), and the persisted state learns what an
// apply landed as (`UpdateLastApply.from`/`trigger`/`landed`, `UpdateClientStateFile.staged`). Every persisted addition
// is TOLERANT: an older app reads a newer state.json (a channel downgrade, EDP-36), and a malformed field drops alone —
// never the whole file, which `state-store.ts` would move aside, resetting `declined` and `remembered`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compareDottedVersions,
  compareReleaseVersions,
  releaseChannelOf,
  releaseName,
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
