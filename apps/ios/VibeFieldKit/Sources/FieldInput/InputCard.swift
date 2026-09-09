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
  /// The composer's measured height. One line at rest; the card grows UPWARD
  /// as the draft does, which is why the row is bottom-aligned.
  @State private var composerHeight: CGFloat = InputCard.rowHeight
  @Environment(\.colorScheme) private var colorScheme

  public init(model: InputCardModel) {
    self.model = model
  }

  /// The design's geometry, named once: 8 pt padding, 6 pt gaps, 44 pt rows —
  /// 110 pt of chrome at one line.
  static let rowHeight: CGFloat = 44
  private static let gap: CGFloat = 6
  private static let padding: CGFloat = 8
  private static let cornerRadius: CGFloat = 6

  public var body: some View {
    VStack(spacing: Self.gap) {
      if model.mode == .draft {
        draftRow
      } else {
        terminalStrip
      }
      rail
    }
    .padding(Self.padding)
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
  ///
  /// Every key but the mode toggle carries a long-press fan (IOS-5b): the
  /// chords under CTRL, the far ends under the arrows, ⇧TAB under TAB, and the
  /// Meta burst under ESC.
  private var rail: some View {
    HStack(spacing: Self.gap) {
      key(
        glyph: "terminal",
        label: model.mode == .live ? "Typing into terminal" : "Type into terminal",
        inverted: model.mode == .live, action: { model.toggleMode() })
      escapeKey
      controlKey
      key(text: "TAB", label: "Tab", fan: .tab, action: { model.tapKey(.tab) })
      key(
        glyph: "arrow.left", label: "Left arrow", fan: KeyFan.arrow(.arrowLeft),
        action: { model.tapKey(.arrowLeft) })
      key(
        glyph: "arrow.down", label: "Down arrow", fan: KeyFan.arrow(.arrowDown),
        action: { model.tapKey(.arrowDown) })
      key(
        glyph: "arrow.up", label: "Up arrow", fan: KeyFan.arrow(.arrowUp),
        action: { model.tapKey(.arrowUp) })
      key(
        glyph: "arrow.right", label: "Right arrow", fan: KeyFan.arrow(.arrowRight),
        action: { model.tapKey(.arrowRight) })
    }
  }

  // --- IOS-5b ---------------------------------------------------------------
  /// ESC, and the Meta burst it holds.
  ///
  /// While the burst is armed the key says META and inverts: the next key is
  /// about to mean something different, and the only place that can be said is
  /// the key that armed it. It still sends Escape when tapped — the burst rides
  /// the next keystroke, and Escape is one.
  private var escapeKey: some View {
    key(
      text: model.metaArmed ? "META" : "ESC",
      label: model.metaArmed ? "Escape, Meta armed for the next key" : "Escape",
      inverted: model.metaArmed,
      fan: .escape,
      action: { model.tapKey(.escape) })
  }
  // --- end IOS-5b -----------------------------------------------------------

  /// The sticky Ctrl. Armed and locked both invert; locked adds the dot,
  /// because "this stays until I release it" is a different promise from
  /// "this is spent on the next key" and a single fill cannot say both.
  private var controlKey: some View {
    let armed = model.latch.phase != .off
    return Button {
      // --- IOS-5b ---
      // The fan just opened under the finger; the touch-up that follows is the
      // long press ending, not a tap on CTRL.
      guard model.openFan == nil else { return }
      model.tapControl()
      // Felt, not just seen: armed and locked are two different promises and a
      // fill alone cannot say which at arm's length. The VIEW reads the phase
      // the model just moved to — haptics are presentation, and the model has
      // no UIKit in it on purpose.
      switch model.latch.phase {
      case .armed: InputHaptics.arm()
      case .locked: InputHaptics.lock()
      case .off: InputHaptics.release()
      }
      // --- end IOS-5b ---
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
    // --- IOS-5b: the chord fan ---
    .fan(.control, on: model, pick: pick)
    // --- end IOS-5b ---
  }

  // MARK: - Key chrome

  private func key(
    text: String,
    label: String,
    inverted: Bool = false,
    fan: KeyFan? = nil,
    action: @escaping () -> Void
  ) -> some View {
    Button {
      // IOS-5b: a long press that opened a fan still ends in a touch-up, and
      // that touch-up is not a tap on this key.
      guard model.openFan == nil else { return }
      action()
    } label: {
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
    .fan(fan, on: model, pick: pick)
  }

  /// `width` is the strip's Enter and nothing else: rail keys are equal-width
  /// by division, and a fixed one among them would break the grid.
  private func key(
    glyph: String,
    label: String,
    inverted: Bool = false,
    width: CGFloat? = nil,
    fan: KeyFan? = nil,
    action: @escaping () -> Void
  ) -> some View {
    Button {
      guard model.openFan == nil else { return }
      action()
    } label: {
      Image(systemName: glyph)
        .font(.system(size: 13, weight: .heavy))
        .foregroundStyle(inverted ? FieldPalette.panelBackground : FieldPalette.textMain)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .frame(width: width, height: Self.rowHeight)
        .background(keyShape(inverted: inverted))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(label)
    .fan(fan, on: model, pick: pick)
  }

  // --- IOS-5b ---------------------------------------------------------------
  /// A key was picked out of an open fan.
  ///
  /// The fan closes first so the act cannot land twice, then the chord goes —
  /// `tapChord`, which spends an armed latch without adding to a chord that
  /// already names its own modifiers. META is the one item that arms instead of
  /// sending.
  private func pick(_ item: KeyFan.Item) {
    model.closeFan()
    switch item.act {
    case .stroke(let stroke): model.tapChord(stroke)
    case .meta: model.armMeta()
    }
    InputHaptics.chord()
  }
  // --- end IOS-5b -----------------------------------------------------------

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
