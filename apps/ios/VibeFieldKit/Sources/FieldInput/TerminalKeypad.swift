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
/// **IOS-5v — it reads as a keyboard, because it is one.** The canvas gives the
/// keypad the system keyboard's own ground (`#1F1F21` dark, `#D1D3D9` light)
/// rather than the card's glass, and its keys the two fills a system keyboard
/// uses: a bright cap for the letters-and-arrows half, a darker one for the
/// named keys. That is the whole argument for the choice — what replaces the
/// keyboard should sit where the keyboard sat.
struct TerminalKeypad: View {
  let model: InputCardModel
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  // --- end IOS-5e -----------------------------------------------------------

  /// The whole keypad's height at the base text step, close enough to a system
  /// keyboard that the card does not jump when the two swap — the canvas's own
  /// keyboard is 291 pt on a 402 pt phone. The accessibility step is
  /// `InputCardMetrics.keypadHeight`, which the input view carrying this asks
  /// for in UIKit terms.
  static let height: CGFloat = 284

  /// `.kb.keypad` — `gap: 6`, `padding: 8 6 0`.
  private static let gap: CGFloat = 6
  private static let padding: CGFloat = 6
  private static let topPadding: CGFloat = 8

  private var keyHeight: CGFloat { InputCardMetrics.keypadKeyHeight(for: dynamicTypeSize) }
  /// `.kb.keypad .key.special` — 13, the same step as a rail key's label.
  private var labelSize: CGFloat { InputCardMetrics.labelSize(for: dynamicTypeSize) }
  private var glyphSize: CGFloat { InputCardMetrics.glyphSize(for: dynamicTypeSize) }
  /// `.kb.keypad .key` — 15. A symbol's face IS the character, so it is set
  /// larger than a named key's word: `|` at 13 pt is a hairline nobody can aim
  /// at.
  private var symbolSize: CGFloat { InputCardMetrics.keypadKeySize(for: dynamicTypeSize) }
  /// The two pieces of prose on the keypad: a pack's heading, which is an
  /// eyebrow (§3), and the line that says where a symbol goes.
  private var noteSize: CGFloat { ChromeType.eyebrowSize }

  var body: some View {
    VStack(spacing: Self.gap) {
      header
      page
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // --- IOS-5e ---------------------------------------------------------
        // The page change is a CROSS-FADE and has never been a slide: a page
        // that flew in from the side would put the carousel this whole design
        // replaced back on the keyboard, one layer down. Under Reduce Motion it
        // is a cut, which is the one transition with no movement in it at all.
        .id(model.keypadPage)
        .transition(.opacity)
        .animation(reduceMotion ? nil : FieldMotion.ease(0.14), value: model.keypadPage)
      // --- end IOS-5e ---------------------------------------------------------
    }
    .padding(.horizontal, Self.padding)
    .padding(.top, Self.topPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // `.kb.keypad` — the system keyboard's own ground, so the swap reads as a
    // keyboard changing its keys rather than as a panel arriving.
    .background(ChromePalette.keypadGround)
  }

  // MARK: - The page picker

  /// `Keys · Symbols · Combos` in a segmented track, and the way out.
  ///
  /// The canvas draws the page picker as one `.seg` rather than three keys: the
  /// pages are a choice among three, which is exactly what a segmented control
  /// says and what three separate caps do not. `abc` sits at the right, where a
  /// keyboard's own return key lives.
  private var header: some View {
    HStack(spacing: Self.gap) {
      segmentedTrack
      Button {
        model.setKeypad(false)
        // IOS-5e: the letters are coming back, which is a change to what the
        // whole bottom of the screen is.
        InputAnnouncement.post(InputAnnouncement.keypad(false))
      } label: {
        Text("abc")
          .font(ChromeType.sans(labelSize + 1, .semibold, rounded: true))
          .foregroundStyle(ChromePalette.keypadKeyInk)
          .frame(width: dynamicTypeSize.isAccessibilitySize ? 72 : 64, height: headerHeight)
          .background {
            ChromeMaterial.key(
              radius: ChromeRadius.keypadKey, fill: ChromePalette.keypadSpecialFill,
              hairline: ChromePalette.keypadKeyHairline)
          }
      }
      .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
      .accessibilityLabel("Letters")
    }
  }

  /// `.seg` — a 32 pt track at radius 10 with 3 pt of padding, its thumb at 8.
  private var segmentedTrack: some View {
    HStack(spacing: 4) {
      ForEach(KeypadPage.allCases, id: \.rawValue) { candidate in
        Button {
          // IOS-5e: `.selectionChanged` and only on an actual change — the
          // system's texture for moving through a set of choices, and a
          // selection haptic for re-picking the page you are on would be a
          // buzz that reports nothing.
          guard model.keypadPage != candidate else { return }
          model.keypadPage = candidate
          InputHaptics.page()
        } label: {
          Text(candidate.title)
            .font(ChromeType.sans(ChromeType.segmentSize, .semibold))
            .foregroundStyle(
              model.keypadPage == candidate
                ? ChromePalette.segSelectedInk : ChromePalette.segInk
            )
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .frame(height: headerHeight - 6)
            .background {
              if model.keypadPage == candidate {
                RoundedRectangle(cornerRadius: ChromeRadius.segmentThumb, style: .continuous)
                  .fill(ChromePalette.segSelected)
              }
            }
        }
        .buttonStyle(KeyPressStyle(radius: ChromeRadius.segmentThumb))
        .accessibilityLabel("\(candidate.title) page")
        .accessibilityAddTraits(model.keypadPage == candidate ? [.isSelected] : [])
      }
    }
    .padding(3)
    .frame(height: headerHeight)
    .background {
      RoundedRectangle(cornerRadius: ChromeRadius.segment, style: .continuous)
        .fill(ChromePalette.segTrack)
    }
  }

  private var headerHeight: CGFloat {
    InputCardMetrics.keypadHeaderHeight(accessibility: dynamicTypeSize.isAccessibilitySize)
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
        keyLabel("Esc", spoken: "Escape") { model.tapKey(.escape) }
        keyLabel("Tab", spoken: "Tab") { model.tapKey(.tab) }
        keyGlyph(.return, spoken: "Enter") { model.tapKey(.enter) }
        keyGlyph(.backspace, spoken: "Backspace") { model.tapKey(.backspace) }
      }
      HStack(spacing: Self.gap) {
        keyLabel("Home", spoken: "Home") { model.tapKey(.home) }
        keyLabel("End", spoken: "End") { model.tapKey(.end) }
        keyLabel("PgUp", spoken: "Page up") { model.tapKey(.pageUp) }
        keyLabel("PgDn", spoken: "Page down") { model.tapKey(.pageDown) }
      }
      HStack(spacing: Self.gap) {
        keyGlyph(.arrow, turn: -90, spoken: "Left arrow", special: false) { model.tapKey(.arrowLeft) }
        keyGlyph(.arrow, turn: 180, spoken: "Down arrow", special: false) { model.tapKey(.arrowDown) }
        keyGlyph(.arrow, spoken: "Up arrow", special: false) { model.tapKey(.arrowUp) }
        keyGlyph(.arrow, turn: 90, spoken: "Right arrow", special: false) { model.tapKey(.arrowRight) }
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
              .font(ChromeType.sans(labelSize, .semibold, rounded: true))
              .foregroundStyle(ChromePalette.keypadKeyInk)
              .frame(width: 46, height: keyHeight)
              .background { keyFace(.special) }
          }
          .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
          .accessibilityLabel("F\(number)")
        }
      }
    }
    .frame(height: keyHeight)
    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
  }

  /// The two sticky modifiers, side by side.
  ///
  /// Ctrl is the card's own latch — the same one the rail holds, so arming it
  /// here and typing on the system keyboard after `abc` still gives a control
  /// byte. Alt is the design's "explicit Alt latch lives on the keypad's Keys
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
        // IOS-5e: the same sentence the rail's CTRL says, because it is the
        // same latch. Two keys for one state would be two announcements only
        // if the state were two things, and it is one.
        InputAnnouncement.post(InputAnnouncement.latch(model.latch.phase))
      } label: {
        Text("Ctrl")
          .font(ChromeType.sans(labelSize, .semibold, rounded: true))
          .foregroundStyle(
            model.latch.phase == .off
              ? ChromePalette.keypadKeyInk : ChromePalette.keypadArmedInk
          )
          .frame(maxWidth: .infinity)
          .frame(height: keyHeight)
          .background { keyFace(model.latch.phase == .off ? .special : .armed) }
          .overlay(alignment: .topTrailing) {
            if model.latch.phase == .locked {
              Circle()
                .fill(ChromePalette.keypadArmedInk)
                .frame(width: 5, height: 5)
                .padding(5)
            }
          }
      }
      .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
      .accessibilityLabel(model.latch.accessibilityLabel)
      .accessibilityHint(model.latch.accessibilityHint)

      Button {
        model.armMeta()
        InputHaptics.arm()
        // IOS-5e: "Meta armed for the next key" — the key is drawn ALT and the
        // burst is what it actually arms, so the sentence names the burst.
        InputAnnouncement.post(InputAnnouncement.metaArmed)
      } label: {
        Text("Alt")
          .font(ChromeType.sans(labelSize, .semibold, rounded: true))
          .foregroundStyle(
            model.metaArmed ? ChromePalette.keypadArmedInk : ChromePalette.keypadKeyInk
          )
          .frame(maxWidth: .infinity)
          .frame(height: keyHeight)
          .background { keyFace(model.metaArmed ? .armed : .special) }
      }
      .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
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
                .font(ChromeType.sans(symbolSize, .regular))
                .foregroundStyle(ChromePalette.keypadKeyInk)
                .frame(maxWidth: .infinity)
                .frame(height: keyHeight)
                .background { keyFace(.plain) }
            }
            .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
            .accessibilityLabel(Self.spoken(character))
          }
        }
      }
      // The one line of prose on the keypad, and it earns its place: which of
      // two things this page does depends on the mode, and the mode is a glyph
      // on the rail behind the keypad.
      Text(
        model.mode == .draft
          ? "Symbols go into the draft" : "Symbols go straight to the terminal"
      )
      .font(ChromeType.sans(noteSize, .medium))
      .foregroundStyle(ChromePalette.inkTertiary)
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
            // §3's eyebrow: 11 medium uppercase, tracking 0.06 em, 60%. A
            // pack's name is a section label, which is the one place in this
            // app that is not sentence case.
            Text(pack.title)
              .font(ChromeType.sans(noteSize, .medium))
              .textCase(.uppercase)
              .tracking(ChromeType.tracking(ChromeType.eyebrowTracking, of: noteSize))
              .foregroundStyle(ChromePalette.segInk)
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
              // `.ck` — mono 14 semibold over a 10 medium subtitle at 55%. The
              // sequence is data; the gloss under it is prose.
              VStack(spacing: 3) {
                Text(combo.label)
                  .font(ChromeType.mono(labelSize + 1, .semibold))
                  .foregroundStyle(ChromePalette.keypadKeyInk)
                Text(combo.subtitle)
                  .font(
                    ChromeType.sans(
                      InputCardMetrics.comboSubtitleSize(for: dynamicTypeSize), .medium)
                  )
                  .foregroundStyle(ChromePalette.inkTertiary)
                  .lineLimit(1)
                  .minimumScaleFactor(0.8)
              }
              .padding(.horizontal, 4)
              .frame(maxWidth: .infinity)
              .frame(height: keyHeight)
              .background { keyFace(.special) }
            }
            .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
            .accessibilityLabel(combo.accessibilityLabel)
          }
          // A short last row keeps the grid rather than stretching its keys.
          if row.count < 4 {
            ForEach(0..<(4 - row.count), id: \.self) { _ in
              Color.clear.frame(maxWidth: .infinity).frame(height: keyHeight)
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
        .font(ChromeType.sans(labelSize, .semibold, rounded: true))
        .foregroundStyle(ChromePalette.keypadKeyInk)
        .lineLimit(1)
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
        .background { keyFace(.special) }
    }
    .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
    .accessibilityLabel(spoken)
  }

  private func keyGlyph(
    _ glyph: FieldGlyphName, turn: Double = 0, spoken: String, special: Bool = true,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      FieldGlyph(glyph, size: FieldGlyph.box(for: glyphSize), turn: turn)
        .foregroundStyle(ChromePalette.keypadKeyInk)
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
        .background { keyFace(special ? .special : .plain) }
    }
    .buttonStyle(KeyPressStyle(radius: ChromeRadius.keypadKey))
    .accessibilityLabel(spoken)
  }

  /// A keypad key's three faces (`.kb.keypad .key`, `.special`, `.armed`) — the
  /// two fills a system keyboard uses plus the latched one. Radius 7, which is
  /// the canvas's and a shade tighter than the rail's 9.
  private func keyFace(_ face: KeypadKeyFace) -> some View {
    ChromeMaterial.key(
      radius: ChromeRadius.keypadKey, fill: face.fill,
      hairline: ChromePalette.keypadKeyHairline)
  }
}

/// `.kb.keypad .key` and its two variants.
enum KeypadKeyFace {
  /// The bright half of a system keyboard: arrows and symbols.
  case plain
  /// The darker half: the named keys, the function row, the combos.
  case special
  /// A latch that is on.
  case armed

  var fill: Color {
    switch self {
    case .plain: return ChromePalette.keypadKeyFill
    case .special: return ChromePalette.keypadSpecialFill
    case .armed: return ChromePalette.keypadArmedFill
    }
  }
}
