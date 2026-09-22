import { describe, expect, it } from "vitest";
import {
  dealFace,
  effectiveFaces,
  FACE_DECK,
  faceKey,
  faceProblem,
  fnv1a32,
  isRefusedFace,
  isSingleEmoji,
  normalizeFaceEmoji,
} from "../src/user-face";
import { UserFace, UsersUpdateParams } from "../src/users";

// UA-D17 — the face's policy, shared by main and the renderer. These pin the
// three properties both planes lean on: the deal is deterministic, a machine
// never shows two users alike (I-2), and a refusal is decided on the same key
// whatever presentation selector the emoji arrived with.

const user = (userId: string, fuid: number, name: string, emoji?: string) => ({
  userId,
  fuid,
  name,
  ...(emoji === undefined ? {} : { face: { emoji } }),
});

describe("the deck", () => {
  it("never deals a refused face, and holds no duplicates", () => {
    expect(FACE_DECK.filter(isRefusedFace)).toEqual([]);
    expect(new Set(FACE_DECK.map(faceKey)).size).toBe(FACE_DECK.length);
    for (const emoji of FACE_DECK) expect(isSingleEmoji(emoji), emoji).toBe(true);
  });
});

describe("dealFace", () => {
  it("is deterministic per user id, and starts where the id's hash says", () => {
    const id = "01J8Z3K6W9QX2M4N7P5R8T1V3B";
    expect(dealFace(id, [])).toBe(dealFace(id, []));
    expect(dealFace(id, [])).toBe(FACE_DECK[fnv1a32(id) % FACE_DECK.length]);
  });

  it("skips a face somebody holds, including a variation-selector spelling of it", () => {
    const id = "01J8Z3K6W9QX2M4N7P5R8T1V3B";
    const first = dealFace(id, []);
    const second = dealFace(id, [first]);
    expect(second).not.toBe(first);
    const bare = faceKey(first);
    expect(dealFace(id, [`${bare}\uFE0F`])).toBe(second);
  });

  it("gives back the starting face when every face in the deck is held", () => {
    const id = "01J8Z3K6W9QX2M4N7P5R8T1V3B";
    expect(dealFace(id, FACE_DECK)).toBe(FACE_DECK[fnv1a32(id) % FACE_DECK.length]);
  });
});

describe("effectiveFaces", () => {
  it("shows a written face as written, and marks a deal as a deal", () => {
    const shown = effectiveFaces([user("a", 1, "James", "🦊"), user("b", 2, "Sandbox")]);
    expect(shown.get("a")).toEqual({ face: { emoji: "🦊" }, dealt: false });
    expect(shown.get("b")?.dealt).toBe(true);
    expect(shown.get("b")?.face.frame).toBe("sticker");
  });

  it("never shows two users alike, face-less ones included (I-2)", () => {
    const users = Array.from({ length: 12 }, (_, i) => user(`user-${i}`, i + 1, `U${i}`));
    users[3] = user("user-3", 4, "U3", "🐙");
    const shown = effectiveFaces(users);
    const keys = users.map((u) => faceKey(shown.get(u.userId)?.face.emoji ?? ""));
    expect(new Set(keys).size).toBe(users.length);
  });

  it("deals in fuid order, so the answer does not depend on the roster's order", () => {
    const forward = [user("x", 1, "X"), user("y", 2, "Y"), user("z", 3, "Z")];
    const shuffled = [forward[2]!, forward[0]!, forward[1]!];
    const a = effectiveFaces(forward);
    const b = effectiveFaces(shuffled);
    for (const id of ["x", "y", "z"]) expect(a.get(id)).toEqual(b.get(id));
  });
});

describe("faceProblem", () => {
  const roster = [user("me", 1, "James", "🦊"), user("work", 2, "James (work)", "🐙")];

  it("accepts a free single emoji, including a ZWJ sequence", () => {
    expect(faceProblem({ emoji: "🐧" }, "me", roster)).toBeNull();
    expect(faceProblem({ emoji: "🐻‍❄️" }, "me", roster)).toBeNull();
    expect(faceProblem({ emoji: "🦊" }, "me", roster)).toBeNull(); // your own face
  });

  it("refuses text, two emoji, and a face another user wears — naming them", () => {
    expect(faceProblem({ emoji: "J" }, "me", roster)).toMatch(/single emoji/);
    expect(faceProblem({ emoji: "🐧🐧" }, "me", roster)).toMatch(/single emoji/);
    expect(faceProblem({ emoji: "🐙" }, "me", roster)).toBe(
      "James (work) already wears 🐙 on this machine.",
    );
  });

  it("refuses the faces that already mean something, whatever selector they carry", () => {
    for (const emoji of ["🔥", "📁", "🔗", "✅", "⚠️", "⚠", "❤️", "❤", "🟢"]) {
      expect(faceProblem({ emoji }, "me", roster), emoji).toMatch(/already means something/);
    }
  });

  it("counts a DEALT face as worn, so choosing never re-deals somebody else", () => {
    const withFaceless = [...roster, user("sandbox", 3, "Sandbox")];
    const dealt = effectiveFaces(withFaceless).get("sandbox")?.face.emoji ?? "";
    expect(faceProblem({ emoji: dealt }, "me", withFaceless)).toBe(
      `Sandbox already wears ${dealt} on this machine.`,
    );
  });
});

describe("normalizeFaceEmoji", () => {
  it("adds the emoji selector to a lone text-default pictograph, and nothing else", () => {
    expect(normalizeFaceEmoji("☁")).toBe("☁\uFE0F");
    expect(normalizeFaceEmoji(" 🦊 ")).toBe("🦊");
    expect(normalizeFaceEmoji("🐿\uFE0F")).toBe("🐿\uFE0F");
  });
});

describe("the wire shapes", () => {
  it("UserFace keeps an unknown field and defaults nothing", () => {
    const face = UserFace.parse({ emoji: "🦊", later: 1 });
    expect(face.frame).toBeUndefined();
    expect((face as Record<string, unknown>).later).toBe(1);
    expect(() => UserFace.parse({ emoji: "🦊", frame: "halo" })).toThrow();
  });

  it("UsersUpdateParams carries a face and no longer names a colour", () => {
    const params = UsersUpdateParams.parse({ face: { emoji: "🐙", frame: "coin" } });
    expect(params.face).toEqual({ emoji: "🐙", frame: "coin" });
    expect("color" in UsersUpdateParams.shape).toBe(false);
  });
});
