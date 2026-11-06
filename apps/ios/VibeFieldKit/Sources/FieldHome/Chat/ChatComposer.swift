import FieldDesign
import SwiftUI

// IOS-12c (PC-D3 A; DESIGN.md §8 "The phone's Chat" → the composer, with its dated notes of 2026-11-06) — THE THREAD'S
// COMPOSER, in the bar's place (in a thread the bar steps aside, as Messages does): the field, 48 tall, 16 from the
// sides and 21 from the foot, over the keys 10 and 8; the draft 17 regular on one line, "Message ‹name›…", growing to
// five; and Send (inverted) once there are words. Return sends (the line break it types is the press): no pane stands
// in front of you, so nothing waits for a second Return. Words alone until IOS-12f (@ with it); no drawn mic and no +
// yet (they come together, after the 0.9 build). The field is prose: the system's own autocorrection and punctuation,
// unlike the terminal's composer. While the spark's desktop is away the draft waits under its line and Send is not
// offered (Q7).

struct ChatComposer: View {
  @Binding var draft: String
  let name: String
  let away: ChatAway?
  /// A send or a wake holds the thread: Send waits.
  let busy: Bool
  /// The last send not taken, in its words, until the next send.
  let note: String?
  let onSend: () -> Void

  @FocusState private var typing: Bool
  @State private var homeInset: CGFloat = 0

  static let height: CGFloat = 48
  static let side: CGFloat = 16
  static let sideTyping: CGFloat = 10
  static let footTyping: CGFloat = 8
  static let send: CGFloat = 36

  private var sendable: Bool {
    !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && away == nil
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
        TextField("Message \(name)…", text: $draft, axis: .vertical)
          .font(ChromeType.sans(17))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1...5)
          .focused($typing)
          .submitLabel(.send)
          .onSubmit(send)
          // Return sends: a field that grows types a line break for it, so ONE break typed at a time is the press (a
          // paste keeps its breaks), and the break leaves the draft
          .onChange(of: draft) { old, new in
            guard let at = Self.typedBreak(old, new) else { return }
            draft.remove(at: at)
            send()
          }
          .padding(.vertical, 13)
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

  /// Where Return typed its one line break into `new`, or nil: `new` is `old` with a single "\n" put in.
  static func typedBreak(_ old: String, _ new: String) -> String.Index? {
    guard new.count == old.count + 1 else { return nil }
    var o = old.startIndex
    var n = new.startIndex
    while o < old.endIndex, old[o] == new[n] {
      o = old.index(after: o)
      n = new.index(after: n)
    }
    guard new[n] == "\n", new[new.index(after: n)...] == old[o...] else { return nil }
    return n
  }
}
