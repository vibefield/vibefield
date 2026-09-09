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
/// open state to rotate from. A popover also keeps the three items in
/// `FieldType.mono` on our own glass, where a `UIMenu` would put the second
/// borrowed system surface on this card after the paste control. It is the
/// same presentation the long-press fans use, for the same reasons and with
/// the same keyboard bookkeeping.
struct PlusMenu: View {
  let model: InputCardModel

  /// The composer row's own height — the `+` is square in it.
  private let side: CGFloat = InputCard.rowHeight

  var body: some View {
    Button {
      // IOS-5b's rule, which every key on this card follows: a long press that
      // opened a fan still ends in a touch-up, and that touch-up is not a tap.
      guard model.openFan == nil else { return }
      model.showPlusMenu()
    } label: {
      Image(systemName: "plus")
        .font(.system(size: 15, weight: .heavy))
        .foregroundStyle(FieldPalette.textMain)
        .rotationEffect(.degrees(model.plusMenuOpen ? 45 : 0))
        .animation(FieldMotion.ease(0.18), value: model.plusMenuOpen)
        .frame(width: side, height: side)
        .background(
          RoundedRectangle(cornerRadius: 6)
            .fill(FieldPalette.panelBackground.opacity(0.8))
            .overlay(
              RoundedRectangle(cornerRadius: 6)
                .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
            )
        )
    }
    .buttonStyle(KeyPressStyle())
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

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      row("SCAN TEXT", glyph: "text.viewfinder", surface: .scanText)
      divider
      row("SNIPPETS", glyph: "text.append", surface: .snippets)
      divider
      row("CLIPBOARD HISTORY", glyph: "list.clipboard", surface: .clipboardHistory)
    }
    .padding(.vertical, 4)
    .frame(width: 226)
    .background(FieldPalette.panelBackground)
  }

  private var divider: some View {
    Rectangle()
      .fill(FieldPalette.panelBorder)
      .frame(height: 1)
      .padding(.leading, 38)
  }

  private func row(_ title: String, glyph: String, surface: CardSurface) -> some View {
    Button {
      model.requestSurface(surface)
    } label: {
      HStack(spacing: 10) {
        Image(systemName: glyph)
          .font(.system(size: 13, weight: .medium))
          .frame(width: 18)
        Text(title)
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.08, of: 9))
        Spacer(minLength: 0)
      }
      .foregroundStyle(FieldPalette.textMain)
      .padding(.horizontal, 12)
      .frame(height: 42)
      .contentShape(Rectangle())
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(title.capitalized)
  }
}
