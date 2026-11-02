import FieldAgents
import FieldMesh
import Foundation
import Testing

@testable import FieldHome

// Items 154 and 162 — the card's terminal, decided for its subject (`FieldHomeModel.cardTerminalFace`): a bare
// terminal's pane join attaches as an agent's does, a withheld one says why, and RESUME is an agent's alone (a bare
// terminal has no run: its board key is a floor session, which `agent.resume` would refuse).

private let studio = FieldDesktop(
  deviceId: "dev-studio", name: "Studio", platform: "darwin", state: .ready, feed: .door,
  publishesTerminalDoors: true)
private let loft = FieldDesktop(
  deviceId: "dev-loft", name: "Loft", platform: "darwin", state: .ready, feed: .door, publishesTerminalDoors: nil)

private func terminal(_ id: String, join: AgentJoin?) -> FieldBubble {
  FieldBubble(
    id: id, project: "", detail: "notes", status: .working, identityKey: id, createdAt: Date(timeIntervalSince1970: 0),
    modelId: id, runKey: id, terminalJoin: join)
}

private func agent(_ id: String, join: AgentJoin) -> FieldBubble {
  FieldBubble(
    id: id, project: "p", detail: "d", status: .working, identityKey: id, createdAt: Date(timeIntervalSince1970: 0),
    agent: AgentFacet(provider: AgentProvider(rawValue: "claude"), join: join), modelId: id, runKey: id)
}

@Suite struct CardTerminalFaceTests {
  /// C1 (item 154) — a home bare terminal's card is the attach, on its desktop, by name; not `.noJoin`.
  @Test func aHomeBareTerminalsCardAttaches() {
    let bubble = terminal(
      "pty-h2", join: AgentJoin(deviceID: "dev-studio", hosted: "local", runtimeSessionID: "pty-h2"))
    let face = FieldHomeModel.cardTerminalFace(bubble, desktops: [studio, loft])
    #expect(face == .attach(AgentTerminalAddress(deviceID: "dev-studio", deviceName: "Studio", sessionID: "pty-h2")))
    #expect(face.offersAttach)
  }

  /// C2 (item 154) — a peer's bare terminal carries its desktop's name.
  @Test func aPeersBareTerminalCarriesLoft() {
    let bubble = terminal(
      "pty-p1", join: AgentJoin(deviceID: "dev-loft", hosted: "local", runtimeSessionID: "pty-p1"))
    let face = FieldHomeModel.cardTerminalFace(bubble, desktops: [studio, loft])
    #expect(face == .attach(AgentTerminalAddress(deviceID: "dev-loft", deviceName: "Loft", sessionID: "pty-p1")))
  }

  /// C3 (item 154) — a withheld pane (doors down) is the honest reason, with Loft's doors unsaid: not a blank.
  @Test func aWithheldPaneIsTheHonestReason() {
    let bubble = terminal("pty-p1", join: AgentJoin(deviceID: "dev-loft", hosted: "none", paneWithheld: true))
    let face = FieldHomeModel.cardTerminalFace(bubble, desktops: [studio, loft])
    #expect(face == .notPublished(deviceName: "Loft"))
  }

  /// C4 (item 162) — a live agent whose doors are down: "terminal not published", and no RESUME.
  @Test func item162ALiveAgentWithItsDoorsDownOffersNoResume() {
    let bubble = agent("run-p-ask", join: AgentJoin(deviceID: "dev-loft", hosted: "none", paneWithheld: true))
    let face = FieldHomeModel.cardTerminalFace(bubble, desktops: [studio, loft])
    #expect(face == .notPublished(deviceName: "Loft"))
    #expect(!FieldHomeModel.offersResume(face, for: bubble))
  }

  /// C5 (item 154) — a bare terminal never offers RESUME, whatever its face: it has no run to resume.
  @Test func aBareTerminalOffersNoResume() {
    let bubble = terminal(
      "pty-h2",
      join: AgentJoin(deviceID: "dev-studio", hosted: "local", runtimeSessionID: "pty-h2", exited: true))
    let face = FieldHomeModel.cardTerminalFace(bubble, desktops: [studio, loft])
    #expect(!FieldHomeModel.offersResume(face, for: bubble))
    #expect(!FieldHomeModel.offersResume(.exited, for: bubble))
  }

  /// C6 — an agent's card is unchanged, save the doors-down case (C4): its attach, and an ended run's RESUME.
  @Test func anAgentsCardIsUnchanged() {
    let live = agent("run-h-turn", join: AgentJoin(deviceID: "dev-studio", hosted: "local", runtimeSessionID: "pty-h1"))
    let face = FieldHomeModel.cardTerminalFace(live, desktops: [studio, loft])
    #expect(face == .attach(AgentTerminalAddress(deviceID: "dev-studio", deviceName: "Studio", sessionID: "pty-h1")))
    let ended = agent("run-h-crash", join: AgentJoin(deviceID: "dev-studio", hosted: "none", exited: true))
    let endedFace = FieldHomeModel.cardTerminalFace(ended, desktops: [studio, loft])
    #expect(endedFace == .exited)
    #expect(FieldHomeModel.offersResume(endedFace, for: ended))
  }
}
