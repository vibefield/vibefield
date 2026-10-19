import Foundation
import GhostteaCore
import SwiftUI
import Testing

@testable import FieldTerminal

/// Item 41 (2026-10-19): the phone's live card is drawn on the terminal's own
/// ground, and the chrome on it wears the ramp the ground's lightness picks.
@Suite struct TerminalGroundTests {
  private func config(background: [UInt8], opacity: Double = 1) -> GhostteaTerminalPresentationConfig {
    var appearance = TerminalAppearance.default
    appearance.backgroundOpacity = opacity
    let base = presentationConfig(for: appearance)
    return GhostteaTerminalPresentationConfig(
      schemaVersion: base.schemaVersion,
      revision: base.revision,
      foreground: base.foreground,
      background: background,
      cursor: base.cursor,
      cursorText: base.cursorText,
      selectionBackground: base.selectionBackground,
      selectionForeground: base.selectionForeground,
      palette: base.palette,
      backgroundOpacity: base.backgroundOpacity,
      backgroundOpacityCells: base.backgroundOpacityCells,
      fontSize: base.fontSize,
      fontFamilies: base.fontFamilies,
      paddingX: base.paddingX,
      paddingY: base.paddingY,
      postProcess: base.postProcess,
      shaderEffects: base.shaderEffects,
      customShaderAnimation: base.customShaderAnimation,
      customShaderCount: base.customShaderCount)
  }

  /// The default theme's ground is Matte Black, at full opacity, and takes the
  /// dark ramp: white text by day too, whatever the app's theme.
  @Test func matteBlackIsTheGroundAndTakesWhiteText() {
    let ground = TerminalGround(presentationConfig(for: .default))
    #expect(ground.red == Double(0x12) / 255)
    #expect(ground.green == Double(0x12) / 255)
    #expect(ground.blue == Double(0x12) / 255)
    #expect(ground.opacity == 1)
    #expect(ground.inkScheme == .dark)
  }

  /// A light theme's ground takes the light ramp (§2.7's paper, as a theme).
  @Test func aLightGroundTakesTheLightRamp() {
    #expect(TerminalGround(config(background: [0xEC, 0xE8, 0xDC])).inkScheme == .light)
    #expect(TerminalGround(config(background: [0xFF, 0xFF, 0xFF])).inkScheme == .light)
  }

  /// The rule is the WCAG contrast of the two inks, which crosses at a
  /// luminance of about 0.19: a mid grey either side of it flips the ramp.
  @Test func theRampFollowsTheContrastNotTheMidpoint() {
    let darker = TerminalGround(config(background: [0x74, 0x74, 0x74]))
    let lighter = TerminalGround(config(background: [0x80, 0x80, 0x80]))
    #expect(darker.luminance < 0.19)
    #expect(darker.inkScheme == .dark)
    #expect(lighter.luminance > 0.19)
    #expect(lighter.inkScheme == .light)
  }

  /// The appearance's opacity rides with the ground (a translucent terminal
  /// keeps the field showing through it), and never decides the ramp.
  @Test func opacityRidesWithTheGroundButNeverPicksTheRamp() {
    let ground = TerminalGround(config(background: [0x12, 0x12, 0x12], opacity: 0.4))
    #expect(abs(ground.opacity - 0.4) < 0.0001)
    #expect(ground.inkScheme == .dark)
  }

  /// T1 (2026-10-19): the badge's letters are the ground at full strength —
  /// a translucent terminal's ground would wash them out on text main — while
  /// the card still paints the ground at the appearance's opacity.
  @Test func theSolidGroundLeavesTheOpacityOut() {
    let ground = TerminalGround(config(background: [0x12, 0x12, 0x12], opacity: 0.4))
    #expect(ground.solidColor.resolve(in: EnvironmentValues()).opacity == 1)
    #expect(abs(ground.color.resolve(in: EnvironmentValues()).opacity - 0.4) < 0.001)
  }
}
