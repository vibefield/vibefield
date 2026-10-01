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
  /// `nil` since UA-P-0e — a PEER row carries no platform, because a peer
  /// publishes nothing and its row is built from the tailnet's own facts. It is
  /// "this desktop did not say", never a platform, and nothing draws it.
  public let platform: String?
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
  /// IOS-8c — the user this desktop serves, as its door said at hello
  /// (`HelloAck.userId`, UA-2's ULID). Nil until the door has answered, or
  /// from a daemon that names none. It is the seed the corner's face is
  /// dealt from until the door carries the face itself (AP-D3).
  public let userId: String?

  public var id: String { deviceId }

  public init(
    deviceId: String, name: String, platform: String?, state: State, feed: FieldFeedSource,
    publishesTerminalDoors: Bool? = nil, fieldRefusal: String? = nil, userId: String? = nil
  ) {
    self.deviceId = deviceId
    self.name = name
    self.platform = platform
    self.state = state
    self.feed = feed
    self.publishesTerminalDoors = publishesTerminalDoors
    self.fieldRefusal = fieldRefusal
    self.userId = userId
  }
}

/// Which leg of the hybrid a desktop's board arrived on (§5).
public enum FieldFeedSource: String, Sendable, Equatable {
  /// Nothing yet.
  case none
  /// `field.agents.v1` — the floor's own publication, no connection needed.
  /// Dormant through UA-P-1b and live again under UA-P-5, on a gated node and
  /// for a door-confirmed device. See `FieldStoreBus`.
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
  /// SP-2 (c) — the width of each desktop's window on the way back from the
  /// background.
  public var resumeStagger: Duration

  public init(
    notThisAccount: Duration = .seconds(300),
    unreachable: Duration = .seconds(30),
    tick: Duration = .seconds(10),
    resumeStagger: Duration = .milliseconds(400)
  ) {
    self.notThisAccount = notThisAccount
    self.unreachable = unreachable
    self.tick = tick
    self.resumeStagger = resumeStagger
  }

  /// SP-2 (c) — when the desktop in `slot` comes back: `(slot + jitter) ×
  /// resumeStagger`, the jitter held inside [0, 1) so a window never reaches
  /// the next one's, whatever the source draws. Whole milliseconds, rounded
  /// down. Pure; pinned by tests.
  public func resumeDelay(slot: Int, jitter: Double) -> Duration {
    let parts = resumeStagger.components
    let staggerMs = parts.seconds * 1000 + parts.attoseconds / 1_000_000_000_000_000
    let inside = jitter.isFinite ? min(max(jitter, 0), 1) : 0
    // The window's own offset, in whole milliseconds and strictly inside it.
    // Computed apart from the slot on purpose: `1 + 1.0.nextDown` rounds to
    // exactly 2.0 in a Double, which put a maximal jitter on the NEXT window's
    // first millisecond (the pure row caught it).
    let within = min(Int64((inside * Double(staggerMs)).rounded(.down)), max(staggerMs - 1, 0))
    return .milliseconds(Int64(max(slot, 0)) * staggerMs + within)
  }

  /// SP-2 (e) — when a client the door STOPPED (`INCOMPATIBLE`, `UNAUTHORIZED`,
  /// `PRECONDITION_FAILED`) is replaced, after `retries` replacements already:
  /// the unreachable window, doubling, capped at the refusal window. Those
  /// refusals change in minutes — a desktop upgraded, a login linked — never in
  /// seconds, and never "not at all". Pure; pinned by tests.
  public func stuckClientRetry(after retries: Int) -> Duration {
    let doublings = min(max(retries, 0), 16)
    return min(unreachable * (1 << doublings), notThisAccount)
  }
}

/// SP-2 (c) — where the resume stagger's randomness and its waiting come from:
/// the system's, live; a script, in tests.
public struct FieldResumeTiming: Sendable {
  public var jitter: @Sendable () -> Double
  public var sleep: @Sendable (Duration) async -> Void

  public init(
    jitter: @escaping @Sendable () -> Double,
    sleep: @escaping @Sendable (Duration) async -> Void
  ) {
    self.jitter = jitter
    self.sleep = sleep
  }

  public static let live = FieldResumeTiming(
    jitter: { Double.random(in: 0..<1) },
    sleep: { try? await Task.sleep(for: $0) })
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
/// **UA-P-5 put the store back in front of it (2026-09-16), scoped.** truffle
/// gates a node by login now (RFC 025), so on a GATED node every store is this
/// account's by construction and the two slices are subscribed again. They do
/// not replace the chain above — they FUSE with it, by device id, and the door
/// keeps the last word: a slice for a device the probe has not confirmed is
/// held rather than drawn, because the gate says whose ACCOUNT a node is on
/// and the door says whether that desktop is serving this phone anything. On
/// an ungated node — the pre-login window — nothing is subscribed at all.
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
  /// UA-P-1a — peers this phone has established are not this account's, by
  /// device id, with the reason. LOGGED AND NEVER DRAWN: these are other
  /// accounts' desktops, the count is a diagnostic, and a phone that drew them
  /// would be putting another person's machine in this person's corner.
  ///
  /// **UA-P-5 narrowed what can land here, and kept the table.** Under a gated
  /// node it is empty by construction: truffle's Layer 3 filter reports only
  /// peers whose login matches the gate, so a stranger is never a peer and
  /// never gets probed. What still fills it is the PRE-LOGIN WINDOW — the one
  /// launch after a fresh sign-in, before this phone knows its own login and
  /// can gate on it — where the node is on the whole tailnet and the two
  /// verdicts below apply: a peer whose Layer 3 login differs from this node's
  /// (UA-P-5, and no socket is spent on it), or a door that answered 403 or
  /// granted nothing (UA-P-1a).
  ///
  /// So the optional "N other accounts' desktops on this tailnet" line KEEPS
  /// its fact rather than being deleted: it can still be non-zero, in exactly
  /// one window, and a count that is always zero afterwards is the honest
  /// report of a mesh that is finally scoped.
  public private(set) var foreignDoors: [String: String] = [:]

  /// AC-D9 — VibeField's agent catalog, as this phone's desktops have told it:
  /// every door's answer to `agent.catalog`, merged in device order, the first
  /// desktop's row kept where two name one agent. It is what a list on the
  /// phone reads (`phoneRoster`); the FIELD is named per desktop in the fold,
  /// each board by its own door's answer first.
  ///
  /// Empty is a state, never a breakage: nothing is connected yet, or every
  /// desktop is a build from before the door (it answers NOT_FOUND). The field
  /// draws exactly as it did then — every agent as its raw id and its letter.
  public private(set) var catalog: AgentCatalog = .empty

  /// Whether anything at all is being heard. `false` with `desktops` non-empty
  /// is the honest "they are there and saying nothing" that a blank field must
  /// never be mistaken for.
  public var isHearing: Bool { desktops.contains { $0.feed != FieldFeedSource.none } }

  // MARK: The plumbing

  /// The store reader. Dormant through UA-P-1b and LIVE AGAIN under UA-P-5 —
  /// but only on a GATED node (`storeBus` below): truffle now reports and
  /// admits by login (RFC 025), so every store on a gated node is scoped to
  /// this account by construction, which is the condition James's ruling set.
  @ObservationIgnored public let devices: FieldStore
  @ObservationIgnored public let boards: FieldStore
  @ObservationIgnored private let doors: FieldStoreDoors
  @ObservationIgnored private let transport: any ProductTransport
  @ObservationIgnored private let probe: any ProductDoorProbe
  @ObservationIgnored private let options: FieldProductClient.Options
  @ObservationIgnored private let schedule: FieldDiscoverySchedule
  /// UA-P-5 — whether this link may read the synced-store bus at all.
  ///
  /// It is the NODE'S GATE, passed in: true only where the running node's
  /// `loginAllow` is this account's login. A synced store reaches every node
  /// in the app's namespace, so on an ungated node — the pre-login window —
  /// the bus is the tailnet's whole audience and this stays false. There is no
  /// default that turns it on: `FieldLink(storeDoors:)` with nothing named
  /// reads no store.
  @ObservationIgnored private let storeBus: Bool
  @ObservationIgnored private let now: @MainActor () -> Date
  /// This node's own tailnet domain, so a peer's FQDN can be BUILT rather than
  /// guessed at, and the built address still held to the peer (EL7 M1).
  @ObservationIgnored private let magicDNSSuffix: String?
  /// UA-P-5 — this node's own tailnet login, so a peer can be told from a
  /// stranger by the thing that actually separates them (RFC 025 §3.6, D7).
  ///
  /// `nil` is the pre-login window: no account to compare against, so nothing
  /// is called foreign on this evidence and the door probe remains the sole
  /// witness, exactly as it was through UA-P-1a.
  @ObservationIgnored private let selfLogin: String?
  /// SP-2 (g) — the phone's connection budget every door this link opens
  /// counts against (one door per self desktop). The app passes the phone's one
  /// ledger; a link made with none gets its own.
  @ObservationIgnored public let budget: PhoneConnectionBudget
  @ObservationIgnored private let resumeTiming: FieldResumeTiming
  /// SP-2 (c) — each desktop's window on the way back from the background. A
  /// desktop with one pending is HELD: nothing re-subscribes it until it opens.
  @ObservationIgnored private var resumeSlots: [String: Task<Void, Never>] = [:]

  @ObservationIgnored private var clients: [String: FieldProductClient] = [:]
  @ObservationIgnored private var subscriptions: [String: ProductSubscription] = [:]
  @ObservationIgnored private var doorBoards: [String: DoorBoard] = [:]
  /// Devices with a subscribe in flight. Set synchronously, so a burst cannot
  /// walk past the slot that is only filled after the await.
  @ObservationIgnored private var arming: Set<String> = []
  /// AC-D9 — each door's own answer to `agent.catalog`, by device id, cached
  /// for the connection it arrived on and dropped with the door.
  @ObservationIgnored private var catalogs: [String: AgentCatalog] = [:]
  /// Devices whose CURRENT connection has been asked for its catalog. Set
  /// synchronously like `arming`, and cleared whenever the client leaves
  /// `ready`, so the next hello — a new connection — is asked afresh.
  @ObservationIgnored private var catalogAsked: Set<String> = []
  /// One timer per live board, at its own `expiresAt`. Expiry is TIME, and the
  /// reconcile is edge-triggered — a publisher that goes quiet sends no edge,
  /// so without these the board stayed on the field and the door was never
  /// asked to replace it. Live with the bus (UA-P-5); a door board has no
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
    /// IOS-8c — the user ULID the door answered hello with.
    var userId: String?
    /// SP-2 (e) — when the client the door STOPPED is replaced, and how many
    /// replacements it has had since one last reached `ready`.
    var stuckRetryAt: Date?
    var stuckRetries = 0
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
    // FAIL CLOSED, and deliberately not `FieldStoreBus.enabledByDefault`: that
    // flag says the bus EXISTS again, this parameter says this link's node is
    // gated, and only the caller holding the node can answer the second. A
    // default that read the flag would put an ungated link on the bus the
    // moment the flag flipped.
    storeBus: Bool = false,
    selfLogin: String? = nil,
    budget: PhoneConnectionBudget? = nil,
    resumeTiming: FieldResumeTiming = .live,
    now: @escaping @MainActor () -> Date = { .now }
  ) {
    self.budget = budget ?? PhoneConnectionBudget()
    self.resumeTiming = resumeTiming
    devices = FieldStore(doors: storeDoors)
    boards = FieldStore(doors: storeDoors)
    doors = storeDoors
    self.transport = transport
    self.probe = probe
    self.options = options
    self.magicDNSSuffix = magicDNSSuffix
    self.schedule = schedule
    self.storeBus = storeBus
    self.selfLogin = selfLogin
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
    // SP-2 (c) — the keepalive's clocks stop with the app: a deadline measured
    // across a suspension would call every door dead at once on the way back.
    for (_, client) in clients { client.pauseKeepalive() }
    for (_, slot) in resumeSlots { slot.cancel() }
    resumeSlots.removeAll()
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
    //
    // SP-2 (c) — and NEVER ALL AT ONCE (SP-L7). Each desktop comes back in its
    // own window, in device order, jittered inside it: its keepalive restarts
    // (a fresh deadline and one ping, which finds a socket that died while the
    // phone was away) and its board re-subscribes. Until its window opens it is
    // held — the sweep this resume starts arms nobody early.
    for (slot, deviceId) in clients.keys.sorted().enumerated() {
      let delay = schedule.resumeDelay(slot: slot, jitter: resumeTiming.jitter())
      let timing = resumeTiming
      resumeSlots[deviceId]?.cancel()
      resumeSlots[deviceId] = Task { @MainActor [weak self] in
        await timing.sleep(delay)
        guard let self, !Task.isCancelled, self.started, !self.isPaused else { return }
        self.resumeSlots[deviceId] = nil
        self.clients[deviceId]?.resumeKeepalive()
        self.armDoorSubscription(deviceId)
      }
    }
    reconcile()
  }

  public func stop() {
    started = false
    isPaused = false
    for (_, slot) in resumeSlots { slot.cancel() }
    resumeSlots.removeAll()
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
    catalogs.removeAll()
    catalogAsked.removeAll()
    catalog = .empty
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

  /// P0-C — renew a session's attach grant over the desktop that minted it:
  /// `terminal.renewAttach`, a CAS on the generation the phone holds and
  /// idempotent by `requestId` (spec §5.1). The same door and the same scope as
  /// the mint (`terminal.attach`, local to that desktop's fieldd), and the same
  /// rule as `openTerminalTicket`: the answer comes back unread, because what a
  /// grant means belongs to the target that carries it to the cell.
  public func renewTerminalGrant(
    on deviceId: String, sessionId: String, expectGeneration: Int64, requestId: String
  ) async throws -> JSONValue {
    guard let client = clients[deviceId] else {
      throw FieldProductError(
        kind: "UNAVAILABLE", message: "no connection to this desktop", retryable: true,
        details: .object([
          "service": .string("terminal"), "state": .string("no_door"),
        ]))
    }
    return try await client.call(
      "terminal.renewAttach",
      params: .object([
        "sessionId": .string(sessionId),
        "expectGeneration": .int(expectGeneration),
        "requestId": .string(requestId),
      ]))
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

      // UA-P-5 — the account boundary, BEFORE a socket is spent on it. Under a
      // gated node this never fires (Layer 3 reported only this account's
      // peers); in the pre-login window it is the whole of the saving.
      //
      // Asked on EVERY sweep rather than behind the re-ask deadline, and
      // deliberately: a login is a fact the peer row already carries, so it
      // costs nothing to re-read, and a peer whose login becomes ours — a
      // device transferred, a person finishing a sign-in — is picked up on the
      // next sweep instead of five minutes later.
      if let reason = Self.foreignLoginReason(peer: peer, selfLogin: selfLogin) {
        entry.doorURL = nil
        endpointRefusals.removeValue(forKey: deviceId)
        found[deviceId] = entry
        apply(.notThisAccount(reason), to: deviceId)
        continue
      }

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
      if let client = clients[deviceId], case .failed = client.state {
        // SP-2 (e) — THE STUCK CLIENT. A client stops for good on INCOMPATIBLE,
        // UNAUTHORIZED or PRECONDITION_FAILED (asking again with the same
        // version and the same absent token is told the same thing), and the
        // branch below never replaced an open client — so it stayed stopped
        // for the life of the link while its peer stayed online. Those answers
        // CAN change, so it is replaced on a backoff: closed, the door asked
        // again, and a fresh client dialled if the door still answers.
        // The ladder starts when the client STOPPED (`trackClient` stamps it);
        // the stamp here is only the belt for a stop no observation reported.
        var stuck = found[deviceId] ?? entry
        if stuck.stuckRetryAt == nil { stuck.stuckRetryAt = stuckRetryDeadline(stuck, from: at) }
        if let retryAt = stuck.stuckRetryAt, retryAt <= at {
          stuck.stuckRetries += 1
          stuck.stuckRetryAt = nil
          found[deviceId] = stuck
          closeDoor(to: deviceId)
          if let url = stuck.doorURL { due.append((deviceId, url)) }
        } else {
          found[deviceId] = stuck
        }
        continue
      }
      if let client = clients[deviceId] {
        // SP-2 (d) — the roster says this peer is online, so a client the
        // roster parked (asleep between two sweeps) dials now. Idempotent for
        // every other client: one with a socket, a dial or a re-dial in hand.
        client.connect()
        armDoorSubscription(deviceId)
        // The same clock for the catalog: a no-op once this connection has an
        // answer, and the retry for one a deadline or a dropped frame cost.
        askForCatalog(deviceId)
        continue
      }
      if let deadline = entry.askAgainAt, deadline > at { continue }
      if let url = entry.doorURL { due.append((deviceId, url)) }
    }

    var forgot = false
    for deviceId in found.keys where !live.contains(deviceId) {
      forget(deviceId: deviceId)
      forgot = true
    }

    refreshDesktops()
    // A desktop that dropped off the online list (a sleep: truffle says
    // `online: false`, never `left`) went through `closeDoor`, which dropped
    // its board and its catalog — the field must follow NOW, not at the next
    // probe's refold, which the early return below may never reach.
    if forgot { refold() }

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

  /// UA-P-5 — the account boundary as the tailnet itself states it.
  ///
  /// Both logins have to be KNOWN for this to answer. An absent PEER login is
  /// not a refusal — RFC 022's absent-never-fabricated rule, which RFC 024
  /// §8.1.2 applies by KEEPING an unattributable peer rather than evicting it
  /// — and an absent SELF login is the pre-login window, where this phone has
  /// no account to compare against. In both cases the door probe stays the
  /// witness, which is where the authority has been since UA-P-1a; this only
  /// ever ADDS a refusal the door would have reached more slowly and at the
  /// cost of a socket.
  static func foreignLoginReason(peer: FieldStorePeer, selfLogin: String?) -> String? {
    guard let selfLogin, !selfLogin.isEmpty else { return nil }
    guard let theirs = peer.loginName, !theirs.isEmpty else { return nil }
    guard !AccountGate.sameLogin(theirs, selfLogin) else { return nil }
    return "the tailnet says this device is signed in as \(theirs)"
  }

  /// UA-P-5 — whose slices this phone may draw. The DOOR decides, not the bus.
  ///
  /// The hole this closes was real and is not obvious. `refold` folds a board
  /// for every device id it knows about, while `refreshDesktops` drops a peer
  /// the door refused — so with the bus on, a FOREIGN desktop's board would
  /// have put bodies on this person's field while its own row was correctly
  /// hidden. Bodies with no desktop, from a machine the phone had already
  /// established is somebody else's.
  ///
  /// So the probe's verdict gates the slice, and the three verdicts are three
  /// different answers rather than two:
  ///
  /// - **no verdict yet** — held. Nothing has been established about this
  ///   device; one sweep later something has. A slice must never be the thing
  ///   that introduces a desktop, which is the shape UA-P-1a left behind.
  /// - **`notThisAccount`** — held, permanently and on purpose. This is the
  ///   case above: the door said this is not this account's machine, and the
  ///   bus is not a second opinion that overrides a door.
  /// - **`unreachable`** — DRAWN. The door is asleep and the peer is still one
  ///   truffle's gate admitted, so its slice is this account's by construction
  ///   (RFC 025 §3.1: every store on a gated node is scoped). Holding here
  ///   would use liveness as a stand-in for authorization and delete the store
  ///   leg's whole reason for existing — §5's hybrid is a board that arrives
  ///   with no connection needed, and a board that needs the connection open
  ///   anyway is just a slower door.
  private func sliceIsDrawable(_ deviceId: String) -> Bool {
    switch found[deviceId]?.admission {
    case .answering, .unreachable: true
    case .notThisAccount, nil: false
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
    if catalogs.removeValue(forKey: deviceId) != nil { mergeCatalogs() }
    found.removeValue(forKey: deviceId)
    endpointRefusals.removeValue(forKey: deviceId)
    foreignDoors.removeValue(forKey: deviceId)
  }

  /// SP-2 (e) — when a stopped client is next replaced, counted from `from`.
  private func stuckRetryDeadline(_ entry: Found, from: Date) -> Date {
    from.addingTimeInterval(seconds(schedule.stuckClientRetry(after: entry.stuckRetries)))
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
  /// Armed with the bus (UA-P-5): on an ungated node nothing is subscribed, so
  /// nothing mutates, and `start()` does not even arm it.
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
    // SP-2 (d) — the roster is asked before every dial this client makes, the
    // first and each re-dial: the tailnet's own peer list, read live, so a
    // desktop that went to sleep between two sweeps is not dialled in the gap.
    var options = self.options
    options.mayDial = { [doors] in
      await doors.onlinePeers().contains { $0.deviceId == deviceId && $0.online }
    }
    // SP-2 (h) — each subscription's bytes-per-second line names the desktop
    // it came from by its durable id; never by its door's URL.
    options.logLabel = deviceId
    // SP-2 (g) — one door per self desktop, held in the phone's ledger from the
    // dial to the close: a replacement waits for its predecessor's socket.
    options.doorBudget = ProductDoorBudget(ledger: budget, desktop: deviceId)
    let client = FieldProductClient(url: url, transport: transport, options: options)
    clients[deviceId] = client
    client.connect()
    trackClient(deviceId)
  }

  private func closeDoor(to deviceId: String) {
    resumeSlots.removeValue(forKey: deviceId)?.cancel()
    subscriptions.removeValue(forKey: deviceId)?.cancel()
    clients.removeValue(forKey: deviceId)?.close()
    expiryTimers.removeValue(forKey: deviceId)?.cancel()
    arming.remove(deviceId)
    doorBoards.removeValue(forKey: deviceId)
    // The desktop's catalog OUTLIVES its door: a closed door (a probe that
    // failed, a gated node) leaves that desktop's store-bus board drawn, and
    // the names on those bodies come from this catalog — dropping it here
    // turned "Claude Code" into "claude" until the door reopened. It is
    // re-asked when the door reopens (`catalogAsked` is cleared) and dropped
    // only when the desktop itself is forgotten (`forget(deviceId:)`).
    catalogAsked.remove(deviceId)
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
        if case .ready(let hello) = client.state {
          if case .notThisAccount(let reason) = DoorPolicy.admission(
            forGrantedScopes: hello.grantedScopes)
          {
            self.apply(.notThisAccount(reason), to: deviceId)
            self.refreshDesktops()
            self.refold()
            return
          }
          // IOS-8c — who this desktop serves. Decoded since UA-2 and read by
          // nothing until the corner needed a seed for the face.
          self.found[deviceId]?.userId = hello.userId
          // SP-2 (e) — a client that reached ready starts the stuck ladder over.
          self.found[deviceId]?.stuckRetries = 0
          self.found[deviceId]?.stuckRetryAt = nil
        }
        // SP-2 (e) — the door STOPPED this client: the replacement ladder starts
        // now, at the stop, not at whichever sweep happens to notice it.
        if case .failed = client.state, let entry = self.found[deviceId],
          entry.stuckRetryAt == nil
        {
          self.found[deviceId]?.stuckRetryAt = self.stuckRetryDeadline(entry, from: self.now())
        }
        self.armDoorSubscription(deviceId)
        self.askForDeviceRow(deviceId)
        self.askForCatalog(deviceId)
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

  /// AC-D9 — the desktop's agent catalog, asked once per CONNECTION.
  ///
  /// The desktop is the authority and this phone may be a build behind it, so
  /// an agent's name comes over the wire, never out of a table compiled in
  /// here. Asked at every hello — a desktop that was upgraded while the socket
  /// was down may have decided something new — kept until the next, and
  /// dropped with the door. The same door plumbing and the same posture as
  /// `device.list`: what is missing without it is a nicety, never a state.
  ///
  /// A desktop without the door — a build from before AC-3, which answers
  /// `NOT_FOUND` — is not a failure of anything: its agents are named by the
  /// label their field rows carry (the adapter's own word, from such a
  /// desktop) and lettered by their ids, and a note says why.
  /// A failure that asking again could fix (the door's own `retryable`: a
  /// deadline on a slow radio, a socket that dropped) keeps whatever the last
  /// connection said and is asked again on the sweep's clock; one that could
  /// not — the door refused, or answered something this build cannot read —
  /// leaves this desktop with no catalog and is not asked again on this
  /// connection.
  ///
  /// "A new connection" is one this link SAW the client leave `ready` for. A
  /// re-dial quick enough to go unobserved keeps the answer it has — the same
  /// desktop — and a desktop that was upgraded was gone for as long as its
  /// daemon took to restart, which the client spends `reconnecting`.
  private func askForCatalog(_ deviceId: String) {
    guard let client = clients[deviceId] else { return }
    guard case .ready = client.state else {
      catalogAsked.remove(deviceId)
      return
    }
    guard !catalogAsked.contains(deviceId) else { return }
    catalogAsked.insert(deviceId)
    Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        let result = try await client.call(
          "agent.catalog", params: AgentCatalogParams.phone.json, as: AgentCatalogResult.self)
        guard self.started, self.clients[deviceId] === client else { return }
        for dropped in result.droppedRows {
          self.note("\(deviceId) sent a catalog row that did not read: \(dropped)")
        }
        self.setCatalog(AgentCatalog(result), for: deviceId)
      } catch {
        guard self.started, self.clients[deviceId] === client else { return }
        if (error as? FieldProductError)?.retryable == true {
          self.catalogAsked.remove(deviceId)
          self.note(
            "\(deviceId) did not answer agent.catalog: \(MeshModel.shortReason(error)) — asking again")
        } else {
          self.setCatalog(nil, for: deviceId)
          self.note(
            "\(deviceId) has no agent catalog for this phone: \(MeshModel.shortReason(error))"
              + " — its agents are named by their rows")
        }
      }
    }
  }

  /// One door's catalog, recorded — and the field renamed by it.
  private func setCatalog(_ value: AgentCatalog?, for deviceId: String) {
    if let value {
      catalogs[deviceId] = value
    } else {
      catalogs.removeValue(forKey: deviceId)
    }
    mergeCatalogs()
    refold()
  }

  /// The phone's catalog: every door's, in device order, the first kept where
  /// two desktops name one agent. Assigned only when it changed, so a sweep
  /// that re-merges the same answer wakes nothing that observes it.
  private func mergeCatalogs() {
    let merged = catalogs.sorted { $0.key < $1.key }
      .reduce(AgentCatalog.empty) { $0.backed(by: $1.value) }
    if merged != catalog { catalog = merged }
  }

  /// The catalog one desktop's rows are named by: its OWN door's answer first,
  /// then what the phone's other desktops said (a desktop a build behind has no
  /// door, and its agents are the same agents), else nothing — the row's own
  /// label names the body then.
  private func desktopCatalog(for deviceId: String) -> AgentCatalog {
    guard let own = catalogs[deviceId] else { return catalog }
    return own.backed(by: catalog)
  }

  /// The board over the door.
  ///
  /// Through UA-P-1b this was the ONLY leg, because no desktop published a
  /// board. Under UA-P-5 the store came back on a gated node, and a live slice
  /// for a door-confirmed device used to OUTRANK the subscription — the door
  /// was not even asked while one was live.
  ///
  /// SP-2 (f), 2026-10-01 — reversed, because under SP-D3's trim the slice is
  /// PRESENCE and the door is the content (`thinking-sync-planes.md` §1.9 item
  /// 7): once the door has answered hello, it is subscribed whatever the bus
  /// holds, and the fold prefers its board (`refold`). The slice still draws
  /// a desktop whose door is asleep, and one whose board has not arrived yet.
  ///
  /// Once open it STAYS open. A slice that expires and returns would otherwise
  /// tear the subscription down and build it up on the store's own heartbeat,
  /// and an idle board over the door costs nothing (§5: nothing changes,
  /// nothing is sent).
  private func armDoorSubscription(_ deviceId: String) {
    guard !isPaused, subscriptions[deviceId] == nil, let client = clients[deviceId] else {
      return
    }
    // SP-2 (c) — held until its window on the way back opens.
    guard resumeSlots[deviceId] == nil else { return }
    // The arming LATCH, set synchronously. `subscriptions[deviceId]` is only
    // assigned after the subscribe's await, so a burst of discovery edges
    // around hello walked past that check four times and opened four
    // subscriptions on one door — each streaming at 250 ms, all of them
    // fighting over one `doorBoards[deviceId].revision`, so every `since`
    // disagreed and every frame triggered a `resubscribe`. A self-sustaining
    // storm, on a metered radio.
    guard !arming.contains(deviceId) else { return }
    guard case .ready = client.state else { return }
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
          // SP-2 (a) — the client's table keeps this board's cursor: a delta
          // that does not continue it never reaches `applyDoorDelta`, and the
          // repair (a fresh snapshot) is the table's. The cadence rides every
          // subscribe the table sends, replays included.
          shape: .snapshotDelta(minIntervalMs: AgentSubscribeParams.phoneField.minIntervalMs),
          onSnapshot: { [weak self] payload in
            self?.applyDoorSnapshot(payload, from: deviceId)
          },
          onDelta: { [weak self] payload in
            self?.applyDoorDelta(payload, from: deviceId)
          })
        // Re-checked AFTER the await, including the slot: whatever slipped
        // through is cancelled rather than overwritten. An overwritten handle
        // is a subscription nobody owns and the door keeps feeding.
        //
        // And the PAUSE (2026-10-01, found by SP-2 c's stagger row under
        // load): a subscribe asked before the app went away and answered after
        // it survived the pause — a backgrounded phone kept a live
        // subscription, and the resume could not re-arm the full slot.
        guard self.started, !self.isPaused, self.clients[deviceId] === client,
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

  /// The store leg (UA-P-5): live on a gated node, for a device whose door has
  /// not refused this phone. Both conditions, and the second is the one that
  /// is easy to lose — see `sliceIsDrawable`.
  private func liveSlice(for deviceId: String) -> AgentFieldSlice? {
    guard storeBus, sliceIsDrawable(deviceId) else { return nil }
    guard let slice = boards.slices[deviceId] else { return nil }
    guard let board = try? slice.decode(AgentFieldSlice.self) else { return nil }
    return board.isExpired(at: now()) ? nil : board
  }

  private func applyDoorSnapshot(_ payload: JSONValue, from deviceId: String) {
    // A paused link applies nothing the door sends: its boards were let go at
    // the pause, and a late answer must not put one back behind it.
    guard !isPaused else { return }
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
    guard !isPaused else { return }
    guard let delta = try? AgentFieldDelta(json: payload) else {
      note("\(deviceId) sent a delta that did not read")
      return
    }
    guard var board = doorBoards[deviceId] else { return }
    guard delta.since == board.revision else {
      // A BELT since SP-2 (a): the client's table only hands over a delta that
      // continues its cursor, so this fires only for a board THIS link failed
      // to take (a snapshot that did not read). The repair is still a fresh
      // snapshot, and it is the table's to ask for.
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

  /// The board here disagrees with what the door sent: ask the client's table
  /// for a fresh snapshot. The board on the field STAYS until that snapshot
  /// replaces it — a repair is not a reason to draw nothing.
  private func resubscribe(_ deviceId: String) {
    subscriptions[deviceId]?.resnapshot(because: "the field board here is at another revision")
  }

  // MARK: The fold

  /// A board's own expiry, as a timer. Live with the bus (UA-P-5).
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
      // The FILTER is the rule (UA-P-5): a board from a device the door said
      // is not this account's is held, and every key here is already in
      // `found` anyway — a slice arrives from a peer — so the union is the
      // belt. Without the filter a foreign desktop's board reached the fold
      // while its own row was correctly hidden, which is bodies with no
      // desktop, from a machine this phone had already refused.
      known.formUnion(devices.slices.keys.filter(sliceIsDrawable))
      known.formUnion(boards.slices.keys.filter(sliceIsDrawable))
    }

    for deviceId in known.sorted() {
      // SP-2 (f) — THE DOOR OUTRANKS THE SLICE once it has hello'd and sent
      // its board. The slice draws what the door cannot: a desktop whose door is
      // asleep, or one whose board has not arrived yet — never a blank.
      if doorBoards[deviceId] != nil {
        doorOnly.append(deviceId)
      } else if let slice = liveSlice(for: deviceId) {
        slices.append(slice)
        // Re-armed on every board, so a heartbeat that moves `expiresAt`
        // moves the timer with it.
        armExpiry(for: deviceId, at: slice.expiresAt)
      }
    }

    // Each board named by its own desktop's catalog (AC-D9), resolved here once
    // per fold so the projection stays a pure function of what it is handed.
    var catalogsByDevice: [String: AgentCatalog] = [:]
    for slice in slices { catalogsByDevice[slice.deviceId] = desktopCatalog(for: slice.deviceId) }
    let projection = projectAgentSlices(slices, now: now(), catalogs: catalogsByDevice)
    var merged = projection.agents
    var seen = Set(merged.map(\.id))

    for deviceId in doorOnly {
      guard let board = doorBoards[deviceId] else { continue }
      let rows = board.order.compactMap { board.rows[$0] }
      let fromDoor = projectAgentField(
        rows: rows, device: deviceId, catalog: desktopCatalog(for: deviceId))
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
        // `?? nil` flattens the double optional rather than defaulting: since
        // UA-P-0e a peer row carries no `platform` at all, and "" would be this
        // phone inventing an empty answer where the wire said nothing.
        platform: row?.platform ?? nil,
        state: state(of: deviceId, entry: entry),
        feed: feed(of: deviceId),
        publishesTerminalDoors: row?.capabilities?.terminalMesh,
        fieldRefusal: entry.fieldRefusal,
        userId: entry.userId)
    }
  }

  /// What this desktop says about itself.
  ///
  /// The DOOR's `device.list` first, because since UA-P-1b that is where these
  /// facts come from and it is the answer this phone was granted. The store
  /// second, on a gated node and only where the door has not refused this
  /// phone (UA-P-5): a published slice is the same row by another road, and
  /// the road does not change who is allowed to walk it.
  private func describe(_ deviceId: String, _ entry: Found) -> DeviceInfo? {
    if let info = entry.info { return info }
    guard storeBus, sliceIsDrawable(deviceId) else { return nil }
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
        fieldRefusal: desktop.fieldRefusal,
        userId: desktop.userId)
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

  /// Which leg this desktop's bodies came from — the door first (SP-2 f).
  private func feed(of deviceId: String, doorOnly: Set<String>? = nil) -> FieldFeedSource {
    if doorOnly?.contains(deviceId) ?? (doorBoards[deviceId] != nil) { return .door }
    if liveSlice(for: deviceId) != nil { return .store }
    return FieldFeedSource.none
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
/// Dormant through UA-P-1b, when James's ruling of 2026-09-15 took every
/// content-bearing slice off the bus. UA-P-5 subscribes to both again, and
/// only on a node gated on this account's login — truffle gates by login now
/// (RFC 025), which is the condition the ruling set.
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
