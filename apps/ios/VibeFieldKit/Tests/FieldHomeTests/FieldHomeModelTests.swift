import FieldMesh
import FieldTerminal
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

// MARK: - The card's terminal slot (fix7)

/// PJ-7's first phone run, S2: a hand-started agent's card said "no terminal
/// has been offered for this session" while its desktop pane was live. The
/// run's field row carried its terminal (fieldd: `hosted: "local"` and the
/// pane's session id, adopted runs included); the card had no act for it.
@Suite("fix7 — an agent's card opens its own terminal")
struct TerminalSlotTests {
  @Test("an agent's run whose face offers its terminal draws ATTACH — never the absence")
  func agentAttaches() {
    #expect(FieldHomeModel.terminalSlot(attached: false, remote: false, agentAttachable: true) == .agentInvitation)
  }

  @Test("a peer's session invites as before; attached is live; nothing to open is the absence, with its reason")
  func theOtherSlots() {
    #expect(FieldHomeModel.terminalSlot(attached: false, remote: true, agentAttachable: false) == .peerInvitation)
    #expect(FieldHomeModel.terminalSlot(attached: true, remote: false, agentAttachable: true) == .live)
    #expect(FieldHomeModel.terminalSlot(attached: true, remote: true, agentAttachable: false) == .live)
    #expect(FieldHomeModel.terminalSlot(attached: false, remote: false, agentAttachable: false) == .absence)
  }
}

// MARK: - The run's end under an attach (fix8)

/// PJ-7's second phone run: the card read "connecting over the mesh…" at
/// 03:52:07, sixteen seconds after its run had exited. The run's own face says
/// when it has ended; an attachment that has not gone live then stops.
@Suite("fix8 — a run that exits ends the attach the card is still making")
struct RunExitTests {
  static let address = AgentTerminalAddress(
    deviceID: "dev-studio", deviceName: "studio", sessionID: "sess-1")

  @Test("both ended faces end it — with a pane to read and without one")
  func endedFaces() {
    #expect(FieldHomeModel.runHasExited(.exited))
    #expect(FieldHomeModel.runHasExited(.exitedWithPane(Self.address)))
  }

  @Test("a live, unobserved, unpublished or join-less run does not")
  func otherFaces() {
    #expect(!FieldHomeModel.runHasExited(.attach(Self.address)))
    #expect(!FieldHomeModel.runHasExited(.unobserved(Self.address)))
    #expect(!FieldHomeModel.runHasExited(.notPublished(deviceName: "studio")))
    #expect(!FieldHomeModel.runHasExited(.noJoin))
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

/// The bug this suite was written for: the card read the LISTING's `readWrite`
/// and promised "you can type here". That boolean rides in a host advertisement
/// broadcast to the whole mesh — no per-caller context — so it says the session
/// is shared for writing, never that WE may write.
///
/// TM-3 (2026-09-14) removed the second half of the answer rather than fixing
/// it again: whether this device may type was a mirror-write key it held or did
/// not, and there is no key. The right to type is a claim in the attach grant,
/// so the pre-tap sentence is a function of the ONE fact the listing carries,
/// and the case it cannot know is named by the live attachment instead of
/// guessed at here. `viewOnlyReason` (never called by shipping code) and
/// `keyEntryOffered` (whose only caller was the card's ENTER KEY invitation)
/// went with the key.
@Suite("write claims")
struct WriteCopyTests {
  @Test("a read-only session is named as the read-only thing it is")
  func readOnlySessionNamesTheSession() {
    #expect(
      FieldHomeModel.writeInvitation(sessionSharesWrites: false)
        == "view only — this session is shared read-only")
  }

  @Test("a session shared for writing invites typing, with nothing to obtain first")
  func sharedSessionInvitesTyping() {
    #expect(FieldHomeModel.writeInvitation(sessionSharesWrites: true) == "you can type here")
  }

  /// A total function of one boolean, asserted as one: the sentence names the
  /// SESSION's sharing in both directions and never blames the host for
  /// something this device was missing, which is what the old third arm did.
  @Test("the sentence is decided by the listing alone, and says nothing else")
  func theInvitationIsTotal() {
    for shared in [true, false] {
      let copy = FieldHomeModel.writeInvitation(sessionSharesWrites: shared)
      #expect(!copy.isEmpty)
      #expect(!copy.contains("write key"))
      #expect(copy.hasPrefix("view only") == !shared)
    }
  }
}


// MARK: - The input card's face

/// K-D2, pinned: the card exists for exactly one state. Every other phase
/// renders nothing rather than a keyboard that cannot reach a terminal — the
/// disabled-affordance shape D-i6 forbids.
@Suite("the input card's face")
struct InputCardFaceTests {
  @Test("a live session this device may type into shows the card")
  func liveAndWritable() {
    #expect(FieldHomeModel.inputCardFace(phase: .live, acceptsInput: true) == .shown)
  }

  /// The honest view-only line already says why. A rail under it would be a
  /// promise the next tap breaks.
  @Test("a live view-only session shows no card")
  func liveViewOnly() {
    #expect(FieldHomeModel.inputCardFace(phase: .live, acceptsInput: false) == .hidden)
  }

  /// `acceptsInput` is composed upstream and can outlive the phase that made
  /// it true by one observation; the phase is asked for too so a suspended
  /// session cannot hold a keyboard up on a stale grant.
  @Test("no other phase shows a card, whatever the grant says")
  func everyOtherPhaseHides() {
    let phases: [TerminalPhase] = [
      .idle,
      .connecting,
      .suspended("paused in the background"),
      .ended("the host closed it"),
      .failed("the mesh is not up on this device"),
    ]
    for phase in phases {
      #expect(FieldHomeModel.inputCardFace(phase: phase, acceptsInput: true) == .hidden)
      #expect(FieldHomeModel.inputCardFace(phase: phase, acceptsInput: false) == .hidden)
    }
  }
}
