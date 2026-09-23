import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  effectiveFaces,
  FACE_DECK,
  fnv1a32,
  type UserRecord,
  type UsersFile,
  UsersUpdateParams,
} from "@vibefield/contracts";
import {
  canonicalRoot,
  ensureUsersRoot,
  readUsersFile,
  usersFilePath,
  usersLockPath,
} from "@vibefield/users";
import { describe, expect, it, vi } from "vitest";
import {
  applyOwedFace,
  applyOwedFaces,
  applyProfileUpdate,
  dealOwedFace,
} from "../src/main/users-profile";

// UA-7: main's two profile writes. `users:update` writes a face the page chose
// and refuses one another user wears, throwing the sentence the page shows. The
// silent deal writes down the face the machine already shows a user who
// finished setup before faces existed. The face POLICY is contracts' and is
// tested there; these rows pin what main does with it: judged against the file
// it is handed, nothing applied on a refusal, the legacy accent dropped only by
// a face write, and a deal that moves nobody.

function user(fuid: number, name: string, patch: Partial<UserRecord> = {}): UserRecord {
  return {
    userId: `user-${fuid}`,
    fuid,
    name,
    resident: true,
    onboarded: true,
    createdAt: "2026-09-22T00:00:00.000Z",
    ...patch,
  };
}

function roster(...users: UserRecord[]): UsersFile {
  return {
    version: 1,
    nextFuid: users.length + 1,
    lastAttached: users[0]?.userId ?? null,
    users,
  };
}

/** Every user's face as the machine shows it, by user id. */
function shownFaces(file: UsersFile): Map<string, string> {
  return new Map([...effectiveFaces(file.users)].map(([id, shown]) => [id, shown.face.emoji]));
}

/** User ids whose deals all START at the same deck position, so each face-less
 * user's deal depends on every face before it. That is the case where writing
 * one face down could move another, if anything could. */
function collidingIds(count: number): { ids: string[]; start: number } {
  const start = fnv1a32("user-0") % FACE_DECK.length;
  const ids: string[] = [];
  for (let i = 0; ids.length < count; i++) {
    if (fnv1a32(`user-${i}`) % FACE_DECK.length === start) ids.push(`user-${i}`);
  }
  return { ids, start };
}

const deck = (index: number): string => FACE_DECK[index % FACE_DECK.length]!;

describe("applyProfileUpdate: the users:update applier", () => {
  it("writes the face and drops the legacy accent (spec §3.1)", () => {
    const file = roster(user(1, "James", { color: "accent-3" }));
    const record = applyProfileUpdate(file, "user-1", { face: { emoji: "🦊", frame: "coin" } });

    expect(record.face).toEqual({ emoji: "🦊", frame: "coin" });
    expect("color" in record).toBe(false);
    // In place: this is the mutateUsersFile callback's shape.
    expect(file.users[0]).toBe(record);
  });

  it("stores the emoji the way it renders", () => {
    const file = roster(user(1, "James"));
    expect(applyProfileUpdate(file, "user-1", { face: { emoji: " 🦊 " } }).face?.emoji).toBe("🦊");
    // A lone text-default pictograph gains U+FE0F so it draws in colour.
    expect(applyProfileUpdate(file, "user-1", { face: { emoji: "\u2601" } }).face?.emoji).toBe(
      "\u2601\uFE0F",
    );
  });

  it("refuses a face another user wears, in faceProblem's words, applying nothing", () => {
    const file = roster(
      user(1, "James", { face: { emoji: "🦊" } }),
      user(2, "Work", { face: { emoji: "🐙" } }),
    );
    const before = structuredClone(file);

    expect(() =>
      applyProfileUpdate(file, "user-1", { name: "Jim", resident: false, face: { emoji: "🐙" } }),
    ).toThrow(/^Work already wears 🐙 on this machine\.$/u);
    // Not even the name that rode in with it.
    expect(file).toEqual(before);
  });

  it("counts a DEALT face as worn, so choosing one never re-deals somebody else", () => {
    const file = roster(user(1, "James", { face: { emoji: "🦊" } }), user(2, "Work"));
    const dealt = shownFaces(file).get("user-2")!;

    expect(() => applyProfileUpdate(file, "user-1", { face: { emoji: dealt } })).toThrow(
      `Work already wears ${dealt} on this machine.`,
    );
    expect(file.users[0]?.face).toEqual({ emoji: "🦊" });
  });

  it.each([
    ["a refused emoji", "🔥", "🔥 already means something in VibeField, so it can't be a face."],
    ["two emoji", "🦊🐙", "A face is a single emoji."],
    ["text", "fox", "A face is a single emoji."],
    ["a blank", " ", "A face is a single emoji."],
  ])("refuses %s with the sentence the page shows", (_what, emoji, sentence) => {
    const file = roster(user(1, "James"));
    expect(() => applyProfileUpdate(file, "user-1", { face: { emoji } })).toThrow(sentence);
    expect(file.users[0]?.face).toBeUndefined();
  });

  it("lets a user re-frame the face they already wear", () => {
    const file = roster(user(1, "James", { face: { emoji: "🦊" } }), user(2, "Work"));
    const record = applyProfileUpdate(file, "user-1", { face: { emoji: "🦊", frame: "coin" } });
    expect(record.face).toEqual({ emoji: "🦊", frame: "coin" });
  });

  it("keeps a key a newer build stored on the face — a skewed writer drops nothing (UA-D10)", () => {
    const file = roster(
      user(1, "James", { face: { emoji: "🦊", futureFaceField: "survives" } }),
      user(2, "Work"),
    );
    const record = applyProfileUpdate(file, "user-1", { face: { emoji: "🐧", frame: "coin" } });
    expect(record.face).toEqual({ emoji: "🐧", frame: "coin", futureFaceField: "survives" });
  });

  it("a name-only update leaves the face and the legacy accent alone", () => {
    // W6 reads `color` as "pane 2 was answered once" while the face is absent,
    // so only a FACE write may drop it.
    const file = roster(
      user(1, "James", { face: { emoji: "🦊" }, color: "accent-3" }),
      user(2, "Work", { color: "accent-5", onboarded: false }),
    );
    expect(applyProfileUpdate(file, "user-1", { name: "Jim" })).toMatchObject({
      name: "Jim",
      face: { emoji: "🦊" },
      color: "accent-3",
    });
    expect(applyProfileUpdate(file, "user-2", { name: "Office" })).toMatchObject({
      name: "Office",
      color: "accent-5",
    });
    expect(file.users[1]?.face).toBeUndefined();
  });

  it("ignores the retired colour an older page may send, instead of writing it", () => {
    const file = roster(user(1, "James"));
    const params = UsersUpdateParams.parse({ name: "Jim", color: "accent-2" });
    expect(applyProfileUpdate(file, "user-1", params)).not.toHaveProperty("color");
  });

  it("applies resident and onboarded as before", () => {
    const file = roster(user(1, "James", { onboarded: false }));
    expect(applyProfileUpdate(file, "user-1", { resident: false, onboarded: true })).toMatchObject({
      resident: false,
      onboarded: true,
    });
  });

  it("throws when the user is not in the file", () => {
    expect(() => applyProfileUpdate(roster(user(1, "James")), "user-9", { name: "x" })).toThrow(
      "the attached user vanished from users.json",
    );
  });

  it("a face write can move a face-less user's deal onto the face given up", () => {
    // Why main redraws the WHOLE roster after a face write, not one row.
    const { ids, start } = collidingIds(2);
    const [james, work] = [ids[0]!, ids[1]!];
    const file = roster(
      user(1, "James", { userId: james, face: { emoji: deck(start) } }),
      user(2, "Work", { userId: work }),
    );
    expect(shownFaces(file).get(work)).toBe(deck(start + 1));

    applyProfileUpdate(file, james, { face: { emoji: deck(start + 5) } });
    expect(shownFaces(file).get(work)).toBe(deck(start));
  });
});

describe("applyOwedFace: the silent deal's record rule", () => {
  it("writes down the face the machine already shows an onboarded face-less user", () => {
    const file = roster(
      user(1, "James", { color: "accent-3" }),
      user(2, "Work", { face: { emoji: "🐙" } }),
    );
    const shown = effectiveFaces(file.users).get("user-1")?.face;

    expect(applyOwedFace(file, "user-1")).toEqual(shown);
    expect(file.users[0]?.face).toEqual(shown);
    // Main's repair, not the user's profile write: the accent stays until they pick.
    expect(file.users[0]?.color).toBe("accent-3");
  });

  it("never deals a user still in setup (pane 2 owns that write)", () => {
    const file = roster(user(1, "James", { onboarded: false, color: "accent-3" }));
    expect(applyOwedFace(file, "user-1")).toBeNull();
    expect(file.users[0]?.face).toBeUndefined();
  });

  it("leaves a written face alone, and an unknown user", () => {
    const file = roster(user(1, "James", { face: { emoji: "🦊", frame: "coin" } }));
    expect(applyOwedFace(file, "user-1")).toBeNull();
    expect(applyOwedFace(file, "user-9")).toBeNull();
    expect(file.users[0]?.face).toEqual({ emoji: "🦊", frame: "coin" });
  });

  it("moves nobody: every user's shown face is the same before and after each deal", () => {
    const { ids, start } = collidingIds(5);
    const file = roster(
      user(1, "James", { userId: ids[0]! }),
      user(2, "Work", { userId: ids[1]!, onboarded: false }),
      user(3, "Sandbox", { userId: ids[2]!, face: { emoji: deck(start + 1) } }),
      user(4, "Lab", { userId: ids[3]! }),
      user(5, "Scratch", { userId: ids[4]! }),
    );
    // Highest fuid first: the direction where an earlier user's deal could move.
    for (const id of [ids[4]!, ids[0]!, ids[3]!]) {
      const before = shownFaces(file);
      expect(applyOwedFace(file, id)?.emoji).toBe(before.get(id));
      expect(shownFaces(file)).toEqual(before);
    }
  });
});

describe("applyOwedFaces: every owed face in one pass", () => {
  it("writes down every onboarded user's shown face at once, and moves nobody", () => {
    const { ids, start } = collidingIds(5);
    const file = roster(
      user(1, "James", { userId: ids[0]! }),
      user(2, "Work", { userId: ids[1]!, onboarded: false }),
      user(3, "Sandbox", { userId: ids[2]!, face: { emoji: deck(start + 1) } }),
      user(4, "Lab", { userId: ids[3]! }),
      user(5, "Scratch", { userId: ids[4]! }),
    );
    const before = shownFaces(file);
    const written = applyOwedFaces(file);
    expect([...written.keys()].sort()).toEqual([ids[0]!, ids[3]!, ids[4]!].sort());
    expect(shownFaces(file)).toEqual(before);
    // Still in setup: a proposal, never written by the machine.
    expect(file.users[1]?.face).toBeUndefined();
  });

  it("leaves no set-up user for a later release to drift", () => {
    // The drift the single-user deal allowed: James frees a face, and a
    // face-less Work's deal walked onto it. Once every owed face is written at
    // the attach, releasing one moves nobody who is set up.
    const { ids, start } = collidingIds(2);
    const [james, work] = [ids[0]!, ids[1]!];
    const file = roster(
      user(1, "James", { userId: james, face: { emoji: deck(start) } }),
      user(2, "Work", { userId: work }),
    );
    applyOwedFaces(file);
    const workFace = shownFaces(file).get(work);
    applyProfileUpdate(file, james, { face: { emoji: deck(start + 5) } });
    expect(shownFaces(file).get(work)).toBe(workFace);
  });
});

describe("dealOwedFace: the silent deal at an attach", () => {
  const noSleep = { sleep: (_ms: number) => Promise.resolve() };

  async function rootWithOneUser(onboarded: boolean): Promise<{ root: string; userId: string }> {
    const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-face-deal-")));
    const ensured = await ensureUsersRoot(root, {
      name: "james",
      mintOnboarded: onboarded,
      ...noSleep,
    });
    return { root, userId: ensured.user.userId };
  }

  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  /** Someone else holds the §3.3 lock: this process's own live pid, so it is
   * never broken by force and the deal has to wait its turn. */
  const holdLock = (root: string): void => {
    writeFileSync(
      usersLockPath(root),
      JSON.stringify({ pid: process.pid, role: "mutate", startedAt: Date.now() }),
    );
  };

  it("writes the face the machine shows an onboarded face-less user, and says so", async () => {
    const { root, userId } = await rootWithOneUser(true);
    const shown = effectiveFaces(readUsersFile(root)?.users ?? []).get(userId)?.face;
    const log = logger();

    await expect(dealOwedFace(root, userId, { logger: log })).resolves.toEqual(shown);
    expect(readUsersFile(root)?.users[0]?.face).toEqual(shown);
    expect(log.info).toHaveBeenCalledWith("desktop.users.face_dealt", expect.any(String), {
      userId,
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("is idempotent: the next attach writes nothing", async () => {
    const { root, userId } = await rootWithOneUser(true);
    await dealOwedFace(root, userId);
    const bytes = readFileSync(usersFilePath(root), "utf8");

    await expect(dealOwedFace(root, userId)).resolves.toBeNull();
    expect(readFileSync(usersFilePath(root), "utf8")).toBe(bytes);
  });

  it("never deals a user still in setup", async () => {
    const { root, userId } = await rootWithOneUser(false);
    await expect(dealOwedFace(root, userId)).resolves.toBeNull();
    expect(readUsersFile(root)?.users[0]?.face).toBeUndefined();
  });

  it("lets a face written while it waited for the lock win", async () => {
    const { root, userId } = await rootWithOneUser(true);
    holdLock(root);
    // The other hand finishes first: pane 2 writes a face, then lets go.
    const lock = {
      sleep: async (_ms: number) => {
        const file = readUsersFile(root);
        if (file?.users[0] !== undefined) file.users[0].face = { emoji: "🐙", frame: "coin" };
        writeFileSync(usersFilePath(root), JSON.stringify(file));
        rmSync(usersLockPath(root), { force: true });
      },
    };
    const log = logger();

    await expect(dealOwedFace(root, userId, { logger: log, lock })).resolves.toBeNull();
    expect(readUsersFile(root)?.users[0]?.face).toEqual({ emoji: "🐙", frame: "coin" });
    expect(log.info).not.toHaveBeenCalled();
  });

  it("a lock that never frees skips with a warn and never throws", async () => {
    const { root, userId } = await rootWithOneUser(true);
    holdLock(root);
    let clock = 0;
    const lock = {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    };
    const log = logger();

    await expect(dealOwedFace(root, userId, { logger: log, lock })).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledWith("desktop.users.face_deal_skipped", expect.any(String), {
      userId,
      error: expect.stringContaining("another VibeField process is using this data folder"),
    });
    expect(readUsersFile(root)?.users[0]?.face).toBeUndefined();
  });

  it("an unreadable users.json skips with a warn instead of failing the attach", async () => {
    const { root, userId } = await rootWithOneUser(true);
    writeFileSync(usersFilePath(root), "{ not json");
    const log = logger();

    await expect(dealOwedFace(root, userId, { logger: log })).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      "desktop.users.face_deal_skipped",
      expect.any(String),
      expect.objectContaining({ userId }),
    );
  });
});
