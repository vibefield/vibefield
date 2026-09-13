import FieldAgents
import Foundation

// IOS-4c — G3's join, decided. An agent body's card wants the desktop's OWN
// PTY: the fold says which session and on which device, the hosts store says
// whether that desktop is advertising it, and this pure function is where the
// two meet.
//
// It is a function and not a method because every clause is a FACE the card
// has to wear honestly, and a face is exactly the kind of thing that should be
// decided without a simulator.

/// What an agent's card can offer for its terminal.
public enum AgentTerminalFace: Sendable, Equatable {
  /// The desktop is advertising this run's PTY. The act is the IOS-3 attach,
  /// unchanged — a managed agent's terminal is a remote terminal like any
  /// other once you know which one it is.
  case attach(AgentTerminalAddress)

  /// The run is live and its PTY is published, but fieldd is not observing it
  /// (AR-4's `pending`). Attach is offered — the terminal is real — and
  /// RESUME is not, because the run has not ended and resuming it twice is
  /// not a thing to offer.
  case unobserved(AgentTerminalAddress)

  /// The run has ended: `hosted: "none"`, no PTY to open. RESUME is the act,
  /// and it goes over the door.
  case exited

  /// The desktop is on the mesh and advertising no terminal for this run. Not
  /// a failure and not a dead button: the floor's terminal mesh is off, and
  /// the face says so by name.
  case notPublished(deviceName: String?)

  /// The feed gave no join at all — the scripted fleet, or a row from a
  /// producer that carries no terminal field. Nothing is offered and nothing
  /// is claimed.
  case noJoin
}

/// Everything an attach needs, resolved.
public struct AgentTerminalAddress: Sendable, Equatable {
  public let deviceID: String
  public let deviceName: String
  public let sessionID: String
  public let attachable: Bool
  public let readWrite: Bool

  public init(
    deviceID: String, deviceName: String, sessionID: String, attachable: Bool, readWrite: Bool
  ) {
    self.deviceID = deviceID
    self.deviceName = deviceName
    self.sessionID = sessionID
    self.attachable = attachable
    self.readWrite = readWrite
  }
}

/// The join, as one decision.
///
/// `hosts` is the phone's existing view of `terminal.v1.hosts` — the rows
/// `RemoteSessionField` already polls, which is deliberately the SAME source a
/// plain shell bubble attaches through. An agent's terminal is not a second
/// kind of terminal; it is one of those rows, found by id.
///
/// The match is on BOTH the device and the session id. A session id is the
/// floor's, so it is unique on its own desktop and says nothing about anyone
/// else's — matching on the id alone would let two desktops' sessions collide
/// the first time two machines are on the mesh.
public func agentTerminalFace(
  join: AgentJoin?, hosts: [RemoteSessionRow]
) -> AgentTerminalFace {
  guard let join else { return .noJoin }

  // An ended run has nothing to attach to, whatever the hosts store says. The
  // wire's word wins: a stale advertisement must not offer a terminal that the
  // fold has already reported gone.
  guard join.hasTerminal else { return .exited }
  guard let sessionID = join.runtimeSessionID else { return .exited }

  let row = hosts.first {
    $0.host.deviceID == join.deviceID && $0.session.sessionID == sessionID
  }
  guard let row else { return .notPublished(deviceName: hostName(for: join.deviceID, in: hosts)) }

  let address = AgentTerminalAddress(
    deviceID: row.host.deviceID,
    deviceName: row.host.deviceName,
    sessionID: row.session.sessionID,
    attachable: row.session.attachable,
    readWrite: row.session.readWrite)
  return join.pending ? .unobserved(address) : .attach(address)
}

/// The desktop's NAME, when any of its other sessions is on the field.
///
/// A phone that can say "studio is not publishing its terminals" is saying
/// something a person can act on; one that can only say "a desktop" is not.
/// Absent when this desktop advertises nothing at all, which is the case the
/// sentence has to survive.
private func hostName(for deviceID: String, in hosts: [RemoteSessionRow]) -> String? {
  hosts.first { $0.host.deviceID == deviceID }?.host.deviceName
}

// MARK: - The words

extension AgentTerminalFace {
  /// The card's status line for this face, or nil where the card's ordinary
  /// invitation already says it.
  ///
  /// The flag is NAMED on purpose. "Terminal not published" tells a person
  /// nothing they can do; naming `FIELD_NATIVE_TERMINAL_MESH` tells them
  /// exactly which switch on which machine, which is the difference between an
  /// honest state and a shrug.
  public var note: String? {
    switch self {
    case .attach:
      return nil
    case .unobserved:
      return "live, unobserved — this run resumes when it next goes idle"
    case .exited:
      return "this run has ended — its terminal is gone"
    case .notPublished(let deviceName):
      let who = deviceName ?? "that desktop"
      return
        "terminal not published — \(who)'s terminal mesh is off "
        + "(FIELD_NATIVE_TERMINAL_MESH)"
    case .noJoin:
      return nil
    }
  }

  /// Whether the card may offer ATTACH. A pending run's PTY is real, so it may.
  public var offersAttach: Bool {
    switch self {
    case .attach(let address), .unobserved(let address): return address.attachable
    case .exited, .notPublished, .noJoin: return false
    }
  }

  /// Whether the card may offer RESUME — only an ENDED run, and never a
  /// pending one, which has not ended and would be resumed twice.
  public var offersResume: Bool {
    if case .exited = self { return true }
    return false
  }

  public var address: AgentTerminalAddress? {
    switch self {
    case .attach(let address), .unobserved(let address): return address
    case .exited, .notPublished, .noJoin: return nil
    }
  }
}
