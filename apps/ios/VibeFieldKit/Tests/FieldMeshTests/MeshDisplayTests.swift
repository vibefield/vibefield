import GhostteaTruffle
import Testing

@testable import FieldMesh

@Suite struct MeshPhaseMappingTests {
  @Test func everyPhaseHasAnHonestState() {
    #expect(MeshModel.state(for: .starting) == .starting)
    #expect(MeshModel.state(for: .needsLogin) == .needsLogin)
    #expect(MeshModel.state(for: .needsMachineAuth) == .needsMachineAuth)
    #expect(MeshModel.state(for: .running) == .up)
    #expect(MeshModel.state(for: .stopping) == .stopping)
    #expect(MeshModel.state(for: .stopped) == .off)
    #expect(MeshModel.state(for: .failed) == .failed("mesh runtime failed"))
  }
}

@Suite struct MeshDisplayTests {
  @Test func chipLabelsSpeakTheGodviewVoice() {
    #expect(MeshDisplay.chipLabel(state: .off, peerCount: 0) == "MESH · OFF")
    #expect(MeshDisplay.chipLabel(state: .starting, peerCount: 0) == "MESH · …")
    #expect(MeshDisplay.chipLabel(state: .needsLogin, peerCount: 0) == "MESH · SIGN IN")
    #expect(MeshDisplay.chipLabel(state: .needsMachineAuth, peerCount: 0) == "MESH · SIGN IN")
    #expect(MeshDisplay.chipLabel(state: .up, peerCount: 3) == "MESH · 3")
    #expect(MeshDisplay.chipLabel(state: .stopping, peerCount: 3) == "MESH · …")
    #expect(MeshDisplay.chipLabel(state: .failed("x"), peerCount: 0) == "MESH · FAILED")
  }

  @Test func statusLinesNeverOverstate() {
    #expect(
      MeshDisplay.statusLine(state: .off, peerCount: 0)
        == "not connected — the mesh starts only when you ask")
    #expect(MeshDisplay.statusLine(state: .up, peerCount: 1) == "online · 1 peer in reach")
    #expect(MeshDisplay.statusLine(state: .up, peerCount: 4) == "online · 4 peers in reach")
    #expect(
      MeshDisplay.statusLine(state: .failed("timeout dialing control"), peerCount: 0)
        == "failed — timeout dialing control")
  }

  @Test func primaryActionsMatchStates() {
    #expect(MeshDisplay.primaryAction(state: .off) == .connect)
    #expect(MeshDisplay.primaryAction(state: .failed("x")) == .connect)
    #expect(MeshDisplay.primaryAction(state: .needsLogin) == .signIn)
    #expect(MeshDisplay.primaryAction(state: .up) == .disconnect)
    #expect(MeshDisplay.primaryAction(state: .needsMachineAuth) == .disconnect)
    #expect(MeshDisplay.primaryAction(state: .starting) == nil)
    #expect(MeshDisplay.primaryAction(state: .stopping) == nil)
  }

  @Test func onlySignInStatesDemandAttention() {
    #expect(MeshDisplay.chipWantsAttention(state: .needsLogin))
    #expect(MeshDisplay.chipWantsAttention(state: .needsMachineAuth))
    #expect(!MeshDisplay.chipWantsAttention(state: .off))
    #expect(!MeshDisplay.chipWantsAttention(state: .up))
    #expect(!MeshDisplay.chipWantsAttention(state: .failed("x")))
  }
}
