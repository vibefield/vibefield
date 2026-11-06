import Foundation

// IOS-12d (PC-D4 A, PC-L1; Q1 (a), VF-PM 2026-11-06 19:12Z; DESIGN.md §8 "Chat's thread", the needs-you card, and
// §8 "The phone's Chat", Needs you; §9 "The person's queue's words") — THE NEEDS-YOU CARD, AS DATA, on the phone: the
// Mac's `packages/field-app/src/chat/needs-card.ts`, ported, and held to the goldens its own functions write
// (`packages/field-app/test/needs-card-goldens.test.ts`, copied to `Tests/FieldProductTests/Fixtures/needs-card/`).
// Pure: what the card reads of a spark (its id and name, the runs that are its own session, its open items) and an
// item in, the card's facts and words out. Every act travels by its place among the item's acts, never by its word,
// so a rewording is no wire change. The phone has no @ handles until IOS-12f, so a session is named as fieldd names a
// run; the handles' road is kept for then.

/// What the card is doing: waiting on you, its answer running (the act pressed, by its place), refused in fieldd's
/// words, or answered here (the act pressed).
public enum NeedsAct: Sendable, Equatable {
  case idle
  case busy(choice: Int)
  case refused(reason: String)
  case said(choice: Int)

  /// The act pressed, while it runs or once it is said.
  public var pressed: Int? {
    switch self {
    case .busy(let choice), .said(let choice): choice
    case .idle, .refused: nil
    }
  }
}

/// How the card names who asks and whom a send is for (`NeedsNames`).
public struct NeedsNames: Sendable, Equatable {
  public let from: String
  /// A held send's session; nil where the item names none.
  public let to: String?

  public init(from: String, to: String?) {
    self.from = from
    self.to = to
  }
}

/// What the card reads of a spark: its id and name, the runs that are its own session, and its open items, oldest
/// first (the Mac's `SparkEntry`, as `needsCardOf` reads it).
public struct NeedsReading: Sendable, Equatable {
  public let spark: String
  public let name: String
  public let ownRuns: [String]
  public let items: [NeedsItem]

  public init(spark: String, name: String, ownRuns: [String], items: [NeedsItem]) {
    self.spark = spark
    self.name = name
    self.ownRuns = ownRuns
    self.items = items
  }

  /// A spark's entry, as Chat's list reads it.
  public init(_ entry: SparkEntry) {
    self.init(spark: entry.spark.id, name: entry.spark.name, ownRuns: entry.ownRuns, items: entry.items)
  }
}

/// The card (`NeedsCard`).
public struct NeedsCard: Sendable, Equatable, Identifiable {
  /// The queue's item it draws (answered here: the item fieldd handed back, with its answer).
  public let item: NeedsItem
  /// Who asks and whom a send is for, as the card says them.
  public let names: NeedsNames
  /// The spark whose thread shows it.
  public let spark: String
  public let sparkName: String
  /// Its own run's ask (TH-Q29 (a)): the spark asks, so the card names it by its name and its eyebrow is the word.
  public let own: Bool
  /// How many wait on you in its thread, this one with them: "1 of 3" when more than one.
  public let of: Int
  /// Its item still waits in the queue; one that has left answers nothing more.
  public let waits: Bool
  public let act: NeedsAct
  /// On its way out, inert.
  public let leaving: Bool
  /// The person asked for reduced motion: it fades in and out where it stands.
  public let reduced: Bool

  public var id: String { item.id }
}

/// One of the card's acts: its place among the item's acts, its word, and whether it is the first (primary).
public struct NeedsCardAct: Sendable, Equatable, Identifiable {
  public let choice: Int
  public let word: String
  public let primary: Bool

  public var id: Int { choice }
}

/// What the card says, row by row (`NeedsCardWords`).
public struct NeedsCardWords: Sendable, Equatable {
  /// The word Chat's row says for the item, then " · " and the asker when it is not the thread's spark.
  public let eyebrow: String
  public let question: String
  /// A held send's first held words, a held spawn's first task, an unknown kind's words, as fieldd hands them.
  public let words: String?
  /// "and 2 more"
  public let more: String?
  public let sub: String?
  /// The item's acts, by their place; none where it has nothing to answer here.
  public let acts: [NeedsCardAct]
  /// Show alone: an agent's own ask, answered in its pane (the phone says Answer in its pane, §9).
  public let show: Bool
  /// "1 of 3", when more than one waits.
  public let place: String?
  /// What it asks, as it is announced on arriving.
  public let asked: String
  /// Its accessible name: what it asks, then its place when more wait.
  public let label: String
}

/// What an answer given here came to: done, an act fieldd could not do, or one its spark has not heard yet.
public enum NeedsSaidTone: String, Sendable, Equatable {
  case done, failed, unheard
}

public struct NeedsSaid: Sendable, Equatable {
  public let text: String
  public let tone: NeedsSaidTone
}

public enum NeedsCards {
  // IOS-12d's d3 skeleton: d4 brings the body.
  public static let saidMs = 0
  public static let leaveMs = 0
  public static let fadeMs = 0

  public static func names(of item: NeedsItem, handles: [String: String] = [:]) -> NeedsNames {
    NeedsNames(from: "", to: nil)
  }

  public static func isOwnAsk(_ item: NeedsItem, ownRuns: [String]) -> Bool { false }

  public static func card(
    _ reading: NeedsReading, item: NeedsItem, act: NeedsAct = .idle, leaving: Bool = false, reduced: Bool = false,
    handles: [String: String] = [:]
  ) -> NeedsCard {
    NeedsCard(
      item: item, names: NeedsNames(from: "", to: nil), spark: reading.spark, sparkName: reading.name, own: false,
      of: 0, waits: false, act: act, leaving: leaving, reduced: reduced)
  }

  public static func waiting(
    _ reading: NeedsReading, reduced: Bool = false, handles: [String: String] = [:]
  ) -> NeedsCard? { nil }

  public static func words(_ card: NeedsCard, label: (String) -> String? = { _ in nil }) -> NeedsCardWords {
    NeedsCardWords(
      eyebrow: "", question: "", words: nil, more: nil, sub: nil, acts: [], show: false, place: nil, asked: "",
      label: "")
  }

  public static func said(_ item: NeedsItem, choice: Int, names given: NeedsNames? = nil) -> NeedsSaid {
    NeedsSaid(text: "", tone: .done)
  }

  public static func refused(_ reason: String) -> String { "" }
}
