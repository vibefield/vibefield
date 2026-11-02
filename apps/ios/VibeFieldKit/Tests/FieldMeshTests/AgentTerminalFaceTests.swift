import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// IOS-4c — the join, decided; TM-5 — decided from the JOIN ALONE.
//
// The hosts rows this used to cross-check against are gone: no phone ever
// subscribed to that store, nothing has served the per-host `list-sessions` it
// was filled from since TM-1, and since TM-2 the publisher drops the `terminal`
// join from a row while a device is not carrying its doors — so a join that is
// present already means what the cross-check was asking. Five faces and the
// rules between them, none of which wants a simulator.

private func join(
  device: String = "dev-studio", hosted: String = "local", session: String? = "pty-a41f",
  pending: Bool = false, exited: Bool = false
) -> AgentJoin {
  AgentJoin(
    deviceID: device, hosted: hosted, runtimeSessionID: session, pending: pending,
    exited: exited)
}

@Suite struct AgentTerminalFaceTests {
  /// The ordinary case: the desktop advertises this run's PTY, so the act is
  /// the IOS-3 attach and nothing about it is special.
  @Test func aPublishedTerminalOffersTheOrdinaryAttach() {
    let face = agentTerminalFace(join: join(), deviceName: "studio")
    #expect(
      face
        == .attach(
          AgentTerminalAddress(
            deviceID: "dev-studio", deviceName: "studio", sessionID: "pty-a41f")))
    #expect(face.offersAttach)
    #expect(!face.offersResume)
    #expect(face.note == nil)
    #expect(face.address?.sessionID == "pty-a41f")
  }

  /// The desktop's id is the JOIN's — the publisher's, the key a product client
  /// is filed under — and it is what the ticket will be minted over. A face
  /// that carried a name without the id would be a sentence with nowhere to
  /// dial.
  @Test func theAddressCarriesThePublishersDeviceId() {
    let face = agentTerminalFace(join: join(device: "dev-laptop"), deviceName: "laptop")
    #expect(face.address?.deviceID == "dev-laptop")
  }

  /// A desktop the fold has not named is still attachable — the id is what the
  /// mint takes — and the copy never puts a ULID in front of a person.
  @Test func anUnnamedDesktopIsStillAttachableAndIsNeverAULID() {
    let face = agentTerminalFace(join: join())
    #expect(face.offersAttach)
    #expect(face.address?.deviceName == "that desktop")
  }

  /// An ended run: `hosted: "none"`, RESUME and no attach.
  @Test func anEndedRunOffersResumeAndNoTerminal() {
    let face = agentTerminalFace(join: join(hosted: "none", session: nil), deviceName: "studio")
    #expect(face == .exited)
    #expect(face.offersResume)
    #expect(!face.offersAttach)
    #expect(face.note == "this run has ended — its terminal is gone")
  }

  /// The wire's word is the whole word: `hosted: "none"` with a session id
  /// still on the row is an ended run, and a face that read the id alone would
  /// offer a terminal the fold has already reported gone.
  @Test func hostedNoneEndsTheRunWhateverSessionIdRidesWithIt() {
    let face = agentTerminalFace(
      join: join(hosted: "none", session: "pty-a41f"), deviceName: "studio")
    #expect(face == .exited)
    #expect(!face.offersAttach)
  }

  /// AR-4's pending run: its PTY is real, so ATTACH is offered. RESUME is not
  /// — the run has not ended, and resuming it twice is not a thing to offer.
  @Test func aPendingRunAttachesAndIsNotResumed() {
    let face = agentTerminalFace(join: join(pending: true), deviceName: "studio")
    guard case .unobserved(let address) = face else {
      Issue.record("expected the unobserved face, got \(face)")
      return
    }
    #expect(address.sessionID == "pty-a41f")
    #expect(face.offersAttach)
    #expect(!face.offersResume)
    #expect(face.note == "live, unobserved — this run resumes when it next goes idle")
  }

  /// MF-1f's row: the process ended and the floor STILL lists its PTY. Both
  /// acts are real — read what it printed, or continue it — and this is the
  /// face §07's "resume after an exit" was asking for.
  @Test func anExitedRunWithItsPaneStillOnTheFloorOffersBothActs() {
    let face = agentTerminalFace(join: join(exited: true), deviceName: "studio")
    guard case .exitedWithPane(let address) = face else {
      Issue.record("expected the exited-with-pane face, got \(face)")
      return
    }
    #expect(address.sessionID == "pty-a41f")
    #expect(face.offersAttach)
    #expect(face.offersResume)
    #expect(face.note == "this run has ended — its terminal is still open to read")
  }

  /// And when the pane goes too, the same run falls back to the face with one
  /// act: there is nothing left to read.
  @Test func anExitedRunWhosePaneWentOffersOnlyResume() {
    let face = agentTerminalFace(
      join: join(hosted: "none", session: nil, exited: true), deviceName: "studio")
    #expect(face == .exited)
    #expect(!face.offersAttach)
    #expect(face.offersResume)
  }

  // MARK: TM-5a — the desktop's own word, before the tap

  /// The doors are out: the act is offered and nothing is claimed beyond that.
  @Test func aDesktopPublishingItsDoorsOffersTheAttach() {
    let face = agentTerminalFace(
      join: join(), deviceName: "studio", publishesTerminalDoors: true)
    #expect(face.offersAttach)
    #expect(face.note == nil)
  }

  /// The doors are down and the desktop SAID so, so the act is withheld and the
  /// face says why — the honest-states law's own shape: a missing act explains
  /// itself BEFORE the tap, not one tap later.
  @Test func aDesktopThatSaysItsDoorsAreDownEarnsTheSentenceAndNoAct() {
    let face = agentTerminalFace(
      join: join(), deviceName: "studio", publishesTerminalDoors: false)
    #expect(face == .notPublished(deviceName: "studio"))
    #expect(!face.offersAttach)
    #expect(!face.offersResume)
    #expect(face.address == nil)
    // The FLAG is named: "not published" tells a person nothing they can do.
    #expect(
      face.note
        == "terminal not published — studio is not carrying its terminal doors "
          + "onto the tailnet (FIELD_NATIVE_TERMINAL_MESH)")
  }

  /// An unnamed desktop still gets a sentence a person can read.
  @Test func anUnnamedDesktopWithItsDoorsDownIsNeverAULID() {
    let face = agentTerminalFace(join: join(), publishesTerminalDoors: false)
    #expect(face == .notPublished(deviceName: nil))
    #expect(face.note?.contains("that desktop") == true)
  }

  /// SILENCE IS NOT A REFUSAL. A slice that predates TM-2 carries no
  /// `terminalMesh`, and drawing that as "the doors are off" would put a
  /// sentence about a switch in front of a person whose desktop never had one.
  /// The act is offered and the MINT answers, in fieldd's own words.
  @Test func aDesktopThatSaidNothingIsOfferedTheActRatherThanARefusal() {
    let face = agentTerminalFace(
      join: join(), deviceName: "studio", publishesTerminalDoors: nil)
    #expect(face.offersAttach)
    #expect(face.note == nil)
    if case .notPublished = face {
      Issue.record("absence must not be drawn as a refusal, got \(face)")
    }
  }

  /// The ENDED run keeps its one act with the doors down.
  ///
  /// RESUME goes over the PRODUCT door, not the terminal's, so a transport
  /// complaint carrying no acts would be the wrong face: what is lost is the
  /// pane to READ, and that is exactly the difference between `exitedWithPane`
  /// and `exited`.
  @Test func anEndedRunOnADoorlessDesktopKeepsResumeAndLosesOnlyTheRead() {
    let down = agentTerminalFace(
      join: join(exited: true), deviceName: "studio", publishesTerminalDoors: false)
    #expect(down == .exited)
    #expect(down.offersResume)
    #expect(!down.offersAttach)

    let up = agentTerminalFace(
      join: join(exited: true), deviceName: "studio", publishesTerminalDoors: true)
    #expect(up.offersAttach)
    #expect(up.offersResume)
  }

  /// And a run with NO terminal is ended whatever the desktop publishes: saying
  /// "the doors are off" about a terminal that does not exist would be the
  /// wrong sentence, so the order of the two checks is load-bearing.
  @Test func aRunWithNoTerminalIsEndedRatherThanBlamedOnTheDoors() {
    let face = agentTerminalFace(
      join: join(hosted: "none", session: nil), deviceName: "studio",
      publishesTerminalDoors: false)
    #expect(face == .exited)
    #expect(face.note == "this run has ended — its terminal is gone")
  }

  /// A PENDING run is gated the same way — its PTY is real and just as
  /// unreachable when the doors are down.
  @Test func aPendingRunIsGatedByTheDoorsToo() {
    let face = agentTerminalFace(
      join: join(pending: true), deviceName: "studio", publishesTerminalDoors: false)
    #expect(face == .notPublished(deviceName: "studio"))
  }

  /// The scripted fleet has no desktop and no PTY, and its cards say nothing
  /// about terminals rather than offering one.
  @Test func noJoinOffersNothingAndClaimsNothing() {
    let face = agentTerminalFace(join: nil, deviceName: "studio")
    #expect(face == .noJoin)
    #expect(!face.offersAttach)
    #expect(!face.offersResume)
    #expect(face.note == nil)
  }
}

// RETIRED 2026-11-02 (PG-3e): `AgentJoinFoldTests` — the FIELD cut's join fold (`agentSnapshot(from:device:)`, which
// left with `AgentFieldProjection.swift`). The remote cut's join is pinned where it is built, `RemoteFieldBubbleTests`:
// the owner's device, the board's `terminal` (hosted, session), exited and pending (M5), the phone-only grey (M4), and
// a bare terminal's hollow with no facet (M6).
