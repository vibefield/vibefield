import FieldProduct
import Foundation
import Observation

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
    let next = of(spark).filter { $0.requestId != say.requestId } + [say]
    held[spark] = Array(next.suffix(Self.kept))
  }

  /// A send's answer: its receipt's state, or nil for a send not taken, whose bubble leaves.
  mutating func settle(_ spark: String, _ requestId: String, state: String?) {
    guard var list = held[spark], let index = list.firstIndex(where: { $0.requestId == requestId }) else { return }
    if let state {
      let say = list[index]
      list[index] = ChatPendingSay(requestId: say.requestId, text: say.text, chips: say.chips, at: say.at, state: state)
    } else {
      list.remove(at: index)
    }
    held[spark] = list.isEmpty ? nil : list
  }

  /// The record shows these sends: their bubbles are the record's now.
  mutating func letGo(_ spark: String, said: Set<String>) {
    guard let list = held[spark], list.contains(where: { said.contains($0.requestId) }) else { return }
    let next = list.filter { !said.contains($0.requestId) }
    held[spark] = next.isEmpty ? nil : next
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
    // the door's bound is counted as the Mac counts it: UTF-16 units (`COMPOSE_TEXT_MAX`)
    if text.utf16.count > SparkSay.wordsMax { return .tooLarge }
    deps.sending(requestId)
    if deps.needsWake {
      do {
        try await deps.wake()
      } catch {
        return .wakeRefused(reason(error))
      }
    }
    do {
      return .queued(try await deps.say(text, requestId))
    } catch {
      // its answer lost with the connection: asked once more by its id, which reads its receipt and never queues twice
      guard askAgain(error) else { return .failed(reason(error)) }
      do {
        return .queued(try await deps.say(text, requestId))
      } catch {
        return .failed(reason(error))
      }
    }
  }

  /// A retryable refusal is the connection's: the socket closed under the ask (the Mac's `askAgain`).
  static func askAgain(_ error: any Error) -> Bool {
    (error as? FieldProductError)?.retryable == true
  }

  /// A refusal in fieldd's words; anything else as itself.
  static func reason(_ error: any Error) -> String {
    (error as? FieldProductError)?.message ?? "\(error)"
  }
}

/// IOS-12f's M-f2 — an agent's menu in @'s box: the chip it chooses for, and where that chip stands in the draft.
struct ChatAgentMenu: Equatable, Sendable {
  let offset: Int
  let chip: ChatAgentChip
}

// MARK: - The words

/// The thread's words (§9 "Chat on the phone", and "Chat's words" by PC-L1), pure.
enum ChatThreadWords {
  static let openPane = "Open its pane"
  static let waking = "Waking…"

  /// Send's note: nothing once it is queued, since its bubble and its receipt say it; else why it was not taken.
  static func sendNote(_ outcome: ChatSendOutcome, name: String) -> String? {
    switch outcome {
    case .queued: nil
    case .tooLarge: "Not sent — a message holds 32,000 characters at most"
    case .wakeRefused(let reason): couldNotWake(name, reason)
    case .failed(let reason): "Couldn't send to \(name): \(reason)"
    }
  }

  /// A wake refused, in fieldd's words: said in the head's status place, in the attention ink.
  static func couldNotWake(_ name: String, _ reason: String) -> String { "Couldn't wake \(name): \(reason)" }

  /// The line under a draft held while its desktop is away (Q7, ruled 2026-11-06 09:35:20Z; §9).
  static func draftWaits(_ desktop: String, _ standing: ChatAway.Standing) -> String {
    switch standing {
    case .asleep: "Waits here until \(desktop) wakes"
    case .silent: "Waits here until \(desktop) answers"
    case .incompatible: "Waits here until \(desktop) is updated"
    }
  }

  /// Your bubble's accessible name: its words, then its receipt.
  static func bubble(_ text: String, receipt: ChatReceipt?) -> String {
    guard let receipt else { return text }
    return "\(text), \(receipt.words)"
  }

  /// The arrival pill (History's): "3 new ↓".
  static func arrival(_ count: Int) -> String { "\(count) new ↓" }
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
    var acts: [ChatThreadAct] = []
    if entry.run?.monitorRow.alive == true { acts.append(.openPane) }
    if !entry.awake { acts.append(.wake) }
    return acts
  }

  /// The head's end: Wake while it sleeps, else nothing (no Pause on the phone: a turn is paused in its pane).
  static func head(_ entry: SparkEntry) -> ChatThreadAct? {
    entry.awake ? nil : .wake
  }
}

// MARK: - Where the thread stands

enum ChatThreads {
  /// The thread on screen for the ledger: the open one while Chat is the page, else none (PC-L5).
  static func onScreen(tab: AppTab, thread: String?) -> String? {
    tab == .chat ? thread : nil
  }

  /// The spark's desktop away, as the list says it (`ChatAway.lines`): its own line, or, with no door, the home's,
  /// which stands for every desktop.
  static func away(of spark: SparkSummary, in lines: [ChatAway], connected: Bool) -> ChatAway? {
    guard connected else { return lines.first }
    guard let device = spark.device else { return nil }
    return lines.first { $0.device == device }
  }

  /// Each row as the page draws it, with an identity no other row shares: its key, or for the nth repeat of a key, the
  /// key and `#n`. The fold keys a row by its conversation's opening run and the line's seq, and each run numbers its
  /// lines from 1, so a conversation of two runs repeats keys (item 199, the Mac's fold too). Two rows of one identity
  /// would have the lazy stack draw one in the other's place and leave its own blank.
  static func drawn(_ items: [ChatFlowItem]) -> [ChatDrawnRow] {
    var seen: [String: Int] = [:]
    return items.map { item in
      let repeats = seen[item.key, default: 0]
      seen[item.key] = repeats + 1
      return ChatDrawnRow(id: repeats == 0 ? item.key : "\(item.key)#\(repeats)", item: item)
    }
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
    let keys = Set(items.map(\.key))
    defer {
      seen = keys
      started = true
    }
    guard started, !atFoot else {
      count = 0
      return
    }
    count += keys.subtracting(seen).count
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
  /// IOS-12f's M-f2 — the draft: its runs of words and the chips set into them (`ChatDraft`). The field draws these.
  var parts: [ChatDraftPart] = []
  /// Where the caret stands, counted as `ChatDraft` counts it; nil while the field holds none.
  var caret: Int?
  /// IOS-12f's M-f2 — the home's Agent Profiles, as @ last read them (each @ reads them again).
  private(set) var sets: ChatAtReading<[AgentProfileSet]> = .reading
  /// An agent's menu, standing in @'s box.
  private(set) var menu: ChatAgentMenu?
  /// Each agent's picker under a profile, as read (`agent.models`).
  private(set) var pickers: [String: ModelsReading] = [:]
  /// The @ a tap outside folded, by its place in the draft, until the caret moves off it.
  private var folded: Int?

  @ObservationIgnored private var setsAsk = 0
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
    guard reader == nil, let made = feed.reader(spark: spark, device: device, whole: earlier, held: held) else {
      return
    }
    reader = made
    made.start()
  }

  /// The thread leaves: its reader closes, and its last reading is kept for the next open.
  func close() {
    guard let reader else { return }
    held = reader.reading
    reader.cancel()
    self.reader = nil
  }

  /// The home's door changed: the reader is asked again on the new one, the reading held drawn meanwhile.
  func redial(device: String?) {
    close()
    open(device: device)
  }

  /// "Earlier conversations (n)": every run is asked for, and they stand above in order.
  func showEarlier() {
    guard !earlier else { return }
    earlier = true
    reader?.readWhole()
  }

  /// The record moved: the sends it shows are the record's now.
  func settleRecord() {
    let said = ChatFlows.saidRequests(reading)
    guard !said.isEmpty else { return }
    feed.letGo(spark, said: said)
  }

  /// The flow's rows for `entry`, with your sends the record does not show yet.
  func flow(_ entry: SparkEntry, now: Int64) -> ChatFlow {
    ChatFlows.flow(
      spark: Self.facts(of: entry), reading: reading, pending: feed.sends.of(spark), earlier: earlier, now: now)
  }

  /// What the fold reads of `entry` (DEBUG: under the stills' `-vf-chat-case=`, its golden case's own facts).
  static func facts(of entry: SparkEntry) -> ChatFlowSpark {
    let facts = ChatFlowSpark(entry: entry)
    #if DEBUG
      if let staged = ChatFixtureDoor.caseFacts(over: facts) { return staged }
    #endif
    return facts
  }

  /// Send the draft (Return, or Send), or a starter's `words` (a press sends them, as the Mac's does, and the draft is
  /// untouched). Nothing is called while the thread is held, while the spark's desktop is away (Q7: the draft stays,
  /// and Send is not offered), or with no words. Answers what it came to, or nil.
  @discardableResult
  func send(_ entry: SparkEntry, away: ChatAway?, words: String? = nil) async -> ChatSendOutcome? {
    let sent = parts
    let message = words.map { ChatDraftMessage(text: $0, chips: []) } ?? ChatDraft.message(sent)
    let text = message.text
    let chips = message.chips
    guard !busy, away == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    busy = true
    sendNote = nil
    headNote = nil
    let id = requestId()
    let needsWake = !entry.awake
    let spark = entry.spark
    let at = ChatThread.iso(clock())
    let feed = self.feed
    let deps = ChatSend.Deps(
      needsWake: needsWake,
      wake: { try await feed.wake(spark) },
      say: { text, id in
        try await feed.say(
          SparkSayParams(
            spark: spark.id, text: text, requestId: id, device: spark.device, chips: chips.isEmpty ? nil : chips))
      },
      sending: { id in
        let say = ChatPendingSay(requestId: id, text: text, chips: chips, at: at, state: needsWake ? "waking" : nil)
        feed.stand(spark.id, say)
      })
    let outcome = await ChatSend.send(deps, text: text, requestId: id)
    busy = false
    if case .queued(let receipt) = outcome {
      feed.settle(spark.id, id, state: receipt.state)
      if words == nil { parts = ChatDraft.after(sent: sent, now: parts) }
    } else {
      feed.settle(spark.id, id, state: nil)
    }
    sendNote = ChatThreadWords.sendNote(outcome, name: spark.name)
    return outcome
  }

  /// The head's Wake (`compose.sparks.open`, the feed's one wake): it holds the thread as a send does, and a refusal is
  /// said in the head's status place until the next act.
  func wake(_ spark: SparkSummary) async {
    guard !busy else { return }
    busy = true
    waking = true
    headNote = nil
    do {
      try await feed.wake(spark)
    } catch {
      headNote = ChatThreadWords.couldNotWake(spark.name, ChatSend.reason(error))
    }
    waking = false
    busy = false
  }

  // MARK: IOS-12f's M-f2 — the draft and @ (DESIGN.md §8 "The phone's Chat")

  /// The draft's words alone.
  var draft: String {
    get { ChatDraft.typed(parts) }
    set { parts = ChatDraft.normalized([.text(newValue)]) }
  }

  /// Where the @ being typed stands in the draft, wherever the spark lives: the place the list follows.
  var atOffset: Int? { ChatDraft.place(parts, caret: caret)?.offset }

  /// The @ @'s list answers, or nil: only for a spark on the home (Q2: elsewhere an @ types as an @), and not one a
  /// tap outside folded.
  func atPlace(of spark: SparkSummary) -> ChatAtPlace? {
    guard feed.isHome(spark), let place = ChatDraft.place(parts, caret: caret), place.offset != folded else {
      return nil
    }
    return place
  }

  /// The caret moved on or off an @: a tap's fold holds only for the @ it folded.
  func atMoved() {
    if folded != atOffset { folded = nil }
  }

  /// A tap outside: the list or the menu folds, and what was typed stays.
  func foldAt() {
    menu = nil
    folded = atOffset
  }

  /// The home's Agent Profiles, read again. What was read stands while they are asked for.
  func readSets(on spark: SparkSummary) async {
    guard feed.isHome(spark) else { return }
    feed.wantLabels()
    setsAsk += 1
    let ask = setsAsk
    if case .failed = sets { sets = .reading }
    do {
      let read = try await feed.profileSets()
      if ask == setsAsk { sets = .read(read) }
    } catch {
      if ask == setsAsk { sets = .failed }
    }
  }

  static func atSpark(_ entry: SparkEntry) -> ChatAtSpark {
    ChatAtSpark(
      id: entry.spark.id, name: entry.spark.name, profiles: entry.spark.profiles, run: entry.run?.runtimeRunId)
  }

  /// @'s list for this @.
  func atList(_ place: ChatAtPlace, entry: SparkEntry) -> ChatAtList {
    ChatAt.list(
      spark: Self.atSpark(entry), query: place.query, sets: sets, board: feed.atBoard(of: entry.spark),
      labels: feed.labels)
  }

  /// The handles @ gives this spark's sessions, for the card that waits on you (empty until they are read).
  func handles(_ entry: SparkEntry) -> [String: String] {
    ChatAt.handles(spark: Self.atSpark(entry), board: feed.atBoard(of: entry.spark), sets: sets)
  }

  /// An agent's row taken: its chip stands where the @ was, and the list turns into its menu.
  func take(_ row: ChatAtAgentRow, at place: ChatAtPlace) async {
    let chip = ChatAgentChip(
      id: row.id, agent: row.agent, label: row.label, profile: row.profile, named: row.pill != nil)
    set(.agent(chip), at: place)
    menu = ChatAgentMenu(offset: place.offset, chip: chip)
    await readPicker(chip)
  }

  /// A session's row taken: its chip stands where the @ was, and the list folds with the caret past it.
  func take(_ row: ChatAtSessionRow, at place: ChatAtPlace) {
    set(
      .session(
        ChatSessionChip(
          id: row.id, session: row.session, agent: row.agent, label: row.label, handle: row.handle,
          project: row.project)),
      at: place)
  }

  private func set(_ chip: ChatDraftChip, at place: ChatAtPlace) {
    let end = place.at + 1 + place.query.utf16.count
    parts = ChatDraft.splice(parts, index: place.index, start: place.at, end: end, chip: chip)
    caret = place.offset + 2
  }

  /// A tap on an agent's chip opens its menu again. A session's chip has none.
  func openMenu(at offset: Int) async {
    guard case .agent(let chip)? = ChatDraft.chip(parts, at: offset)?.chip else { return }
    menu = ChatAgentMenu(offset: offset, chip: chip)
    await readPicker(chip)
  }

  /// The draft moved: the menu stands only while its chip does.
  func partsMoved() {
    guard let menu else { return }
    if case .agent(let chip)? = ChatDraft.chip(parts, at: menu.offset)?.chip, chip == menu.chip { return }
    self.menu = nil
  }

  private static func pickerKey(_ chip: ChatAgentChip) -> String { "\(chip.agent)\u{1F}\(chip.profile.id)" }

  /// The agent's picker, read once per agent and profile; a read that failed is asked again the next time.
  private func readPicker(_ chip: ChatAgentChip) async {
    let key = Self.pickerKey(chip)
    if case .failed? = pickers[key] { pickers[key] = nil }
    guard pickers[key] == nil else { return }
    pickers[key] = .reading
    do {
      pickers[key] = .read(try await feed.models(provider: chip.agent, profileSet: chip.profile.id))
    } catch {
      pickers[key] = .failed(NewSparkSheet.words(error))
    }
  }

  private func model(_ id: String?, of chip: ChatAgentChip) -> AgentModelChoice? {
    guard case .read(let answer)? = pickers[Self.pickerKey(chip)] else { return nil }
    return answer.catalog?.models.first { $0.id == id }
  }

  /// The menu's rows: New spark's menu for the one agent.
  func menuRows(_ menu: ChatAgentMenu) -> [AgentMenuRow] {
    let chip = menu.chip
    return NewSpark.menu(
      [SparkAgent(id: chip.agent, label: chip.label, takes: true, why: nil)], chosen: chip.agent,
      picker: pickers[Self.pickerKey(chip)], selection: chip.model?.selection,
      under: chip.named ? chip.profile.name : nil)
  }

  /// Effort, under a chosen model that has one.
  func menuEffort(_ menu: ChatAgentMenu) -> EffortChoice? {
    let selection = menu.chip.model?.selection
    return NewSpark.effort(model(selection?.modelId, of: menu.chip), selection)
  }

  /// A model of the picker, or nil for the agent's own.
  func chooseModel(_ id: String?) {
    choose(id.map { AgentModelSelection(modelId: $0) })
  }

  func chooseEffort(_ value: String) {
    guard let chip = menu?.chip, let selection = chip.model?.selection,
      let control = model(selection.modelId, of: chip)?.effort
    else { return }
    var controls = selection.controls
    controls[control.id] = value
    choose(AgentModelSelection(modelId: selection.modelId, controls: controls, custom: selection.custom))
  }

  /// The chip takes the choice, in the draft and in the menu together.
  private func choose(_ selection: AgentModelSelection?) {
    guard let menu, let found = ChatDraft.chip(parts, at: menu.offset) else { return }
    var chip = menu.chip
    chip.model = selection.map {
      ChatChipModel(words: NewSpark.modelWords(model($0.modelId, of: chip), $0), selection: $0)
    }
    self.menu = ChatAgentMenu(offset: menu.offset, chip: chip)
    parts[found.index] = .chip(.agent(chip))
  }

  /// An ISO-8601 instant with milliseconds, as the record writes one.
  nonisolated static func iso(_ date: Date) -> String {
    date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
  }
}
