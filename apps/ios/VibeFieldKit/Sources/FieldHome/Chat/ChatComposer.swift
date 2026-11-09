import FieldDesign
import SwiftUI

// IOS-12c (PC-D3 A; DESIGN.md §8 "The phone's Chat" → the composer, with its dated notes of 2026-11-06) — THE THREAD'S
// COMPOSER, in the bar's place (in a thread the bar steps aside, as Messages does): the field, 48 tall, 16 from the
// sides and 21 from the foot, over the keys 10 and 8; the draft 17 regular on one line, "Message ‹name›…", growing to
// five; and Send (inverted) once there are words. Return sends: no pane stands in front of you, so nothing waits for a
// second Return. No drawn mic and no + yet (they come together, after the 0.9 build). While the spark's desktop is away
// the draft waits under its line and Send is not offered (Q7).
// IOS-12f's M-f2: the draft holds words and chips (`ChatDraftField`, where the field's prose traits and Return now
// live), and @'s box stands over the field, its foot 8 above it.

struct ChatComposer: View {
  @Binding var parts: [ChatDraftPart]
  @Binding var caret: Int?
  let name: String
  let away: ChatAway?
  /// A send or a wake holds the thread: Send waits.
  let busy: Bool
  /// The last send not taken, in its words, until the next send.
  let note: String?
  /// The @ still being typed, as typed: a mention in progress is not a message.
  let pending: String?
  /// @'s box, while an @ or an agent's menu stands.
  let at: ChatAtView?
  /// A chip was tapped, at its place in the draft.
  let onChip: (Int) -> Void
  let onSend: () -> Void

  @State private var typing = false
  @State private var fieldHeight = ChatDraftField.oneLine
  @State private var homeInset: CGFloat = 0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  static let height: CGFloat = 48
  static let side: CGFloat = 16
  static let sideTyping: CGFloat = 10
  static let footTyping: CGFloat = 8
  static let send: CGFloat = 36

  private var sendable: Bool {
    away == nil && ChatDraft.sendable(parts, pending: pending)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let away {
        Text(ChatThreadWords.draftWaits(away.name, away.standing))
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .padding(.horizontal, 16)
      } else if let note {
        Text(note)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.attention)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 16)
      }
      HStack(alignment: .bottom, spacing: 8) {
        ChatDraftField(
          parts: $parts, caret: $caret, height: $fieldHeight, typing: $typing, placeholder: "Message \(name)…",
          onReturn: { send() }, onChip: onChip
        )
        .frame(height: fieldHeight)
        .padding(.vertical, 11)
        .padding(.leading, 18)
        .padding(.trailing, sendable ? 4 : 18)
        .frame(minHeight: Self.height)
        if sendable {
          Button(action: send) {
            FieldGlyph(.arrow, size: 18)
              .foregroundStyle(ChromePalette.keyOnInk)
              .frame(width: Self.send, height: Self.send)
              .background(Circle().fill(ChromePalette.keyOnFill))
          }
          .buttonStyle(.plain)
          .disabled(busy)
          .opacity(busy ? 0.5 : 1)
          .accessibilityLabel("Send")
          .padding(.trailing, 6)
          .padding(.bottom, 6)
          .transition(.opacity.combined(with: .scale(scale: 0.8)))
        }
      }
      .background(
        RoundedRectangle(cornerRadius: Self.height / 2, style: .continuous)
          .fill(ChromePalette.menuSurface)
      )
      .overlay(
        RoundedRectangle(cornerRadius: Self.height / 2, style: .continuous)
          .strokeBorder(ChromePalette.cardHairline, lineWidth: 1)
      )
      .overlay(alignment: .top) {
        if let at {
          at
            .alignmentGuide(.top) { $0[.bottom] + ChatAtView.foot }
            .transition(
              reduceMotion
                ? .opacity
                : .opacity.combined(with: .offset(y: 6)).combined(with: .scale(scale: 0.97, anchor: .bottom)))
        }
      }
      .animation(reduceMotion ? .easeInOut(duration: 0.12) : .easeOut(duration: 0.24), value: at != nil)
      .animation(.easeOut(duration: 0.2), value: sendable)
    }
    .padding(.horizontal, typing ? Self.sideTyping : Self.side)
    .padding(.top, 8)
    .padding(.bottom, typing ? Self.footTyping : max(AppBar.bottomGap(homeInset: homeInset) - homeInset, 0))
    .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: { inset in
      // the home indicator's inset while the keys are down: the bar's own foot (`AppBar.bottomGap`)
      if !typing { homeInset = inset }
    }
  }

  /// Return, or Send: nothing while the thread is held or the desktop is away, or with no words.
  private func send() {
    guard sendable, !busy else { return }
    onSend()
  }
}
