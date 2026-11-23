import Foundation
import Testing

@testable import FieldTerminal

@Suite struct HexColorParserTests {
  @Test func parsesCatalogFormat() {
    #expect(parseHexColor("#121212") == [0x12, 0x12, 0x12])
    #expect(parseHexColor("#bebebe") == [0xbe, 0xbe, 0xbe])
    #expect(parseHexColor("#FFffFF") == [0xff, 0xff, 0xff])
    #expect(parseHexColor("#000000") == [0, 0, 0])
  }

  @Test func refusesEverythingElse() {
    #expect(parseHexColor("") == nil)
    #expect(parseHexColor("121212") == nil)  // no hash
    #expect(parseHexColor("#12121") == nil)  // short
    #expect(parseHexColor("#1212121") == nil)  // long
    #expect(parseHexColor("#12 212") == nil)  // whitespace inside
    #expect(parseHexColor(" #121212") == nil)  // padded
    #expect(parseHexColor("#gg0000") == nil)  // non-hex
    // UInt8(_:radix:) alone would bless a sign character; the parser must not.
    #expect(parseHexColor("#+12345") == nil)
    #expect(parseHexColor("#-12345") == nil)
  }
}

@Suite struct TerminalAppearanceStoreTests {
  /// One suite per test: Swift Testing runs these in parallel, and a shared
  /// domain would let one test's save land between another's wipe and load.
  private func freshDefaults(_ name: String) -> UserDefaults {
    let name = "FieldTerminalTests-store-\(name)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  @Test func roundTripsThroughTheStore() {
    let defaults = freshDefaults("roundtrip")
    let appearance = TerminalAppearance(
      lightThemeName: "3024 Day",
      darkThemeName: "Vesper",
      backgroundOpacity: 0.85,
      dimsProgramBackgrounds: false,
      groundBlur: 8,
      shaderEffects: ["ghosttea:crt"],
      shaderAnimation: true,
      fontSize: 16)
    TerminalAppearanceStore.save(appearance, to: defaults)
    #expect(TerminalAppearanceStore.load(from: defaults) == appearance)
  }

  /// PF-13 (2026-11-23; DESIGN.md §8 "The card's glass is the field"): the
  /// blur behind a card and whether a program's backgrounds take the glass are
  /// settings. A record saved before either takes their defaults and keeps the
  /// rest; what is saved is read back under the ground's own names.
  @Test func aRecordFromBeforeTheBlurTakesItsDefaultsAndKeepsTheRest() throws {
    let old = Data(#"{"darkThemeName":"Vesper","groundOpacity":0.6,"shaderEffects":[],"fontSize":15}"#.utf8)
    let decoded = try JSONDecoder().decode(TerminalAppearance.self, from: old)
    #expect(decoded.groundBlur == 24)
    #expect(decoded.dimsProgramBackgrounds)
    #expect(decoded.backgroundOpacity == 0.6)
    #expect(decoded.darkThemeName == "Vesper")
    #expect(decoded.fontSize == 15)
    #expect(TerminalAppearance.default.groundBlur == 24)
    #expect(TerminalAppearance.default.dimsProgramBackgrounds)

    var chosen = decoded
    chosen.groundBlur = 0
    chosen.dimsProgramBackgrounds = false
    let saved = try JSONEncoder().encode(chosen)
    let keys = try #require(try JSONSerialization.jsonObject(with: saved) as? [String: Any])
    #expect(keys["groundBlur"] as? Double == 0)
    #expect(keys["groundOpacityCells"] as? Bool == false)
    // Sharp and solid slabs stay choices: what was saved is the person's.
    #expect(try JSONDecoder().decode(TerminalAppearance.self, from: saved) == chosen)
  }

  /// The blur the home is given is read through its range: sharp to the desk's
  /// 40, and the default where a record holds no number.
  @Test func theBlurIsReadThroughItsRange() {
    var appearance = TerminalAppearance.default
    #expect(TerminalAppearance.groundBlurRange == 0...40)
    #expect(appearance.clampedGroundBlur == 24)
    appearance.groundBlur = 0
    #expect(appearance.clampedGroundBlur == 0)
    appearance.groundBlur = 90
    #expect(appearance.clampedGroundBlur == 40)
    appearance.groundBlur = -3
    #expect(appearance.clampedGroundBlur == 0)
    appearance.groundBlur = .nan
    #expect(appearance.clampedGroundBlur == 24)
    appearance.groundBlur = .infinity
    #expect(appearance.clampedGroundBlur == 24)
  }

  /// PF-5 (2026-11-21; DESIGN.md §8 "The card's glass is the field"): the
  /// stored opacity was renamed with its default. Every record saved before
  /// carried 100%, which nobody chose, so a record's old value is left unread
  /// and the rest of the record is kept; what is saved now is read back.
  @Test func aRecordsOldOpacityIsLeftUnreadAndTheRestIsKept() throws {
    let old = Data(
      #"{"themeName":"Vesper","backgroundOpacity":1,"shaderEffects":["ghosttea:crt"],"shaderAnimation":true,"fontSize":16}"#
        .utf8)
    let decoded = try JSONDecoder().decode(TerminalAppearance.self, from: old)
    #expect(decoded.backgroundOpacity == 0.82)
    #expect(decoded.darkThemeName == "Vesper")
    #expect(decoded.shaderEffects == ["ghosttea:crt"])
    #expect(decoded.shaderAnimation)
    #expect(decoded.fontSize == 16)

    var chosen = decoded
    chosen.backgroundOpacity = 1
    let saved = try JSONEncoder().encode(chosen)
    let keys = try #require(try JSONSerialization.jsonObject(with: saved) as? [String: Any])
    #expect(keys["groundOpacity"] as? Double == 1)
    #expect(keys["backgroundOpacity"] == nil)
    // Solid stays a choice: a value saved under the new name is the person's.
    #expect(try JSONDecoder().decode(TerminalAppearance.self, from: saved).backgroundOpacity == 1)
  }

  /// PF-6 (2026-11-21; DESIGN.md §2.7 "The terminal's own colours", on the
  /// phone): a theme is picked for each mode. A record saved before held one,
  /// drawn in both: it is kept as the night's, and the day starts unpicked, so
  /// it takes the day look. The old key is read and never written again.
  @Test func aRecordsOneThemeIsKeptAsTheNightsAndTheDayStartsUnpicked() throws {
    let old = Data(#"{"themeName":"Matte Black","groundOpacity":0.82,"shaderEffects":["ghosttea:crt"]}"#.utf8)
    let decoded = try JSONDecoder().decode(TerminalAppearance.self, from: old)
    #expect(decoded.darkThemeName == "Matte Black")
    #expect(decoded.lightThemeName == nil)
    #expect(decoded.themeName(for: .dark) == "Matte Black")
    #expect(decoded.themeName(for: .light) == nil)
    #expect(decoded.shaderEffects == ["ghosttea:crt"])

    var picked = decoded
    picked.setThemeName("3024 Day", for: .light)
    picked.setThemeName("Vesper", for: .dark)
    let saved = try JSONEncoder().encode(picked)
    let keys = try #require(try JSONSerialization.jsonObject(with: saved) as? [String: Any])
    #expect(keys["lightThemeName"] as? String == "3024 Day")
    #expect(keys["darkThemeName"] as? String == "Vesper")
    #expect(keys["themeName"] == nil)
    #expect(try JSONDecoder().decode(TerminalAppearance.self, from: saved) == picked)

    // A mode put back on its own look is saved as no pick, and stays so when read back.
    picked.setThemeName(nil, for: .light)
    let unpicked = try JSONEncoder().encode(picked)
    #expect(try JSONDecoder().decode(TerminalAppearance.self, from: unpicked).lightThemeName == nil)
    // A record that says both: the new name wins over the retired one.
    let both = Data(#"{"themeName":"Matte Black","darkThemeName":"Vesper"}"#.utf8)
    #expect(try JSONDecoder().decode(TerminalAppearance.self, from: both).darkThemeName == "Vesper")
  }

  /// Neither mode has a theme picked until a person picks one.
  @Test func theDefaultPicksNoTheme() {
    #expect(TerminalAppearance.default.lightThemeName == nil)
    #expect(TerminalAppearance.default.darkThemeName == nil)
  }

  @Test func missingDataDegradesToDefault() {
    #expect(TerminalAppearanceStore.load(from: freshDefaults("missing")) == .default)
  }

  @Test func corruptDataDegradesToDefault() {
    let defaults = freshDefaults("corrupt")
    defaults.set(Data("not json".utf8), forKey: TerminalAppearanceStore.key)
    #expect(TerminalAppearanceStore.load(from: defaults) == .default)
  }

  /// A field added later must not reset a stored theme: every field decodes
  /// with a default when absent.
  @Test func decodingToleratesMissingFields() throws {
    let decoded = try JSONDecoder().decode(
      TerminalAppearance.self, from: Data(#"{"darkThemeName":"Vesper"}"#.utf8))
    #expect(decoded.darkThemeName == "Vesper")
    #expect(decoded.lightThemeName == nil)
    // PF-5: the ground nobody chose is the desktop's 82%.
    #expect(decoded.backgroundOpacity == 0.82)
    #expect(TerminalAppearance.default.backgroundOpacity == 0.82)
    #expect(decoded.shaderEffects.isEmpty)
    #expect(decoded.shaderAnimation == false)
    #expect(decoded.fontSize == 13)
  }
}
