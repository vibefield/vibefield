import Foundation

/// The face (DESIGN.md §2.8; users-and-accounts UA-D17): a user is known by
/// form, never by hue — one emoji, framed as a **sticker** (the default) or a
/// **coin** (the user's own choice). This file is the phone's copy of the two
/// pure halves the desktop keeps in `packages/contracts/src/user-face.ts` and
/// `packages/design-kit/src/face.tsx`: the deck, the hash, the deal, the tilt
/// and the edge. Every number is transcribed and pinned by `FaceDeckTests`
/// against goldens computed from the TypeScript, so the two planes deal the
/// same face to the same id and tilt it the same way.
public enum FaceFrame: String, Sendable, Codable, Equatable {
  case sticker
  case coin
}

/// One user's face: the emoji and how it is framed. An absent frame on the
/// wire is a sticker (UA-D17), so the default is here too.
public struct UserFace: Sendable, Equatable, Codable {
  public var emoji: String
  public var frame: FaceFrame

  public init(emoji: String, frame: FaceFrame = .sticker) {
    self.emoji = emoji
    self.frame = frame
  }
}

public enum FaceDeck {
  /// The deck the machine deals from — 48 faces that read at 16 px on both
  /// grounds, animals first, then plants and objects. ORDER MATTERS: a user's
  /// deal starts at their id's hash into this list (`FACE_DECK`, verbatim).
  public static let all: [String] = [
    "🦊", "🐙", "🐼", "🐧", "🦉", "🐢", "🦁", "🐯", "🐨", "🐸", "🦄", "🐝",
    "🐳", "🦋", "🐻", "🐰", "🦔", "🦜", "🐞", "🦩", "🐬", "🦖", "🐺", "🦝",
    "🦦", "🐌", "🦀", "🐡", "🦭", "🐿️", "🐑", "🐘", "🦒", "🦓", "🐫", "🦥",
    "🌵", "🍄", "🌻", "🍋", "🍉", "🥑", "🍩", "🚀", "🎈", "🪐", "🌙", "🧪",
  ]

  /// DESIGN.md §2.8 — the size, in points, from which each piece of detail
  /// shows. `FACE_THRESHOLDS`, verbatim.
  public enum Threshold {
    /// A sticker lifts under a touch or a hold from here up; smaller ones stay flat.
    public static let lift: CGFloat = 20
    /// Below this every sticker sits straight, so a list of faces lines up.
    public static let tilt: CGFloat = 40
    public static let beading: CGFloat = 44
    public static let reeding: CGFloat = 56
    /// The coin catches the light.
    public static let light: CGFloat = 72
    /// The coin's engraved name.
    public static let legend: CGFloat = 96
  }

  /// 32-bit FNV-1a over UTF-16 code units — the SAME hash as the contracts'
  /// `fnv1a32` and the kit's, so the deal and the tilt are one recipe across
  /// the planes. `Math.imul` is a wrapping 32-bit multiply, which is `&*`.
  public static func fnv1a32(_ value: String) -> UInt32 {
    var hash: UInt32 = 0x811c_9dc5
    for unit in value.utf16 {
      hash ^= UInt32(unit)
      hash = hash &* 0x0100_0193
    }
    return hash
  }

  /// How two faces are compared: the emoji with its presentation selectors
  /// (VS15/VS16) stripped, so `🐿️` and `🐿` are one face (`faceKey`).
  public static func key(_ emoji: String) -> String {
    String(String.UnicodeScalarView(emoji.unicodeScalars.filter { $0.value != 0xFE0E && $0.value != 0xFE0F }))
  }

  /// Deal a face to `seed` that nobody in `taken` holds: start at the seed's
  /// hash into the deck and walk forward. All 48 taken: the starting face,
  /// honest and never a blank (`dealFace`).
  public static func deal(seed: String, taken: some Sequence<String> = []) -> String {
    let held = Set(taken.map(key))
    let start = Int(fnv1a32(seed) % UInt32(all.count))
    for offset in 0..<all.count {
      let emoji = all[(start + offset) % all.count]
      if !held.contains(key(emoji)) { return emoji }
    }
    return all[start]
  }

  /// The sticker's stable angle in degrees: ±2–5° from the seed — a second,
  /// colourless cue for telling one person's users apart (I-2) — and straight
  /// below 40 pt. Magnitude `2 + h mod 4`, sign from bit 7 (`faceTilt`).
  public static func tilt(seed: String, size: CGFloat) -> Double {
    guard size >= Threshold.tilt else { return 0 }
    let hash = fnv1a32(seed)
    let magnitude = Double(2 + hash % 4)
    return (hash >> 7) & 1 == 1 ? magnitude : -magnitude
  }

  /// The die-cut edge: 3.2 % of the size, rounded, at least 1 pt and at most
  /// 8 (`stickerEdgePx`) — 1 at 40, 3 at 96, 4 at 128.
  public static func stickerEdge(size: CGFloat) -> Int {
    max(1, min(8, Int((size * 0.032).rounded())))
  }
}
