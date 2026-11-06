import Foundation

// SKELETON (M-c1's c2, red first): the types the rows read, and no fold — every word empty, every flow no rows.
// IOS-12c (M-c1; PC-L1, one Chat; DESIGN.md §8 "Chat's thread", §9 "Chat's words") — THE FLOW, AS DATA, on the phone:
// field-app's `transcriptItemsOf` (`packages/field-app/src/chat/transcript-items.ts`), ported line for line and held
// to the goldens that fold writes (`packages/field-app/test/fixtures/chat-flow/`, ChatFlowGoldenTests). Pure: Chat's
// reading of the spark, its record as the reader holds it (`SparkTranscriptReading`, SP-7a's M-b) and this phone's own
// sends the record does not show yet, in; the flow's rows, top to bottom, out. The latest conversation (its runs
// joined) is drawn, the earlier ones behind one row until asked for; your words with their chips and their receipt,
// its replies whole, its tools one line a turn by kind, VibeField's own acts, the hello while the spark is new and its
// conversation empty, Thinking… while its own run works, day lines, and the three honest lines. A word this build does
// not know draws no word of its own (the tolerant reader).
//
// The fold reads a spark as `ChatFlowSpark`: the nine facts the Mac's fold reads of its entry, and nothing else. Each
// plane derives them from its own entry; the phone's derivation is `ChatFlowSpark(entry:)`, below, with its one
// departure stated there.

/// What the flow reads of a spark (the Mac's `SparkEntry`, as `transcriptItemsOf` reads it).
public struct ChatFlowSpark: Sendable, Equatable {
  public let name: String
  public let seed: UInt32
  public let status: SparkStatus
  /// When its record says it first worked; nil when it says never, or nothing.
  public let turnedAt: String?
  /// NS-D4's "a new spark" (`sparkIsNew`): the hello stands while it is new and its conversation empty.
  public let isNew: Bool
  public let awake: Bool
  /// Its own run waits on you in its pane.
  public let blocked: Bool
  /// The needs-you queue holds an item of it.
  public let waiting: Bool
  /// Its own run is on the board, alive and at work.
  public let working: Bool

  public init(
    name: String, seed: UInt32, status: SparkStatus, turnedAt: String?, isNew: Bool, awake: Bool, blocked: Bool,
    waiting: Bool, working: Bool
  ) {
    self.name = name
    self.seed = seed
    self.status = status
    self.turnedAt = turnedAt
    self.isNew = isNew
    self.awake = awake
    self.blocked = blocked
    self.waiting = waiting
    self.working = working
  }

  /// The phone's reading of its own entry. `isNew` is `sparkIsNew` (`thread-items.ts`) on the remote cut, which
  /// carries no run `turnedAt`: with its own run on the board, the phone reads the record alone, where the Mac also
  /// takes the run's own word that it turned. The phone's hello stands until the record says it turned; the list is
  /// read again as the run's row appears, so the two agree once it is.
  public init(entry: SparkEntry) {
    self.init(
      name: entry.spark.name, seed: entry.spark.seed, status: entry.status, turnedAt: nil, isNew: false, awake: false,
      blocked: false, waiting: false, working: false)
  }

}

/// A send this phone made that the record does not show yet: drawn at the press, matched to its `you` line by its
/// request id. `state` is the say's receipt, nil until fieldd answers.
public struct ChatPendingSay: Sendable, Equatable {
  public let requestId: String
  public let text: String
  public let chips: [SparkTranscriptChip]
  /// When it was pressed (ISO).
  public let at: String
  public let state: String?

  public init(requestId: String, text: String, chips: [SparkTranscriptChip], at: String, state: String? = nil) {
    self.requestId = requestId
    self.text = text
    self.chips = chips
    self.at = at
    self.state = state
  }
}

/// A receipt under your bubble, in the phone's words (§9 "Chat on the phone"); `attention` draws it in the attention
/// ink.
public struct ChatReceipt: Sendable, Equatable {
  public let words: String
  public let attention: Bool

  public init(_ words: String, attention: Bool = false) {
    self.words = words
    self.attention = attention
  }
}

/// One tool of a turn's folded line: its kind's words and what it touched.
public struct ChatToolRow: Sendable, Equatable {
  public let words: String
  public let detail: String?
}

/// One starter of the hello: a job it offers, pressed to be sent as Send sends.
public struct ChatStarter: Sendable, Equatable {
  public enum Glyph: String, Sendable, Equatable {
    case agents, panes, duplicate
  }

  public let glyph: Glyph
  public let words: String
}

/// Which honest line: the record began after the spark first worked, a part written while VibeField restarted, or a
/// part the worker could not check.
public enum ChatHonest: String, Sendable, Equatable {
  case before, gap, dropped
}

/// One row of the flow (`FlowItem`). `lead`: its face leads the row (once per run of its rows).
public enum ChatFlowItem: Sendable, Equatable, Identifiable {
  case earlier(key: String, count: Int)
  case day(key: String, words: String)
  case honest(key: String, which: ChatHonest, words: String)
  case hello(key: String, seed: UInt32, status: SparkStatus, words: String, starters: [ChatStarter])
  case you(key: String, text: String, chips: [SparkTranscriptChip], receipt: ChatReceipt?)
  case reply(key: String, text: String, lead: Bool)
  case tools(key: String, words: String, rows: [ChatToolRow], lead: Bool)
  /// SP-1e2 — a crew's line names its crew: its card hangs under it, and a later line of the crew replaces it.
  case act(key: String, what: String, words: String, lead: Bool, crew: String?)
  case thinking(key: String, lead: Bool)

  public var id: String { key }

  public var key: String {
    switch self {
    case .earlier(let key, _), .day(let key, _), .honest(let key, _, _), .hello(let key, _, _, _, _),
      .you(let key, _, _, _), .reply(let key, _, _), .tools(let key, _, _, _), .act(let key, _, _, _, _),
      .thinking(let key, _):
      key
    }
  }

  /// Its face's rows: a reply, a quiet line or Thinking….
  var isTheSpark: Bool {
    switch self {
    case .reply, .tools, .act, .thinking: true
    default: false
    }
  }

  /// The row with its face leading or not.
  func leading(_ lead: Bool) -> ChatFlowItem {
    switch self {
    case .reply(let key, let text, _): .reply(key: key, text: text, lead: lead)
    case .tools(let key, let words, let rows, _): .tools(key: key, words: words, rows: rows, lead: lead)
    case .act(let key, let what, let words, _, let crew):
      .act(key: key, what: what, words: words, lead: lead, crew: crew)
    case .thinking(let key, _): .thinking(key: key, lead: lead)
    default: self
    }
  }
}

/// What the flow draws: its rows, or why there are none to draw yet.
public enum ChatFlow: Sendable, Equatable {
  case reading
  /// fieldd's words, and the desktop that said them when it named one.
  case unreadable(reason: String, device: String?)
  case ready([ChatFlowItem])
}

// MARK: - The words (§9 "Chat's words")

public enum ChatFlowWords {
  public static func reading(_ name: String) -> String { "" }
  public static func unreadable(_ name: String, _ reason: String) -> String { "" }
  public static func earlier(_ count: Int) -> String { "" }
  public static func conversation(_ date: String) -> String { "" }
  public static let thinking = ""
  public static func tools(_ count: Int) -> String { "" }
  public static func before(_ name: String) -> String { "" }
  public static func gap(_ name: String) -> String { "" }
  public static let dropped = ""
  public static let toolKinds: [(kind: String, words: String)] = []
  public static func tool(_ kind: String) -> String { "" }
  public static func act(_ what: String, _ text: String, _ name: String) -> String { "" }
  public static func chip(_ text: String, _ chip: SparkTranscriptChip) -> String { "" }
  public static func hello(_ name: String) -> String { "" }
  public static let starters: [ChatStarter] = []
  public static func day(at: Int64, now: Int64, locale: Locale, timeZone: TimeZone) -> String { "" }
}

// MARK: - The projection

public enum ChatFlows {
  public static let sayStates: [String] = []

  public static func receipt(_ state: String?, _ spark: ChatFlowSpark, last: Bool) -> ChatReceipt? { nil }

  public static func flow(
    spark: ChatFlowSpark, reading: SparkTranscriptReading, pending: [ChatPendingSay] = [], earlier: Bool = false,
    now: Int64, locale: Locale = .current, timeZone: TimeZone = .current
  ) -> ChatFlow {
    .ready([])
  }

  public static func saidRequests(_ reading: SparkTranscriptReading) -> Set<String> { [] }
}
