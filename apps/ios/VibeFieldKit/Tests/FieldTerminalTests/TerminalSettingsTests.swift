import Foundation
import GhostteaAppearance
import SwiftUI
import Testing

@testable import FieldTerminal

/// `GhostteaColorTheme`'s memberwise init is internal to its module, so
/// fixtures are decoded — which also exercises the exact shape the real
/// catalog arrives in.
private func makeTheme(
  name: String,
  background: String = "#101010",
  foreground: String = "#e0e0e0",
  cursor: String = "#ffffff",
  palette: [String] = []
) throws -> GhostteaColorTheme {
  let object: [String: Any] = [
    "name": name,
    "background": background,
    "foreground": foreground,
    "cursor": cursor,
    "cursorText": "#101010",
    "selection": "#333333",
    "selectionForeground": "#ffffff",
    "palette": palette,
  ]
  let data = try JSONSerialization.data(withJSONObject: object)
  return try JSONDecoder().decode(GhostteaColorTheme.self, from: data)
}

private func catalogFixture() throws -> [GhostteaColorTheme] {
  [
    try makeTheme(name: "Matte Black"),
    try makeTheme(name: "Solarized Dark"),
    try makeTheme(name: "solarized light"),
    try makeTheme(name: "Tokyo Night"),
  ]
}

@Suite struct ThemeSearchTests {
  @Test func emptyQueryReturnsEverything() throws {
    let catalog = try catalogFixture()
    #expect(TerminalSettingsModel.themes(matching: "", in: catalog).count == catalog.count)
  }

  /// A field holding only spaces is nothing typed, not a filter that matches
  /// nothing — the list must not empty itself under a stray space.
  @Test func whitespaceQueryReturnsEverything() throws {
    let catalog = try catalogFixture()
    #expect(TerminalSettingsModel.themes(matching: "   ", in: catalog).count == catalog.count)
    #expect(TerminalSettingsModel.themes(matching: "\n ", in: catalog).count == catalog.count)
  }

  @Test func matchesNameCaseInsensitively() throws {
    let catalog = try catalogFixture()
    let hits = TerminalSettingsModel.themes(matching: "SOLAR", in: catalog).map(\.name)
    #expect(hits == ["Solarized Dark", "solarized light"])
    #expect(TerminalSettingsModel.themes(matching: "night", in: catalog).map(\.name)
      == ["Tokyo Night"])
  }

  /// Surrounding whitespace is the keyboard's, not the user's intent.
  @Test func trimsTheQueryBeforeMatching() throws {
    let catalog = try catalogFixture()
    #expect(TerminalSettingsModel.themes(matching: "  tokyo ", in: catalog).map(\.name)
      == ["Tokyo Night"])
  }

  @Test func noMatchIsEmpty() throws {
    let catalog = try catalogFixture()
    #expect(TerminalSettingsModel.themes(matching: "nothing-like-this", in: catalog).isEmpty)
  }

  /// The catalog is searched by name only: a query that happens to be a color
  /// value must not drag in every theme carrying that color.
  @Test func doesNotMatchColorValues() throws {
    let catalog = try catalogFixture()
    #expect(TerminalSettingsModel.themes(matching: "#101010", in: catalog).isEmpty)
  }
}

@Suite struct ThemeResultsTests {
  @Test func floatsTheSelectionAndReportsThePreCapTotal() throws {
    let catalog = try catalogFixture()
    let results = TerminalSettingsModel.themeResults(
      query: "", selected: "Tokyo Night", limit: 2, in: catalog)
    #expect(results.shown.map(\.name) == ["Tokyo Night", "Matte Black"])
    #expect(results.total == 4)
  }

  /// A search is an instruction: a selection the query excludes stays excluded.
  @Test func doesNotFloatASelectionTheQueryExcludes() throws {
    let catalog = try catalogFixture()
    let results = TerminalSettingsModel.themeResults(
      query: "solar", selected: "Tokyo Night", in: catalog)
    #expect(results.shown.map(\.name) == ["Solarized Dark", "solarized light"])
    #expect(results.total == 2)
  }

  @Test func capsTheRenderedRows() throws {
    let catalog = try catalogFixture()
    let results = TerminalSettingsModel.themeResults(
      query: "", selected: nil, limit: 1, in: catalog)
    #expect(results.shown.count == 1)
    #expect(results.total == 4)
  }

  @Test func handlesAnEmptyCatalog() {
    let results = TerminalSettingsModel.themeResults(query: "x", selected: "Matte Black", in: [])
    #expect(results.shown.isEmpty)
    #expect(results.total == 0)
  }

  /// The real catalog, so the cap and the default selection are exercised
  /// against the 602 themes the sheet actually renders.
  @Test func theDefaultThemeLeadsTheRealCatalog() {
    let results = TerminalSettingsModel.themeResults(
      query: "", selected: TerminalAppearance.default.themeName)
    #expect(results.total == GhostteaThemeCatalog.themes.count)
    #expect(results.shown.count == TerminalSettingsModel.themeResultLimit)
    #expect(results.shown.first?.name == "Matte Black")
  }
}

@Suite struct ThemeCountLineTests {
  @Test func namesWhatIsWithheld() {
    #expect(
      TerminalSettingsModel.themeCountLine(shown: 10, total: 602, query: "")
        == "10 of 602 shown — search narrows the list")
  }

  @Test func statesTheWholeCountWhenNothingIsWithheld() {
    #expect(TerminalSettingsModel.themeCountLine(shown: 4, total: 4, query: "sol") == "4 themes")
    #expect(TerminalSettingsModel.themeCountLine(shown: 1, total: 1, query: "sol") == "1 theme")
  }

  @Test func emptyResultsQuoteTheQuery() {
    #expect(
      TerminalSettingsModel.themeCountLine(shown: 0, total: 0, query: " nope ")
        == "no theme matches “nope”")
    #expect(
      TerminalSettingsModel.themeCountLine(shown: 0, total: 0, query: "") == "the catalog is empty")
  }
}

@Suite struct SwatchDerivationTests {
  @Test func takesTheChromeThenTheNormalAnsiRow() throws {
    let palette = (0..<16).map { String(format: "#%02x0000", $0 * 16) }
    let theme = try makeTheme(
      name: "Fixture", background: "#010203", foreground: "#0a0b0c", cursor: "#ffffff",
      palette: palette)
    let bytes = TerminalSettingsModel.swatchBytes(for: theme)
    #expect(bytes.count == TerminalSettingsModel.swatchCount)
    #expect(bytes[0] == [0x01, 0x02, 0x03])
    #expect(bytes[1] == [0x0a, 0x0b, 0x0c])
    #expect(bytes[2] == [0xff, 0xff, 0xff])
    // The 16-entry palette is truncated to the normal-intensity row.
    #expect(bytes[3] == [0x00, 0x00, 0x00])
    #expect(bytes.last == [0x70, 0x00, 0x00])
  }

  /// Malformed values are dropped, never substituted — an invented color would
  /// misrepresent the theme the row is showing.
  @Test func dropsMalformedEntriesWithoutCrashing() throws {
    let theme = try makeTheme(
      name: "Broken", background: "not-a-color", foreground: "#0a0b0c", cursor: "",
      palette: ["#111111", "#gg0000", "#2222", "#333333"])
    let bytes = TerminalSettingsModel.swatchBytes(for: theme)
    #expect(bytes == [[0x0a, 0x0b, 0x0c], [0x11, 0x11, 0x11], [0x33, 0x33, 0x33]])
  }

  @Test func aWhollyMalformedThemeYieldsAnEmptyStrip() throws {
    let theme = try makeTheme(
      name: "Hopeless", background: "x", foreground: "y", cursor: "z", palette: ["w"])
    #expect(TerminalSettingsModel.swatchBytes(for: theme).isEmpty)
  }

  @Test func aPaletteLessThemeStillShowsItsChrome() throws {
    let theme = try makeTheme(name: "Bare")
    #expect(TerminalSettingsModel.swatchBytes(for: theme).count == 3)
  }

  /// Every real theme parses: the strip is never a guess about the catalog.
  @Test func everyCatalogThemeYieldsAFullStrip() {
    for theme in GhostteaThemeCatalog.themes {
      #expect(
        TerminalSettingsModel.swatchBytes(for: theme).count == TerminalSettingsModel.swatchCount)
    }
  }
}

@Suite struct ShaderSelectionTests {
  private var ids: [String] { GhostteaShaderOption.available.map(\.id) }

  @Test func addingAppendsInTheOrderChosen() {
    var selection: [String] = []
    selection = TerminalSettingsModel.toggling(shader: ids[2], in: selection)
    selection = TerminalSettingsModel.toggling(shader: ids[0], in: selection)
    selection = TerminalSettingsModel.toggling(shader: ids[3], in: selection)
    #expect(selection == [ids[2], ids[0], ids[3]])
  }

  @Test func removingPreservesTheRemainingOrder() {
    let selection = [ids[2], ids[0], ids[3]]
    #expect(TerminalSettingsModel.toggling(shader: ids[0], in: selection) == [ids[2], ids[3]])
  }

  @Test func reAddingRestoresItAtTheEnd() {
    var selection = [ids[0], ids[1]]
    selection = TerminalSettingsModel.toggling(shader: ids[0], in: selection)
    selection = TerminalSettingsModel.toggling(shader: ids[0], in: selection)
    #expect(selection == [ids[1], ids[0]])
  }

  /// We never hold an id the renderer would drop — but one already stored (an
  /// upstream port that left the available set) must still be removable.
  @Test func unavailableIdsCannotBeAddedButCanBeRemoved() {
    #expect(TerminalSettingsModel.toggling(shader: "ghosttea:not-a-shader", in: []) == [])
    #expect(
      TerminalSettingsModel.toggling(shader: "ghosttea:not-a-shader", in: ["ghosttea:not-a-shader"])
        == [])
  }

  @Test func animationOnlyMattersWhenAnAnimatedShaderIsChosen() {
    let animated = GhostteaShaderOption.available.filter(\.animated).map(\.id)
    let still = GhostteaShaderOption.available.filter { !$0.animated }.map(\.id)
    #expect(!TerminalSettingsModel.hasAnimatedShader(in: []))
    #expect(!TerminalSettingsModel.hasAnimatedShader(in: still))
    #expect(TerminalSettingsModel.hasAnimatedShader(in: [animated[0]]))
    #expect(TerminalSettingsModel.hasAnimatedShader(in: still + [animated[0]]))
  }
}

@Suite struct UnavailableShaderLineTests {
  /// The count is read from upstream, never written down: the day a port's
  /// rights clear, the line stops claiming it.
  @Test func countsUpstreamsOwnList() {
    let line = TerminalSettingsModel.unavailableShaderLine()
    #expect(line.hasPrefix("\(GhostteaShaderOption.unavailableUpstreamNames.count) more ports"))
    #expect(line.contains("their redistribution terms are unclear"))
    #expect(!line.contains("sorry"))
  }

  /// The number at 0.9.2, pinned so a lockstep bump that changes it is seen.
  ///
  /// It is **32**, not the 31 `thinking-ios-app.md` §10.1 records — counted off
  /// the array at 0.9.2 (`water` is the 32nd). The shipped line reads the count
  /// rather than quoting the doc, so only this pin needed correcting.
  @Test func upstreamCarriesThirtyTwoUnavailablePorts() {
    #expect(GhostteaShaderOption.unavailableUpstreamNames.count == 32)
    #expect(TerminalSettingsModel.unavailableShaderLine().hasPrefix("32 more ports"))
  }

  @Test func fourShadersShipWithLicencesAndDescriptions() {
    #expect(GhostteaShaderOption.available.count == 4)
    for shader in GhostteaShaderOption.available {
      #expect(!shader.license.isEmpty)
      #expect(!shader.description.isEmpty)
    }
  }
}

@Suite struct CatalogAttributionTests {
  @Test func namesTheRepoAndTheExactCommit() {
    #expect(
      TerminalSettingsModel.catalogAttribution(
        source: "https://github.com/mbadolato/iTerm2-Color-Schemes/tree/875a82f0/ghostty",
        revision: "875a82f0") == "mbadolato/iTerm2-Color-Schemes @ 875a82f0")
  }

  /// Anything that is not that URL shape is shown whole rather than guessed at.
  @Test func showsAnUnfamiliarSourceVerbatim() {
    #expect(
      TerminalSettingsModel.catalogAttribution(source: "an internal mirror", revision: "abc")
        == "an internal mirror @ abc")
    #expect(
      TerminalSettingsModel.catalogAttribution(source: "somewhere", revision: "") == "somewhere")
  }

  @Test func readsTheRealCatalogsProvenance() {
    let line = TerminalSettingsModel.catalogAttribution()
    #expect(line.hasPrefix("mbadolato/iTerm2-Color-Schemes @ "))
    #expect(line.hasSuffix(GhostteaThemeCatalog.revision))
  }
}

/// The view is not unit-testable, but "it does not trap" is: rendering it once
/// evaluates every section against a given appearance — including the hostile
/// one a decoded payload can carry.
@Suite struct SheetRenderTests {
  @MainActor private func render(_ appearance: TerminalAppearance) -> Bool {
    var reported: TerminalAppearance?
    let renderer = ImageRenderer(
      content: TerminalSettingsSheet(appearance: appearance) { reported = $0 }
        .frame(width: 393, height: 800))
    let image = renderer.uiImage
    // Rendering is not a change: the host must not be told anything happened.
    #expect(reported == nil)
    return image != nil
  }

  @MainActor @Test func rendersTheDefaultAppearance() {
    #expect(render(.default))
  }

  @MainActor @Test func rendersAHostileStoredAppearance() {
    #expect(
      render(
        TerminalAppearance(
          themeName: "a theme the catalog never carried",
          backgroundOpacity: .nan,
          shaderEffects: ["ghosttea:not-a-shader", GhostteaShaderOption.available[3].id],
          shaderAnimation: true,
          fontSize: 0)))
  }
}

@Suite struct FontSizeStepTests {
  @Test func stepsByOnePointWithinTheRange() {
    #expect(TerminalSettingsModel.steppedFontSize(from: 13, by: 1) == 14)
    #expect(TerminalSettingsModel.steppedFontSize(from: 13, by: -1) == 12)
  }

  @Test func clampsAtBothEnds() {
    let range = TerminalSettingsModel.fontSizeRange
    #expect(
      TerminalSettingsModel.steppedFontSize(from: range.upperBound, by: 1) == range.upperBound)
    #expect(
      TerminalSettingsModel.steppedFontSize(from: range.lowerBound, by: -1) == range.lowerBound)
    #expect(TerminalSettingsModel.clampedFontSize(999) == range.upperBound)
    #expect(TerminalSettingsModel.clampedFontSize(-4) == range.lowerBound)
  }

  /// A decoded payload can carry anything; the stepper must land on a legible
  /// size rather than propagate a NaN into the renderer — and `Int(.nan)` traps,
  /// which is what the readout formats.
  @Test func degradesNonFiniteValuesToTheBase() {
    #expect(TerminalSettingsModel.clampedFontSize(.nan) == 13)
    #expect(TerminalSettingsModel.steppedFontSize(from: .infinity, by: 1) == 13 + 1)
    #expect(TerminalSettingsModel.clampedFontSize(TerminalAppearance.default.fontSize) == 13)
  }
}

@Suite struct OpacityClampTests {
  /// The same rule `presentationConfig` applies, so the readout states what the
  /// terminal will do rather than what happened to be stored.
  @Test func mirrorsTheProjectionsRule() {
    #expect(TerminalSettingsModel.clampedOpacity(0.65) == 0.65)
    #expect(TerminalSettingsModel.clampedOpacity(1.4) == 1)
    #expect(TerminalSettingsModel.clampedOpacity(-2) == 0)
    #expect(TerminalSettingsModel.clampedOpacity(.nan) == 1)
    #expect(TerminalSettingsModel.clampedOpacity(.infinity) == 1)
  }
}
