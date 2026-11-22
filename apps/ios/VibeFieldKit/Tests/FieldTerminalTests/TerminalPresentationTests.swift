import Foundation
import GhostteaAppearance
import GhostteaCore
import Testing

@testable import FieldTerminal

@Suite struct PresentationConfigTests {
  /// Matte Black's catalog bytes, so a mapping regression is caught against
  /// the real generated data rather than our own fixture of it.
  @Test func mapsThemeColorsDirectly() {
    let config = presentationConfig(for: .default, mode: .dark)
    #expect(config.background == [0x12, 0x12, 0x12])
    #expect(config.foreground == [0xbe, 0xbe, 0xbe])
    #expect(config.cursor == [0xea, 0xea, 0xea])
    #expect(config.cursorText == [0x12, 0x12, 0x12])
    #expect(config.selectionBackground == [0x33, 0x33, 0x33])
    #expect(config.selectionForeground == [0xea, 0xea, 0xea])
  }

  /// Palette entries are carried through, never dropped — a theme without its
  /// 16 ANSI slots lies to every TUI.
  @Test func carriesTheWholePalette() {
    let config = presentationConfig(for: .default, mode: .dark)
    #expect(config.palette.count == 16)
    #expect(config.palette[0] == GhostteaPaletteConfigEntry(index: 0, color: [0x33, 0x33, 0x33]))
    #expect(config.palette[1] == GhostteaPaletteConfigEntry(index: 1, color: [0xd3, 0x5f, 0x5f]))
    #expect(config.palette[15] == GhostteaPaletteConfigEntry(index: 15, color: [0xff, 0xff, 0xff]))
  }

  @Test func unknownThemeDegradesToTheDefault() {
    var appearance = TerminalAppearance.default
    appearance.darkThemeName = "No Such Theme 2026"
    let config = presentationConfig(for: appearance, mode: .dark)
    #expect(config.background == [0x12, 0x12, 0x12])
    #expect(config.palette.count == 16)
  }

  @Test func nilThemeMeansTheDefault() {
    var appearance = TerminalAppearance.default
    appearance.darkThemeName = nil
    #expect(presentationConfig(for: appearance, mode: .dark).background == [0x12, 0x12, 0x12])
  }

  /// PF-6 (2026-11-21; DESIGN.md §2.7 "The terminal's own colours", on the
  /// phone): by day, with no theme picked, the terminal wears the desktop's
  /// day look. The paper, its ink, the day's sixteen, and the reference's
  /// cursor and selection laid over the paper.
  @Test func byDayTheTerminalWearsTheDayLook() {
    let config = presentationConfig(for: .default, mode: .light)
    #expect(config.background == [0xf1, 0xf0, 0xee])
    #expect(config.foreground == [0x1e, 0x22, 0x27])
    #expect(config.cursor == [0x60, 0x89, 0xb8])
    #expect(config.cursorText == [0xf1, 0xf0, 0xee])
    #expect(config.selectionBackground == [0xb6, 0xca, 0xde])
    #expect(config.selectionForeground == [0x1e, 0x22, 0x27])
    #expect(config.palette.count == 16)
    #expect(config.palette[0] == GhostteaPaletteConfigEntry(index: 0, color: [0x1e, 0x22, 0x27]))
    #expect(config.palette[1] == GhostteaPaletteConfigEntry(index: 1, color: [0xa9, 0x52, 0x4d]))
    #expect(config.palette[15] == GhostteaPaletteConfigEntry(index: 15, color: [0x81, 0x86, 0x8d]))
    #expect(config.isValid)
    // The mode is a renderer value: the two looks are two presentations.
    let night = presentationConfig(for: .default, mode: .dark)
    #expect(config.revision != night.revision)
    #expect(!config.hasSameDevicePresentation(as: night))
    // The glass, the type and the margins are the appearance's in both modes.
    #expect(config.backgroundOpacity == night.backgroundOpacity)
    #expect(config.fontSize == night.fontSize)
    #expect(config.paddingY == night.paddingY)
  }

  /// Each mode's pick is its own: a theme picked for the night leaves the day
  /// on its look, a theme picked for the day replaces the day's whole, and a
  /// name the catalog no longer carries falls back to the mode's own.
  @Test func eachModeWearsItsOwnPick() throws {
    var appearance = TerminalAppearance.default
    appearance.darkThemeName = "Vesper"
    #expect(presentationConfig(for: appearance, mode: .light).background == [0xf1, 0xf0, 0xee])
    #expect(presentationConfig(for: appearance, mode: .dark).background != [0x12, 0x12, 0x12])

    let picked = try #require(GhostteaThemeCatalog.themes.first { $0.name == "3024 Day" })
    appearance.lightThemeName = picked.name
    let day = presentationConfig(for: appearance, mode: .light)
    #expect(day.background == parseHexColor(picked.background))
    #expect(day.foreground == parseHexColor(picked.foreground))
    #expect(day.palette.first?.color == parseHexColor(picked.palette[0]))

    appearance.lightThemeName = "No Such Theme 2026"
    #expect(presentationConfig(for: appearance, mode: .light).background == [0xf1, 0xf0, 0xee])
    #expect(presentationConfig(for: appearance, mode: .light).isValid)
  }

  /// The hand-built bytes of each mode are that mode's own look, so a theme
  /// that cannot be resolved draws the look it would have drawn.
  @Test func theHandBuiltBytesAreEachModesOwnLook() {
    for mode in TerminalLookMode.allCases {
      let drawn = presentationConfig(for: .default, mode: mode)
      let bare = presentationConfig(for: .default, theme: nil, mode: mode)
      #expect(bare.background == drawn.background)
      #expect(bare.foreground == drawn.foreground)
      #expect(bare.cursor == drawn.cursor)
      #expect(bare.cursorText == drawn.cursorText)
      #expect(bare.selectionBackground == drawn.selectionBackground)
      #expect(bare.selectionForeground == drawn.selectionForeground)
      #expect(bare.isValid)
    }
  }

  /// The desktop's second net under a pane's text (DESIGN.md §8 "What a pane's
  /// text is held to"): under a light ground a program that paints most of its
  /// screen dark is redrawn as a light design. On in both modes; the renderer
  /// applies it only where the ground is light.
  @Test func keepsTheRenderersLightAdaptationOn() {
    #expect(presentationConfig(for: .default, mode: .light).lightAdaptation == .auto)
    #expect(presentationConfig(for: .default, mode: .dark).lightAdaptation == .auto)
  }

  @Test func clampsOpacityAndSanitizesFontSize() {
    var appearance = TerminalAppearance.default
    appearance.backgroundOpacity = 1.5
    #expect(presentationConfig(for: appearance, mode: .dark).backgroundOpacity == 1)
    appearance.backgroundOpacity = -0.2
    #expect(presentationConfig(for: appearance, mode: .dark).backgroundOpacity == 0)
    appearance.backgroundOpacity = .nan
    #expect(presentationConfig(for: appearance, mode: .dark).backgroundOpacity == 1)
    appearance.backgroundOpacity = 0.4
    #expect(abs(presentationConfig(for: appearance, mode: .dark).backgroundOpacity - 0.4) < 0.0001)

    appearance = .default
    appearance.fontSize = 0
    #expect(presentationConfig(for: appearance, mode: .dark).fontSize == 13)
    appearance.fontSize = -4
    #expect(presentationConfig(for: appearance, mode: .dark).fontSize == 13)
    appearance.fontSize = .nan
    #expect(presentationConfig(for: appearance, mode: .dark).fontSize == 13)
    appearance.fontSize = 16
    #expect(presentationConfig(for: appearance, mode: .dark).fontSize == 16)
  }

  /// Unknown ids dropped, duplicates removed, order preserved, animation flag
  /// carried — upstream's own validation rule for the shader list.
  @Test func filtersShadersToTheAvailablePorts() {
    var appearance = TerminalAppearance.default
    appearance.shaderEffects = [
      "ghosttea:crt", "not-a-shader", "ghosttea:crt", "ghosttea:vhs",
    ]
    appearance.shaderAnimation = true
    let config = presentationConfig(for: appearance, mode: .dark)
    #expect(config.shaderEffects == ["ghosttea:crt", "ghosttea:vhs"])
    #expect(config.customShaderAnimation == true)
    let available = GhostteaShaderOption.available.map(\.id)
    #expect(config.shaderEffects.allSatisfy(available.contains))
  }

  /// The fixed projection choices, each a finding (see the builder's header).
  @Test func fixedFieldsMatchThePlatformFindings() {
    let config = presentationConfig(for: .default, mode: .dark)
    #expect(config.schemaVersion == 1)
    #expect(config.fontFamilies.isEmpty)
    // The live card's text margin (item 41): the renderer's own 2pt origin on
    // top, so 10pt in from each edge, 2pt down and 8pt up from the foot.
    #expect(config.paddingX == [8, 8])
    #expect(config.paddingY == [0, 6])
    // PF-4: chrome over the surface's top keeps its room INSIDE the renderer, added to the
    // padding above, so the surface paints its ground there and only the grid begins lower.
    let underABand = presentationConfig(for: .default, mode: .dark, gridTopInset: 44)
    #expect(underABand.paddingY == [44, 6])
    #expect(underABand.paddingX == [8, 8])
    // a different device presentation, so a different revision: the renderer takes it
    #expect(underABand.revision != config.revision)
    #expect(presentationConfig(for: .default, mode: .dark, gridTopInset: 0).revision == config.revision)
    // a hostile inset never reaches the renderer
    #expect(presentationConfig(for: .default, mode: .dark, gridTopInset: -8).paddingY == [0, 6])
    #expect(presentationConfig(for: .default, mode: .dark, gridTopInset: .nan).paddingY == [0, 6])
    #expect(config.postProcess == .none)
    #expect(config.customShaderCount == 0)
    #expect(config.backgroundOpacityCells == false)
  }

  /// TL-4c (2026-11-19): a cell's colour arrives as its session was told it,
  /// and a session whose host is light is told inks made for a light ground.
  /// The phone holds its text to the desktop's 3:1 floor on every theme, so
  /// those inks stay readable on Matte Black.
  @Test func holdsTextToTheDesktopsContrastFloor() {
    #expect(presentationConfig(for: .default, mode: .dark).minimumContrast == 3)
    var appearance = TerminalAppearance.default
    appearance.darkThemeName = "Vesper"
    appearance.backgroundOpacity = 0.4
    #expect(presentationConfig(for: appearance, mode: .dark).minimumContrast == 3)
    #expect(presentationConfig(for: appearance, mode: .dark).isValid)
  }

  @Test func producedConfigsPassUpstreamValidation() {
    #expect(presentationConfig(for: .default, mode: .dark).isValid)
    var appearance = TerminalAppearance.default
    appearance.darkThemeName = "No Such Theme 2026"
    appearance.backgroundOpacity = .infinity
    appearance.fontSize = .nan
    #expect(presentationConfig(for: appearance, mode: .dark).isValid)
  }
}

@Suite struct PresentationRevisionTests {
  /// Deterministic: `Hasher` is seeded per process, and a revision that
  /// changed on relaunch would repaint an unchanged terminal.
  @Test func sameAppearanceSameRevision() {
    #expect(
      presentationConfig(for: .default, mode: .dark).revision == presentationConfig(for: .default, mode: .dark).revision)
    #expect(!presentationConfig(for: .default, mode: .dark).revision.isEmpty)
  }

  @Test func valueChangesMoveTheRevision() {
    var appearance = TerminalAppearance.default
    appearance.backgroundOpacity = 0.5
    #expect(
      presentationConfig(for: appearance, mode: .dark).revision != presentationConfig(for: .default, mode: .dark).revision)
    appearance = .default
    appearance.fontSize = 15
    #expect(
      presentationConfig(for: appearance, mode: .dark).revision != presentationConfig(for: .default, mode: .dark).revision)
    appearance = .default
    appearance.shaderEffects = ["ghosttea:vhs"]
    #expect(
      presentationConfig(for: appearance, mode: .dark).revision != presentationConfig(for: .default, mode: .dark).revision)
  }
}

@Suite struct DevicePresentationComparisonTests {
  private func rebuilt(
    _ config: GhostteaTerminalPresentationConfig,
    revision: String? = nil,
    fontSize: Float? = nil,
    background: [UInt8]? = nil
  ) -> GhostteaTerminalPresentationConfig {
    GhostteaTerminalPresentationConfig(
      schemaVersion: config.schemaVersion,
      revision: revision ?? config.revision,
      foreground: config.foreground,
      background: background ?? config.background,
      cursor: config.cursor,
      cursorText: config.cursorText,
      selectionBackground: config.selectionBackground,
      selectionForeground: config.selectionForeground,
      palette: config.palette,
      backgroundOpacity: config.backgroundOpacity,
      backgroundOpacityCells: config.backgroundOpacityCells,
      minimumContrast: config.minimumContrast,
      lightAdaptation: config.lightAdaptation,
      fontSize: fontSize ?? config.fontSize,
      fontFamilies: config.fontFamilies,
      paddingX: config.paddingX,
      paddingY: config.paddingY,
      postProcess: config.postProcess,
      shaderEffects: config.shaderEffects,
      customShaderAnimation: config.customShaderAnimation,
      customShaderCount: config.customShaderCount)
  }

  /// Revision is document identity, not a renderer value: comparing it would
  /// put unrelated edits on the Metal path.
  @Test func comparisonIgnoresRevision() {
    let base = presentationConfig(for: .default, mode: .dark)
    let revisionOnly = rebuilt(base, revision: "some-other-document")
    #expect(base.hasSameDevicePresentation(as: revisionOnly))
    let recolored = rebuilt(base, background: [0, 0, 0])
    #expect(!base.hasSameDevicePresentation(as: recolored))
  }

  /// Upstream's `requiresNewRuntime` is literally `fontSize != other.fontSize`
  /// — everything else reconfigures live through the sink.
  @Test func onlyFontSizeRequiresANewRuntime() {
    let base = presentationConfig(for: .default, mode: .dark)
    #expect(base.requiresNewRuntime(comparedTo: rebuilt(base, fontSize: base.fontSize + 2)))
    #expect(!base.requiresNewRuntime(comparedTo: rebuilt(base, background: [0, 0, 0])))
    var appearance = TerminalAppearance.default
    appearance.darkThemeName = "Vesper"
    appearance.backgroundOpacity = 0.3
    appearance.shaderEffects = ["ghosttea:crt"]
    appearance.shaderAnimation = true
    let restyled = presentationConfig(for: appearance, mode: .dark)
    #expect(!base.requiresNewRuntime(comparedTo: restyled))
  }
}
