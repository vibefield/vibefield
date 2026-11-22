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
      themeName: "Vesper",
      backgroundOpacity: 0.85,
      shaderEffects: ["ghosttea:crt"],
      shaderAnimation: true,
      fontSize: 16)
    TerminalAppearanceStore.save(appearance, to: defaults)
    #expect(TerminalAppearanceStore.load(from: defaults) == appearance)
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
    #expect(decoded.themeName == "Vesper")
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
      TerminalAppearance.self, from: Data(#"{"themeName":"Vesper"}"#.utf8))
    #expect(decoded.themeName == "Vesper")
    // PF-5: the ground nobody chose is the desktop's 82%.
    #expect(decoded.backgroundOpacity == 0.82)
    #expect(TerminalAppearance.default.backgroundOpacity == 0.82)
    #expect(decoded.shaderEffects.isEmpty)
    #expect(decoded.shaderAnimation == false)
    #expect(decoded.fontSize == 13)
  }
}
