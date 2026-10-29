import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dealFace,
  effectiveFaces,
  emojiProblem,
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
    for (const emoji of ["🔥", "📁", "🔗", "✅", "⚠️", "\u26A0", "❤️", "❤", "🟢"]) {
      expect(faceProblem({ emoji }, "me", roster), emoji).toMatch(/already means something/);
    }
  });

  it("judges a ZWJ sequence by its base: a refused face cannot be joined back in", () => {
    const fireOnFire = "\u{1F525}\u200D\u{1F525}";
    expect(faceProblem({ emoji: fireOnFire }, "me", roster)).toMatch(/already means something/);
    // A refused glyph as a TAIL names something else: a black cat, a lime, a phoenix.
    for (const emoji of [
      "\u{1F408}\u200D⬛",
      "\u{1F34B}\u200D\u{1F7E9}",
      "\u{1F426}\u200D\u{1F525}",
    ]) {
      expect(faceProblem({ emoji }, "me", roster), emoji).toBeNull();
    }
  });

  it("refuses the heart suit, the hollow circle, and the other media and sync marks", () => {
    for (const emoji of ["♥️", "♥", "⭕", "⏯️", "\u{1F503}"]) {
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

describe("isSingleEmoji", () => {
  it("takes a keycap, a skin tone on a base that takes one, and a family of four", () => {
    for (const emoji of [
      "1\uFE0F\u20E3",
      "#\u20E3",
      "✋\u{1F3FD}",
      "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}",
    ]) {
      expect(isSingleEmoji(emoji), emoji).toBe(true);
    }
  });

  it("refuses a tone on a face that takes none, a chain past four, and a reserved code point", () => {
    expect(isSingleEmoji("\u{1F98A}\u{1F3FD}")).toBe(false); // a fox beside a swatch
    expect(isSingleEmoji(Array(5).fill("\u{1F98A}").join("\u200D"))).toBe(false);
    expect(isSingleEmoji("\u{1FAFF}")).toBe(false); // Extended_Pictographic, unassigned: tofu
  });
});

describe("emojiProblem", () => {
  it("is faceProblem's roster-free half, in the same words", () => {
    expect(emojiProblem("J")).toBe("A face is a single emoji.");
    expect(emojiProblem("\u{1F525}")).toBe(
      "\u{1F525} already means something in VibeField, so it can't be a face.",
    );
    expect(emojiProblem(" \u{1F427} ")).toBeNull();
  });
});

describe("normalizeFaceEmoji", () => {
  it("drops a text-presentation selector and completes a bare keycap", () => {
    expect(normalizeFaceEmoji("☁\uFE0E")).toBe("☁\uFE0F");
    expect(normalizeFaceEmoji("1\u20E3")).toBe("1\uFE0F\u20E3");
    expect(normalizeFaceEmoji("1\uFE0F\u20E3")).toBe("1\uFE0F\u20E3");
  });

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

// IOS-8f — the deal's cross-plane vector: fieldd's `user.me` and the iOS kit read the same file
// (the kit through a copy check:ios-fixtures holds byte-identical), so a drift on any plane is a red.
const VECTOR = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "face-deal.vector.json"),
    "utf8",
  ),
) as {
  deck: string[];
  hashes: { value: string; fnv1a32: number }[];
  deals: { seed: string; taken: string[]; face: string }[];
  rosters: {
    users: { userId: string; fuid: number; face?: { emoji: string; frame?: "sticker" | "coin" } }[];
    shown: { userId: string; face: { emoji: string; frame?: string }; dealt: boolean }[];
  }[];
};

describe("IOS-8f — the face deal (golden vector)", () => {
  it("is this deck, in this order", () => {
    expect(VECTOR.deck).toEqual([...FACE_DECK]);
  });
  it("hashes as the vector says", () => {
    for (const row of VECTOR.hashes) expect(fnv1a32(row.value), row.value).toBe(row.fnv1a32);
  });
  it("deals as the vector says", () => {
    for (const row of VECTOR.deals) expect(dealFace(row.seed, row.taken), row.seed).toBe(row.face);
  });
  it("shows a roster as the vector says", () => {
    for (const roster of VECTOR.rosters) {
      const shown = effectiveFaces(roster.users);
      for (const row of roster.shown) {
        expect(shown.get(row.userId), row.userId).toEqual({ face: row.face, dealt: row.dealt });
      }
    }
  });
});
