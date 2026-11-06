import FieldProduct
import Foundation
import Observation

// IOS-12b — CHAT'S FEED on the phone (PC-L2, PC-L4; the Mac's `field-app/src/chat/sparks-feed.ts`). Every read rides
// the phone's home, its one door (DS-8): the sparks (`compose.sparks.list`) and the needs-you queue (`needs.list`),
// each asked with `scope: "mesh"`, so the home merges every self desktop's. Never on a timer — asked again:
//   · when a door is handed over (the home found, changed, or back from the background);
//   · when the board's live-spark key changes: a spark's run appears or leaves (the Mac's `boardSparksKey`; the remote
//     cut carries no `turnedAt`, so the phone's key is the live runs alone);
//   · when the queue moves: each `needs.subscribe` frame (one desktop's queue, whole) asks the merged list again;
//   · after a wake, whether it woke or not, since the record says what the door did.
// A desktop that did not answer the merge keeps its last word (PC-L4): its sparks and items are carried from the last
// reading that had them, said as asleep, never dropped as if it had none. Without a door the whole list is the last
// word.
// IOS-12d — an item is answered through the same door (`needs.answer`, by the act's place, carried by the home to the
// item's desktop), once for every window and device. What this phone answers is kept by item for the app's life, so
// the group and the thread stand the same card. The catalog's labels are the home's (`agent.catalog`, asked once per
// door when a card first names an agent; Q1, VF-PM 19:26Z).

/// The door Chat reads through: the home's own client.
@MainActor
protocol ChatDoor: AnyObject {
  func call(_ method: String, params: JSONValue?) async throws -> JSONValue
  func watch(
    _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> any ChatWatch
  /// IOS-12c — a reader of a spark's record through this door (SP-7a's, on the client's own transport). `device`: the
  /// desktop that keeps the spark; `held`: a reading already drawn, kept drawn while it reads again.
  func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader
}

/// A subscription Chat holds.
@MainActor
protocol ChatWatch: AnyObject {
  func cancel()
}

extension ProductSubscription: ChatWatch {}

extension FieldProductClient: ChatDoor {
  func watch(
    _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> any ChatWatch {
    try await subscribe(method, params: params, shape: .stream, onSnapshot: onFrame, onDelta: onFrame)
  }

  func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
    transcriptReader(spark: spark, device: device, whole: whole, held: held)
  }
}

/// What Chat knows: the last word of every desktop, and which of them did not answer this time.
struct ChatReading: Equatable {
  /// A door is handed over: the home answers for Chat now. Without one the whole list is the last word.
  var connected = false
  var sparks: [SparkSummary] = []
  var items: [NeedsItem] = []
  var desktops: [ComposeDesktop] = []
  /// The home has answered the sparks' list at least once.
  var heard = false
  /// …and the queue's: with both, a reading is whole (the note's first reading is no news).
  var needsHeard = false
  /// The last ask failed, in the door's words (logs and Diagnostics, never the page).
  var failure: String?

  /// The desktops whose rows are their last word: every one the merge says did not answer.
  var away: [String] { desktops.filter { $0.known != .answered }.map { $0.device } }

  /// PC-L4: the next list, with each desktop that did not answer carried from `previous`, in its place at the end.
  static func carry<Row>(
    _ previous: [Row], into next: [Row], desktops: [ComposeDesktop], device: (Row) -> String?
  ) -> [Row] {
    let away = Set(desktops.filter { $0.known != .answered }.map { $0.device })
    guard !away.isEmpty else { return next }
    let kept = previous.filter { row in device(row).map(away.contains) ?? false }
    let fresh = next.filter { row in !(device(row).map(away.contains) ?? false) }
    return fresh + kept
  }
}

@MainActor
@Observable
final class ChatFeed {
  private(set) var reading = ChatReading()
  /// IOS-12c — your sends the record does not show yet, per spark: the app's life, so a thread left and opened again
  /// finds them standing (the Mac's `pending-says.ts`).
  private(set) var sends = ChatSends()
  /// Moves each time a different door is handed over (or none): an open thread reads again on the new one.
  private(set) var doorTurn = 0
  /// IOS-12d — what this phone answers, by item (the Mac's `useNeedsCard`), for the app's life, written nowhere.
  private(set) var answering: [String: ChatAnswering] = [:]
  /// IOS-12d — answers that came back off screen and did not go as asked (Q4), oldest first: the note says each.
  private(set) var offScreen: [ChatOffScreen] = []
  /// IOS-12d — the catalog's labels by agent id, as the home's `agent.catalog` says them (Q1).
  private(set) var labels: [String: String] = [:]
  /// IOS-12d — where Chat's cards stand (HomeScreen says, d5; until then every card is taken as shown).
  private(set) var shown = ChatShown()
  /// How long a said or refused card holds; a test hands its own.
  @ObservationIgnored var pause: @MainActor (Duration) async -> Void = { try? await Task.sleep(for: $0) }

  @ObservationIgnored private var door: (any ChatDoor)?
  @ObservationIgnored private var home: String?
  @ObservationIgnored private var sparkKey = ""
  @ObservationIgnored private var sparksAsk = 0
  @ObservationIgnored private var needsAsk = 0
  @ObservationIgnored private var needsAgain = false
  @ObservationIgnored private var needsInFlight = false
  @ObservationIgnored private var watches: [String: any ChatWatch] = [:]
  /// The board's rows, as last handed over: Answer in its pane finds the asking run among them at the press.
  @ObservationIgnored private var rows: [AgentRemoteRow] = []
  @ObservationIgnored private var labelsAsked = false
  @ObservationIgnored private var offScreenSaid = 0

  /// The home's door, handed over when it changes (nil: none, the last word stands).
  func attach(_ door: (any ChatDoor)?, home: String?) {
    if door === self.door, home == self.home { return }
    if door !== self.door { doorTurn += 1 }
    for watch in watches.values { watch.cancel() }
    watches = [:]
    self.door = door
    self.home = home
    sparksAsk += 1
    needsAsk += 1
    needsInFlight = false
    needsAgain = false
    labelsAsked = false
    if reading.connected != (door != nil) { reading.connected = door != nil }
    guard door != nil else { return }
    refresh()
    watchNeeds(device: nil)
  }

  /// The board moved: ask the list again when a spark's live run appeared or left.
  func board(_ rows: [AgentRemoteRow]) {
    self.rows = rows
    let key = Self.liveSparkKey(rows)
    guard key != sparkKey else { return }
    sparkKey = key
    askSparks()
  }

  /// Both lists, now.
  func refresh() {
    askSparks()
    askNeeds()
  }

  /// Wake a spark on its desktop (`compose.sparks.open`, forwarded by the home); the list is asked again either way.
  func wake(_ spark: SparkSummary) async throws {
    guard let door else {
      throw FieldProductError(kind: "UNAVAILABLE", message: "no home answers for Chat", retryable: true)
    }
    defer { refresh() }
    _ = try await door.call(
      "compose.sparks.open", params: ComposeSparksOpenParams(spark: spark.id, device: spark.device).json)
  }

  /// IOS-12c — your words to a spark, through the home (`compose.sparks.say`, carried to its desktop): the receipt, or
  /// fieldd's refusal thrown (`retryable` when the connection closed under it).
  func say(_ params: SparkSayParams) async throws -> SparkSayResult {
    guard let door else {
      throw FieldProductError(kind: "UNAVAILABLE", message: "no home answers for Chat", retryable: true)
    }
    return try SparkSayResult(json: try await door.call(SparkSay.method, params: params.json))
  }

  // MARK: IOS-12d — what waits on you

  /// Answer an item by its act's place (`needs.answer`, carried to the item's desktop). One answer at a time to an
  /// item; a refused one may be answered again while its item still waits. The card stands from the press until
  /// fieldd's answer returns, whatever the queue says meanwhile, then says what it came to for a note's time.
  func press(_ item: NeedsItem, choice: Int, spark: String, names: NeedsNames) {
    guard let door else { return }
    if let prior = answering[item.id] {
      let waits = reading.items.contains { $0.id == item.id }
      guard case .refused = prior.act, waits else { return }
    }
    answering[item.id] = ChatAnswering(
      spark: spark, item: item, act: .busy(choice: choice), holds: true, names: names)
    let params = NeedsAnswerParams(item: item.id, choice: choice, device: item.device)
    Task { @MainActor [weak self] in
      do {
        let done = try NeedsAnswerResult(json: try await door.call(NeedsAnswerParams.method, params: params.json))
        self?.answered(item.id, spark: spark, done: done.item, choice: choice, names: names)
      } catch {
        self?.refused(item, spark: spark, reason: Self.words(of: error), names: names)
      }
    }
  }

  /// The run an agent's ask names, on the board now: Answer in its pane opens its session card.
  func run(_ runtimeRunId: String) -> AgentRemoteRow? {
    rows.first { $0.runtimeRunId == runtimeRunId }
  }

  /// The catalog's label for an agent, else nil (the card says its id until the home answers).
  func label(_ agent: String) -> String? { labels[agent] }

  /// Where Chat's cards stand now. A card that leaves the screen takes what it said with it; an answer still
  /// running stays, to stand again or to be said on the note.
  func show(page: Bool, thread: String?) {
    let next = ChatShown(page: page, thread: thread)
    guard next != shown else { return }
    shown = next
    let gone = answering.filter { _, held in
      if case .busy = held.act { return false }
      return !next.shows(held.spark)
    }
    for id in gone.keys { answering[id] = nil }
  }

  /// The note has said it.
  func heard(_ note: ChatOffScreen) {
    offScreen.removeAll { $0.id == note.id }
  }

  private func answered(_ id: String, spark: String, done: NeedsItem, choice: Int, names: NeedsNames) {
    askNeeds()
    guard shown.shows(spark) else {
      answering[id] = nil
      let said = NeedsCards.said(done, choice: choice, names: names)
      if said.tone != .done { tell(spark, said.text) }
      return
    }
    answering[id] = ChatAnswering(spark: spark, item: done, act: .said(choice: choice), holds: true, names: names)
    hold(id)
  }

  private func refused(_ item: NeedsItem, spark: String, reason: String, names: NeedsNames) {
    guard shown.shows(spark) else {
      answering[item.id] = nil
      tell(spark, NeedsCards.refused(reason))
      return
    }
    answering[item.id] = ChatAnswering(
      spark: spark, item: item, act: .refused(reason: reason), holds: true, names: names)
    hold(item.id)
  }

  /// A note's time over: what the card said stops holding it. It stays while its item still waits (a refused one, to
  /// be answered again), and leaves once its item does not. An answer pressed again meanwhile is left as it is.
  private func hold(_ id: String) {
    let act = answering[id]?.act
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.pause(.milliseconds(NeedsCards.saidMs))
      guard var held = self.answering[id], held.act == act else { return }
      held.holds = false
      self.answering[id] = self.reading.items.contains { $0.id == id } ? held : nil
    }
  }

  /// An answer whose note's time is over, and whose item has left the queue, is forgotten.
  private func prune() {
    let open = Set(reading.items.map(\.id))
    let gone = answering.filter { id, held in !held.holds && !open.contains(id) }
    for id in gone.keys { answering[id] = nil }
  }

  private func tell(_ spark: String, _ text: String) {
    offScreenSaid += 1
    offScreen.append(ChatOffScreen(id: offScreenSaid, spark: spark, text: text))
    if offScreen.count > 4 { offScreen.removeFirst(offScreen.count - 4) }
  }

  /// fieldd's words for a refusal, as the card says them.
  static func words(of error: Error) -> String {
    (error as? FieldProductError)?.message ?? "\(error)"
  }

  /// The catalog's labels, asked once per door when a card first names an agent.
  private func askLabels() {
    guard let door, !labelsAsked, reading.items.contains(where: { $0.agent != nil }) else { return }
    labelsAsked = true
    Task { @MainActor [weak self] in
      guard let answer = try? await door.call("agent.catalog", params: AgentCatalogParams.phone.json),
        let catalog = try? AgentCatalogResult(json: answer), let self, self.door === door
      else { return }
      let next = Dictionary(catalog.catalog.map { ($0.id, $0.label) }, uniquingKeysWith: { first, _ in first })
      if next != self.labels { self.labels = next }
    }
  }

  /// IOS-12c — a reader of a spark's record through the home's door; none with no door.
  func reader(
    spark: String, device: String?, whole: Bool, held: SparkTranscriptReading
  ) -> (any ChatThreadReader)? {
    door?.reader(spark: spark, device: device, whole: whole, held: held)
  }

  /// A send passed the phone's checks: its bubble stands.
  func stand(_ spark: String, _ say: ChatPendingSay) { sends.stand(spark, say) }

  /// A send's answer: its receipt's state, or nil for a send not taken.
  func settle(_ spark: String, _ requestId: String, state: String?) {
    sends.settle(spark, requestId, state: state)
  }

  /// The record shows these sends: their bubbles are the record's now. Nothing is written when nothing moves.
  func letGo(_ spark: String, said: Set<String>) {
    var next = sends
    next.letGo(spark, said: said)
    if next != sends { sends = next }
  }

  /// The sparks on the board with a live run, as one key (the Mac's `boardSparksKey`, without TU-1's mark).
  static func liveSparkKey(_ rows: [AgentRemoteRow]) -> String {
    Set(rows.filter { $0.monitorRow.alive }.compactMap { row in row.spark.map { "\(row.device)/\($0)" } })
      .sorted().joined(separator: " ")
  }

  private func askSparks() {
    guard let door else { return }
    sparksAsk += 1
    let ask = sparksAsk
    Task { @MainActor [weak self] in
      do {
        let list = try ComposeSparksList(
          json: try await door.call("compose.sparks.list", params: ComposeListParams.mesh.json))
        guard let self, ask == self.sparksAsk else { return }
        var next = self.reading
        next.sparks = ChatReading.carry(
          self.reading.sparks, into: list.sparks, desktops: list.desktops, device: { $0.device })
        next.desktops = list.desktops
        next.heard = true
        next.failure = nil
        if next != self.reading { self.reading = next }
        self.watchPeers(list.desktops)
      } catch {
        guard let self, ask == self.sparksAsk else { return }
        if self.reading.failure != "\(error)" { self.reading.failure = "\(error)" }
      }
    }
  }

  private func askNeeds() {
    guard let door else { return }
    if needsInFlight {
      needsAgain = true
      return
    }
    needsInFlight = true
    needsAsk += 1
    let ask = needsAsk
    Task { @MainActor [weak self] in
      let list: NeedsList?
      do {
        list = try NeedsList(json: try await door.call("needs.list", params: ComposeListParams.mesh.json))
      } catch {
        list = nil
      }
      guard let self, ask == self.needsAsk else { return }
      self.needsInFlight = false
      if let list {
        var next = self.reading
        next.items = ChatReading.carry(
          self.reading.items, into: list.items, desktops: list.desktops, device: { $0.device })
        next.needsHeard = true
        if next != self.reading { self.reading = next }
        self.prune()
        self.askLabels()
      }
      if self.needsAgain {
        self.needsAgain = false
        self.askNeeds()
      }
    }
  }

  /// The queue of one desktop, through the home (nil: the home's own): each frame asks the merged list again.
  private func watchNeeds(device: String?) {
    guard let door, watches[device ?? ""] == nil else { return }
    let params: JSONValue = device.map { .object(["device": .string($0)]) } ?? .object([:])
    Task { @MainActor [weak self] in
      let frame: @MainActor (JSONValue) -> Void = { [weak self] _ in self?.askNeeds() }
      guard let watch = try? await door.watch("needs.subscribe", params: params, onFrame: frame) else { return }
      guard let self, self.door === door, self.watches[device ?? ""] == nil else {
        watch.cancel()
        return
      }
      self.watches[device ?? ""] = watch
    }
  }

  /// Each other desktop that answered the merge: its queue watched through the home.
  private func watchPeers(_ desktops: [ComposeDesktop]) {
    for desktop in desktops where desktop.known == .answered && desktop.device != home {
      watchNeeds(device: desktop.device)
    }
  }
}
