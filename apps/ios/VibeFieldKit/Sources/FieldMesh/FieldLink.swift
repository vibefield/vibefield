import FieldAgents
import FieldProduct
import Foundation
import Observation

/// One desktop the phone can hear, and how well.
public struct FieldDesktop: Identifiable, Sendable, Equatable {
  public enum State: Sendable, Equatable {
    /// The peer is on the mesh and nothing answered at its product door. Not a
    /// failure — a desktop that is asleep, or not serving its product surface —
    /// and a different fact from a door that refused.
    case noDoor
    case connecting
    case ready
    case reconnecting
    /// The door's own words.
    case failed(String)
    /// EL7 M1 — this peer has no address the mesh will vouch for, and why. A
    /// DIFFERENT fact from `noDoor`: there was nowhere to dial, rather than
    /// nobody at the place we dialed.
    case refusedDoor(String)
  }

  /// The mesh device id — truffle's durable ULID for this peer, learned at its
  /// hello (RFC 017 §8), and the key everything about this desktop is filed
  /// under: the client, the door board, the fold's rows.
  ///
  /// It is the SAME string fieldd calls its own `deviceId`: the daemon adopts
  /// the mesh identity over its local fallback (D30,
  /// `packages/fieldd/src/device-service.ts`), which is why `device.list`'s
  /// self row can confirm this value rather than introduce a second one.
  public let deviceId: String
  public let name: String
  public let platform: String
  public let state: State
  /// Where this desktop's rows are coming from right now.
  public let feed: FieldFeedSource
  /// TM-5a — whether this desktop publishes its terminal doors on the tailnet
  /// (`DeviceCapabilities.terminalMesh`, TM-2/MF-1l), carried through so a card
  /// can say a missing act's reason BEFORE the tap.
  ///
  /// Three values, not two. `true` = the doors are out and an attach has
  /// somewhere to go; `false` = this desktop said its doors are not published,
  /// which is a sentence a person can act on; `nil` = the desktop has not said
  /// (its `device.list` has not answered, or it is older than TM-2), which is
  /// not a refusal and must not be drawn as one.
  public let publishesTerminalDoors: Bool?
  /// UA-P-1d — the field subscription this desktop refused, in its own words.
  ///
  /// It used to go to `FieldLink.notes`, which no view reads, so a desktop
  /// whose door answered hello and then refused the board drew as "connected"
  /// over an empty field with the reason written nowhere. That is the blank
  /// design-00 forbids, and this is the field that carries it to the corner.
  public let fieldRefusal: String?

  public var id: String { deviceId }

  public init(
    deviceId: String, name: String, platform: String, state: State, feed: FieldFeedSource,
    publishesTerminalDoors: Bool? = nil, fieldRefusal: String? = nil
  ) {
    self.deviceId = deviceId
    self.name = name
    self.platform = platform
    self.state = state
    self.feed = feed
    self.publishesTerminalDoors = publishesTerminalDoors
    self.fieldRefusal = fieldRefusal
  }
}

/// Which leg of the hybrid a desktop's board arrived on (§5).
public enum FieldFeedSource: String, Sendable, Equatable {
  /// Nothing yet.
  case none
  /// `field.agents.v1` — the floor's own publication, no connection needed.
  /// DORMANT since UA-P-1b: no desktop publishes that slice. See
  /// `FieldStoreBus`.
  case store
  /// `agent.subscribe {projection: "field"}` over the door.
  case door
}

/// How often discovery asks a peer again (UA-P-1a).
///
/// The two intervals are the ruling's own distinction. A door that refused this
/// login is not going to change its mind on a thirty-second timer — but it CAN
/// change: a desktop links a login later, an account is switched, a person
/// finishes signing in — so the phone re-asks in MINUTES rather than never. A
/// door that did not answer is weather, and weather is asked about often.
public struct FieldDiscoverySchedule: Sendable, Equatable {
  /// After a 403, or a hello that granted nothing.
  public var notThisAccount: Duration
  /// After nothing answered.
  public var unreachable: Duration
  /// How often the sweep wakes to see whose deadline has passed. It probes
  /// nobody whose deadline has not.
  public var tick: Duration

  public init(
    notThisAccount: Duration = .seconds(300),
    unreachable: Duration = .seconds(30),
    tick: Duration = .seconds(10)
  ) {
    self.notThisAccount = notThisAccount
    self.unreachable = unreachable
    self.tick = tick
  }
}

/// The join (§10.3): the mesh, the doors on it, and the boards behind them, as
/// ONE field.
///
/// **UA-P-1a changed the first link of that chain (2026-09-15).** It used to be
/// `field.devices.v1` — every desktop on the tailnet published a slice naming
/// its capability URL, and this phone dialed every URL whose sender the mesh
/// vouched for. Under James's ruling (UA-P-D2) that store is not published at
/// all: a synced store reaches every node in the app's namespace, a namespace
/// is not an account, and until truffle can gate a store by login nothing
/// content-bearing rides the bus. So the shape now is:
///
///   the mesh node is up → truffle's peer list names every `truffle-vibefield-`
///   node → the phone BUILDS each peer's door address from the peer's own
///   MagicDNS name and the registry port → one plain request asks whether that
///   door admits this login → the doors that do get a `FieldProductClient`,
///   hello with NO token (WhoIs is the grant) → `agent.subscribe {projection:
///   "field"}` carries the board.
///
/// Nothing the phone dials is a string somebody else wrote any more, and no
/// secret is on the wire for it to have read: the sidecar adds the capability
/// path on forward, and what admits this phone is its WhoIs login.
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
  /// THIS ACCOUNT'S desktops. A peer whose door refused this login is not here
  /// — it is somebody else's machine, which is an ordinary thing for a tailnet
  /// to contain and not a row this phone has any business drawing.
  public private(set) var desktops: [FieldDesktop] = []
  /// Bounded, deduplicated, never fatal.
  public private(set) var notes: [String] = []
  public private(set) var isPaused = false
  /// Peers with no address the mesh will vouch for, and why (EL7 M1). A peer
  /// here is on the mesh and there is nowhere to dial it.
  public private(set) var endpointRefusals: [String: String] = [:]
  /// UA-P-1a — peers whose door refused this login, by device id, with the
  /// reason. LOGGED AND NEVER DRAWN: these are other accounts' desktops, the
  /// count is a diagnostic, and a phone that drew them would be putting another
  /// person's machine in this person's corner.
  public private(set) var foreignDoors: [String: String] = [:]

  /// Whether anything at all is being heard. `false` with `desktops` non-empty
  /// is the honest "they are there and saying nothing" that a blank field must
  /// never be mistaken for.
  public var isHearing: Bool { desktops.contains { $0.feed != FieldFeedSource.none } }

  // MARK: The plumbing

  /// DORMANT since UA-P-1b (`FieldStoreBus`). Held, not deleted: UA-P-4 turns
  /// the bus back on once truffle gates a store by login, and these are the
  /// reader that has already passed its own kill matrix.
  @ObservationIgnored public let devices: FieldStore
  @ObservationIgnored public let boards: FieldStore
  @ObservationIgnored private let doors: FieldStoreDoors
  @ObservationIgnored private let transport: any ProductTransport
  @ObservationIgnored private let probe: any ProductDoorProbe
  @ObservationIgnored private let options: FieldProductClient.Options
  @ObservationIgnored private let schedule: FieldDiscoverySchedule
  @ObservationIgnored private let storeBus: Bool
  @ObservationIgnored private let now: @MainActor () -> Date
  /// This node's own tailnet domain, so a peer's FQDN can be BUILT rather than
  /// guessed at, and the built address still held to the peer (EL7 M1).
  @ObservationIgnored private let magicDNSSuffix: String?

  @ObservationIgnored private var clients: [String: FieldProductClient] = [:]
  @ObservationIgnored private var subscriptions: [String: ProductSubscription] = [:]
  @ObservationIgnored private var doorBoards: [String: DoorBoard] = [:]
  /// Devices with a subscribe in flight. Set synchronously, so a burst cannot
  /// walk past the slot that is only filled after the await.
  @ObservationIgnored private var arming: Set<String> = []
  /// One timer per live board, at its own `expiresAt`. Expiry is TIME, and the
  /// reconcile is edge-triggered — a publisher that goes quiet sends no edge,
  /// so without these the board stayed on the field and the door was never
  /// asked to replace it. Dormant with the bus (UA-P-1b); a door board has no
  /// expiry, because the socket carrying it is its own liveness.
  @ObservationIgnored private var expiryTimers: [String: Task<Void, Never>] = [:]
  @ObservationIgnored private var tracking = false
  @ObservationIgnored private var started = false

  // MARK: Discovery's own state (UA-P-1a)

  /// Every peer truffle has shown us, by durable device id, and what the door
  /// there last said.
  @ObservationIgnored private var found: [String: Found] = [:]
  @ObservationIgnored private var peerTask: Task<Void, Never>?
  @ObservationIgnored private var sweepTask: Task<Void, Never>?
  /// The sweep's latch, set synchronously — two overlapping sweeps would probe
  /// every peer twice and race each other's verdicts into the table.
  @ObservationIgnored private var sweeping = false

  private struct Found {
    var peer: FieldStorePeer
    /// The last verdict, or nil while the first probe is still out.
    var admission: DoorAdmission?
    /// When this peer may be asked again. `nil` = now.
    var askAgainAt: Date?
    var doorURL: URL?
    /// The desktop's own row, once `device.list` has answered.
    var info: DeviceInfo?
    /// The field subscription's refusal, in the door's words (UA-P-1d).
    var fieldRefusal: String?
  }

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
    probe: any ProductDoorProbe = URLSessionDoorProbe(),
    options: FieldProductClient.Options = .init(),
    magicDNSSuffix: String? = nil,
    schedule: FieldDiscoverySchedule = .init(),
    storeBus: Bool = FieldStoreBus.enabledByDefault,
    now: @escaping @MainActor () -> Date = { .now }
  ) {
    devices = FieldStore(doors: storeDoors)
    boards = FieldStore(doors: storeDoors)
    doors = storeDoors
    self.transport = transport
    self.probe = probe
    self.options = options
    self.magicDNSSuffix = magicDNSSuffix
    self.schedule = schedule
    self.storeBus = storeBus
    self.now = now
  }

  // MARK: Lifecycle

  /// Begin. Idempotent — a second call on a running link changes nothing.
  public func start() {
    guard !started else { return }
    started = true
    if storeBus {
      devices.subscribe(FieldStoreID.devices)
      boards.subscribe(FieldStoreID.agents)
      track()
    }
    watchPeers()
    startSweeping()
    reconcile()
  }

  /// The app went away (§5). The door's subscriptions go and discovery stops
  /// asking; the mesh NODE is left alone, and so are the clients — a WebSocket
  /// that survives a two-second app switch is one fewer hello when the user
  /// comes back, and the subscription is where the bytes were.
  public func pause() {
    guard started, !isPaused else { return }
    isPaused = true
    for (_, subscription) in subscriptions { subscription.cancel() }
    subscriptions.removeAll()
    for (_, timer) in expiryTimers { timer.cancel() }
    expiryTimers.removeAll()
    arming.removeAll()
    doorBoards.removeAll()
    sweepTask?.cancel()
    sweepTask = nil
    devices.pause()
    boards.pause()
    refold()
  }

  /// Back. Discovery sweeps afresh, every ready door re-subscribes for a FRESH
  /// snapshot (P5), and a peer whose deadline passed while the phone was away
  /// is asked again on the first sweep.
  public func resume() {
    guard started, isPaused else { return }
    isPaused = false
    devices.resume()
    boards.resume()
    startSweeping()
    // THE FIELD HAS TO COME BACK. `pause` cancelled every subscription and left
    // the CLIENTS open — a socket that survives a two-second app switch is one
    // fewer hello — so nothing about those clients changes on the way back and
    // the observation that arms a subscription never fires. Without this line
    // the sweep skips them too (an open door is not re-probed), and the phone
    // returned from the background to a permanently empty field behind a
    // desktop reading "connected".
    for deviceId in clients.keys { armDoorSubscription(deviceId) }
    reconcile()
  }

  public func stop() {
    started = false
    isPaused = false
    for (_, subscription) in subscriptions { subscription.cancel() }
    subscriptions.removeAll()
    for (_, client) in clients { client.close() }
    clients.removeAll()
    for (_, timer) in expiryTimers { timer.cancel() }
    expiryTimers.removeAll()
    peerTask?.cancel()
    peerTask = nil
    sweepTask?.cancel()
    sweepTask = nil
    arming.removeAll()
    doorBoards.removeAll()
    found.removeAll()
    devices.unsubscribe()
    boards.unsubscribe()
    desktops = []
    agents = []
    endpointRefusals = [:]
    foreignDoors = [:]
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
  /// of their own (IOS-4c's attach).
  public func client(for deviceId: String) -> FieldProductClient? { clients[deviceId] }

  /// TM-5 — a routed terminal ticket for one session on one desktop.
  ///
  /// This is the whole of the phone's attach authority: `terminal.openTicket`
  /// answers a WhoIs-verified SELF peer with the cell's TAILNET doors and two
  /// grants, and the grants are what the cell verifies. Nothing is cached — a
  /// mint is deliberately not idempotent, every leg replacement needs a fresh
  /// one (a transport grant's nonce is spent at first use), and a ticket held
  /// for later is a credential with no purpose.
  ///
  /// The answer comes back as the JSON the daemon sent, unread. FieldMesh knows
  /// how to ASK a door; what a ticket means belongs to the target that dials
  /// with it, and keeping that shape out of this signature is what keeps the
  /// field from learning what a terminal is.
  public func openTerminalTicket(on deviceId: String, sessionId: String) async throws -> JSONValue {
    guard let client = clients[deviceId] else {
      throw FieldProductError(
        kind: "UNAVAILABLE", message: "no connection to this desktop", retryable: true,
        details: .object([
          "service": .string("terminal"), "state": .string("no_door"),
        ]))
    }
    return try await client.call(
      "terminal.openTicket", params: .object(["sessionId": .string(sessionId)]))
  }

  /// IOS-4c — RESUME an ended run, over the desktop that owns it.
  ///
  /// The answer carries the NEW run, and this deliberately does not put it on
  /// the field: the board is the fold's to publish, and a row invented here
  /// would be a body the desktop has not agreed exists. The next snapshot or
  /// delta shows it, which is a beat later and true.
  @discardableResult
  public func resume(runtimeRunId: String, on deviceId: String) async throws -> JSONValue {
    guard let client = clients[deviceId] else {
      throw FieldProductError(
        kind: "UNAVAILABLE", message: "no door to \(deviceId)", retryable: false)
    }
    return try await client.call(
      "agent.resume", params: .object(["runtimeRunId": .string(runtimeRunId)]))
  }

  // RETIRED 2026-09-14 (TM-3, TM-D3): the grant (IOS-4d) —
  // `requestMirrorWriteGrant`, its `MirrorWriteGrant` outcome enum, the
  // `.automatic`/`.deliberate` asker, the once-per-connection latch and
  // `hasAskedForGrant`. The door it called is deleted on the desktop. Since
  // TM-5 the right to type is a claim in the attach grant the ticket carries,
  // so this phone asks for nothing extra and holds nothing that outlives the
  // session it was minted for.

  // MARK: Discovery (UA-P-1a)

  /// truffle's peer list, as it changes. Every arrival and departure is an edge
  /// discovery acts on; the sweep below is the clock that covers everything an
  /// edge cannot say ("this peer's door was asleep, ask it again").
  private func watchPeers() {
    guard peerTask == nil else { return }
    peerTask = Task { @MainActor [weak self, doors] in
      let stream = await doors.peerEvents()
      for await event in stream {
        guard let self, !Task.isCancelled, self.started else { return }
        switch event {
        case .upsert:
          // Not applied from the event's own payload: `onlinePeers()` is the
          // whole truth and one list read is cheaper than keeping two copies
          // of it in agreement.
          self.sweepSoon()
        case .left(let peer):
          self.forget(peer)
        }
      }
    }
    sweepSoon()
  }

  private func startSweeping() {
    guard sweepTask == nil, started else { return }
    let interval = schedule.tick
    sweepTask = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        guard let self, self.started, !self.isPaused else { return }
        await self.sweep()
        try? await Task.sleep(for: interval)
      }
    }
  }

  private func sweepSoon() {
    Task { @MainActor [weak self] in await self?.sweep() }
  }

  /// A sweep asked for WHILE one is running, remembered rather than dropped.
  ///
  /// Without it a peer that arrived mid-sweep waited for the next tick — ten
  /// seconds on the product schedule — because the latch below turns a
  /// concurrent request away and nothing was left to say it had happened. The
  /// flag is one bit and it collapses a burst of arrivals into exactly one
  /// extra pass.
  @ObservationIgnored private var sweepAgain = false

  /// One discovery pass.
  ///
  /// Reads the peer list, drops what has gone, and asks every peer whose
  /// deadline has passed. Peers are probed CONCURRENTLY: a sweep that asked
  /// eight sleeping desktops one at a time would take the probe timeout times
  /// eight, and the last peer's verdict would be a minute stale before it was
  /// ever applied.
  private func sweep() async {
    guard started, !isPaused else { return }
    guard !sweeping else {
      sweepAgain = true
      return
    }
    sweeping = true
    defer {
      sweeping = false
      if sweepAgain {
        sweepAgain = false
        sweepSoon()
      }
    }

    let peers = await doors.onlinePeers()
    guard started, !isPaused else { return }

    var live: Set<String> = []
    var due: [(deviceId: String, url: URL)] = []
    let at = now()

    for peer in peers where peer.online {
      // A peer whose truffle hello has not completed has no durable id yet, so
      // there is nothing to file it under. It is not a state and not a
      // refusal — the next sweep sees it wearing one.
      guard let deviceId = peer.deviceId, !deviceId.isEmpty else { continue }
      live.insert(deviceId)

      var entry = found[deviceId] ?? Found(peer: peer)
      entry.peer = peer

      let verdict = peerProductDoorURL(
        hostname: peer.hostname, tailnetIPs: peer.tailnetIPs, magicDNSSuffix: magicDNSSuffix)
      switch verdict {
      case .refused(let reason):
        entry.doorURL = nil
        entry.admission = nil
        if endpointRefusals[deviceId] != reason {
          endpointRefusals[deviceId] = reason
          note("refused \(fallbackName(entry))'s door: \(reason)")
        }
        found[deviceId] = entry
        closeDoor(to: deviceId)
        continue
      case .ok(let url):
        endpointRefusals.removeValue(forKey: deviceId)
        entry.doorURL = url
      }

      found[deviceId] = entry
      // A desktop whose door is open and ready is answering; the socket is its
      // own liveness and there is nothing to ask. Its SUBSCRIPTION is still
      // worth re-arming — the call is idempotent and returns at once when one
      // is live — because a subscription can die without its client changing
      // state, and the sweep is the only thing that would notice.
      if clients[deviceId] != nil {
        armDoorSubscription(deviceId)
        continue
      }
      if let deadline = entry.askAgainAt, deadline > at { continue }
      if let url = entry.doorURL { due.append((deviceId, url)) }
    }

    for deviceId in found.keys where !live.contains(deviceId) {
      forget(deviceId: deviceId)
    }

    refreshDesktops()

    guard !due.isEmpty else { return }
    let probe = self.probe
    let outcomes = await withTaskGroup(of: (String, DoorProbeOutcome).self) { group in
      for item in due {
        let probeURL =
          FieldMeshContract.productDoorProbeURL(host: item.url.host ?? "") ?? item.url
        group.addTask { (item.deviceId, await probe.probe(probeURL)) }
      }
      var collected: [(String, DoorProbeOutcome)] = []
      for await outcome in group { collected.append(outcome) }
      return collected
    }
    guard started, !isPaused else { return }
    for (deviceId, outcome) in outcomes {
      apply(DoorPolicy.admission(for: outcome), to: deviceId)
    }
    refreshDesktops()
    refold()
  }

  /// One peer's verdict, recorded — and the door opened or left shut.
  private func apply(_ admission: DoorAdmission, to deviceId: String) {
    guard var entry = found[deviceId] else { return }
    entry.admission = admission
    switch admission {
    case .answering:
      entry.askAgainAt = nil
      foreignDoors.removeValue(forKey: deviceId)
      found[deviceId] = entry
      if let url = entry.doorURL { openDoor(to: deviceId, at: url) }
    case .notThisAccount(let reason):
      entry.askAgainAt = now().addingTimeInterval(seconds(schedule.notThisAccount))
      entry.info = nil
      entry.fieldRefusal = nil
      found[deviceId] = entry
      // Logged, never drawn (UA-P-1d). Somebody else's desktop on a shared
      // tailnet is not this phone's news, and a row for it would be a machine
      // in this person's corner that nothing on it can open.
      if foreignDoors[deviceId] != reason {
        foreignDoors[deviceId] = reason
        note("\(fallbackName(entry)) is not this account's desktop: \(reason)")
      }
      closeDoor(to: deviceId)
    case .unreachable(let reason):
      entry.askAgainAt = now().addingTimeInterval(seconds(schedule.unreachable))
      found[deviceId] = entry
      foreignDoors.removeValue(forKey: deviceId)
      _ = reason
      closeDoor(to: deviceId)
    }
  }

  /// A peer that left takes its door, its board and its verdict with it.
  private func forget(_ peer: FieldStorePeer) {
    guard let deviceId = peer.deviceId, !deviceId.isEmpty else { return }
    forget(deviceId: deviceId)
    refreshDesktops()
    refold()
  }

  private func forget(deviceId: String) {
    closeDoor(to: deviceId)
    found.removeValue(forKey: deviceId)
    endpointRefusals.removeValue(forKey: deviceId)
    foreignDoors.removeValue(forKey: deviceId)
  }

  private func seconds(_ duration: Duration) -> TimeInterval {
    let parts = duration.components
    return TimeInterval(parts.seconds) + TimeInterval(parts.attoseconds) / 1e18
  }

  // MARK: Reconciliation

  /// Re-arm observation of both stores. `withObservationTracking` fires once
  /// per change and must be re-armed, which is what the `Task` does — it also
  /// puts the work AFTER the mutation, so the reconcile sees the new value.
  ///
  /// DORMANT with the bus (UA-P-1b): with no store subscribed nothing mutates,
  /// so `start()` does not even arm it.
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

  /// Something changed: re-read what is known and refold the field.
  private func reconcile() {
    if storeBus {
      let (_, failures) = devices.decodeAll(DeviceInfo.self)
      for failure in failures { note("a device slice did not read: \(failure)") }
    }
    refreshDesktops()
    refold()
  }

  private func openDoor(to deviceId: String, at url: URL) {
    if let existing = clients[deviceId] {
      guard !existing.targets(url) else {
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
    expiryTimers.removeValue(forKey: deviceId)?.cancel()
    arming.remove(deviceId)
    doorBoards.removeValue(forKey: deviceId)
  }

  /// Watch one client's state so the chip is honest, the account verdict is
  /// re-read at every hello, and the door subscription is armed the moment one
  /// lands.
  private func trackClient(_ deviceId: String) {
    guard let client = clients[deviceId] else { return }
    withObservationTracking {
      _ = client.state
    } onChange: { [weak self] in
      Task { @MainActor in
        guard let self, self.started, self.clients[deviceId] === client else { return }
        // THE SECOND HALF OF THE ACCOUNT CHECK. The sidecar's allow-list is the
        // first and it refuses a stranger before fieldd sees the socket; this
        // is fieldd's own stored-login comparison, which answers a foreign
        // login with a hello that succeeds and grants NOTHING. The desktop lane
        // is removing that case under the same ruling — a desktop with no
        // stored login has no serve at all — and the phone reads it anyway,
        // because a face that assumes the other plane shipped is a face that
        // lies on the day it has not.
        if case .ready(let hello) = client.state,
          case .notThisAccount(let reason) = DoorPolicy.admission(
            forGrantedScopes: hello.grantedScopes)
        {
          self.apply(.notThisAccount(reason), to: deviceId)
          self.refreshDesktops()
          self.refold()
          return
        }
        self.armDoorSubscription(deviceId)
        self.askForDeviceRow(deviceId)
        self.refreshDesktops()
        self.refold()
        self.trackClient(deviceId)
      }
    }
  }

  /// The desktop's own row, once its door has answered.
  ///
  /// `device.list` has existed on this client and been called by nothing since
  /// IOS-4b: the name, the platform and the terminal-mesh capability all came
  /// from the `field.devices.v1` slice. With that store off (UA-P-1b) the door
  /// is where they live, and this is the one call that fetches them. Asked
  /// ONCE per connection — a roster does not change under a live socket often
  /// enough to poll, and a desktop that renames itself is a re-dial away.
  private func askForDeviceRow(_ deviceId: String) {
    guard let client = clients[deviceId], found[deviceId]?.info == nil else { return }
    guard case .ready = client.state else { return }
    Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        let result = try await client.call("device.list", as: DeviceListResult.self)
        guard self.started, self.clients[deviceId] === client else { return }
        for dropped in result.droppedRows {
          self.note("\(deviceId) sent a device row that did not read: \(dropped)")
        }
        // The daemon's OWN row, by its own `self` flag — not by matching the
        // durable id, because the two keyspaces agreeing is a property of the
        // floor (D30) rather than a rule this phone gets to assume.
        guard let own = result.devices.first(where: { $0.isSelf == true }) else {
          self.note("\(deviceId) named no device of its own")
          return
        }
        self.found[deviceId]?.info = own
        self.refreshDesktops()
      } catch {
        // Not a state: the desktop is open and answering, and what is missing
        // is a nicety (its own name and whether its terminal doors are out).
        // The peer's hostname stands in, and `publishesTerminalDoors` stays nil
        // — which is "it did not say" and is never drawn as a refusal.
        self.note("\(deviceId) did not answer device.list: \(MeshModel.shortReason(error))")
      }
    }
  }

  /// The board over the door.
  ///
  /// Since UA-P-1b this is the ONLY leg: the store that used to carry a board
  /// is not published. The store check below stays because the reader does —
  /// with the bus on (UA-P-4, or a test exercising the dormant path) a live
  /// slice still outranks a subscription, which is the hybrid §5 describes.
  ///
  /// Once open it STAYS open. A slice that expires and returns would otherwise
  /// tear the subscription down and build it up on the store's own heartbeat,
  /// and an idle board over the door costs nothing (§5: nothing changes,
  /// nothing is sent).
  private func armDoorSubscription(_ deviceId: String) {
    guard !isPaused, subscriptions[deviceId] == nil, let client = clients[deviceId] else {
      return
    }
    // The arming LATCH, set synchronously. `subscriptions[deviceId]` is only
    // assigned after the subscribe's await, so a burst of discovery edges
    // around hello walked past that check four times and opened four
    // subscriptions on one door — each streaming at 250 ms, all of them
    // fighting over one `doorBoards[deviceId].revision`, so every `since`
    // disagreed and every frame triggered a `resubscribe`. A self-sustaining
    // storm, on a metered radio.
    guard !arming.contains(deviceId) else { return }
    guard case .ready = client.state else { return }
    guard liveSlice(for: deviceId) == nil else { return }
    arming.insert(deviceId)

    Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.arming.remove(deviceId) }
      guard self.started, self.clients[deviceId] === client,
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
        // Re-checked AFTER the await, including the slot: whatever slipped
        // through is cancelled rather than overwritten. An overwritten handle
        // is a subscription nobody owns and the door keeps feeding.
        guard self.started, self.clients[deviceId] === client,
          self.subscriptions[deviceId] == nil
        else {
          subscription.cancel()
          return
        }
        self.subscriptions[deviceId] = subscription
        if self.found[deviceId]?.fieldRefusal != nil {
          self.found[deviceId]?.fieldRefusal = nil
          self.refreshDesktops()
        }
      } catch {
        // UA-P-1d — THIS REACHES A FACE. It used to go to `notes` alone, which
        // no view reads: a desktop whose door answered hello and then refused
        // the board drew as "connected" over an empty field, with the reason
        // written down in a place nothing renders. The corner says it now
        // (`MeshDisplay.linkLine`), and the note stays as the diagnostic.
        let reason = MeshModel.shortReason(error)
        self.note("\(deviceId) refused the field subscription: \(reason)")
        self.found[deviceId]?.fieldRefusal = reason
        self.refreshDesktops()
      }
    }
  }

  // MARK: The two legs

  /// DORMANT with the bus (UA-P-1b): with `field.agents.v1` unpublished this
  /// answers nil for every desktop, and the door is the only leg.
  private func liveSlice(for deviceId: String) -> AgentFieldSlice? {
    guard storeBus else { return nil }
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
      for dropped in snapshot.droppedRows {
        note("\(deviceId) sent a row that did not read: \(dropped)")
      }
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

  /// A board's own expiry, as a timer. Dormant with the bus (UA-P-1b).
  ///
  /// The reconcile is edge-triggered; expiry is a clock, and a desktop that
  /// stops publishing sends no mutation to notice. Without this the field kept
  /// drawing an expired board, `feed` still said `.store`, and the door — the
  /// leg that exists for exactly this — was never asked.
  private func armExpiry(for deviceId: String, at expiresAt: Int64) {
    expiryTimers[deviceId]?.cancel()
    let seconds = Double(expiresAt) / 1000 - now().timeIntervalSince1970
    guard seconds > 0 else { return }
    expiryTimers[deviceId] = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(seconds))
      guard let self, !Task.isCancelled, self.started else { return }
      self.expiryTimers[deviceId] = nil
      self.reconcile()
    }
  }

  private func refold() {
    var slices: [AgentFieldSlice] = []
    var doorOnly: [String] = []
    var known = Set(found.keys)
    if storeBus {
      known.formUnion(devices.slices.keys)
      known.formUnion(boards.slices.keys)
    }

    for deviceId in known.sorted() {
      if let slice = liveSlice(for: deviceId) {
        slices.append(slice)
        // Re-armed on every board, so a heartbeat that moves `expiresAt`
        // moves the timer with it.
        armExpiry(for: deviceId, at: slice.expiresAt)
      } else if doorBoards[deviceId] != nil {
        doorOnly.append(deviceId)
      }
    }

    let projection = projectAgentSlices(slices, now: now())
    var merged = projection.agents
    var seen = Set(merged.map(\.id))

    for deviceId in doorOnly {
      guard let board = doorBoards[deviceId] else { continue }
      let rows = board.order.compactMap { board.rows[$0] }
      let fromDoor = projectAgentField(rows: rows, device: deviceId)
      for agent in fromDoor.agents where !seen.contains(agent.id) {
        merged.append(agent)
        seen.insert(agent.id)
      }
    }

    agents = merged
    refreshFeeds(doorOnly: Set(doorOnly))
  }

  /// THIS ACCOUNT'S desktops, keyed by the durable device id.
  ///
  /// The key is truffle's durable id for the peer — the one the fold's rows
  /// carry, the one `clients` is filed under, and the one a card hands back to
  /// `client(for:)`. Everything here is keyed that way, and mixing it with the
  /// Tailscale routing id (which is what a send is addressed to, a different
  /// keyspace, RFC 017 §8) produced a desktop whose door was open and ready
  /// while its row said "dialing" forever and `client(for:)` answered nil.
  ///
  /// A peer whose door refused this login is deliberately ABSENT: it is not
  /// this account's desktop, and `foreignDoors` is where that fact is kept.
  private func refreshDesktops() {
    desktops = found.keys.sorted().compactMap { deviceId in
      guard let entry = found[deviceId] else { return nil }
      if case .notThisAccount = entry.admission { return nil }
      let row = describe(deviceId, entry)
      return FieldDesktop(
        deviceId: deviceId,
        name: row?.name.isEmpty == false ? row!.name : fallbackName(entry),
        platform: row?.platform ?? "",
        state: state(of: deviceId, entry: entry),
        feed: feed(of: deviceId),
        publishesTerminalDoors: row?.capabilities?.terminalMesh,
        fieldRefusal: entry.fieldRefusal)
    }
  }

  /// What this desktop says about itself.
  ///
  /// The DOOR's `device.list` first, because since UA-P-1b that is the only
  /// place these facts come from. The dormant store second and only while the
  /// bus is on (UA-P-4, or a test exercising the reader): a slice that is being
  /// published is the same row by another road, and reading it keeps the
  /// reader's own path whole rather than half-wired against the day it returns.
  private func describe(_ deviceId: String, _ entry: Found) -> DeviceInfo? {
    if let info = entry.info { return info }
    guard storeBus else { return nil }
    return try? devices.slices[deviceId]?.decode(DeviceInfo.self)
  }

  /// What to call a desktop before it has told us.
  ///
  /// The peer's slugged tailscale hostname stands in until `device.list`
  /// answers with the name its own user gave it. It is a real fact about that
  /// machine rather than a placeholder, which is what makes it safe to draw:
  /// a corner that said "unknown desktop" for a beat would be less true than
  /// one that says `studio`.
  private func fallbackName(_ entry: Found) -> String {
    if let hostname = entry.peer.hostname, !hostname.isEmpty { return hostname }
    return entry.peer.deviceId ?? entry.peer.id
  }

  private func refreshFeeds(doorOnly: Set<String>) {
    desktops = desktops.map { desktop in
      FieldDesktop(
        deviceId: desktop.deviceId, name: desktop.name, platform: desktop.platform,
        state: desktop.state, feed: feed(of: desktop.deviceId, doorOnly: doorOnly),
        publishesTerminalDoors: desktop.publishesTerminalDoors,
        fieldRefusal: desktop.fieldRefusal)
    }
  }

  private func state(of deviceId: String, entry: Found) -> FieldDesktop.State {
    if let refusal = endpointRefusals[deviceId] { return .refusedDoor(refusal) }
    guard let client = clients[deviceId] else {
      // No client: either the door has not been asked yet, or it did not
      // answer. Both draw as `noDoor` — "on the mesh, not serving its product
      // surface" — except the first beat after a peer arrives, which is
      // dialing.
      if entry.admission == nil { return .connecting }
      return .noDoor
    }
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
///
/// DORMANT since UA-P-1b (`FieldStoreBus`): under James's ruling of 2026-09-15
/// no desktop publishes either of these, and this phone subscribes to neither.
/// They stay because the reader does — UA-P-4 turns the bus back on once
/// truffle gates a store by the login identity.
///
/// `terminal.v1.hosts` was listed here and NEVER SUBSCRIBED — the rows the
/// phone showed came from a live per-host `list-sessions`, not from the store,
/// which is a divergence the design doc recorded against this file and TM-5
/// closes by deletion. The store itself retired with the TSP1 adapter at TM-1
/// (TM-D5), and the join is discovery now: a fold row names the session, the
/// product door mints the ticket.
public enum FieldStoreID {
  public static let devices = "field.devices.v1"
  public static let agents = "field.agents.v1"
}
