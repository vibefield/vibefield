import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12d (PC-D4 A, PC-L1, PC-L3, PC-L4; DESIGN.md §8 "The phone's Chat", Needs you, as amended at IOS-12d's d0, and
// §8 "Chat's thread", the needs-you card; §9 "Chat on the phone") — THE NEEDS-YOU CARD at touch pitch. The Mac's card,
// its words the ported fold's (`NeedsCards`), on the pale fill, corners 20, padded 14 16, ringed 1.5 in the attention
// ink at 75% while it waits on you and by the separator's hairline once it waits on no one. In the group its eyebrow
// says who asks (Q2); in a thread it is the Mac's, with "1 of 3". Its acts are capsules 36 tall, the first inverted,
// wrapping and never shrinking. An agent's own ask has one act, Answer in its pane (PC-L3). While its desktop is away
// its acts are withheld and its line says so (Q8).

struct ChatNeedsCardView: View {
  /// Where the card stands: the Needs you group, or a thread's foot.
  enum Place: Equatable {
    case group
    case thread
  }

  let card: NeedsCard
  let place: Place
  /// Its desktop's line while it is away: its acts are withheld (Q8).
  let away: String?
  /// The catalog's labels by agent id (the home's `agent.catalog`; an agent it does not name is said by its id).
  let labels: [String: String]
  /// An act pressed, by its place.
  let onAct: (Int) -> Void
  /// Answer in its pane: the pane opened, or (false) the board has none.
  let onPane: () -> Bool
  /// Pressed outside its acts, in the group: its spark's thread.
  let onOpen: (() -> Void)?

  @State private var paneMissed = false
  @State private var questionHeight: CGFloat = 0
  @State private var wordsHeight: CGFloat = 0

  static let corner: CGFloat = 20
  static let ring: CGFloat = 1.5
  static let capsule: CGFloat = 36
  static let rowGap: CGFloat = 5
  /// Six lines of the question at 17 and 1.35, then it scrolls within itself.
  static let questionMax: CGFloat = 6 * 17 * 1.35
  /// Six lines of the held words at 15 and 1.35.
  static let wordsMax: CGFloat = 6 * 15 * 1.35

  var body: some View {
    let words = NeedsCards.words(card, label: { labels[$0] })
    VStack(alignment: .leading, spacing: Self.rowGap) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(place == .group ? ChatNeedsWords.asks(card) : words.eyebrow)
          .font(ChromeType.sans(13, .semibold))
          .foregroundStyle(waitsOnYou ? ChromePalette.attention : ChromePalette.inkTertiary)
          .lineLimit(1)
        Spacer(minLength: 0)
        if place == .thread, let count = words.place {
          Text(count)
            .font(ChromeType.sans(12))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkTertiary)
        }
      }
      scrolled(words.question, size: 17, ink: ChromePalette.ink, max: Self.questionMax, height: $questionHeight)
      if let held = words.words {
        scrolled(held, size: 15, ink: ChromePalette.inkSecondary, max: Self.wordsMax, height: $wordsHeight)
        if let more = words.more {
          Text(more)
            .font(ChromeType.sans(15))
            .foregroundStyle(ChromePalette.inkTertiary)
        }
      }
      if let sub = words.sub {
        Text(sub)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkTertiary)
          .fixedSize(horizontal: false, vertical: true)
      }
      if case .refused(let reason) = card.act {
        Text(NeedsCards.refused(reason))
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.attention)
          .fixedSize(horizontal: false, vertical: true)
      }
      if let away {
        Text(away)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      foot(words)
    }
    .padding(.vertical, 14)
    .padding(.horizontal, 16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: Self.corner, style: .continuous).fill(ChromePalette.fill))
    // the fill is 8% white at night and a thread holds this card over its flow: paper under it, so none shows through
    .background(RoundedRectangle(cornerRadius: Self.corner, style: .continuous).fill(ChromePalette.paper))
    .overlay(
      RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
        .strokeBorder(
          waitsOnYou ? ChromePalette.attention.opacity(0.75) : ChromePalette.separator,
          lineWidth: waitsOnYou ? Self.ring : 1)
    )
    .contentShape(RoundedRectangle(cornerRadius: Self.corner, style: .continuous))
    .onTapGesture { onOpen?() }
    .allowsHitTesting(!card.leaving)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(place == .group ? "\(ChatNeedsWords.asks(card)): \(words.question)" : words.label)
  }

  /// It waits on you: its item waits in the queue, or your answer to it runs; not once it says what you said.
  private var waitsOnYou: Bool {
    switch card.act {
    case .busy: true
    case .said: false
    case .idle, .refused: card.waits
    }
  }

  /// The acts, the pane's act, or what you said.
  @ViewBuilder
  private func foot(_ words: NeedsCardWords) -> some View {
    if case .said(let choice) = card.act {
      let said = NeedsCards.said(card.item, choice: choice, names: card.names)
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        if said.tone == .failed {
          Image(systemName: "exclamationmark.circle")
            .font(.system(size: 13, weight: .semibold))
        } else {
          FieldGlyph(.check, size: 14)
        }
        Text(said.text)
          .font(ChromeType.sans(13, .medium))
          .fixedSize(horizontal: false, vertical: true)
      }
      .foregroundStyle(said.tone == .failed ? ChromePalette.attention : ChromePalette.inkTertiary)
      .padding(.top, 4)
      .accessibilityElement(children: .combine)
      // announced once, as it arrives (§8: the card's said line)
      .onAppear { AccessibilityNotification.Announcement(said.text).post() }
    } else if away == nil {
      if words.show {
        VStack(alignment: .leading, spacing: 6) {
          act(ChatNeedsWords.answerInPane, primary: false) {
            paneMissed = !onPane()
          }
          if paneMissed {
            Text(ChatNeedsWords.paneMissing)
              .font(ChromeType.sans(13))
              .foregroundStyle(ChromePalette.attention)
              .fixedSize(horizontal: false, vertical: true)
              .task {
                try? await Task.sleep(for: .milliseconds(NeedsCards.saidMs))
                paneMissed = false
              }
          }
        }
        .padding(.top, 8)
      } else if !words.acts.isEmpty {
        // the layout called as a function: its init takes no content
        let acts = ChatActsLayout(spacing: 8)
        acts {
          ForEach(words.acts) { each in
            let pressed = card.act.pressed == each.choice
            act(word(each), primary: each.primary) {
              if answers { onAct(each.choice) }
            }
            // §8: while its answer runs the pressed act keeps its look and says "…"; the others dim as the kit's
            // disabled buttons do, and none answers (d4c, S1: `.disabled` on the pressed act greyed it)
            .disabled(!answers && !pressed)
            .allowsHitTesting(answers)
          }
        }
        .padding(.top, 8)
      }
    }
  }

  /// The pressed act says its word with "…" while its answer runs.
  private func word(_ act: NeedsCardAct) -> String {
    if case .busy(let choice) = card.act, choice == act.choice { return ChatNeedsWords.pressed(act.word) }
    return act.word
  }

  /// The acts answer while nothing runs and the item still waits (a refused one, to be answered again).
  private var answers: Bool {
    switch card.act {
    case .idle, .refused: card.waits
    case .busy, .said: false
    }
  }

  private func act(_ word: String, primary: Bool, _ press: @escaping () -> Void) -> some View {
    Button(action: press) {
      Text(word)
        .font(ChromeType.sans(15, .medium))
        .foregroundStyle(primary ? ChromePalette.keyOnInk : ChromePalette.ink)
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, 16)
        .frame(height: Self.capsule)
        .background(Capsule().fill(primary ? ChromePalette.keyOnFill : ChromePalette.menuSurface))
        .overlay {
          if !primary { Capsule().strokeBorder(ChromePalette.cardHairline, lineWidth: 1) }
        }
    }
    .buttonStyle(.plain)
  }

  /// Words that show six lines at most, then scroll within themselves, so nothing you answer is hidden from you.
  private func scrolled(
    _ text: String, size: CGFloat, ink: Color, max: CGFloat, height: Binding<CGFloat>
  ) -> some View {
    ScrollView(.vertical) {
      Text(text)
        .font(ChromeType.sans(size))
        .lineSpacing(size * 0.35)
        .foregroundStyle(ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height.wrappedValue = $0 }
    }
    .scrollBounceBehavior(.basedOnSize)
    .scrollIndicators(height.wrappedValue > max ? .automatic : .hidden)
    .frame(height: Swift.min(Swift.max(height.wrappedValue, 1), max))
  }
}

/// The card's acts, left to right, 8 apart, wrapping to a further row where the next would not fit; never shrunk.
/// IOS-12f — `centred`: each row centred in the box, as New spark's chips wrap (the Mac's `justify-content: center`).
struct ChatActsLayout: Layout {
  var spacing: CGFloat = 8
  var centred = false

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(within: proposal.width ?? .infinity, subviews)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(Swift.max(rows.count - 1, 0))
    return CGSize(width: width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in rows(within: bounds.width, subviews) {
      var x = centred ? bounds.minX + Swift.max(bounds.width - row.width, 0) / 2 : bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func rows(within width: CGFloat, _ subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      if !row.indices.isEmpty, row.width + spacing + size.width > width {
        rows.append(row)
        row = Row()
      }
      row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      row.height = Swift.max(row.height, size.height)
      row.indices.append(index)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}
