import FieldDesign
import FieldTerminal
import SwiftUI

/// The input card: a composer row over a rail of terminal keys, sitting on the
/// session sheet's glass above the keyboard.
///
/// The design this re-skins (KeyboardLab's "Composer + Rail") is drawn in SF
/// on white glass; the field speaks godview mono (D-i2), so every label here
/// is `FieldType.mono`, every color comes from `FieldPalette`, and a key that
/// is ON inverts rather than colors — attention is contrast in this app, never
/// hue. The card carries no background of its own: the sheet's liquid glass is
/// the surface, and each key is a chip on it.
///
/// The copy rule from the design's decision table holds throughout: the word
/// "Live" never reaches the screen. The mode is a terminal glyph, and the strip
/// says what is happening rather than what it is called.
public struct InputCard: View {
  private let model: InputCardModel
  // --- IOS-5c: the pasteboard's own state, so the paste chip can appear
  // exactly when there is something new to offer. Optional because a card
  // without a host has no watcher, and the demo fixture is one of those.
  private let pasteboard: PasteboardWatcher?
  // --- end IOS-5c
  /// The composer's measured height. One line at rest; the card grows UPWARD
  /// as the draft does, which is why the row is bottom-aligned.
  @State private var composerHeight: CGFloat = InputCard.rowHeight
  @Environment(\.colorScheme) private var colorScheme

  public init(model: InputCardModel, pasteboard: PasteboardWatcher? = nil) {
    self.model = model
    self.pasteboard = pasteboard
  }

  /// The design's geometry, named once: 8 pt padding, 6 pt gaps, 44 pt rows —
  /// 110 pt of chrome at one line.
  static let rowHeight: CGFloat = 44
  private static let gap: CGFloat = 6
  private static let padding: CGFloat = 8
  private static let cornerRadius: CGFloat = 6

  public var body: some View {
    // --- IOS-5c: three faces, not one. With the keyboard down the card is a
    // single row (the design's `MainClosed`); with it up, the contextual chips
    // row rides above row 1 whenever it has something to say.
    Group {
      if model.keyboardOwner == .none {
        ClosedRow(model: model, pasteboard: pasteboard)
      } else {
        VStack(spacing: Self.gap) {
          if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
            ChipsRow(model: model, pasteboard: pasteboard)
              .transition(.opacity)
          }
          if model.mode == .draft {
            draftRow
          } else {
            terminalStrip
          }
          rail
        }
      }
    }
    .padding(Self.padding)
    .animation(FieldMotion.ease(0.24), value: model.chips)
    .animation(FieldMotion.ease(0.24), value: pasteboard?.hasNewContent ?? false)
    .animation(FieldMotion.ease(0.24), value: model.keyboardOwner)
    // --- end IOS-5c
  }

  // MARK: - Row 1

  /// Draft: the field and Send.
  ///
  /// The design's `+` and mic controls are deliberately ABSENT rather than
  /// present-and-dead (D-i6): `+` is IOS-5d, and the mic needs the Speech
  /// framework and its usage strings, which is a slice of its own. A disabled
  /// button would promise a door that is not built.
  private var draftRow: some View {
    HStack(alignment: .bottom, spacing: Self.gap) {
      ComposerField(
        model: model,
        height: $composerHeight,
        keyboardAppearance: colorScheme == .dark ? .dark : .light
      )
      .frame(height: max(Self.rowHeight, composerHeight))
      .background(keyShape(inverted: false))
      .accessibilityLabel("Message or command")

      sendKey
    }
  }

  /// Live: the strip and Enter. The draft is not gone — it is held in the
  /// model and comes back untouched when the mode flips.
  private var terminalStrip: some View {
    HStack(spacing: Self.gap) {
      HStack(spacing: 7) {
        Image(systemName: "terminal")
          .font(.system(size: 13, weight: .heavy))
        Text("Typing into terminal")
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.08, of: 9))
      }
      .foregroundStyle(FieldPalette.textMain)
      .padding(.horizontal, 11)
      .frame(maxWidth: .infinity, alignment: .leading)
      .frame(height: Self.rowHeight)
      .background(keyShape(inverted: false))
      .accessibilityElement()
      .accessibilityLabel("Typing into terminal")

      key(
        glyph: "return", label: "Enter", width: Self.rowHeight,
        action: { model.tapKey(.enter) })
    }
  }

  /// Send is never disabled. Quiet with an empty draft, inverted with text —
  /// and an empty draft still sends, as Enter, because "run it" is a real act
  /// with nothing left to type.
  private var sendKey: some View {
    Button {
      model.tapSend()
    } label: {
      Image(systemName: "arrow.up")
        .font(.system(size: 15, weight: .heavy))
        .foregroundStyle(
          model.draft.isEmpty ? FieldPalette.textMuted : FieldPalette.panelBackground
        )
        .frame(width: Self.rowHeight, height: Self.rowHeight)
        .background(keyShape(inverted: !model.draft.isEmpty))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel("Send")
  }

  // MARK: - Row 2, the rail

  /// Eight equal keys. The design's ninth, `⋯` (the terminal keypad), is
  /// IOS-5d and is absent here rather than present and inert.
  private var rail: some View {
    HStack(spacing: Self.gap) {
      key(
        glyph: "terminal",
        label: model.mode == .live ? "Typing into terminal" : "Type into terminal",
        inverted: model.mode == .live, action: { model.toggleMode() })
      key(text: "ESC", label: "Escape", action: { model.tapKey(.escape) })
      controlKey
      key(text: "TAB", label: "Tab", action: { model.tapKey(.tab) })
      key(glyph: "arrow.left", label: "Left arrow", action: { model.tapKey(.arrowLeft) })
      key(glyph: "arrow.down", label: "Down arrow", action: { model.tapKey(.arrowDown) })
      key(glyph: "arrow.up", label: "Up arrow", action: { model.tapKey(.arrowUp) })
      key(glyph: "arrow.right", label: "Right arrow", action: { model.tapKey(.arrowRight) })
    }
    // --- IOS-5c: swipe the rail down to put the keyboard away.
    //
    // There is no scroll view on this sheet to hang
    // `.scrollDismissesKeyboard(.interactively)` on — the session card is a
    // VStack over a Metal surface — and the terminal below cannot take the
    // gesture either, because a drag there is a selection. So the rail itself
    // is the handle: it is the one strip of chrome that exists in both modes
    // and holds no scrollable content of its own. Simultaneous rather than
    // exclusive so the keys keep their taps; 20 pt before it engages, so a
    // finger sliding off a key is still a key.
    .simultaneousGesture(
      DragGesture(minimumDistance: 20)
        .onEnded { value in
          guard value.translation.height > 24, abs(value.translation.width) < 44 else { return }
          model.dismissKeyboard()
        }
    )
    // --- end IOS-5c
  }

  /// The sticky Ctrl. Armed and locked both invert; locked adds the dot,
  /// because "this stays until I release it" is a different promise from
  /// "this is spent on the next key" and a single fill cannot say both.
  private var controlKey: some View {
    let armed = model.latch.phase != .off
    return Button {
      model.tapControl()
    } label: {
      Text("CTRL")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.08, of: 9))
        .foregroundStyle(armed ? FieldPalette.panelBackground : FieldPalette.textMain)
        .frame(maxWidth: .infinity)
        .frame(height: Self.rowHeight)
        .background(keyShape(inverted: armed))
        .overlay(alignment: .topTrailing) {
          if model.latch.phase == .locked {
            Circle()
              .fill(FieldPalette.panelBackground)
              .frame(width: 4, height: 4)
              .padding(4)
          }
        }
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(model.latch.accessibilityLabel)
  }

  // MARK: - Key chrome

  private func key(
    text: String,
    label: String,
    inverted: Bool = false,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Text(text)
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.08, of: 9))
        .foregroundStyle(inverted ? FieldPalette.panelBackground : FieldPalette.textMain)
        .frame(maxWidth: .infinity)
        .frame(height: Self.rowHeight)
        .background(keyShape(inverted: inverted))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(label)
  }

  /// `width` is the strip's Enter and nothing else: rail keys are equal-width
  /// by division, and a fixed one among them would break the grid.
  private func key(
    glyph: String,
    label: String,
    inverted: Bool = false,
    width: CGFloat? = nil,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Image(systemName: glyph)
        .font(.system(size: 13, weight: .heavy))
        .foregroundStyle(inverted ? FieldPalette.panelBackground : FieldPalette.textMain)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .frame(width: width, height: Self.rowHeight)
        .background(keyShape(inverted: inverted))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(label)
  }

  /// One shape for every key on the card: the `FieldChip` recipe at 44 pt.
  @ViewBuilder
  private func keyShape(inverted: Bool) -> some View {
    if inverted {
      RoundedRectangle(cornerRadius: Self.cornerRadius)
        .fill(FieldPalette.textMain)
    } else {
      RoundedRectangle(cornerRadius: Self.cornerRadius)
        .fill(FieldPalette.panelBackground.opacity(0.8))
        .overlay(
          RoundedRectangle(cornerRadius: Self.cornerRadius)
            .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
        )
    }
  }
}

/// Press feedback without SwiftUI's default button highlight, which tints and
/// would put a hue on a monochrome key.
struct KeyPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(configuration.isPressed ? 0.55 : 1)
      .animation(FieldMotion.ease(0.08), value: configuration.isPressed)
  }
}
