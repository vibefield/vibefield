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
    #expect(decoded.backgroundOpacity == 1)
    #expect(decoded.shaderEffects.isEmpty)
    #expect(decoded.shaderAnimation == false)
    #expect(decoded.fontSize == 13)
  }
}
