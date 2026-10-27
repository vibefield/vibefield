import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileDraftsStore } from "../src/profile-drafts";

// AO-5a (AO-D14) — fieldd's note of the profiles Add a profile… made and no
// sign-in has kept: one file per user, 0600, written whole; a note it cannot
// read is set aside, never overwritten.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function notePath(): string {
  const root = mkdtempSync(join(tmpdir(), "fieldd-profile-drafts-"));
  roots.push(root);
  return join(root, ...LAYOUT.AGENT_PROFILE_DRAFTS_FILE);
}

describe("the profile drafts note", () => {
  it("notes a draft once, lists the oldest first, and survives a restart", () => {
    const path = notePath();
    let at = Date.parse("2026-10-27T15:40:00.000Z");
    const tick = (): Date => {
      at += 1_000;
      return new Date(at);
    };
    const store = new ProfileDraftsStore({ path, now: tick });
    store.note("work");
    store.note("client");
    store.note("work"); // the same draft is noted once
    expect(store.list()).toEqual(["work", "client"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // another start reads what this one wrote
    const again = new ProfileDraftsStore({ path });
    expect(again.has("client")).toBe(true);
    expect(again.clear("client")).toBe(true);
    expect(again.clear("client")).toBe(false);
    expect(new ProfileDraftsStore({ path }).list()).toEqual(["work"]);
  });

  it("sets an unreadable note aside and starts empty, keeping its bytes", () => {
    const path = notePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    const store = new ProfileDraftsStore({ path });
    expect(store.list()).toEqual([]);
    const aside = readdirSync(dirname(path)).filter((name) => name.includes("unreadable"));
    expect(aside).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
  });
});
