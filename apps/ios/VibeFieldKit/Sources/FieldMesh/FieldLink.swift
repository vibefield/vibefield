import FieldAgents
import FieldDesign
import FieldFreeway
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
  /// dealt from until the home answers with the face itself (`person`, IOS-8f).
  public let userId: String?
  /// IOS-8f — who this desktop's person is, in its own words (`user.me`): the
  /// face its windows show and the name, asked of the HOME once per
  /// connection. Nil until it answers, and from a desktop older than the door
  /// or one that serves no user — then the corner deals from `userId`.
  public let person: DesktopPerson?
  /// PG-3e — this desktop's STANDING on the home's remote board (`AgentMeshDeviceState`), for Settings' "Watch its
  /// agents". nil: the home's board does not list it (yet). `state` stays the connection's word (3d §7's last bullet).
  public let board: AgentMeshDeviceState?

  public var id: String { deviceId }

  public init(
    deviceId: String, name: String, platform: String?, state: State, feed: FieldFeedSource,
    publishesTerminalDoors: Bool? = nil, fieldRefusal: String? = nil, userId: String? = nil,
    person: DesktopPerson? = nil, board: AgentMeshDeviceState? = nil
  ) {
    self.deviceId = deviceId
    self.name = name
    self.platform = platform
    self.state = state
    self.feed = feed
    self.publishesTerminalDoors = publishesTerminalDoors
    self.fieldRefusal = fieldRefusal
    self.userId = userId
    self.person = person
    self.board = board
  }
}

/// IOS-8f — a desktop's answer to `user.me`, narrowed to the corner: the face as
/// the wire spells it (`frame` nil = a sticker) and the name, nil where the
/// desktop has no user row. `dealt` = the face is the desktop's proposal still.
public struct DesktopPerson: Sendable, Equatable {
  public let name: String?
  public let emoji: String
  public let frame: String?
  public let dealt: Bool

  public init(name: String?, emoji: String, frame: String?, dealt: Bool) {
    self.name = name
    self.emoji = emoji
    self.frame = frame
    self.dealt = dealt
  }

  init(_ answer: UserMeResult) {
    self.init(name: answer.name, emoji: answer.face.emoji, frame: answer.face.frame, dealt: answer.dealt)
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
  /// Over the home's door: `agent.subscribe {projection: "remote", scope:
  /// "mesh"}` — this desktop's own board, on its own chain, relayed by the
  /// home (the home's own board included). (Corrected 2026-11-02, PG-3e: the
  /// projection was `field` from DS-8 until the switch.)
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
///   the mesh node is up → truffle's peer list names every node of this app
///   (its tag, or the `truffle-vibefield-` prefix on an untagged row; corrected
///   2026-11-07, at `FieldMeshContract`) → the
///   phone BUILDS each peer's door address from the peer's own
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
/// `agent.subscribe {projection: "remote", scope: "mesh"}` — every self
/// desktop's board, multiplexed by the home on each desktop's own chain
/// (`RemoteMeshCopy`, the window's own pipeline), the merge written once, in
/// fieldd (DS-L4). (Corrected 2026-11-02, PG-3e: it was the `field` cut into
/// `MeshBoardCopy` until the switch; the phone now draws the home's window
/// row for row, Q-J1 (a).) A desktop
/// asleep keeps its rows on the field, greyed, because the home's replica
/// answers for them (DS-L8). On the home's loss — its door's deadline, a
/// close, `INCOMPATIBLE` — the phone re-homes by sweeping the roster: every
/// candidate is asked afresh and the first that answers becomes the home, its
/// open the field's fresh snapshot. Terminal tickets, renewals and acts still
/// go to the desktop that OWNS the session or run, over a door opened for the
/// ask and let go after (`ownerDoor`) — the phone has its own node, and bytes
/// and acts never pass through the home. (*Amended 2026-11-02 (PG-3f):* a report
/// is not an act — `agent.reportShown` rides the home's client, routed by
/// `device`, PG-D6 (a), 3b.) Option (c), a second door kept open
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

  /// PG-3e — the drawn rows of the home's remote board, in the window's order, UA-P-5's foreign doors held off AFTER
  /// the fold (so a hidden desktop never moves another row's place or identity): PG-4s's and PG-5…8's input
  /// (template §3, "never `FieldBubble`"). Assigned only when they differ.
  public private(set) var rows: [RemoteFieldRow] = []
  /// PG-3e — the swarm's bubbles, mapped from `rows` (`fieldBubble(from:fieldIsLive:catalog:suppressUnread:)`).
  /// Assigned only when they differ: Observation invalidates every reader on ANY assignment. (Replaces `agents:
  /// [AgentSnapshot]`, the field cut's projection, retired with the switch.)
  public private(set) var bubbles: [FieldBubble] = []
  /// PG-3e — the phone-only grey: false while no live home answers for the copy (`homeIsLive`).
  public private(set) var fieldIsLive = false
  /// PG-3e — how many times `bubbles` was reassigned: a `@testable` witness for L7.
  internal private(set) var redraws = 0
  /// PG-3f (the v2 check's S4) — the last 32 `agent.reportShown` answers this link heard, in order: a `@testable`
  /// witness, so a row (D2) can read that a report LANDED, not only that nothing was refused. Capped as `notes` is and
  /// cleared by `stop()` (the review's [6]/[14]/[19]: it is compiled into Release, and it grew without bound).
  internal private(set) var reportAnswers: [ReportAnswer] = []

  /// One report's answer: the device it named, the model ids it carried, and how the home (or the owner) answered.
  struct ReportAnswer: Equatable {
    var device: String
    var ids: [String]
    var outcome: ReportOutcome
  }

  enum ReportOutcome: Equatable {
    case reported
    /// No screen yet, a deadline, UNAVAILABLE, or a refusal with no details: nothing recorded, the next open re-sends.
    case transient
    /// The owner's own lasting refusal (3b's `lastingRefusal`): recorded for the device, no resend on open.
    case lasting(ReportRefusal)
  }

  enum ReportRefusal: Equatable {
    /// `details.reason == "carried-cap"`: the owner carries this peer's readers' screens to its bound.
    case carriedCap
    /// `details.locality == "local"`: the owner (or the home) runs without PG-3b's screens.
    case noScreens
  }
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
  /// The home's remote mesh board, as this phone holds it (PG-3d's copy of the window's pipeline), and the desktop
  /// whose door it came from. `boardFrom` is nil while no open the copy could read stands: frames are not taken.
  @ObservationIgnored private var remote = RemoteMeshCopy()
  @ObservationIgnored private var boardFrom: String?
  /// PG-3e (design v2 §3.5) — an open that did not read arrived INSIDE `subscribe`, before this link held the handle:
  /// the arm cancels the handle when it lands. Cleared at the start of every arm (the v2 check's N9), and by pause,
  /// stop and a lost home.
  @ObservationIgnored private var refusedWhileArming = false
  /// Q-P2 (design v2 §3.7) — a desktop whose door refused the remote cut, on its own ladder: the asks run the stuck
  /// ladder apart (30, 60, 120, 240 s, then every 300), and no hello clears it, nor a sleep (`forget` keeps it). What
  /// clears it: a remote open from that desktop that reads, a home's board listing that desktop live with its board
  /// (the v2 check's S1: it serves the field, whichever home answers for it), or `stop()`. While it stands it is the
  /// desktop's corner words (`refreshDesktops`), and the desktop is no home candidate until it is due.
  @ObservationIgnored private var remoteRefusals: [String: RemoteRefusal] = [:]
  /// The devices on the remote cut's ladder: a `@testable` witness (the review's [10]: a later refusal of another kind
  /// clears the record, and a row reads that it went).
  internal var laddered: Set<String> { Set(remoteRefusals.keys) }

  // PG-3f (design v2 §4) — the phone is a screen.
  /// What the open card shows, by its VISUAL id (`show(visualId:)`); nil: the card is closed.
  @ObservationIgnored private var wantedVisualId: String?
  /// The row under the card, resolved at every refold: its MODEL id and its owner.
  @ObservationIgnored private var shown: Shown?
  /// Devices whose owner refused this phone's reports for good (§4.3), with the board epoch the refusal was heard on:
  /// sent nothing — no report and no empty — until that board re-attaches on a new epoch, a new home or hello, or
  /// `stop()`.
  @ObservationIgnored private var reportRecords: [String: ReportRecord] = [:]
  /// The reports, in order: each send waits for the one before it.
  @ObservationIgnored private var reportChain: Task<Void, Never>?
  /// The chain's generation: pause, a lost home and stop end the WHOLE chain by moving it, and each queued send drops
  /// when it wakes on an old one (the review's [13]: cancelling the tail left the sends behind it queued, and a quick
  /// pause and resume on the same client let one land after the resume's open sent the card's row).
  @ObservationIgnored private var reportGeneration = 0
  /// A board is open on the home: set by an open that read, cleared by a gap, a refused open, a lost home and the pause.
  /// Rule 1 sends only while it stands (the v2 check's N14); the open's own rule covers the return.
  @ObservationIgnored private var boardOpen = false
  /// Inside `applyMeshOpen`: rule 1 resolves without sending, and the open's rule sends once (the v2 check's S2).
  @ObservationIgnored private var opening = false

  private struct Shown: Equatable {
    var modelId: String
    var device: String
  }

  private struct ReportRecord {
    var refusal: ReportRefusal
    var epoch: String?
  }

  private struct RemoteRefusal {
    var reason: String
    var retries: Int
    var retryAt: Date
  }
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
  /// IOS-8f — the homes asked `user.me` on their current connection.
  @ObservationIgnored private var personAsked: Set<String> = []
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
    /// IOS-8f — the home's answer to `user.me`.
    var person: DesktopPerson?
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
    refusedWhileArming = false
    // PG-3f — paused, nothing is reported: the subscription that was the screen is gone, and resume's open re-sends
    boardOpen = false
    endReportChain()
    sweepTask?.cancel()
    sweepTask = nil
    devices.pause()
    refold()
  }

  /// Back. Discovery sweeps afresh, the home re-subscribes for a FRESH snapshot
  /// (P5), and a peer whose deadline passed while the phone was away is asked
  /// again on the first sweep.
  /// *2026-11-05 (PG-9):* the re-subscribe names the copy's cursors, so a
  /// desktop that moved nothing while the phone was away is answered `resumed`
  /// and its board does not cross again; a home from before PG-9 answers the
  /// fresh snapshot as before.
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
    refusedWhileArming = false
    peerTask?.cancel()
    peerTask = nil
    sweepTask?.cancel()
    sweepTask = nil
    // PG-L5 — a fresh copy holds nothing: the next account's phone never draws this one's board.
    remote = RemoteMeshCopy()
    boardFrom = nil
    remoteRefusals = [:]
    // PG-3f — the shown row and the report records are this run's: a new start sends nothing until `show`
    wantedVisualId = nil
    shown = nil
    reportRecords = [:]
    reportAnswers = []
    endReportChain()
    boardOpen = false
    opening = false
    found.removeAll()
    catalogs.removeAll()
    readingDoors.removeAll()
    catalogAsked.removeAll()
    personAsked.removeAll()
    rosterAskedFor = nil
    catalog = .empty
    devices.unsubscribe()
    desktops = []
    hasListed = false
    rows = []
    bubbles = []
    fieldIsLive = false
    endpointRefusals = [:]
    foreignDoors = [:]
  }

  // MARK: The card's asks — each over its OWNER's door (DS-L4)

  // RETIRED 2026-11-02 (item 155): `latestReply(runtimeRunId:on:)`, which asked a run's owner `agent.list` for its
  // latest reply line when a card opened. Its doc said the field projection carries no conversation content by design
  // (§10.1); since PG-3e the phone reads the remote row, whose `monitorRow.reply.text` the body and the card both draw
  // (PG-D2 (a)), so nothing called it, and a second door for the same words is the debt DS-8 retired.

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
  /// *SP-7b's 7c-2 (2026-11-06; VF-PM ruled D-c2's fourth ask (b) at 23:43Z):
  /// the card's ticket, its renewal and its Resume ride the home now
  /// (`homeAsk`, D-c2's three). History's Resume, the `agent.resume` here,
  /// stays on History's open reading door: it costs no extra socket. It moves
  /// to the home when FW-R6's last half retires `openHistoryDoor`.*
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
  /// *Corrected 2026-11-06 (SP-7b's 7c-2, D-c2 (a), VF-PM 23:17Z): stale since
  /// DS-4 (2026-09-30). The home carries the phone's ticket whole
  /// (`TerminalService.forwardVia`), and the OWNER mints it: for a self peer
  /// daemon it answers its cell's TAILNET doors, which the home hands the
  /// phone untouched, for the phone's own node to dial. So the ask rides the
  /// HOME's door, `{device}` added for another desktop's session (`homeAsk`),
  /// as F1b's approval does, and no second door is opened for it. Since 7c-1
  /// the owner keys the phone behind its home by its device, so the phone is
  /// one client there across its reconnects to the home.*
  ///
  /// The answer comes back as the JSON the daemon sent, unread. FieldMesh knows
  /// how to ASK a door; what a ticket means belongs to the target that dials
  /// with it, and keeping that shape out of this signature is what keeps the
  /// field from learning what a terminal is.
  public func openTerminalTicket(on deviceId: String, sessionId: String) async throws -> JSONValue {
    try await homeAsk(
      "terminal.openTicket", on: deviceId, params: ["sessionId": .string(sessionId)],
      refusal: Self.noTerminalDoor)
  }

  /// The RED's stub: asks nothing.
  public func openIndexTicket(on deviceId: String, sessionId: String) async throws -> JSONValue { .null }

  /// PG-3f (design v2 §4.1) — what the open card shows, by the body it follows: its VISUAL id (`FieldBubble.id`). nil:
  /// the card is closed. The link resolves the row under it at every refold and reports that row's MODEL id to its
  /// owner, routed through the home.
  ///
  /// It acts at once (the v2 check's N12): the row is resolved and the field re-mapped now, so a change of row sends
  /// and the open card's unread suppression shows without waiting for a frame.
  public func show(visualId: String?) {
    guard visualId != wantedVisualId else { return }
    wantedVisualId = visualId
    refold()
  }

  /// F1b (FW-D5; FW-R3, FW-R6) — the phone's approval for its freeway link to `deviceId`, asked of
  /// the HOME: `freeway.approve {}` for the home's own link, `{device}` for another desktop's, which
  /// the home forwards whole to that desktop (M63 `599998fdd`). That desktop still mints: the
  /// approval's audience is its floor boot, its key signs it, and its own roster decides the caller
  /// is a phone, the phone the home names in `onBehalfOf.clientDeviceId`. Only the ask rides the
  /// home, so no second door is opened for it. The answer, or the refusal, comes back unread, as
  /// the owner sent it; the link says a refusal in the phone's words (`FreewayApproval.said`).
  ///
  /// (F1 asked the owner's own door here. That per-ask owner socket is FW-R6's, retired for the
  /// approval only: a ticket, its renewal and Resume stay over the owner's door above, SP-7's.)
  /// *Corrected 2026-11-06 (SP-7b's 7c-2): retired for those three too — they ride the home's
  /// door by the same rule (`homeAsk`). The owner's door is Files' alone (`ownerDoor`).*
  public func approveFreeway(on deviceId: String) async throws -> JSONValue {
    guard let home, let homeClient else { throw FreewayApproval.noHome }
    return try await homeClient.call(
      FreewayApproval.method, params: FreewayApproval.params(for: deviceId, home: home))
  }

  /// P0-C — renew a session's attach grant over the desktop that minted it:
  /// `terminal.renewAttach`, a CAS on the generation the phone holds and
  /// idempotent by `requestId` (spec §5.1). The same door and the same scope as
  /// the mint (`terminal.attach`, local to that desktop's fieldd), and the same
  /// rule as `openTerminalTicket`: the OWNER's door, and the answer comes back
  /// unread.
  /// *Corrected 2026-11-06 (SP-7b's 7c-2): the same rule, and so the HOME's
  /// door, `{device}` added for another desktop's session. The owner still
  /// CASes it, on the ledger of the phone as one client (7c-1).*
  public func renewTerminalGrant(
    on deviceId: String, sessionId: String, expectGeneration: Int64, requestId: String
  ) async throws -> JSONValue {
    try await homeAsk(
      "terminal.renewAttach", on: deviceId,
      params: [
        "sessionId": .string(sessionId),
        "expectGeneration": .int(expectGeneration),
        "requestId": .string(requestId),
      ],
      refusal: Self.noTerminalDoor)
  }

  /// IOS-4c — RESUME an ended run, over the desktop that owns it.
  /// *Corrected 2026-11-06 (SP-7b's 7c-2): asked of the HOME's door, `{device}`
  /// added for another desktop's run, which the home forwards whole (DS-4); the
  /// owner still resumes it.*
  ///
  /// The answer carries the NEW run, and this deliberately does not put it on
  /// the field: the board is the fold's to publish, and a row invented here
  /// would be a body the desktop has not agreed exists. The next snapshot or
  /// delta shows it, which is a beat later and true.
  @discardableResult
  public func resume(runtimeRunId: String, on deviceId: String) async throws -> JSONValue {
    try await homeAsk(
      "agent.resume", on: deviceId, params: ["runtimeRunId": .string(runtimeRunId)],
      refusal: FieldProductError(
        kind: "UNAVAILABLE", message: "no door to \(deviceId)", retryable: false))
  }

  /// SP-7b's 7c-2 (D-c2 (a), VF-PM 2026-11-06 23:17Z) — an ask about a session or a run, asked of
  /// the HOME's door: `params` as they are for the home's own, `device` added for another desktop's,
  /// which the home forwards whole to that desktop (DS-4's `forwardVia`), as F1b's approval rides it.
  /// The owner still answers — it mints, CASes and resumes — and its answer or its honest refusal
  /// comes back unread. No second door is opened, and there is no owner-door fallback: two roads for
  /// one ask is what FW-R6 retires. With no home, `refusal`: the phone re-homes, and the next ask
  /// goes there.
  private func homeAsk(
    _ method: String, on deviceId: String, params: [String: JSONValue], refusal: FieldProductError
  ) async throws -> JSONValue {
    guard let home, let homeClient else { throw refusal }
    var params = params
    if deviceId != home { params["device"] = .string(deviceId) }
    return try await homeClient.call(method, params: .object(params))
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
  /// and closed when the ask returns. (Since 7c-2, 2026-11-06, Files' alone: a
  /// ticket, its renewal and Resume ride the home, `homeAsk`.) It counts against the phone's budget like
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
        hostname: peer.hostname, tailnetIPs: peer.tailnetIPs, magicDNSSuffix: magicDNSSuffix,
        dnsName: peer.dnsName)
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
        askHomeForPerson()
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
    personAsked.remove(deviceId)
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
    // Q-P2 (§3.7) — a home that refused the remote cut, inside its ladder, gives way to a desktop that may serve it.
    // It still answers, so it is left standing ("connected · the field was refused: …"), never downgraded.
    if let refused = remoteRefusals[current], refused.retryAt > now(),
      let pick = homeCandidate(excluding: current)
    {
      loseHome(because: "it cannot serve this phone's field: \(refused.reason)", stillAnswering: true)
      openHome(pick)
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
  /// refusal holds — nor the remote cut's ladder (Q-P2, §3.7) until it is due —
  /// in device order, the remembered home first when it is among them.
  private func homeCandidate(excluding current: String?) -> String? {
    let at = now()
    let candidates = found.keys.sorted().filter { deviceId in
      guard deviceId != current, let entry = found[deviceId], entry.doorURL != nil else {
        return false
      }
      guard case .answering = entry.admission else { return false }
      guard endpointRefusals[deviceId] == nil, foreignDoors[deviceId] == nil else { return false }
      if let retryAt = entry.stuckRetryAt, retryAt > at { return false }
      if let refusal = remoteRefusals[deviceId], refusal.retryAt > at { return false }
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
    // PG-3f (§4.3, Q-E6) — a new home forgets every report record: its open asks again
    reportRecords = [:]
    let client = FieldProductClient(url: url, transport: transport, options: doorOptions(deviceId))
    homeClient = client
    client.connect()
    trackHome(client, deviceId)
    refreshDesktops()
  }

  /// The home stops being the home: its subscription and its client go, its
  /// slot comes back to the budget, and the next pass asks every candidate
  /// afresh. The board copy STAYS — greyed, since no live home answers for it —
  /// until the next home's open replaces it (`RemoteMeshCopy.open` replaces
  /// everything).
  ///
  /// `stillAnswering` (Q-P2, §3.7): the home is left because it refused the
  /// remote cut, not because its door went. It keeps `.answering`, so its
  /// corner row stays "connected · the field was refused: …" and it is a
  /// candidate again when its ladder is due.
  private func loseHome(because reason: String, stillAnswering: Bool = false) {
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
    refusedWhileArming = false
    // PG-3f — a queued report for this home is dropped (each send checks its client too); the next home's open re-sends
    boardOpen = false
    endReportChain()
    let client = homeClient
    homeClient = nil
    client?.close()
    catalogAsked.remove(lost)
    personAsked.remove(lost)
    rosterAskedFor = nil
    // A door that answered once and has stopped answering is not "answering"
    // any more: it is weather, asked again on the next pass like every other
    // candidate. (A door that STOPPED this phone keeps its own word and its
    // backoff; a refused one keeps its refusal.)
    if !stillAnswering, case .answering = found[lost]?.admission, found[lost]?.stopped == nil {
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
          // PG-3f (Q-E6) — a new hello forgets the report records: the open that follows it asks again.
          self.reportRecords = [:]
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
        self.askHomeForPerson()
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

  /// IOS-8f — who the home's person is (`user.me`): asked once per connection,
  /// as the catalog is, and kept on the home's own entry so the corner reads it
  /// from `desktops` with nothing new to observe. A desktop older than the door
  /// answers NOT_FOUND, and one that serves no user UNAVAILABLE: neither is
  /// asked again on this connection, and the corner keeps dealing from the
  /// hello's user id. A retryable failure is asked again.
  private func askHomeForPerson() {
    guard let deviceId = home, let client = homeClient else { return }
    guard case .ready = client.state else {
      personAsked.remove(deviceId)
      return
    }
    guard !personAsked.contains(deviceId) else { return }
    personAsked.insert(deviceId)
    Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        let answer = try await client.call("user.me", as: UserMeResult.self)
        guard self.started, self.homeClient === client else { return }
        self.found[deviceId]?.person = DesktopPerson(answer)
        self.refreshDesktops()
      } catch {
        guard self.started, self.homeClient === client else { return }
        if (error as? FieldProductError)?.retryable == true {
          self.personAsked.remove(deviceId)
          self.note("\(deviceId) did not answer user.me: \(MeshModel.shortReason(error)) — asking again")
        } else {
          self.note(
            "\(deviceId) names no person for this phone: \(MeshModel.shortReason(error))"
              + " — the corner deals the face")
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

  /// The field's one subscription: `agent.subscribe {projection: "remote",
  /// scope: "mesh"}` on the home (DS-D13; PG-3e). Once open it STAYS open; an
  /// idle board costs nothing (§5: nothing changes, nothing is sent).
  ///
  /// Its frames pass through the client's table as `.stream`: the mesh board is
  /// one subscription carrying a chain per desktop, so the cursor is the copy's
  /// (`RemoteMeshCopy`) and a gap asks the table for the fresh snapshot, exactly
  /// as the table's own gaps do. No interval is written: `phoneRemote` names
  /// none, and the door floors a phone by its kind.
  private func armHomeSubscription() {
    guard !isPaused, homeSubscription == nil, let deviceId = home, let client = homeClient else {
      return
    }
    // SP-2 (c) — held until its window on the way back opens.
    guard resumeSlot == nil else { return }
    guard armingFor == nil else { return }
    guard case .ready = client.state else { return }
    // Q-P2 (§3.7) — a desktop whose door refused the remote cut is asked again on its own ladder, never per sweep.
    if let refusal = remoteRefusals[deviceId], refusal.retryAt > now() { return }
    let token = ObjectIdentifier(client)
    armingFor = token
    let epoch = armEpoch

    Task { @MainActor [weak self] in
      guard let self else { return }
      defer { if self.armingFor == token { self.armingFor = nil } }
      guard self.started, self.homeClient === client, self.homeSubscription == nil else { return }
      // N9 — the flag is this arm's alone: a subscribe that threw after its open was refused leaves nothing behind.
      self.refusedWhileArming = false
      do {
        let params = AgentSubscribeParams.phoneRemote
        let subscription = try await client.subscribe(
          "agent.subscribe",
          params: params.json,
          shape: SubscriptionShape(kind: .stream, minIntervalMs: params.minIntervalMs),
          // PG-9 (PG-L4.4) — every ask (this one, a gap's, a re-dial's replay) names the cursors the copy holds THEN:
          // the home answers a desktop the copy holds `resumed` or a delta, and nothing crosses again. A fresh copy
          // names none, so the first ask is `phoneRemote` byte for byte.
          paramsAtSend: { [weak self] in
            guard let self else { return params.json }
            return params.resuming(self.remote.cursors).json
          },
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
        //
        // PG-3e (§3.5) — and the FIRST open, which the client hands over inside `subscribe` before this line: when it
        // did not read, the handle is cancelled here, the moment it exists.
        guard self.started, !self.isPaused, self.armEpoch == epoch, self.homeClient === client,
          self.homeSubscription == nil, !self.refusedWhileArming
        else {
          self.refusedWhileArming = false
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
        // the note stays as the diagnostic.
        let reason = MeshModel.shortReason(error)
        self.note("\(deviceId) refused the field subscription: \(reason)")
        // Q-P2 (§3.7, the v2 check's M3 (a)) — the OLD HOME's own shape: a desktop from before `remote` answers
        // PRECONDITION_FAILED (fieldd's `malformedBoardAsk`). It goes on its own ladder, and the pass that follows
        // moves the field to a desktop that serves the cut when one answers. Every other refusal — a modern home's
        // FORBIDDEN_SCOPE "not yet" (UA-P-1d) among them — is asked again on the sweep, as before.
        if (error as? FieldProductError)?.kind == "PRECONDITION_FAILED" {
          self.recordRemoteRefusal(deviceId, reason: reason)
          self.refreshDesktops()
          self.sweepSoon()
          return
        }
        // the review's [10] (M3 (a)'s scope) — a refusal of another kind from a desktop on the ladder: it speaks the
        // new protocol now, so its record goes, and the corner says the door's own words
        self.remoteRefusals.removeValue(forKey: deviceId)
        self.found[deviceId]?.fieldRefusal = reason
        self.refreshDesktops()
      }
    }
  }

  /// The home's open answer — every desktop it lists, on its own chain — and every whole-mesh resync (PG-1c). It
  /// REPLACES everything the copy follows: a re-home or a repair never draws a row twice.
  private func applyMeshOpen(_ payload: JSONValue, from deviceId: String, client: FieldProductClient)
  {
    // A paused link applies nothing the door sends, and a closed home's late
    // answer must not put its board back behind the next home's.
    guard !isPaused, homeClient === client else { return }
    // PG-9 S4b — the open's apply on Instruments' Points of Interest, beside the Energy Log
    let signpost = SubscriptionTraffic.begin("mesh open")
    defer { signpost.end() }
    let open: AgentRemoteMeshOpen
    do {
      open = try AgentRemoteMeshOpen(json: payload)
    } catch {
      refuseOpen(deviceId, error)
      return
    }
    // PG-9 S4b — how the home answered each desktop: M1 reads an app switch's `resumed` here
    SubscriptionTraffic.note("door[\(deviceId)] mesh open: \(MeshOpenAnswers(open).line)")
    let outcome = remote.open(open, now: wireNow())
    boardFrom = deviceId
    for entry in open.devices {
      for refused in entry.snapshot?.refused ?? [] {
        note("\(entry.device) sent a row that did not read: \(refused.key ?? "(no key)"): \(refused.reason)")
      }
    }
    // the snapshot's replay broke the chain again: ask once more (a fresh open holds nothing to replay, so no loop)
    if case .gap(let why) = outcome {
      repair(why)
      return
    }
    // the open read: this desktop serves the cut, so its ladder and the corner's words go — and every desktop it
    // lists live with its board (S1)
    clearRemoteRefusal(deviceId)
    clearListedRefusals()
    boardOpen = true
    // PG-3f — a board that re-attached on a new epoch forgets its report record; the open's own rule sends after
    let cleared = !clearMovedReportRecords().isEmpty
    opening = true
    redraw(remote.publish())
    if cleared { refold() }
    opening = false
    resolveShown(send: false)
    reportAfterOpen()
  }

  /// PG-3e (§3.5) — an open that does not read is an honest, non-retryable state, never a gap: asking again reads the
  /// same board (3d's correction 6). The subscription ends — the handle cancelled, or, for the FIRST open (handed over
  /// inside `subscribe`, before the link holds the handle), cancelled the moment it lands — frames are no longer taken,
  /// the home's row says why, the desktop goes on its ladder, and the copy stays, greyed.
  private func refuseOpen(_ deviceId: String, _ error: any Error) {
    let reason = Self.boardRefusal(error, here: DeviceWord.current)
    note("\(deviceId) \(reason)")
    if let homeSubscription {
      homeSubscription.cancel()
      self.homeSubscription = nil
    } else {
      refusedWhileArming = true
    }
    gapWhileArming = nil
    boardFrom = nil
    boardOpen = false
    recordRemoteRefusal(deviceId, reason: reason)
    refreshDesktops()
    refold()
  }

  /// PG-3e's refusal in the corner's words (`fieldRefusal`, drawn "connected · the field was refused: …"): a board
  /// this device cannot read, the device named as its platform names it (`DeviceWord`; L4's word pass, 2026-11-06).
  nonisolated static func boardRefusal(_ error: any Error, here: DeviceWord) -> String {
    "it answered a board \(here.this) cannot read as the mesh: \(MeshModel.shortReason(error))"
  }

  /// Q-P2 (§3.7) — one more refusal of the remote cut by `deviceId`: its next ask waits out the stuck ladder.
  private func recordRemoteRefusal(_ deviceId: String, reason: String) {
    var entry = remoteRefusals[deviceId] ?? RemoteRefusal(reason: reason, retries: 0, retryAt: now())
    entry.reason = reason
    entry.retryAt = now().addingTimeInterval(seconds(schedule.stuckClientRetry(after: entry.retries)))
    entry.retries += 1
    remoteRefusals[deviceId] = entry
    found[deviceId]?.fieldRefusal = reason
  }

  /// The desktop serves the cut: its ladder goes, and so do the corner's words.
  private func clearRemoteRefusal(_ deviceId: String) {
    let held = remoteRefusals.removeValue(forKey: deviceId) != nil
    let said = found[deviceId]?.fieldRefusal != nil
    if said { found[deviceId]?.fieldRefusal = nil }
    if held || said { refreshDesktops() }
  }

  /// S1 — a desktop the copy lists LIVE with its board serves the field, whichever home answers for it: its ladder
  /// and its words go (an upgrade behind another home is heard here, not only when it is home again). Its words go
  /// with or without a record (the review's [9]: a former home's refusal of another kind wrote words and no record,
  /// and they outlived the new home's board drawing its agents live).
  private func clearListedRefusals() {
    for device in remote.devices where device.state == .live && device.epoch != nil {
      if remoteRefusals[device.device] != nil || found[device.device]?.fieldRefusal != nil {
        clearRemoteRefusal(device.device)
      }
    }
  }

  /// One later frame of the home's board, judged by the copy against its desktop's chain.
  private func applyMeshFrame(_ payload: JSONValue, from deviceId: String, client: FieldProductClient)
  {
    guard !isPaused, homeClient === client, boardFrom == deviceId else { return }
    let signpost = SubscriptionTraffic.begin("mesh frame")
    defer { signpost.end() }
    guard let frame = try? AgentRemoteMeshFrame(json: payload) else {
      // PG-3e — a frame that does not read is a gap, as the window's is: ask again (it was "dropped and named").
      repair("\(deviceId) sent a mesh frame that did not read")
      return
    }
    switch remote.frame(frame, now: wireNow()) {
    case .applied:
      clearListedRefusals()
      let heard = remote.publish()
      // PG-3f (the v2 check's S3) — a desktop's board re-attached on a new epoch: its report record goes, and the
      // card's row on it is reported at once (a steady connection may see no whole open for a long time). Only a card
      // whose OWN device moved, and only when the refold did not send that row already (the review's [5]/[11]: rule
      // 3, the same row twice sends once, and no resend on a frame).
      let moved = clearMovedReportRecords()
      if !moved.isEmpty {
        let before = shown
        refold()
        if let shown, shown == before, moved.contains(shown.device), boardOpen, homeIsLive {
          enqueueReport([shown.modelId], device: shown.device)
        }
      }
      redraw(heard)
    case .gap(let why): repair(why)
    // after a gap, before the fresh open: the copy's generation guard
    case .ignored: break
    }
  }

  /// A gap: the copy stands as drawn until the fresh open replaces it — a repair is not a reason to draw nothing.
  private func repair(_ why: String) {
    note("\(why) — re-subscribing")
    boardOpen = false
    if let homeSubscription {
      homeSubscription.resnapshot(because: why)
    } else {
      gapWhileArming = why
    }
  }

  /// A frame's publication: redraw when something drawn moved (3d's `Published.moved`). `publish()` runs only in the
  /// two handlers — it rewrites the window's carry-forward, once per frame — so `refold` re-maps without it.
  private func redraw(_ heard: RemoteMeshCopy.Published) {
    if heard.moved { refold() }
  }

  // MARK: The screen (PG-3f, design v2 §4)

  /// The open card's row on a device that cannot hear this phone is held out of unread while it is shown (§4.4): the
  /// owner never heard the phone, so the mark there is the owner's business.
  private func suppressed(_ row: RemoteFieldRow) -> Bool {
    guard let wantedVisualId, row.visualId == wantedVisualId else { return false }
    return reportRecords[row.device] != nil
  }

  /// Rule 1 (§4.2): the row under the card, by its visual id among the drawn rows. When it changes from (x, A) to
  /// (y, B): A's empty first when the device changes or the row goes, then y's report; on one device the replacing
  /// report alone. A recorded device is sent nothing. `send` is false inside an open, whose own rule sends once.
  private func resolveShown(send: Bool) {
    let next = wantedVisualId.flatMap { wanted in rows.first { $0.visualId == wanted } }
      .map { Shown(modelId: $0.id, device: $0.device) }
    guard next != shown else { return }
    let old = shown
    shown = next
    guard send, boardOpen, homeIsLive else { return }
    if let old, next?.device != old.device, reportRecords[old.device] == nil {
      enqueueReport([], device: old.device)
    }
    if let next, reportRecords[next.device] == nil {
      enqueueReport([next.modelId], device: next.device)
    }
  }

  /// Rule 2 (§4.2): after every open — the subscribe's, a whole-mesh resync, a re-subscribe after a gap or a resume —
  /// the effective row again, as the window resends after its open: the home's screens close with the board.
  private func reportAfterOpen() {
    guard let shown, reportRecords[shown.device] == nil else { return }
    enqueueReport([shown.modelId], device: shown.device)
  }

  /// Forgets the record of every device whose board now stands on another epoch (its fieldd restarted, perhaps
  /// upgraded), and answers those devices.
  private func clearMovedReportRecords() -> Set<String> {
    guard !reportRecords.isEmpty else { return [] }
    let epochs = Dictionary(remote.devices.map { ($0.device, $0.epoch) }) { first, _ in first }
    let moved = reportRecords.filter { device, record in (epochs[device] ?? nil) != record.epoch }.map(\.key)
    for device in moved { reportRecords.removeValue(forKey: device) }
    return Set(moved)
  }

  /// One report, on the chain. It captures the home's client: when it runs and that client is no longer the home (a
  /// re-home or a stop came between), it is dropped, and the next home's open re-sends. With no home, or one not
  /// ready, nothing is sent.
  private func enqueueReport(_ ids: [String], device: String) {
    guard let client = homeClient, case .ready = client.state else { return }
    let params = AgentReportShownParams(ids: ids, device: device)
    let previous = reportChain
    let generation = reportGeneration
    reportChain = Task { @MainActor [weak self] in
      await previous?.value
      guard let self, !Task.isCancelled, self.reportGeneration == generation, self.started, !self.isPaused,
        self.homeClient === client
      else { return }
      do {
        _ = try await client.call(AgentReportShownParams.method, params: params.json)
        self.heard(ReportAnswer(device: device, ids: ids, outcome: .reported))
      } catch {
        self.heardReportRefusal(error, device: device, ids: ids, client: client)
      }
    }
  }

  /// Ends the chain whole: the tail is cancelled and every send queued before it drops when it wakes.
  private func endReportChain() {
    reportGeneration &+= 1
    reportChain?.cancel()
    reportChain = nil
  }

  /// §4.3 — 3b's rule (`lastingRefusal`), read from the refusal's `details`, never its kind: `no-screen`
  /// is PRECONDITION_FAILED and transient. Lasting: `reason: "carried-cap"`, `locality: "local"`. Everything else —
  /// no screen yet, UNAVAILABLE, a deadline, a refusal with no details — is transient: nothing recorded, and the next
  /// open re-sends (bounded by opens; a recorded device would hide a phone bug).
  private func heardReportRefusal(_ error: any Error, device: String, ids: [String], client: FieldProductClient) {
    let details = (error as? FieldProductError)?.details
    let refusal: ReportRefusal? =
      if details?["reason"]?.stringValue == "carried-cap" { .carriedCap }
      else if details?["locality"]?.stringValue == "local" { .noScreens }
      else { nil }
    guard let refusal, homeClient === client else {
      heard(ReportAnswer(device: device, ids: ids, outcome: .transient))
      return
    }
    heard(ReportAnswer(device: device, ids: ids, outcome: .lasting(refusal)))
    if reportRecords[device] == nil {
      note("\(device) cannot hear this phone's reports: \(MeshModel.shortReason(error))")
    }
    let epoch = remote.devices.first { $0.device == device }?.epoch
    reportRecords[device] = ReportRecord(refusal: refusal, epoch: epoch)
    // N12 — the suppression shows at once
    refold()
  }

  /// The instant the copy stamps where the window stamps `new Date()` (a screened `incompatible`, a desktop first
  /// heard by its board): this link's own clock, so a test's is the copy's (the v2 check's N16).
  private func wireNow() -> String {
    now().formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
  }

  // MARK: The fold

  /// The window's rows, mapped to the swarm's bubbles. Called on every publication that moved, and on every change of
  /// what greys or hides them: the pause, the home's state, a foreign door, a catalog.
  private func refold() {
    let live = homeIsLive
    if live != fieldIsLive { fieldIsLive = live }
    // UA-P-5's law, kept under a home: a desktop THIS phone established is
    // somebody else's is held off the field even when a home lists it — the
    // door decides, and the home is not a second opinion that overrides it.
    let next = remote.drawn(hiding: Set(foreignDoors.keys))
    // Each row named by its own desktop's catalog (AC-D9) — its mark only (Q-E12).
    let mapped = next.map {
      fieldBubble(
        from: $0, fieldIsLive: live, catalog: desktopCatalog(for: $0.device), suppressUnread: suppressed($0))
    }
    if next != rows { rows = next }
    resolveShown(send: !opening)
    if mapped != bubbles {
      bubbles = mapped
      redraws += 1
    }
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
        // S1 — the ladder's words while it stands, wherever the desktop has been (a sleep forgets `entry`'s own)
        fieldRefusal: remoteRefusals[deviceId]?.reason ?? entry.fieldRefusal,
        userId: entry.userId,
        person: entry.person,
        board: standing(of: deviceId))
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
        userId: desktop.userId,
        person: desktop.person,
        board: standing(of: desktop.deviceId))
    }
  }

  /// PG-3e — a desktop's standing on the home's remote board, nil while the board does not list it.
  private func standing(of deviceId: String) -> AgentMeshDeviceState? {
    remote.devices.first { $0.device == deviceId }?.state
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
  /// the home's door (DS-8): the copy holds a chain for it.
  private func feed(of deviceId: String) -> FieldFeedSource {
    remote.devices.first { $0.device == deviceId }?.epoch != nil ? .door : FieldFeedSource.none
  }

  /// One report's answer, kept for the rows: the last 32.
  private func heard(_ answer: ReportAnswer) {
    reportAnswers.append(answer)
    if reportAnswers.count > 32 { reportAnswers.removeFirst() }
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
