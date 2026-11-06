// UM-4 (DESIGN.md §13 "A meter is never a glyph"; the lead's ruling 20) — A PROFILE'S GLYPH ON THE PHONE. RED STUB
// (UM-4 PH-2): the table is empty and names nothing; the green transcribes puppeteer's vocabulary.

public enum ProfileGlyphSymbols {
  /// Each token of the vocabulary, as an SF Symbol outline and filled.
  public static let symbols: [String: (outline: String, filled: String)] = [:]

  /// The native set's mark.
  public static let laptop = ""

  /// Every profile at once.
  public static let everyProfile = ""

  /// The SF Symbol a profile draws.
  public static func symbol(glyph: String?, native: Bool, filled: Bool) -> String { "" }
}
