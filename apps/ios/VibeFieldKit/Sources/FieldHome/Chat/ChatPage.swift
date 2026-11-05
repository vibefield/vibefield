import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12b (PC-D1 A, PC-L1, PC-L4, PC-L5; DESIGN.md §8 "The phone's Chat", §9 "Chat on the phone") — CHAT'S PAGE:
// History's page (its large title, its paper, its group head), the list's subtitle counting what is true, a line for
// each desktop whose sparks are its last word, and one row per spark, newest activity first (CH-D1). The Needs you
// group is IOS-12d's, the thread IOS-12c's: a row here says its spark's status and its dot, and Wake stands in its
// menu while it sleeps.

/// Chat's words (§9 "Chat on the phone"), pure.
enum ChatWords {
  static let title = "Chat"
  static let sparks = "Sparks"
  static let emptyTitle = "No sparks yet."
  static let emptyText = "A spark is an agent VibeField starts to run your other agents."
  static let wake = "Wake"

  /// The note over the bar (§9): "Vela needs you".
  static func note(_ name: String) -> String { "\(name) needs you" }

  /// "4 sparks on studio · 2 need you": what is true, the desktops the sparks live on by name.
  static func subtitle(sparks: Int, on desktops: [String], needing: Int) -> String {
    let count = sparks == 1 ? "1 spark" : "\(sparks) sparks"
    let places = desktops.isEmpty ? count : "\(count) on \(names(desktops))"
    guard needing > 0 else { return places }
    return "\(places) · \(needing == 1 ? "1 needs you" : "\(needing) need you")"
  }

  /// "studio", "studio and loft", "studio, loft and mini".
  static func names(_ names: [String]) -> String {
    guard names.count > 1, let last = names.last else { return names.first ?? "" }
    return "\(names.dropLast().joined(separator: ", ")) and \(last)"
  }

  /// A desktop whose rows are its last word (PC-L4), in the fact that holds: asleep; not answering (a timeout, or
  /// unreachable — the same fact to the person); or answering with a build the phone can't read (VF-PM's ruling,
  /// 2026-11-05: never "isn't answering" about a desktop that answered and was refused).
  static func away(_ desktop: String, _ standing: ChatAway.Standing) -> String {
    switch standing {
    case .asleep:
      "\(desktop) is asleep. These are as it last said; your words wait here until it wakes."
    case .silent:
      "\(desktop) isn't answering. These are as it last said; your words wait here until it answers."
    case .incompatible:
      "\(desktop) runs a build this phone can't read. These are as it last said; "
        + "your words wait here until it's updated."
    }
  }

  /// A row's accessible name: the name, the word, the time, and a dot the word does not say (§9's "unread",
  /// "needed you").
  static func row(_ entry: SparkEntry, time: String, mark: ThreadMark?) -> String {
    var parts = [entry.spark.name, entry.status.word, time]
    switch mark {
    case .needs where !entry.needsYou: parts.append("needed you")
    case .unread: parts.append("unread")
    default: break
    }
    return parts.joined(separator: ", ")
  }
}

/// One desktop line under the subtitle: a desktop whose sparks are its last word, and why.
struct ChatAway: Equatable, Identifiable {
  enum Standing: Equatable {
    case asleep
    /// Asked, and no answer: a timeout, unreachable, or a word this build does not know.
    case silent
    /// It answered, with a build the home cannot merge.
    case incompatible

    /// How the merge says a desktop answered (`ComposeDesktopState`, OPEN), as the person reads it.
    init(_ state: ComposeDesktopState?) {
      switch state {
      case .asleep: self = .asleep
      case .incompatible: self = .incompatible
      default: self = .silent
      }
    }
  }

  let device: String
  let name: String
  let standing: Standing
  var id: String { device }
}

struct ChatPage: View {
  let entries: [SparkEntry]
  let ledger: ThreadLedger
  /// The names of the desktops the sparks live on, in the list's order.
  let desktops: [String]
  let away: [ChatAway]
  /// The home has answered the list at least once (else nothing is claimed, not even "No sparks yet.").
  let heard: Bool
  let onWake: (SparkSummary) -> Void

  var body: some View {
    NavigationStack {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          head
          if entries.isEmpty {
            if heard, away.isEmpty {
              VStack(alignment: .leading, spacing: 6) {
                Text(ChatWords.emptyTitle)
                  .font(ChromeType.sans(15, .semibold))
                  .foregroundStyle(ChromePalette.ink)
                Text(ChatWords.emptyText)
                  .font(ChromeType.sans(13.5))
                  .foregroundStyle(ChromePalette.inkTertiary)
                  .lineSpacing(3)
              }
              .padding(.horizontal, 20)
              .padding(.vertical, 24)
            }
          } else {
            HStack(spacing: 4) {
              Text(ChatWords.sparks)
              Text("·")
              Text("\(entries.count)")
            }
            .chromeGroupHead()
            .frame(minHeight: 30)
            .padding(.horizontal, 20)
            .padding(.top, 22)
            .padding(.bottom, 8)
            TimelineView(.periodic(from: .now, by: 60)) { context in
              let now = Int64((context.date.timeIntervalSince1970 * 1000).rounded())
              VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                  ChatRow(entry: entry, mark: ledger.mark(of: entry), now: now, separated: index > 0, onWake: onWake)
                }
              }
            }
          }
        }
        .padding(.bottom, 24)
      }
      .background(ChromePalette.paper.ignoresSafeArea())
      .navigationTitle(ChatWords.title)
    }
    .tint(ChromePalette.ink)
  }

  private var head: some View {
    VStack(alignment: .leading, spacing: 5) {
      if heard || !entries.isEmpty {
        Text(ChatWords.subtitle(sparks: entries.count, on: desktops, needing: SparkEntries.needing(entries)))
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(2)
      }
      ForEach(away) { desktop in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Image(systemName: "moon")
            .font(.system(size: 12, weight: .medium))
          Text(ChatWords.away(desktop.name, desktop.standing))
            .font(ChromeType.sans(13))
            .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(ChromePalette.inkSecondary)
        .accessibilityElement(children: .combine)
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 2)
  }
}

/// A spark's row (DESIGN.md §8): 76 tall, 16 from the sides, its face at 48 on its disc; the name 17 semibold and its
/// time 15 tertiary; its status's word 15 tertiary, in the attention ink when it needs you (S-4); its dot 10, orange
/// for a need until its thread is opened, else cyan while unread (PC-L5); its separator from the words' edge.
struct ChatRow: View {
  let entry: SparkEntry
  let mark: ThreadMark?
  let now: Int64
  let separated: Bool
  let onWake: (SparkSummary) -> Void

  static let height: CGFloat = 76
  static let face: CGFloat = 48
  static let side: CGFloat = 16
  static let gap: CGFloat = 12
  static let dot: CGFloat = 10

  var body: some View {
    let time = SparkEntries.activityWords(at: entry.activityAt, now: now)
    HStack(spacing: Self.gap) {
      SparkFlatFace(seed: entry.spark.seed, size: Self.face)
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(entry.spark.name)
            .font(ChromeType.sans(17, .semibold))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
          Spacer(minLength: 0)
          Text(time)
            .font(ChromeType.sans(15))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkTertiary)
        }
        HStack(spacing: 8) {
          Text(entry.status.word)
            .font(ChromeType.sans(15))
            .foregroundStyle(entry.needsYou ? ChromePalette.attention : ChromePalette.inkTertiary)
            .lineLimit(1)
          Spacer(minLength: 0)
          if let mark {
            Circle()
              .fill(mark == .needs ? ChromePalette.attention : ChromePalette.info)
              .frame(width: Self.dot, height: Self.dot)
          }
        }
      }
    }
    .padding(.horizontal, Self.side)
    .frame(minHeight: Self.height)
    .overlay(alignment: .top) {
      if separated {
        Rectangle()
          .fill(ChromePalette.separator)
          .frame(height: 1)
          .padding(.leading, Self.side + Self.face + Self.gap)
      }
    }
    .contentShape(Rectangle())
    .contextMenu {
      if !entry.awake {
        Button(ChatWords.wake) { onWake(entry.spark) }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(ChatWords.row(entry, time: time, mark: mark))
    .accessibilityActions {
      if !entry.awake {
        Button(ChatWords.wake) { onWake(entry.spark) }
      }
    }
  }
}
