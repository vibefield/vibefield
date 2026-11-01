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

/// IOS-10a — the Theme page lists every theme (a `List` draws them lazily), so
/// the sheet's ten-row cap and its "10 of 602 shown" line retired; a search
/// heads its results with their count.
@Suite struct ThemeCountWordTests {
  @Test func countsWhatASearchFound() {
    #expect(TerminalSettingsModel.themeCountWord(4) == "4 themes")
    #expect(TerminalSettingsModel.themeCountWord(1) == "1 theme")
    #expect(TerminalSettingsModel.themeCountWord(0) == "0 themes")
  }

  /// `nil` is our default by contract, so the tick lands on the row that is
  /// actually rendering — and that row is in the real catalog.
  @Test func theDefaultThemeIsTheOneInUseAndIsCarried() {
    var appearance = TerminalAppearance.default
    appearance.themeName = nil
    let name = TerminalSettingsModel.themeName(of: appearance)
    #expect(name == "Matte Black")
    #expect(GhostteaThemeCatalog.themes.contains { $0.name == name })
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
    #expect(
      line.hasPrefix(
        "\(GhostteaShaderOption.unavailableUpstreamNames.count) more of Ghostty’s community shaders"))
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
    #expect(TerminalSettingsModel.unavailableShaderLine().hasPrefix("32 more of Ghostty’s"))
  }

  @Test func fourShadersShipWithLicencesAndDescriptions() {
    #expect(GhostteaShaderOption.available.count == 4)
    for shader in GhostteaShaderOption.available {
      #expect(!shader.license.isEmpty)
      #expect(!shader.description.isEmpty)
    }
  }
}

@Suite struct CatalogFootTests {
  @Test func namesTheRepoAndTheRevisionAsTheDesktopDoes() {
    #expect(
      TerminalSettingsModel.catalogFoot(
        count: 602,
        source: "https://github.com/mbadolato/iTerm2-Color-Schemes/tree/875a82f0fdc773ae/ghostty",
        revision: "875a82f0fdc773ae45099ce683a11c56bb0f8b3d")
        == "602 themes from iTerm2-Color-Schemes, as ghosttea bundles them · revision 875a82f0")
  }

  /// Anything that is not that URL shape is named whole rather than guessed at.
  @Test func namesAnUnfamiliarSourceWhole() {
    #expect(
      TerminalSettingsModel.catalogFoot(count: 3, source: "an internal mirror", revision: "abc")
        == "3 themes from an internal mirror, as ghosttea bundles them · revision abc")
    #expect(
      TerminalSettingsModel.catalogFoot(count: 1, source: "somewhere", revision: "")
        == "1 themes from somewhere, as ghosttea bundles them")
  }

  @Test func readsTheRealCatalogsProvenance() {
    let line = TerminalSettingsModel.catalogFoot()
    #expect(line.hasPrefix("\(GhostteaThemeCatalog.themes.count) themes from iTerm2-Color-Schemes"))
    #expect(line.hasSuffix(String(GhostteaThemeCatalog.revision.prefix(8))))
  }
}

/// IOS-10a — the pages are `List`s, which `ImageRenderer` does not draw, so
/// "it does not trap" is held where the trap would be: every readout the
/// pages format, over the default and over the hostile appearance a decoded
/// payload can carry (`Int(.nan)` traps).
@Suite struct PageReadoutTests {
  private let hostile = TerminalAppearance(
    themeName: "a theme the catalog never carried",
    backgroundOpacity: .nan,
    shaderEffects: ["ghosttea:not-a-shader", GhostteaShaderOption.available[3].id],
    shaderAnimation: true,
    fontSize: 0)

  @Test func readsTheDefaultAppearance() {
    let appearance = TerminalAppearance.default
    #expect(TerminalSettingsModel.percent(appearance.backgroundOpacity).hasSuffix("%"))
    #expect(TerminalSettingsModel.pointsText(appearance.fontSize) == "13 pt")
    #expect(TerminalSettingsModel.effectsWord(appearance.shaderEffects) == "None")
  }

  @Test func readsAHostileStoredAppearanceWithoutTrapping() {
    #expect(TerminalSettingsModel.percent(hostile.backgroundOpacity) == "100%")
    #expect(TerminalSettingsModel.opacityDetail(hostile.backgroundOpacity) == "Solid: the field stays behind the terminal.")
    #expect(TerminalSettingsModel.pointsText(hostile.fontSize) == "9 pt")
    #expect(TerminalSettingsModel.themeName(of: hostile) == "a theme the catalog never carried")
    // An id the renderer would drop is not an effect the terminal wears.
    #expect(TerminalSettingsModel.effectsWord(hostile.shaderEffects) == GhostteaShaderOption.available[3].name)
  }

  @Test func effectsAreNamedOneAtATimeAndCountedAfter() {
    let ids = GhostteaShaderOption.available.map(\.id)
    #expect(TerminalSettingsModel.effectsWord([]) == "None")
    #expect(TerminalSettingsModel.effectsWord([ids[1]]) == GhostteaShaderOption.available[1].name)
    #expect(TerminalSettingsModel.effectsWord([ids[1], ids[2]]) == "2 on")
  }

  /// The names are upstream's, read; the switch is what stops the motion,
  /// whatever Reduce Motion says, and the line tells the truth about it.
  @Test func animateDetailSaysWhatTheSwitchDoes() {
    let moving = GhostteaShaderOption.available.filter(\.animated)
    let still = GhostteaShaderOption.available.filter { !$0.animated }
    #expect(moving.count == 2)
    let off = TerminalSettingsModel.animateDetail(selection: still.map(\.id), reduceMotion: false)
    #expect(off == "Only \(moving[0].name) and \(moving[1].name) move. Turn one on to use this.")
    #expect(
      TerminalSettingsModel.animateDetail(selection: [moving[0].id], reduceMotion: false)
        == "Runs the motion in \(moving[0].name) and \(moving[1].name).")
    #expect(
      TerminalSettingsModel.animateDetail(selection: [moving[0].id], reduceMotion: true)
        == "Reduce Motion is on. Leave this off to keep the terminal still.")
  }

  @Test func opacityDetailFollowsTheDesktopsTwoLines() {
    #expect(TerminalSettingsModel.opacityDetail(1) == "Solid: the field stays behind the terminal.")
    #expect(TerminalSettingsModel.opacityDetail(0.85) == "The field shows through the terminal.")
    #expect(TerminalSettingsModel.percent(0.85) == "85%")
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
