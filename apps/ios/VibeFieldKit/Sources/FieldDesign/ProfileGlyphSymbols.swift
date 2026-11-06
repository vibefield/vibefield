// UM-4 (DESIGN.md §13 "A meter is never a glyph"; the lead's ruling 20) — A PROFILE'S GLYPH ON THE PHONE: puppeteer's
// `ProfileGlyph` vocabulary drawn as SF Symbols through ONE presentation table, which every phone surface that draws a
// profile reads — the spawn bloom's buds (`SpawnBloomOverlay`), the Bands circle's middle, the held face's buds, the
// Agent Profiles page and the profile token. The vocabulary is puppeteer-view-sdk's `PROFILE_GLYPHS` (0.3.3,
// `toolkit/marks.js`), transcribed: eleven tokens, the native set's laptop whatever it says, and `star` for a token
// this build does not draw (`profileMarkName`). Profiles are not colour: a glyph takes the ink it sits in, filled for
// the default profile.

public enum ProfileGlyphSymbols {
  /// Each token of the vocabulary, as an SF Symbol outline and filled.
  public static let symbols: [String: (outline: String, filled: String)] = [
    "briefcase": ("briefcase", "briefcase.fill"),
    "house": ("house", "house.fill"),
    "flask": ("flask", "flask.fill"),
    "leaf": ("leaf", "leaf.fill"),
    "bolt": ("bolt", "bolt.fill"),
    "star": ("star", "star.fill"),
    "moon": ("moon", "moon.fill"),
    "cup": ("cup.and.saucer", "cup.and.saucer.fill"),
    "rocket": ("paperplane", "paperplane.fill"),
    "book": ("book", "book.fill"),
    "gamepad": ("gamecontroller", "gamecontroller.fill"),
  ]

  /// The native set's mark: the laptop, outline or filled alike.
  public static let laptop = "laptopcomputer"

  /// Every profile at once (the token menu's Every profile, the page's All profiles): §13's `person`.
  public static let everyProfile = "person"

  /// The SF Symbol a profile draws: the laptop for the native set, else its token's, `star` for a token this build
  /// does not draw; filled for the default.
  public static func symbol(glyph: String?, native: Bool, filled: Bool) -> String {
    if native { return laptop }
    let pair = glyph.flatMap { symbols[$0] } ?? (outline: "star", filled: "star.fill")
    return filled ? pair.filled : pair.outline
  }
}
