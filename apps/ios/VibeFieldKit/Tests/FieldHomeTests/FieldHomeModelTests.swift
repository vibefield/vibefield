import SwiftUI
import Testing

@testable import FieldHome

// MARK: - Discovery

/// The bug this suite exists for: `.background` stopped the poll but left the
/// "already polling" flag set, so the resume branch was unreachable for the
/// rest of the process. Bubbles froze, and `noteHostReachable()` — the only
/// thing in the app that can end a `suspended(host absent)` attachment — could
/// never fire again.
@Suite("discovery lifecycle")
struct DiscoveryActionTests {
  @Test("backgrounding parks a running poll")
  func backgroundParks() {
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .background, polling: true, hasDoor: true) == .park)
  }

  /// THE regression. Foreground after a park must resume — not fall into
  /// `.none` because something still believes the poll is running.
  @Test("returning to the foreground resumes the parked poll")
  func foregroundResumes() {
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .active, polling: false, hasDoor: true) == .resume)
  }

  /// The parked field is REUSED rather than rebuilt: a fresh one would empty
  /// the stage and re-spawn every bubble on the way back from the background.
  @Test("a foreground with no door opens one instead of resuming")
  func foregroundWithoutDoorOpens() {
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .active, polling: false, hasDoor: false) == .open)
  }

  @Test("a poll already running is left alone")
  func alreadyPollingIsIdempotent() {
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .active, polling: true, hasDoor: true) == .none)
  }

  /// A mesh that left invalidates the door itself — `MeshModel.connect()`
  /// builds a fresh runtime, so the held directory names a node that is gone.
  /// Parking it would keep rows from an answer that is now void.
  @Test("a mesh that left closes the door, whatever the scene is doing")
  func meshDownClosesDoor() {
    for phase in [ScenePhase.active, .inactive, .background] {
      #expect(
        FieldHomeModel.discoveryAction(
          meshIsUp: false, phase: phase, polling: true, hasDoor: true) == .closeDoor)
      #expect(
        FieldHomeModel.discoveryAction(
          meshIsUp: false, phase: phase, polling: false, hasDoor: true) == .closeDoor)
    }
  }

  /// Idempotence, and it is not cosmetic: this decision runs on every mesh and
  /// scene tick, so a stopper that fired unconditionally would rebuild the
  /// field object — and re-publish its snapshot — for changes that concern it
  /// not at all.
  @Test("stoppers are no-ops when there is nothing to stop")
  func stoppersAreIdempotent() {
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: false, phase: .active, polling: false, hasDoor: false) == .none,
      "no door and no poll: nothing to close")
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .background, polling: false, hasDoor: true) == .none,
      "already parked")
  }

  /// `.inactive` is transient on iOS (a notification shade, the app switcher's
  /// first frame). Parking there would flap the poll on every glance.
  @Test("inactive neither parks nor starts")
  func inactiveIsTransient() {
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .inactive, polling: true, hasDoor: true) == .none)
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .inactive, polling: false, hasDoor: true) == .none)
  }

  /// The invariant the flag exists to hold: park then resume returns to
  /// polling, for any door state that survives the round trip.
  @Test("park → resume is a closed loop")
  func parkResumeRoundTrip() {
    var polling = true
    #expect(
      FieldHomeModel.discoveryAction(
        meshIsUp: true, phase: .background, polling: polling, hasDoor: true) == .park)
    polling = false
    let back = FieldHomeModel.discoveryAction(
      meshIsUp: true, phase: .active, polling: polling, hasDoor: true)
    #expect(back == .resume)
  }
}

// MARK: - The card's face

/// The bug: the card looked its subject up in the live field every update and
/// rendered "SESSION ENDED — this session left the field" whenever the lookup
/// missed, with no reference to whether a terminal was attached and rendering.
@Suite("session card face")
struct CardFaceTests {
  @Test("a listed session shows itself")
  func listedShowsSession() {
    #expect(
      FieldHomeModel.cardFace(hasSubject: true, listed: true, attached: false) == .session)
    #expect(
      FieldHomeModel.cardFace(hasSubject: true, listed: true, attached: true) == .session)
  }

  /// THE regression. Two failed asks (~4 s, and with one desktop on the mesh a
  /// single refused listing is already a failed ask) withdraw every remote row.
  /// A terminal that is still rendering frames has not ended because discovery
  /// blinked — and the old rule also unmounted the live surface with the copy.
  @Test("an attached session survives its listing being withdrawn")
  func attachedSurvivesUnlisting() {
    #expect(
      FieldHomeModel.cardFace(hasSubject: true, listed: false, attached: true) == .session)
  }

  /// The other half, deliberately unchanged: with nothing attached there is no
  /// better authority than the listing, so its departure IS the signal.
  @Test("an unattached session that leaves the field is ended")
  func unattachedUnlistingEnds() {
    #expect(
      FieldHomeModel.cardFace(hasSubject: true, listed: false, attached: false) == .ended)
  }

  @Test("no subject is always the ended face")
  func noSubjectEnds() {
    for listed in [true, false] {
      for attached in [true, false] {
        #expect(
          FieldHomeModel.cardFace(hasSubject: false, listed: listed, attached: attached) == .ended)
      }
    }
  }
}

// MARK: - Writes

/// The bug: the card read the LISTING's `readWrite` and promised "you can type
/// here". That boolean rides in upstream's `TerminalHostAdvertisement` — a
/// broadcast with no per-caller context — so it says the session is shared for
/// writing, never that we may write. The grant is per-attach (`AttachView`'s
/// access token → `ViewAttached`'s `readWrite`), and this app holds no key yet,
/// so the next tap answered view-only and blamed the host for it.
@Suite("write claims")
struct WriteCopyTests {
  @Test("a read-only session is named as the read-only thing it is")
  func readOnlySessionNamesTheSession() {
    let invitation = FieldHomeModel.writeInvitation(
      sessionSharesWrites: false, hasWriteKey: false)
    #expect(invitation == "view only — this session is shared read-only")
    // Holding a key changes nothing about a session nobody shares for writing.
    #expect(
      FieldHomeModel.writeInvitation(sessionSharesWrites: false, hasWriteKey: true) == invitation)
  }

  /// THE regression: a writable session plus no key is view-only, and says so
  /// BEFORE the tap rather than after it.
  @Test("a writable session with no key never promises typing")
  func writableWithoutKeyDoesNotPromise() {
    let invitation = FieldHomeModel.writeInvitation(
      sessionSharesWrites: true, hasWriteKey: false)
    #expect(invitation == "view only — this device has no write key for this host")
    #expect(!invitation.contains("you can type"))
  }

  @Test("a writable session with a key is the one case that invites typing")
  func writableWithKeyInvites() {
    #expect(
      FieldHomeModel.writeInvitation(sessionSharesWrites: true, hasWriteKey: true)
        == "you can type here")
  }

  /// The post-attach half must agree with what the invitation said, and must
  /// not blame the host for a capability this device never had.
  @Test("view-only blames the host only when a key was actually presented")
  func viewOnlyAttributesCorrectly() {
    #expect(
      FieldHomeModel.viewOnlyReason(sessionSharesWrites: true, hasWriteKey: false)
        == "view only — this device has no write key for this host")
    #expect(
      FieldHomeModel.viewOnlyReason(sessionSharesWrites: true, hasWriteKey: true)
        == "view only — the host refused this device's write key")
    #expect(
      FieldHomeModel.viewOnlyReason(sessionSharesWrites: false, hasWriteKey: true)
        == "view only — this session is shared read-only")
  }

  /// The whole point of splitting the two booleans: with no key, no
  /// combination of facts produces a promise to type.
  @Test("no keyless combination can promise typing")
  func keylessNeverPromises() {
    for shared in [true, false] {
      #expect(
        FieldHomeModel.writeInvitation(sessionSharesWrites: shared, hasWriteKey: false)
          .hasPrefix("view only"))
      #expect(
        FieldHomeModel.viewOnlyReason(sessionSharesWrites: shared, hasWriteKey: false)
          .hasPrefix("view only"))
    }
  }
}
