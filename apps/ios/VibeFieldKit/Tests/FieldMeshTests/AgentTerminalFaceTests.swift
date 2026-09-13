import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// IOS-4c — the join, decided. Four faces and the rules between them, none of
// which wants a simulator.

private func hostRow(
  device: String = "dev-studio", name: String = "studio", session: String = "pty-a41f",
  attachable: Bool = true, readWrite: Bool = true
) -> RemoteSessionRow {
  RemoteSessionRow(
    host: RemoteHost(deviceID: device, deviceName: name),
    session: RemoteSessionInfo(
      sessionID: session, title: "zsh", cwdLabel: "~/Projects", running: true,
      attachable: attachable, readWrite: readWrite, createdAtMs: 1_757_808_000_000,
      activityKind: "foreground-job"))
}

private func join(
  device: String = "dev-studio", hosted: String = "local", session: String? = "pty-a41f",
  pending: Bool = false
) -> AgentJoin {
  AgentJoin(deviceID: device, hosted: hosted, runtimeSessionID: session, pending: pending)
}

@Suite struct AgentTerminalFaceTests {
  /// The ordinary case: the desktop advertises this run's PTY, so the act is
  /// the IOS-3 attach and nothing about it is special.
  @Test func aPublishedTerminalOffersTheOrdinaryAttach() {
    let face = agentTerminalFace(join: join(), hosts: [hostRow()])
    #expect(face == .attach(
      AgentTerminalAddress(
        deviceID: "dev-studio", deviceName: "studio", sessionID: "pty-a41f",
        attachable: true, readWrite: true)))
    #expect(face.offersAttach)
    #expect(!face.offersResume)
    #expect(face.note == nil)
    #expect(face.address?.sessionID == "pty-a41f")
  }

  /// The match is on BOTH ids. A session id is the floor's own, so it is
  /// unique on its desktop and says nothing about anyone else's — matching on
  /// the id alone would collide the first time two machines are on the mesh.
  @Test func aSessionIdOnAnotherDesktopIsNotThisRunsTerminal() {
    let face = agentTerminalFace(
      join: join(device: "dev-studio"),
      hosts: [hostRow(device: "dev-laptop", name: "laptop", session: "pty-a41f")])
    guard case .notPublished = face else {
      Issue.record("a same-id session on another desktop must not match, got \(face)")
      return
    }
    #expect(!face.offersAttach)
  }

  /// The flag is NAMED. "Terminal not published" tells a person nothing they
  /// can do; the flag tells them which switch on which machine.
  @Test func anUnpublishedTerminalNamesTheDesktopAndTheFlag() {
    // The desktop is on the field with another session, so it has a name.
    let known = agentTerminalFace(
      join: join(session: "pty-missing"), hosts: [hostRow(session: "pty-other")])
    #expect(known == .notPublished(deviceName: "studio"))
    #expect(
      known.note
        == "terminal not published — studio's terminal mesh is off (FIELD_NATIVE_TERMINAL_MESH)")
    #expect(!known.offersAttach)
    #expect(!known.offersResume)

    // And a desktop advertising nothing at all has no name to give, which the
    // sentence has to survive.
    let unknown = agentTerminalFace(join: join(), hosts: [])
    #expect(unknown == .notPublished(deviceName: nil))
    #expect(
      unknown.note
        == "terminal not published — that desktop's terminal mesh is off "
          + "(FIELD_NATIVE_TERMINAL_MESH)")
  }

  /// An ended run: `hosted: "none"`, RESUME and no attach.
  @Test func anEndedRunOffersResumeAndNoTerminal() {
    let face = agentTerminalFace(join: join(hosted: "none", session: nil), hosts: [hostRow()])
    #expect(face == .exited)
    #expect(face.offersResume)
    #expect(!face.offersAttach)
    #expect(face.note == "this run has ended — its terminal is gone")
  }

  /// The fold's word outranks a stale advertisement. A hosts row that still
  /// names a session the feed has reported gone must not offer a terminal.
  @Test func anEndedRunIsEndedEvenIfTheHostsStoreStillListsIt() {
    let face = agentTerminalFace(
      join: join(hosted: "none", session: "pty-a41f"), hosts: [hostRow()])
    #expect(face == .exited)
    #expect(!face.offersAttach)
  }

  /// AR-4's pending run: its PTY is real, so ATTACH is offered. RESUME is not
  /// — the run has not ended, and resuming it twice is not a thing to offer.
  @Test func aPendingRunAttachesAndIsNotResumed() {
    let face = agentTerminalFace(join: join(pending: true), hosts: [hostRow()])
    guard case .unobserved(let address) = face else {
      Issue.record("expected the unobserved face, got \(face)")
      return
    }
    #expect(address.sessionID == "pty-a41f")
    #expect(face.offersAttach)
    #expect(!face.offersResume)
    #expect(face.note == "live, unobserved — this run resumes when it next goes idle")
  }

  /// A session the desktop shares read-only is still attachable; a session it
  /// does not share at all is not, and the card must not offer what the row
  /// refuses.
  @Test func anUnattachableRowOffersNoAttach() {
    let face = agentTerminalFace(join: join(), hosts: [hostRow(attachable: false)])
    #expect(face.address != nil)
    #expect(!face.offersAttach)
  }

  /// The scripted fleet has no desktop and no PTY, and its cards say nothing
  /// about terminals rather than offering one.
  @Test func noJoinOffersNothingAndClaimsNothing() {
    let face = agentTerminalFace(join: nil, hosts: [hostRow()])
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

  @Test func aRowWithNoTerminalJoinsAsNone() throws {
    let snapshot = try #require(agentSnapshot(from: fieldRow(hosted: nil, session: nil)))
    #expect(snapshot.join?.hosted == "none")
    #expect(snapshot.join?.hasTerminal == false)
    #expect(agentTerminalFace(join: snapshot.join, hosts: []) == .exited)
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
