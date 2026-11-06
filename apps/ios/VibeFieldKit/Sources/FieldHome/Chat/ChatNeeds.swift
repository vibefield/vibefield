import FieldDesign
import FieldProduct
import Foundation

// IOS-12d (PC-D4 A, PC-L1, PC-L3, PC-L4; VF-PM's rulings on its Q1–Q10, 2026-11-06 19:12Z; DESIGN.md §8 "The phone's
// Chat", Needs you and the thread's card; §9 "Chat on the phone") — WHAT WAITS ON YOU, on the phone: the cards the
// Needs you group and a thread stand, read from the home's merged queue and from what this phone answers. The Mac
// keeps one card standing per thread (`needs-card-stand.ts`); the phone has a group as well, so what it answers is
// kept by item in the feed (`ChatFeed.answering`), and both the group and the thread read it. Pure: the queue, the
// spark entries and the answers in; the cards, in their order, out.

/// One answer this phone gave, by its item (the Mac's `Answering`): its card stands for it whatever the queue says
/// meanwhile — from the press until fieldd's answer returns, and for a note's time after.
struct ChatAnswering: Equatable {
  let spark: String
  /// The item as pressed; answered, the item fieldd handed back with its answer.
  var item: NeedsItem
  /// Busy, refused or said.
  var act: NeedsAct
  /// It stands though its item no longer waits: while its answer runs, and for a note's time after it returns.
  var holds: Bool
  /// The names the card said as it was pressed: what returns off screen is said under them.
  let names: NeedsNames
}

/// What an answer came to once its card had left the screen, and did not go as asked (Q4): the note over the bar
/// says it, in the card's words.
struct ChatOffScreen: Equatable, Identifiable {
  let id: Int
  let spark: String
  let text: String
}

/// Where Chat's cards stand: Chat's page, and the thread shown on it. HomeScreen says it (IOS-12d's d5); until it
/// does, every card is taken as shown.
struct ChatShown: Equatable {
  var page = true
  var thread: String?

  /// A spark's cards are on screen: its thread is shown, or the list with its group is.
  func shows(_ spark: String) -> Bool { page && (thread == nil || thread == spark) }
}

enum ChatNeeds {
  /// The Needs you group (Q7): every open item with a spark, from every self desktop, and each this phone answers
  /// that still holds, oldest asked first; each card read under its spark's entry, or, for a spark the list does not
  /// hold, under the item's own asker. An item with no spark is a run you started: Field's, never Chat's.
  static func group(
    items: [NeedsItem], entries: [SparkEntry], answering: [String: ChatAnswering], reduced: Bool
  ) -> [NeedsCard] {
    let readings = Dictionary(
      entries.map { ($0.spark.id, NeedsReading($0)) }, uniquingKeysWith: { first, _ in first })
    var shown = items.filter { $0.spark != nil }
    let open = Set(shown.map(\.id))
    for held in answering.values.sorted(by: { $0.item.id < $1.item.id })
    where held.holds && !open.contains(held.item.id) {
      shown.append(held.item)
    }
    let ordered = shown.enumerated().sorted { a, b in
      a.element.asked != b.element.asked ? a.element.asked < b.element.asked : a.offset < b.offset
    }
    return ordered.map { each in
      let item = each.element
      let spark = item.spark ?? ""
      let reading =
        readings[spark]
        ?? NeedsReading(
          spark: spark, name: item.from.name, ownRuns: [], items: items.filter { $0.spark == spark })
      return card(reading, item: item, waiting: items, held: answering[item.id], reduced: reduced)
    }
  }

  /// The card a thread stands (the Mac's `wantedOf`): the one this phone answers, while it holds or its item still
  /// waits; else what waits first (its own run's ask, then the oldest).
  static func thread(_ entry: SparkEntry, answering: [String: ChatAnswering], reduced: Bool) -> NeedsCard? {
    let reading = NeedsReading(entry)
    let mine = answering.values.filter { $0.spark == entry.spark.id }.sorted { $0.item.asked < $1.item.asked }
    for held in mine {
      let waits = entry.items.contains { $0.id == held.item.id }
      if !waits && !held.holds { continue }
      return card(reading, item: held.item, waiting: entry.items, held: held, reduced: reduced)
    }
    return NeedsCards.waiting(reading, reduced: reduced)
  }

  /// One card: an answer said draws the item fieldd handed back; else the item as the queue says it now.
  private static func card(
    _ reading: NeedsReading, item: NeedsItem, waiting: [NeedsItem], held: ChatAnswering?, reduced: Bool
  ) -> NeedsCard {
    guard let held else { return NeedsCards.card(reading, item: item, reduced: reduced) }
    let now = waiting.first { $0.id == item.id }
    let drawn: NeedsItem
    if case .said = held.act {
      drawn = held.item
    } else {
      drawn = now ?? held.item
    }
    return NeedsCards.card(reading, item: drawn, act: held.act, reduced: reduced)
  }

  /// The desktop line a card stands under while its desktop is away (Q8; PC-L4), or nil while it answers. With no
  /// door the home answers for every desktop, so its one line stands for every card.
  static func away(of item: NeedsItem, in lines: [ChatAway], connected: Bool) -> ChatAway? {
    guard connected else { return lines.first }
    guard let device = item.device else { return nil }
    return lines.first { $0.device == device }
  }
}

/// The needs-you card's words on the phone (§9 "Chat on the phone"), where they are the phone's own: who asks, the
/// pane's act and its miss, and a card's desktop away. The rest are the Mac's card's (`NeedsCards`).
enum ChatNeedsWords {
  static let group = "Needs you"
  /// The pane's act (§9), where the Mac says Show.
  static let answerInPane = "Answer in its pane"
  /// Answer in its pane with no pane on the board (Q5; for James's eye).
  static let paneMissing = "Couldn't open its pane: it isn't on your field"

  /// The group's eyebrow (Q2): who asks.
  static func asks(_ card: NeedsCard) -> String { "\(card.names.from) asks" }

  /// A card whose desktop is away (Q8; the asleep line is §9's, the other two for James's eye). The device is named as
  /// its platform names it (`DeviceWord`).
  static func away(_ desktop: String, _ standing: ChatAway.Standing, device: DeviceWord) -> String {
    switch standing {
    case .asleep: "\(desktop) is asleep · answer when it wakes"
    case .silent: "\(desktop) isn't answering · answer when it answers"
    case .incompatible: "\(desktop) runs a build \(device.this) can't read · answer when it's updated"
    }
  }

  /// The pressed act's word while its answer runs: "Allow…".
  static func pressed(_ word: String) -> String { "\(word)…" }
}
