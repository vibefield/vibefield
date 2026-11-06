import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12b (CH-D4 S-4; DESIGN.md §8 "Chat's list" as amended at CP-3, at touch pitch; §9 "The note says ‹name› needs
// you") — THE NOTE. When a spark starts to need you while another page stands, the phone says so over the bar for
// 2.4 s: its face, "Vela needs you" in the attention ink. A tap opens Chat (its thread is IOS-12c's). It is said when
// something STARTS to need you: its own run waiting on you, or a new item for it in the queue. What the phone finds
// on its first whole reading (the sparks and the queue both heard) is no news.

/// Which needs are new, reading by reading (the Mac's `needsOf` keys: its own run's wait, then each item).
struct ChatNotes: Equatable {
  /// The needs standing on the last reading; nil before the first whole one.
  private var known: Set<String>?

  /// A need's keys for one spark: its own run's wait while it runs, then its items. *Amended at IOS-12d (TH-1, the
  /// Mac's `needsOf`):* a waiting run whose ask the queue holds is that item, read once: the item's key alone.
  static func keys(_ entry: SparkEntry) -> [String] {
    let items = entry.items.map { $0.id }
    guard entry.blocked, let run = entry.run else { return items }
    let queued = entry.items.contains { $0.knownKind == .agentAsk && $0.from.session == run.runtimeRunId }
    return (queued ? [] : ["\(run.runtimeRunId):wait"]) + items
  }

  /// One reading: the first spark with a need that was not standing before, when another page stands; nil when
  /// nothing started, on Chat's own page, and on the first whole reading (no news). `whole`: both lists heard.
  mutating func read(_ entries: [SparkEntry], elsewhere: Bool, whole: Bool) -> SparkEntry? {
    guard whole else { return nil }
    let now = Set(entries.flatMap(Self.keys))
    defer { known = now }
    guard let before = known, elsewhere else { return nil }
    return entries.first { entry in Self.keys(entry).contains { !before.contains($0) } }
  }
}

/// The note over the bar: a glass capsule, the spark's face at 22, its words in the attention ink, a chevron.
struct ChatNoteView: View {
  let spark: SparkSummary
  /// IOS-12d (Q4) — an answer given off screen that did not go as asked says its line here, in the card's words; nil:
  /// the need's own note ("‹name› needs you").
  var text: String? = nil
  let onOpen: () -> Void

  static let height: CGFloat = 44
  /// Above the bar's row: the design page's 95 from the foot, the row's 83 and 12 of air.
  static let gap: CGFloat = 12
  static let lasts: Duration = .milliseconds(2400)

  var body: some View {
    Button(action: onOpen) {
      HStack(spacing: 8) {
        SparkFlatFace(seed: spark.seed, size: 22)
        Text(words)
          .font(ChromeType.sans(15, .semibold))
          .foregroundStyle(ChromePalette.attention)
          .lineLimit(text == nil ? 1 : 2)
        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(ChromePalette.attention)
      }
      .padding(.leading, 10)
      .padding(.trailing, 16)
      .frame(height: Self.height)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .liquidGlassCapsule()
    .accessibilityLabel(words)
    .accessibilityHint("Opens Chat")
  }

  private var words: String { text ?? ChatWords.note(spark.name) }
}
