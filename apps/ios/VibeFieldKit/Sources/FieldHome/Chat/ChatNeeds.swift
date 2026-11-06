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
  // IOS-12d's d3 skeleton: d4 brings the body.
  static func group(
    items: [NeedsItem], entries: [SparkEntry], answering: [String: ChatAnswering], reduced: Bool
  ) -> [NeedsCard] { [] }

  static func thread(_ entry: SparkEntry, answering: [String: ChatAnswering], reduced: Bool) -> NeedsCard? { nil }

  static func away(of item: NeedsItem, in lines: [ChatAway], connected: Bool) -> ChatAway? { nil }
}

enum ChatNeedsWords {
  // IOS-12d's d3 skeleton: d4 brings the body.
  static let group = ""
  static let answerInPane = ""
  static let paneMissing = ""

  static func asks(_ card: NeedsCard) -> String { "" }

  static func away(_ desktop: String, _ standing: ChatAway.Standing, device: DeviceWord) -> String { "" }

  static func pressed(_ word: String) -> String { word }
}
