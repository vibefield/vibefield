import FieldDesign
import Foundation
import GhostteaAppearance
import SwiftUI

// Item 358 (asked for 2026-11-12, of the phone's Settings › Terminal: it had no preview) —
// the page's PREVIEW, as the desktop's Look tab opens on one (`GodviewMiniature`, DESIGN.md §8 "The terminal preview
// is Godview in miniature"): the phone's live card in miniature.
//
// What is real and what stands in, said here as the desktop's says it:
// - The GROUND is the terminal's own: the theme's background at the opacity the renderer will be handed
//   (`TerminalGround`'s recipe), over a depiction of the field, so the opacity is seen and not only read.
// - The FIELD behind it is a depiction: the sheet's paper and a few bodies as circles.
// - The TEXT is a sample, in the theme's own colours at the chosen size. A real terminal's glyphs are rasterised on
//   the desktop that runs it, so its type and its colours are that desktop's (the page's foot says so, and the
//   caption says "Sample text").
// - The EFFECTS are not drawn: they are the renderer's, over a real terminal, and the caption says so.
// It is a picture, never a second terminal: one accessibility element, no touch.

/// The preview's values: the theme's colours as the picture uses them, the sample, and the words.
enum TerminalLookPreviewModel {
  /// One run of the sample's text. `fg` and `bg` are palette slots (0…15); a run with neither is the theme's
  /// foreground on the ground.
  struct Run: Equatable {
    let text: String
    var fg: Int? = nil
    var bg: Int? = nil
    var bold = false
    var selected = false
    var cursor = false

    init(_ text: String, fg: Int? = nil, bg: Int? = nil, bold: Bool = false, selected: Bool = false, cursor: Bool = false) {
      self.text = text
      self.fg = fg
      self.bg = bg
      self.bold = bold
      self.selected = selected
      self.cursor = cursor
    }
  }

  /// The sample: the desktop preview's own shell lines (`GodviewMiniature`'s `SHELL`), so the two previews show one
  /// screen. A prompt, a run with a pass and a fail, a selection, and the cursor on the last line.
  static let sample: [[Run]] = [
    [Run("~/Projects/vibe-field", fg: 4, bold: true), Run(" on "), Run("main", fg: 5, bold: true), Run(" ⇡2 !3", fg: 1)],
    [Run("❯ ", fg: 2), Run("pnpm verify")],
    [Run(" PASS ", fg: 0, bg: 2, bold: true), Run(" field-app "), Run("958 tests", fg: 8), Run("  21.4s", fg: 8)],
    [Run(" FAIL ", fg: 15, bg: 1, bold: true), Run(" biome     "), Run("2 errors", fg: 1)],
    [Run("  src/panels/terminal/LookTab.tsx", fg: 6), Run(":128:9", fg: 8)],
    [Run("  lint/style/useTemplate ", fg: 3), Run("use a template literal")],
    [Run("❯ ", fg: 2), Run("git log --oneline -1")],
    [Run("0e321805", fg: 3, selected: true), Run(" AR-S2c: plans in the profile", selected: true)],
    [Run("❯ ", fg: 2), Run("ls packages/")],
    [Run("❯ ", fg: 2), Run(" ", cursor: true)],
  ]

  /// A theme's colours as three bytes each. A value the catalog's format does not bless falls back to the picture's
  /// own neutral (the ground and text of the default theme), never to an invented colour of the theme's.
  struct Inks: Equatable {
    let ground: [UInt8]
    let foreground: [UInt8]
    let cursor: [UInt8]
    let cursorText: [UInt8]
    let selection: [UInt8]
    let selectionForeground: [UInt8]
    let palette: [[UInt8]]

    /// A palette slot's colour; a slot the theme does not carry is its foreground.
    func slot(_ index: Int) -> [UInt8] {
      palette.indices.contains(index) ? palette[index] : foreground
    }
  }

  /// `TerminalGround`'s own fallback, and Matte Black's text (`TerminalLook.nightThemeName`'s note).
  static let neutralGround: [UInt8] = [0x12, 0x12, 0x12]
  static let neutralText: [UInt8] = [0xBE, 0xBE, 0xBE]

  static func inks(
    background: String, foreground: String, cursor: String, cursorText: String, selection: String,
    selectionForeground: String, palette: [String]
  ) -> Inks {
    let ground = parseHexColor(background) ?? neutralGround
    let text = parseHexColor(foreground) ?? neutralText
    return Inks(
      ground: ground, foreground: text,
      cursor: parseHexColor(cursor) ?? text,
      cursorText: parseHexColor(cursorText) ?? ground,
      selection: parseHexColor(selection) ?? text,
      selectionForeground: parseHexColor(selectionForeground) ?? ground,
      palette: palette.map { parseHexColor($0) ?? text })
  }

  /// The colours of the theme the terminal wears in a mode (PF-6: the one picked for it, else the mode's own look,
  /// `TerminalLook.theme`); the neutral pair by night when the catalog has lost the night's own.
  static func inks(
    for appearance: TerminalAppearance, mode: TerminalLookMode,
    in catalog: [GhostteaColorTheme] = GhostteaThemeCatalog.themes
  ) -> Inks {
    guard let theme = TerminalLook.theme(for: appearance, mode: mode, in: catalog) else {
      return Inks(
        ground: neutralGround, foreground: neutralText, cursor: neutralText, cursorText: neutralGround,
        selection: neutralText, selectionForeground: neutralGround, palette: [])
    }
    return inks(
      background: theme.background, foreground: theme.foreground, cursor: theme.cursor, cursorText: theme.cursorText,
      selection: theme.selection, selectionForeground: theme.selectionForeground, palette: theme.palette)
  }

  /// A run's ink and what it stands on (nil: the ground). The cursor and the selection outrank a slot, as a
  /// terminal draws them.
  static func colours(of run: Run, in inks: Inks) -> (ink: [UInt8], ground: [UInt8]?) {
    if run.cursor { return (inks.cursorText, inks.cursor) }
    if run.selected { return (inks.selectionForeground, inks.selection) }
    return (run.fg.map(inks.slot) ?? inks.foreground, run.bg.map(inks.slot))
  }

  /// The caption's left: the theme and the size. Its right: what the picture is not.
  static func caption(
    _ appearance: TerminalAppearance, mode: TerminalLookMode
  ) -> (theme: String, size: String, note: String) {
    let on = GhostteaShaderOption.available.filter { appearance.shaderEffects.contains($0.id) }
    return (
      TerminalSettingsModel.themeName(of: appearance, mode: mode),
      TerminalSettingsModel.pointsText(appearance.fontSize),
      on.isEmpty ? "Sample text" : "Sample text · effects not drawn"
    )
  }

  /// The picture, said: it is one element to VoiceOver.
  static func spoken(_ appearance: TerminalAppearance, mode: TerminalLookMode) -> String {
    let caption = caption(appearance, mode: mode)
    let points = Int(TerminalSettingsModel.clampedFontSize(appearance.fontSize).rounded())
    let opacity = TerminalSettingsModel.percent(appearance.backgroundOpacity)
    return "Preview of the terminal’s look. \(caption.theme), \(points) points, background \(opacity). "
      + "The text is a sample."
  }
}

/// Settings › Terminal's preview: the live card in miniature, and its caption.
struct TerminalLookPreview: View {
  let appearance: TerminalAppearance
  /// The mode the phone is in: the preview shows the theme the terminal wears now (PF-6).
  let mode: TerminalLookMode

  /// The picture's height at the list's width.
  static let height: CGFloat = 176

  var body: some View {
    let inks = TerminalLookPreviewModel.inks(for: appearance, mode: mode)
    let opacity = TerminalSettingsModel.clampedOpacity(appearance.backgroundOpacity)
    let size = CGFloat(TerminalSettingsModel.clampedFontSize(appearance.fontSize))
    let caption = TerminalLookPreviewModel.caption(appearance, mode: mode)
    let shape = RoundedRectangle(cornerRadius: ChromeRadius.card, style: .continuous)
    return VStack(alignment: .leading, spacing: 8) {
      ZStack {
        FieldDepiction()
        Self.color(inks.ground).opacity(opacity)
      }
      .frame(maxWidth: .infinity)
      .frame(height: Self.height)
      .overlay(alignment: .topLeading) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(TerminalLookPreviewModel.sample.enumerated()), id: \.offset) { _, line in
            Text(Self.attributed(line, inks: inks, size: size))
              .lineLimit(1)
              .fixedSize(horizontal: true, vertical: false)
          }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
      }
      .clipShape(shape)
      .overlay(shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5))
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        (Text(caption.theme).fontWeight(.semibold) + Text(" · \(caption.size)"))
          .monospacedDigit()
        Spacer(minLength: 8)
        Text(caption.note)
      }
      .font(ChromeListType.detail)
      .foregroundStyle(ChromePalette.inkTertiary)
      .lineLimit(1)
      .padding(.horizontal, 6)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(TerminalLookPreviewModel.spoken(appearance, mode: mode))
    .accessibilityAddTraits(.isImage)
    .allowsHitTesting(false)
  }

  private static func color(_ rgb: [UInt8]) -> Color {
    guard rgb.count == 3 else { return .clear }
    return Color(.sRGB, red: Double(rgb[0]) / 255, green: Double(rgb[1]) / 255, blue: Double(rgb[2]) / 255)
  }

  /// One line of the sample as one run of text, each piece in its own ink on its own ground.
  private static func attributed(
    _ line: [TerminalLookPreviewModel.Run], inks: TerminalLookPreviewModel.Inks, size: CGFloat
  ) -> AttributedString {
    var out = AttributedString()
    for run in line {
      var piece = AttributedString(run.text)
      let colours = TerminalLookPreviewModel.colours(of: run, in: inks)
      piece.font = .system(size: size, weight: run.bold ? .bold : .regular, design: .monospaced)
      piece.foregroundColor = color(colours.ink)
      if let ground = colours.ground { piece.backgroundColor = color(ground) }
      out += piece
    }
    return out
  }
}

/// The field behind the terminal, depicted: the sheet's paper and a few bodies as circles, so a ground that is not
/// solid has something to show through it.
private struct FieldDepiction: View {
  /// Each body: its centre as a share of the picture, and its diameter in points.
  private static let bodies: [(x: CGFloat, y: CGFloat, diameter: CGFloat)] = [
    (0.16, 0.30, 58), (0.44, 0.72, 86), (0.70, 0.26, 44), (0.88, 0.66, 70), (0.30, 0.94, 36),
  ]

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .topLeading) {
        ChromePalette.paper
        ForEach(Array(Self.bodies.enumerated()), id: \.offset) { _, spot in
          Circle()
            .fill(ChromePalette.inkT4)
            .frame(width: spot.diameter, height: spot.diameter)
            .position(x: geometry.size.width * spot.x, y: geometry.size.height * spot.y)
        }
      }
    }
  }
}
