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

/// The door Chat reads through: the home's own client.
@MainActor
protocol ChatDoor: AnyObject {
  func call(_ method: String, params: JSONValue?) async throws -> JSONValue
  func watch(
    _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> any ChatWatch
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

  @ObservationIgnored private var door: (any ChatDoor)?
  @ObservationIgnored private var home: String?
  @ObservationIgnored private var sparkKey = ""
  @ObservationIgnored private var sparksAsk = 0
  @ObservationIgnored private var needsAsk = 0
  @ObservationIgnored private var needsAgain = false
  @ObservationIgnored private var needsInFlight = false
  @ObservationIgnored private var watches: [String: any ChatWatch] = [:]

  /// The home's door, handed over when it changes (nil: none, the last word stands).
  func attach(_ door: (any ChatDoor)?, home: String?) {
    if door === self.door, home == self.home { return }
    for watch in watches.values { watch.cancel() }
    watches = [:]
    self.door = door
    self.home = home
    sparksAsk += 1
    needsAsk += 1
    needsInFlight = false
    needsAgain = false
    if reading.connected != (door != nil) { reading.connected = door != nil }
    guard door != nil else { return }
    refresh()
    watchNeeds(device: nil)
  }

  /// The board moved: ask the list again when a spark's live run appeared or left.
  func board(_ rows: [AgentRemoteRow]) {
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
