import SwarmPhysics
import Testing

@testable import FieldAgents

@Suite struct AgentClassificationTests {
  @Test func missingStateReadsAsWorking() {
    #expect(classifyAgentStatus(nil) == .working)
  }

  @Test func terminalLifecyclesLeaveTheField() {
    #expect(classifyAgentStatus(AgentRuntimeState(lifecycle: .exited)) == nil)
    #expect(classifyAgentStatus(AgentRuntimeState(lifecycle: .failed)) == nil)
  }

  @Test func permissionsOutrankEverything() {
    let state = AgentRuntimeState(
      activeTurn: true,
      permissions: [AgentPermission(tool: "Bash")],
      toolRuns: [AgentToolRun(title: "Bash")])
    #expect(classifyAgentStatus(state) == .blocked)
  }

  /// The monitor's other two blockers block the same way; the kind is what
  /// the copy names when there is no reply to show.
  @Test func questionsAndFailuresBlockToo() {
    let question = AgentRuntimeState(activeTurn: true, blockers: [AgentBlocker(kind: .question)])
    let failure = AgentRuntimeState(blockers: [AgentBlocker(kind: .failure, detail: "E_TOOL")])
    #expect(classifyAgentStatus(question) == .blocked)
    #expect(classifyAgentStatus(failure) == .blocked)
    #expect(agentBlockerKind(question) == .question)
    #expect(agentBlockerKind(failure) == .failure)
    // A permission outranks the rest, as the monitor lists it first.
    let both = AgentRuntimeState(
      permissions: [AgentPermission(tool: "Bash")], blockers: [AgentBlocker(kind: .question)])
    #expect(agentBlockerKind(both) == .permission)
    #expect(agentBlockerKind(AgentRuntimeState()) == nil)
    #expect(agentBlockerKind(nil) == nil)
  }

  @Test func anySignOfWorkIsWorking() {
    #expect(classifyAgentStatus(AgentRuntimeState(lifecycle: .starting)) == .working)
    #expect(classifyAgentStatus(AgentRuntimeState(activeTurn: true)) == .working)
    #expect(classifyAgentStatus(AgentRuntimeState(activeReasoning: true)) == .working)
    #expect(
      classifyAgentStatus(AgentRuntimeState(toolRuns: [AgentToolRun(title: "Edit")])) == .working)
    #expect(classifyAgentStatus(AgentRuntimeState(taskCount: 2)) == .working)
  }

  @Test func quietReadySessionIsIdle() {
    #expect(classifyAgentStatus(AgentRuntimeState()) == .idle)
  }

  /// RFC 005's sizes: idle and blocked at the idle size, working from the
  /// working size to the largest by its share of the working sessions' tokens.
  @Test func radiusFollowsStatusAndShare() {
    let parameters = SwarmParameters.default
    #expect(bodyRadius(status: .idle, share: 1, parameters: parameters) == 50)
    #expect(bodyRadius(status: .blocked, share: 1, parameters: parameters) == 50)
    #expect(bodyRadius(status: .working, share: 0, parameters: parameters) == 60)
    #expect(bodyRadius(status: .working, share: 0.5, parameters: parameters) == 70)
    #expect(bodyRadius(status: .working, share: 1, parameters: parameters) == 80)
    #expect(bodyRadius(status: .working, share: 7, parameters: parameters) == 80)
  }

  @Test func theLockedDefaults() {
    let parameters = SwarmParameters.default
    #expect(parameters.gravityPull == 0.0002)
    #expect(parameters.restitution == 0)
    #expect(parameters.frictionAir == 0.2)
    #expect(parameters.physicsHz == 30)
    #expect(parameters.bubbleFillOpacity == 0.72)
    #expect(parameters.glowReach == 34)
    #expect(parameters.glowStrength == 0.8)
    #expect(parameters.glowBreath == 0)
    #expect(parameters.radiusIdle == 50)
    #expect(parameters.radiusWorking == 60)
    #expect(parameters.radiusWorkingMax == 80)
    #expect(parameters.radiusBlocked == 50)
    // The two stability clamps, applied wherever parameters enter.
    #expect(SwarmParameters(frictionAir: 0.9).effectiveFrictionAir == 0.2)
    #expect(SwarmParameters(frictionAir: -1).effectiveFrictionAir == 0)
    #expect(SwarmParameters(physicsHz: 5).effectivePhysicsHz == 15)
    #expect(SwarmParameters(physicsHz: .nan).effectivePhysicsHz == 15)
    #expect(SwarmParameters(physicsHz: 120).stepMs == 1000.0 / 120)
  }
}

@Suite struct AgentDetailTests {
  @Test func detailTellsTheTruth() {
    #expect(agentDetail(nil, status: .working) == "starting")
    #expect(
      agentDetail(
        AgentRuntimeState(permissions: [AgentPermission(tool: "Bash")]), status: .blocked)
        == "permission · Bash")
    #expect(
      agentDetail(AgentRuntimeState(permissions: [AgentPermission()]), status: .blocked)
        == "permission required")
    #expect(
      agentDetail(AgentRuntimeState(blockers: [AgentBlocker(kind: .question)]), status: .blocked)
        == "question")
    #expect(
      agentDetail(AgentRuntimeState(blockers: [AgentBlocker(kind: .failure)]), status: .blocked)
        == "failed")
    #expect(
      agentDetail(AgentRuntimeState(toolRuns: [AgentToolRun(title: "pnpm verify")]),
        status: .working) == "pnpm verify")
    #expect(
      agentDetail(AgentRuntimeState(toolRuns: [AgentToolRun()]), status: .working)
        == "using tool")
    #expect(agentDetail(AgentRuntimeState(activeReasoning: true), status: .working) == "thinking")
    #expect(agentDetail(AgentRuntimeState(activeTurn: true), status: .working) == "responding")
    #expect(agentDetail(AgentRuntimeState(), status: .idle) == "idle")
  }
}

@Suite struct AgentIdentityHueTests {
  /// Cross-language goldens: generated by running the desktop's `agentColor`
  /// FNV-1a hash (godview `agent-status.ts`) under Node on 2026-07-29. The
  /// FIELD no longer reads this hue (D-i16: record §02 deals a project's
  /// colour); it stays for the card header and goes with its last reader.
  /// If this test fails, the Swift port has drifted from the JS original —
  /// fix the port, never the goldens.
  @Test func matchesDesktopHashGoldens() {
    #expect(agentIdentityHue("vibe-field") == 136)
    #expect(agentIdentityHue("truffle") == 97)
    #expect(agentIdentityHue("chopsticks") == 136)
    #expect(agentIdentityHue("ghosttea") == 130)
    #expect(agentIdentityHue("session-0001") == 89)
    #expect(agentIdentityHue("9f31c2ab-77d1-4e02-b1a5-1cd1e0c1a001") == 105)
    #expect(agentIdentityHue("a") == 276)
    #expect(agentIdentityHue("") == 61)
  }
}
