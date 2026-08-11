import SwiftUI

/// Everything on the home screen that is a DECISION rather than a layout, kept
/// out of the views so it can be tested without a simulator — the shape
/// `TerminalSettingsModel` established on the terminal leg.
///
/// Each function here replaced a rule that was previously spelled out inline
/// across `HomeScreen`/`SessionCardView` and got it wrong; the doc comments
/// carry the finding, and `FieldHomeTests` pins it.
enum FieldHomeModel {

  // MARK: - Discovery

  /// What one change in (mesh, scene phase) means for the remote-session poll.
  ///
  /// The two stoppers are deliberately different verbs, and conflating them was
  /// the bug. Backgrounding **parks** a field whose door is still good: the
  /// Truffle runtime did not go anywhere, so the rows stay on screen and the
  /// poll resumes on return. A mesh that left **closes the door**:
  /// `MeshModel.connect()` builds a fresh runtime, so the directory the field
  /// was holding names a node that no longer exists, and keeping its rows would
  /// be the stage claiming a mesh answered when none did.
  ///
  /// Previously `.background` called `stop()` on the field but left the
  /// "already polling" flag set, so the resume branch was unreachable for the
  /// rest of the process's life: bubbles froze, and `noteHostReachable()` —
  /// the ONLY thing in this app that can end a `suspended(host absent)`
  /// attachment — could never fire again.
  enum DiscoveryAction: Equatable {
    /// Drop the source and the rows: the answer they came from is void.
    case closeDoor
    /// Stop the poll, keep the field standing: the door is still good.
    case park
    /// Build a source from the live directory and start polling.
    case open
    /// Restart the poll on the field that is already standing.
    case resume
    case none
  }

  static func discoveryAction(
    meshIsUp: Bool,
    phase: ScenePhase,
    polling: Bool,
    hasDoor: Bool
  ) -> DiscoveryAction {
    // Every stopper is a no-op when there is nothing to stop. Closing a door
    // that is not there is not honesty, it is churn: this runs on every mesh
    // AND scene tick, and an unconditional close would rebuild the field object
    // (and re-publish its snapshot) for changes that concern it not at all.
    guard meshIsUp else { return (hasDoor || polling) ? .closeDoor : .none }
    // `.inactive` is transient on iOS (a notification shade, the app switcher's
    // first frame); parking there would flap, so only a real background parks.
    if phase == .background { return polling ? .park : .none }
    guard phase == .active, !polling else { return .none }
    return hasDoor ? .resume : .open
  }

  // MARK: - The session card's face

  /// Which face the session card wears.
  ///
  /// The field's listing is NOT the authority on whether a session is alive
  /// while one is attached. `remoteFailureTolerance` withdraws every row after
  /// two consecutive failed asks — roughly four seconds at the poll's cadence,
  /// and with a single desktop on the mesh a single refused listing is already
  /// a failed ask — but a terminal that is still rendering frames has not ended
  /// because a listing timed out. So an attached card keeps its subject and
  /// lets the connection speak for itself.
  ///
  /// Only an UNATTACHED card has nothing better than the listing to go on, and
  /// there the row's departure is the only signal there is — so it stays the
  /// ended face, which is what it always was.
  enum CardFace: Equatable {
    case session
    case ended
  }

  static func cardFace(hasSubject: Bool, listed: Bool, attached: Bool) -> CardFace {
    guard hasSubject else { return .ended }
    return (listed || attached) ? .session : .ended
  }

  // MARK: - Writes

  /// Why this device cannot type, in the order the reasons are actually known.
  ///
  /// The two `readWrite` booleans on this path are DIFFERENT FACTS and were
  /// being conflated. A listing's `readWrite` rides in upstream's
  /// `TerminalHostAdvertisement` — a broadcast with no per-caller context — so
  /// it says the session is *shared* for writing, never that WE may write. The
  /// grant is per-attach: the client presents an access token on `AttachView`
  /// and the host answers `readWrite` on `ViewAttached`.
  ///
  /// So a device holding no write key cannot have been granted writes, and
  /// blaming the host for that ("this host is not sharing writes") blamed it
  /// for our own missing capability.
  static func viewOnlyReason(sessionSharesWrites: Bool, hasWriteKey: Bool) -> String {
    if !sessionSharesWrites { return "view only — this session is shared read-only" }
    if !hasWriteKey { return "view only — this device has no write key for this host" }
    return "view only — the host refused this device's write key"
  }

  /// The same facts before an attachment exists, where the third one cannot
  /// have happened yet: nothing has been presented to a host, so a refusal is
  /// not among the things that could be true.
  static func writeInvitation(sessionSharesWrites: Bool, hasWriteKey: Bool) -> String {
    guard sessionSharesWrites else { return "view only — this session is shared read-only" }
    return hasWriteKey
      ? "you can type here"
      : "view only — this device has no write key for this host"
  }
}
