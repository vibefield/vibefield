import FieldDesign
import FieldTerminal
import SwiftUI

/// The `⋯` keypad: our keys where the letters were.
///
/// The design's rule (§4, "What `⋯` does") is that tapping `⋯` REPLACES the
/// system keyboard rather than stacking anything on it, so the card never
/// moves — which is why this is an `inputView` in both modes rather than a
/// sheet or a panel. Three pages, because the three have different natures:
/// Keys and Combos are always key EVENTS, and Symbols is text in Draft and
/// input in Live. `abc` gives the letters back.
///
/// It carries the card's voice, not the keyboard's: mono labels, chip-shaped
/// keys, inversion for anything that is ON. The ground stays clear so the
/// input view's own material reads through, the way a system keyboard's keys
/// sit on its blur.
struct TerminalKeypad: View {
  let model: InputCardModel

  /// The whole keypad's height, close enough to a system keyboard that the
  /// card does not jump when the two swap.
  static let height: CGFloat = 260

  private static let gap: CGFloat = 5
  private static let padding: CGFloat = 6
  static let keyHeight: CGFloat = 38

  var body: some View {
    VStack(spacing: Self.gap) {
      header
      page
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .padding(Self.padding)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  // MARK: - The page picker

  /// `KEYS · SYMBOLS · COMBOS` and the way out.
  ///
  /// The selected page inverts rather than tinting — the same rule every key
  /// on this card follows, because attention in this app is contrast and never
  /// hue. `abc` sits at the right, where a keyboard's own return key lives.
  private var header: some View {
    HStack(spacing: Self.gap) {
      ForEach(KeypadPage.allCases, id: \.rawValue) { candidate in
        Button {
          model.keypadPage = candidate
        } label: {
          Text(candidate.title)
            .font(FieldType.mono(9, .heavy))
            .tracking(FieldType.tracking(0.08, of: 9))
            .foregroundStyle(
              model.keypadPage == candidate
                ? FieldPalette.panelBackground : FieldPalette.textMain
            )
            .frame(maxWidth: .infinity)
            .frame(height: 28)
            .background(keyShape(inverted: model.keypadPage == candidate))
        }
        .buttonStyle(KeyPressStyle())
        .accessibilityLabel("\(candidate.title) page")
        .accessibilityAddTraits(model.keypadPage == candidate ? [.isSelected] : [])
      }

      Button {
        model.setKeypad(false)
      } label: {
        Text("abc")
          .font(FieldType.mono(11, .heavy))
          .foregroundStyle(FieldPalette.textMain)
          .frame(width: 52, height: 28)
          .background(keyShape(inverted: false))
      }
      .buttonStyle(KeyPressStyle())
      .accessibilityLabel("Letters")
    }
  }

  @ViewBuilder
  private var page: some View {
    switch model.keypadPage {
    case .keys: keysPage
    case .symbols: symbolsPage
    case .combos: combosPage
    }
  }

  // MARK: - Keys

  /// The named keys, the far ends, the arrows, the function row, and the two
  /// latches.
  ///
  /// Every one of these is a key EVENT in both modes, including in Draft: the
  /// rail already works that way and the design says so outright, so Backspace
  /// here deletes in the terminal rather than in the draft. The draft has the
  /// system keyboard's own backspace for that, one `abc` away.
  private var keysPage: some View {
    VStack(spacing: Self.gap) {
      HStack(spacing: Self.gap) {
        keyLabel("ESC", spoken: "Escape") { model.tapKey(.escape) }
        keyLabel("TAB", spoken: "Tab") { model.tapKey(.tab) }
        keyGlyph("return", spoken: "Enter") { model.tapKey(.enter) }
        keyGlyph("delete.left", spoken: "Backspace") { model.tapKey(.backspace) }
      }
      HStack(spacing: Self.gap) {
        keyLabel("HOME", spoken: "Home") { model.tapKey(.home) }
        keyLabel("END", spoken: "End") { model.tapKey(.end) }
        keyLabel("PGUP", spoken: "Page up") { model.tapKey(.pageUp) }
        keyLabel("PGDN", spoken: "Page down") { model.tapKey(.pageDown) }
      }
      HStack(spacing: Self.gap) {
        keyGlyph("arrow.left", spoken: "Left arrow") { model.tapKey(.arrowLeft) }
        keyGlyph("arrow.down", spoken: "Down arrow") { model.tapKey(.arrowDown) }
        keyGlyph("arrow.up", spoken: "Up arrow") { model.tapKey(.arrowUp) }
        keyGlyph("arrow.right", spoken: "Right arrow") { model.tapKey(.arrowRight) }
      }
      functionRow
      latchRow
    }
  }

  /// F1…F12 scroll, because twelve keys at a tappable width do not fit a phone
  /// and twelve keys at a fitting width are not tappable.
  private var functionRow: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: Self.gap) {
        ForEach(1...12, id: \.self) { number in
          Button {
            model.tapKey(.function(number))
          } label: {
            Text("F\(number)")
              .font(FieldType.mono(9, .heavy))
              .tracking(FieldType.tracking(0.08, of: 9))
              .foregroundStyle(FieldPalette.textMain)
              .frame(width: 44, height: Self.keyHeight)
              .background(keyShape(inverted: false))
          }
          .buttonStyle(KeyPressStyle())
          .accessibilityLabel("F\(number)")
        }
      }
    }
    .frame(height: Self.keyHeight)
    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
  }

  /// The two sticky modifiers, side by side.
  ///
  /// CTRL is the card's own latch — the same one the rail holds, so arming it
  /// here and typing on the system keyboard after `abc` still gives a control
  /// byte. ALT is the design's "explicit Alt latch lives on the keypad's Keys
  /// page" (decision 4) and it is drawn AS a latch, but under it is IOS-5b's
  /// Meta burst: one key, then gone. That is honest rather than convenient —
  /// `.option` on the phone is a burst the kit encodes, and a second sticky
  /// modifier with a second dot would be two promises this card cannot keep
  /// apart at a glance.
  private var latchRow: some View {
    HStack(spacing: Self.gap) {
      Button {
        model.tapControl()
        switch model.latch.phase {
        case .armed: InputHaptics.arm()
        case .locked: InputHaptics.lock()
        case .off: InputHaptics.release()
        }
      } label: {
        Text("CTRL")
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.08, of: 9))
          .foregroundStyle(
            model.latch.phase == .off ? FieldPalette.textMain : FieldPalette.panelBackground
          )
          .frame(maxWidth: .infinity)
          .frame(height: Self.keyHeight)
          .background(keyShape(inverted: model.latch.phase != .off))
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

      Button {
        model.armMeta()
        InputHaptics.arm()
      } label: {
        Text("ALT")
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.08, of: 9))
          .foregroundStyle(
            model.metaArmed ? FieldPalette.panelBackground : FieldPalette.textMain
          )
          .frame(maxWidth: .infinity)
          .frame(height: Self.keyHeight)
          .background(keyShape(inverted: model.metaArmed))
      }
      .buttonStyle(KeyPressStyle())
      .accessibilityLabel(model.metaArmed ? "Alt armed for the next key" : "Alt")
    }
  }

  // MARK: - Symbols

  /// The shell's punctuation, three rows of ten.
  ///
  /// The brief's set verbatim; the LAYOUT is ours. Two rows of fifteen put a
  /// 21 pt key on a phone, which is narrower than anything a thumb hits on
  /// purpose — three rows of ten give the 33 pt the design itself cites as
  /// "the width of an iOS letter key".
  private static let symbolRows: [[Character]] = [
    ["|", "~", "`", "^", "&", "*", "\\", "/", "-", "_"],
    ["=", "+", "[", "]", "{", "}", "<", ">", ";", ":"],
    ["'", "\"", ",", ".", "?", "!", "@", "#", "$", "%"],
  ]

  private var symbolsPage: some View {
    VStack(spacing: Self.gap) {
      ForEach(Array(Self.symbolRows.enumerated()), id: \.offset) { _, row in
        HStack(spacing: Self.gap) {
          ForEach(row, id: \.self) { character in
            Button {
              model.typeSymbol(character)
            } label: {
              Text(String(character))
                .font(FieldType.mono(15, .medium))
                .foregroundStyle(FieldPalette.textMain)
                .frame(maxWidth: .infinity)
                .frame(height: Self.keyHeight)
                .background(keyShape(inverted: false))
            }
            .buttonStyle(KeyPressStyle())
            .accessibilityLabel(Self.spoken(character))
          }
        }
      }
      // The one line of prose on the keypad, and it earns its place: which of
      // two things this page does depends on the mode, and the mode is a glyph
      // on the rail behind the keypad.
      Text(
        model.mode == .draft
          ? "symbols go into the draft" : "symbols go straight to the terminal"
      )
      .font(FieldType.mono(8))
      .foregroundStyle(FieldPalette.textFaint)
      .padding(.top, 2)
    }
  }

  /// What VoiceOver says instead of reading the glyph, which it renders as
  /// anything from silence to the wrong word depending on the voice.
  private static func spoken(_ character: Character) -> String {
    let names: [Character: String] = [
      "|": "pipe", "~": "tilde", "`": "backtick", "^": "caret", "&": "ampersand",
      "*": "asterisk", "\\": "backslash", "/": "slash", "-": "hyphen", "_": "underscore",
      "=": "equals", "+": "plus", "[": "left bracket", "]": "right bracket",
      "{": "left brace", "}": "right brace", "<": "less than", ">": "greater than",
      ";": "semicolon", ":": "colon", "'": "apostrophe", "\"": "quote", ",": "comma",
      ".": "period", "?": "question mark", "!": "exclamation mark", "@": "at sign",
      "#": "number sign", "$": "dollar sign", "%": "percent",
    ]
    return names[character] ?? String(character)
  }

  // MARK: - Combos

  /// The packs, each a heading over its keys.
  ///
  /// It scrolls: four packs of multi-key sequences do not fit 200 pt, and the
  /// alternative — paging inside a page — is the carousel this whole design
  /// replaced.
  private var combosPage: some View {
    ScrollView(.vertical, showsIndicators: false) {
      VStack(alignment: .leading, spacing: 10) {
        ForEach(ComboCatalog.packs) { pack in
          VStack(alignment: .leading, spacing: Self.gap) {
            Text(pack.title)
              .font(FieldType.mono(8, .heavy))
              .tracking(FieldType.tracking(0.18, of: 8))
              .foregroundStyle(FieldPalette.textMuted)
            comboGrid(pack.combos)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.bottom, 4)
    }
  }

  /// Four to a row: a combo's face is `^B c` plus a word, which is twice the
  /// width of a rail key and half the width of the screen.
  private func comboGrid(_ combos: [Combo]) -> some View {
    let rows = stride(from: 0, to: combos.count, by: 4).map {
      Array(combos[$0..<min($0 + 4, combos.count)])
    }
    return VStack(spacing: Self.gap) {
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        HStack(spacing: Self.gap) {
          ForEach(row) { combo in
            Button {
              model.sendCombo(combo)
              InputHaptics.chord()
            } label: {
              VStack(spacing: 1) {
                Text(combo.label)
                  .font(FieldType.mono(9, .heavy))
                  .tracking(FieldType.tracking(0.08, of: 9))
                  .foregroundStyle(FieldPalette.textMain)
                Text(combo.subtitle)
                  .font(FieldType.mono(7))
                  .foregroundStyle(FieldPalette.textMuted)
                  .lineLimit(1)
                  .minimumScaleFactor(0.8)
              }
              .padding(.horizontal, 4)
              .frame(maxWidth: .infinity)
              .frame(height: Self.keyHeight)
              .background(keyShape(inverted: false))
            }
            .buttonStyle(KeyPressStyle())
            .accessibilityLabel(combo.accessibilityLabel)
          }
          // A short last row keeps the grid rather than stretching its keys.
          if row.count < 4 {
            ForEach(0..<(4 - row.count), id: \.self) { _ in
              Color.clear.frame(maxWidth: .infinity).frame(height: Self.keyHeight)
            }
          }
        }
      }
    }
  }

  // MARK: - Chrome

  private func keyLabel(
    _ text: String, spoken: String, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Text(text)
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.08, of: 9))
        .foregroundStyle(FieldPalette.textMain)
        .frame(maxWidth: .infinity)
        .frame(height: Self.keyHeight)
        .background(keyShape(inverted: false))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(spoken)
  }

  private func keyGlyph(
    _ glyph: String, spoken: String, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Image(systemName: glyph)
        .font(.system(size: 13, weight: .heavy))
        .foregroundStyle(FieldPalette.textMain)
        .frame(maxWidth: .infinity)
        .frame(height: Self.keyHeight)
        .background(keyShape(inverted: false))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(spoken)
  }

  /// The card's own key recipe, one size down. Kept here rather than reached
  /// for across files because `InputCard`'s is private on purpose: the shape
  /// is the design's, and two copies of six lines is cheaper than a shared
  /// abstraction over a rounded rectangle.
  @ViewBuilder
  private func keyShape(inverted: Bool) -> some View {
    if inverted {
      RoundedRectangle(cornerRadius: 6).fill(FieldPalette.textMain)
    } else {
      RoundedRectangle(cornerRadius: 6)
        .fill(FieldPalette.panelBackground.opacity(0.8))
        .overlay(
          RoundedRectangle(cornerRadius: 6)
            .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
        )
    }
  }
}
