import Foundation
import GhostteaAppearance
import GhostteaCore
import Testing

@testable import FieldTerminal

@Suite struct PresentationConfigTests {
  /// Matte Black's catalog bytes, so a mapping regression is caught against
  /// the real generated data rather than our own fixture of it.
  @Test func mapsThemeColorsDirectly() {
    let config = presentationConfig(for: .default)
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
    let config = presentationConfig(for: .default)
    #expect(config.palette.count == 16)
    #expect(config.palette[0] == GhostteaPaletteConfigEntry(index: 0, color: [0x33, 0x33, 0x33]))
    #expect(config.palette[1] == GhostteaPaletteConfigEntry(index: 1, color: [0xd3, 0x5f, 0x5f]))
    #expect(config.palette[15] == GhostteaPaletteConfigEntry(index: 15, color: [0xff, 0xff, 0xff]))
  }

  @Test func unknownThemeDegradesToTheDefault() {
    var appearance = TerminalAppearance.default
    appearance.themeName = "No Such Theme 2026"
    let config = presentationConfig(for: appearance)
    #expect(config.background == [0x12, 0x12, 0x12])
    #expect(config.palette.count == 16)
  }

  @Test func nilThemeMeansTheDefault() {
    var appearance = TerminalAppearance.default
    appearance.themeName = nil
    #expect(presentationConfig(for: appearance).background == [0x12, 0x12, 0x12])
  }

  @Test func clampsOpacityAndSanitizesFontSize() {
    var appearance = TerminalAppearance.default
    appearance.backgroundOpacity = 1.5
    #expect(presentationConfig(for: appearance).backgroundOpacity == 1)
    appearance.backgroundOpacity = -0.2
    #expect(presentationConfig(for: appearance).backgroundOpacity == 0)
    appearance.backgroundOpacity = .nan
    #expect(presentationConfig(for: appearance).backgroundOpacity == 1)
    appearance.backgroundOpacity = 0.4
    #expect(abs(presentationConfig(for: appearance).backgroundOpacity - 0.4) < 0.0001)

    appearance = .default
    appearance.fontSize = 0
    #expect(presentationConfig(for: appearance).fontSize == 13)
    appearance.fontSize = -4
    #expect(presentationConfig(for: appearance).fontSize == 13)
    appearance.fontSize = .nan
    #expect(presentationConfig(for: appearance).fontSize == 13)
    appearance.fontSize = 16
    #expect(presentationConfig(for: appearance).fontSize == 16)
  }

  /// Unknown ids dropped, duplicates removed, order preserved, animation flag
  /// carried — upstream's own validation rule for the shader list.
  @Test func filtersShadersToTheAvailablePorts() {
    var appearance = TerminalAppearance.default
    appearance.shaderEffects = [
      "ghosttea:crt", "not-a-shader", "ghosttea:crt", "ghosttea:vhs",
    ]
    appearance.shaderAnimation = true
    let config = presentationConfig(for: appearance)
    #expect(config.shaderEffects == ["ghosttea:crt", "ghosttea:vhs"])
    #expect(config.customShaderAnimation == true)
    let available = GhostteaShaderOption.available.map(\.id)
    #expect(config.shaderEffects.allSatisfy(available.contains))
  }

  /// The fixed projection choices, each a finding (see the builder's header).
  @Test func fixedFieldsMatchThePlatformFindings() {
    let config = presentationConfig(for: .default)
    #expect(config.schemaVersion == 1)
    #expect(config.fontFamilies.isEmpty)
    #expect(config.paddingX == [2, 2])
    #expect(config.paddingY == [2, 2])
    #expect(config.postProcess == .none)
    #expect(config.customShaderCount == 0)
    #expect(config.backgroundOpacityCells == false)
  }

  @Test func producedConfigsPassUpstreamValidation() {
    #expect(presentationConfig(for: .default).isValid)
    var appearance = TerminalAppearance.default
    appearance.themeName = "No Such Theme 2026"
    appearance.backgroundOpacity = .infinity
    appearance.fontSize = .nan
    #expect(presentationConfig(for: appearance).isValid)
  }
}

@Suite struct PresentationRevisionTests {
  /// Deterministic: `Hasher` is seeded per process, and a revision that
  /// changed on relaunch would repaint an unchanged terminal.
  @Test func sameAppearanceSameRevision() {
    #expect(
      presentationConfig(for: .default).revision == presentationConfig(for: .default).revision)
    #expect(!presentationConfig(for: .default).revision.isEmpty)
  }

  @Test func valueChangesMoveTheRevision() {
    var appearance = TerminalAppearance.default
    appearance.backgroundOpacity = 0.5
    #expect(
      presentationConfig(for: appearance).revision != presentationConfig(for: .default).revision)
    appearance = .default
    appearance.fontSize = 15
    #expect(
      presentationConfig(for: appearance).revision != presentationConfig(for: .default).revision)
    appearance = .default
    appearance.shaderEffects = ["ghosttea:vhs"]
    #expect(
      presentationConfig(for: appearance).revision != presentationConfig(for: .default).revision)
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
    let base = presentationConfig(for: .default)
    let revisionOnly = rebuilt(base, revision: "some-other-document")
    #expect(base.hasSameDevicePresentation(as: revisionOnly))
    let recolored = rebuilt(base, background: [0, 0, 0])
    #expect(!base.hasSameDevicePresentation(as: recolored))
  }

  /// Upstream's `requiresNewRuntime` is literally `fontSize != other.fontSize`
  /// — everything else reconfigures live through the sink.
  @Test func onlyFontSizeRequiresANewRuntime() {
    let base = presentationConfig(for: .default)
    #expect(base.requiresNewRuntime(comparedTo: rebuilt(base, fontSize: base.fontSize + 2)))
    #expect(!base.requiresNewRuntime(comparedTo: rebuilt(base, background: [0, 0, 0])))
    var appearance = TerminalAppearance.default
    appearance.themeName = "Vesper"
    appearance.backgroundOpacity = 0.3
    appearance.shaderEffects = ["ghosttea:crt"]
    appearance.shaderAnimation = true
    let restyled = presentationConfig(for: appearance)
    #expect(!base.requiresNewRuntime(comparedTo: restyled))
  }
}
