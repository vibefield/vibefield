import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12b (PC-D1 A, PC-L1, PC-L4, PC-L5; DESIGN.md §8 "The phone's Chat", §9 "Chat on the phone") — CHAT'S PAGE:
// History's page (its large title, its paper, its group head), the list's subtitle counting what is true, a line for
// each desktop whose sparks are its last word, and one row per spark, newest activity first (CH-D1). The Needs you
// group is IOS-12d's. A row says its spark's status and its dot; pressed, it opens the spark's thread (IOS-12c), pushed
// in this page's own stack; held, its menu offers Open its pane while its own run is live, and Wake while it sleeps.

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

  /// A desktop that did not answer (PC-L4), in the fact that holds: asleep; not answering (a timeout, or
  /// unreachable — the same fact to the person); or answering with a build the phone can't read (VF-PM's ruling,
  /// 2026-11-05: never "isn't answering" about a desktop that answered and was refused). `carried`: the list holds a
  /// row of it, its last word; else the phone never heard it, and says so, never "as it last said" (§9, VF-PM
  /// 2026-11-05 02:06Z). The device is named as its platform names it (`DeviceWord`; L4's word pass, 2026-11-06).
  static func away(_ desktop: String, _ standing: ChatAway.Standing, carried: Bool, device: DeviceWord) -> String {
    switch (standing, carried) {
    case (.asleep, true):
      "\(desktop) is asleep. These are as it last said; your words wait here until it wakes."
    case (.silent, true):
      "\(desktop) isn't answering. These are as it last said; your words wait here until it answers."
    case (.incompatible, true):
      "\(desktop) runs a build \(device.this) can't read. These are as it last said; "
        + "your words wait here until it's updated."
    case (.asleep, false):
      "\(desktop) is asleep. Its sparks show here when it wakes."
    case (.silent, false):
      "\(desktop) isn't answering. Its sparks show here when it answers."
    case (.incompatible, false):
      "\(desktop) runs a build \(device.this) can't read. Its sparks show here when it's updated."
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

/// One desktop line under the subtitle: a desktop that did not answer, why, and whether the list holds its last word.
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
  /// The list holds a spark or an ask of it: its last word. Else the phone never heard it.
  let carried: Bool
  var id: String { device }

  /// The lines under the subtitle, in the merge's order (PC-L4; §9, VF-PM 2026-11-05 02:06Z). A desktop the merge
  /// says did not answer says its last word only while the reading carries a spark or an ask of it, and is said as
  /// never heard otherwise. With no door the home answers for every desktop: it says the whole list's last word while
  /// the reading carries any row, and is never heard otherwise (a cold start, the common case: the list lives in
  /// memory). `homeListed`: the tailnet still lists the home, so it is not answering rather than asleep. `name(nil)`
  /// is the home's name (the page's own, on the main actor).
  @MainActor
  static func lines(
    _ reading: ChatReading, home: String?, homeListed: Bool, name: @MainActor (String?) -> String
  ) -> [ChatAway] {
    guard reading.connected else {
      let carried = !reading.sparks.isEmpty || !reading.items.isEmpty
      return [
        ChatAway(device: home ?? "", name: name(nil), standing: homeListed ? .silent : .asleep, carried: carried)
      ]
    }
    let held = Set(reading.sparks.compactMap { $0.device } + reading.items.compactMap { $0.device })
    return reading.desktops.filter { $0.known != .answered }.map { desktop in
      ChatAway(
        device: desktop.device, name: name(desktop.device), standing: Standing(desktop.known),
        carried: held.contains(desktop.device))
    }
  }
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
  /// IOS-12c — the threads' reads and sends go through Chat's feed, and the thread shown is the screen's (the bar
  /// steps aside for it, and the ledger reads it).
  let feed: ChatFeed
  @Binding var thread: String?
  /// Open its pane: the spark's own run's session card, which is the attach (FW-D2).
  let onOpenPane: (AgentRemoteRow) -> Void
  #if DEBUG
    /// The stills' thread has been opened once (`ChatFixtureDoor.openThread`); back then stays back.
    @State private var openedForStills = false
  #endif

  /// The stack's path: the shown thread, or none.
  private var path: Binding<[String]> {
    Binding(get: { thread.map { [$0] } ?? [] }, set: { thread = $0.last })
  }

  var body: some View {
    NavigationStack(path: path) {
      // IOS-12e (§2.10): Chat's list is one stage; a row's face moves on it while its spark works
      SparkStageHost {
        list
          .background(ChromePalette.paper.ignoresSafeArea())
      }
      .navigationTitle(ChatWords.title)
      .navigationDestination(for: String.self) { spark in
        if let entry = entries.first(where: { $0.spark.id == spark }) {
          ChatThreadView(
            entry: entry, feed: feed,
            away: ChatThreads.away(of: entry.spark, in: away, connected: feed.reading.connected),
            onOpenPane: onOpenPane)
        } else {
          // the spark left the list while its thread stood: the list again
          Color.clear.onAppear { thread = nil }
        }
      }
    }
    .tint(ChromePalette.ink)
    #if DEBUG
      // the stills, under `-vf-mock`: the named thread opens once the list holds its spark (set before then, the
      // destination would find no spark and stand the list again)
      .onChange(of: entries.map(\.spark.id), initial: true) { _, ids in
        guard !openedForStills, let spark = ChatFixtureDoor.openThread, ids.contains(spark) else { return }
        openedForStills = true
        thread = spark
      }
    #endif
  }

  private var list: some View {
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
                ChatRow(
                  entry: entry, mark: ledger.mark(of: entry), now: now, separated: index > 0, onWake: onWake,
                  onOpen: { thread = entry.spark.id }, onOpenPane: onOpenPane)
              }
            }
          }
        }
      }
      .padding(.bottom, 24)
    }
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
          Text(ChatWords.away(desktop.name, desktop.standing, carried: desktop.carried, device: DeviceWord.current))
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
  /// IOS-12c — pressed: its thread
  let onOpen: () -> Void
  let onOpenPane: (AgentRemoteRow) -> Void

  static let height: CGFloat = 76
  static let face: CGFloat = 48
  static let side: CGFloat = 16
  static let gap: CGFloat = 12
  static let dot: CGFloat = 10
  /// The statuses a face moves through while its spark works: "live while it works" (§2.10's table), the Mac's
  /// `AT_WORK` (ChatPanelView.tsx). Any other status is a still.
  static let atWork: Set<SparkStatus> = [.thinking, .planning, .searching, .reviewing, .running, .focus]

  var body: some View {
    let time = SparkEntries.activityWords(at: entry.activityAt, now: now)
    HStack(spacing: Self.gap) {
      SparkFaceView(
        seed: entry.spark.seed, status: entry.status.rawValue, size: Self.face,
        live: Self.atWork.contains(entry.status))
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
    .onTapGesture(perform: onOpen)
    .contextMenu { acts }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(ChatWords.row(entry, time: time, mark: mark))
    .accessibilityAddTraits(.isButton)
    .accessibilityAction(.default, onOpen)
    .accessibilityActions { acts }
  }

  /// §8's row menu, in its order: **Open its pane** while its own run is live, then **Wake** while it sleeps (IOS-12c,
  /// `ChatThreadActs.menu`, the thread's ⋯ too). Put to sleep and Its profile join when the phone has their doors.
  @ViewBuilder
  private var acts: some View {
    ForEach(ChatThreadActs.menu(entry), id: \.self) { act in
      switch act {
      case .openPane:
        Button(ChatThreadWords.openPane) {
          if let run = entry.run { onOpenPane(run) }
        }
      case .wake:
        Button(ChatWords.wake) { onWake(entry.spark) }
      }
    }
  }
}
