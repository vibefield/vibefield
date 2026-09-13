import FieldAgents
import FieldProduct
import Foundation
import Observation

/// One desktop the phone can hear, and how well.
public struct FieldDesktop: Identifiable, Sendable, Equatable {
  public enum State: Sendable, Equatable {
    /// The device published a slice but no `productEndpoint.url`. Not a
    /// failure — a desktop that is not serving its product surface — and a
    /// different fact from a door that refused.
    case noDoor
    case connecting
    case ready
    case reconnecting
    /// The door's own words.
    case failed(String)
  }

  /// The mesh device id — the slice's key, and this row's identity.
  public let deviceId: String
  public let name: String
  public let platform: String
  public let state: State
  /// Where this desktop's rows are coming from right now.
  public let feed: FieldFeedSource

  public var id: String { deviceId }
}

/// Which leg of the hybrid a desktop's board arrived on (§5).
public enum FieldFeedSource: String, Sendable, Equatable {
  /// Nothing yet.
  case none
  /// `field.agents.v1` — the floor's own publication, no connection needed.
  case store
  /// `agent.subscribe {projection: "field"}` over the door.
  case door
}

/// The join (§10.3): the mesh, the devices store, the doors it names, and the
/// boards behind them, as ONE field.
///
/// The shape of it, in order: the mesh node is up → `field.devices.v1` names
/// the desktops and carries each one's capability URL → one `FieldProductClient`
/// per desktop that has one, hello with NO token (WhoIs is the grant) →
/// `field.agents.v1` carries every desktop's board, and where it does not, the
/// door's own `agent.subscribe {projection: "field"}` does.
///
/// It lives in FieldMesh, not FieldHome, for the reason `remoteSessionRows`
/// does: this is the one module that sees both the wire vocabulary and the
/// field's, so the projection that makes bubbles never learns a wire type, and
/// the whole join can be driven headless in tests with no simulator and no
/// tailnet.
@MainActor
@Observable
public final class FieldLink {
  // MARK: What a screen reads

  /// The field, folded from every live board. Ordered by device then by the
  /// board's own order — a field that reshuffled because a dictionary rehashed
  /// would respawn every body.
  public private(set) var agents: [AgentSnapshot] = []
  public private(set) var desktops: [FieldDesktop] = []
  /// Rows that exist and cannot be drawn, by the provider `kind` the wire used.
  /// An agent this build has no mark for is COUNTED and named rather than
  /// dressed as a vendor it is not — see `agentSnapshot(from:)`.
  public private(set) var undrawable: [String: Int] = [:]
  /// Bounded, deduplicated, never fatal.
  public private(set) var notes: [String] = []
  public private(set) var isPaused = false

  /// Whether anything at all is being heard. `false` with `desktops` non-empty
  /// is the honest "they are there and saying nothing" that a blank field must
  /// never be mistaken for.
  public var isHearing: Bool { desktops.contains { $0.feed != FieldFeedSource.none } }

  // MARK: The plumbing

  @ObservationIgnored public let devices: FieldStore
  @ObservationIgnored public let boards: FieldStore
  @ObservationIgnored private let transport: any ProductTransport
  @ObservationIgnored private let options: FieldProductClient.Options
  @ObservationIgnored private let now: @MainActor () -> Date

  @ObservationIgnored private var clients: [String: FieldProductClient] = [:]
  @ObservationIgnored private var subscriptions: [String: ProductSubscription] = [:]
  @ObservationIgnored private var doorBoards: [String: DoorBoard] = [:]
  @ObservationIgnored private var tracking = false
  @ObservationIgnored private var started = false

  /// One desktop's board as the door has told it: rows by run id, at a
  /// revision. A delta whose `since` is not this revision means a frame was
  /// lost, and the repair is to re-subscribe for a snapshot — the tolerant
  /// reader's own rule, with no ack protocol anywhere.
  private struct DoorBoard {
    var revision: Int64
    var rows: [String: AgentFieldRow]
    var order: [String]
  }

  public init(
    storeDoors: FieldStoreDoors,
    transport: any ProductTransport = URLSessionProductTransport(),
    options: FieldProductClient.Options = .init(),
    now: @escaping @MainActor () -> Date = { .now }
  ) {
    devices = FieldStore(doors: storeDoors)
    boards = FieldStore(doors: storeDoors)
    self.transport = transport
    self.options = options
    self.now = now
  }

  // MARK: Lifecycle

  /// Begin. Idempotent — a second call on a running link changes nothing.
  public func start() {
    guard !started else { return }
    started = true
    devices.subscribe(FieldStoreID.devices)
    boards.subscribe(FieldStoreID.agents)
    track()
    reconcile()
  }

  /// The app went away (§5). The door's subscriptions go and the stores stop
  /// listening; the mesh NODE is left alone, and so are the clients — a
  /// WebSocket that survives a two-second app switch is one fewer hello when
  /// the user comes back, and the subscription is where the bytes were.
  public func pause() {
    guard started, !isPaused else { return }
    isPaused = true
    for (_, subscription) in subscriptions { subscription.cancel() }
    subscriptions.removeAll()
    doorBoards.removeAll()
    devices.pause()
    boards.pause()
    refold()
  }

  /// Back. Every store re-`request`s its peers and every ready door
  /// re-subscribes, each for a FRESH snapshot (P5).
  public func resume() {
    guard started, isPaused else { return }
    isPaused = false
    devices.resume()
    boards.resume()
    reconcile()
  }

  public func stop() {
    started = false
    isPaused = false
    for (_, subscription) in subscriptions { subscription.cancel() }
    subscriptions.removeAll()
    for (_, client) in clients { client.close() }
    clients.removeAll()
    doorBoards.removeAll()
    devices.unsubscribe()
    boards.unsubscribe()
    desktops = []
    agents = []
    undrawable = [:]
  }

  // MARK: The card's one extra question

  /// The latest reply line for a run, asked only when a card opens.
  ///
  /// The field projection carries NO conversation content by design (§10.1),
  /// so this is the one door that fetches any — `agent.list`'s full row, on
  /// demand, for one run. A phone that streamed reply text for every body
  /// would be paying §5's whole budget for words nobody is reading.
  public func latestReply(runtimeRunId: String, on deviceId: String) async throws -> String? {
    guard let client = clients[deviceId] else {
      throw FieldProductError(
        kind: "UNAVAILABLE", message: "no door to \(deviceId)", retryable: false)
    }
    let result = try await client.call("agent.list", as: AgentListResult.self)
    return result.sessions.first { $0.runtimeRunId == runtimeRunId }?.lastAssistantMessage
  }

  /// The client for a desktop, for the surfaces that need to ask it something
  /// of their own (IOS-4c's attach, IOS-4d's grant).
  public func client(for deviceId: String) -> FieldProductClient? { clients[deviceId] }

  // MARK: Reconciliation

  /// Re-arm observation of both stores. `withObservationTracking` fires once
  /// per change and must be re-armed, which is what the `Task` does — it also
  /// puts the work AFTER the mutation, so the reconcile sees the new value.
  private func track() {
    guard !tracking else { return }
    tracking = true
    arm()
  }

  private func arm() {
    withObservationTracking {
      _ = devices.slices
      _ = boards.slices
    } onChange: { [weak self] in
      Task { @MainActor in
        guard let self, self.started else { return }
        self.reconcile()
        self.arm()
      }
    }
  }

  /// The devices store changed, or a board did: open the doors that are named,
  /// close the ones that are gone, and refold the field.
  private func reconcile() {
    let (rows, failures) = devices.decodeAll(DeviceInfo.self)
    for failure in failures { note("a device slice did not read: \(failure)") }

    var seen: Set<String> = []
    for (deviceId, device) in rows {
      seen.insert(deviceId)
      guard let url = device.productURL else {
        // Published, not serving. Nothing to dial, and that is a state rather
        // than a failure.
        closeDoor(to: deviceId)
        continue
      }
      openDoor(to: deviceId, at: url)
    }

    // A desktop that left the devices store takes its door with it.
    for deviceId in clients.keys where !seen.contains(deviceId) {
      closeDoor(to: deviceId)
    }

    refreshDesktops(rows.values)
    refold()
  }

  private func openDoor(to deviceId: String, at url: URL) {
    if let existing = clients[deviceId] {
      // The same desktop at a NEW url is a new door: a capability path is
      // minted per serve, and dialing the old one would be dialing a path that
      // no longer exists.
      guard existing.url != url else {
        armDoorSubscription(deviceId)
        return
      }
      closeDoor(to: deviceId)
    }
    let client = FieldProductClient(url: url, transport: transport, options: options)
    clients[deviceId] = client
    client.connect()
    trackClient(deviceId)
  }

  private func closeDoor(to deviceId: String) {
    subscriptions.removeValue(forKey: deviceId)?.cancel()
    clients.removeValue(forKey: deviceId)?.close()
    doorBoards.removeValue(forKey: deviceId)
  }

  /// Watch one client's state so the chip is honest and the door subscription
  /// is armed the moment hello lands.
  private func trackClient(_ deviceId: String) {
    guard let client = clients[deviceId] else { return }
    withObservationTracking {
      _ = client.state
    } onChange: { [weak self] in
      Task { @MainActor in
        guard let self, self.started, self.clients[deviceId] === client else { return }
        self.armDoorSubscription(deviceId)
        self.refreshDesktops(self.currentDevices())
        self.refold()
        self.trackClient(deviceId)
      }
    }
  }

  /// The hybrid's second leg (§5). The store is the first: when it carries a
  /// live slice for this desktop there is nothing to ask for. When it does not
  /// — the floor is not serving the terminal mesh, or has not published yet —
  /// the door answers instead.
  ///
  /// Once open it STAYS open. A slice that expires and returns would otherwise
  /// tear the subscription down and build it up on the store's own heartbeat,
  /// and an idle board over the door costs nothing (§5: nothing changes,
  /// nothing is sent).
  private func armDoorSubscription(_ deviceId: String) {
    guard !isPaused, subscriptions[deviceId] == nil, let client = clients[deviceId] else {
      return
    }
    guard case .ready = client.state else { return }
    guard liveSlice(for: deviceId) == nil else { return }

    Task { @MainActor [weak self] in
      guard let self, self.started, self.clients[deviceId] === client,
        self.subscriptions[deviceId] == nil
      else { return }
      do {
        let subscription = try await client.subscribe(
          "agent.subscribe",
          params: AgentSubscribeParams.phoneField.json,
          onSnapshot: { [weak self] payload in
            self?.applyDoorSnapshot(payload, from: deviceId)
          },
          onDelta: { [weak self] payload in
            self?.applyDoorDelta(payload, from: deviceId)
          })
        guard self.started, self.clients[deviceId] === client else {
          subscription.cancel()
          return
        }
        self.subscriptions[deviceId] = subscription
      } catch {
        self.note("\(deviceId) refused the field subscription: \(MeshModel.shortReason(error))")
      }
    }
  }

  // MARK: The two legs

  private func liveSlice(for deviceId: String) -> AgentFieldSlice? {
    guard let slice = boards.slices[deviceId] else { return nil }
    guard let board = try? slice.decode(AgentFieldSlice.self) else { return nil }
    return board.isExpired(at: now()) ? nil : board
  }

  private func applyDoorSnapshot(_ payload: JSONValue, from deviceId: String) {
    do {
      let snapshot = try AgentFieldSnapshot(json: payload)
      var rows: [String: AgentFieldRow] = [:]
      for row in snapshot.rows { rows[row.runtimeRunId] = row }
      doorBoards[deviceId] = DoorBoard(
        revision: snapshot.revision, rows: rows, order: snapshot.rows.map(\.runtimeRunId))
      for dropped in snapshot.droppedRows { note("\(deviceId) sent a row that did not read: \(dropped)") }
      refold()
    } catch {
      note("\(deviceId) sent a board that did not read: \(MeshModel.shortReason(error))")
    }
  }

  private func applyDoorDelta(_ payload: JSONValue, from deviceId: String) {
    guard let delta = try? AgentFieldDelta(json: payload) else {
      note("\(deviceId) sent a delta that did not read")
      return
    }
    guard var board = doorBoards[deviceId] else { return }
    guard delta.since == board.revision else {
      // A frame was lost. The repair is a fresh snapshot, asked for by
      // re-subscribing — there is no ack protocol and nothing to replay.
      note("\(deviceId) delta since \(delta.since) ≠ \(board.revision) — re-subscribing")
      resubscribe(deviceId)
      return
    }
    for id in delta.removed {
      board.rows.removeValue(forKey: id)
      board.order.removeAll { $0 == id }
    }
    for row in delta.upserts {
      if board.rows[row.runtimeRunId] == nil { board.order.append(row.runtimeRunId) }
      board.rows[row.runtimeRunId] = row
    }
    board.revision = delta.revision
    doorBoards[deviceId] = board
    refold()
  }

  private func resubscribe(_ deviceId: String) {
    subscriptions.removeValue(forKey: deviceId)?.cancel()
    doorBoards.removeValue(forKey: deviceId)
    armDoorSubscription(deviceId)
  }

  // MARK: The fold

  /// Every leg, merged into one field. The STORE wins where it has a live
  /// slice: it is the floor's own publication and needs no connection, and a
  /// desktop that publishes it is telling every phone at once.
  private func refold() {
    var slices: [AgentFieldSlice] = []
    var doorOnly: [String] = []
    let known = Set(devices.slices.keys).union(boards.slices.keys)

    for deviceId in known.sorted() {
      if let slice = liveSlice(for: deviceId) {
        slices.append(slice)
      } else if doorBoards[deviceId] != nil {
        doorOnly.append(deviceId)
      }
    }

    let projection = projectAgentSlices(slices, now: now())
    var merged = projection.agents
    var undrawn = projection.undrawable
    var seen = Set(merged.map(\.id))

    for deviceId in doorOnly {
      guard let board = doorBoards[deviceId] else { continue }
      let rows = board.order.compactMap { board.rows[$0] }
      let fromDoor = projectAgentField(rows: rows)
      for agent in fromDoor.agents where !seen.contains(agent.id) {
        merged.append(agent)
        seen.insert(agent.id)
      }
      for (kind, count) in fromDoor.undrawable { undrawn[kind, default: 0] += count }
    }

    agents = merged
    undrawable = undrawn
    refreshFeeds(doorOnly: Set(doorOnly))
  }

  /// The devices store, read. Named rather than spelled at each call site
  /// because `decodeAll` answers a labelled pair and `.values` on it is the
  /// PAIR's label, not the dictionary's — a collision that compiles nowhere
  /// useful and reads as if it should.
  private func currentDevices() -> [DeviceInfo] {
    Array(devices.decodeAll(DeviceInfo.self).values.values)
  }

  private func refreshDesktops(_ rows: some Collection<DeviceInfo>) {
    let byId = Dictionary(uniqueKeysWithValues: rows.map { ($0.deviceId, $0) })
    desktops = byId.keys.sorted().compactMap { deviceId in
      guard let device = byId[deviceId] else { return nil }
      return FieldDesktop(
        deviceId: deviceId,
        name: device.name,
        platform: device.platform,
        state: state(of: deviceId, hasURL: device.productURL != nil),
        feed: feed(of: deviceId))
    }
  }

  private func refreshFeeds(doorOnly: Set<String>) {
    desktops = desktops.map { desktop in
      FieldDesktop(
        deviceId: desktop.deviceId, name: desktop.name, platform: desktop.platform,
        state: desktop.state, feed: feed(of: desktop.deviceId, doorOnly: doorOnly))
    }
  }

  private func state(of deviceId: String, hasURL: Bool) -> FieldDesktop.State {
    guard hasURL else { return .noDoor }
    guard let client = clients[deviceId] else { return .connecting }
    switch client.state {
    case .off, .connecting: return .connecting
    case .ready: return .ready
    case .reconnecting: return .reconnecting
    case .failed(let error): return .failed(error.message)
    case .closed: return .noDoor
    }
  }

  private func feed(of deviceId: String, doorOnly: Set<String>? = nil) -> FieldFeedSource {
    if liveSlice(for: deviceId) != nil { return .store }
    if let doorOnly {
      return doorOnly.contains(deviceId) ? .door : FieldFeedSource.none
    }
    return doorBoards[deviceId] != nil ? .door : FieldFeedSource.none
  }

  private func note(_ line: String) {
    guard !notes.contains(line) else { return }
    notes.append(line)
    if notes.count > 32 { notes.removeFirst() }
  }
}

/// The store ids the phone reads, from the contracts' `STORES` registry — never
/// spelled at a call site.
public enum FieldStoreID {
  public static let devices = "field.devices.v1"
  public static let agents = "field.agents.v1"
  public static let terminalHosts = "terminal.v1.hosts"
}
