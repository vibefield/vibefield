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
  /// How long what an answer came to stands on the card, and a refusal of an item no longer waiting: a note's time.
  public static let saidMs = 2_400
  /// Its way out: 180ms on plain ease, 4 down to 0, inert while it goes.
  public static let leaveMs = 180
  /// With reduced motion each way is a fade in place (M6).
  public static let fadeMs = 120

  /// The names `item` is said by, under @'s `handles` in its thread (by run id; none: fieldd's names alone).
  public static func names(of item: NeedsItem, handles: [String: String] = [:]) -> NeedsNames {
    let run = item.from.spark == nil ? item.from.session : nil
    return NeedsNames(
      from: run.flatMap { handles[$0] } ?? item.from.name,
      to: item.to.map { handles[$0.session] ?? $0.name })
  }

  /// An agent's ask from the spark's own run (TH-Q29 (a)).
  public static func isOwnAsk(_ item: NeedsItem, ownRuns: [String]) -> Bool {
    item.knownKind == .agentAsk && item.from.session.map(ownRuns.contains) == true
  }

  /// The card for `item` in a spark's thread: its first item waiting, or one this phone answers, which counts itself
  /// among what waits though fieldd has dropped it from the queue meanwhile.
  public static func card(
    _ reading: NeedsReading, item: NeedsItem, act: NeedsAct = .idle, leaving: Bool = false, reduced: Bool = false,
    handles: [String: String] = [:]
  ) -> NeedsCard {
    let waits = reading.items.contains { $0.id == item.id }
    let own = isOwnAsk(item, ownRuns: reading.ownRuns)
    return NeedsCard(
      item: item,
      // its own run asks as the spark, never by its run's title
      names: own ? NeedsNames(from: reading.name, to: nil) : names(of: item, handles: handles),
      spark: reading.spark, sparkName: reading.name, own: own, of: reading.items.count + (waits ? 0 : 1),
      waits: waits, act: act, leaving: leaving, reduced: reduced)
  }

  /// The card a thread stands while the phone answers none of its items: its own run's ask first, then the oldest
  /// waiting (CO-Q12 (b)); or none.
  public static func waiting(
    _ reading: NeedsReading, reduced: Bool = false, handles: [String: String] = [:]
  ) -> NeedsCard? {
    guard let first = reading.items.first(where: { isOwnAsk($0, ownRuns: reading.ownRuns) }) ?? reading.items.first
    else { return nil }
    return card(reading, item: first, reduced: reduced, handles: handles)
  }

  /// What the card says. `label`: the catalog's label for a held spawn's agent (a lookup, never a literal: R23b);
  /// nil, its id, as the Mac's `agentLabelOf` falls back.
  public static func words(_ card: NeedsCard, label: (String) -> String? = { _ in nil }) -> NeedsCardWords {
    let item = card.item
    let names = card.names
    let asker = names.from
    let word = SparkEntries.status(ofItem: item).word
    // its own run's ask is the spark's: the word alone (TH-Q29 (a))
    let other = !card.own && item.from.spark != card.spark
    let question = question(item, names, label: label)
    let kind = item.knownKind
    // the asker's own words, for the kinds whose question is not them
    let shown = kind == .question || kind == .agentAsk ? nil : item.words
    let more = kind == .heldSend && (item.count ?? 1) > 1 ? (item.count ?? 1) - 1 : 0
    // an agent's own ask is answered in its pane, never here (CP-L4, AR-6): Show alone, whatever it carries
    let choices = kind == .agentAsk ? [] : (item.choices ?? [])
    let acts = choices.enumerated().map { each in
      NeedsCardAct(choice: each.offset, word: each.element, primary: each.offset == 0)
    }
    let place = card.of > 1 ? "1 of \(card.of)" : nil
    let asked = "\(other ? "\(word), \(asker)" : word): \(question)"
    return NeedsCardWords(
      eyebrow: other ? "\(word) · \(asker)" : word, question: question, words: shown,
      more: more > 0 ? "and \(more) more" : nil, sub: sub(item, names), acts: acts,
      show: acts.isEmpty && item.from.session != nil, place: place, asked: asked,
      label: place.map { "\(asked), \($0)" } ?? asked)
  }

  /// What you are asked, by the item's kind.
  static func question(_ item: NeedsItem, _ names: NeedsNames, label: (String) -> String?) -> String {
    let asker = names.from
    switch item.knownKind {
    case .question:
      return item.words ?? "\(asker) needs you"
    case .heldSend:
      return names.to.map { "\(asker) wants to send to \($0)" } ?? "\(asker) needs you"
    case .heldSpawn:
      guard let agent = item.agent else { return "\(asker) wants another agent" }
      let folder = item.folder.map { " in \($0)" } ?? ""
      return "\(asker) wants another agent: \(label(agent) ?? agent)\(folder)"
    case .agentAsk:
      if item.ask == "permission" {
        return item.tool.map { "\(asker) asks to run \($0)" } ?? "\(asker) asks for your OK"
      }
      if item.ask == "question" { return "\(asker) has a question" }
      return "\(asker) needs you"
    default:
      return "\(asker) needs you"
    }
  }

  /// The sub, by the item's kind: how long a yes lasts, the cap, or where an agent's ask is answered.
  static func sub(_ item: NeedsItem, _ names: NeedsNames) -> String? {
    switch item.knownKind {
    case .heldSend: names.to.map { "Your yes lasts until \($0) ends." }
    case .heldSpawn: item.live.map { "\($0) of \(names.from)'s agents are running, the most a spark may run." }
    case .agentAsk: "Answer it in its pane."
    default: nil
    }
  }

  /// The line an answered card gives its acts to, and the note's words for it off screen: "You said Allow", then what
  /// the act came to where it did not go as asked, in fieldd's words. When both hold, the act's failure is said.
  public static func said(_ item: NeedsItem, choice: Int, names given: NeedsNames? = nil) -> NeedsSaid {
    let names = given ?? Self.names(of: item)
    let answer = item.answer
    let index = answer?.choice ?? choice
    let chosen = item.choices.flatMap { index >= 0 && index < $0.count ? $0[index] : nil } ?? ""
    var said = "You said \(chosen)"
    while let last = said.last, last.isWhitespace { said.removeLast() }
    let why = { (reason: String?) in reason.map { ": \($0)" } ?? "" }
    if answer?.outcome == "failed" {
      let failed =
        if item.knownKind == .heldSend, let to = names.to {
          "Couldn't send \(names.from)'s words to \(to)"
        } else if item.knownKind == .heldSpawn {
          "Couldn't start the agent"
        } else {
          "Couldn't finish it"
        }
      return NeedsSaid(text: "\(said) · \(failed)\(why(answer?.reason))", tone: .failed)
    }
    if answer?.told == false {
      return NeedsSaid(text: "\(said) · \(names.from) hears it when it wakes\(why(answer?.waits))", tone: .unheard)
    }
    return NeedsSaid(text: said, tone: .done)
  }

  /// A refused answer, said under the card's words: fieldd's words after the colon.
  public static func refused(_ reason: String) -> String {
    "Couldn't answer: \(reason)"
  }
}
