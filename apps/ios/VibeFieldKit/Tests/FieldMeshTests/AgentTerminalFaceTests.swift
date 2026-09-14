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

@Suite struct AgentJoinFoldTests {
  private func fieldRow(
    id: String = "run-1", hosted: String? = "local", session: String? = "pty-a41f",
    pending: String? = nil, device: String = "dev-fieldd"
  ) throws -> AgentFieldRow {
    var fields: [String: JSONValue] = [
      "runtimeRunId": .string(id), "revision": .int(1), "kind": .string("claude"),
      "label": .string("Claude Code"), "tier": .string("managed"),
      "device": .string(device), "status": .string("idle"),
      "statusSince": .string("2026-09-13T18:42:11.000Z"),
      "stateChangedAt": .string("2026-09-13T18:42:11.000Z"),
      "createdAt": .string("2026-09-13T18:03:52.000Z"),
      "alive": .bool(true), "blockers": .array([]),
    ]
    if let pending { fields["pending"] = .string(pending) }
    if let hosted {
      var terminal: [String: JSONValue] = ["hosted": .string(hosted)]
      if let session { terminal["runtimeSessionId"] = .string(session) }
      fields["terminal"] = .object(terminal)
    }
    return try AgentFieldRow(json: .object(fields))
  }

  /// The join's device is the PUBLISHER's, not the row's own `device` field.
  /// It has to be the id a product client and the devices store are filed
  /// under, and only the caller knows which desktop it heard this from.
  @Test func theJoinTakesThePublishersDeviceId() throws {
    let snapshot = try #require(agentSnapshot(from: fieldRow(), device: "dev-mesh"))
    #expect(snapshot.join?.deviceID == "dev-mesh")
    #expect(snapshot.join?.runtimeSessionID == "pty-a41f")
    #expect(snapshot.join?.hosted == "local")
    #expect(snapshot.join?.pending == false)
    #expect(snapshot.join?.hasTerminal == true)
  }

  /// A caller that did not say falls back to the row's own word, which is the
  /// best available and is marked as the fallback it is.
  @Test func withoutAPublisherTheRowsOwnDeviceStands() throws {
    let snapshot = try #require(agentSnapshot(from: fieldRow()))
    #expect(snapshot.join?.deviceID == "dev-fieldd")
  }

  /// MF-1f: an exited run KEEPS its row while the floor lists its PTY. Reading
  /// `alive` alone would drop exactly the row that change went to the trouble
  /// of keeping — the pane would vanish from under a card reading it.
  @Test func anExitedRunWithAPaneStaysOnTheField() throws {
    let row = try AgentFieldRow(
      json: .object([
        "runtimeRunId": .string("run-exited"), "revision": .int(9),
        "kind": .string("claude"), "label": .string("Claude Code"),
        "tier": .string("managed"), "device": .string("dev-fieldd"),
        "status": .string("idle"),
        "statusSince": .string("2026-09-13T18:42:11.000Z"),
        "stateChangedAt": .string("2026-09-13T18:42:11.000Z"),
        "createdAt": .string("2026-09-13T18:03:52.000Z"),
        "alive": .bool(false), "blockers": .array([]),
        "terminal": .object([
          "hosted": .string("local"), "runtimeSessionId": .string("pty-a41f"),
        ]),
      ]))
    let snapshot = try #require(agentSnapshot(from: row, device: "dev-mesh"))
    #expect(snapshot.join?.exited == true)
    #expect(snapshot.join?.pending == false)
    #expect(snapshot.join?.runtimeSessionID == "pty-a41f")
    // And it draws — a row that did not would take the pane off the field.
    #expect(fieldBubble(from: snapshot) != nil)
  }

  /// A run that is dead AND has no pane is the only row that leaves.
  @Test func aDeadRunWithNoPaneIsTheOnlyOneThatLeaves() throws {
    #expect(try agentSnapshot(from: fieldRow(hosted: "none", session: nil)) != nil)
    let gone = try AgentFieldRow(
      json: .object([
        "runtimeRunId": .string("run-gone"), "revision": .int(1),
        "kind": .string("claude"), "label": .string("Claude Code"),
        "tier": .string("managed"), "device": .string("dev-fieldd"),
        "status": .string("idle"),
        "statusSince": .string("2026-09-13T18:42:11.000Z"),
        "stateChangedAt": .string("2026-09-13T18:42:11.000Z"),
        "createdAt": .string("2026-09-13T18:03:52.000Z"),
        "alive": .bool(false), "blockers": .array([]),
        "terminal": .object(["hosted": .string("none")]),
      ]))
    #expect(agentSnapshot(from: gone) == nil)
  }

  @Test func aRowWithNoTerminalJoinsAsNone() throws {
    let snapshot = try #require(agentSnapshot(from: fieldRow(hosted: nil, session: nil)))
    #expect(snapshot.join?.hosted == "none")
    #expect(snapshot.join?.hasTerminal == false)
    #expect(agentTerminalFace(join: snapshot.join) == .exited)
  }

  @Test func aPendingRowCarriesItsFlagIntoTheJoin() throws {
    let snapshot = try #require(
      agentSnapshot(from: fieldRow(pending: "resume-when-idle"), device: "dev-mesh"))
    #expect(snapshot.join?.pending == true)
  }

  /// And the join survives the whole way to the bubble the card reads.
  @Test func theJoinReachesTheCardsFacet() throws {
    let snapshot = try #require(agentSnapshot(from: fieldRow(), device: "dev-mesh"))
    let bubble = try #require(fieldBubble(from: snapshot))
    #expect(bubble.agent?.join?.deviceID == "dev-mesh")
    #expect(bubble.agent?.join?.runtimeSessionID == "pty-a41f")
    // Never both facets: "exactly one facet is non-nil" is what tells the
    // renderer to draw a body rather than a hollow, so an agent whose PTY is
    // published is still an AGENT bubble.
    #expect(bubble.remote == nil)
  }
}
