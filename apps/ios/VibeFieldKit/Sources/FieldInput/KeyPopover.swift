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
    /// The key's face: `^C`, `Home`, `⇧Tab`, `Meta`.
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
    rows: [[Item("Meta", "one key", spoken: "Meta", act: .meta)]])

  /// Long-press TAB: the one shifted named key on the rail.
  public static let tab = KeyFan(
    id: "tab",
    rows: [[Item("⇧Tab", "back", spoken: "Shift Tab", act: .stroke(.shiftTab))]])

  /// Long-press an arrow: its far end. Single-key fans still go through the
  /// fan, so every long press on the rail means the same thing.
  public static func arrow(_ key: TerminalKey) -> KeyFan? {
    switch key {
    case .arrowLeft: return one("left", "Home", spoken: "Home", key: .home)
    case .arrowRight: return one("right", "End", spoken: "End", key: .end)
    case .arrowUp: return one("up", "PgUp", spoken: "Page up", key: .pageUp)
    case .arrowDown: return one("down", "PgDn", spoken: "Page down", key: .pageDown)
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
  /// **Reduce Motion (IOS-5e).** A popover ARRIVES as a scale out of the key it
  /// is anchored to — UIKit's animation, not ours, with no API to swap it for a
  /// fade. What we can do is refuse to animate the state change that presents
  /// it, which lands the fan with no scale and no spring; `KeyFanView` then
  /// fades its own content in, so what a reader who asked for less motion gets
  /// is the fade the setting wants rather than a bare cut. `reduceMotion` is
  /// passed in because a `View` extension has no environment of its own.
  @MainActor
  @ViewBuilder
  func fan(
    _ fan: KeyFan?,
    on model: InputCardModel,
    reduceMotion: Bool = false,
    pick: @escaping (KeyFan.Item) -> Void
  ) -> some View {
    if let fan {
      self
        .simultaneousGesture(
          LongPressGesture(minimumDuration: KeyFanPresentation.longPress)
            .onEnded { _ in
              guard reduceMotion else {
                model.showFan(fan)
                return
              }
              var transaction = Transaction()
              transaction.disablesAnimations = true
              withTransaction(transaction) { model.showFan(fan) }
            }
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

/// The fan's own pixels: the canvas's `.pop` — a floating surface at radius 14
/// holding `.pk` keys, 6 pt of padding and 4 pt between them.
///
/// A chord's face stays MONOSPACED while the rail's labels do not, and that is
/// the rule rather than an exception to it: DESIGN.md §3 gives monospace to
/// data, and `^C` is a byte, not a word. The gloss under it is SF, because
/// "interrupt" is.
struct KeyFanView: View {
  let fan: KeyFan
  let select: (KeyFan.Item) -> Void
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The fade. False for one frame, then true — which is the whole of the
  /// fan's Reduce Motion arrival, since the presentation itself was landed with
  /// animations off (see `View.fan`).
  @State private var shown = false
  // --- end IOS-5e -----------------------------------------------------------

  /// `.pop` — `padding: 6`, `gap: 4`.
  private static let gap: CGFloat = 4
  private static let padding: CGFloat = 6

  /// The rail's own key height: a fan key is a key, and the fan is two rows at
  /// most, so there is room to make them the same size as the one they came
  /// out of.
  private var keyHeight: CGFloat { InputCardMetrics.fanKeyHeight(for: dynamicTypeSize) }
  private var labelSize: CGFloat { InputCardMetrics.labelSize(for: dynamicTypeSize) }

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
    .padding(Self.padding)
    .background { ChromeMaterial.floating(radius: ChromeRadius.pop, shadow: ChromeShadow.pop) }
    // --- IOS-5e: the fan's own arrival, for a reader who asked for no motion.
    .opacity(reduceMotion && !shown ? 0 : 1)
    .onAppear {
      guard reduceMotion else { return }
      withAnimation(FieldMotion.ease(0.14)) { shown = true }
    }
    // --- end IOS-5e
  }

  private func key(_ item: KeyFan.Item) -> some View {
    Button {
      select(item)
    } label: {
      VStack(spacing: 2) {
        // `.pk span` — mono 14 semibold. The chord itself is data.
        Text(item.label)
          .font(ChromeType.mono(labelSize + 1, .semibold))
          .foregroundStyle(ChromePalette.ink)
        if !item.subtitle.isEmpty {
          // `.pk small` — SF 9 medium at 55%.
          Text(item.subtitle)
            .font(
              ChromeType.sans(InputCardMetrics.subtitleSize(for: dynamicTypeSize), .medium)
            )
            .foregroundStyle(ChromePalette.inkTertiary)
            .lineLimit(1)
        }
      }
      .padding(.horizontal, 8)
      .frame(minWidth: 44)
      .frame(height: keyHeight)
      .background {
        ChromeMaterial.key(fill: ChromePalette.fanKeyFill, hairline: nil, shadow: nil)
      }
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(item.accessibilityLabel)
  }
}
