import FieldDesign
import SwiftUI

/// The `+` key at the left of the composer row, and the menu it opens.
///
/// **Three items, and the absences are the design (K-D6).** The design's menu
/// has two sections — things you ATTACH (Photo Library, Take Photo, Choose
/// File) and text sources (Scan Text, Snippets, Clipboard History). The attach
/// half is not here, and not greyed out either: moving a file from this phone
/// to a desktop needs a mesh verb that does not exist. EL2 says bytes never
/// ride the JSON-RPC control plane — they travel on ticketed direct sockets —
/// and no ticket for a phone-to-host file has ever been minted, on either
/// plane. A disabled "Choose File" would promise a door with nothing behind
/// it, which is exactly what D-i6 forbids. The three items arrive as four when
/// that verb lands, and not one release before.
///
/// **Why a popover and not a system `Menu`.** The design asks for the glyph to
/// rotate to `×` while the menu is open, and SwiftUI's `Menu` publishes no
/// open state to rotate from. A popover also lets the menu be the canvas's own
/// `.menu` — a `#3A3A3E` surface at radius 18 with 44 pt rows — where a
/// `UIMenu` would put the second borrowed system surface on this card after the
/// paste control. It is the same presentation the long-press fans use, for the
/// same reasons and with the same keyboard bookkeeping.
struct PlusMenu: View {
  let model: InputCardModel
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  // --- end IOS-5e -----------------------------------------------------------

  /// The composer row's own `.target`, and the `.circle` centred in it.
  private var side: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }
  private var circleSide: CGFloat { InputCardMetrics.circleDiameter(for: dynamicTypeSize) }

  var body: some View {
    Button {
      // IOS-5b's rule, which every key on this card follows: a long press that
      // opened a fan still ends in a touch-up, and that touch-up is not a tap.
      guard model.openFan == nil else { return }
      model.showPlusMenu()
    } label: {
      FieldGlyph(
        .plus, size: FieldGlyph.box(for: InputCardMetrics.actionGlyphSize(for: dynamicTypeSize)))
        .foregroundStyle(ChromePalette.ink)
        // --- IOS-5e ---------------------------------------------------------
        // The design turns this glyph 45° into a `×` while the menu is open.
        // Under Reduce Motion it does not turn: the rotation is decoration —
        // the popover standing open is what says the menu is open — and a
        // spinning glyph is exactly the movement the setting asks us to stop.
        // It does not switch to a drawn `×` instead, because a different glyph
        // appearing with no motion reads as a different control.
        .rotationEffect(.degrees(!reduceMotion && model.plusMenuOpen ? 45 : 0))
        .animation(reduceMotion ? nil : FieldMotion.ease(0.18), value: model.plusMenuOpen)
        // --- end IOS-5e -----------------------------------------------------
        .frame(width: circleSide, height: circleSide)
        // `.circle`, and `.circle.open` while the menu is up — the fill brightens
        // with the glyph's turn, so the state survives Reduce Motion.
        .background {
          ChromeMaterial.circle(
            fill: model.plusMenuOpen ? ChromePalette.circleOpenFill : ChromePalette.circleFill,
            hairline: ChromePalette.circleHairline)
        }
        .frame(width: side, height: side)
    }
    .buttonStyle(ChromePressStyle())
    .accessibilityLabel("More")
    .popover(
      isPresented: Binding(
        get: { model.plusMenuOpen },
        set: { if !$0 { model.closePlusMenu() } })
    ) {
      PlusMenuList(model: model)
        .presentationCompactAdaptation(.popover)
    }
  }
}

/// The menu's own pixels: three rows in the card's voice.
struct PlusMenuList: View {
  let model: InputCardModel
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  // --- end IOS-5e -----------------------------------------------------------

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      row("Scan text", glyph: .scanText, surface: .scanText)
      divider
      row("Snippets", glyph: .snippets, surface: .snippets)
      divider
      row("Clipboard history", glyph: .clipboard, surface: .clipboardHistory)
    }
    // The popover has finished leaving: a door picked from it can present now.
    .onDisappear { model.menuDidLeave() }
    // `.menu` — `padding: 4` around 44 pt rows.
    .padding(4)
    // The canvas's 252, and wider at accessibility sizes: `Clipboard history`
    // at 20 pt is wider than that, and a menu row that truncates its own verb
    // is a menu you have to guess at. The popover is free to be wider — it is
    // drawn over the terminal, not inside the card.
    .frame(width: dynamicTypeSize.isAccessibilitySize ? 296 : 252)
    .background { ChromeMaterial.floating(radius: ChromeRadius.menu) }
  }

  /// `.mi + .mi` — a hairline between two items, full-bleed like the canvas's.
  private var divider: some View {
    Rectangle()
      .fill(ChromePalette.menuSeparator)
      .frame(height: 0.5)
  }

  /// `.mi` — the word at the left, its glyph at the right, 44 pt tall. The
  /// canvas puts the symbol on the trailing edge, which is where iOS puts a
  /// menu's own; the word is what the eye lands on first either way.
  private func row(_ title: String, glyph: FieldGlyphName, surface: CardSurface) -> some View {
    Button {
      model.requestSurface(surface)
    } label: {
      HStack(spacing: 10) {
        Text(title)
          .font(ChromeType.sans(InputCardMetrics.menuItemSize(for: dynamicTypeSize)))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        Spacer(minLength: 0)
        FieldGlyph(glyph, size: FieldGlyph.box(for: ChromeType.menuGlyphSize))
          .foregroundStyle(ChromePalette.ink.opacity(0.85))
      }
      .padding(.horizontal, 14)
      .frame(height: InputCardMetrics.rowHeight(for: dynamicTypeSize))
      .contentShape(Rectangle())
    }
    .buttonStyle(KeyPressStyle(radius: 14))
    .accessibilityLabel(title)
  }
}
