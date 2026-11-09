import FieldDesign
import Testing
import UIKit

// UM-4 (DESIGN.md §13; the lead's ruling 20) — a profile's glyph on the phone is ONE table: puppeteer's `ProfileGlyph`
// vocabulary as SF Symbols. The vocabulary is `Fixtures/presentation-tables.golden.json`, which field-app's generator
// writes from puppeteer-view-sdk's `PROFILE_GLYPHS` at the pin, so an EL8 that changes the vocabulary reddens this row
// once the fixture is re-blessed (`pnpm check:ios-fixtures` holds the copy).
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("UM-4 — a profile's glyph is puppeteer's vocabulary as SF Symbols, through one table")
struct ProfileGlyphSymbolsTests {
  private struct Tables: Decodable { let profileGlyphs: [String] }

  /// puppeteer-view-sdk's `PROFILE_GLYPHS` at the pin, as field-app's generator wrote them.
  static func pinnedVocabulary() throws -> [String] {
    let found = Bundle.module.url(
      forResource: "presentation-tables.golden", withExtension: "json", subdirectory: "Fixtures")
    let url = try #require(found)
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(Tables.self, from: data).profileGlyphs
  }

  @Test("the table holds the vocabulary, each token outline and filled, and nothing else")
  func vocabulary() throws {
    let pinned = try Self.pinnedVocabulary()
    let tokens = ProfileGlyphSymbols.symbols.keys.sorted()
    #expect(tokens == pinned.sorted())
  }

  @Test("every symbol the table names is one the system draws")
  func everySymbolExists() {
    let named =
      ProfileGlyphSymbols.symbols.values.flatMap { [$0.outline, $0.filled] }
      + [ProfileGlyphSymbols.laptop, ProfileGlyphSymbols.everyProfile]
    let missing = named.filter { UIImage(systemName: $0) == nil }
    #expect(missing.isEmpty)
  }

  @Test("the native set is the laptop whatever it says; an unknown token is the star; the default is filled")
  func rules() {
    #expect(ProfileGlyphSymbols.symbol(glyph: "briefcase", native: true, filled: true) == "laptopcomputer")
    #expect(ProfileGlyphSymbols.symbol(glyph: "briefcase", native: false, filled: false) == "briefcase")
    #expect(ProfileGlyphSymbols.symbol(glyph: "briefcase", native: false, filled: true) == "briefcase.fill")
    #expect(ProfileGlyphSymbols.symbol(glyph: "kayak", native: false, filled: false) == "star")
    #expect(ProfileGlyphSymbols.symbol(glyph: nil, native: false, filled: true) == "star.fill")
  }
}
