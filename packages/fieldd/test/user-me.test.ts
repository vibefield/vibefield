import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveFaces, LAYOUT, UserMeResult, UsersFile } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import { userMe } from "../src/user-me";

// IOS-8f — `user.me` answers from the daemon's own user row, the way Electron main's roster does, and falls
// back to the phone's own deal — never a guessed name — wherever there is no row to read.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const ROSTER = JSON.parse(readFileSync(join(FIXTURES, "users.vector.json"), "utf8"));
const DEAL = JSON.parse(readFileSync(join(FIXTURES, "face-deal.vector.json"), "utf8")) as {
  deals: { seed: string; taken: string[]; face: string }[];
};

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function rootWith(users: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "vf-user-me-"));
  roots.push(root);
  if (users !== null) {
    const path = join(root, ...LAYOUT.USERS_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, users);
  }
  return root;
}

const james = ROSTER.users[0].userId as string;
const acme = ROSTER.users[1].userId as string;
const lone = DEAL.deals.find((row) => row.taken.length === 0)!;

describe("IOS-8f — user.me", () => {
  it("answers a written face and the name from the user's own row", () => {
    const answer = userMe({ userId: acme, root: rootWith(JSON.stringify(ROSTER)) });
    expect(UserMeResult.safeParse(answer).success).toBe(true);
    expect(answer).toMatchObject({
      userId: acme,
      name: "acme",
      face: { emoji: "🐙", frame: "coin" },
      dealt: false,
    });
  });

  it("shows a face-less user as the machine shows them: dealt against every face held", () => {
    const answer = userMe({ userId: james, root: rootWith(JSON.stringify(ROSTER)) });
    const shown = effectiveFaces(UsersFile.parse(ROSTER).users).get(james)!;
    expect(answer).toEqual({ userId: james, name: "james", face: shown.face, dealt: true });
    expect(answer.face.emoji).not.toBe("🐙");
  });

  it("answers the phone's own deal, with no name, where there is no row to read", () => {
    const want = { userId: lone.seed, face: { emoji: lone.face, frame: "sticker" }, dealt: true };
    // an embedded daemon's injected root
    expect(userMe({ userId: lone.seed, root: undefined })).toEqual(want);
    // no users.json
    expect(userMe({ userId: lone.seed, root: rootWith(null) })).toEqual(want);
    // a users.json that does not list this user
    expect(userMe({ userId: lone.seed, root: rootWith(JSON.stringify(ROSTER)) })).toEqual(want);
    // an unreadable one: the deal, never a throw
    expect(userMe({ userId: lone.seed, root: rootWith("{ not json") })).toEqual(want);
  });

  it("is an honest UNAVAILABLE on a daemon that serves no user", () => {
    for (const userId of [undefined, ""]) {
      let error: unknown;
      try {
        userMe({ userId, root: undefined });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RpcCallError);
      expect((error as RpcCallError).kind).toBe("UNAVAILABLE");
      expect((error as RpcCallError).details).toMatchObject({ service: "user", state: "no-user" });
    }
  });
});
