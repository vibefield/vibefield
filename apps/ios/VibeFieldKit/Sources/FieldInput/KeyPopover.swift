import FieldDesign
import FieldTerminal
import SwiftUI

/// One rail key's alternates — what a long press opens.
///
/// The design calls it a fan: hold CTRL and ten chords appear above the key,
/// hold an arrow and its far end does. It is a value rather than a view so the
/// catalog below can be read (and pinned) without a simulator, and so the model
/// can hold "which fan is open" without holding a view.
public struct KeyFan: Identifiable, Equatable, Sendable {

  /// What picking a fan key does. Two cases, because the fan has exactly two
  /// kinds of member: keystrokes, and the one modifier that is not a key.
  public enum Act: Equatable, Sendable {
    case stroke(TerminalKeystroke)
    /// Long-press ESC's own item — it arms the burst instead of sending it.
    case meta
  }

  public struct Item: Identifiable, Equatable, Sendable {
    public let id: String
    /// The key's face: `^C`, `HOME`, `⇧TAB`, `META`.
    public let label: String
    /// One word saying what it does, per the design's chord fan. Empty when the
    /// label is already the whole word (`HOME` needs no gloss).
    public let subtitle: String
    /// What VoiceOver reads instead of "caret C" — the fill and the glyph both
    /// say nothing to a screen reader.
    public let accessibilityLabel: String
    public let act: Act

    init(_ label: String, _ subtitle: String, spoken: String, act: Act) {
      self.id = label
      self.label = label
      self.subtitle = subtitle
      self.accessibilityLabel = subtitle.isEmpty ? spoken : "\(spoken), \(subtitle)"
      self.act = act
    }
  }

  /// The key this fan belongs to, and the identity the card's popover binds to
  /// — one fan open at a time, and each key presents only its own.
  public let id: String
  /// One or two rows; the chord fan is the only two-row one.
  public let rows: [[Item]]

  var items: [Item] { rows.flatMap { $0 } }
}

// MARK: - The catalog

extension KeyFan {

  /// Long-press CTRL: the ten chords, in the design's own order and with its
  /// one-word subtitles. `^C` is first because interrupt is what a held Ctrl is
  /// usually reaching for — there is no dedicated `^C` key (decision 2), and
  /// this is the gesture that replaces it.
  public static let control = KeyFan(
    id: "control",
    rows: [
      [
        chord("c", "interrupt"), chord("d", "eof"), chord("z", "suspend"),
        chord("r", "search"), chord("l", "clear"),
      ],
      [
        chord("u", "kill-line"), chord("w", "kill-word"), chord("a", "home"),
        chord("e", "end"), chord("k", "kill-end"),
      ],
    ])

  /// Long-press ESC: the Meta burst. Alt has no rail slot (decision 4) and
  /// this is the half `Esc` then `x` cannot do — tmux wants both bytes at once.
  public static let escape = KeyFan(
    id: "escape",
    rows: [[Item("META", "one key", spoken: "Meta", act: .meta)]])

  /// Long-press TAB: the one shifted named key on the rail.
  public static let tab = KeyFan(
    id: "tab",
    rows: [[Item("⇧TAB", "back", spoken: "Shift Tab", act: .stroke(.shiftTab))]])

  /// Long-press an arrow: its far end. Single-key fans still go through the
  /// fan, so every long press on the rail means the same thing.
  public static func arrow(_ key: TerminalKey) -> KeyFan? {
    switch key {
    case .arrowLeft: return one("left", "HOME", spoken: "Home", key: .home)
    case .arrowRight: return one("right", "END", spoken: "End", key: .end)
    case .arrowUp: return one("up", "PGUP", spoken: "Page up", key: .pageUp)
    case .arrowDown: return one("down", "PGDN", spoken: "Page down", key: .pageDown)
    default: return nil
    }
  }

  private static func chord(_ character: Character, _ subtitle: String) -> Item {
    Item(
      "^\(String(character).uppercased())", subtitle,
      spoken: "Control \(String(character).uppercased())",
      act: .stroke(.control(character)))
  }

  private static func one(
    _ id: String, _ label: String, spoken: String, key: TerminalKey
  ) -> KeyFan {
    KeyFan(id: id, rows: [[Item(label, "", spoken: spoken, act: .stroke(TerminalKeystroke(key)))]])
  }
}

// MARK: - The gesture and the presentation

extension View {

  /// Hang a long-press fan on a rail key.
  ///
  /// **Why a popover.** The card lives in a `safeAreaInset` at the bottom of
  /// the session sheet, and the fan has to stand ABOVE the key it belongs to —
  /// over the terminal, outside the card's own bounds. A popover is the one
  /// presentation that is anchored to the key, drawn outside every ancestor,
  /// and already dismissed by a tap anywhere else. `presentationCompactAdaptation`
  /// is what keeps it a popover on a phone instead of adapting into a sheet
  /// that would cover the terminal it is a keyboard for.
  ///
  /// **Why not slide-and-release.** The design's gesture is to hold, slide onto
  /// a chord and lift. A popover is a separate presentation: the drag that
  /// opened it does not continue into it, and a `LongPressGesture` sequenced
  /// before a `DragGesture` would have to own the whole rail key, taking the
  /// tap with it. So the fan is opened by the hold and its keys are TAPPED —
  /// the fallback the brief allows. Slide-and-release wants the fan drawn in
  /// the card's own hierarchy, which wants the card out of the safe-area inset.
  ///
  /// **Why `simultaneousGesture`.** A `Button`'s own tap must survive: a short
  /// tap on ESC still sends Escape. So the long press runs alongside it and the
  /// button's action checks `openFan` — the touch-up that ends a long press is
  /// not a tap on the key.
  @MainActor
  @ViewBuilder
  func fan(
    _ fan: KeyFan?,
    on model: InputCardModel,
    pick: @escaping (KeyFan.Item) -> Void
  ) -> some View {
    if let fan {
      self
        .simultaneousGesture(
          LongPressGesture(minimumDuration: KeyFanPresentation.longPress)
            .onEnded { _ in model.showFan(fan) }
        )
        .popover(
          item: Binding(
            get: { model.openFan?.id == fan.id ? model.openFan : nil },
            set: { if $0 == nil { model.closeFan() } })
        ) { open in
          KeyFanView(fan: open, select: pick)
            .presentationCompactAdaptation(.popover)
        }
    } else {
      self
    }
  }
}

enum KeyFanPresentation {
  /// The hold that opens a fan. Shorter than the field's hold-to-create
  /// (`FieldMotion.longPressDuration`, 520 ms): that gesture makes an agent and
  /// wants deliberation, this one is a keyboard key and wants speed.
  static let longPress: Double = 0.35
}

// MARK: - The view

/// The fan's own pixels: rows of keys in the card's shape, one size down.
///
/// It carries the card's voice rather than the popover's — mono labels, a
/// hairline chip each, `panelBackground` under the whole thing — because a
/// system-material popover full of monospaced keys would be the one surface in
/// the app that looks borrowed.
struct KeyFanView: View {
  let fan: KeyFan
  let select: (KeyFan.Item) -> Void

  /// Shorter than the rail's 44 pt: two rows of full-height keys plus the
  /// popover's own chrome would stand taller than the card it belongs to.
  private static let keyHeight: CGFloat = 40
  private static let gap: CGFloat = 6

  var body: some View {
    VStack(spacing: Self.gap) {
      ForEach(Array(fan.rows.enumerated()), id: \.offset) { _, row in
        HStack(spacing: Self.gap) {
          ForEach(row) { item in
            key(item)
          }
        }
      }
    }
    .padding(Self.gap + 2)
    .background(FieldPalette.panelBackground)
  }

  private func key(_ item: KeyFan.Item) -> some View {
    Button {
      select(item)
    } label: {
      VStack(spacing: 1) {
        Text(item.label)
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.08, of: 9))
          .foregroundStyle(FieldPalette.textMain)
        if !item.subtitle.isEmpty {
          Text(item.subtitle)
            .font(FieldType.mono(7))
            .foregroundStyle(FieldPalette.textMuted)
        }
      }
      .padding(.horizontal, 6)
      .frame(minWidth: 44)
      .frame(height: Self.keyHeight)
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
    .accessibilityLabel(item.accessibilityLabel)
  }
}
