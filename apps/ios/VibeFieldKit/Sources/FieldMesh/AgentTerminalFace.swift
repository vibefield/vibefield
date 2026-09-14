import FieldAgents
import Foundation

// IOS-4c — G3's join, decided. An agent body's card wants the desktop's OWN
// PTY, and the fold says which session and on which device.
//
// It is a function and not a method because every clause is a FACE the card
// has to wear honestly, and a face is exactly the kind of thing that should be
// decided without a simulator.
//
// TM-5 took away the hosts rows this used to cross-check against — a store no
// phone ever subscribed to, filled by a per-host `list-sessions` over a TSP1
// port that no floor serves since TM-1.
//
// **TM-5a put a pre-attach answer back, from a different wire.** TM-5 left the
// fact to the mint alone: `terminal.openTicket` refuses `doors_not_published`
// in fieldd's own words, one tap later and authoritative. The honest-states law
// wants more than that — a missing act says why BEFORE the tap — and the fact
// is already on a wire this phone reads: `device.list` carries
// `DeviceCapabilities.terminalMesh` (TM-2/MF-1l), the floor's own word that its
// doors are published, and `FieldLink` reads that store for its desktops.
//
// It is not redundant with the mint, because the two answers have different
// reach. The STORE-published board already drops the `terminal` join while the
// doors are down (`agent-field-publisher.ts`'s `attachableRows`), so for those
// rows a present join implies publication. The DOOR-fed board does not:
// `agent.subscribe {projection: "field"}` runs `createFieldSubscription` over
// the same projection with no such filter, so a board that arrived over a
// desktop's own door carries its joins regardless. That is exactly the case a
// pre-attach face has to cover, and the capability is what covers it.

/// What an agent's card can offer for its terminal.
public enum AgentTerminalFace: Sendable, Equatable {
  /// The desktop is hosting this run's PTY. The act is the attach.
  case attach(AgentTerminalAddress)

  /// The run is live and its PTY is real, but fieldd is not observing it
  /// (AR-4's `pending`). Attach is offered — the terminal is there — and
  /// RESUME is not, because the run has not ended and resuming it twice is
  /// not a thing to offer.
  case unobserved(AgentTerminalAddress)

  /// The run has ended and its pane is gone with it: `hosted: "none"`, nothing
  /// to open. RESUME is the only act, and it goes over the door.
  case exited

  /// MF-1f's row: the process ended and the floor STILL lists its PTY. Both
  /// acts are real — attach to read what it printed, resume to continue it —
  /// and this is the face §07's "resume after an exit" was asking for.
  case exitedWithPane(AgentTerminalAddress)

  /// This desktop SAID its terminal doors are not published on the tailnet, so
  /// an attach has nowhere to go. Not a failure and not a dead button: the
  /// floor is running the terminal and is not carrying it onto the mesh, and
  /// the face says so by name.
  case notPublished(deviceName: String?)

  /// The feed gave no join at all — the scripted fleet, or a producer that
  /// carries no terminal field. Nothing is offered and nothing is claimed.
  case noJoin
}

/// Everything an attach needs, resolved.
///
/// Three fields since TM-5: the two ids the mint takes, and the name a sentence
/// can use. `attachable` and `readWrite` left with the hosts rows that used to
/// carry them, and neither is a loss — an attach's answer is the TICKET (a
/// desktop that will not hand one out says so in its own words), and the right
/// to type is the attach grant's `rights`, which the CELL accepts or downgrades
/// per client per session. Both were guesses made two seconds early; both are
/// now facts that arrive with the thing they describe.
public struct AgentTerminalAddress: Sendable, Equatable {
  public let deviceID: String
  public let deviceName: String
  public let sessionID: String

  public init(deviceID: String, deviceName: String, sessionID: String) {
    self.deviceID = deviceID
    self.deviceName = deviceName
    self.sessionID = sessionID
  }
}

/// The join, as one decision.
///
/// `deviceName` is the field's own name for the desktop the row came from (the
/// devices store's `name`), passed in rather than looked up because this
/// function knows about one run and nothing else. Absent = the fold has not
/// named it, and the copy says "that desktop" rather than a ULID.
/// `publishesTerminalDoors` is `DeviceCapabilities.terminalMesh` for the
/// desktop this row came from, and it is deliberately a THREE-valued argument:
///
/// - `true` — the doors are out; the act is offered and nothing is claimed.
/// - `false` — the desktop said they are not; the act is withheld and the face
///   says why, which is the whole of TM-5a.
/// - `nil` — the slice did not carry the field (a peer older than TM-2). NOT a
///   refusal: the act is offered and the MINT answers, in fieldd's own words.
///   Reading absence as a refusal here would put a sentence about a switch in
///   front of a person whose desktop never had one, and the contract's
///   "absence reads as false" is a rule about promising REACHABILITY — which
///   offering a tap is not, because the tap's answer comes from the daemon.
///
/// An ENDED run is decided before any of this: a session that is gone has
/// nothing to attach to whatever the desktop publishes, and saying "the doors
/// are off" about a terminal that does not exist would be the wrong sentence.
public func agentTerminalFace(
  join: AgentJoin?, deviceName: String? = nil, publishesTerminalDoors: Bool? = nil
) -> AgentTerminalFace {
  guard let join else { return .noJoin }

  // An ended run has nothing to attach to. The wire's word wins.
  guard join.hasTerminal else { return .exited }
  guard let sessionID = join.runtimeSessionID else { return .exited }

  let address = AgentTerminalAddress(
    deviceID: join.deviceID,
    deviceName: deviceName ?? "that desktop",
    sessionID: sessionID)
  // The desktop's own word, when it gave one. `nil` is not a no — see above.
  let doorsAreDown = publishesTerminalDoors == false

  if join.exited {
    // MF-1f's row, gated: a pane is only readable THROUGH a door, so with the
    // doors down there is nothing to read. The run has still ENDED, and RESUME
    // is the PRODUCT door's verb rather than the terminal's — so this falls
    // back to the face with exactly that one act, instead of to a transport
    // complaint carrying none.
    return doorsAreDown ? .exited : .exitedWithPane(address)
  }
  if doorsAreDown { return .notPublished(deviceName: deviceName) }
  return join.pending ? .unobserved(address) : .attach(address)
}

// MARK: - The words

extension AgentTerminalFace {
  /// The card's status line for this face, or nil where the card's ordinary
  /// invitation already says it.
  public var note: String? {
    switch self {
    case .attach:
      return nil
    case .unobserved:
      return "live, unobserved — this run resumes when it next goes idle"
    case .exited:
      return "this run has ended — its terminal is gone"
    case .exitedWithPane:
      return "this run has ended — its terminal is still open to read"
    case .notPublished(let deviceName):
      // The FLAG is named on purpose. "Terminal not published" tells a person
      // nothing they can do; naming the switch tells them which one on which
      // machine, which is the difference between an honest state and a shrug.
      // It is still the right name under T — TM-1 made `cell_mode`
      // unconditional and left this flag meaning exactly one thing: whether the
      // terminal doors are published on the tailnet.
      let who = deviceName ?? "that desktop"
      return
        "terminal not published — \(who) is not carrying its terminal doors "
        + "onto the tailnet (FIELD_NATIVE_TERMINAL_MESH)"
    case .noJoin:
      return nil
    }
  }

  /// Whether the card may offer ATTACH. A pending run's PTY is real, so it may.
  ///
  /// Every face that HAS an address offers it now: whether the attach lands is
  /// the ticket's answer and nobody else's, and a button greyed out on a
  /// two-second-old listing was refusing on the desktop's behalf.
  public var offersAttach: Bool { address != nil }

  /// Whether the card may offer RESUME. Both ENDED faces do — with a pane to
  /// read or without one — and a pending run never does: it has not ended, and
  /// resuming it twice is not a thing to offer.
  ///
  /// `notPublished` does NOT, and that is the honest answer rather than a
  /// conservative one: the face is about a TRANSPORT, and this function cannot
  /// see whether the run behind it has ended. A resume offered here would be
  /// offered on every live run whose desktop has the doors off.
  public var offersResume: Bool {
    switch self {
    case .exited, .exitedWithPane: return true
    case .attach, .unobserved, .notPublished, .noJoin: return false
    }
  }

  public var address: AgentTerminalAddress? {
    switch self {
    case .attach(let address), .unobserved(let address), .exitedWithPane(let address):
      return address
    case .exited, .notPublished, .noJoin: return nil
    }
  }
}
