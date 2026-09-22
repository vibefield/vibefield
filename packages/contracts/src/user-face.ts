// UA-D17 (users-and-accounts v0.3; DESIGN.md §2.8) — the face's POLICY, shared
// by the two writers that must agree on it: main (the silent deal for a
// pre-v0.3 user, and the refusal behind `users:update`) and the renderer (pane
// 2's proposal, the picker, every face drawn for a user who has none yet).
// Pure and dependency-free like the rest of this package: no DOM, no Node.
// How a face LOOKS is the design kit's (`@vibefield/design-kit/face`).
//
// Deliberately free of runtime imports — even of `./users` — so boot-reachable
// code (the Setup Assistant) can take it through the `./user-face` subpath and
// add nothing of the wire package to the splash for faces. (The splash already
// reaches zod by older routes — fieldd-client's version stamp, the posture
// read — so the saving waits on those; UA-7's own imports stay on leaf entries,
// which ui-system-boundaries pins.) The shapes below are STRUCTURAL: a parsed
// `UserRecord` and the renderer's host profile both satisfy them.

/** A face as far as the policy cares: the emoji, and the frame whose absence
 * means sticker. `UserFace` (users.ts) is the wire schema for it. */
export interface FaceLike {
  readonly emoji: string;
  readonly frame?: "sticker" | "coin" | undefined;
}

/** A user as far as the policy cares. */
export interface FaceHolder {
  readonly userId: string;
  readonly fuid: number;
  readonly face?: FaceLike | undefined;
}

/** The deck the machine deals from — animals first, then a few plants and
 * objects, every one chosen to read at 16px on both grounds. The order only
 * decides who comes next when a face is taken: where a user STARTS in the deck
 * is their user id's hash, so two machines deal the same person differently
 * and no user is always the fox. Refusals (below) never appear here. */
export const FACE_DECK = [
  "🦊",
  "🐙",
  "🐼",
  "🐧",
  "🦉",
  "🐢",
  "🦁",
  "🐯",
  "🐨",
  "🐸",
  "🦄",
  "🐝",
  "🐳",
  "🦋",
  "🐻",
  "🐰",
  "🦔",
  "🦜",
  "🐞",
  "🦩",
  "🐬",
  "🦖",
  "🐺",
  "🦝",
  "🦦",
  "🐌",
  "🦀",
  "🐡",
  "🦭",
  "🐿️",
  "🐑",
  "🐘",
  "🦒",
  "🦓",
  "🐫",
  "🦥",
  "🌵",
  "🍄",
  "🌻",
  "🍋",
  "🍉",
  "🥑",
  "🍩",
  "🚀",
  "🎈",
  "🪐",
  "🌙",
  "🧪",
] as const;

/** Refused as faces because they already MEAN something here (DESIGN.md §2.8):
 * flat colours and hearts read as a colour, not a form (I-1); 🔥 is the swarm's
 * burn ladder; 📁 is a project; the state marks are §2.5's words; 🔗 is the
 * link. Matched on `faceKey`, so a variation selector cannot smuggle one in. */
const REFUSED = [
  // flat colours
  "🔴",
  "🟠",
  "🟡",
  "🟢",
  "🔵",
  "🟣",
  "🟤",
  "⚫",
  "⚪",
  "🟥",
  "🟧",
  "🟨",
  "🟩",
  "🟦",
  "🟪",
  "🟫",
  "⬛",
  "⬜",
  "◼️",
  "◻️",
  "▪️",
  "▫️",
  "🔶",
  "🔷",
  "🔸",
  "🔹",
  "🔺",
  "🔻",
  // hearts
  "❤️",
  "♥️",
  "🧡",
  "💛",
  "💚",
  "💙",
  "💜",
  "🤎",
  "🖤",
  "🤍",
  "🩷",
  "🩵",
  "🩶",
  "💔",
  "❣️",
  "💕",
  "💞",
  "💓",
  "💗",
  "💖",
  "💘",
  "💝",
  "💟",
  "❤️‍🔥",
  "❤️‍🩹",
  // the burn ladder, the project, the link
  "🔥",
  "📁",
  "📂",
  "🗂️",
  "🔗",
  "🖇️",
  // the state marks
  "✅",
  "☑️",
  "✔️",
  "❌",
  "⭕",
  "❎",
  "✖️",
  "⚠️",
  "⛔",
  "🚫",
  "⏳",
  "⌛",
  "⏸️",
  "⏯️",
  "▶️",
  "⏹️",
  "⏺️",
  "🔄",
  "🔃",
  "❗",
  "❕",
  "❓",
  "❔",
  "‼️",
  "⁉️",
  "🆘",
] as const;

/** A face's identity for comparison: the emoji without its presentation
 * selectors, so "❤" and "❤️" — or "🐿" and "🐿️" — are one face. */
export function faceKey(emoji: string): string {
  return emoji.replace(/[\uFE0E\uFE0F]/g, "");
}

const REFUSED_KEYS: ReadonlySet<string> = new Set(REFUSED.map(faceKey));

/** A ZWJ sequence is judged by its BASE. Fire joined to fire is still fire,
 * while a refused glyph joined as a tail names something else: 🐈 + ⬛ is a
 * black cat, 🍋 + 🟩 a lime, 🐦 + 🔥 a phoenix. */
export function isRefusedFace(emoji: string): boolean {
  const key = faceKey(emoji);
  return REFUSED_KEYS.has(key) || REFUSED_KEYS.has(key.split("\u200D")[0] ?? key);
}

/** One emoji, because a face is ONE form (I-1): a pictograph with its optional
 * presentation selector and, on a base that takes one, a skin tone, joined by
 * ZWJ to at most three more (the longest RGI sequences, the families, join
 * four); or a keycap. Each pictograph must be an ASSIGNED emoji —
 * Extended_Pictographic also covers code points reserved for future ones, which
 * draw as tofu. Letters, digits, flags, two emoji side by side and text around
 * one are all refused. A shorter chain that is not an RGI sequence still passes
 * and draws as its parts side by side: telling needs Unicode's sequence list,
 * which the policy does not carry. */
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;
const JOINED_PART = /^(\p{Extended_Pictographic})[\uFE0E\uFE0F]?(\p{Emoji_Modifier})?$/u;
const MAX_JOINED_PARTS = 4;

export function isSingleEmoji(value: string): boolean {
  if (KEYCAP.test(value)) return true;
  const parts = value.split("\u200D");
  if (parts.length > MAX_JOINED_PARTS) return false;
  return parts.every((part) => {
    const match = JOINED_PART.exec(part);
    if (match === null) return false;
    const [, base = "", tone] = match;
    if (!/\p{Emoji}/u.test(base)) return false;
    return tone === undefined || /\p{Emoji_Modifier_Base}/u.test(base);
  });
}

/** Store what renders as an emoji. A text-presentation selector (U+FE0E) is
 * dropped — a face is never the text font's glyph — and a lone text-default
 * pictograph (☁, ✈) or a bare keycap gains U+FE0F, so it draws in colour.
 * Everything else is kept exactly as the user chose it. */
export function normalizeFaceEmoji(value: string): string {
  const trimmed = value.trim().replace(/\uFE0E/g, "");
  const keycap = /^([0-9#*])\u20E3$/u.exec(trimmed);
  if (keycap !== null) return `${keycap[1]}\uFE0F\u20E3`;
  const chars = [...trimmed];
  if (chars.length === 1 && !/\p{Emoji_Presentation}/u.test(trimmed)) return `${trimmed}\uFE0F`;
  return trimmed;
}

/** 32-bit FNV-1a over UTF-16 code units — the one hash both planes use for a
 * user id, so the deal and the sticker's tilt land the same on every surface
 * (and on iOS, which ports it). */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deal a face no other user holds: the deck from the user id's own starting
 * point, first emoji not in `taken`. Deterministic, so the proposal pane 2
 * shows is the face the silent deal would have written. A machine with more
 * users than the deck has faces (49+) gets its starting emoji back — honest,
 * never a blank. */
export function dealFace(userId: string, taken: Iterable<string>): string {
  const held = new Set<string>();
  for (const emoji of taken) held.add(faceKey(emoji));
  const start = fnv1a32(userId) % FACE_DECK.length;
  for (let offset = 0; offset < FACE_DECK.length; offset++) {
    const emoji = FACE_DECK[(start + offset) % FACE_DECK.length]!;
    if (!held.has(faceKey(emoji))) return emoji;
  }
  return FACE_DECK[start]!;
}

export interface EffectiveFace {
  readonly face: FaceLike;
  /** True when the machine proposed it and nobody has written it yet. */
  readonly dealt: boolean;
}

/** Every user's face as the machine SHOWS it: the written face, or a deal.
 * Dealt in fuid order against every written face AND every face dealt before
 * it in the same pass — two face-less users are never shown alike (I-2), and
 * the answer is stable for as long as the roster is. */
export function effectiveFaces(users: readonly FaceHolder[]): Map<string, EffectiveFace> {
  const out = new Map<string, EffectiveFace>();
  const held: string[] = [];
  for (const user of users) {
    if (user.face !== undefined) {
      out.set(user.userId, { face: user.face, dealt: false });
      held.push(user.face.emoji);
    }
  }
  const faceless = users.filter((user) => user.face === undefined).sort((a, b) => a.fuid - b.fuid);
  for (const user of faceless) {
    const emoji = dealFace(user.userId, held);
    held.push(emoji);
    out.set(user.userId, { face: { emoji, frame: "sticker" }, dealt: true });
  }
  return out;
}

/** Why `emoji` can never be anybody's face — not one emoji, or one that
 * already means something here — in the words the page shows; null when it
 * could be. The part of `faceProblem` that needs no roster, so the picker can
 * say it in place before anything is written. */
export function emojiProblem(emoji: string): string | null {
  const trimmed = emoji.trim();
  if (!isSingleEmoji(trimmed)) return "A face is a single emoji.";
  if (isRefusedFace(trimmed)) {
    return `${trimmed} already means something in VibeField, so it can't be a face.`;
  }
  return null;
}

/** Why `face` cannot be `userId`'s, in words a person can act on — or null.
 * "Held" counts every other user's EFFECTIVE face, dealt ones included, so
 * TAKING a face never re-deals somebody else's. RELEASING one can: a face-less
 * user whose deck walk passes the freed face moves onto it. Main closes that
 * for everyone who is set up by writing every owed face at each attach
 * (electron-shell `applyOwedFaces`); a user still in setup keeps a proposal
 * that may move, because pane 2 has not written it yet. */
export function faceProblem(
  face: FaceLike,
  userId: string,
  users: readonly (FaceHolder & { readonly name: string })[],
): string | null {
  const emoji = face.emoji.trim();
  const problem = emojiProblem(emoji);
  if (problem !== null) return problem;
  const shown = effectiveFaces(users);
  for (const user of users) {
    if (user.userId === userId) continue;
    const other = shown.get(user.userId);
    if (other !== undefined && faceKey(other.face.emoji) === faceKey(emoji)) {
      return `${user.name} already wears ${other.face.emoji} on this machine.`;
    }
  }
  return null;
}
