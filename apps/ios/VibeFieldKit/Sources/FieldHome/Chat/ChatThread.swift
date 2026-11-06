import FieldProduct
import Foundation
import Observation

// IOS-12c, r1's SKELETON: every body is inert, so the rows go red on their assertions; g1 writes the code.
// IOS-12c (PC-D2, PC-L1, PC-L2, PC-L4, PC-L5; DESIGN.md §8 "The phone's Chat" → the thread; §9 "Chat on the phone") —
// THE THREAD on the phone: a spark's own conversation, read through the home by SP-7a's reader (one per open thread),
// drawn by the Mac's own fold (`ChatFlows`, M-c1), and answered by your words through `compose.sparks.say` (IOS-12a).
// A send is the Mac's (`thread-send.ts`): its bubble stands at the press, a spark asleep is woken first through the
// feed's one wake, and a say whose answer was lost with its connection is asked once more with the SAME request id,
// which reads the first one's receipt and never queues the words twice. Your sends before the record has them are the
// feed's (`ChatSends`, the Mac's `pending-says.ts`), so a thread left and opened again finds them standing. While the
// spark's desktop is away the draft is held, never sent behind you (Q7): a send nobody pressed is not yours.

/// What a thread reads its record through: SP-7a's reader, or a test's script.
@MainActor
protocol ChatThreadReader: AnyObject {
  var reading: SparkTranscriptReading { get }
  func start()
  func readWhole()
  func reconnected()
  func cancel()
}

extension SparkTranscriptReader: ChatThreadReader {}

// MARK: - Your sends before the record has them

/// Your sends the record does not show yet, per spark: for the app's life and written nowhere (HN-D9's rule). A send's
/// bubble stands from the press until the record shows its `you` line (matched by its request id), with the say's
/// receipt once fieldd answers; a send not taken leaves none.
struct ChatSends: Equatable {
  /// The sends a thread holds at most: the newest, so a phone that sends all day keeps a bounded list.
  static let kept = 32

  private var held: [String: [ChatPendingSay]] = [:]

  /// The spark's sends the record does not show yet, oldest first.
  func of(_ spark: String) -> [ChatPendingSay] { held[spark] ?? [] }

  /// A send passed the phone's own checks: its bubble stands, newest last.
  mutating func stand(_ spark: String, _ say: ChatPendingSay) {
    _ = (spark, say)
  }

  /// A send's answer: its receipt's state, or nil for a send not taken, whose bubble leaves.
  mutating func settle(_ spark: String, _ requestId: String, state: String?) {
    _ = (spark, requestId, state)
  }

  /// The record shows these sends: their bubbles are the record's now.
  mutating func letGo(_ spark: String, said: Set<String>) {
    _ = (spark, said)
  }
}

// MARK: - One send

/// What one Send came to (`ThreadSendOutcome`).
enum ChatSendOutcome: Equatable {
  /// fieldd queued it: the receipt says the rest, under its bubble
  case queued(SparkSayResult)
  /// longer than the door takes (`SparkSay.wordsMax`, TH-Q34 (a))
  case tooLarge
  /// fieldd refused the wake, in its own words
  case wakeRefused(String)
  /// fieldd refused the say, or a step threw, in its own words: a send that breaks is never a blank
  case failed(String)
}

/// Send, the Mac's steps (`sendToThread`): checked, its bubble stood, woken first when it sleeps, then said, and asked
/// once more by its id when its answer was lost with the connection. Never throws: a step that throws is the outcome.
enum ChatSend {
  /// The world one Send reaches, lent by the thread.
  struct Deps {
    /// asleep, or not started: Send wakes it first
    let needsWake: Bool
    /// the feed's one wake: throws its refusal in fieldd's words
    let wake: @MainActor () async throws -> Void
    /// `compose.sparks.say` for the thread's spark: the receipt, or fieldd's refusal thrown (`retryable` when the
    /// connection closed under it)
    let say: @MainActor (_ text: String, _ requestId: String) async throws -> SparkSayResult
    /// the message passed the phone's own checks and goes to fieldd now: the thread stands its bubble
    let sending: @MainActor (_ requestId: String) -> Void
  }

  @MainActor
  static func send(_ deps: Deps, text: String, requestId: String) async -> ChatSendOutcome {
    _ = (deps, text, requestId)
    return .failed("skeleton")
  }

  /// A retryable refusal is the connection's: the socket closed under the ask (the Mac's `askAgain`).
  static func askAgain(_ error: any Error) -> Bool {
    (error as? FieldProductError)?.retryable == true
  }

  /// A refusal in fieldd's words; anything else as itself.
  static func reason(_ error: any Error) -> String {
    (error as? FieldProductError)?.message ?? "\(error)"
  }

  /// What is left in the draft once `sent` is queued (`draftAfterSend`): what it carried leaves, and what was typed
  /// after it meanwhile stays. A draft changed within what was sent stays whole.
  static func draftAfter(sent: String, now: String) -> String {
    _ = sent
    return now
  }
}

// MARK: - The words

/// The thread's words (§9 "Chat on the phone", and "Chat's words" by PC-L1), pure.
enum ChatThreadWords {
  static let openPane = ""
  static let waking = ""

  /// Send's note: nothing once it is queued, since its bubble and its receipt say it; else why it was not taken.
  static func sendNote(_ outcome: ChatSendOutcome, name: String) -> String? {
    _ = (outcome, name)
    return nil
  }

  /// A wake refused, in fieldd's words: said in the head's status place, in the attention ink.
  static func couldNotWake(_ name: String, _ reason: String) -> String { "" }

  /// The line under a draft held while its desktop is away (Q7, ruled 2026-11-06 09:35:20Z; §9).
  static func draftWaits(_ desktop: String, _ standing: ChatAway.Standing) -> String {
    _ = (desktop, standing)
    return ""
  }

  /// Your bubble's accessible name: its words, then its receipt.
  static func bubble(_ text: String, receipt: ChatReceipt?) -> String {
    _ = receipt
    return text
  }

  /// The arrival pill (History's): "3 new ↓".
  static func arrival(_ count: Int) -> String { "" }
}

// MARK: - The acts

/// An act the thread's head and its ⋯, and the row's menu, offer.
enum ChatThreadAct: Hashable {
  /// Open its pane: the spark's own run's session card, which is the attach (FW-D2)
  case openPane
  /// Wake, while it sleeps (`compose.sparks.open`)
  case wake
}

enum ChatThreadActs {
  /// ⋯'s items and the row's menu, in §8's order: **Open its pane** while its own run is live on the board (a run that
  /// ended has no pane to open), then **Wake** while it sleeps. Put to sleep and Its profile join when the phone has
  /// their doors (Q6).
  static func menu(_ entry: SparkEntry) -> [ChatThreadAct] {
    _ = entry
    return []
  }

  /// The head's end: Wake while it sleeps, else nothing (no Pause on the phone: a turn is paused in its pane).
  static func head(_ entry: SparkEntry) -> ChatThreadAct? {
    _ = entry
    return nil
  }
}

// MARK: - Where the thread stands

enum ChatThreads {
  /// The thread on screen for the ledger: the open one while Chat is the page, else none (PC-L5).
  static func onScreen(tab: AppTab, thread: String?) -> String? {
    _ = (tab, thread)
    return nil
  }

  /// The spark's desktop away, as the list says it (`ChatAway.lines`): its own line, or, with no door, the home's,
  /// which stands for every desktop.
  static func away(of spark: SparkSummary, in lines: [ChatAway], connected: Bool) -> ChatAway? {
    _ = (spark, lines, connected)
    return nil
  }

  /// Each row as the page draws it, with an identity no other row shares.
  static func drawn(_ items: [ChatFlowItem]) -> [ChatDrawnRow] {
    items.map { ChatDrawnRow(id: $0.key, item: $0) }
  }
}

/// One row as the page draws it: the fold's row, and the identity the page gives it.
struct ChatDrawnRow: Identifiable, Equatable {
  let id: String
  let item: ChatFlowItem
}

/// The arrival pill's count (History's): rows that land while you read up the page. At the foot nothing is new; a row
/// redrawn in its place (a reply rewritten, a crew's line) is not.
struct ChatArrival: Equatable {
  private(set) var count = 0
  private var seen: Set<String> = []
  private var started = false

  mutating func read(_ items: [ChatFlowItem], atFoot: Bool) {
    _ = (items, atFoot, seen, started)
  }
}

// MARK: - One open thread

/// One thread on screen: its spark, its reader while it is open, its draft, and the act that holds it.
@MainActor
@Observable
final class ChatThread {
  let spark: String
  /// The reader while the thread is open and a door answers; nil before `open()`, after `close()`, and with no door.
  private(set) var reader: (any ChatThreadReader)?
  /// The last reading drawn: kept while the door changes, so the thread stands as it last said (PC-L4).
  private(set) var held: SparkTranscriptReading = .reading
  /// The earlier conversations are asked for.
  private(set) var earlier = false
  /// A send, or the head's Wake, holds the thread: one act at a time.
  private(set) var busy = false
  /// The head's Wake runs ("Waking…").
  private(set) var waking = false
  /// What the head says of its last act refused, in the attention ink, until the next act.
  private(set) var headNote: String?
  /// What the composer says of the last send not taken, until the next send.
  private(set) var sendNote: String?
  var draft = ""

  @ObservationIgnored private let feed: ChatFeed
  @ObservationIgnored private let requestId: () -> String
  @ObservationIgnored private let clock: () -> Date

  init(
    spark: String, feed: ChatFeed, requestId: @escaping () -> String = SparkSay.requestId,
    clock: @escaping () -> Date = Date.init
  ) {
    self.spark = spark
    self.feed = feed
    self.requestId = requestId
    self.clock = clock
  }

  /// What the flow draws now.
  var reading: SparkTranscriptReading { reader?.reading ?? held }

  /// Open the thread: ONE reader, asked of the home's door (SP-7a §9: the worker's sockets are shared). Again is a
  /// no-op; with no door nothing is read, and the away line says why.
  func open(device: String?) {
    _ = device
  }

  /// The thread leaves: its reader closes, and its last reading is kept for the next open.
  func close() {

  }

  /// The home's door changed: the reader is asked again on the new one, the reading held drawn meanwhile.
  func redial(device: String?) {
    _ = device
  }

  /// "Earlier conversations (n)": every run is asked for, and they stand above in order.
  func showEarlier() {

  }

  /// The record moved: the sends it shows are the record's now.
  func settleRecord() {

  }

  /// The flow's rows for `entry`, with your sends the record does not show yet.
  func flow(_ entry: SparkEntry, now: Int64) -> ChatFlow {
    _ = (entry, now, feed)
    return .reading
  }

  /// Send the draft (Return, or Send), or a starter's `words` (a press sends them, as the Mac's does, and the draft is
  /// untouched). Nothing is called while the thread is held, while the spark's desktop is away (Q7: the draft stays,
  /// and Send is not offered), or with no words. Answers what it came to, or nil.
  @discardableResult
  func send(_ entry: SparkEntry, away: ChatAway?, words: String? = nil) async -> ChatSendOutcome? {
    _ = (entry, away, words, requestId, clock)
    return nil
  }

  /// The head's Wake (`compose.sparks.open`, the feed's one wake): it holds the thread as a send does, and a refusal is
  /// said in the head's status place until the next act.
  func wake(_ spark: SparkSummary) async {
    _ = spark
  }

  /// An ISO-8601 instant with milliseconds, as the record writes one.
  nonisolated static func iso(_ date: Date) -> String {
    date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
  }
}
