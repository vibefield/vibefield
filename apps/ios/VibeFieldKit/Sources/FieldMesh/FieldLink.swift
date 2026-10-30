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

/// Whether a desktop's board is on the field, and over what.
///
/// RETIRED 2026-10-01 (DS-D14): `store`, the `field.agents.v1` leg — no desktop
/// publishes that slice and this phone no longer reads it. Every desktop's
/// board arrives over ONE door since DS-8: the home's mesh board.
public enum FieldFeedSource: String, Sendable, Equatable {
  /// Nothing yet.
  case none
  /// Over the home's door: `agent.subscribe {projection: "field", scope:
  /// "mesh"}` (DS-8) — this desktop's own board, on its own chain, relayed by
  /// the home (the home's own board included).
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
///   door admits this login → the doors that do are this account's desktops.
///
/// Nothing the phone dials is a string somebody else wrote any more, and no
/// secret is on the wire for it to have read: the sidecar adds the capability
/// path on forward, and what admits this phone is its WhoIs login.
///
/// **DS-8 (2026-10-01, DS-D13) — the phone HOMES to one of those desktops.**
/// Its home is the last home (`HomeMemory`, per login) when that door answers,
/// else the first self desktop whose door answers, in device order. The field
/// is read through the home ALONE: one `FieldProductClient`, one
/// `agent.subscribe {projection: "field", scope: "mesh"}` — every self
/// desktop's board, multiplexed by the home on each desktop's own chain
/// (`MeshBoardCopy`), the merge written once, in fieldd (DS-L4). A desktop
/// asleep keeps its rows on the field, greyed, because the home's replica
/// answers for them (DS-L8). On the home's loss — its door's deadline, a
/// close, `INCOMPATIBLE` — the phone re-homes by sweeping the roster: every
/// candidate is asked afresh and the first that answers becomes the home, its
/// open the field's fresh snapshot. Terminal tickets, renewals and acts still
/// go to the desktop that OWNS the session or run, over a door opened for the
/// ask and let go after (`ownerDoor`) — the phone has its own node, and bytes
/// and acts never pass through the home. Option (c), a second door kept open
/// when the home calls a desktop unreachable that the roster calls online, is
/// named in DS-D13 and NOT built.
///
/// **UA-P-5 put the store back in front of it (2026-09-16), scoped — and
/// DS-D14 took the board off it again (2026-10-01).** On a GATED node the
/// devices slice (`field.devices.v1`) is read for presence: a desktop's own
/// name and capabilities, fused by device id, held for a device the door has
/// refused. The agents slice (`field.agents.v1`) is RETIRED — no desktop
/// publishes it and this phone never reads it; the field is the home's mesh
/// board alone. On an ungated node — the pre-login window — nothing is
/// subscribed at all.
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

  /// The field, folded from the home's mesh board. Ordered by device then by
  /// each board's own order — a field that reshuffled because a dictionary
  /// rehashed would respawn every body.
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
  public private(set) var foreignDoors: [String: String] = [:]

  /// AC-D9 — VibeField's agent catalog, as this phone's desktops have told it:
  /// the home's answer to `agent.catalog` (and any earlier home's, kept until
  /// that desktop is forgotten), merged in device order, the first desktop's
  /// row kept where two name one agent. It is what a list on the phone reads
  /// (`phoneRoster`); each board on the field is named by its own desktop's
  /// answer first, when the phone has one.
  ///
  /// Empty is a state, never a breakage: nothing is connected yet, or the home
  /// is a build from before the door (it answers NOT_FOUND). The field draws
  /// exactly as it did then — every agent by the label its row carries.
  public private(set) var catalog: AgentCatalog = .empty

  /// DS-8 — the self desktop this phone reads its field through, by durable
  /// device id, or nil while it has none.
  public private(set) var home: String?

  /// TS-7 — whether a sweep has ANSWERED since this link started: the online
  /// peers were read, and every one had finished its hello and was filed.
  /// `desktops` empty before this is "not asked yet"; after it, "none" — the
  /// difference between the phone's "No desktops yet" and a flash of it. Not
  /// `refreshDesktops()`'s: that runs from `start()` before any sweep has.
  public private(set) var hasListed = false

  /// Whether anything at all is being heard. `false` with `desktops` non-empty
  /// is the honest "they are there and saying nothing" that a blank field must
  /// never be mistaken for.
  public var isHearing: Bool { desktops.contains { $0.feed != FieldFeedSource.none } }

  // MARK: The plumbing

  /// The presence reader (`field.devices.v1`): live only on a GATED node
  /// (`storeBus` below) — truffle reports and admits by login (RFC 025), so
  /// every store on a gated node is scoped to this account by construction.
  @ObservationIgnored public let devices: FieldStore
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
  /// It is also the key the last home is remembered under (DS-8).
  ///
  /// `nil` is the pre-login window: no account to compare against, so nothing
  /// is called foreign on this evidence and the door probe remains the sole
  /// witness, exactly as it was through UA-P-1a — and no home is remembered.
  @ObservationIgnored private let selfLogin: String?
  /// SP-2 (g) — the phone's connection budget every door this link opens
  /// counts against: the home's, and an owner's opened on demand (one per
  /// desktop). The app passes the phone's one ledger; a link made with none
  /// gets its own.
  @ObservationIgnored public let budget: PhoneConnectionBudget
  /// DS-8 — where the last home is remembered. nil remembers nothing.
  @ObservationIgnored private let homeMemory: HomeMemory?
  @ObservationIgnored private let resumeTiming: FieldResumeTiming

  // MARK: The home's own state (DS-8)

  @ObservationIgnored private var homeClient: FieldProductClient?
  @ObservationIgnored private var homeSubscription: ProductSubscription?
  /// SP-2 (c) — the home's window on the way back from the background. While
  /// one is pending the home is HELD: nothing re-subscribes it until it opens.
  @ObservationIgnored private var resumeSlot: Task<Void, Never>?
  /// Bumped by every pause (and by `stop`): an arm started before it is never
  /// KEPT after it, however quickly the app came back — a pause flag read after
  /// the subscribe's await cannot see a pause that was already undone.
  @ObservationIgnored private var armEpoch = 0
  /// The client a subscribe is in flight on, set synchronously — the arming
  /// LATCH. `homeSubscription` is only assigned after the subscribe's await, so
  /// a burst of edges around hello walked past that check and opened several
  /// subscriptions on one door, each fighting over one board — a
  /// self-sustaining storm on a metered radio.
  @ObservationIgnored private var armingFor: ObjectIdentifier?
  /// A gap seen while the subscription's handle was still on its way: repaired
  /// the moment the handle lands, never dropped.
  @ObservationIgnored private var gapWhileArming: String?
  /// The home's mesh board, as this phone holds it, and the desktop whose
  /// door it came from.
  @ObservationIgnored private var board = MeshBoardCopy()
  @ObservationIgnored private var boardFrom: String?
  /// AC-D9 — each door's own answer to `agent.catalog`, by device id: the
  /// home's, and an earlier home's until that desktop is forgotten.
  @ObservationIgnored private var catalogs: [String: AgentCatalog] = [:]
  // History owns these clients; other row readers borrow the same socket.
  private final class ReadingDoor {
    weak var client: FieldProductClient?
    init(_ client: FieldProductClient) { self.client = client }
  }
  @ObservationIgnored private var readingDoors: [String: ReadingDoor] = [:]
  /// Homes whose CURRENT connection has been asked for its catalog. Set
  /// synchronously, and cleared whenever the client leaves `ready`, so the next
  /// hello — a new connection — is asked afresh.
  @ObservationIgnored private var catalogAsked: Set<String> = []
  /// The desktops the home's roster has been asked to name on its current
  /// connection; nil = not asked on this connection.
  @ObservationIgnored private var rosterAskedFor: Set<String>?
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
  /// A sweep asked for WHILE one is running, remembered rather than dropped.
  ///
  /// Without it a peer that arrived mid-sweep waited for the next tick — ten
  /// seconds on the product schedule — because the latch turns a concurrent
  /// request away and nothing was left to say it had happened. The flag is one
  /// bit and it collapses a burst of arrivals into exactly one extra pass.
  @ObservationIgnored private var sweepAgain = false

  private struct Found {
    var peer: FieldStorePeer
    /// The last verdict, or nil while the first probe is still out.
    var admission: DoorAdmission?
    /// When this peer may be asked again. `nil` = now.
    var askAgainAt: Date?
    var doorURL: URL?
    /// The desktop's own row — the home's roster's word for it.
    var info: DeviceInfo?
    /// The field subscription's refusal, in the door's words (UA-P-1d).
    var fieldRefusal: String?
    /// IOS-8c — the user ULID the door answered hello with.
    var userId: String?
    /// SP-2 (e) — a door that STOPPED this phone (`INCOMPATIBLE`,
    /// `UNAUTHORIZED`, `PRECONDITION_FAILED`), in its own words; when it may be
    /// asked again, and how many times it has stopped since it last answered.
    var stopped: String?
    var stuckRetryAt: Date?
    var stuckRetries = 0
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
    homeMemory: HomeMemory? = nil,
    resumeTiming: FieldResumeTiming = .live,
    now: @escaping @MainActor () -> Date = { .now }
  ) {
    self.budget = budget ?? PhoneConnectionBudget()
    self.homeMemory = homeMemory
    self.resumeTiming = resumeTiming
    devices = FieldStore(doors: storeDoors)
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
      track()
    }
    watchPeers()
    startSweeping()
    reconcile()
  }

  /// The app went away (§5). The home's subscription goes and discovery stops
  /// asking; the mesh NODE is left alone, and so is the home's client — a
  /// WebSocket that survives a two-second app switch is one fewer hello when
  /// the user comes back, and the subscription is where the bytes were.
  ///
  /// The FIELD STANDS: the board copy is kept and applied to by nothing until
  /// the way back's fresh snapshot replaces it. Emptying it on an app switch
  /// would be a worse lie than a board that is a moment old (before DS-8 the
  /// door boards were dropped here, against this very sentence).
  public func pause() {
    guard started, !isPaused else { return }
    isPaused = true
    armEpoch &+= 1
    homeSubscription?.cancel()
    homeSubscription = nil
    // SP-2 (c) — the keepalive's clocks stop with the app: a deadline measured
    // across a suspension would call the door dead on the way back.
    homeClient?.pauseKeepalive()
    resumeSlot?.cancel()
    resumeSlot = nil
    armingFor = nil
    gapWhileArming = nil
    sweepTask?.cancel()
    sweepTask = nil
    devices.pause()
    refold()
  }

  /// Back. Discovery sweeps afresh, the home re-subscribes for a FRESH snapshot
  /// (P5), and a peer whose deadline passed while the phone was away is asked
  /// again on the first sweep.
  public func resume() {
    guard started, isPaused else { return }
    isPaused = false
    devices.resume()
    startSweeping()
    // THE FIELD HAS TO COME BACK. `pause` cancelled the subscription and left
    // the client open, so nothing about the client changes on the way back and
    // the observation that arms a subscription never fires; the sweep does not
    // re-probe an open door either. Without this the phone returned from the
    // background to a frozen field behind a desktop reading "connected".
    //
    // SP-2 (c) — in its own window, jittered: its keepalive restarts (a fresh
    // deadline and one ping, which finds a socket that died while the phone was
    // away) and its board re-subscribes. One door since DS-8, so "never a herd"
    // is the home's alone; the window still holds it until it opens.
    if let deviceId = home, homeClient != nil {
      let delay = schedule.resumeDelay(slot: 0, jitter: resumeTiming.jitter())
      let timing = resumeTiming
      resumeSlot?.cancel()
      resumeSlot = Task { @MainActor [weak self] in
        await timing.sleep(delay)
        guard let self, !Task.isCancelled, self.started, !self.isPaused, self.home == deviceId
        else { return }
        self.resumeSlot = nil
        self.homeClient?.resumeKeepalive()
        self.armHomeSubscription()
      }
    }
    reconcile()
  }

  public func stop() {
    started = false
    isPaused = false
    armEpoch &+= 1
    resumeSlot?.cancel()
    resumeSlot = nil
    homeSubscription?.cancel()
    homeSubscription = nil
    homeClient?.close()
    homeClient = nil
    home = nil
    armingFor = nil
    gapWhileArming = nil
    peerTask?.cancel()
    peerTask = nil
    sweepTask?.cancel()
    sweepTask = nil
    board = MeshBoardCopy()
    boardFrom = nil
    found.removeAll()
    catalogs.removeAll()
    readingDoors.removeAll()
    catalogAsked.removeAll()
    rosterAskedFor = nil
    catalog = .empty
    devices.unsubscribe()
    desktops = []
    hasListed = false
    agents = []
    endpointRefusals = [:]
    foreignDoors = [:]
  }

  // MARK: The card's asks — each over its OWNER's door (DS-L4)

  /// The latest reply line for a run, asked only when a card opens.
  ///
  /// The field projection carries NO conversation content by design (§10.1),
  /// so this is the one door that fetches any — `agent.list`'s full row, on
  /// demand, for one run, from the desktop that runs it. A phone that streamed
  /// reply text for every body would be paying §5's whole budget for words
  /// nobody is reading.
  public func latestReply(runtimeRunId: String, on deviceId: String) async throws -> String? {
    try await ownerDoor(
      deviceId,
      refusal: FieldProductError(
        kind: "UNAVAILABLE", message: "no door to \(deviceId)", retryable: false)
    ) { client in
      let result = try await client.call("agent.list", as: AgentListResult.self)
      return result.sessions.first { $0.runtimeRunId == runtimeRunId }?.lastAssistantMessage
    }
  }

  /// The home's client, for the surfaces that need to ask the home something
  /// of their own; nil for any desktop that is not the home (DS-8: no other
  /// door is held open).
  public func client(for deviceId: String) -> FieldProductClient? {
    deviceId == home ? homeClient : nil
  }

  /// SP-6 — a door to one self desktop for the History tab's whole reading of
  /// it (SP-D2 (a): History is a multi-door client — each desktop's index is
  /// read where it lives, never through the home). The HOME's own client when
  /// the desktop is the home (shared; `owned` false — the caller never closes
  /// it); else a client opened for this desktop, counted against the phone's
  /// budget like every door (one per desktop, `PhoneConnectionBudget`), which
  /// the caller closes when the reading ends (`owned` true). Only a door this
  /// phone has heard ANSWER is opened — nil for any other, in the honest
  /// shape of "there is no door to ask".
  public func openHistoryDoor(_ deviceId: String) -> (client: FieldProductClient, owned: Bool)? {
    if deviceId == home, let homeClient { return (homeClient, false) }
    guard let entry = found[deviceId], case .answering = entry.admission,
      let url = entry.doorURL, endpointRefusals[deviceId] == nil
    else { return nil }
    let client = FieldProductClient(url: url, transport: transport, options: doorOptions(deviceId))
    readingDoors[deviceId] = ReadingDoor(client)
    return (client, true)
  }

  /// FS-2: bounded row reads and spawn on the selected owner. No new socket
  /// while History already holds its door, and no forwarding through home.
  /// PJ-7: the launch sheet's profile and model reads, and History's Resume —
  /// each asked of the desktop it is about, never through the home.
  public static let workspaceMethods: Set<String> = [
    "workspace.roots", "workspace.list", "workspace.search", "agent.catalog", "agent.spawn",
    "agents.profileSets.list", "agent.models", "agent.resume",
  ]

  public func workspaceCall(
    on deviceId: String, method: String, params: JSONValue? = nil
  ) async throws -> JSONValue {
    guard Self.workspaceMethods.contains(method) else {
      throw FieldProductError(kind: "FORBIDDEN_SCOPE", message: "not a workspace act", retryable: false)
    }
    return try await ownerDoor(deviceId, refusal: Self.noFilesDoor) { client in
      try await client.call(method, params: params)
    }
  }

  /// TM-5 — a routed terminal ticket for one session on one desktop.
  ///
  /// This is the whole of the phone's attach authority: `terminal.openTicket`
  /// answers a WhoIs-verified SELF peer with the cell's TAILNET doors and two
  /// grants, and the grants are what the cell verifies. Nothing is cached — a
  /// mint is deliberately not idempotent, every leg replacement needs a fresh
  /// one (a transport grant's nonce is spent at first use), and a ticket held
  /// for later is a credential with no purpose.
  ///
  /// DS-8 (DS-L4) — asked of the desktop that OWNS the session, directly: the
  /// home's own door when the session is the home's, else a door opened for
  /// this ask and let go after (`ownerDoor`). The home never mints for another
  /// desktop: its forwarded ticket would answer loopback endpoints a phone
  /// cannot dial, and the phone has its own node.
  ///
  /// The answer comes back as the JSON the daemon sent, unread. FieldMesh knows
  /// how to ASK a door; what a ticket means belongs to the target that dials
  /// with it, and keeping that shape out of this signature is what keeps the
  /// field from learning what a terminal is.
  public func openTerminalTicket(on deviceId: String, sessionId: String) async throws -> JSONValue {
    try await ownerDoor(deviceId, refusal: Self.noTerminalDoor) { client in
      try await client.call(
        "terminal.openTicket", params: .object(["sessionId": .string(sessionId)]))
    }
  }

  /// F1 (FW-D1) — the phone's approval for its freeway link to `deviceId`, from that desktop's OWN
  /// door: the approval's audience is that desktop's floor boot, its key signs it, and its fieldd is
  /// the one that decides the caller is a phone (its roster's phone row). The answer comes back
  /// unread, `{approval, expiresAt}`, for the link to carry.
  public func approveFreeway(on deviceId: String) async throws -> JSONValue {
    try await ownerDoor(deviceId, refusal: Self.noTerminalDoor) { client in
      try await client.call("freeway.approve", params: .object([:]))
    }
  }

  /// P0-C — renew a session's attach grant over the desktop that minted it:
  /// `terminal.renewAttach`, a CAS on the generation the phone holds and
  /// idempotent by `requestId` (spec §5.1). The same door and the same scope as
  /// the mint (`terminal.attach`, local to that desktop's fieldd), and the same
  /// rule as `openTerminalTicket`: the OWNER's door, and the answer comes back
  /// unread.
  public func renewTerminalGrant(
    on deviceId: String, sessionId: String, expectGeneration: Int64, requestId: String
  ) async throws -> JSONValue {
    try await ownerDoor(deviceId, refusal: Self.noTerminalDoor) { client in
      try await client.call(
        "terminal.renewAttach",
        params: .object([
          "sessionId": .string(sessionId),
          "expectGeneration": .int(expectGeneration),
          "requestId": .string(requestId),
        ]))
    }
  }

  /// IOS-4c — RESUME an ended run, over the desktop that owns it.
  ///
  /// The answer carries the NEW run, and this deliberately does not put it on
  /// the field: the board is the fold's to publish, and a row invented here
  /// would be a body the desktop has not agreed exists. The next snapshot or
  /// delta shows it, which is a beat later and true.
  @discardableResult
  public func resume(runtimeRunId: String, on deviceId: String) async throws -> JSONValue {
    try await ownerDoor(
      deviceId,
      refusal: FieldProductError(
        kind: "UNAVAILABLE", message: "no door to \(deviceId)", retryable: false)
    ) { client in
      try await client.call(
        "agent.resume", params: .object(["runtimeRunId": .string(runtimeRunId)]))
    }
  }

  private static let noTerminalDoor = FieldProductError(
    kind: "UNAVAILABLE", message: "no connection to this desktop", retryable: true,
    details: .object([
      "service": .string("terminal"), "state": .string("no_door"),
    ]))

  /// R6 (2026-10-07) — a Files ask with no door says so as FILES: the
  /// desktop's own word for the service (`WORKSPACE_SERVICE.SERVICE`), never
  /// the terminal's, which it borrowed until now.
  private static let noFilesDoor = FieldProductError(
    kind: "UNAVAILABLE", message: "no connection to this desktop", retryable: true,
    details: .object([
      "service": .string("workspace"), "state": .string("no_door"),
    ]))

  /// DS-8 (DS-L4) — a door to the desktop that OWNS something, for one ask: the
  /// home's own when the owner IS the home, else a second door opened on demand
  /// and closed when the ask returns. It counts against the phone's budget like
  /// every door (one per desktop, `PhoneConnectionBudget`): a second ask to the
  /// same owner waits for the first's slot.
  ///
  /// Only a door this phone has heard ANSWER is opened: an owner whose probe
  /// went unanswered, or that this phone has not asked yet, is refused at once
  /// in the honest shape — there is no door to ask. Option (c), a door kept
  /// open beside the home when the home calls a desktop unreachable that the
  /// roster calls online (DS-D13), is NOT built: this door lives for one ask,
  /// and the field is the home's alone.
  private func ownerDoor<T>(
    _ deviceId: String, refusal: FieldProductError,
    _ ask: (FieldProductClient) async throws -> T
  ) async throws -> T {
    if deviceId == home, let homeClient { return try await ask(homeClient) }
    guard let entry = found[deviceId], case .answering = entry.admission,
      let url = entry.doorURL, endpointRefusals[deviceId] == nil
    else { throw refusal }
    if let client = readingDoors[deviceId]?.client, client.state != .closed {
      return try await ask(client)
    }
    let client = FieldProductClient(url: url, transport: transport, options: doorOptions(deviceId))
    defer { client.close() }
    return try await ask(client)
  }

  /// The options every door this link opens carries for `deviceId`.
  private func doorOptions(_ deviceId: String) -> FieldProductClient.Options {
    var options = self.options
    // SP-2 (d) — the roster is asked before every dial the client makes, the
    // first and each re-dial: the tailnet's own peer list, read live, so a
    // desktop that went to sleep between two sweeps is not dialled in the gap.
    options.mayDial = { [doors] in
      await doors.onlinePeers().contains { $0.deviceId == deviceId && $0.online }
    }
    // SP-2 (h) — each subscription's bytes-per-second line names the desktop
    // it came from by its durable id; never by its door's URL.
    options.logLabel = deviceId
    // F0 (the freeway, 2026-10-16) — how far this desktop's door is, measured
    // at hello and every 30 s: the console line a slow road is read by
    options.measuresRoundTrip = true
    // SP-2 (g) — one door per self desktop, held in the phone's ledger from the
    // dial to the close: a replacement waits for its predecessor's socket.
    options.doorBudget = ProductDoorBudget(ledger: budget, desktop: deviceId)
    return options
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

  /// One discovery pass.
  ///
  /// Reads the peer list, drops what has gone, asks every peer whose deadline
  /// has passed, and settles the home. Peers are probed CONCURRENTLY: a sweep
  /// that asked eight sleeping desktops one at a time would take the probe
  /// timeout times eight, and the last peer's verdict would be a minute stale
  /// before it was ever applied.
  ///
  /// DS-8 — the home's door is never probed while it is open (its socket is
  /// its own liveness). A home that has STRUGGLED since the last pass (its
  /// socket dropped, or the deadline closed it, and the re-dial has not
  /// answered) makes this pass a re-home: every other candidate is asked
  /// afresh, and the first that answers takes the field — within the one pass
  /// the loss asked for.
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

    let struggling = homeIsStruggling
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
        if deviceId == home { loseHome(because: reason) }
        continue
      case .ok(let url):
        endpointRefusals.removeValue(forKey: deviceId)
        entry.doorURL = url
      }
      found[deviceId] = entry

      if deviceId == home, let client = homeClient {
        // The home's socket is its own liveness: it is not probed. A client the
        // roster parked (asleep between two sweeps) dials now — the roster says
        // it is online — and the rest is idempotent: a live subscription
        // returns at once, an answered catalog is not asked again.
        client.connect()
        armHomeSubscription()
        askHomeForRoster()
        askHomeForCatalog()
        continue
      }
      // SP-2 (e) — a door that STOPPED this phone is not asked again, and is
      // no home, until its backoff passes: those refusals change in minutes
      // (a desktop upgraded, a login linked), never in seconds.
      if let retryAt = entry.stuckRetryAt, retryAt > at { continue }
      if let deadline = entry.askAgainAt, deadline > at {
        // A re-home asks every candidate afresh — never a stranger's door, whose
        // window is the account's, not the home's.
        if case .notThisAccount = entry.admission { continue }
        guard struggling else { continue }
      }
      if let url = entry.doorURL { due.append((deviceId, url)) }
    }

    var forgot = false
    for deviceId in found.keys where !live.contains(deviceId) {
      forget(deviceId: deviceId)
      forgot = true
    }

    refreshDesktops()
    // TS-7 — the first listing has answered once every online peer is filed: a
    // peer still mid-hello has no id yet, and is a desktop on its way.
    if !hasListed, !peers.contains(where: { $0.online && ($0.deviceId ?? "").isEmpty }) {
      hasListed = true
    }
    // A desktop that dropped off the online list (a sleep: truffle says
    // `online: false`, never `left`) was forgotten — its catalog with it — and
    // the field must follow NOW.
    if forgot { refold() }

    if !due.isEmpty {
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
    }
    settleHome(struggling: struggling)
    refreshDesktops()
    refold()
  }

  /// One peer's verdict, recorded. No door is opened here: a door that answers
  /// is a CANDIDATE, and the pass decides which candidate is the home
  /// (`settleHome`).
  private func apply(_ admission: DoorAdmission, to deviceId: String) {
    guard var entry = found[deviceId] else { return }
    entry.admission = admission
    switch admission {
    case .answering:
      // A desktop that is not the home holds no door, so its verdict is asked
      // again on the weather cadence: the corner's word for it, and the next
      // re-home's candidates, are never minutes old.
      entry.askAgainAt =
        deviceId == home ? nil : now().addingTimeInterval(seconds(schedule.unreachable))
      foreignDoors.removeValue(forKey: deviceId)
      found[deviceId] = entry
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
      if deviceId == home { loseHome(because: reason) }
    case .unreachable:
      entry.askAgainAt = now().addingTimeInterval(seconds(schedule.unreachable))
      found[deviceId] = entry
      foreignDoors.removeValue(forKey: deviceId)
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

  /// UA-P-5 — whose device slices this phone may read. The DOOR decides, not
  /// the bus: no verdict yet is held (a slice must never be the thing that
  /// introduces a desktop), `notThisAccount` is held for good (the bus is not
  /// a second opinion that overrides a door), and `unreachable` is read — the
  /// door is asleep and the peer is still one truffle's gate admitted, so its
  /// slice is this account's by construction (RFC 025 §3.1).
  private func sliceIsDrawable(_ deviceId: String) -> Bool {
    switch found[deviceId]?.admission {
    case .answering, .unreachable: true
    case .notThisAccount, nil: false
    }
  }

  /// A peer that left takes its door, its catalog and its verdict with it.
  private func forget(_ peer: FieldStorePeer) {
    guard let deviceId = peer.deviceId, !deviceId.isEmpty else { return }
    forget(deviceId: deviceId)
    refreshDesktops()
    refold()
    // A home that left is a home lost: the roster is swept for the next.
    if home == nil { sweepSoon() }
  }

  private func forget(deviceId: String) {
    if deviceId == home { loseHome(because: "the tailnet no longer lists it") }
    if catalogs.removeValue(forKey: deviceId) != nil { mergeCatalogs() }
    catalogAsked.remove(deviceId)
    found.removeValue(forKey: deviceId)
    endpointRefusals.removeValue(forKey: deviceId)
    foreignDoors.removeValue(forKey: deviceId)
  }

  /// SP-2 (e) — when a stopped door is next asked, counted from `from`.
  private func stuckRetryDeadline(_ entry: Found, from: Date) -> Date {
    from.addingTimeInterval(seconds(schedule.stuckClientRetry(after: entry.stuckRetries)))
  }

  private func seconds(_ duration: Duration) -> TimeInterval {
    let parts = duration.components
    return TimeInterval(parts.seconds) + TimeInterval(parts.attoseconds) / 1e18
  }

  // MARK: The home (DS-8, DS-D13)

  /// The home's socket dropped (or the deadline closed it) and its re-dial has
  /// not answered yet.
  private var homeIsStruggling: Bool {
    guard let homeClient else { return false }
    if case .reconnecting = homeClient.state { return true }
    return false
  }

  /// Whether the field on screen is the home's own, live answer.
  private var homeIsLive: Bool {
    guard let home, boardFrom == home, let homeClient else { return false }
    if case .ready = homeClient.state { return true }
    return false
  }

  /// After a pass: a phone with no home takes one, and a home that struggled
  /// through the whole pass gives way to the first OTHER desktop that answered
  /// in it. With no other answer the home keeps its own client, which keeps
  /// re-dialling on its ladder (and the roster parks it while it sleeps).
  private func settleHome(struggling: Bool) {
    guard started, !isPaused else { return }
    guard let current = home else {
      if let pick = homeCandidate(excluding: nil) { openHome(pick) }
      return
    }
    guard struggling, let client = homeClient else { return }
    if case .ready = client.state { return }
    guard let pick = homeCandidate(excluding: current) else { return }
    loseHome(because: "its door stopped answering")
    openHome(pick)
  }

  /// `home = the last home ?? the first self desktop whose door answers`: the
  /// desktops whose door answered this phone, that no door stopped and no
  /// refusal holds, in device order — the remembered home first when it is
  /// among them.
  private func homeCandidate(excluding current: String?) -> String? {
    let at = now()
    let candidates = found.keys.sorted().filter { deviceId in
      guard deviceId != current, let entry = found[deviceId], entry.doorURL != nil else {
        return false
      }
      guard case .answering = entry.admission else { return false }
      guard endpointRefusals[deviceId] == nil, foreignDoors[deviceId] == nil else { return false }
      if let retryAt = entry.stuckRetryAt, retryAt > at { return false }
      return true
    }
    if let login = selfLogin, let remembered = homeMemory?.lastHome(for: login),
      candidates.contains(remembered)
    {
      return remembered
    }
    return candidates.first
  }

  private func openHome(_ deviceId: String) {
    guard let url = found[deviceId]?.doorURL else { return }
    home = deviceId
    let client = FieldProductClient(url: url, transport: transport, options: doorOptions(deviceId))
    homeClient = client
    client.connect()
    trackHome(client, deviceId)
    refreshDesktops()
  }

  /// The home stops being the home: its subscription and its client go, its
  /// slot comes back to the budget, and the next pass asks every candidate
  /// afresh. The board copy STAYS — greyed, since no live home answers for it —
  /// until the next home's open replaces it.
  private func loseHome(because reason: String) {
    guard let lost = home else { return }
    if let entry = found[lost] {
      note("\(fallbackName(entry)) stopped being this phone's home: \(reason)")
    }
    home = nil
    resumeSlot?.cancel()
    resumeSlot = nil
    homeSubscription?.cancel()
    homeSubscription = nil
    armingFor = nil
    gapWhileArming = nil
    let client = homeClient
    homeClient = nil
    client?.close()
    catalogAsked.remove(lost)
    rosterAskedFor = nil
    // A door that answered once and has stopped answering is not "answering"
    // any more: it is weather, asked again on the next pass like every other
    // candidate. (A door that STOPPED this phone keeps its own word and its
    // backoff; a refused one keeps its refusal.)
    if case .answering = found[lost]?.admission, found[lost]?.stopped == nil {
      found[lost]?.admission = .unreachable(reason)
    }
    for deviceId in found.keys {
      if case .notThisAccount = found[deviceId]?.admission { continue }
      found[deviceId]?.askAgainAt = nil
    }
    refreshDesktops()
    refold()
  }

  /// Watch the home's client: the account verdict re-read at every hello, the
  /// field armed the moment one lands, and every loss turned into a pass.
  private func trackHome(_ client: FieldProductClient, _ deviceId: String) {
    withObservationTracking {
      _ = client.state
    } onChange: { [weak self] in
      Task { @MainActor in
        guard let self, self.started, self.homeClient === client else { return }
        switch client.state {
        case .ready(let hello):
          // THE SECOND HALF OF THE ACCOUNT CHECK. The sidecar's allow-list is
          // the first and refuses a stranger before fieldd sees the socket; this
          // is fieldd's own stored-login comparison, which answers a foreign
          // login with a hello that succeeds and grants NOTHING.
          if case .notThisAccount(let reason) = DoorPolicy.admission(
            forGrantedScopes: hello.grantedScopes)
          {
            self.apply(.notThisAccount(reason), to: deviceId)
            self.refreshDesktops()
            self.refold()
            self.sweepSoon()
            return
          }
          // IOS-8c — who this desktop serves. Decoded since UA-2 and read by
          // nothing until the corner needed a seed for the face.
          self.found[deviceId]?.userId = hello.userId
          // SP-2 (e) — a door that answered starts the stuck ladder over.
          self.found[deviceId]?.stopped = nil
          self.found[deviceId]?.stuckRetries = 0
          self.found[deviceId]?.stuckRetryAt = nil
          // DS-8 — the home that answered is the last home.
          if let login = self.selfLogin { self.homeMemory?.record(deviceId, login: login) }
        case .failed(let error):
          // SP-2 (e) — the door STOPPED this phone (INCOMPATIBLE, UNAUTHORIZED,
          // PRECONDITION_FAILED): asking again with the same version and the
          // same absent token is told the same thing, so it is not asked again
          // until its backoff passes, and the field moves to the next desktop
          // that answers.
          if var entry = self.found[deviceId] {
            entry.stopped = error.message
            entry.stuckRetryAt = self.stuckRetryDeadline(entry, from: self.now())
            entry.stuckRetries += 1
            self.found[deviceId] = entry
          }
          self.loseHome(because: error.message)
          self.sweepSoon()
          return
        case .reconnecting:
          // The socket dropped, the deadline closed it, or the roster parked
          // it: one pass decides whether the field moves (`settleHome`).
          self.sweepSoon()
        case .off, .connecting, .closed:
          break
        }
        self.armHomeSubscription()
        self.askHomeForRoster()
        self.askHomeForCatalog()
        self.refreshDesktops()
        self.refold()
        self.trackHome(client, deviceId)
      }
    }
  }

  // MARK: Reconciliation

  /// Re-arm observation of the presence store. `withObservationTracking` fires
  /// once per change and must be re-armed, which is what the `Task` does — it
  /// also puts the work AFTER the mutation, so the reconcile sees the new
  /// value. Armed with the bus (UA-P-5): on an ungated node nothing is
  /// subscribed, so nothing mutates, and `start()` does not even arm it.
  private func track() {
    guard !tracking else { return }
    tracking = true
    arm()
  }

  private func arm() {
    withObservationTracking {
      _ = devices.slices
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

  // MARK: The home's asks

  /// The desktops' own rows, from the HOME's roster.
  ///
  /// `device.list` answers every device the home lists — its own row by its
  /// `self` flag (never by matching the durable id: the two keyspaces agreeing
  /// is a property of the floor, D30, not a rule this phone gets to assume)
  /// and each other desktop's under the device id the mesh board files its
  /// rows by. Asked once per connection, and again on a later pass only when a
  /// desktop has appeared that the last answer could not have named.
  private func askHomeForRoster() {
    guard let deviceId = home, let client = homeClient else { return }
    guard case .ready = client.state else {
      rosterAskedFor = nil
      return
    }
    let known = Set(found.keys)
    if let asked = rosterAskedFor, known.isSubset(of: asked) { return }
    rosterAskedFor = known
    Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        let result = try await client.call("device.list", as: DeviceListResult.self)
        guard self.started, self.homeClient === client else { return }
        for dropped in result.droppedRows {
          self.note("\(deviceId) sent a device row that did not read: \(dropped)")
        }
        if let own = result.devices.first(where: { $0.isSelf == true }) {
          self.found[deviceId]?.info = own
        } else {
          self.note("\(deviceId) named no device of its own")
        }
        for row in result.devices where row.isSelf != true && row.deviceId != deviceId {
          if self.found[row.deviceId] != nil { self.found[row.deviceId]?.info = row }
        }
        self.refreshDesktops()
      } catch {
        // Not a state: the home is open and answering, and what is missing is
        // a nicety (names and whether terminal doors are out). The peers'
        // hostnames stand in, and `publishesTerminalDoors` stays nil — "it did
        // not say", never drawn as a refusal.
        self.note("\(deviceId) did not answer device.list: \(MeshModel.shortReason(error))")
      }
    }
  }

  /// AC-D9 — the home's agent catalog, asked once per CONNECTION.
  ///
  /// The desktop is the authority and this phone may be a build behind it, so
  /// an agent's name comes over the wire, never out of a table compiled in
  /// here. Asked at every hello — a desktop that was upgraded while the socket
  /// was down may have decided something new — kept until the next, and kept
  /// past the door until the desktop is forgotten.
  ///
  /// A desktop without the door — a build from before AC-3, which answers
  /// `NOT_FOUND` — is not a failure of anything: its agents are named by the
  /// label their field rows carry, and a note says why. A failure that asking
  /// again could fix (the door's own `retryable`) keeps whatever the last
  /// connection said and is asked again on the sweep's clock; one that could
  /// not leaves this desktop with no catalog and is not asked again on this
  /// connection.
  private func askHomeForCatalog() {
    guard let deviceId = home, let client = homeClient else { return }
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
        guard self.started, self.homeClient === client else { return }
        for dropped in result.droppedRows {
          self.note("\(deviceId) sent a catalog row that did not read: \(dropped)")
        }
        self.setCatalog(AgentCatalog(result), for: deviceId)
      } catch {
        guard self.started, self.homeClient === client else { return }
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
  /// then what the phone's other doors said (a desktop a build behind has no
  /// door, and its agents are the same agents), else nothing — the row's own
  /// label names the body then.
  private func desktopCatalog(for deviceId: String) -> AgentCatalog {
    guard let own = catalogs[deviceId] else { return catalog }
    return own.backed(by: catalog)
  }

  // MARK: The field — the home's mesh board

  /// The field's one subscription: `agent.subscribe {projection: "field",
  /// scope: "mesh"}` on the home (DS-D13). Once open it STAYS open; an idle
  /// board costs nothing (§5: nothing changes, nothing is sent).
  ///
  /// Its frames pass through the client's table as `.stream`: the mesh board is
  /// one subscription carrying a chain per desktop, so the cursor is the board
  /// copy's (`MeshBoardCopy`) and a gap asks the table for the fresh snapshot,
  /// exactly as the table's own gaps do.
  private func armHomeSubscription() {
    guard !isPaused, homeSubscription == nil, let deviceId = home, let client = homeClient else {
      return
    }
    // SP-2 (c) — held until its window on the way back opens.
    guard resumeSlot == nil else { return }
    guard armingFor == nil else { return }
    guard case .ready = client.state else { return }
    let token = ObjectIdentifier(client)
    armingFor = token
    let epoch = armEpoch

    Task { @MainActor [weak self] in
      guard let self else { return }
      defer { if self.armingFor == token { self.armingFor = nil } }
      guard self.started, self.homeClient === client, self.homeSubscription == nil else { return }
      do {
        let params = AgentSubscribeParams.phoneMesh
        let subscription = try await client.subscribe(
          "agent.subscribe",
          params: params.json,
          shape: SubscriptionShape(kind: .stream, minIntervalMs: params.minIntervalMs),
          onSnapshot: { [weak self] payload in
            self?.applyMeshOpen(payload, from: deviceId, client: client)
          },
          onDelta: { [weak self] payload in
            self?.applyMeshFrame(payload, from: deviceId, client: client)
          })
        // Re-checked AFTER the await — the slot, the home, and the PAUSE by its
        // epoch: a subscribe asked before the app went away and answered after
        // it must not survive the pause, and a pause and a resume can both land
        // inside one answer (2026-10-01, found by SP-2 c's stagger row). What
        // slipped through is cancelled, never overwritten: an overwritten
        // handle is a subscription nobody owns and the door keeps feeding.
        guard self.started, !self.isPaused, self.armEpoch == epoch, self.homeClient === client,
          self.homeSubscription == nil
        else {
          subscription.cancel()
          return
        }
        self.homeSubscription = subscription
        if let why = self.gapWhileArming {
          self.gapWhileArming = nil
          subscription.resnapshot(because: why)
        }
      } catch {
        guard self.homeClient === client else { return }
        // UA-P-1d — THIS REACHES A FACE: a door that answered hello and then
        // refused the field is said in the corner (`MeshDisplay.linkLine`), and
        // the note stays as the diagnostic. The sweep asks again.
        let reason = MeshModel.shortReason(error)
        self.note("\(deviceId) refused the field subscription: \(reason)")
        self.found[deviceId]?.fieldRefusal = reason
        self.refreshDesktops()
      }
    }
  }

  /// The home's open answer — every desktop it lists, on its own chain. It
  /// REPLACES the board copy: a re-home or a repair never draws a row twice.
  private func applyMeshOpen(_ payload: JSONValue, from deviceId: String, client: FieldProductClient)
  {
    // A paused link applies nothing the door sends, and a closed home's late
    // answer must not put its board back behind the next home's.
    guard !isPaused, homeClient === client else { return }
    do {
      let open = try AgentMeshOpen(json: payload)
      board.reset(open)
      boardFrom = deviceId
      for dropped in open.droppedDevices {
        note("\(deviceId) listed a desktop that did not read: \(dropped)")
      }
      for entry in open.devices {
        for dropped in entry.snapshot?.droppedRows ?? [] {
          note("\(entry.device) sent a row that did not read: \(dropped)")
        }
      }
      if found[deviceId]?.fieldRefusal != nil {
        found[deviceId]?.fieldRefusal = nil
        refreshDesktops()
      }
      refold()
    } catch {
      // A door that answered the field with something that is not the mesh
      // board — a fieldd from before DS-3 serves its own board — is SAID, on
      // the home's row, never drawn as a partial field.
      let reason =
        "it answered a board this phone cannot read as the mesh: \(MeshModel.shortReason(error))"
      note("\(deviceId) \(reason)")
      found[deviceId]?.fieldRefusal = reason
      refreshDesktops()
    }
  }

  /// One later frame of the home's board, judged against its desktop's chain.
  private func applyMeshFrame(_ payload: JSONValue, from deviceId: String, client: FieldProductClient)
  {
    guard !isPaused, homeClient === client, boardFrom == deviceId else { return }
    let frame: AgentMeshFrame
    do {
      frame = try AgentMeshFrame(json: payload)
    } catch {
      // Dropped and named. A lost delta is a gap the NEXT delta finds, and the
      // repair is then a fresh board — never a guess at what this one said.
      note("\(deviceId) sent a mesh frame that did not read: \(MeshModel.shortReason(error))")
      return
    }
    switch board.apply(frame) {
    case .applied:
      refold()
    case .gap(let why):
      // The board on the field STAYS until the fresh snapshot replaces it — a
      // repair is not a reason to draw nothing.
      note("\(why) — re-subscribing")
      if let homeSubscription {
        homeSubscription.resnapshot(because: why)
      } else {
        gapWhileArming = why
      }
    }
  }

  // MARK: The fold

  private func refold() {
    let live = homeIsLive
    var merged: [AgentSnapshot] = []
    var seen = Set<String>()
    // UA-P-5's law, kept under a home: a desktop THIS phone established is
    // somebody else's is held off the field even when a home lists it — the
    // door decides, and the home is not a second opinion that overrides it.
    for deviceId in board.deviceIds where foreignDoors[deviceId] == nil {
      guard let device = board.devices[deviceId], let held = device.board else { continue }
      // Each board named by its own desktop's catalog (AC-D9), resolved here
      // once per fold so the projection stays a pure function of what it is
      // handed; greyed when its desktop is not live on a live home (DS-L8).
      let projection = projectAgentField(
        rows: held.ordered, device: deviceId, catalog: desktopCatalog(for: deviceId),
        deviceLive: live && device.state.isLive)
      // A run id is a ULID minted on its own desktop, so two desktops never
      // share one; the first is kept anyway — nothing is drawn twice.
      for agent in projection.agents where !seen.contains(agent.id) {
        merged.append(agent)
        seen.insert(agent.id)
      }
    }
    agents = merged
    refreshFeeds()
  }

  /// THIS ACCOUNT'S desktops, keyed by the durable device id.
  ///
  /// The key is truffle's durable id for the peer — the one the fold's rows
  /// carry, and the one a card hands back to the link's asks. Everything here
  /// is keyed that way, and mixing it with the Tailscale routing id (which is
  /// what a send is addressed to, a different keyspace, RFC 017 §8) produced a
  /// desktop whose door was open and ready while its row said "dialing"
  /// forever.
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
  /// The HOME's `device.list` first, because since UA-P-1b that is where these
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
  /// The peer's slugged tailscale hostname stands in until the home's roster
  /// answers with the name its own user gave it. It is a real fact about that
  /// machine rather than a placeholder, which is what makes it safe to draw:
  /// a corner that said "unknown desktop" for a beat would be less true than
  /// one that says `studio`.
  private func fallbackName(_ entry: Found) -> String {
    if let hostname = entry.peer.hostname, !hostname.isEmpty { return hostname }
    return entry.peer.deviceId ?? entry.peer.id
  }

  private func refreshFeeds() {
    desktops = desktops.map { desktop in
      FieldDesktop(
        deviceId: desktop.deviceId, name: desktop.name, platform: desktop.platform,
        state: desktop.state, feed: feed(of: desktop.deviceId),
        publishesTerminalDoors: desktop.publishesTerminalDoors,
        fieldRefusal: desktop.fieldRefusal,
        userId: desktop.userId)
    }
  }

  /// The corner's word for a desktop. The HOME's is its client's; any other
  /// desktop holds no door (DS-8), so its word is its probe's: answering reads
  /// `ready` (its door answers, and its board arrives through the home), a
  /// silent door `noDoor`, and a door that stopped this phone its own words
  /// for as long as its backoff runs — and no longer: no door to it is open to
  /// clear the word, so a desktop upgraded since would otherwise read
  /// "refused" until it next became the home.
  private func state(of deviceId: String, entry: Found) -> FieldDesktop.State {
    if let refusal = endpointRefusals[deviceId] { return .refusedDoor(refusal) }
    if deviceId == home, let homeClient {
      switch homeClient.state {
      case .off, .connecting: return .connecting
      case .ready: return .ready
      case .reconnecting: return .reconnecting
      case .failed(let error): return .failed(error.message)
      case .closed: return .noDoor
      }
    }
    if let stopped = entry.stopped, let retryAt = entry.stuckRetryAt, retryAt > now() {
      return .failed(stopped)
    }
    switch entry.admission {
    case nil: return .connecting
    case .answering: return .ready
    case .unreachable, .notThisAccount: return .noDoor
    }
  }

  /// Whether this desktop's board is on the field — every board arrives over
  /// the home's door (DS-8).
  private func feed(of deviceId: String) -> FieldFeedSource {
    board.devices[deviceId]?.board != nil ? .door : FieldFeedSource.none
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
/// `field.devices.v1` is presence (UA-P-5: subscribed only on a node gated on
/// this account's login).
///
/// RETIRED 2026-10-01 (DS-D14): `agents = "field.agents.v1"`, the board's store
/// leg. No desktop publishes it and this phone never reads it: the field is
/// the home's mesh board (DS-8). RETIRED 2026-09-14 (TM-5): `terminal.v1.hosts`,
/// listed and never subscribed — the store retired with the TSP1 adapter at
/// TM-1 (TM-D5).
public enum FieldStoreID {
  public static let devices = "field.devices.v1"
}
