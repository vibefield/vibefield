import FieldAgents
import Foundation

// IOS-4c — G3's join, decided. An agent body's card wants the desktop's OWN
// PTY, and the fold says which session and on which device.
//
// It is a function and not a method because every clause is a FACE the card
// has to wear honestly, and a face is exactly the kind of thing that should be
// decided without a simulator.
//
// TM-5 took its second argument away. It used to cross-check the fold against
// the rows `RemoteSessionField` polled out of `terminal.v1.hosts` — a store no
// phone ever subscribed to, filled by a per-host `list-sessions` over a TSP1
// port that no floor serves since TM-1. The join is now the only source, and it
// is a better one: since TM-2 the publisher DROPS the `terminal` join from a
// row while this device is not carrying its doors onto the tailnet, so a join
// that is present is a door that was published. What a stale advertisement used
// to be asked is now answered by the mint — `terminal.openTicket` refuses with
// `doors_not_published` in fieldd's own words — and a refusal that arrives one
// tap later beats a promise made from a listing two seconds old.

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
public func agentTerminalFace(join: AgentJoin?, deviceName: String? = nil) -> AgentTerminalFace {
  guard let join else { return .noJoin }

  // An ended run has nothing to attach to. The wire's word wins.
  guard join.hasTerminal else { return .exited }
  guard let sessionID = join.runtimeSessionID else { return .exited }

  let address = AgentTerminalAddress(
    deviceID: join.deviceID,
    deviceName: deviceName ?? "that desktop",
    sessionID: sessionID)
  if join.exited { return .exitedWithPane(address) }
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
  public var offersResume: Bool {
    switch self {
    case .exited, .exitedWithPane: return true
    case .attach, .unobserved, .noJoin: return false
    }
  }

  public var address: AgentTerminalAddress? {
    switch self {
    case .attach(let address), .unobserved(let address), .exitedWithPane(let address):
      return address
    case .exited, .noJoin: return nil
    }
  }
}
